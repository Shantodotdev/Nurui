import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wraps JSON data in the text response shape expected by MCP tool calls. */
export function createTextResponse(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** Returns a structured MCP error without throwing through the transport layer. */
export function createErrorResponse(message: string, error: unknown): CallToolResult {
  const detail = error instanceof Error ? error.message : String(error);

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: message,
            detail,
          },
          null,
          2,
        ),
      },
    ],
  };
}
