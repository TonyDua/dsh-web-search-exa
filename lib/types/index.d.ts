/**
 * Type declarations for `@tonydua/dsh-web-search-exa`.
 * @module @tonydua/dsh-web-search-exa
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebSearchProvider } from '@deepseek-ai/dsh-web';

/** Config schema type (fields are optional at the load boundary). */
export interface ExaSearchProviderConfig {
	/** Literal Exa API key; empty/missing enables the anonymous MCP path. */
	apiKey?: string;
	/** Environment variable consulted when no literal `apiKey` is configured. */
	apiKeyEnv?: string;
	/** REST search endpoint, used only when an API key is available. */
	apiURL?: string;
	/** Exa hosted MCP endpoint, used by the anonymous fallback. */
	mcpURL?: string;
	/** REST retrieval mode: `auto`, `keyword`, or `neural`. */
	searchType?: 'auto' | 'keyword' | 'neural';
	/** Default result count when the request carries no `maxResults`. */
	numResults?: number;
	/** Highlight sentences requested per result on the REST path. */
	highlightsPerResult?: number;
}

/** The Exa-backed provider with anonymous MCP fallback. */
export class ExaSearchProvider implements WebSearchProvider {
	readonly id: string;
	constructor(resolveOptions: () => {
		apiKey: string;
		apiKeyEnv: string;
		apiURL: string;
		mcpURL: string;
		searchType: 'auto' | 'keyword' | 'neural';
		numResults?: number;
		highlightsPerResult: number;
	});
	available(): boolean;
	search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<{
		sources: ReadonlyArray<{ url: string; title?: string; snippet?: string; publishedAt?: string }>;
		truncated: boolean;
	}>;
}

/** Cordis plugin name used by loader diagnostics. */
export const name: string;
/** The web seam this provider registers into. */
export const inject: readonly ['web'];
/** Config schema (schemastery). */
export const Config: import('@deepseek-ai/schemastery').Schema<ExaSearchProviderConfig>;
/** Settings namespace for the Web panel section. */
export const SETTINGS_NAMESPACE: string;
/** Register the Exa search provider with `ctx.web` and install its Settings section. */
export function apply(ctx: Context, config: ExaSearchProviderConfig): void;
