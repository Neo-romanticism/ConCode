import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../utils/anthropic.js";
import { allTools } from "./tools.js";
import { executeTool } from "./fileops.js";
import { RequestConfig } from "../config.js";

export interface DebateResult {
  consensusAnswer: string;
  keyImprovements: string;
  rounds: number;
}

/**
 * Run the debate loop between advocate (Model 1) and critic (Model 2).
 *
 * Flow:
 * 1. Advocate generates an initial answer (may use file tools).
 * 2. Critic reviews the advocate's answer (without seeing the original user prompt).
 * 3. Advocate responds to criticism, may use file tools, calls summon_judge on consensus.
 * 4. Repeat until summon_judge is called or max_rounds is hit.
 */
export async function runDebate(
  apiKey: string,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  config: RequestConfig,
  onToolUse?: (name: string, input: Record<string, string>) => void
): Promise<DebateResult> {
  const client = getClient(apiKey);

  const advocateSystem =
    `You are the Advocate. Your job is to provide the best possible answer to the user's request.\n` +
    `You have tools: file ops (read/write/edit/delete/move/copy), directory (list/tree/info), search (grep), shell execution, and web (fetch/search).\n` +
    `You will engage in a debate with a Critic who will challenge your answer.\n` +
    `When you and the Critic reach consensus, call the summon_judge tool with the final agreed answer.\n` +
    `Stay focused and constructive. Incorporate valid criticism to improve your answer.\n` +
    (systemPrompt ? `\nOriginal system context: ${systemPrompt}` : "");

  const advocateMessages: Anthropic.MessageParam[] = [...userMessages];
  const criticMessages: Anthropic.MessageParam[] = [];

  // Get initial answer from advocate (with tool loop)
  const initialAnswer = await callAdvocateWithTools(
    client, config.model_advocate, advocateSystem, allTools, advocateMessages, onToolUse
  );

  if (typeof initialAnswer !== "string") {
    return { ...initialAnswer, rounds: 0 };
  }

  let currentAnswer = initialAnswer;

  for (let round = 1; round <= config.max_rounds; round++) {
    // --- Critic's turn ---
    const criticSystem =
      `You are the Critic. You receive an answer produced by another AI model.\n` +
      `You do NOT know what the user originally asked. You can only see the answer.\n` +
      `Your job is to find flaws, gaps, inaccuracies, or areas for improvement.\n` +
      `Be specific and constructive. If the answer is already excellent, say so clearly.`;

    const criticPrompt =
      `Here is the answer to review:\n\n${currentAnswer}\n\n` +
      `Provide your critique. Be specific about what could be improved.`;

    criticMessages.push({ role: "user", content: criticPrompt });

    const criticResponse = await client.messages.create({
      model: config.model_critic,
      max_tokens: 4096,
      system: criticSystem,
      messages: criticMessages,
    });

    const criticism = extractText(criticResponse);
    criticMessages.push({ role: "assistant", content: criticism });

    // --- Advocate's turn ---
    const advocatePrompt =
      `A critic has reviewed your answer and provided this feedback:\n\n${criticism}\n\n` +
      `Revise your answer incorporating valid points, or defend your position if the criticism is unfounded.\n` +
      `You may use file tools if needed. If you believe the answer is now strong enough, call the summon_judge tool.`;

    advocateMessages.push({ role: "user", content: advocatePrompt });

    const advocateAnswer = await callAdvocateWithTools(
      client, config.model_advocate, advocateSystem, allTools, advocateMessages, onToolUse
    );

    if (typeof advocateAnswer !== "string") {
      return { ...advocateAnswer, rounds: round };
    }

    currentAnswer = advocateAnswer;
  }

  return {
    consensusAnswer: currentAnswer,
    keyImprovements: "Max debate rounds reached. Returning best available answer.",
    rounds: config.max_rounds,
  };
}

/**
 * Call the advocate model, handling file tool calls in a loop
 * until we get a text response or a summon_judge call.
 */
async function callAdvocateWithTools(
  client: Anthropic,
  model: string,
  system: string,
  tools: Anthropic.Tool[],
  messages: Anthropic.MessageParam[],
  onToolUse?: (name: string, input: Record<string, string>) => void
): Promise<string | { consensusAnswer: string; keyImprovements: string }> {
  const maxToolRounds = 20;

  for (let i = 0; i < maxToolRounds; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system,
      tools,
      messages,
    });

    // Check for summon_judge
    const judgeCall = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "summon_judge"
    );

    if (judgeCall) {
      const input = judgeCall.input as {
        consensus_answer: string;
        key_improvements: string;
      };
      return {
        consensusAnswer: input.consensus_answer,
        keyImprovements: input.key_improvements,
      };
    }

    // Check for file tool calls
    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name !== "summon_judge"
    );

    if (toolCalls.length === 0) {
      // No tool calls — return text
      const text = extractText(response);
      messages.push({ role: "assistant", content: response.content });
      return text;
    }

    // Execute file tools and feed results back
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      const input = call.input as Record<string, string>;
      onToolUse?.(call.name, input);

      let result: string;
      try {
        result = await executeTool(call.name, input);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return "Max tool rounds exceeded.";
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
