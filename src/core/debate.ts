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

/** Wrap system prompt as cacheable text block */
function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** Retry wrapper for rate limit (429) errors */
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

      // Exponential backoff: 15s, 30s, 60s
      const waitMs = 15000 * Math.pow(2, attempt);
      onRetry?.(attempt + 1, waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}

export async function runDebate(
  apiKey: string,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  config: RequestConfig,
  onToolUse?: (name: string, input: Record<string, string>) => void,
  onStatus?: (msg: string) => void
): Promise<DebateResult> {
  const client = getClient(apiKey);

  const advocateSystemText =
    `You are the Advocate. Your job is to provide the best possible answer to the user's request.\n` +
    `You have tools: file ops (read/write/edit/delete/move/copy), directory (list/tree/info), search (grep), shell execution, and web (fetch/search).\n` +
    `IMPORTANT: Be strategic with tool use. Read only the files you truly need. Use directory_tree or list_files first to understand structure, then read only key files. Do NOT read every file in a directory.\n` +
    `You will engage in a debate with a Critic who will challenge your answer.\n` +
    `When you and the Critic reach consensus, call the summon_judge tool with the final agreed answer.\n` +
    `Stay focused and constructive. Incorporate valid criticism to improve your answer.\n` +
    (systemPrompt ? `\nOriginal system context: ${systemPrompt}` : "");

  const advocateSystem = cachedSystem(advocateSystemText);
  const advocateMessages: Anthropic.MessageParam[] = [...userMessages];
  const criticMessages: Anthropic.MessageParam[] = [];

  const criticSystemText =
    `You are the Critic. You receive an answer produced by another AI model.\n` +
    `You do NOT know what the user originally asked. You can only see the answer.\n` +
    `Your job is to find flaws, gaps, inaccuracies, or areas for improvement.\n` +
    `Be CONCISE. List only the most important issues as bullet points. No filler.\n` +
    `If the answer is already excellent, reply with just: "No issues found."`;
  const criticSystem = cachedSystem(criticSystemText);

  const retryHandler = (_attempt: number, waitMs: number) => {
    onStatus?.(`⏳ Rate limited, waiting ${waitMs / 1000}s...`);
  };

  const initialAnswer = await withRetry(
    () => callAdvocateWithTools(client, config.model_advocate, advocateSystem, allTools, advocateMessages, onToolUse),
    3, retryHandler
  );

  if (typeof initialAnswer !== "string") {
    return { ...initialAnswer, rounds: 0 };
  }

  let currentAnswer = initialAnswer;

  for (let round = 1; round <= config.max_rounds; round++) {
    const criticPrompt =
      `Review this answer. List only concrete issues, max 5 bullet points:\n\n${currentAnswer}`;

    criticMessages.push({ role: "user", content: criticPrompt });

    const criticism = await withRetry(
      () => collectStreamedText(client, {
        model: config.model_critic,
        max_tokens: 2048,
        system: criticSystem,
        messages: criticMessages,
      }),
      3, retryHandler
    );

    criticMessages.push({ role: "assistant", content: criticism });

    const advocatePrompt =
      `A critic has reviewed your answer and provided this feedback:\n\n${criticism}\n\n` +
      `Revise your answer incorporating valid points, or defend your position if the criticism is unfounded.\n` +
      `You may use file tools if needed. If you believe the answer is now strong enough, call the summon_judge tool.`;

    advocateMessages.push({ role: "user", content: advocatePrompt });

    const advocateAnswer = await withRetry(
      () => callAdvocateWithTools(client, config.model_advocate, advocateSystem, allTools, advocateMessages, onToolUse),
      3, retryHandler
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

async function collectStreamedText(
  client: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    system: Anthropic.TextBlockParam[];
    messages: Anthropic.MessageParam[];
  }
): Promise<string> {
  const stream = client.messages.stream(params);
  const response = await stream.finalMessage();
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function collectStreamedMessage(
  client: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    system: Anthropic.TextBlockParam[];
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
  }
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(params);
  return stream.finalMessage();
}

async function callAdvocateWithTools(
  client: Anthropic,
  model: string,
  system: Anthropic.TextBlockParam[],
  tools: Anthropic.Tool[],
  messages: Anthropic.MessageParam[],
  onToolUse?: (name: string, input: Record<string, string>) => void
): Promise<string | { consensusAnswer: string; keyImprovements: string }> {
  const maxToolRounds = 10;
  const TOOL_MAX_TOKENS = 4096;
  const TEXT_MAX_TOKENS = 64000;

  for (let i = 0; i < maxToolRounds; i++) {
    const response = await collectStreamedMessage(client, {
      model,
      max_tokens: i === 0 && messages.length <= 2 ? TEXT_MAX_TOKENS : TOOL_MAX_TOKENS,
      system,
      tools,
      messages,
    });

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

    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name !== "summon_judge"
    );

    if (toolCalls.length === 0) {
      if (response.stop_reason === "max_tokens") {
        const retried = await collectStreamedMessage(client, {
          model,
          max_tokens: TEXT_MAX_TOKENS,
          system,
          tools,
          messages,
        });
        const text = retried.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        messages.push({ role: "assistant", content: retried.content });
        return text;
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      messages.push({ role: "assistant", content: response.content });
      return text;
    }

    messages.push({ role: "assistant", content: response.content });

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

        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result,
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  return "Max tool rounds exceeded.";
}
