import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../utils/anthropic.js";
import { DebateResult } from "./debate.js";

/**
 * The Judge (Model 3) takes the debate consensus and produces
 * the final streamed response for the user.
 *
 * Returns an async iterable of text chunks for SSE streaming.
 */
export async function* judgeStream(
  apiKey: string,
  model: string,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  debateResult: DebateResult
): AsyncGenerator<string> {
  const client = getClient(apiKey);

  const judgeSystem =
    `You are the Judge. Two AI models debated to produce the best possible answer.\n` +
    `You receive the consensus answer and a summary of improvements made during debate.\n` +
    `Your job is to produce a polished, final response for the user.\n` +
    `Do NOT mention the debate process. Respond as if you are directly answering the user.\n` +
    `Maintain the quality and incorporate all improvements from the debate.\n` +
    (systemPrompt ? `\nOriginal system context: ${systemPrompt}` : "");

  const judgePrompt =
    `The user's original messages are provided in the conversation.\n\n` +
    `After thorough review, here is the refined answer:\n\n${debateResult.consensusAnswer}\n\n` +
    `Key improvements made: ${debateResult.keyImprovements}\n\n` +
    `Produce the final polished response for the user.`;

  const messages: Anthropic.MessageParam[] = [
    ...userMessages,
    { role: "user", content: judgePrompt },
  ];

  const stream = client.messages.stream({
    model,
    max_tokens: 8192,
    system: judgeSystem,
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
