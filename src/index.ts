import "dotenv/config";
import express from "express";
import chatRouter from "./routes/chat.js";
import teamsRouter from "./routes/teams.js";
import { SERVER_PORT } from "./config.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "concode", version: "0.2.0" });
});

// API routes
app.use(chatRouter);
app.use(teamsRouter);

app.listen(SERVER_PORT, () => {
  console.log(`🧠 concode v0.2.0 — customizable agent teams`);
  console.log(`   POST /v1/chat/completions — Chat (with optional team)`);
  console.log(`   GET  /v1/teams            — List teams`);
  console.log(`   POST /v1/teams            — Create team`);
  console.log(`   GET  /v1/teams/:id        — Get team`);
  console.log(`   PUT  /v1/teams/:id        — Update team`);
  console.log(`   DEL  /v1/teams/:id        — Delete team`);
  console.log(`   GET  /v1/teams/presets     — List presets`);
  console.log(`   GET  /health              — Health check`);
  console.log(`   Port: ${SERVER_PORT}`);
});
