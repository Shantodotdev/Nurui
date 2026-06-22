import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import { registryService } from "./registry-service.js";

type Language = "ts" | "js";
type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

interface RegistryFileWithContent {
  path: string;
  type?: string;
  content?: string;
}

interface RegistryItemWithContent {
  name: string;
  dependencies?: string[];
  files: RegistryFileWithContent[];
}

interface RegistryServiceLike {
  getRegistryItem(
    name: string,
    options: { includeSource: true },
  ): Promise<RegistryItemWithContent>;
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ComponentInstallerOptions {
  registryService?: RegistryServiceLike;
  spawnCommand?: (
    command: string,
    args: string[],
    options: { cwd: string },
  ) => Promise<SpawnResult>;
}

/**
 * Input accepted by the install tool.
 *
 * `projectPath` is always resolved before writes. `dryRun` computes the same
 * paths without touching the filesystem or installing packages.
 */
export interface InstallComponentArgs {
  name: string;
  projectPath: string;
  language?: Language;
  installDependencies?: boolean;
  overwrite?: boolean;
  dryRun?: boolean;
}

/**
 * Result returned by the install tool.
 *
 * `plannedFiles` includes every target path. `writtenFiles` and `skippedFiles`
 * describe what actually happened during a non-dry run.
 */
export interface InstallComponentResult {
  component: string;
  projectPath: string;
  language: Language;
  dryRun: boolean;
  writtenFiles: string[];
  skippedFiles: string[];
  plannedFiles: string[];
  dependencies: {
    installed: boolean;
    packages: string[];
    command?: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  };
}

// Local `cn` helper written when the target project does not have one yet.
const UTILS_CONTENT: Record<Language, string> = {
  ts: `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  js: `import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
`,
};

// Detect the package manager from lockfiles in the target project.
function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectPath, "bun.lockb"))) return "bun";
  return "npm";
}

// Map package-manager names to their dependency install command.
function getInstallCommand(
  packageManager: PackageManager,
  packages: string[],
): { command: string; args: string[] } {
  if (packageManager === "npm") {
    return { command: "npm", args: ["install", ...packages] };
  }

  return { command: packageManager, args: ["add", ...packages] };
}

// Default dependency installer used by real MCP calls.
function defaultSpawnCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

// Match the CLI layout: use `src/` when it exists, otherwise write at project root.
function getProjectDirs(projectPath: string) {
  const hasSrc = existsSync(path.join(projectPath, "src"));
  const sourceRoot = hasSrc ? path.join(projectPath, "src") : projectPath;

  return {
    componentDir: path.join(sourceRoot, "components", "nurui"),
    stylesDir: path.join(sourceRoot, "components", "nurui", "styles"),
    libDir: path.join(sourceRoot, "lib"),
  };
}

// Convert TSX component files when the caller requests JavaScript output.
function convertTsxToJsx(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
    },
    fileName: "component.tsx",
  }).outputText;
}

// Resolve a registry file path into its local project destination.
function getTargetPath(
  filePath: string,
  dirs: ReturnType<typeof getProjectDirs>,
  language: Language,
): string {
  const fileName = path.basename(filePath);

  if (fileName.endsWith(".css")) {
    return path.join(dirs.stylesDir, fileName);
  }

  const targetName =
    language === "js" ? fileName.replace(/\.tsx$/, ".jsx") : fileName;

  return path.join(dirs.componentDir, targetName);
}

// Write a file unless it already exists and overwrite is disabled.
async function writeProjectFile(
  targetPath: string,
  content: string,
  overwrite: boolean,
): Promise<"written" | "skipped"> {
  if (!overwrite && existsSync(targetPath)) {
    return "skipped";
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");

  return "written";
}

/**
 * Create a component installer backed by a registry service.
 *
 * The default instance fetches registry items from the live registry service
 * and installs dependencies with the package manager detected in `projectPath`.
 */
export function createComponentInstaller(options: ComponentInstallerOptions = {}) {
  const source = options.registryService ?? registryService;
  const spawnCommand = options.spawnCommand ?? defaultSpawnCommand;

  return {
    /**
     * Install a registry item into a local project.
     *
     * This fetches source internally, writes component/style files, creates the
     * `cn` utility helper, and optionally installs dependencies.
     */
    async installComponent(args: InstallComponentArgs): Promise<InstallComponentResult> {
      const componentName = args.name.trim();
      if (!componentName) throw new Error("Component name is required.");

      const projectPath = path.resolve(args.projectPath);
      const language = args.language ?? "ts";
      const installDependencies = args.installDependencies ?? true;
      const overwrite = args.overwrite ?? false;
      const dryRun = args.dryRun ?? false;
      const dirs = getProjectDirs(projectPath);

      // Installation needs file contents even though browse/detail calls avoid them.
      const item = await source.getRegistryItem(componentName, {
        includeSource: true,
      });

      // Ignore registry file entries without content; there is nothing to write.
      const files = item.files.filter((file) => typeof file.content === "string");
      const utilsPath = path.join(dirs.libDir, `utils.${language}`);
      const plannedFiles = [
        ...files.map((file) => getTargetPath(file.path, dirs, language)),
        utilsPath,
      ];
      const writtenFiles: string[] = [];
      const skippedFiles: string[] = [];

      if (!dryRun) {
        // Write component and style files first.
        for (const file of files) {
          const targetPath = getTargetPath(file.path, dirs, language);
          const content =
            language === "js" && file.path.endsWith(".tsx")
              ? convertTsxToJsx(file.content as string)
              : (file.content as string);
          const status = await writeProjectFile(targetPath, content, overwrite);

          if (status === "written") writtenFiles.push(targetPath);
          else skippedFiles.push(targetPath);
        }

        // Always ensure the utility helper exists, matching the CLI behavior.
        const status = await writeProjectFile(
          utilsPath,
          UTILS_CONTENT[language],
          overwrite,
        );

        if (status === "written") writtenFiles.push(utilsPath);
        else skippedFiles.push(utilsPath);
      }

      // The utility helper depends on these packages even if the component does not list them.
      const packages = [
        ...new Set(
          [...(item.dependencies ?? []), "clsx", "tailwind-merge"].filter(Boolean),
        ),
      ];
      const dependencies: InstallComponentResult["dependencies"] = {
        installed: false,
        packages,
      };

      if (!dryRun && installDependencies && packages.length > 0) {
        // Dependency install is intentionally last so file writes are visible even if it fails.
        const packageManager = detectPackageManager(projectPath);
        const installCommand = getInstallCommand(packageManager, packages);
        const result = await spawnCommand(installCommand.command, installCommand.args, {
          cwd: projectPath,
        });

        dependencies.installed = result.code === 0;
        dependencies.command = [installCommand.command, ...installCommand.args].join(" ");
        dependencies.exitCode = result.code;
        dependencies.stdout = result.stdout.slice(-4000);
        dependencies.stderr = result.stderr.slice(-4000);
      }

      return {
        component: componentName,
        projectPath,
        language,
        dryRun,
        writtenFiles,
        skippedFiles,
        plannedFiles,
        dependencies,
      };
    },
  };
}

export const componentInstaller = createComponentInstaller();
