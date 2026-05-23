# PAL Code IDE — Internal Documentation

## Overview

PAL Code IDE is an Electron + React desktop coding environment with VSCode-inspired shell, workspace navigation, source control, database browsing, and integrated local AI runtime (llama-server / LM Studio). It targets "vibe coding" and agent-assisted development workflows.

**package.json:** `pal-code` v1.0.0. Electron Forge + Vite build pipeline.

---

## Architecture

### Process Model (Electron)

```
┌─────────────────────────────────────────────────────┐
│                   Main Process                       │
│  src/main.js                                         │
│  ├── Window creation (frameless, maximized)          │
│  ├── IPC handlers (150+ channels)                    │
│  ├── Service composition                             │
│  ├── Hardware monitor (VRAM polling every 2s)        │
│  ├── Terminal sessions (node-pty)                    │
│  └── chokidar workspace watcher                      │
├─────────────────────────────────────────────────────┤
│                  Preload Bridge                       │
│  src/preload.js                                       │
│  ├── contextBridge.exposeInMainWorld('palRuntime')    │
│  └── contextBridge.exposeInMainWorld('electronAPI')   │
├─────────────────────────────────────────────────────┤
│                  Renderer Process                     │
│  src/renderer.jsx (React 18 root)                     │
│  ├── App component (layout orchestrator)              │
│  ├── EditorPanel (Monaco + xterm)                    │
│  ├── ChatPanel (AI chat + workspace tooling)          │
│  ├── SidebarPanel + sub-panels                       │
│  ├── DatabaseViewerPanel                             │
│  ├── IdeTitleBar (frameless chrome)                  │
│  ├── GitWorkspacePanel / GitDiffPanel                │
│  └── AiAssistantPanel (settings)                     │
└─────────────────────────────────────────────────────┘
```

### Service Composition (`src/main.js:414-430`)

| Service | File | Purpose |
|---------|------|---------|
| `workspaceService` | `src/runtime/workspace-service.js` | Workspace root resolution & validation |
| `runtimeBootstrapService` | `src/runtime/bootstrap-service.js` | Downloads/extracts llama-server + models |
| `projectService` | `src/runtime/project-service.js` | File tree, git operations via `simple-git` |
| `databaseService` | `src/runtime/database/database-service.js` | MySQL/SQLite connectivity |
| `llamaService` | `src/llama-server/llama-service.js` | llama-server process lifecycle |
| `mcpToolsService` | `src/mcp-tools/mcp-tools-service.js` | Terminal execution + web search bridges |

---

## Main Process (`src/main.js`)

### Persistent Stores (electron-store)

Stored under `AppData/Roaming/Pal Code/settings/`:

| Store | File | Purpose |
|-------|------|---------|
| `dbProfilesStore` | `pal-code-ide-store` | Saved database connections (encrypted) |
| `appearanceStore` | `appearance` | Pane dimensions (sidebar, chat, terminal) |
| `aiAssistantStore` | `ai-assistant` | Engine selection, role mappings, LM Studio config |
| `workspaceHistoryStore` | `workspace-history` | Last/recent workspace paths |

### Key IPC Handler Groups

1. **Workspace** — file read/write/patch/delete/rename/copy/search/diagnostics, `normalizeWorkspaceFilePath` enforces path containment
2. **Git** — status, stage/unstage, commit, revert, diff — delegates to `projectService` which wraps `simple-git`
3. **Database** — connect (MySQL/SQLite), list tables, CRUD rows, save/load connection profiles
4. **Terminal** — create, send input, resize, close, restart — `node-pty` with `powershell.exe` on Windows
5. **Llama** — status, start, stop — delegates to `llamaService`
6. **Window** — minimize, toggleMaximize, close, isMaximized
7. **AI** — get/set assistant settings, check local models, check/install llama-server versions, LM Studio model listing
8. **MCP Tools** — `mcp:terminalExecute`, `mcp:duckduckgoSearch` — used by the chat agent
9. **Chat** — save/load chat sessions to `AppData/Roaming/Pal Code/data/pal-chats/`

### Terminal Sessions

- Managed in `terminalSessions` Map keyed by `terminal-<counter>`.
- Spawns `powershell.exe -NoLogo` (Windows) with `node-pty`.
- Output streamed via IPC `terminal-get-output` to renderer.
- On workspace root change, all terminals are re-initialized in the new directory.
- Cleanup on `before-quit`.

### Hardware Monitor

- Polls `nvidia-smi` (via `systeminformation`) every 2 seconds.
- Falls back to generic graphics info if NVIDIA SMI unavailable.
- Broadcasts `runtime:hardwareMetrics` to renderer.

---

## Preload Bridge (`src/preload.js`)

Two contextBridge groups:

### `window.palRuntime` (~70 methods)

All async IPC invoke wrappers. Covers:
- Workspace: root, file CRUD, search, diagnostics
- Git: status, commit, stage, unstage, revert, diff
- Database: connect, tables, CRUD rows, profiles
- Terminal: create, send, resize, close, restart
- Llama: status, start, stop
- AI: settings, local models, LM Studio models, download server
- Window: minimize, maximize, close
- MCP: terminalExecute, duckduckgoSearch
- Event subscriptions (6x on* listeners returning unsubscribe functions)

### `window.electronAPI` (~5 methods)

- `sendTerminalInput`, `saveCurrentFile`, `saveChatSession`, `loadChatSession`
- `onDiskChanged` (chokidar file change listener)

---

## Renderer Process (`src/renderer.jsx`)

### App Component

Root layout state machine managing:
- `activeView`: `'editor' | 'database' | 'git' | 'git-diff' | 'ai'`
- Tab management: open tabs with preview/pin behavior, dirty tracking
- Pane dimensions: sidebar/chat/terminal resize with persistence
- Boostrap modal: runtime provisioning progress
- Command palette overlay
- Footer: VRAM bar, tokens/sec, context usage

### EditorPanel (`src/components/EditorPanel.jsx`)

- Monaco editor with inline ghost-text autocomplete
  - FIM-style prompts for code (`<|fim_prefix|>`)
  - Text-style prompts for non-code files
  - Post-processes suggestions via `normalizeSuggestionPayload`
- Terminal pane with xterm.js
  - Multi-terminal tabs, FitAddon for resize
  - Custom key handler (Ctrl+C copy, Ctrl+V paste)
  - Resize drag handle
- Tab bar with preview/pin, dirty indicators

### ChatPanel (`src/components/ChatPanel.jsx`)

Core AI interaction component:
- **Engine support:** llama-server (default) or LM Studio
- **Tool loop:** native function tools (LM Studio `/v1/responses`) or fallback JSON fenced blocks (`pal-workspace-action`)
- **Autonomous retry:** on recoverable failures — searches for alternative paths when file not found, re-reads files before re-applying patches, retries terminal commands once
- **Workspace path index:** maintains a Set of known paths to block hallucinated file targets; built from shared `buildPathIndexFromTree` utility
- **Action lifecycle tracking:** `planned → validating → awaiting_approval → running → succeeded/failed/cancelled` with per-step retry, elapsed time, and error category metadata
- **Session persistence:** auto-saves/restores messages to `pal-chats/default.json`
- **Web search command:** `/web <query>` triggers DuckDuckGo search and prepends results
- **Auto-approval modes:** `manual`, `safe` (read-only), `all` (all except terminal)

### Sidebar Panels (`src/components/sidebar/`)

| Panel | File | Purpose |
|-------|------|---------|
| `ActivityBar` | `ActivityBar.jsx` | Icon toolbar (Files, Git, AI, Database) |
| `SidebarPanel` | `SidebarPanel.jsx` | Sidebar container/switch |
| `FileExplorerPanel` | `FileExplorerPanel.jsx` | `react-arborist` tree view, context menu (Right-click: new/rename/delete/copy/cut/paste/reveal) |
| `GitExplorerPanel` | `GitExplorerPanel.jsx` | Staged/unstaged file lists, commit message input |
| `DatabaseExplorerPanel` | `DatabaseExplorerPanel.jsx` | Connection form, saved profiles, table list |
| `AiAssistantPanel` | `AiAssistantPanel.jsx` | Engine selector, role mappings, flavor selection, LM Studio config, model download |
| `AiVendorsPanel` | `AiVendorsPanel.jsx` | (separate vendor config panel) |

### Database Viewer (`src/components/database/DatabaseViewerPanel.jsx`)

- TanStack table with column sorting, row selection
- Tabbed table views (one per table)
- Insert row modal, inline row delete
- MySQL and SQLite support

### Chrome (`src/components/chrome/IdeTitleBar.jsx`)

- Frameless, VSCode-style title bar
- Menu: File, Edit, View, Git, Database, Help
- Window controls, recent workspaces dropdown
- Chat toggle and layout reset

---

## AI/LLM Integration

### Engine Configuration (`src/config/aiConfig.js`)

- Default endpoint: `http://127.0.0.1:1234`
- System prompts: concise, coding-focused
- `WORKSPACE_TOOLING_PROMPT`: detailed instructions for the model about tool usage, action block format, and behavior rules

### Chat Flow (`src/utils/aiHelpers.js`)

1. **Outbound:** `toTransportMessages` builds message array with system prompt + history window (last 8) + user prompt
2. **File context:** `buildReferencedFileContext` auto-reads files mentioned in the prompt
3. **Workspace context:** `buildWorkspaceContext` injects tree when project-related keywords detected
4. **Streaming:** `requestOpenAiStyleChat` handles SSE with `data:` lines, supports `<think>...</think>` tag parsing
5. **Native tools:** `requestOpenAiResponsesWithTools` uses `/v1/responses` API with function calling (LM Studio only)
6. **Action parsing:** `parseWorkspaceActionBlocks` extracts JSON blocks from markdown fences

### Workspace Tools (`src/utils/toolRegistry.js`)

12 tools defined as OpenAI function definitions:

| Tool Name | Action Type | Approval | Limits |
|-----------|------------|----------|--------|
| `workspace_list_files` | list-files | read-only | 15000 nodes |
| `workspace_read_file` | read-file | read-only | 512 path, 250k chars |
| `workspace_search_text` | search-text | read-only | 1200 query, 200 results |
| `workspace_search_paths` | search-paths | read-only | 512 pattern, 5000 results |
| `workspace_ls_dir` | ls-dir | read-only | 512 path, 5000 results |
| `workspace_get_errors` | get-errors | read-only | 512 path, 200 issues |
| `workspace_fetch_webpage` | fetch-webpage | external-network | 2048 URL, 50k chars |
| `workspace_write_file` | write-file | edit | 512 path, 500k chars |
| `workspace_patch_file` | patch-file | edit | 512 path, 80 patches |
| `workspace_delete_file` | delete-file | edit | 512 path |
| `workspace_terminal_command` | terminal-command | terminal | 8000 chars, 600s timeout |
| `workspace_web_search` | web-search | external-network | 800 query, 12 results |

Safety: terminal commands are checked against `UNSAFE_TERMINAL_PATTERNS` (rm -rf /, format, diskpart, etc.)

### New Tools Detail

**`workspace_search_paths` (search-paths):**
- Glob-based file path search within workspace root
- Supports `*`, `**`, `?` glob patterns; falls back to substring match on invalid patterns
- Implementation: `searchWorkspacePaths` + `simpleGlobMatch` in `src/main.js`
- IPC channel: `workspace:search-paths`

**`workspace_ls_dir` (ls-dir):**
- Lists directory contents (files/subdirectories, non-recursive)
- Uses the same file tree walk as the sidebar explorer
- IPC channel: `workspace:list-directory`

**`workspace_fetch_webpage` (fetch-webpage):**
- Fetches and strips web page content for AI consumption
- Strips `<nav>`, `<header>`, `<footer>`, `<script>`, `<style>` blocks
- Extracts `<title>`, returns up to 50k chars
- 15s timeout with abort controller
- Implementation: `fetchWebpage` in `src/mcp-tools/mcp-tools-service.js`
- IPC channel: `workspace:fetch-webpage`

### Autocomplete (`src/components/EditorPanel.jsx`)

- Triggered on content change and cursor move (400ms debounce)
- Non-code files: text completion via system prompt (max 10 words)
- Code files: FIM infill with `<|fim_prefix|><|fim_suffix|><|fim_middle|>`
- Tab key accepts inline suggestion

---

## Workspace Services

### bootstrap-service.js

Downloads and installs:
- **llama-server** — picks Windows ZIP from latest GitHub release, selects flavor (CUDA/Vulkan/CPU) based on GPU detection or `PAL_LLAMA_BINARY_FLAVOR` env
- **Models** — resolves Qwen 2.5 Coder 14B and VL 7B from Hugging Face with fallback repos and auth token support
- Reports progress to renderer via IPC (`runtime:downloadProgress`)

### llama-service.js

- Spawns `llama-server.exe` with `--host`, `--port`, optional `--model`
- Readiness check: port open + `/health` endpoint + output scan for "listening on"
- Auto-starts on first chat message if engine is llama-server
- Timeout: 180s for model loading

### project-service.js

- File tree: synchronous walk, ignores `.git`/`node_modules`/`.vite`/`dist`/`out` (uses shared constants)
- Git: wraps `simple-git` for status, add, commit, reset, checkout, diff

### database-service.js (`src/runtime/database/database-service.js`)

- MySQL via `mysql2` (connection pooling)
- SQLite via `better-sqlite3` (expected but not fully confirmed in code)
- Table listing, CRUD operations

### mcp-tools-service.js

- `executeTerminalTool`: spawns cmd/powershell with timeout and `killProcessTree` on abort
- `duckduckgoSearch`: scrapes `duckduckgo.com/html/` HTML results
- `fetchWebpage`: fetches URL content, strips non-content HTML, returns up to 50k chars with 15s timeout

---

## Shared Modules

### `src/shared/workspace-constants.js`

Exports `WORKSPACE_IGNORED_NAMES` — a `Set` of directory/file names to exclude from workspace operations: `.git`, `node_modules`, `.vite`, `dist`, `out`, `.next`, `.cache`, `__pycache__`, `.venv`, etc.

Used by:
- `src/main.js` — workspace file search
- `src/runtime/project-service.js` — file tree walk

### `src/shared/path-index.js`

Exports two utilities for building workspace path indexes:

- **`buildPathIndexFromTree(tree)`** — takes a file tree array (from `workspace_list_files`) and returns `{ ready: true, files: Set<string>, directories: Set<string> }` with normalized paths (lowercase, forward slashes, no leading/trailing slashes)
- **`normalizeIndexPath(value)`** — single-path normalization helper

Used by:
- `src/components/ChatPanel.jsx` — `buildWorkspacePathIndex` and `hydrateWorkspacePathIndex`

Avoids duplication: both the main chat flow and the hydration function use the same walk logic.

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PAL_LLAMA_BINARY_FLAVOR` | `auto` | `auto`, `cpu`, `cuda`, `vulkan` |
| `PAL_LLAMA_SERVER_PATH` | — | Override llama-server executable path |
| `PAL_LLAMA_MODEL_PATH` | — | Override model file path |
| `PAL_LLAMA_HOST` | `127.0.0.1` | Bind address |
| `PAL_LLAMA_PORT` | `1234` | Bind port |
| `PAL_LLAMA_EXTRA_ARGS` | — | Additional CLI args for llama-server |
| `HF_TOKEN` / `HUGGINGFACE_TOKEN` | — | Hugging Face auth for gated models |
| `PAL_STORE_ENCRYPTION_KEY` | hardcoded fallback | electron-store encryption key |

### Runtime Paths

```
{userData}/
├── llama-server/
│   ├── active.json          # Points to active executable
│   ├── cpu/llama-server.exe
│   ├── cuda/llama-server.exe
│   └── vulkan/llama-server.exe
├── models/
│   ├── Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf
│   └── Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf
├── temp/
└── settings/
    ├── pal-code-ide-store.json
    ├── appearance.json
    ├── ai-assistant.json
    └── workspace-history.json
```

---

## Build & Package (Electron Forge)

- `npm start` — dev mode with Vite HMR
- `npm run package` — Forge packaging
- `npm run make` — Installer generation
- `patch-package` runs on `postinstall`
- DevTools blocked in production (`src/main.js:2210`)
- Vite configs: `vite.main.config.mjs`, `vite.renderer.config.mjs`, `vite.preload.config.mjs`
- Tailwind via `tailwind.config.cjs` + `postcss.config.cjs`
- JavaScript obfuscation via `vite-plugin-javascript-obfuscator`

---

## TypeScript Types (`src/types/runtime.d.ts`)

Global `Window` extension with full type definitions for:
- `palRuntime` — all IPC invoke methods + event listeners (615 lines)
- `electronAPI` — terminal input, file save, chat session, disk change listener

---

## Key Code Patterns

- **IPC handlers** return structured `{ ok, error }` or `{ ok, data }` consistently
- **Path safety:** all workspace file operations go through `normalizeWorkspaceFilePath`/`normalizeWorkspaceNodePath` which enforce path containment within workspace root
- **Chat state management:** pure functions (`updateMessageById`, `finishMessageById`, `upsertExecutionStepInMessage`) for immutable message updates
- **AI action approval:** `shouldAutoApproveAction` with 3-tier policy; chat uses `all` mode (approves everything except terminal)
- **Hallucination guard:** workspace path index tracks known files/dirs; blocks `read-file`/`patch-file`/`delete-file` on unknown paths
