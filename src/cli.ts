#!/usr/bin/env node
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs";

// 홈 디렉토리 fallback
if (!process.env.ANTHROPIC_API_KEY) {
  dotenv.config({ path: path.join(os.homedir(), ".concode", ".env") });
}

// --set-key: 키 저장하고 종료
const args = process.argv.slice(2);
if (args[0] === "--set-key" && args[1]) {
  const dir = path.join(os.homedir(), ".concode");
  const envPath = path.join(dir, ".env");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(envPath, `ANTHROPIC_API_KEY=${args[1]}\n`);
  console.log(`✅ Key saved to ${envPath}`);
  process.exit(0);
}

import readline from "readline";
import { RequestConfigSchema } from "./config.js";
import { runDebate } from "./core/debate.js";
import { judgeStream } from "./core/judge.js";

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
if (!apiKey) {
  console.error("❌ ANTHROPIC_API_KEY not found.");
  console.error("   Set it once: concode --set-key sk-ant-...");
  console.error("   Or create .env in current folder or ~/.concode/.env");
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
      const debateResult = await runDebate(apiKey, userMessages, undefined, config, (name, input) => {
        const detail = input.path ?? input.command ?? input.query ?? input.url ?? input.pattern ?? "";
        process.stdout.write(`  🔧 ${name}${detail ? `: ${detail}` : ""}\n`);
      });

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
