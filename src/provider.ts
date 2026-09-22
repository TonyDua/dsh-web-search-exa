/**
 * The Exa-backed `WebSearchProvider`: REST with an API key, anonymous MCP
 * without one.
 *
 * The provider owns no model-facing tool — `@deepseek-ai/dsh-tool-web` renders
 * whatever this returns through the `ctx.web` seam. It also never invents a
 * snippet: a result without a real highlight (REST) or a real highlight/text
 * body (MCP) is dropped, because a fabricated snippet would make the seam lie.
 *
 * Anonymous-MCP request shape and response parsing follow the `web_search`
 * implementation in can1357/oh-my-pi (see README acknowledgements).
 *
 * @module @tonydua/dsh-web-search-exa/provider
 */

import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import {
	DEFAULT_API_KEY_ENV,
	DEFAULT_BASE_URL,
	DEFAULT_HIGHLIGHTS_PER_RESULT,
	DEFAULT_MCP_URL,
	DEFAULT_PROVIDER_ID,
	DEFAULT_SEARCH_TYPE,
	MAX_SNIPPET_CHARS,
	MCP_SOURCE,
	MCP_TOOL,
	USER_AGENT,
} from './constants.ts';
import type { ExaMcpSection, ExaRestResponse, ExaSearchType, McpPayload } from './types.ts';

/**
 * Fully resolved options the provider serves one search with. Produced by
 * {@link resolveOptions} from the current Settings section, so every field is
 * already defaulted by the time the provider reads it.
 *
 * The optional members are declared `| undefined` rather than merely optional:
 * `resolveOptions` always sets them (possibly to `undefined`), and this
 * package type-checks under `exactOptionalPropertyTypes`.
 */
export interface ExaSearchProviderOptions {
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
export interface ExaSearchProviderConfig {
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
export interface ExaKeyEnvironment {
	get(name: string): { value: string } | undefined;
}

/** Resolve one search's API key; `undefined` selects the anonymous MCP path. */
export type ExaApiKeyResolver = (options: ExaSearchProviderOptions) => string | undefined;

/** Options thunk: called per operation so live Settings edits take effect next search. */
export type ExaOptionsResolver = () => ExaSearchProviderOptions;

/** True for a positive whole number (cheap local config check). */
function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** Throw the seam's stable cancellation error when the caller is already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted === true) {
		throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: signal.reason });
	}
}

/**
 * Resolve the API key: literal config first, then the environment variable.
 * `undefined` means the anonymous MCP path is used.
 */
export function resolveApiKeyFromProcess(options: ExaSearchProviderOptions): string | undefined {
	if (options.apiKey != null && options.apiKey.length > 0) return options.apiKey;
	const fromEnv = process.env[options.apiKeyEnv];
	if (fromEnv != null && fromEnv.length > 0) return fromEnv;
	return undefined;
}

/**
 * Resolve a key against dsh's immutable launch-environment snapshot. The
 * process fallback keeps direct library use and older hosts working.
 */
export function resolveApiKey(
	options: ExaSearchProviderOptions,
	environment?: ExaKeyEnvironment,
): string | undefined {
	if (options.apiKey != null && options.apiKey.length > 0) return options.apiKey;
	const fromEnvironment = environment?.get(options.apiKeyEnv)?.value;
	if (fromEnvironment != null && fromEnvironment.length > 0) return fromEnvironment;
	return resolveApiKeyFromProcess(options);
}

// ── REST path (with API key) ────────────────────────────────────────────────

/**
 * Map one Exa REST result to a normalized source, or `undefined` when it has
 * no portable snippet (same rule as the official provider).
 */
function mapRestResult(result: {
	url: string;
	title?: string | null;
	highlights?: readonly string[] | null;
	publishedDate?: string | null;
}): { url: string; title?: string; snippet: string; publishedAt?: string } | undefined {
	const snippet = result.highlights?.find((highlight) => highlight.trim().length > 0);
	if (snippet === undefined) return undefined;
	return {
		url: result.url,
		...(result.title != null && result.title.length > 0 ? { title: result.title } : {}),
		snippet,
		...(result.publishedDate != null && result.publishedDate.length > 0
			? { publishedAt: result.publishedDate }
			: {}),
	};
}

// ── Anonymous MCP path (no API key) ─────────────────────────────────────────

/**
 * Parse an SSE (`text/event-stream`) response body into its first `data:`
 * payload, falling back to plain JSON. Returns `null` when neither parses.
 */
function parseSsePayload(text: string): McpPayload | null {
	const dataLines = text
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).replace(/^\s/, ''));
	if (dataLines.length > 0) {
		try {
			return JSON.parse(dataLines.join('\n')) as McpPayload;
		} catch {
			return null;
		}
	}
	try {
		return JSON.parse(text) as McpPayload;
	} catch {
		return null;
	}
}

/**
 * Collect non-blank `content[].text` blocks from a normalized MCP result
 * payload, joined with blank lines.
 */
function collectMcpText(payload: McpPayload): string[] {
	const content = payload?.result?.content;
	if (!Array.isArray(content)) return [];
	return content
		.map((item) => (typeof item?.text === 'string' ? item.text.replace(/\r\n?/g, '\n').trim() : ''))
		.filter((text) => text.length > 0);
}

/**
 * Parse one `Title:`-led section of Exa MCP text output into a partial source.
 * Handles both `Published:` and `Published Date:` field spellings.
 */
function parseExaSection(section: string): ExaMcpSection {
	const out: ExaMcpSection = {};
	let field: 'highlights' | 'text' | null = null;
	let textLines: string[] | null = null;
	for (const line of section.split('\n')) {
		const title = line.match(/^Title:\s*(.*)$/);
		const url = line.match(/^URL:\s*(.*)$/);
		const published = line.match(/^Published(?: Date)?:\s*(.*)$/);
		const author = line.match(/^Author:\s*(.*)$/);
		if (title) {
			out.title = title[1]!.trim();
			field = null;
		} else if (url) {
			out.url = url[1]!.trim();
			field = null;
		} else if (published) {
			out.publishedAt = published[1]!.trim();
			field = null;
		} else if (author) {
			out.author = author[1]!.trim();
			field = null;
		} else if (/^Highlights:\s*$/.test(line)) {
			field = 'highlights';
		} else if (/^Text:\s*$/.test(line)) {
			field = 'text';
			textLines = [];
		} else if (field === 'highlights') {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				out.highlights ??= [];
				out.highlights.push(trimmed.replace(/^[-•]\s*/, ''));
			}
		} else if (field === 'text' && textLines !== null) {
			textLines.push(line);
		}
	}
	if (textLines !== null) out.text = textLines.join('\n').trim();
	if (out.publishedAt === 'N/A') delete out.publishedAt;
	if (out.author === 'N/A') delete out.author;
	return out;
}

/** Split joined MCP text into per-result sections, each starting with `Title:`. */
function splitExaSections(joined: string): string[] {
	return joined
		.split(/\n{2,}(?=Title:\s*)/)
		.map((section) => section.trim())
		.filter((section) => section.length > 0 && section.startsWith('Title:'));
}

/** Map parsed Exa MCP sections to normalized sources (snippet-less entries dropped). */
function mapMcpSections(sections: readonly string[]): WebSearchResult['sources'][number][] {
	const sources: { url: string; title?: string; snippet: string; publishedAt?: string }[] = [];
	for (const section of sections) {
		const parsed = parseExaSection(section);
		if (!parsed.url || parsed.url.length === 0) continue;
		const highlight = parsed.highlights?.find((item) => item.trim().length > 0);
		const snippet = highlight ?? (parsed.text ? parsed.text.slice(0, MAX_SNIPPET_CHARS) : undefined);
		if (snippet === undefined) continue;
		sources.push({
			url: parsed.url,
			...(parsed.title != null && parsed.title.length > 0 ? { title: parsed.title } : {}),
			snippet,
			...(parsed.publishedAt != null && parsed.publishedAt.length > 0
				? { publishedAt: parsed.publishedAt }
				: {}),
		});
	}
	return sources;
}

// ── Provider ────────────────────────────────────────────────────────────────

/**
 * Project one resolved configuration section into the options the provider
 * serves its next search with. Called per operation so live Settings edits
 * take effect on the next search.
 */
export function resolveOptions(section: ExaSearchProviderConfig): ExaSearchProviderOptions {
	const baseURL = section.baseURL ?? DEFAULT_BASE_URL;
	return {
		providerId: section.providerId ?? DEFAULT_PROVIDER_ID,
		apiKey: section.apiKey ?? '',
		apiKeyEnv: section.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
		baseURL,
		apiURL: section.apiURL ?? `${baseURL.replace(/\/+$/, '')}/search`,
		mcpURL: section.mcpURL ?? DEFAULT_MCP_URL,
		searchType: section.searchType ?? DEFAULT_SEARCH_TYPE,
		numResults: section.numResults,
		highlightsPerResult: section.highlightsPerResult ?? DEFAULT_HIGHLIGHTS_PER_RESULT,
	};
}

/** Resolve the keyed REST endpoint from either the current or legacy option shape. */
function resolveSearchURL(options: ExaSearchProviderOptions): string {
	if (options.apiURL != null) return options.apiURL;
	const baseURL = options.baseURL ?? DEFAULT_BASE_URL;
	return `${baseURL.replace(/\/+$/, '')}/search`;
}

/**
 * Exa-backed search with an anonymous fallback.
 *
 * Path selection is per search, not per install: a key appearing later (for
 * example after a Settings edit) upgrades the next search to REST without a
 * restart, and removing it falls back to the anonymous endpoint.
 */
export class ExaSearchProvider implements WebSearchProvider {
	readonly id: string;

	readonly #resolveOptions: ExaOptionsResolver;
	readonly #resolveApiKey: ExaApiKeyResolver;

	/**
	 * @param resolveOptions - thunk returning the options for the NEXT
	 * operation, snapshotted once at each operation's entry so one search
	 * never mixes two settings sections (same pattern as the official
	 * DeepSeek provider).
	 * @param resolveApiKey - optional key resolver; dsh hosts pass their
	 * launch-environment snapshot while direct users retain process.env fallback.
	 */
	constructor(resolveOptions: ExaOptionsResolver, resolveApiKey: ExaApiKeyResolver = resolveApiKeyFromProcess) {
		this.#resolveOptions = resolveOptions;
		this.#resolveApiKey = resolveApiKey;
		this.id = resolveOptions().providerId ?? DEFAULT_PROVIDER_ID;
	}

	/** The anonymous MCP path needs no credentials, so only local options gate use. */
	available(): boolean {
		const options = this.#resolveOptions();
		return (
			URL.canParse(resolveSearchURL(options)) &&
			URL.canParse(options.mcpURL) &&
			isPositiveInteger(options.highlightsPerResult) &&
			(options.numResults === undefined || isPositiveInteger(options.numResults))
		);
	}

	async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
		throwIfAborted(signal);
		const options = this.#resolveOptions();
		const apiKey = this.#resolveApiKey(options);
		return apiKey !== undefined
			? await this.#restSearch(request, apiKey, options, signal)
			: await this.#anonymousMcpSearch(request, options, signal);
	}

	/** REST search with an API key: `POST {apiURL}` with Bearer auth. */
	async #restSearch(
		request: WebSearchRequest,
		apiKey: string,
		options: ExaSearchProviderOptions,
		signal?: AbortSignal,
	): Promise<WebSearchResult> {
		throwIfAborted(signal);
		const numResults = request.maxResults ?? options.numResults;
		const apiURL = resolveSearchURL(options);
		let response: Response;
		try {
			response = await fetch(apiURL, {
				method: 'POST',
				redirect: 'error',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json',
					accept: 'application/json',
					'user-agent': USER_AGENT,
				},
				body: JSON.stringify({
					query: request.query,
					type: options.searchType,
					contents: { highlights: { highlightsPerUrl: options.highlightsPerResult } },
					...(numResults !== undefined ? { numResults } : {}),
				}),
				...(signal !== undefined ? { signal } : {}),
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			throw new WebError(`Exa search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
		}
		if (!response.ok) {
			let message = `Exa API error (HTTP ${response.status})`;
			try {
				const parsed = (await response.json()) as { error?: string; message?: string };
				const detail = parsed.error ?? parsed.message;
				if (detail !== undefined && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) {
					throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
				}
				// keep the generic message
			}
			throw new WebError(message, 'WEB_PROVIDER_ERROR');
		}
		let parsed: ExaRestResponse;
		try {
			parsed = (await response.json()) as ExaRestResponse;
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
				cause: error,
			});
		}
		const sources = (parsed.results ?? []).map(mapRestResult).filter((source) => source !== undefined);
		return { sources, truncated: false };
	}

	/**
	 * Anonymous search through Exa's hosted MCP server. No credentials are
	 * sent; the `x-exa-source` header carries attribution. Rate-limited by Exa
	 * (HTTP 429) — configuring an API key lifts the limit via the REST path.
	 */
	async #anonymousMcpSearch(
		request: WebSearchRequest,
		options: ExaSearchProviderOptions,
		signal?: AbortSignal,
	): Promise<WebSearchResult> {
		throwIfAborted(signal);
		const args: { query: string; numResults?: number } = { query: request.query };
		const numResults = request.maxResults ?? options.numResults;
		if (numResults !== undefined) args.numResults = numResults;
		let response: Response;
		try {
			response = await fetch(options.mcpURL, {
				method: 'POST',
				redirect: 'error',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'x-exa-source': MCP_SOURCE,
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: Math.random().toString(36).slice(2),
					method: 'tools/call',
					params: { name: MCP_TOOL, arguments: args },
				}),
				...(signal !== undefined ? { signal } : {}),
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa anonymous search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			throw new WebError(`Exa anonymous search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
				cause: error,
			});
		}
		if (!response.ok) {
			if (response.status === 429) {
				throw new WebError(
					'Exa anonymous MCP rate limit reached (HTTP 429); configure an EXA_API_KEY for higher limits',
					'WEB_PROVIDER_ERROR',
				);
			}
			throw new WebError(`Exa anonymous MCP error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR');
		}
		let payload: McpPayload | null;
		try {
			payload = parseSsePayload(await response.text());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa anonymous search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
				cause: error,
			});
		}
		if (payload === null) {
			throw new WebError('Exa anonymous MCP returned an unprocessable response body', 'WEB_PROVIDER_ERROR');
		}
		if (payload.error != null) {
			throw new WebError(
				`Exa MCP error: ${String(payload.error.message ?? JSON.stringify(payload.error))}`,
				'WEB_PROVIDER_ERROR',
			);
		}
		if (payload.result?.isError === true) {
			const detail = collectMcpText(payload).join('\n').trim();
			throw new WebError(`Exa MCP tool error${detail.length > 0 ? `: ${detail}` : ''}`, 'WEB_PROVIDER_ERROR');
		}
		const sections = splitExaSections(collectMcpText(payload).join('\n\n'));
		const sources = mapMcpSections(sections);
		return { sources, truncated: false };
	}
}
