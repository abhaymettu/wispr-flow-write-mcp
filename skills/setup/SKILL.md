---
description: Set up and troubleshoot the wispr-flow-write MCP server (Wispr Flow desktop sign-in, dependencies, expired token, sync visibility). Use when the server fails to start, a tool errors, or the user has just installed this plugin.
---

# wispr-flow-write setup

Requirements: macOS with the Wispr Flow desktop app installed and signed in, and Node.js 18 or later.

1. Dependencies: the launcher (`bin/launch.sh`) runs `npm install --omit=dev` in the plugin directory on first start. If tools fail with a module-not-found error, run `npm install --omit=dev` inside the plugin directory manually.
2. Auth: the server reads the signed-in desktop app's session from `~/Library/Application Support/Wispr Flow/session.json` on every call. Nothing to configure, but the desktop app must be signed in.
3. Expired token: if a tool reports the token expired, ask the user to open Wispr Flow (the app refreshes its own session), then retry. The server never refreshes the token itself, on purpose: refreshing from outside the app can sign the app out.
4. Verify: call `list_words`. A successful call returns the user's personal dictionary (possibly empty).
5. Seeing changes: dictionary and snippet changes appear in the app after pressing Refresh on the Dictionary page or restarting Flow. Notes, todos, meetings, and preferences sync on the app's own cycle. Transforms load at app start.
6. Turning Wispr Flow's `cloud_sync` preference off stops this server's changes from reaching the app.
