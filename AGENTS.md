# Pal Code IDE — Project Summary

## Goal
Build a lightweight, local-first AI-powered code editor with LM Studio as the sole inference provider, supporting Built-in and Aider agent engines.

## Architecture (post-OpenCode removal)
```
┌─────────────────────────────────────┐
│  UI Layer (Electron + React)        │
│  Monaco · File Tree · Terminal      │
│  Chat Panel · Diff Viewer           │
│  (НИЩО AI-specific тук)             │
└──────────────┬──────────────────────┘
               │ IPC
┌──────────────▼──────────────────────┐
│  Agent Bridge Layer (Node backend)  │
│  ─────────────────────────────────  │
│  spawn/stream Aider                 │
│  LM Studio provider adapter         │
│  Tool execution layer               │
│  Context management                 │
│  Cancellation handling              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  Providers Layer                    │
│  LM Studio ←─── OpenAI-compat API   │
└─────────────────────────────────────┘
```

## Core Principle
AI is an **external drunk hacker goblin** — it proposes patches/diffs/commands, the UI decides (apply/reject/preview). Exactly how Cursor works.

## Engine Options
- **Built-in Agent** (default) — PAL IDE's native agent with tool orchestration, file editing, code search. Uses `ai-sdk-service.js` + `ai-orchestrator-service.js`.
- **Aider** — External agent spawned via CLI (`spawn("aider", ...)`). Terminal-first, uses `--message-file <tmpfile>` for Windows safety.

## Done
- **Ollama removed entirely** — All references, IPC handlers, state, UI components, settings defaults, sanitization, and engine selection removed. Engine hardcoded to `'lm-studio'`.
- **OpenCode removed entirely** — `opencode-service.js` deleted. All IPC handlers, sanitize blocks, preload bridge functions, AiAssistantPanel card, `@opencode-ai/sdk` and `opencode-ai` dependencies removed. Log files deleted.
- **AI panels corrected layout** — Sidebar `ai` tab shows `<AiVendorsPanel />` (single LM Studio vendor card). Main content shows `<AiAssistantPanel />` (unified engine config page).
- **AiAssistantPanel redesigned** — Single scrollable page with 3 Paper sections (Provider, Model, Agent Engine). Built-in + Aider shown as cards with status chips and enable switches.
- **Sidebar tab ↔ main content view sync** — `handleSidebarTabChange` maps each sidebar tab to its corresponding main view.
- **Database handlers fully implemented** — Connect, disconnect, refresh, CRUD, schema browsing, SQL execution (SELECT/PRAGMA/EXPLAIN only) all via IPC.
- **LM Studio model auto-loading** — `lm-studio-service.js` with `ensureModelLoaded()` (fire-and-forget) calls `POST /api/v1/models/load` before sending prompts. LRU cache (5s TTL).
- **System prompts rewritten** — Unified `SYSTEM_PROMPT` emphasizing tool usage. `toolChoice: 'auto'` set explicitly. `maxTokens: 8192`.
- **Token budget enforcement** — `MAX_CONTEXT_TOKENS = 16000` with message truncation (oldest-first).
- **Aider integration** — `createAiderService` spawns `aider` with `--message-file <tmpfile>` to avoid Windows shell argument splitting.
- **Database profile normalization** — `normalizeDbProfile` auto-detects SQLite from `sqlitePath` field.

## Key Decisions
- LM Studio is the sole AI provider — no Ollama, no OpenAI, no Anthropic.
- AI config is main-content page, not sidebar. Sidebar `ai` tab is for provider status only.
- Both engines shown simultaneously (no toggle) for comparison.
- `maxTokens: 8192` gives GGUF models room for tool-call JSON + reasoning.
- Model auto-loading is fire-and-forget (non-blocking). Falls back to JIT loading.
- Binary/image read error tells model to describe to user instead of failing silently.
- Aider uses temp file for message input to avoid Windows argument parsing issues.

## Current Phase (Phase 1)
Stabilize core:
- [x] LM Studio streaming (Built-in engine)
- [x] Aider spawn/stream
- [x] Tool orchestration
- [ ] Terminal panel with xterm.js
- [ ] Diff viewer UI
- [ ] File operations (read/write/patch) working reliably

## Next Phases
**Phase 2** — Controlled tools:
- Apply diff / edit file as user-triggered actions
- Search tool with approval
- Terminal command execution (with approval)

**Phase 3** — Autonomous agents:
- Aider as full agent (spawn with context)
- Multi-turn task execution
- MCP tools (only on stable foundation)

## Relevant Files
- `src/config/aiConfig.js` — `SYSTEM_PROMPT`, `MAX_CONTEXT_TOKENS = 16000`, `defaultAiSettings.engine: 'lm-studio'`. No opencode/ollama blocks.
- `src/main.js` — Sanitize/set settings, IPC handlers. `allowedAgentTypes: ['built-in', 'aider']`. Engine always `'lm-studio'`. `ai:cancel-session` routes to orchestrator only.
- `src/preload.js` — Bridge functions. No opencodeCheck/opencodeStartServer/opencodeStopServer.
- `src/renderer.jsx` — Sidebar→view sync via `handleSidebarTabChange`.
- `src/runtime/ai-sdk-service.js` — `createProvider({ settings })`, model name normalization, `maxTokens: 8192`, calls `ensureModelLoaded`.
- `src/runtime/ai-orchestrator-service.js` — Engine hardcoded `'lm-studio'`. `toolChoice: 'auto'`, token budget enforcement.
- `src/runtime/aider-service.js` — Always uses LM Studio model + API base. Spawns with `--message-file <tmpfile>`.
- `src/runtime/lm-studio-service.js` — `getLoadedModels`, `loadModel`, `unloadModel`, `ensureModelLoaded`. LM Studio REST API (`POST /api/v1/models/load`). 120s load timeout.
- `src/runtime/database/database-service.js` — Full SQL browser with pagination, schema, row count.
- `src/runtime/patch-service.js` — Search/replace blocks, unified diff, rollback.
- `src/components/sidebar/AiAssistantPanel.jsx` — 3 Paper sections (Provider, Model, Agent Engine). Built-in + Aider cards.
- `src/components/sidebar/AiVendorsPanel.jsx` — Single LM Studio vendor card.
- `src/components/chat/ChatHeaderBar.jsx` — Shows LM Studio model label only.
- `src/utils/toolRegistry.js` — 28 tool definitions with schemas.
