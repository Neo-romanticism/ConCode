import { Router, Request, Response } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { RequestConfigSchema } from "../config.js";
import { runDebate } from "../core/debate.js";
import { judgeStream } from "../core/judge.js";
import { orchestrateStream } from "../core/orchestrator.js";
import { getTeam } from "../store/teams.js";
import { streamSSE } from "../utils/stream.js";

const router = Router();

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const ChatRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().default(true),
  // concode-specific config (legacy)
  concode: RequestConfigSchema.optional(),
  // Team-based execution
  team: z.string().optional(), // team ID or preset name
});

/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible endpoint.
 *
 * - Without `team`: uses legacy debate mode (backward compatible)
 * - With `team`: uses the specified team's workflow
 */
router.post("/v1/chat/completions", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      res.status(401).json({
        error: "No API key found. Set ANTHROPIC_API_KEY in .env or pass Authorization: Bearer <key>",
      });
      return;
    }

    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { messages, concode, team: teamId } = parsed.data;

    // Separate system prompt from messages
    let systemPrompt: string | undefined;
    const userMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = msg.content;
      } else {
        userMessages.push({ role: msg.role, content: msg.content });
      }
    }

    if (userMessages.length === 0) {
      res.status(400).json({ error: "At least one non-system message is required." });
      return;
    }

    // ─── Team-based execution ───
    if (teamId) {
      const team = await getTeam(teamId);
      if (!team) {
        res.status(404).json({ error: `Team "${teamId}" not found. Use GET /v1/teams to list available teams.` });
        return;
      }

      const chunks = orchestrateStream(apiKey, team, userMessages, systemPrompt, {
        onStep: (step, agent, action) => {
          // Could be used for debug headers in the future
        },
      });

      const model = team.agents[team.agents.length - 1]?.model || "claude-sonnet-4-6";
      await streamSSE(res, model, chunks);
      return;
    }

    // ─── Legacy debate mode (backward compatible) ───
    const config = concode ?? RequestConfigSchema.parse({});

    const debateResult = await runDebate(apiKey, userMessages, systemPrompt, config);

    const chunks = judgeStream(
      apiKey,
      config.model_judge,
      userMessages,
      systemPrompt,
      debateResult
    );

    await streamSSE(res, config.model_judge, chunks);
  } catch (err: unknown) {
    console.error("Error in /v1/chat/completions:", err);

    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  }
});

export default router;
