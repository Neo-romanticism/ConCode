import { z } from "zod";

// Legacy config — backward compatible with existing debate mode
export const RequestConfigSchema = z.object({
  model_advocate: z.string().default("claude-sonnet-4-6"),
  model_critic: z.string().default("claude-sonnet-4-6"),
  model_judge: z.string().default("claude-opus-4-6"),
  max_rounds: z.number().min(1).max(20).default(3),
});

export type RequestConfig = z.infer<typeof RequestConfigSchema>;

export const SERVER_PORT = parseInt(process.env.PORT || "3000", 10);
