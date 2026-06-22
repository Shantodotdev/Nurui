import assert from "node:assert/strict";
import test from "node:test";

import {
  createRegistryService,
  normalizeKind,
  toRegistryItemSummary,
} from "../dist/registry-service.js";

const registry = {
  name: "nurui",
  homepage: "https://nurui.vercel.app",
  items: [
    {
      name: "gradient-button",
      type: "registry:component",
      title: "Gradient Button",
      description: "Animated conic gradient button.",
      dependencies: ["clsx", "tailwind-merge"],
      devDependencies: [],
      registryDependencies: [],
      files: [
        {
          path: "./src/components/nurui/gradient-button.tsx",
          type: "registry:component",
        },
      ],
    },
    {
      name: "spotlight-card",
      type: "registry:block",
      title: "Spotlight Card",
      description: "Interactive card with cursor spotlight.",
      dependencies: ["motion"],
      devDependencies: [],
      registryDependencies: [],
      files: [],
    },
  ],
};

const item = {
  ...registry.items[0],
  files: [
    {
      path: "./src/components/nurui/gradient-button.tsx",
      type: "registry:component",
      content: "export function GradientButton() { return <button /> }",
    },
  ],
};

function createFetch() {
  return async (url) => {
    if (url.endsWith("/r/registry.json")) {
      return Response.json(registry);
    }

    if (url.endsWith("/r/gradient-button.json")) {
      return Response.json(item);
    }

    return new Response("Not found", { status: 404 });
  };
}

test("normalizeKind accepts friendly and registry-prefixed kinds", () => {
  assert.equal(normalizeKind("component"), "registry:component");
  assert.equal(normalizeKind("registry:block"), "registry:block");
});

test("toRegistryItemSummary omits source content", () => {
  assert.deepEqual(toRegistryItemSummary(item), {
    name: "gradient-button",
    type: "registry:component",
    title: "Gradient Button",
    description: "Animated conic gradient button.",
    dependencies: ["clsx", "tailwind-merge"],
    devDependencies: [],
    registryDependencies: [],
    files: ["./src/components/nurui/gradient-button.tsx"],
  });
});

test("listRegistryItems paginates compact summaries", async () => {
  const service = createRegistryService({
    baseUrl: "https://nurui.vercel.app",
    fetch: createFetch(),
  });

  const result = await service.listRegistryItems({ limit: 1, offset: 1 });

  assert.equal(result.registry, "nurui");
  assert.equal(result.total, 2);
  assert.equal(result.count, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.items[0].name, "spotlight-card");
  assert.equal(result.items[0].files.length, 0);
});

test("searchRegistryItems ranks exact name matches before text matches", async () => {
  const service = createRegistryService({
    baseUrl: "https://nurui.vercel.app",
    fetch: createFetch(),
  });

  const result = await service.searchRegistryItems({ query: "gradient" });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, "gradient-button");
});

test("getRegistryItem returns install instructions without source by default", async () => {
  const service = createRegistryService({
    baseUrl: "https://nurui.vercel.app",
    fetch: createFetch(),
  });

  const result = await service.getRegistryItem("gradient-button");

  assert.equal(result.name, "gradient-button");
  assert.equal(result.install.command, "npx nurui add gradient-button");
  assert.equal(result.files[0].content, undefined);
});

test("getRegistryItem can include source content on demand", async () => {
  const service = createRegistryService({
    baseUrl: "https://nurui.vercel.app",
    fetch: createFetch(),
  });

  const result = await service.getRegistryItem("gradient-button", {
    includeSource: true,
  });

  assert.match(result.files[0].content, /GradientButton/);
});
