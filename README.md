# concode

커스텀 AI 에이전트 팀을 정의하고, API 하나로 호출하는 오픈소스 서비스.

## 원리

```
사용자 요청
     │
     ▼
┌─────────────────────────────────────┐
│         Team Orchestrator           │
│                                     │
│  ┌─────────┐  ┌─────────┐  ┌────┐  │
│  │ Agent 1  │→ │ Agent 2  │→ │ ...│  │
│  │ (custom) │  │ (custom) │  │    │  │
│  └─────────┘  └─────────┘  └────┘  │
│                                     │
│  워크플로우: generate → critique     │
│              → transform → output   │
└──────────────────┬──────────────────┘
                   │
                   ▼
            스트리밍 응답 (SSE)
```

에이전트마다 역할, 모델, 시스템 프롬프트, 도구 사용 여부를 설정할 수 있고,
워크플로우로 실행 순서와 루프를 정의합니다.

## 빠른 시작

```bash
git clone https://github.com/Neo-romanticism/concode.git
cd concode
npm install
npm run build

# API 키 설정
echo "ANTHROPIC_API_KEY=sk-ant-여기에키" > .env

# 서버 시작
npm start
```

## API 엔드포인트

### 팀 관리

```bash
# 팀 목록 (프리셋 + 커스텀)
curl http://localhost:3000/v1/teams

# 프리셋 목록
curl http://localhost:3000/v1/teams/presets

# 커스텀 팀 생성
curl -X POST http://localhost:3000/v1/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-review",
    "description": "코드 리뷰 팀",
    "agents": [
      {
        "name": "coder",
        "role": "Coder",
        "model": "claude-sonnet-4-6",
        "system_prompt": "You are a senior developer. Write clean, efficient code.",
        "tools_enabled": true
      },
      {
        "name": "reviewer",
        "role": "Reviewer",
        "model": "claude-sonnet-4-6",
        "system_prompt": "You are a code reviewer. Find bugs, security issues, and suggest improvements. Be concise.",
        "tools_enabled": false
      },
      {
        "name": "finalizer",
        "role": "Finalizer",
        "model": "claude-sonnet-4-6",
        "system_prompt": "You produce the final polished code incorporating all review feedback. Output code directly.",
        "tools_enabled": false
      }
    ],
    "workflow": [
      { "agent": "coder", "action": "generate", "input_from": "user", "pass_to": "next" },
      { "agent": "reviewer", "action": "critique", "input_from": "previous", "pass_to": "next" },
      { "agent": "finalizer", "action": "transform", "input_from": "all", "pass_to": "output" }
    ]
  }'

# 팀 조회
curl http://localhost:3000/v1/teams/{team_id}

# 팀 수정
curl -X PUT http://localhost:3000/v1/teams/{team_id} \
  -H "Content-Type: application/json" \
  -d '{ ... }'

# 팀 삭제
curl -X DELETE http://localhost:3000/v1/teams/{team_id}
```

### 채팅 (팀 실행)

```bash
# 커스텀 팀으로 실행
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "team": "team_abc123",
    "messages": [{"role": "user", "content": "FizzBuzz를 Rust로 작성해줘"}]
  }'

# 프리셋 팀으로 실행
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "team": "debate",
    "messages": [{"role": "user", "content": "양자 컴퓨팅 설명해줘"}]
  }'

# 프리셋: chain (순차 정제)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "team": "chain",
    "messages": [{"role": "user", "content": "마이크로서비스 아키텍처 가이드 작성해줘"}]
  }'

# 레거시 모드 (team 없이 — 기존 debate 방식)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "안녕"}]}'
```

API 키는 `.env`에서 읽거나, 헤더로 오버라이드:
`Authorization: Bearer sk-ant-...`

## 프리셋 팀

| 이름 | 설명 | 에이전트 |
|------|------|---------|
| `debate` | Advocate가 답변 → Critic이 비판 → 루프 → Judge가 최종 정리 | advocate, critic, judge |
| `chain` | Drafter → Refiner → Editor 순차 정제 | drafter, refiner, editor |

## 에이전트 설정

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `name` | string | (필수) | 에이전트 식별자 |
| `role` | string | (필수) | 역할 이름 |
| `model` | string | `claude-sonnet-4-6` | 사용할 모델 |
| `system_prompt` | string | (필수) | 시스템 프롬프트 |
| `temperature` | number | `0.7` | 온도 (0-1) |
| `max_tokens` | number | `8192` | 최대 토큰 |
| `tools_enabled` | boolean | `false` | 도구 사용 여부 |

## 워크플로우 스텝

| 필드 | 타입 | 설명 |
|------|------|------|
| `agent` | string | 실행할 에이전트 이름 |
| `action` | enum | `generate` `critique` `judge` `transform` |
| `input_from` | enum | `user` (원본) `previous` (이전 출력) `all` (전체 히스토리) |
| `pass_to` | enum | `next` (다음 스텝) `loop` (반복) `output` (최종 출력) |
| `max_iterations` | number | `loop`일 때 반복 횟수 |

## 사용 가능한 도구 (tools_enabled: true)

| 카테고리 | 도구 |
|---------|------|
| 파일 | `read_file` `write_file` `edit_file` `delete_file` `move_file` `copy_file` |
| 디렉토리 | `list_files` `directory_tree` `file_info` |
| 검색 | `grep_search` |
| 셸 | `run_shell` |
| 웹 | `web_fetch` `web_search` |

## CLI

```bash
# 글로벌 설치 후
npm link

# 아무 프로젝트에서
concode

# 키 설정
concode --set-key sk-ant-...
```

CLI는 기존 debate 모드로 동작합니다. `!`를 붙이면 fast mode.

## Docker

```bash
docker compose up --build
```

## 설정

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `ANTHROPIC_API_KEY` | — | Anthropic API 키 |
| `PORT` | `3000` | 서버 포트 |
| `CONCODE_STORE_DIR` | `.concode/teams` | 팀 설정 저장 경로 |

## License

MIT
