# Installing mcp-supplier-list (agent instructions)

This file tells an AI coding agent exactly how to install this MCP server. No account, no API key, no network service is required.

Server: **Supplier list** (@theluckystrike/mcp-supplier-list)
What it does: A supplier directory that does not rot. `supplier_add` records who you buy from: the name, what they supply, the contact, the payment terms, the lead time in days and notes, and returns a `SUP-YYYY-NNNN` id. Every record carries the date it was last reviewed, and `supplier_due_review` is the report that answers which records have gone stale, most overdue first. `supplier_list` reads the directory A to Z with category and free-text filters, and `supplier_export` hands it over as CSV or a Markdown table.
Source: https://github.com/theluckystrike/mcp-servers/tree/main/servers/supplier-list
License: MIT. Support: support@zovo.one

## Status of the npm package

The npm package `@theluckystrike/mcp-supplier-list` is not published yet. Until it is, the `npx` command below will fail with E404. Use **Alternative B - from source** further down, which is the supported path today, and keep the same client config with `"command": "node"` and the absolute path to `dist/index.js`. Everything else on this page is unchanged.

## Prerequisites

- Node.js 18 or newer on PATH (`node --version`).
- No native dependencies. The package is pure JavaScript.
- No sibling server is required at runtime. This one opens no other server's store.

## Step 1 - the run command

```sh
npx -y @theluckystrike/mcp-supplier-list
```

The server speaks MCP over stdio. It writes nothing to stdout except protocol traffic. Do not run it interactively as a check; the client starts it.

## Step 2 - write the client config

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "supplier-list": {
      "command": "npx",
      "args": ["-y", "@theluckystrike/mcp-supplier-list"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add supplier-list -- npx -y @theluckystrike/mcp-supplier-list
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project). Same entry as Claude Desktop.

## Alternative A - .mcpb bundle (Claude Desktop one-click)

Download `supplier-list.mcpb` from https://github.com/theluckystrike/mcp-servers/releases and open it, or drag it onto the Claude Desktop Extensions pane. This installs the server without editing JSON and without Node on PATH assumptions.

## Alternative B - from source

```sh
git clone https://github.com/theluckystrike/mcp-servers
cd mcp-servers
npm install
npm run build --workspace @theluckystrike/mcp-supplier-list
```

Then point the client at the built entry:

```json
{
  "mcpServers": {
    "supplier-list": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-servers/servers/supplier-list/dist/index.js"]
    }
  }
}
```

## Step 3 - the optional licence key

The free tier holds 10 suppliers, and reading, updating, searching, review stamps and CSV export are free and unlimited on every tier. Removing a supplier you no longer use frees its slot. A Pro key lifts the supplier cap and adds Markdown export and the due-review report. Set it as `MCP_LICENSE_KEY` in the server's `env` block, or call `license_activate` once and it is stored in `~/.config/mcp-servers/license.json`.

```json
{
  "mcpServers": {
    "supplier-list": {
      "command": "npx",
      "args": ["-y", "@theluckystrike/mcp-supplier-list"],
      "env": { "MCP_LICENSE_KEY": "MCPL1...." }
    }
  }
}
```

Keys are verified offline against a bundled public key. Nothing is sent anywhere. Keys: https://mcp.zovo.one/buy/supplier-list

## Step 4 - verify

Ask the assistant to call `license_status`. It answers with the tier and where the key came from. Then ask it to call `supplier_add` with a name and a category; a `SUP-YYYY-NNNN` id comes back. `tools/list` must show the ten tools from the server README.

## Where data lives

`${XDG_DATA_HOME:-~/.local/share}/mcp-servers/supplier-list/`, as `suppliers.json` and `counter.json`. Nothing else on the machine is written. There is no telemetry and no network call in this server.

## Troubleshooting

- `command not found: npx` - install Node.js 18+.
- Tools missing after a config edit - the client only reads the config at startup; restart it fully.
- `the free tier holds 10 suppliers` - removing a supplier you no longer buy from frees its slot, and everything on the records you have stays free on every tier.
- Adding a supplier whose name is already in the directory is refused, because two records of one supplier cannot be told apart; `supplier_update` changes the record that exists.
- A supplier number is never reissued: a gap in the SUP series is the record that a row was removed.

Built by theluckystrike (https://github.com/theluckystrike).
