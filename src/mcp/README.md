# Nurui MCP

Model Context Protocol server for Nurui components.

This package lets MCP clients such as AI editors, coding agents, and local MCP inspectors search the Nurui registry, fetch component metadata, and install components into a local project without asking the model to copy large source files manually.

## What This Server Does

An MCP server is a small process that exposes tools to an MCP client. In this package, the client starts the Nurui MCP server over stdio (command-line), discovers the tools, and calls them when it needs registry data or wants to install a component.

Main goals:

- Keep browsing responses small.
- Fetch source only when needed.
- Let agents install components through a tool instead of copying code from chat.
- Reuse Nurui's existing registry and CLI-style file layout.

## Usage

Published package usage:

```json
{
  "mcpServers": {
    "nurui": {
      "command": "npx",
      "args": ["@nurui/mcp"]
    }
  }
}
```

Local repository usage:

```json
{
  "mcpServers": {
    "nurui": {
      "command": "node",
      "args": [".../Nurui/src/mcp/dist/index.js"],
      "cwd": ".../Nurui/src/mcp"
    }
  }
}
```

Use absolute paths in the local config. The `.../Nurui` part should be replaced with the full path to your local repository.

MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node ./dist/index.js
```

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run the built server:

```bash
npm start
```

## How It Works

Runtime flow:

1. The MCP client starts `dist/index.js`.
2. `src/index.ts` creates a stdio transport.
3. `src/server.ts` creates the MCP server instance.
4. `src/tools.ts` registers the public tools.
5. Tool handlers call `src/registry-service.ts` or `src/component-installer.ts`.
6. Responses are wrapped through `src/responses.ts`.

Registry flow:

1. `listRegistryItems` and `searchRegistryItems` load the registry index from `/r/registry.json`.
2. The registry index is cached for the lifetime of the process.
3. List and search tools return compact summaries without source code.
4. `getRegistryItem` fetches `/r/{name}.json` for one component.
5. `installRegistryItem` fetches the same item with source enabled and writes files directly.

## File Guide

### `src/index.ts`

Package binary entrypoint.

It creates the MCP server, connects it to `StdioServerTransport`, and waits for client requests. This is what runs when the package binary starts.

### `src/server.ts`

Creates the `McpServer` instance and registers all tools.

Keep this file small. Server setup belongs here; registry logic and install logic should stay in service files.

### `src/tools.ts`

Defines the MCP tool surface.

This file contains:

- Tool names
- Tool descriptions
- Zod input schemas
- Tool handlers

When adding a new public MCP tool, register it here with `server.registerTool`.

### `src/registry-service.ts`

Registry read layer.

This file handles:

- registry index loading
- registry item loading
- kind normalization
- filtering
- search ranking
- pagination
- compact and detailed response shapes

This service intentionally keeps source code out of list/search responses.

### `src/component-installer.ts`

Install layer.

This file handles:

- fetching a component with source
- writing component files
- writing component CSS files
- creating `lib/utils.ts` or `lib/utils.js`
- converting TSX to JSX when `language` is `js`
- detecting the target project's package manager
- optionally installing dependencies

The installer follows the same target layout as the Nurui CLI:

- If the target project has `src/`, files go under `src/components/nurui`.
- If the target project does not have `src/`, files go under `components/nurui`.
- CSS files go under `components/nurui/styles`.
- The `cn` helper goes under `lib/utils.ts` or `lib/utils.js`.

### `src/responses.ts`

Small response helpers.

MCP tool calls return a `CallToolResult`. This file keeps success and error response formatting consistent.

### Tests

Tests live beside the source:

- `src/registry-service.test.js`
- `src/component-installer.test.js`

The tests import from `dist`, so `npm test` builds first and then runs Node's test runner.

## Tools

### `listRegistryItems`

Lists registry items as compact summaries.

Use this when the client needs to browse components without loading source code.

Parameters:

- `kind`: optional kind such as `component` or `registry:component`
- `query`: optional substring filter
- `limit`: optional result limit, default `25`, max `150`
- `offset`: optional pagination offset

Returns:

- registry name
- homepage
- total result count
- page metadata
- compact item summaries

### `searchRegistryItems`

Searches registry items and ranks matches.

Use this when the user asks for a component by name, use case, dependency, or related keyword.

Parameters:

- `query`: required search text
- `kind`: optional kind filter
- `limit`: optional result limit, default `25`, max `150`
- `offset`: optional pagination offset

Ranking order:

1. exact name
2. name prefix
3. name substring
4. title
5. description
6. fallback search text

### `getRegistryItem`

Fetches one registry item.

Use this when the client has selected a specific component and needs details.

Parameters:

- `name`: required registry item name, for example `gradient-button`
- `includeSource`: optional boolean, defaults to `false`

By default this does not include source code. Set `includeSource` to `true` only when the client needs to inspect or explain the code.

### `installRegistryItem`

Installs one registry item into a local project.

Use this when the user wants to add a component to their codebase. This is more efficient than asking the model to read source code and write files manually.

Parameters:

- `name`: required registry item name, for example `gradient-button`
- `projectPath`: absolute path to the target project
- `language`: optional target language, `ts` or `js`, defaults to `ts`
- `installDependencies`: optional boolean, defaults to `true`
- `overwrite`: optional boolean, defaults to `false`
- `dryRun`: optional boolean, defaults to `false`

Recommended client flow:

1. Call with `dryRun: true`.
2. Show the planned files to the user.
3. Call again with `dryRun: false` after confirmation.

## Configuration

Default registry URLs:

- Index: `https://nurui.vercel.app/r/registry.json`
- Item detail: `https://nurui.vercel.app/r/{name}.json`

The registry URLs are defined as module-level constants in `src/registry-service.ts`, matching the fixed-url style used by the Nurui CLI package. Update those constants if the registry host changes.
