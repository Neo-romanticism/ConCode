import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../utils/anthropic.js";
import { Team, Agent, Step } from "../types/team.js";
import { allTools, summonJudgeTool } from "./tools.js";
import { executeTool } from "./fileops.js";

// ─── Types ───

export interface OrchestratorCallbacks {
  onStep?: (step: string, agent: string, action: string) => void;
  onToolUse?: (agent: string, tool: string, input: Record<string, string>) => void;
  onStatus?: (msg: string) => void;
}

interface StepResult {
  agent: string;
  action: string;
  output: string;
}

// ─── Helpers ───

function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number, waitMs: number) => void
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") || err.message.includes("rate_limit"));
      if (!isRateLimit || attempt === maxRetries) throw err;
      const waitMs = 15000 * Math.pow(2, attempt);
      onRetry?.(attempt + 1, waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}

// ─── Agent Execution ───

async function runAgentWithTools(
  client: Anthropic,
  agent: Agent,
  messages: Anthropic.MessageParam[],
  onToolUse?: (tool: string, input: Record<string, string>) => void
): Promise<string> {
  const system = cachedSystem(agent.system_prompt);
  const tools = agent.tools_enabled ? allTools : [summonJudgeTool];
  const maxToolRounds = 10;

  const localMessages: Anthropic.MessageParam[] = [...messages];

  for (let i = 0; i < maxToolRounds; i++) {
    const stream = client.messages.stream({
      model: agent.model,
      max_tokens: agent.max_tokens,
      system,
      tools: agent.tools_enabled ? tools : undefined,
      messages: localMessages,
    });
    const response = await stream.finalMessage();

    // Check for summon_judge (consensus signal)
    const judgeCall = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "summon_judge"
    );
    if (judgeCall) {
      const input = judgeCall.input as { consensus_answer: string; key_improvements?: string };
      return input.consensus_answer;
    }

    // Check for tool calls
    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name !== "summon_judge"
    );

    if (toolCalls.length === 0) {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    localMessages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolCalls.map(async (call) => {
        const input = call.input as Record<string, string>;
        onToolUse?.(call.name, input);
        let result: string;
        try {
          result = await executeTool(call.name, input);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { type: "tool_result" as const, tool_use_id: call.id, content: result };
      })
    );
    localMessages.push({ role: "user", content: toolResults });
  }

  return "Max tool rounds exceeded.";
}

async function runAgentSimple(
  client: Anthropic,
  agent: Agent,
  messages: Anthropic.MessageParam[]
): Promise<string> {
  const system = cachedSystem(agent.system_prompt);
  const stream = client.messages.stream({
    model: agent.model,
    max_tokens: agent.max_tokens,
    system,
    messages,
  });
  const response = await stream.finalMessage();
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ─── Streaming Agent (for final output) ───

export async function* runAgentStreaming(
  client: Anthropic,
  agent: Agent,
  messages: Anthropic.MessageParam[]
): AsyncGenerator<string> {
  const system = cachedSystem(agent.system_prompt);
  const stream = client.messages.stream({
    model: agent.model,
    max_tokens: agent.max_tokens,
    system,
    messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

// ─── Orchestrator ───

export async function orchestrate(
  apiKey: string,
  team: Team,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  callbacks?: OrchestratorCallbacks
): Promise<{ output: string; steps: StepResult[] }> {
  const client = getClient(apiKey);
  const agentMap = new Map(team.agents.map((a) => [a.name, a]));
  const stepResults: StepResult[] = [];
  let previousOutput = "";

  // Resolve workflow with loop expansion
  const resolvedSteps = resolveWorkflow(team.workflow, team.max_rounds);

  for (let i = 0; i < resolvedSteps.length; i++) {
    const step = resolvedSteps[i];
    const agent = agentMap.get(step.agent);
    if (!agent) throw new Error(`Agent "${step.agent}" not found in team`);

    // Inject system prompt into agent if provided
    const effectiveAgent = systemPrompt
      ? { ...agent, system_prompt: `${agent.system_prompt}\n\nUser context: ${systemPrompt}` }
      : agent;

    callbacks?.onStep?.(`${i + 1}/${resolvedSteps.length}`, agent.name, step.action);

    // Build messages for this step
    const messages = buildStepMessages(step, userMessages, previousOutput, stepResults);

    // Execute
    let output: string;
    const retryHandler = (_attempt: number, waitMs: number) => {
      callbacks?.onStatus?.(`⏳ Rate limited (${agent.name}), waiting ${waitMs / 1000}s...`);
    };

    if (effectiveAgent.tools_enabled) {
      output = await withRetry(
        () => runAgentWithTools(client, effectiveAgent, messages, (tool, input) => {
          callbacks?.onToolUse?.(agent.name, tool, input);
        }),
        3,
        retryHandler
      );
    } else {
      output = await withRetry(
        () => runAgentSimple(client, effectiveAgent, messages),
        3,
        retryHandler
      );
    }

    stepResults.push({ agent: agent.name, action: step.action, output });
    previousOutput = output;
  }

  return {
    output: previousOutput,
    steps: stepResults,
  };
}

/**
 * Streaming variant — runs all steps, then streams the final output.
 */
export async function* orchestrateStream(
  apiKey: string,
  team: Team,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  callbacks?: OrchestratorCallbacks
): AsyncGenerator<string> {
  const client = getClient(apiKey);
  const agentMap = new Map(team.agents.map((a) => [a.name, a]));
  const stepResults: StepResult[] = [];
  let previousOutput = "";

  const resolvedSteps = resolveWorkflow(team.workflow, team.max_rounds);

  for (let i = 0; i < resolvedSteps.length; i++) {
    const step = resolvedSteps[i];
    const agent = agentMap.get(step.agent);
    if (!agent) throw new Error(`Agent "${step.agent}" not found in team`);

    const effectiveAgent = systemPrompt
      ? { ...agent, system_prompt: `${agent.system_prompt}\n\nUser context: ${systemPrompt}` }
      : agent;

    callbacks?.onStep?.(`${i + 1}/${resolvedSteps.length}`, agent.name, step.action);

    const messages = buildStepMessages(step, userMessages, previousOutput, stepResults);
    const isLastStep = i === resolvedSteps.length - 1;

    if (isLastStep && !effectiveAgent.tools_enabled) {
      // Stream the final step
      for await (const chunk of runAgentStreaming(client, effectiveAgent, messages)) {
        yield chunk;
      }
      return;
    }

    // Non-streaming execution for intermediate steps
    let output: string;
    const retryHandler = (_attempt: number, waitMs: number) => {
      callbacks?.onStatus?.(`⏳ Rate limited (${agent.name}), waiting ${waitMs / 1000}s...`);
    };

    if (effectiveAgent.tools_enabled) {
      output = await withRetry(
        () => runAgentWithTools(client, effectiveAgent, messages, (tool, input) => {
          callbacks?.onToolUse?.(agent.name, tool, input);
        }),
        3,
        retryHandler
      );
    } else {
      output = await withRetry(
        () => runAgentSimple(client, effectiveAgent, messages),
        3,
        retryHandler
      );
    }

    stepResults.push({ agent: agent.name, action: step.action, output });
    previousOutput = output;
  }

  // If we get here, yield the last output
  yield previousOutput;
}

// ─── Workflow Resolution ───

function resolveWorkflow(steps: Step[], maxRounds: number): Step[] {
  const resolved: Step[] = [];
  let i = 0;

  while (i < steps.length) {
    const step = steps[i];

    if (step.pass_to === "loop") {
      // Find the loop body: current step + next step (the one that loops back)
      const iterations = step.max_iterations ?? maxRounds;
      const loopStart = i;
      const loopEnd = Math.min(i + 1, steps.length - 1);

      for (let round = 0; round < iterations; round++) {
        for (let j = loopStart; j <= loopEnd; j++) {
          resolved.push({ ...steps[j], pass_to: "next" });
        }
      }
      i = loopEnd + 1;
    } else {
      resolved.push(step);
      i++;
    }
  }

  return resolved;
}

function buildStepMessages(
  step: Step,
  userMessages: Anthropic.MessageParam[],
  previousOutput: string,
  allResults: StepResult[]
): Anthropic.MessageParam[] {
  switch (step.input_from) {
    case "user":
      return [...userMessages];

    case "previous":
      if (!previousOutput) return [...userMessages];
      return [
        ...userMessages,
        {
          role: "user",
          content: buildContextPrompt(step.action, previousOutput),
        },
      ];

    case "all": {
      const summary = allResults
        .map((r) => `[${r.agent} — ${r.action}]\n${r.output}`)
        .join("\n\n---\n\n");
      return [
        ...userMessages,
        {
          role: "user",
          content:
            `Here is the full discussion from all agents:\n\n${summary}\n\n` +
            `Produce the final polished response for the user.`,
        },
      ];
    }

    default:
      return [...userMessages];
  }
}

function buildContextPrompt(action: string, previousOutput: string): string {
  switch (action) {
    case "critique":
      return `Review this answer. List only concrete issues, max 5 bullet points:\n\n${previousOutput}`;
    case "judge":
      return `After thorough review, here is the refined answer:\n\n${previousOutput}\n\nProduce the final polished response.`;
    case "transform":
      return `Here is the current content to improve:\n\n${previousOutput}\n\nImprove and output the result directly.`;
    default:
      return `Previous agent output:\n\n${previousOutput}\n\nContinue from here.`;
  }
}
