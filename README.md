# PAL Code IDE

PAL Code IDE is a desktop coding environment built with Electron + React, designed to combine editor workflows with an integrated local AI runtime.

The app currently provides a VSCode-inspired shell, workspace navigation, source control tools, database browsing, and local Llama runtime management.

## Current Features

- Custom IDE chrome:
  - Frameless, VSCode-style title bar with menu groups and window controls
  - Window opens maximized by default
- Runtime bootstrap:
  - One-time AppData runtime provisioning for llama-server and models
  - Progress modal with cancel support
- Llama runtime controls:
  - Start/Stop server from the UI
  - Runtime status polling and feedback
- Code editor + terminal:
  - Monaco editor workspace panel
  - Integrated xterm terminal pane
  - Inline ghost text autocomplete support (Tab accept)
- Sidebar tools:
  - File Explorer (project tree + file open)
  - Git Explorer (status + commit flow)
  - Database Explorer (MySQL connection + table discovery)
- Database viewer:
  - Table data grid using TanStack table primitives
  - Fetch table rows with metadata
  - Inline row delete
  - Add Row modal for inserts
- Status telemetry:
  - Hardware VRAM metrics in footer
  - Model token/context metrics display
- MCP-style utility tools:
  - Terminal execution bridge in workspace root
  - DuckDuckGo search bridge

## Tech Stack

- Electron Forge + Vite
- React 18 + Tailwind CSS
- Monaco Editor (`@monaco-editor/react`)
- xterm (`@xterm/xterm` + `@xterm/addon-fit`)
- MySQL client (`mysql2`)
- Data grid primitives (`@tanstack/react-table`)
- Git integration (`simple-git`)
- Hardware metrics (`systeminformation`)

## Getting Started

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

Create or update `.env` using `.env.example` as reference.

Typical runtime variables include:

- `PAL_LLAMA_BINARY_FLAVOR` (`auto`, `cuda`, `cpu`, `vulkan`)
- `PAL_LLAMA_SERVER_PATH` (optional override)
- `PAL_LLAMA_MODEL_PATH` (optional override)
- `PAL_LLAMA_HOST` / `PAL_LLAMA_PORT`
- `HF_TOKEN` (optional, for Hugging Face)

## 3. Start the app

```bash
npm start
```

## Build & Package

```bash
npm run package
npm run make
```

## Project Structure

- `src/main.js`: Electron main process orchestration and IPC handlers
- `src/preload.js`: secure renderer bridge (`window.palRuntime`)
- `src/renderer.jsx`: app shell and layout composition
- `src/runtime/`: runtime/bootstrap/workspace/project services
- `src/llama-server/`: llama service lifecycle and readiness checks
- `src/components/`: UI modules (editor, sidebar, database, chrome)

## Notes

- This project is actively evolving toward a richer VSCode-like UX.
- Current focus is functional modularity and local-runtime reliability.
