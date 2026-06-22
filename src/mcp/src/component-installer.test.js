import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createComponentInstaller } from "../dist/component-installer.js";

const registryItem = {
  name: "gradient-button",
  dependencies: ["clsx", "tailwind-merge"],
  files: [
    {
      path: "./src/components/nurui/gradient-button.tsx",
      type: "registry:component",
      content: "import { cn } from '@/lib/utils';\nexport default function Button() { return <button />; }\n",
    },
    {
      path: "./src/components/nurui/styles/gradient-button.css",
      type: "registry:component",
      content: ".gradient-button { color: red; }",
    },
  ],
};

function createRegistryService() {
  return {
    async getRegistryItem(name, options) {
      assert.equal(name, "gradient-button");
      assert.equal(options.includeSource, true);
      return registryItem;
    },
  };
}

test("installs component files and utils into a src project", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "nurui-mcp-install-"));
  await mkdir(path.join(projectPath, "src"));

  try {
    const installer = createComponentInstaller({
      registryService: createRegistryService(),
    });

    const result = await installer.installComponent({
      name: "gradient-button",
      projectPath,
      language: "ts",
      installDependencies: false,
    });

    assert.deepEqual(result.writtenFiles.sort(), [
      path.join(projectPath, "src", "components", "nurui", "gradient-button.tsx"),
      path.join(projectPath, "src", "components", "nurui", "styles", "gradient-button.css"),
      path.join(projectPath, "src", "lib", "utils.ts"),
    ].sort());

    const component = await readFile(
      path.join(projectPath, "src", "components", "nurui", "gradient-button.tsx"),
      "utf8",
    );
    assert.match(component, /export default function Button/);
    assert.equal(result.dependencies.installed, false);
    assert.deepEqual(result.dependencies.packages, ["clsx", "tailwind-merge"]);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("dry run reports planned writes without changing files", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "nurui-mcp-dry-run-"));

  try {
    const installer = createComponentInstaller({
      registryService: createRegistryService(),
    });

    const result = await installer.installComponent({
      name: "gradient-button",
      projectPath,
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.writtenFiles.length, 0);
    assert.equal(result.plannedFiles.length, 3);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
