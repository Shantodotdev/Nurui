import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import pkg from "../package.json" with { type: "json" };
import { registerTools } from "./tools.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "@nurui/mcp",
    version: pkg.version,
  });

  registerTools(server);

  return server;
}
