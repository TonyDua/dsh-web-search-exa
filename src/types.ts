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
export type ExaSearchType = 'auto' | 'keyword' | 'neural';

/** One `results[]` entry of Exa's REST response (fields we actually read). */
export interface ExaRestResult {
	readonly url: string;
	readonly title?: string | null;
	/** Exa's per-result highlight sentences; the only portable snippet source. */
	readonly highlights?: readonly string[] | null;
	/** Exa's publication/crawl timestamp, passed through as `publishedAt`. */
	readonly publishedDate?: string | null;
}

/** Exa's REST `POST /search` response body. */
export interface ExaRestResponse {
	readonly results?: readonly ExaRestResult[] | null;
}

/**
 * One `content[]` block of a normalized MCP result payload.
 * Non-text blocks (images, resources) are skipped by the collector.
 */
export interface McpContentItem {
	readonly type?: string;
	readonly text?: string;
}

/** The `result` member of a JSON-RPC 2.0 response to a `tools/call`. */
export interface McpToolResult {
	readonly content?: readonly McpContentItem[] | null;
	/** True when the tool itself reported a failure (as opposed to a transport error). */
	readonly isError?: boolean;
}

/** The `error` member of a JSON-RPC 2.0 response. */
export interface McpJsonRpcError {
	readonly code?: number;
	readonly message?: string;
}

/** A JSON-RPC 2.0 envelope as returned by Exa's hosted MCP server. */
export interface McpPayload {
	readonly result?: McpToolResult | null;
	readonly error?: McpJsonRpcError | null;
}

/**
 * One parsed `Title:`-led section of Exa MCP text output. Every field is
 * best-effort: Exa omits or emits `N/A` for several of them.
 */
export interface ExaMcpSection {
	url?: string;
	title?: string;
	publishedAt?: string;
	author?: string;
	highlights?: string[];
	/** Full-page text, used only as a snippet fallback when no highlight exists. */
	text?: string;
}
