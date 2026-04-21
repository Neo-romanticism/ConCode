import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../utils/anthropic.js";
import { summonJudgeTool } from "./tools.js";
import { RequestConfig } from "../config.js";

export interface DebateResult {
  consensusAnswer: string;
  keyImprovements: string;
  rounds: number;
}

interface DebateMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Run the debate loop between advocate (Model 1) and critic (Model 2).
 *
 * Flow:
 * 1. Advocate generates an initial answer to the user's prompt.
 * 2. Critic reviews the advocate's answer (without seeing the original user prompt).
 * 3. Advocate responds to criticism, optionally calling summon_judge if consensus is reached.
 * 4. Repeat until summon_judge is called or max_rounds is hit.
 */
export async function runDebate(
  apiKey: string,
  userMessages: Anthropic.MessageParam[],
  systemPrompt: string | undefined,
  config: RequestConfig
): Promise<DebateResult> {
  const client = getClient(apiKey);

  // --- Step 1: Advocate generates initial answer ---
  const advocateSystem =
    `You are the Advocate. Your job is to provide the best possible answer to the user's request.\n` +
    `You will engage in a debate with a Critic who will challenge your answer.\n` +
    `When you and the Critic reach consensus, call the summon_judge tool with the final agreed answer.\n` +
    `Stay focused and constructive. Incorporate valid criticism to improve your answer.\n` +
    (systemPrompt ? `\nOriginal system context: ${systemPrompt}` : "");

  const advocateHistory: DebateMessage[] = [];
  const criticHistory: DebateMessage[] = [];

  // Get initial answer from advocate
  const initialResponse = await client.messages.create({
    model: config.model_advocate,
    max_tokens: 8192,
    system: advocateSystem,
    tools: [summonJudgeTool],
    messages: userMessages,
  });

  const initialAnswer = extractText(initialResponse);
  advocateHistory.push(
    { role: "user", content: userMessages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n") },
    { role: "assistant", content: initialAnswer }
  );

  // --- Debate loop ---
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

    criticHistory.push({ role: "user", content: criticPrompt });

    const criticResponse = await client.messages.create({
      model: config.model_critic,
      max_tokens: 4096,
      system: criticSystem,
      messages: criticHistory.map(m => ({ role: m.role, content: m.content })),
    });

    const criticism = extractText(criticResponse);
    criticHistory.push({ role: "assistant", content: criticism });

    // --- Advocate's turn: respond to criticism ---
    const advocatePrompt =
      `A critic has reviewed your answer and provided this feedback:\n\n${criticism}\n\n` +
      `Revise your answer incorporating valid points, or defend your position if the criticism is unfounded.\n` +
      `If you believe the answer is now strong enough and addresses all valid concerns, call the summon_judge tool.`;

    advocateHistory.push({ role: "user", content: advocatePrompt });

    const advocateResponse = await client.messages.create({
      model: config.model_advocate,
      max_tokens: 8192,
      system: advocateSystem,
      tools: [summonJudgeTool],
      messages: advocateHistory.map(m => ({ role: m.role, content: m.content })),
    });

    // Check if advocate called summon_judge
    const toolUse = findToolUse(advocateResponse);
    if (toolUse) {
      const input = toolUse.input as {
        consensus_answer: string;
        key_improvements: string;
      };
      return {
        consensusAnswer: input.consensus_answer,
        keyImprovements: input.key_improvements,
        rounds: round,
      };
    }

    currentAnswer = extractText(advocateResponse);
    advocateHistory.push({ role: "assistant", content: currentAnswer });
  }

  // Max rounds reached — force a result with the latest answer
  return {
    consensusAnswer: currentAnswer,
    keyImprovements: "Max debate rounds reached. Returning best available answer.",
    rounds: config.max_rounds,
  };
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function findToolUse(
  response: Anthropic.Message
): Anthropic.ToolUseBlock | undefined {
  return response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "summon_judge"
  );
}
