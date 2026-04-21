import Anthropic from "@anthropic-ai/sdk";

/**
 * Tool that Model 1 (advocate) and Model 2 (critic) can call
 * when they reach consensus. This triggers the judge phase.
 */
export const summonJudgeTool: Anthropic.Tool = {
  name: "summon_judge",
  description:
    "Call this tool when you and the other party have reached a consensus. " +
    "Provide the agreed-upon final answer that the judge should use to produce the output.",
  input_schema: {
    type: "object" as const,
    properties: {
      consensus_answer: {
        type: "string",
        description: "The final agreed-upon answer after debate.",
      },
      key_improvements: {
        type: "string",
        description:
          "Summary of key improvements made during the debate compared to the original answer.",
      },
    },
    required: ["consensus_answer", "key_improvements"],
  },
};
