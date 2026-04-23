import { z } from "zod";

// ─── Agent Definition ───

export const AgentSchema = z.object({
  name: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  model: z.string().default("claude-sonnet-4-6"),
  system_prompt: z.string().min(1),
  temperature: z.number().min(0).max(1).default(0.7),
  max_tokens: z.number().min(1).max(128000).default(8192),
  tools_enabled: z.boolean().default(false),
});

export type Agent = z.infer<typeof AgentSchema>;

// ─── Step Definition ───

export const StepSchema = z.object({
  agent: z.string().min(1), // references Agent.name
  action: z.enum(["generate", "critique", "judge", "transform"]),
  input_from: z.enum(["user", "previous", "all"]).default("previous"),
  pass_to: z.enum(["next", "loop", "output"]).default("next"),
  max_iterations: z.number().min(1).max(20).optional(), // for loop
});

export type Step = z.infer<typeof StepSchema>;

// ─── Team Definition ───

export const TeamSchema = z.object({
  id: z.string().optional(), // auto-generated
  name: z.string().min(1).max(128),
  description: z.string().max(512).default(""),
  agents: z.array(AgentSchema).min(1).max(10),
  workflow: z.array(StepSchema).min(1).max(20),
  max_rounds: z.number().min(1).max(50).default(5),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type Team = z.infer<typeof TeamSchema>;

// ─── Presets ───

export const PRESET_DEBATE: Team = {
  name: "debate",
  description: "Classic debate: Advocate generates, Critic reviews, Judge finalizes.",
  agents: [
    {
      name: "advocate",
      role: "Advocate",
      model: "claude-sonnet-4-6",
      system_prompt:
        "You are the Advocate. Provide the best possible answer to the user's request. " +
        "You have file, shell, search, and web tools available. " +
        "Be strategic with tool use. When you and the Critic reach consensus, " +
        "call the summon_judge tool with the final agreed answer.",
      temperature: 0.7,
      max_tokens: 64000,
      tools_enabled: true,
    },
    {
      name: "critic",
      role: "Critic",
      model: "claude-sonnet-4-6",
      system_prompt:
        "You are the Critic. You receive an answer and find flaws, gaps, or areas for improvement. " +
        "Be CONCISE. List only the most important issues as bullet points. " +
        'If the answer is excellent, reply with: "No issues found."',
      temperature: 0.5,
      max_tokens: 2048,
      tools_enabled: false,
    },
    {
      name: "judge",
      role: "Judge",
      model: "claude-sonnet-4-6",
      system_prompt:
        "You are the Judge. Two AI models debated to produce the best answer. " +
        "Produce a polished final response. Do NOT mention the debate process.",
      temperature: 0.7,
      max_tokens: 128000,
      tools_enabled: false,
    },
  ],
  workflow: [
    { agent: "advocate", action: "generate", input_from: "user", pass_to: "next" },
    { agent: "critic", action: "critique", input_from: "previous", pass_to: "loop", max_iterations: 3 },
    { agent: "advocate", action: "generate", input_from: "previous", pass_to: "next" },
    { agent: "judge", action: "judge", input_from: "all", pass_to: "output" },
  ],
  max_rounds: 5,
};

export const PRESET_CHAIN: Team = {
  name: "chain",
  description: "Sequential chain: each agent refines the previous output.",
  agents: [
    {
      name: "drafter",
      role: "Drafter",
      model: "claude-sonnet-4-6",
      system_prompt: "You are the Drafter. Write a thorough first draft answering the user's request.",
      temperature: 0.8,
      max_tokens: 16000,
      tools_enabled: true,
    },
    {
      name: "refiner",
      role: "Refiner",
      model: "claude-sonnet-4-6",
      system_prompt:
        "You are the Refiner. Take the draft and improve clarity, accuracy, and completeness. " +
        "Output the improved version directly.",
      temperature: 0.5,
      max_tokens: 16000,
      tools_enabled: false,
    },
    {
      name: "editor",
      role: "Editor",
      model: "claude-sonnet-4-6",
      system_prompt:
        "You are the Editor. Polish the text for style, grammar, and presentation. " +
        "Output the final version directly.",
      temperature: 0.3,
      max_tokens: 16000,
      tools_enabled: false,
    },
  ],
  workflow: [
    { agent: "drafter", action: "generate", input_from: "user", pass_to: "next" },
    { agent: "refiner", action: "transform", input_from: "previous", pass_to: "next" },
    { agent: "editor", action: "transform", input_from: "previous", pass_to: "output" },
  ],
  max_rounds: 1,
};

export const PRESETS: Record<string, Team> = {
  debate: PRESET_DEBATE,
  chain: PRESET_CHAIN,
};
