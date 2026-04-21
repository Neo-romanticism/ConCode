import "dotenv/config";
import readline from "readline";
import { RequestConfigSchema } from "./config.js";
import { runDebate } from "./core/debate.js";
import { judgeStream } from "./core/judge.js";

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
if (!apiKey) {
  console.error("❌ ANTHROPIC_API_KEY not found. Create a .env file with your key.");
  process.exit(1);
}

const config = RequestConfigSchema.parse({
  model_advocate: process.env.MODEL_ADVOCATE,
  model_critic: process.env.MODEL_CRITIC,
  model_judge: process.env.MODEL_JUDGE,
  max_rounds: process.env.MAX_ROUNDS ? parseInt(process.env.MAX_ROUNDS) : undefined,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("🧠 concode — debate-driven AI");
console.log(`   Advocate: ${config.model_advocate}`);
console.log(`   Critic:   ${config.model_critic}`);
console.log(`   Judge:    ${config.model_judge}`);
console.log(`   Rounds:   max ${config.max_rounds}`);
console.log('   Type "exit" to quit.\n');

function prompt() {
  rl.question("You > ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "exit") {
      console.log("👋");
      rl.close();
      process.exit(0);
    }

    try {
      process.stdout.write("\n⏳ Debating...\n");

      const userMessages = [{ role: "user" as const, content: trimmed }];
      const debateResult = await runDebate(apiKey, userMessages, undefined, config);

      process.stdout.write(`✅ Consensus after ${debateResult.rounds} round(s)\n\n`);

      const chunks = judgeStream(apiKey, config.model_judge, userMessages, undefined, debateResult);

      for await (const text of chunks) {
        process.stdout.write(text);
      }

      process.stdout.write("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Error: ${message}\n`);
    }

    prompt();
  });
}

prompt();
