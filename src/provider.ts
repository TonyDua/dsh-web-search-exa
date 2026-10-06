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
	DEFAULT_MCP_TOOL,
	DEFAULT_MCP_URL,
	DEFAULT_PROVIDER_ID,
	DEFAULT_SEARCH_TYPE,
	MAX_MCP_RESPONSE_BYTES,
	MAX_SNIPPET_CHARS,
	MCP_SOURCE,
	MCP_TOOLS_QUERY,
	USER_AGENT,
} from './constants.ts';
import type { ExaAdvancedResponse, ExaAdvancedResult, ExaMcpSection, ExaRestResponse, ExaSearchType, McpPayload } from './types.ts';

/** MCP tool names the anonymous path can call. */
export type ExaMcpTool = 'web_search_exa' | 'web_search_advanced_exa';

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
	readonly mcpTool: ExaMcpTool;
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
	mcpTool?: ExaMcpTool;
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
 * Read an anonymous response body while refusing to buffer more than `limit`
 * bytes.
 *
 * The cap has to be enforced *while reading*, not after: `await
 * response.text()` materializes the whole body first, so a size check that
 * follows it protects nothing — the memory has already been spent, and
 * `new TextEncoder().encode(text)` spends a second copy of it just to measure
 * the first. This helper instead:
 *
 * 1. rejects immediately when the server declares an over-limit
 *    `content-length`, so the body is never requested;
 * 2. otherwise reads the stream chunk by chunk, aborting the transfer as soon
 *    as the running byte count passes `limit`.
 *
 * The limit is a memory boundary on the keyless path (a shared, unauthenticated
 * endpoint), not a judgement about the result set: the structured tool returns
 * whole-page text for every hit, so a large-but-legitimate response is possible
 * and is reported as a transient failure rather than a silent empty result.
 *
 * @param response - the ok response whose body is to be read.
 * @param limit - the maximum number of bytes to buffer.
 * @returns the decoded body text.
 * @throws {ExaResponseTooLargeError} when the body is, or grows, past `limit`.
 */
async function readBoundedBody(response: Response, limit: number): Promise<string> {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		const declaredBytes = Number(declared);
		if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
			await response.body?.cancel().catch(() => {});
			throw new ExaResponseTooLargeError(limit, declaredBytes);
		}
	}
	const body = response.body;
	if (body === null) return await response.text();
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > limit) {
				await reader.cancel().catch(() => {});
				throw new ExaResponseTooLargeError(limit, received);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

/**
 * Return the request URL for an anonymous advanced-tool search: when the
 * configured MCP URL carries no `tools` parameter, splice in the query that
 * enables both tools — the advanced tool is not servable otherwise. An existing
 * query string is preserved.
 *
 * @param baseURL - the configured MCP endpoint.
 * @returns the request URL with a non-empty `tools` query present.
 */
function endpointFor(baseURL: string): string {
	const queryIndex = baseURL.indexOf('?');
	if (queryIndex >= 0) {
		const tools = new URLSearchParams(baseURL.slice(queryIndex + 1)).get('tools');
		if (tools != null && tools.length > 0) return baseURL;
		return `${baseURL}&${MCP_TOOLS_QUERY}`;
	}
	return `${baseURL}?${MCP_TOOLS_QUERY}`;
}

/**
 * Map one sanitized advanced-tool result to a normalized source, or `undefined`
 * when it has no portable snippet. The advanced tool returns the REST result
 * vocabulary as JSON, so this mirrors {@link mapRestResult} — including its rule
 * that a snippet must be a real highlight, never the long-form `text` field,
 * because a fabricated snippet would make the seam lie.
 *
 * @param result - one structured entry from the sanitized response.
 * @returns a normalized source, or `undefined` when the entry is unusable.
 */
function mapAdvancedResult(
	result: unknown,
): { url: string; title?: string; snippet: string; publishedAt?: string } | undefined {
	if (typeof result !== 'object' || result === null) return undefined;
	const entry = result as ExaAdvancedResult;
	if (typeof entry.url !== 'string' || entry.url.length === 0) return undefined;
	const highlights = Array.isArray(entry.highlights) ? (entry.highlights as readonly unknown[]) : undefined;
	const snippet = highlights?.find(
		(highlight): highlight is string => typeof highlight === 'string' && highlight.trim().length > 0,
	);
	if (snippet === undefined) return undefined;
	const title = typeof entry.title === 'string' ? entry.title : undefined;
	const publishedDate = typeof entry.publishedDate === 'string' ? entry.publishedDate : undefined;
	return {
		url: entry.url,
		...(title != null && title.length > 0 ? { title } : {}),
		snippet,
		...(publishedDate != null && publishedDate.length > 0 ? { publishedAt: publishedDate } : {}),
	};
}

/**
 * Extract sources from a successful advanced-tool payload: the first text item
 * is the sanitized search response JSON, in the REST envelope shape
 * (`{ results: [...] }`).
 *
 * @param payload - the parsed JSON-RPC payload.
 * @returns the normalized sources, or `null` when the body is not the expected
 * shape — the caller then falls back to `Title:`-section parsing, so a future
 * change to the tool's output degrades instead of breaking.
 */
function parseAdvancedPayload(payload: McpPayload): WebSearchResult['sources'][number][] | null {
	const content = payload?.result?.content;
	if (!Array.isArray(content)) return null;
	const text = content.find((item) => typeof item?.text === 'string')?.text;
	if (text === undefined) return null;
	let parsed: ExaAdvancedResponse;
	try {
		parsed = JSON.parse(text) as ExaAdvancedResponse;
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	// An absent `results` key is a valid empty search, not a shape mismatch.
	if (parsed.results === undefined) return [];
	if (!Array.isArray(parsed.results)) return null;
	return parsed.results.map(mapAdvancedResult).filter((source) => source !== undefined);
}

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
 * How long a tripped breaker keeps `available()` false before the next search
 * is allowed to probe the anonymous endpoint again.
 */
export const DEFAULT_BREAKER_COOLDOWN_MS = 300_000;

/**
 * Consecutive transient failures that trip the breaker.
 *
 * Only 5xx, 429, and network-level failures count: they say the anonymous
 * endpoint is having a bad time, not that the request was wrong. A 4xx (other
 * than 429) is a configuration error and would fail identically forever, so it
 * deliberately does NOT trip the breaker — hiding a bad endpoint behind a
 * cooldown would just delay the same error.
 */
export const DEFAULT_BREAKER_THRESHOLD = 3;

/** A failure worth retrying later, as opposed to a permanent configuration error. */
export class ExaTransientError extends WebError {
	constructor(message: string, cause?: unknown) {
		super(message, 'WEB_PROVIDER_ERROR', cause === undefined ? undefined : { cause });
		this.name = 'ExaTransientError';
	}
}

/**
 * A rate limit, kept distinct from a generic provider failure so the model (and
 * a human reading the transcript) can tell "Exa is throttling the keyless
 * channel, configure a key" apart from "the network is broken".
 *
 * `code` is an open string in the seam's vocabulary, so a plugin-specific code
 * is the supported way to route this; consumers must tolerate unknown codes.
 */
export class ExaRateLimitError extends WebError {
	constructor(message: string) {
		super(message, 'WEB_RATE_LIMITED');
		this.name = 'ExaRateLimitError';
	}
}

/**
 * An anonymous response body that exceeded {@link MAX_MCP_RESPONSE_BYTES}.
 *
 * Extends {@link ExaTransientError} because the endpoint, not the caller's
 * configuration, produced it: a body this size is a bad day on Exa's side, and
 * the breaker should get to count it.
 */
export class ExaResponseTooLargeError extends ExaTransientError {
	/** The number of bytes observed, or `undefined` when the server declared the size. */
	readonly observedBytes: number | undefined;

	constructor(limit: number, observedBytes?: number) {
		super(
			`Exa anonymous MCP response exceeded ${limit} bytes` +
				(observedBytes === undefined ? '' : ` (received ${observedBytes})`),
		);
		this.name = 'ExaResponseTooLargeError';
		this.observedBytes = observedBytes;
	}
}

/**
 * Consecutive-transient-failure breaker for the keyless path.
 *
 * The public MCP endpoint is best-effort: when it is throttling or down, every
 * search would otherwise fail. Reporting that state through {@link
 * ExaSearchProvider.available} is what lets a deployment recover — the seam
 * skips an unavailable provider, so an unconfigured profile falls back to
 * another registered provider instead of surfacing a hard error.
 *
 * State is per provider instance (one per plugin mount) and never persisted:
 * a restart is a fresh chance, and one successful search resets the count.
 */
export class ExaAvailabilityBreaker {
	readonly #threshold: number;
	readonly #cooldownMs: number;
	#consecutiveFailures = 0;
	#openedAt: number | undefined;

	constructor(threshold: number = DEFAULT_BREAKER_THRESHOLD, cooldownMs: number = DEFAULT_BREAKER_COOLDOWN_MS) {
		this.#threshold = threshold;
		this.#cooldownMs = cooldownMs;
	}

	/** True while the breaker is open and the cooldown has not elapsed. */
	get blocked(): boolean {
		if (this.#openedAt === undefined) return false;
		return Date.now() - this.#openedAt < this.#cooldownMs;
	}

	/** Record one successful operation: the endpoint is healthy again. */
	succeeded(): void {
		this.#consecutiveFailures = 0;
		this.#openedAt = undefined;
	}

	/** Record one transient failure, opening the breaker at the threshold. */
	failed(): void {
		this.#consecutiveFailures += 1;
		if (this.#consecutiveFailures >= this.#threshold) this.#openedAt = Date.now();
	}
}

/**
 * True for an HTTP status that will keep failing until the endpoint recovers.
 * 429 is included: the keyless channel is throttled, not misconfigured.
 */
function isTransientStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

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
		mcpTool: section.mcpTool ?? DEFAULT_MCP_TOOL,
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
	readonly #resolveOptions: ExaOptionsResolver;
	readonly #resolveApiKey: ExaApiKeyResolver;
	readonly #breaker: ExaAvailabilityBreaker;

	/**
	 * @param resolveOptions - thunk returning the options for the NEXT
	 * operation, snapshotted once at each operation's entry so one search
	 * never mixes two settings sections (same pattern as the official
	 * DeepSeek provider).
	 * @param resolveApiKey - optional key resolver; dsh hosts pass their
	 * launch-environment snapshot while direct users retain process.env fallback.
	 * @param breaker - health tracker for the keyless path; injectable so tests
	 * need no clock control.
	 */
	constructor(
		resolveOptions: ExaOptionsResolver,
		resolveApiKey: ExaApiKeyResolver = resolveApiKeyFromProcess,
		breaker: ExaAvailabilityBreaker = new ExaAvailabilityBreaker(),
	) {
		this.#resolveOptions = resolveOptions;
		this.#resolveApiKey = resolveApiKey;
		this.#breaker = breaker;
	}

	/**
	 * Read per operation rather than frozen at construction: a Settings edit to
	 * `providerId` must not leave the provider reporting an id the registry does
	 * not key it under. Registering under the new id is the user's job (the
	 * loader re-reads config on reload), but the reported value stays honest.
	 */
	get id(): string {
		return this.#resolveOptions().providerId ?? DEFAULT_PROVIDER_ID;
	}

	/**
	 * Cheap local usability check — no network call, per the seam contract.
	 *
	 * False when the local options are unusable, or while the keyless channel's
	 * breaker is open after repeated transient failures. Reporting that honestly
	 * is what lets the seam fall back to another provider instead of failing the
	 * search: a pinned `searchProvider` surfaces
	 * `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`, an unpinned one simply selects
	 * another registered provider.
	 */
	available(): boolean {
		if (this.#breaker.blocked) return false;
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
		// The keyed REST path is a paid, authenticated endpoint: a failure there
		// is the caller's problem to see, not a reason to hide the provider.
		if (apiKey !== undefined) return await this.#restSearch(request, apiKey, options, signal);
		try {
			const result = await this.#anonymousMcpSearch(request, options, signal);
			this.#breaker.succeeded();
			return result;
		} catch (error) {
			if (error instanceof ExaTransientError) this.#breaker.failed();
			throw error;
		}
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
		const tool = options.mcpTool;
		const isAdvanced = tool === 'web_search_advanced_exa';
		const args: Record<string, unknown> = { query: request.query };
		const numResults = request.maxResults ?? options.numResults;
		if (numResults !== undefined) args.numResults = numResults;
		if (isAdvanced) {
			// The highlight request is not optional in practice: without it the
			// live endpoint returns text-only entries, every source lacks a
			// portable snippet, and the result is empty.
			//
			// `type` is deliberately NOT forwarded, even though the advanced tool
			// accepts one. The two vocabularies do not overlap — `searchType` is
			// the REST enum (`auto` | `keyword` | `neural`) while the tool's enum
			// is `auto` | `fast` | `instant` — so forwarding a configured
			// `keyword`/`neural` makes the tool fail argument validation and the
			// whole search with it (MCP error -32602). Omitting the argument
			// leaves the endpoint on its own default, which is what `auto` asks
			// for anyway: a call with `type: 'auto'` returns a byte-identical
			// response, so forwarding it would buy nothing and risk everything.
			args.enableHighlights = true;
			args.highlightsNumSentences = options.highlightsPerResult ?? DEFAULT_HIGHLIGHTS_PER_RESULT;
		}
		let response: Response;
		try {
			response = await fetch(isAdvanced ? endpointFor(options.mcpURL) : options.mcpURL, {
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
					params: { name: tool, arguments: args },
				}),
				...(signal !== undefined ? { signal } : {}),
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa anonymous search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			throw new ExaTransientError(`Exa anonymous search request failed: ${String(error)}`, error);
		}
		if (!response.ok) {
			if (response.status === 429) {
				throw new ExaRateLimitError(
					'Exa anonymous MCP rate limit reached (HTTP 429). The keyless channel is shared and throttled; ' +
						'set EXA_API_KEY (or a literal "apiKey" in the web-search-exa config) to use the keyed REST path.',
				);
			}
			if (isTransientStatus(response.status)) {
				throw new ExaTransientError(`Exa anonymous MCP error (HTTP ${response.status})`);
			}
			throw new WebError(`Exa anonymous MCP error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR');
		}
		let text: string;
		try {
			text = await readBoundedBody(response, MAX_MCP_RESPONSE_BYTES);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) {
				throw new WebError('Exa anonymous search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error });
			}
			// A too-large body is already the error we want to report; wrapping it
			// would bury the size detail inside a generic transport message.
			if (error instanceof ExaResponseTooLargeError) throw error;
			throw new ExaTransientError(`Exa returned an unprocessable response body: ${String(error)}`, error);
		}
		const payload = parseSsePayload(text);
		if (payload === null) {
			throw new ExaTransientError('Exa anonymous MCP returned an unprocessable response body');
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
		// Structured results when the advanced tool returned its expected shape;
		// otherwise fall back to `Title:` sections so a change in the tool's
		// output degrades instead of returning nothing.
		const structured = isAdvanced ? parseAdvancedPayload(payload) : null;
		if (structured !== null) return { sources: structured, truncated: false };
		const sources = mapMcpSections(splitExaSections(collectMcpText(payload).join('\n\n')));
		return { sources, truncated: false };
	}
}
