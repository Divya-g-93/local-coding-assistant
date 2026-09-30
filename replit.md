# Local Dev Assistant

A local-first coding assistant for explaining code, generating tests, troubleshooting errors, and reviewing proposed fixes without sending project files to cloud AI.

## Run & Operate

- `pnpm --filter @workspace/local-dev-assistant run dev:local` — run the app on `http://localhost:5173`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- See `artifacts/local-dev-assistant/LOCAL_SETUP.md` for local Ollama setup.
- Do not publish the preview as a substitute for local installation when the user requires end-to-end local operation.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- Model runtime: Ollama on the user's loopback interface
- No app API, database, cloud AI provider, analytics, or remote file storage

## Where things live

- `artifacts/local-dev-assistant/src/lib/local-files.ts` — browser-local file selection, indexing, and guarded writes
- `artifacts/local-dev-assistant/src/lib/local-model.ts` — loopback-only Ollama connection, chat, and patch proposals
- `artifacts/local-dev-assistant/LOCAL_SETUP.md` — local install and privacy setup
- `artifacts/local-dev-assistant/src/App.tsx` and `src/index.css` — assistant interface

## Architecture decisions

- Source content is read by the browser and sent only to a loopback Ollama endpoint; model requests are disabled outside localhost.
- Folder access is user-initiated. Generated changes must be reviewed and approved before a guarded local write.
- The Replit preview is for UI development only and is not the secure local runtime.

## Product

Developers can select local folders and files, ask for explanations, generate tests, troubleshoot errors, and review/apply proposed code fixes. Files and conversations remain in browser memory for the session.

## User preferences

- The assistant must run on each developer's local machine; source data must not be sent over the internet.

## Gotchas

- Ollama must allow the app's exact localhost origins in `OLLAMA_ORIGINS`; do not recommend `*`.
- File selection does not imply every binary format is decoded. Unsupported binaries are attached with metadata only.
- Keep the local model URL loopback-only and do not add hosted inference, remote logging, telemetry, or automatic code execution.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
