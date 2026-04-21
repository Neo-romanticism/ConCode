# concode

두 AI가 토론하고, 판사가 결론 내리는 프록시 서버 & CLI.

## 원리

```
사용자 요청
     │
     ▼
┌──────────┐   비판    ┌──────────┐
│  Model 1  │◄────────►│  Model 2  │
│  Advocate │  반박    │  Critic   │
└─────┬─────┘          └───────────┘
      │ 합의 → summon_judge tool call
      ▼
┌──────────┐
│  Model 3  │──► 스트리밍 응답
│   Judge   │
└───────────┘
```

Advocate는 14개 tool(파일 읽기/쓰기/수정/삭제, 셸 실행, 웹 검색 등)을 사용할 수 있어서
코드를 직접 읽고 수정하는 것도 가능합니다.

## 시작하기

```bash
# 1. 설치 (글로벌)
git clone https://github.com/Neo-romanticism/concode.git
cd concode
npm install
npm run build
npm link

# 2. 아무 프로젝트 폴더에서
cd ~/my-project
echo "ANTHROPIC_API_KEY=sk-ant-여기에키" > .env

# 3. 실행
concode
```

또는 concode 폴더 안에서 `npm run chat`으로도 실행 가능합니다.

## CLI 사용 예시

```
🧠 concode — debate-driven AI
   Advocate: claude-sonnet-4-20250514
   Critic:   claude-sonnet-4-20250514
   Judge:    claude-sonnet-4-20250514

You > 양자 얽힘 설명해줘
⏳ Debating...
✅ Consensus after 3 round(s)
(스트리밍 응답)

You > src/index.ts 읽어서 포트 8080으로 바꿔줘
⏳ Debating...
  🔧 read_file: src/index.ts
  🔧 edit_file: src/index.ts
✅ Consensus after 2 round(s)
(스트리밍 응답)

You > npm run build 실행해봐
⏳ Debating...
  🔧 run_shell: npm run build
✅ Consensus after 1 round(s)
(스트리밍 응답)

You > exit
👋
```

## API 서버로 쓰기

```bash
# 서버 시작
npm run build
npm start

# 요청 (OpenAI 호환)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "안녕"}]}'
```

API 키는 `.env`에서 읽습니다. 헤더로 다른 키를 보내면 오버라이드 가능:
`Authorization: Bearer sk-ant-...`

## 설정

`.env` 파일 또는 요청 body의 `concode` 필드로 설정:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | — | Anthropic API 키 |
| `MODEL_ADVOCATE` | `claude-sonnet-4-20250514` | 답변 생성 모델 |
| `MODEL_CRITIC` | `claude-sonnet-4-20250514` | 비판 모델 |
| `MODEL_JUDGE` | `claude-sonnet-4-20250514` | 최종 판정 모델 |
| `MAX_ROUNDS` | `5` | 최대 토론 라운드 (1-20) |
| `PORT` | `3000` | 서버 포트 |

## Docker

가상화가 지원되는 환경에서:

```bash
docker compose up --build
```

## 사용 가능한 도구 (Advocate)

| 카테고리 | 도구 |
|---------|------|
| 파일 | `read_file` `write_file` `edit_file` `delete_file` `move_file` `copy_file` |
| 디렉토리 | `list_files` `directory_tree` `file_info` |
| 검색 | `grep_search` |
| 셸 | `run_shell` |
| 웹 | `web_fetch` `web_search` |

## License

MIT
