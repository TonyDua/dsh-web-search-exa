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
export const DEFAULT_PROVIDER_ID = 'exa';

/** Backward-compatible alias for the default provider id. */
export const PROVIDER_ID = DEFAULT_PROVIDER_ID;

/** Exa REST search endpoint; used only when an API key is configured. */
export const DEFAULT_BASE_URL = 'https://api.exa.ai';

/** Legacy full REST endpoint; `baseURL` is the canonical dsh-compatible option. */
export const DEFAULT_API_URL = `${DEFAULT_BASE_URL}/search`;

/** Exa hosted MCP endpoint; the anonymous fallback path. */
export const DEFAULT_MCP_URL = 'https://mcp.exa.ai/mcp';

/** Environment variable consulted when no literal `apiKey` is configured. */
export const DEFAULT_API_KEY_ENV = 'EXA_API_KEY';

/** Default retrieval mode for the REST path: let Exa pick. */
export const DEFAULT_SEARCH_TYPE = 'auto';

/** Default number of highlight sentences requested per result (REST path). */
export const DEFAULT_HIGHLIGHTS_PER_RESULT = 1;

/** MCP tool name for plain web search on Exa's hosted server. */
export const MCP_TOOL = 'web_search_exa';

/**
 * Attribution header sent on anonymous MCP requests. This is the only signal
 * Exa's public endpoint receives about the caller, so it is deliberately a
 * product-level name rather than a per-install identifier.
 */
export const MCP_SOURCE = 'dsh-anything';

/**
 * User agent for REST requests.
 *
 * Annotated `: string` rather than left inferred: this constant is re-exported
 * from the package root, and a `const` string infers a LITERAL type, which
 * would bake today's version number into every consumer's type-checking.
 */
export const USER_AGENT: string = 'deepseek-harness-exa/0.1.5';

/** Snippet cap for text-derived snippets (matching oh-my-pi's choice). */
export const MAX_SNIPPET_CHARS = 500;

/** Settings namespace carrying this provider's configuration. */
export const SETTINGS_NAMESPACE = 'web-search-exa';
