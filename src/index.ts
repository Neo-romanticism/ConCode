import express from "express";
import chatRouter from "./routes/chat.js";
import { SERVER_PORT } from "./config.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "concode" });
});

// OpenAI-compatible chat endpoint
app.use(chatRouter);

app.listen(SERVER_PORT, () => {
  console.log(`🧠 concode is running on port ${SERVER_PORT}`);
  console.log(`   POST /v1/chat/completions — OpenAI-compatible endpoint`);
  console.log(`   GET  /health              — Health check`);
});
