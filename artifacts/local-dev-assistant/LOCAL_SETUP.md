# Run Local Dev Assistant on your computer

This app is designed to run in your browser on your own computer and use a
model served by Ollama on that same computer. It has no app backend, account
system, database, telemetry, or cloud AI integration. Files are read by the
browser after you select them; only the browser sends selected text and images
to the loopback Ollama API. The hosted preview intentionally blocks model calls.

## One-time setup

1. On each developer's workstation, open a local copy of this project in a terminal. Do not run this setup from the Replit web shell. Install Node.js and pnpm.
2. Install [Ollama](https://ollama.com/) and download a coding model, for example:

   ```sh
   ollama pull qwen2.5-coder:7b
   ```

3. From that local copy's project root, install dependencies and start the app:

   ```sh
   pnpm install
   pnpm --filter @workspace/local-dev-assistant run dev:local
   ```

4. Open `http://localhost:5173`. In the app, select the model that Ollama lists.

## Allow the local browser app in Ollama

The browser calls only `http://127.0.0.1:11434`. Ollama must permit requests from
the local app's exact browser origin. Set `OLLAMA_ORIGINS` to:

```text
http://localhost:5173,http://127.0.0.1:5173
```

Then restart Ollama. Keep the value limited to those local origins; do not use
`*`. On Linux/macOS, one way to start Ollama for a session is:

```sh
OLLAMA_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 ollama serve
```

On Windows or when Ollama runs as a background service, set `OLLAMA_ORIGINS` in
the system environment, then fully quit and reopen Ollama. If the app reports a
connection or browser-origin error, confirm Ollama is running and restart it
after changing this setting.

## File access and changes

- Choose a project folder or add individual files. The browser keeps their
  contents in memory for the current session; the app does not upload them to
  this project or store them in a remote database.
- Plain-text source and configuration files are included in prompts. Images can
  be sent to a local vision-capable model. Other binary formats are accepted as
  attachments but currently provide filename, type, and size only.
- Generated changes are proposals. Review them before applying; the app never
  runs commands or tests for you.
- Folder scanning skips common generated/dependency directories such as
  `node_modules`, `.git`, `dist`, and `build`.

## Offline use

After dependencies and the model have been installed/downloaded, start the app
and Ollama without a network connection. Do not publish the hosted preview if
you require all app code and file handling to stay on your own machine.