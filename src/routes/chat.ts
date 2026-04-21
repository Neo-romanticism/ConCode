import { Router, Request, Response } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { RequestConfigSchema } from "../config.js";
import { runDebate } from "../core/debate.js";
import { judgeStream } from "../core/judge.js";
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
  // concode-specific config
  concode: RequestConfigSchema.optional(),
});

/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible endpoint. The API key is passed via Authorization header.
 * concode-specific settings go in the `concode` field of the request body.
 */
router.post("/v1/chat/completions", async (req: Request, res: Response) => {
  try {
    // API key: header takes priority, falls back to .env
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

    // Parse and validate request body
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { messages, concode } = parsed.data;
    const config = concode ?? RequestConfigSchema.parse({});

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

    // Run the debate
    const debateResult = await runDebate(apiKey, userMessages, systemPrompt, config);

    // Stream the judge's final response
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
