# void-ide -> pal-code-ide migration todo

## Goal
Strengthen PAL IDE in 4 areas:
1. File Explorer
2. AI Chat container
3. MCP tooling
4. Autonomous AI feature set (independent task execution with safe controls)

This plan prioritizes ideas/architecture first. Exact code reuse is optional and should happen only where dependencies are manageable.

---

## Priority roadmap

### P0 (do first)
- Unified tool capability contract (tool names, params, outputs, approvals)
- Safer and richer workspace file tools (browse/read/write/patch/delete)
- AI chat action orchestration upgrades (multi-step execution, retries, status tracking)
- MCP request lifecycle basics (request IDs, cancellation, timeout handling)

### P1 (next)
- File explorer scale/performance upgrades (lazy tree, search, ignore integration)
- Chat session durability (indexed persistence + trimming)
- Better autonomous planning prompts and tool-result feedback loops

### P2 (later)
- MCP trust model + stable tool name prefixes
- Prompt syntax quality-of-life features (references, slash-like commands)
- Advanced tool schema validation + diagnostics UI

---

## 1) File Explorer upgrades

### 1.1 Lazy tree and paged directory reads (P1)
**Idea from void-ide:** tool services and directory utilities are built with pagination and bounded responses.

**What to implement in PAL:**
- Add lazy node expansion API in runtime:
  - `workspaceListDir(path, page, pageSize)`
  - `workspaceReadDirTree(path, depth)`
- Keep current full-tree fallback for small repos.
- Add UI virtualized rendering for large trees.

**Why:**
- Avoid loading huge repos all at once.
- Faster initial render and lower memory use.

### 1.2 Ignore provider abstraction (P1)
**Idea from void-ide:** a provider-based ignored files service.

**What to implement in PAL:**
- Introduce `ignoredFilesProvider` interface in runtime.
- Merge from:
  - hardcoded ignored names
  - `.gitignore` patterns (later)
  - user settings overrides
- Share this in file explorer + AI context collector + search tools.

**Why:**
- Consistent behavior across explorer and AI.

### 1.3 Better file operations UX and safety (P0)
**What to implement in PAL:**
- Add preflight checks before write/delete/rename:
  - path normalization
  - root-boundary enforcement
  - extension/blocklist checks (optional)
- Add conflict handling:
  - overwrite prompt mode
  - atomic temp-write + replace
- Add operation results with structured diagnostics:
  - `{ ok, code, message, details }`

**Why:**
- More robust autonomous edits with fewer silent failures.

---

## 2) AI Chat container upgrades

### 2.1 Tool-call state machine (P0)
**Idea from void-ide:** explicit per-tool param validation and structured results.

**What to implement in PAL:**
- Convert action execution flow into explicit states:
  - `planned -> validating -> awaiting_approval -> running -> succeeded|failed|cancelled`
- Store per-step metadata:
  - retries, elapsed, output summary, error category.
- Render per-step status chips in chat UI.

**Why:**
- Debuggable autonomy, transparent behavior, easier retries.

### 2.2 Session store with index + trim (P1)
**Idea from void-ide:** indexed session persistence and storage trimming.

**What to implement in PAL:**
- Add a chat session index file (lastUpdated, title, messageCount).
- Queue writes via a sequencer to prevent race conditions.
- Keep last N sessions (configurable).

**Why:**
- Reliable persistence without unbounded storage growth.

### 2.3 Parser improvements for command-like input (P2)
**Idea from void-ide:** request parser that recognizes symbols/commands/references.

**What to implement in PAL:**
- Lightweight parser for:
  - file references in prompt
  - explicit tool hints (`/search`, `/read` style)
- Keep model-agnostic fallback behavior.

**Why:**
- Better user intent capture and higher quality autonomous plans.

---

## 3) MCP tooling upgrades

### 3.1 Request handler core (P0)
**Idea from void-ide:** MCP request handler tracks pending requests and notifications.

**What to implement in PAL:**
- Build `McpRequestHandler` with:
  - monotonic request IDs
  - pending map (`id -> deferred`)
  - cancellation signal support
  - request timeout + cleanup
  - response/error routing by request ID
  - basic notification handlers

**Why:**
- Required for reliable multi-tool MCP usage.

### 3.2 MCP registry + connection model (P1)
**Idea from void-ide:** registry abstraction for collection/server lifecycle.

**What to implement in PAL:**
- Add registry entities:
  - server definition
  - connection state
  - capabilities cache
- Add discovery from config file(s) and runtime settings.
- Add reconnect strategy with backoff.

**Why:**
- Scales from one-off MCP server to many providers.

### 3.3 Trust and naming strategy (P2)
**Idea from void-ide:** trust prompts and stable prefixes to avoid collisions.

**What to implement in PAL:**
- Per-server trust toggle with persisted state.
- Stable deterministic tool prefixing (hash-based, not random).

**Why:**
- Safer operation and less tool-name confusion in long chats.

---

## 4) Autonomous AI full-feature toolset

### 4.1 Expand built-in tools (P0)
Current PAL tools are solid, but we need full autonomy primitives.

**Target tool set:**
- `workspace_list_files` (tree + paging)
- `workspace_ls_dir` (single dir, paged)
- `workspace_search_paths` (filename/path search)
- `workspace_search_text` (regex/literal)
- `workspace_read_file` (line range + paging)
- `workspace_write_file` (full rewrite)
- `workspace_patch_file` (find/replace blocks)
- `workspace_delete_path` (file/folder with safeguards)
- `workspace_run_terminal` (approval-gated)
- `workspace_web_search` (doc lookup)
- `workspace_fetch_webpage` (extract content from selected URL)
- `workspace_get_errors` (compiler/lint diagnostics)

### 4.2 Strong validator layer for every tool (P0)
**Idea from void-ide:** dedicated per-tool param validators.

**What to implement in PAL:**
- Validate all args before execution.
- Return deterministic validation errors for model correction.
- Add max limits:
  - file size
  - output chars
  - command timeout

### 4.3 Approval policy model (P0)
**Idea from void-ide:** approval categories.

**What to implement in PAL:**
- Tool categories:
  - read-only
  - edit
  - terminal
  - external-network
- Policy modes:
  - manual
  - semi-auto (auto read-only)
  - full-auto except terminal

### 4.4 Multi-step autonomy loop (P0)
**What to implement in PAL chat loop:**
- Planner pass: discover files/context first.
- Executor pass: run tool steps.
- Verifier pass: run diagnostics/tests.
- Reporter pass: concise summary + changed files.
- Retry strategy on recoverable failures.

### 4.5 Best-practice scaffolding (P1)
**What to implement:**
- Prompt rules for:
  - minimal diffs
  - no unrelated edits
  - preserve coding style
  - run checks after edits
- Auto-inject repository conventions when available.

---

## Suggested PAL implementation targets

### Runtime / main process
- `src/main.js`
- `src/runtime/project-service.js`
- `src/runtime/workspace-service.js`
- `src/mcp-tools/mcp-tools-service.js`

### AI orchestration
- `src/components/ChatPanel.jsx`
- `src/utils/aiHelpers.js`
- `src/utils/toolRegistry.js`
- `src/utils/chatMessageState.js`
- `src/config/aiConfig.js`

### Explorer / UI
- `src/components/sidebar/FileExplorerPanel.jsx`
- `src/components/sidebar/SidebarPanel.jsx`

---

## Candidate references in void-ide
Use as architecture references first, copy selectively if dependency footprint is acceptable.

- MCP lifecycle and registry:
  - `src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts`
  - `src/vs/workbench/contrib/mcp/common/mcpRegistry.ts`
  - `src/vs/workbench/contrib/mcp/common/mcpConfigFileUtils.ts`
  - `src/vs/workbench/contrib/mcp/common/mcpRegistryInputStorage.ts`

- Tool contracts and validation patterns:
  - `src/vs/workbench/contrib/void/common/toolsServiceTypes.ts`
  - `src/vs/workbench/contrib/void/browser/toolsService.ts`

- Chat durability and supporting services:
  - `src/vs/workbench/contrib/chat/common/chatSessionStore.ts`
  - `src/vs/workbench/contrib/chat/common/ignoredFiles.ts`

---

## Exact-code reuse guidance

### Safe to partially reuse (with adaptation)
- Validator patterns
- Request handler mechanics (ID map, cancellation, response routing)
- Session store indexing and trimming logic
- JSON config mapping helpers

### Prefer idea-only (too coupled)
- Full workbench chat parser and contribution stack
- Large VS Code service/DI-dependent modules

---

## First implementation sprint (recommended)

1. [x] Upgrade `toolRegistry` to include:
  - [x] explicit tool categories
  - [x] validation error codes
  - [x] execution limits

2. [x] Add `workspace_search_text` and `workspace_get_errors` tool actions.

3. [x] Refactor ChatPanel action loop into state-machine steps with retry metadata.

4. [x] Introduce MCP request handler skeleton with pending map, timeout, cancellation.

5. [x] Improve File Explorer backend APIs with paged directory listing.

---

## Definition of done
- AI can independently:
  - discover project files
  - read relevant code
  - propose and apply edits
  - run checks (when approved)
  - search docs/web when needed
  - report result with clear evidence
- MCP calls are resilient and observable.
- File explorer remains responsive in medium/large workspaces.
- Safety policies prevent unintended destructive actions.

---

## One-run conformance hardening
- [x] Block destructive terminal command patterns in `workspace_terminal_command` validation (`UNSAFE_OPERATION_BLOCKED`).
