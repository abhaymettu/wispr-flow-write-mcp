#!/bin/sh
# Plugin launcher for wispr-flow-write.
# The plugin install does not include node_modules, so install dependencies
# into the plugin directory on first run (and after updates, which replace the
# plugin directory), then start the server.
# Stdout must stay clean for the MCP stdio transport: all logs go to stderr.
set -e
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ ! -d "$ROOT/node_modules/@modelcontextprotocol/sdk" ]; then
  echo "wispr-flow-write: installing dependencies (first run or after update)..." >&2
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund --loglevel=error) >&2
fi
exec node "$ROOT/index.js"
