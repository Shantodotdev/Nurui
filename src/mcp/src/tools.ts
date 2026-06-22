import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { componentInstaller } from "./component-installer.js";
import { registryService } from "./registry-service.js";
import { createErrorResponse, createTextResponse } from "./responses.js";

// Fewer tools makes it easier for the model to pick the right one.
const listRegistryItemsSchema = {
  kind: z
    .string()
    .optional()
    .describe(
      "Optional kind filter. Accepts friendly values like component or full values like registry:component.",
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Optional text filter over item names, titles, descriptions, dependencies, and file paths.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(150)
    .optional()
    .describe("Maximum number of items to return. Defaults to 25."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pagination offset. Defaults to 0."),
};

const searchRegistryItemsSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search query matched against Nurui component names, descriptions, dependencies, and file paths.",
    ),
  kind: z
    .string()
    .optional()
    .describe("Optional kind filter such as component or registry:component."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(150)
    .optional()
    .describe("Maximum number of ranked results to return. Defaults to 25."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pagination offset for ranked results. Defaults to 0."),
};

const getRegistryItemSchema = {
  name: z
    .string()
    .min(1)
    .describe("Exact Nurui registry item name, for example gradient-button."),
  includeSource: z
    .boolean()
    .optional()
    .describe(
      "Include file contents. Leave this off unless you really need the code.",
    ),
};

const installRegistryItemSchema = {
  name: z
    .string()
    .min(1)
    .describe("Exact Nurui registry item name, for example gradient-button."),
  projectPath: z
    .string()
    .min(1)
    .describe(
      "Absolute path to the project where the component should be installed.",
    ),
  language: z
    .enum(["ts", "js"])
    .optional()
    .describe("Target language for component files. Defaults to ts."),
  installDependencies: z
    .boolean()
    .optional()
    .describe(
      "Install npm dependencies after writing files. Defaults to false.",
    ),
  overwrite: z
    .boolean()
    .optional()
    .describe("Overwrite existing component files. Defaults to false."),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "Return planned changes without writing files. Defaults to false.",
    ),
};

export function registerTools(server: McpServer): void {
  server.registerTool(
    "listRegistryItems",
    {
      description:
        "List Nurui registry items with compact metadata, filters, and pagination.",
      inputSchema: listRegistryItemsSchema,
    },
    async (args) => {
      try {
        return createTextResponse(
          await registryService.listRegistryItems(args),
        );
      } catch (error) {
        return createErrorResponse(
          "Failed to list Nurui registry items.",
          error,
        );
      }
    },
  );

  server.registerTool(
    "searchRegistryItems",
    {
      description:
        "Search Nurui registry items by name, dependency, source path, or use-case keywords.",
      inputSchema: searchRegistryItemsSchema,
    },
    async (args) => {
      try {
        return createTextResponse(
          await registryService.searchRegistryItems(args),
        );
      } catch (error) {
        return createErrorResponse(
          "Failed to search Nurui registry items.",
          error,
        );
      }
    },
  );

  server.registerTool(
    "getRegistryItem",
    {
      description:
        "Get install instructions and detailed metadata for one Nurui registry item, optionally including source.",
      inputSchema: getRegistryItemSchema,
    },
    async (args) => {
      try {
        return createTextResponse(
          await registryService.getRegistryItem(args.name, {
            includeSource: args.includeSource,
          }),
        );
      } catch (error) {
        return createErrorResponse(
          `Failed to fetch Nurui registry item "${args.name}".`,
          error,
        );
      }
    },
  );

  server.registerTool(
    "installRegistryItem",
    {
      description:
        "Install a Nurui registry item into a local project using the same file layout as the CLI.",
      inputSchema: installRegistryItemSchema,
    },
    async (args) => {
      try {
        return createTextResponse(
          await componentInstaller.installComponent(args),
        );
      } catch (error) {
        return createErrorResponse(
          `Failed to install Nurui registry item "${args.name}".`,
          error,
        );
      }
    },
  );
}
