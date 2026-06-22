# Nurui MCP

Model Context Protocol server for Nurui components.

The server exposes Nurui's shadcn-compatible registry to MCP clients with a small, token-efficient tool surface. Agents can search or list compact metadata first, then request one component with source code only when needed.

## Usage

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

For local development from this repository:

```json
{
  "mcpServers": {
    "nurui": {
      "command": "node",
      "args": ["...../Nurui/src/mcp/dist/index.js"] // absolute path
    }
  }
}
```

## Tools

### `listRegistryItems`

Lists compact registry item metadata with optional filtering and pagination.

Parameters:

- `kind`: optional kind such as `component` or `registry:component`
- `query`: optional text filter
- `limit`: optional result limit, default `25`, max `150`
- `offset`: optional pagination offset

### `searchRegistryItems`

Ranks matching items by name, title, description, dependency, and source path.

Parameters:

- `query`: required search text
- `kind`: optional kind filter
- `limit`: optional result limit, default `25`, max `150`
- `offset`: optional pagination offset

### `getRegistryItem`

Fetches one registry item with install instructions and file metadata.

Parameters:

- `name`: required registry item name, for example `gradient-button`
- `includeSource`: optional boolean, defaults to `false`

### `installRegistryItem`

Installs one registry item into a local project using the same file layout as the Nurui CLI.

Parameters:

- `name`: required registry item name, for example `gradient-button`
- `projectPath`: absolute path to the target project
- `language`: optional target language, `ts` or `js`, defaults to `ts`
- `installDependencies`: optional boolean, defaults to `true`
- `overwrite`: optional boolean, defaults to `false`
- `dryRun`: optional boolean, defaults to `false`

## Development

```bash
npm install
npm test
```

`npm test` builds the TypeScript source and runs the Node test suite.
