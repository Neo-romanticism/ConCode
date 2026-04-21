import { z } from "zod";

export const RequestConfigSchema = z.object({
  model_advocate: z.string().default("claude-sonnet-4-20250514"),
  model_critic: z.string().default("claude-sonnet-4-20250514"),
  model_judge: z.string().default("claude-sonnet-4-20250514"),
  max_rounds: z.number().min(1).max(20).default(5),
});

export type RequestConfig = z.infer<typeof RequestConfigSchema>;

export const SERVER_PORT = parseInt(process.env.PORT || "3000", 10);
