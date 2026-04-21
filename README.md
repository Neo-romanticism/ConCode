# concode

Debate-driven AI proxy server. Two models argue, a judge decides, you get better answers.

## How it works

```
User Request
     │
     ▼
┌─────────┐    critique    ┌─────────┐
│ Model 1  │◄─────────────►│ Model 2  │
│ Advocate │   rebuttal    │  Critic  │
└────┬─────┘               └──────────┘
     │ consensus reached (tool call)
     ▼
┌─────────┐
│ Model 3  │──► Streamed Response
│  Judge   │
└──────────┘
```

1. **Advocate** (Model 1) generates an answer to your prompt
2. **Critic** (Model 2) reviews the answer *without seeing your original prompt* and finds flaws
3. They go back and forth until consensus — the Advocate calls `summon_judge` via tool use
4. **Judge** (Model 3) produces the final polished response, streamed to you

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
```

### Local

```bash
npm install
npm run dev
```

## Usage

concode exposes an **OpenAI-compatible** API. Use it as a drop-in replacement:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Explain quantum entanglement"}
    ],
    "stream": true,
    "concode": {
      "model_advocate": "claude-sonnet-4-20250514",
      "model_critic": "claude-sonnet-4-20250514",
      "model_judge": "claude-sonnet-4-20250514",
      "max_rounds": 5
    }
  }'
```

### Configuration

Pass concode-specific settings in the `concode` field:

| Field | Default | Description |
|-------|---------|-------------|
| `model_advocate` | `claude-sonnet-4-20250514` | Model for generating answers |
| `model_critic` | `claude-sonnet-4-20250514` | Model for critiquing answers |
| `model_judge` | `claude-sonnet-4-20250514` | Model for final output |
| `max_rounds` | `5` | Max debate rounds (1-20) |

You can mix and match models — use a cheaper model for the critic and a stronger one for the judge, for example.

## API

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint. Responses are streamed as SSE.

**Headers:**
- `Authorization: Bearer <your-anthropic-api-key>`

### `GET /health`

Health check endpoint.

## License

MIT
