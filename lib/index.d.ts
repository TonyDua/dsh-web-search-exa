import z from "@deepseek-ai/schemastery";
import { WebSearchProvider, WebSearchRequest, WebSearchResult } from "@deepseek-ai/dsh-web";
import { Context } from "@deepseek-ai/cordis";
//#region src/types.d.ts
/**
 * Wire and configuration types for `@tonydua/dsh-web-search-exa`.
 *
 * Two independent wire shapes live here: Exa's REST `POST /search` response
 * (used when an API key is configured) and the normalized MCP payload returned
 * by Exa's hosted MCP server (the anonymous, keyless path). Neither is exported
 * to consumers — the provider normalizes both into the seam's
 * `WebSearchResult` vocabulary.
 *
 * @module @tonydua/dsh-web-search-exa/types
 */
/** Retrieval mode sent to Exa's REST `type` field. */
type ExaSearchType = 'auto' | 'keyword' | 'neural';
/** One `results[]` entry of Exa's REST response (fields we actually read). */
interface ExaRestResult {
  readonly url: string;
  readonly title?: string | null;
  /** Exa's per-result highlight sentences; the only portable snippet source. */
  readonly highlights?: readonly string[] | null;
  /** Exa's publication/crawl timestamp, passed through as `publishedAt`. */
  readonly publishedDate?: string | null;
}
/** Exa's REST `POST /search` response body. */
interface ExaRestResponse {
  readonly results?: readonly ExaRestResult[] | null;
}
/**
 * One `content[]` block of a normalized MCP result payload.
 * Non-text blocks (images, resources) are skipped by the collector.
 */
interface McpContentItem {
  readonly type?: string;
  readonly text?: string;
}
/** The `result` member of a JSON-RPC 2.0 response to a `tools/call`. */
interface McpToolResult {
  readonly content?: readonly McpContentItem[] | null;
  /** True when the tool itself reported a failure (as opposed to a transport error). */
  readonly isError?: boolean;
}
/** The `error` member of a JSON-RPC 2.0 response. */
interface McpJsonRpcError {
  readonly code?: number;
  readonly message?: string;
}
/** A JSON-RPC 2.0 envelope as returned by Exa's hosted MCP server. */
interface McpPayload {
  readonly result?: McpToolResult | null;
  readonly error?: McpJsonRpcError | null;
}
/**
 * One parsed `Title:`-led section of Exa MCP text output. Every field is
 * best-effort: Exa omits or emits `N/A` for several of them.
 */
interface ExaMcpSection {
  url?: string;
  title?: string;
  publishedAt?: string;
  author?: string;
  highlights?: string[];
  /** Full-page text, used only as a snippet fallback when no highlight exists. */
  text?: string;
}
//#endregion
//#region src/provider.d.ts
/**
 * Fully resolved options the provider serves one search with. Produced by
 * {@link resolveOptions} from the current Settings section, so every field is
 * already defaulted by the time the provider reads it.
 *
 * The optional members are declared `| undefined` rather than merely optional:
 * `resolveOptions` always sets them (possibly to `undefined`), and this
 * package type-checks under `exactOptionalPropertyTypes`.
 */
interface ExaSearchProviderOptions {
  readonly providerId?: string | undefined;
  readonly apiKey: string;
  readonly apiKeyEnv: string;
  readonly baseURL: string;
  readonly apiURL?: string | undefined;
  readonly mcpURL: string;
  readonly searchType: ExaSearchType;
  readonly numResults?: number | undefined;
  readonly highlightsPerResult: number;
}
/** The dsh Settings section shape (fields optional at the load boundary). */
interface ExaSearchProviderConfig {
  providerId?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  /** @deprecated Use `baseURL`; this full endpoint remains supported for compatibility. */
  apiURL?: string;
  mcpURL?: string;
  searchType?: ExaSearchType;
  numResults?: number;
  highlightsPerResult?: number;
}
/**
 * The launch-environment snapshot the provider resolves credentials against.
 * Structural rather than the concrete dsh type so direct library use can pass
 * any `get`-shaped source.
 */
interface ExaKeyEnvironment {
  get(name: string): {
    value: string;
  } | undefined;
}
/** Resolve one search's API key; `undefined` selects the anonymous MCP path. */
type ExaApiKeyResolver = (options: ExaSearchProviderOptions) => string | undefined;
/** Options thunk: called per operation so live Settings edits take effect next search. */
type ExaOptionsResolver = () => ExaSearchProviderOptions;
/**
 * Resolve the API key: literal config first, then the environment variable.
 * `undefined` means the anonymous MCP path is used.
 */
export declare function resolveApiKeyFromProcess(options: ExaSearchProviderOptions): string | undefined;
/**
 * Resolve a key against dsh's immutable launch-environment snapshot. The
 * process fallback keeps direct library use and older hosts working.
 */
export declare function resolveApiKey(options: ExaSearchProviderOptions, environment?: ExaKeyEnvironment): string | undefined;
/**
 * Project one resolved configuration section into the options the provider
 * serves its next search with. Called per operation so live Settings edits
 * take effect on the next search.
 */
export declare function resolveOptions(section: ExaSearchProviderConfig): ExaSearchProviderOptions;
/**
 * Exa-backed search with an anonymous fallback.
 *
 * Path selection is per search, not per install: a key appearing later (for
 * example after a Settings edit) upgrades the next search to REST without a
 * restart, and removing it falls back to the anonymous endpoint.
 */
export declare class ExaSearchProvider implements WebSearchProvider {
  #private;
  readonly id: string;
  /**
   * @param resolveOptions - thunk returning the options for the NEXT
   * operation, snapshotted once at each operation's entry so one search
   * never mixes two settings sections (same pattern as the official
   * DeepSeek provider).
   * @param resolveApiKey - optional key resolver; dsh hosts pass their
   * launch-environment snapshot while direct users retain process.env fallback.
   */
  constructor(resolveOptions: ExaOptionsResolver, resolveApiKey?: ExaApiKeyResolver);
  /** The anonymous MCP path needs no credentials, so only local options gate use. */
  available(): boolean;
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
//#endregion
//#region src/constants.d.ts
/**
 * Defaults and stable identifiers for `@tonydua/dsh-web-search-exa`.
 *
 * Every value here is also restated in the Settings schema with the same
 * default, so a reader can see the effective value without following the
 * import. Keep the two in sync: the schema is the user-facing contract, these
 * are the values the provider falls back to when a field is absent.
 *
 * @module @tonydua/dsh-web-search-exa/constants
 */
/** Default provider id this provider registers under (`ctx.web` registry key). */
export declare const DEFAULT_PROVIDER_ID = "exa";
/** Backward-compatible alias for the default provider id. */
export declare const PROVIDER_ID = "exa";
/** Exa REST search endpoint; used only when an API key is configured. */
export declare const DEFAULT_BASE_URL = "https://api.exa.ai";
/** Legacy full REST endpoint; `baseURL` is the canonical dsh-compatible option. */
export declare const DEFAULT_API_URL = "https://api.exa.ai/search";
/** Exa hosted MCP endpoint; the anonymous fallback path. */
export declare const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";
/** Environment variable consulted when no literal `apiKey` is configured. */
export declare const DEFAULT_API_KEY_ENV = "EXA_API_KEY";
/** Default retrieval mode for the REST path: let Exa pick. */
export declare const DEFAULT_SEARCH_TYPE = "auto";
/** Default number of highlight sentences requested per result (REST path). */
export declare const DEFAULT_HIGHLIGHTS_PER_RESULT = 1;
/** MCP tool name for plain web search on Exa's hosted server. */
export declare const MCP_TOOL = "web_search_exa";
/**
 * Attribution header sent on anonymous MCP requests. This is the only signal
 * Exa's public endpoint receives about the caller, so it is deliberately a
 * product-level name rather than a per-install identifier.
 */
export declare const MCP_SOURCE = "dsh-anything";
/** User agent for REST requests. */
export declare const USER_AGENT = "deepseek-harness-exa/0.1.4";
/** Snippet cap for text-derived snippets (matching oh-my-pi's choice). */
export declare const MAX_SNIPPET_CHARS = 500;
/** Settings namespace carrying this provider's configuration. */
export declare const SETTINGS_NAMESPACE = "web-search-exa";
//#endregion
//#region src/index.d.ts
declare const Config: z<Schemastery.ObjectS<{
  /**
   * Provider id registered into `ctx.web`. Defaults to `exa` (same as the
   * official `@deepseek-ai/dsh-web-search-exa`). Change it only when BOTH
   * packages are installed in one profile — the seam rejects duplicate ids
   * with `WEB_DUPLICATE_PROVIDER`. There is no silent override: pick a
   * distinct id here (e.g. `exa-anon`) and select it explicitly with
   * `searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`.
   */
  providerId: z<string, string>;
  /** Literal Exa API key; an empty/missing value enables the anonymous MCP path. */
  apiKey: z<string, string>;
  /** Environment variable consulted when no literal `apiKey` is configured. */
  apiKeyEnv: z<string, string>;
  /** Exa API base URL; `/search` is appended for the keyed REST path. */
  baseURL: z<string, string>;
  /**
   * Legacy full REST endpoint. When set, it takes precedence over `baseURL`;
   * new configurations should use `baseURL` to match the official provider.
   */
  apiURL: z<string, string>;
  /** Exa hosted MCP endpoint, used by the anonymous fallback. */
  mcpURL: z<string, string>;
  /** REST retrieval mode: `auto`, `keyword`, or `neural`. */
  searchType: z<"auto" | "keyword" | "neural", "auto" | "keyword" | "neural">;
  /** Default result count when the request carries no `maxResults`. */
  numResults: z<number, number>;
  /** Highlight sentences requested per result on the REST path. */
  highlightsPerResult: z<number, number>;
}>, Schemastery.ObjectT<{
  /**
   * Provider id registered into `ctx.web`. Defaults to `exa` (same as the
   * official `@deepseek-ai/dsh-web-search-exa`). Change it only when BOTH
   * packages are installed in one profile — the seam rejects duplicate ids
   * with `WEB_DUPLICATE_PROVIDER`. There is no silent override: pick a
   * distinct id here (e.g. `exa-anon`) and select it explicitly with
   * `searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`.
   */
  providerId: z<string, string>;
  /** Literal Exa API key; an empty/missing value enables the anonymous MCP path. */
  apiKey: z<string, string>;
  /** Environment variable consulted when no literal `apiKey` is configured. */
  apiKeyEnv: z<string, string>;
  /** Exa API base URL; `/search` is appended for the keyed REST path. */
  baseURL: z<string, string>;
  /**
   * Legacy full REST endpoint. When set, it takes precedence over `baseURL`;
   * new configurations should use `baseURL` to match the official provider.
   */
  apiURL: z<string, string>;
  /** Exa hosted MCP endpoint, used by the anonymous fallback. */
  mcpURL: z<string, string>;
  /** REST retrieval mode: `auto`, `keyword`, or `neural`. */
  searchType: z<"auto" | "keyword" | "neural", "auto" | "keyword" | "neural">;
  /** Default result count when the request carries no `maxResults`. */
  numResults: z<number, number>;
  /** Highlight sentences requested per result on the REST path. */
  highlightsPerResult: z<number, number>;
}>>;
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-exa";
/** The web seam this provider registers into. */
export declare const inject: readonly ["web"];
/**
 * Register the Exa search provider with `ctx.web` and, when the optional
 * settings service is mounted, install its Settings section.
 *
 * The settings install is deliberately inside `ctx.inject`, so a profile that
 * omits `dsh-settings` still mounts the provider — keyless search must not
 * depend on the Settings UI being present.
 */
export declare function apply(ctx: Context, config: ExaSearchProviderConfig): void;
//#endregion
export { Config, type ExaApiKeyResolver, type ExaKeyEnvironment, type ExaMcpSection, type ExaOptionsResolver, type ExaRestResponse, type ExaRestResult, type ExaSearchProviderConfig, type ExaSearchProviderOptions, type ExaSearchType, type McpContentItem, type McpJsonRpcError, type McpPayload, type McpToolResult };