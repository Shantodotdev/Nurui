const REGISTRY_BASE_URL = "https://nurui.vercel.app";
const REGISTRY_INDEX_URL = `${REGISTRY_BASE_URL}/r/registry.json`;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 150;

export interface RegistryFile {
  path: string;
  type?: string;
  content?: string;
}

export interface RegistryItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: RegistryFile[];
}

export interface Registry {
  name?: string;
  homepage?: string;
  items?: RegistryItem[];
}

export interface RegistryServiceOptions {
  baseUrl?: string;
  indexUrl?: string;
  fetch?: typeof fetch;
}

export interface ListRegistryItemsArgs {
  kind?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface SearchRegistryItemsArgs extends ListRegistryItemsArgs {
  query: string;
}

export interface GetRegistryItemOptions {
  includeSource?: boolean;
}

export interface RegistryItemSummary {
  name: string;
  type: string;
  title: string;
  description?: string;
  dependencies: string[];
  devDependencies: string[];
  registryDependencies: string[];
  files: string[];
}

export interface RegistryItemDetail extends Omit<RegistryItemSummary, "files"> {
  files: RegistryFile[];
}

// Normalize configured URLs before composing registry paths.
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// Enforce server-side page bounds.
function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_LIMIT);
}

// Invalid offsets fall back to the first page.
function clampOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset as number), 0);
}

// Derive a readable title when the registry item does not provide one.
function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Normalize optional arrays from registry data.
function cleanArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

// Convert registry files into the response shape used by detail lookups.
function getFiles(files: RegistryFile[] | undefined, includeSource = false) {
  return cleanArray(files).map((file) => {
    const result: RegistryFile = {
      path: file.path,
      type: file.type,
    };

    // Source content is opt-in to keep default responses small.
    if (includeSource && typeof file.content === "string") {
      result.content = file.content;
    }

    return result;
  });
}

// Central search index used by both filtering and ranking.
function getSearchText(item: RegistryItem): string {
  return [
    item.name,
    item.title,
    item.description,
    item.type,
    ...cleanArray(item.dependencies),
    ...cleanArray(item.registryDependencies),
    ...cleanArray(item.files).map((file) => file.path),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Return a fixed relevance score for the current query.
function scoreItem(item: RegistryItem, query: string): number {
  const name = item.name.toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  const description = (item.description ?? "").toLowerCase();
  const haystack = getSearchText(item);

  // Ranking order:
  // exact name > name prefix > name substring > title > description > fallback text hit
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;
  if (title.includes(query)) return 40;
  if (description.includes(query)) return 30;
  if (haystack.includes(query)) return 10;
  return 0;
}

// Shared fetch wrapper for registry endpoints.
async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} for ${url}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Normalize the incoming kind filter.
 *
 * The service accepts either the short form or the fully-qualified registry
 * form and compares everything in canonical form downstream.
 */
export function normalizeKind(kind?: string): string | undefined {
  if (!kind) return undefined;
  return kind.startsWith("registry:") ? kind : `registry:${kind}`;
}

/**
 * Build the compact item shape used by list and search responses.
 *
 * This drops file contents and keeps only the metadata needed for browsing.
 */
export function toRegistryItemSummary(item: RegistryItem): RegistryItemSummary {
  return {
    name: item.name,
    type: item.type,
    title: item.title ?? titleFromName(item.name),
    description: item.description,
    dependencies: cleanArray(item.dependencies),
    devDependencies: cleanArray(item.devDependencies),
    registryDependencies: cleanArray(item.registryDependencies),
    files: cleanArray(item.files).map((file) => file.path),
  };
}

/**
 * Build the detailed item shape used by `getRegistryItem`.
 *
 * The field set matches the summary response, with file entries expanded into
 * objects and source content added only when requested.
 */
export function toRegistryItemDetail(
  item: RegistryItem,
  { includeSource = false }: GetRegistryItemOptions = {},
): RegistryItemDetail {
  const summary = toRegistryItemSummary(item);

  return {
    ...summary,
    files: getFiles(item.files, includeSource),
  };
}

/**
 * Create a registry service bound to a base URL, index URL, and fetch
 * implementation.
 *
 * The service reads the registry index lazily, caches it for the lifetime of
 * the process, and fetches item detail JSON on demand.
 */
export function createRegistryService(options: RegistryServiceOptions = {}) {
  // `baseUrl` drives docs and per-item JSON URLs.
  // `indexUrl` stays overridable for tests.
  const baseUrl = trimTrailingSlash(options.baseUrl ?? REGISTRY_BASE_URL);
  const indexUrl = options.indexUrl ?? REGISTRY_INDEX_URL;
  const fetchImpl = options.fetch ?? fetch;

  let registryPromise: Promise<Registry> | undefined;

  /**
   * Load the registry index once and reuse it across calls.
   *
   * List and search operations all depend on the same index payload, so the
   * service memoizes the request instead of refetching it per tool call.
   */
  async function getRegistry(): Promise<Registry> {
    // Cache the index for the process lifetime.
    registryPromise ??= fetchJson<Registry>(fetchImpl, indexUrl);
    return registryPromise;
  }

  /**
   * Apply page bounds to an already-filtered item set.
   *
   * Pagination happens after filtering or ranking so `total`, `count`, and
   * `hasMore` describe the final result set.
   */
  function paginate(
    items: RegistryItem[],
    limit: number | undefined,
    offset: number | undefined,
  ) {
    // Pagination is applied after filtering/ranking.
    const safeLimit = clampLimit(limit);
    const safeOffset = clampOffset(offset);
    const page = items.slice(safeOffset, safeOffset + safeLimit);

    return {
      total: items.length,
      count: page.length,
      limit: safeLimit,
      offset: safeOffset,
      hasMore: safeOffset + page.length < items.length,
      items: page.map(toRegistryItemSummary),
    };
  }

  /**
   * Filter items by normalized kind and substring query.
   *
   * Kind matching is exact once normalized. Query matching uses the shared
   * search index built by `getSearchText`.
   */
  function filterItems(items: RegistryItem[], args: ListRegistryItemsArgs = {}) {
    const normalizedKind = normalizeKind(args.kind);
    const normalizedQuery = args.query?.trim().toLowerCase();

    // Kind match is exact after normalization. Query match is substring-based.
    return items.filter((item) => {
      if (normalizedKind && item.type !== normalizedKind) return false;
      if (!normalizedQuery) return true;
      return getSearchText(item).includes(normalizedQuery);
    });
  }

  return {
    /**
     * List registry items with optional kind and query filters.
     *
     * This is the lowest-cost read path. It always returns compact summaries.
     */
    async listRegistryItems(args: ListRegistryItemsArgs = {}) {
      const registry = await getRegistry();
      const filtered = filterItems(registry.items ?? [], args);
      const page = paginate(filtered, args.limit, args.offset);

      return {
        registry: registry.name,
        homepage: registry.homepage,
        ...page,
      };
    },

    /**
     * Search registry items and return ranked summary results.
     *
     * Ranking is deterministic for equal scores because the final sort key is
     * the item name.
     */
    async searchRegistryItems(args: SearchRegistryItemsArgs) {
      const query = args.query?.trim().toLowerCase();
      if (!query) throw new Error("Search query is required.");

      const registry = await getRegistry();
      const kindFiltered = filterItems(registry.items ?? [], { kind: args.kind });

      // Drop non-matches, then sort by score and stable name order.
      const ranked = kindFiltered
        .map((item) => ({ item, score: scoreItem(item, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
        .map((entry) => entry.item);
      const page = paginate(ranked, args.limit, args.offset);

      return {
        registry: registry.name,
        query: args.query,
        ...page,
      };
    },

    /**
     * Fetch one registry item and attach install-oriented metadata.
     *
     * The raw item payload comes from the per-item JSON file. The service adds
     * docs and install URLs so MCP callers do not have to reconstruct them.
     */
    async getRegistryItem(name: string, options: GetRegistryItemOptions = {}) {
      if (!name?.trim()) throw new Error("Registry item name is required.");

      const itemName = name.trim();
      const url = `${baseUrl}/r/${encodeURIComponent(itemName)}.json`;
      const item = await fetchJson<RegistryItem>(fetchImpl, url);

      // Attach docs and install metadata expected by MCP callers.
      return {
        ...toRegistryItemDetail(item, options),
        docsUrl: `${baseUrl}/docs/${itemName}`,
        registryUrl: url,
        install: {
          command: `npx nurui add ${itemName}`,
          shadcnCompatibleUrl: `${baseUrl}/r/${itemName}.json`,
        },
      };
    },
  };
}

export const registryService = createRegistryService();
