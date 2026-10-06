import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
//#region src/constants.ts
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
const DEFAULT_PROVIDER_ID = "exa";
/** Backward-compatible alias for the default provider id. */
const PROVIDER_ID = "exa";
/** Exa REST search endpoint; used only when an API key is configured. */
const DEFAULT_BASE_URL = "https://api.exa.ai";
/** Legacy full REST endpoint; `baseURL` is the canonical dsh-compatible option. */
const DEFAULT_API_URL = `${DEFAULT_BASE_URL}/search`;
/**
* Exa hosted MCP endpoint; the anonymous fallback path.
*
* The `tools` query is part of the default because `web_search_advanced_exa`
* is not servable without it — a request naming it against the bare endpoint
* fails with `MCP error -32602: Tool web_search_advanced_exa not found`.
* A configured `mcpURL` that omits `tools` gets the query spliced in at request
* time, so existing configurations keep working.
*/
const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa";
/** Environment variable consulted when no literal `apiKey` is configured. */
const DEFAULT_API_KEY_ENV = "EXA_API_KEY";
/** Default retrieval mode for the REST path: let Exa pick. */
const DEFAULT_SEARCH_TYPE = "auto";
/** Default number of highlight sentences requested per result (REST path). */
const DEFAULT_HIGHLIGHTS_PER_RESULT = 1;
/** MCP tool name for plain web search on Exa's hosted server (text-blob output). */
const MCP_TOOL = "web_search_exa";
/** MCP tool whose text content is a sanitized structured search response. */
const MCP_TOOL_ADVANCED = "web_search_advanced_exa";
/** The tool the anonymous path calls by default. */
const DEFAULT_MCP_TOOL = MCP_TOOL_ADVANCED;
/** Query parameter enabling both MCP tools when a configured URL omits it. */
const MCP_TOOLS_QUERY = "tools=web_search_exa,web_search_advanced_exa";
/**
* Reject anonymous MCP responses larger than this.
*
* Structured results are kilobytes; anything past this is a malformed or
* hostile body and parsing it would only burn memory before failing anyway.
*/
const MAX_MCP_RESPONSE_BYTES = 262144;
/**
* Attribution header sent on anonymous MCP requests. This is the only signal
* Exa's public endpoint receives about the caller, so it is deliberately a
* product-level name rather than a per-install identifier.
*/
const MCP_SOURCE = "dsh-anything";
/**
* User agent for REST requests.
*
* Annotated `: string` rather than left inferred: this constant is re-exported
* from the package root, and a `const` string infers a LITERAL type, which
* would bake today's version number into every consumer's type-checking.
*/
const USER_AGENT = "deepseek-harness-exa/0.1.5";
/** Snippet cap for text-derived snippets (matching oh-my-pi's choice). */
const MAX_SNIPPET_CHARS = 500;
/** Settings namespace carrying this provider's configuration. */
const SETTINGS_NAMESPACE = "web-search-exa";
//#endregion
//#region src/provider.ts
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
/** True for a positive whole number (cheap local config check). */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/** Throw the seam's stable cancellation error when the caller is already aborted. */
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal.reason });
}
/**
* Resolve the API key: literal config first, then the environment variable.
* `undefined` means the anonymous MCP path is used.
*/
function resolveApiKeyFromProcess(options) {
	if (options.apiKey != null && options.apiKey.length > 0) return options.apiKey;
	const fromEnv = process.env[options.apiKeyEnv];
	if (fromEnv != null && fromEnv.length > 0) return fromEnv;
}
/**
* Resolve a key against dsh's immutable launch-environment snapshot. The
* process fallback keeps direct library use and older hosts working.
*/
function resolveApiKey(options, environment) {
	if (options.apiKey != null && options.apiKey.length > 0) return options.apiKey;
	const fromEnvironment = environment?.get(options.apiKeyEnv)?.value;
	if (fromEnvironment != null && fromEnvironment.length > 0) return fromEnvironment;
	return resolveApiKeyFromProcess(options);
}
/**
* Map one Exa REST result to a normalized source, or `undefined` when it has
* no portable snippet (same rule as the official provider).
*/
function mapRestResult(result) {
	const snippet = result.highlights?.find((highlight) => highlight.trim().length > 0);
	if (snippet === void 0) return void 0;
	return {
		url: result.url,
		...result.title != null && result.title.length > 0 ? { title: result.title } : {},
		snippet,
		...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {}
	};
}
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
async function readBoundedBody(response, limit) {
	const declared = response.headers.get("content-length");
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
	const chunks = [];
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
function endpointFor(baseURL) {
	const queryIndex = baseURL.indexOf("?");
	if (queryIndex >= 0) {
		const tools = new URLSearchParams(baseURL.slice(queryIndex + 1)).get("tools");
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
function mapAdvancedResult(result) {
	if (typeof result !== "object" || result === null) return void 0;
	const entry = result;
	if (typeof entry.url !== "string" || entry.url.length === 0) return void 0;
	const snippet = (Array.isArray(entry.highlights) ? entry.highlights : void 0)?.find((highlight) => typeof highlight === "string" && highlight.trim().length > 0);
	if (snippet === void 0) return void 0;
	const title = typeof entry.title === "string" ? entry.title : void 0;
	const publishedDate = typeof entry.publishedDate === "string" ? entry.publishedDate : void 0;
	return {
		url: entry.url,
		...title != null && title.length > 0 ? { title } : {},
		snippet,
		...publishedDate != null && publishedDate.length > 0 ? { publishedAt: publishedDate } : {}
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
function parseAdvancedPayload(payload) {
	const content = payload?.result?.content;
	if (!Array.isArray(content)) return null;
	const text = content.find((item) => typeof item?.text === "string")?.text;
	if (text === void 0) return null;
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	if (parsed.results === void 0) return [];
	if (!Array.isArray(parsed.results)) return null;
	return parsed.results.map(mapAdvancedResult).filter((source) => source !== void 0);
}
/**
* Parse an SSE (`text/event-stream`) response body into its first `data:`
* payload, falling back to plain JSON. Returns `null` when neither parses.
*/
function parseSsePayload(text) {
	const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^\s/, ""));
	if (dataLines.length > 0) try {
		return JSON.parse(dataLines.join("\n"));
	} catch {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
/**
* Collect non-blank `content[].text` blocks from a normalized MCP result
* payload, joined with blank lines.
*/
function collectMcpText(payload) {
	const content = payload?.result?.content;
	if (!Array.isArray(content)) return [];
	return content.map((item) => typeof item?.text === "string" ? item.text.replace(/\r\n?/g, "\n").trim() : "").filter((text) => text.length > 0);
}
/**
* Parse one `Title:`-led section of Exa MCP text output into a partial source.
* Handles both `Published:` and `Published Date:` field spellings.
*/
function parseExaSection(section) {
	const out = {};
	let field = null;
	let textLines = null;
	for (const line of section.split("\n")) {
		const title = line.match(/^Title:\s*(.*)$/);
		const url = line.match(/^URL:\s*(.*)$/);
		const published = line.match(/^Published(?: Date)?:\s*(.*)$/);
		const author = line.match(/^Author:\s*(.*)$/);
		if (title) {
			out.title = title[1].trim();
			field = null;
		} else if (url) {
			out.url = url[1].trim();
			field = null;
		} else if (published) {
			out.publishedAt = published[1].trim();
			field = null;
		} else if (author) {
			out.author = author[1].trim();
			field = null;
		} else if (/^Highlights:\s*$/.test(line)) field = "highlights";
		else if (/^Text:\s*$/.test(line)) {
			field = "text";
			textLines = [];
		} else if (field === "highlights") {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				out.highlights ??= [];
				out.highlights.push(trimmed.replace(/^[-•]\s*/, ""));
			}
		} else if (field === "text" && textLines !== null) textLines.push(line);
	}
	if (textLines !== null) out.text = textLines.join("\n").trim();
	if (out.publishedAt === "N/A") delete out.publishedAt;
	if (out.author === "N/A") delete out.author;
	return out;
}
/** Split joined MCP text into per-result sections, each starting with `Title:`. */
function splitExaSections(joined) {
	return joined.split(/\n{2,}(?=Title:\s*)/).map((section) => section.trim()).filter((section) => section.length > 0 && section.startsWith("Title:"));
}
/** Map parsed Exa MCP sections to normalized sources (snippet-less entries dropped). */
function mapMcpSections(sections) {
	const sources = [];
	for (const section of sections) {
		const parsed = parseExaSection(section);
		if (!parsed.url || parsed.url.length === 0) continue;
		const snippet = parsed.highlights?.find((item) => item.trim().length > 0) ?? (parsed.text ? parsed.text.slice(0, 500) : void 0);
		if (snippet === void 0) continue;
		sources.push({
			url: parsed.url,
			...parsed.title != null && parsed.title.length > 0 ? { title: parsed.title } : {},
			snippet,
			...parsed.publishedAt != null && parsed.publishedAt.length > 0 ? { publishedAt: parsed.publishedAt } : {}
		});
	}
	return sources;
}
/**
* How long a tripped breaker keeps `available()` false before the next search
* is allowed to probe the anonymous endpoint again.
*/
const DEFAULT_BREAKER_COOLDOWN_MS = 3e5;
/**
* Consecutive transient failures that trip the breaker.
*
* Only 5xx, 429, and network-level failures count: they say the anonymous
* endpoint is having a bad time, not that the request was wrong. A 4xx (other
* than 429) is a configuration error and would fail identically forever, so it
* deliberately does NOT trip the breaker — hiding a bad endpoint behind a
* cooldown would just delay the same error.
*/
const DEFAULT_BREAKER_THRESHOLD = 3;
/** A failure worth retrying later, as opposed to a permanent configuration error. */
var ExaTransientError = class extends WebError {
	constructor(message, cause) {
		super(message, "WEB_PROVIDER_ERROR", cause === void 0 ? void 0 : { cause });
		this.name = "ExaTransientError";
	}
};
/**
* A rate limit, kept distinct from a generic provider failure so the model (and
* a human reading the transcript) can tell "Exa is throttling the keyless
* channel, configure a key" apart from "the network is broken".
*
* `code` is an open string in the seam's vocabulary, so a plugin-specific code
* is the supported way to route this; consumers must tolerate unknown codes.
*/
var ExaRateLimitError = class extends WebError {
	constructor(message) {
		super(message, "WEB_RATE_LIMITED");
		this.name = "ExaRateLimitError";
	}
};
/**
* An anonymous response body that exceeded {@link MAX_MCP_RESPONSE_BYTES}.
*
* Extends {@link ExaTransientError} because the endpoint, not the caller's
* configuration, produced it: a body this size is a bad day on Exa's side, and
* the breaker should get to count it.
*/
var ExaResponseTooLargeError = class extends ExaTransientError {
	/** The number of bytes observed, or `undefined` when the server declared the size. */
	observedBytes;
	constructor(limit, observedBytes) {
		super(`Exa anonymous MCP response exceeded ${limit} bytes` + (observedBytes === void 0 ? "" : ` (received ${observedBytes})`));
		this.name = "ExaResponseTooLargeError";
		this.observedBytes = observedBytes;
	}
};
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
var ExaAvailabilityBreaker = class {
	#threshold;
	#cooldownMs;
	#consecutiveFailures = 0;
	#openedAt;
	constructor(threshold = 3, cooldownMs = DEFAULT_BREAKER_COOLDOWN_MS) {
		this.#threshold = threshold;
		this.#cooldownMs = cooldownMs;
	}
	/** True while the breaker is open and the cooldown has not elapsed. */
	get blocked() {
		if (this.#openedAt === void 0) return false;
		return Date.now() - this.#openedAt < this.#cooldownMs;
	}
	/** Record one successful operation: the endpoint is healthy again. */
	succeeded() {
		this.#consecutiveFailures = 0;
		this.#openedAt = void 0;
	}
	/** Record one transient failure, opening the breaker at the threshold. */
	failed() {
		this.#consecutiveFailures += 1;
		if (this.#consecutiveFailures >= this.#threshold) this.#openedAt = Date.now();
	}
};
/**
* True for an HTTP status that will keep failing until the endpoint recovers.
* 429 is included: the keyless channel is throttled, not misconfigured.
*/
function isTransientStatus(status) {
	return status === 429 || status >= 500;
}
/**
* Project one resolved configuration section into the options the provider
* serves its next search with. Called per operation so live Settings edits
* take effect on the next search.
*/
function resolveOptions(section) {
	const baseURL = section.baseURL ?? "https://api.exa.ai";
	return {
		providerId: section.providerId ?? "exa",
		apiKey: section.apiKey ?? "",
		apiKeyEnv: section.apiKeyEnv ?? "EXA_API_KEY",
		baseURL,
		apiURL: section.apiURL ?? `${baseURL.replace(/\/+$/, "")}/search`,
		mcpURL: section.mcpURL ?? "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa",
		mcpTool: section.mcpTool ?? "web_search_advanced_exa",
		searchType: section.searchType ?? "auto",
		numResults: section.numResults,
		highlightsPerResult: section.highlightsPerResult ?? 1
	};
}
/** Resolve the keyed REST endpoint from either the current or legacy option shape. */
function resolveSearchURL(options) {
	if (options.apiURL != null) return options.apiURL;
	return `${(options.baseURL ?? "https://api.exa.ai").replace(/\/+$/, "")}/search`;
}
/**
* Exa-backed search with an anonymous fallback.
*
* Path selection is per search, not per install: a key appearing later (for
* example after a Settings edit) upgrades the next search to REST without a
* restart, and removing it falls back to the anonymous endpoint.
*/
var ExaSearchProvider = class {
	#resolveOptions;
	#resolveApiKey;
	#breaker;
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
	constructor(resolveOptions, resolveApiKey = resolveApiKeyFromProcess, breaker = new ExaAvailabilityBreaker()) {
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
	get id() {
		return this.#resolveOptions().providerId ?? "exa";
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
	available() {
		if (this.#breaker.blocked) return false;
		const options = this.#resolveOptions();
		return URL.canParse(resolveSearchURL(options)) && URL.canParse(options.mcpURL) && isPositiveInteger(options.highlightsPerResult) && (options.numResults === void 0 || isPositiveInteger(options.numResults));
	}
	async search(request, signal) {
		throwIfAborted(signal);
		const options = this.#resolveOptions();
		const apiKey = this.#resolveApiKey(options);
		if (apiKey !== void 0) return await this.#restSearch(request, apiKey, options, signal);
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
	async #restSearch(request, apiKey, options, signal) {
		throwIfAborted(signal);
		const numResults = request.maxResults ?? options.numResults;
		const apiURL = resolveSearchURL(options);
		let response;
		try {
			response = await fetch(apiURL, {
				method: "POST",
				redirect: "error",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
					accept: "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify({
					query: request.query,
					type: options.searchType,
					contents: { highlights: { highlightsPerUrl: options.highlightsPerResult } },
					...numResults !== void 0 ? { numResults } : {}
				}),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new WebError(`Exa search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `Exa API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = parsed.error ?? parsed.message;
				if (detail !== void 0 && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		let parsed;
		try {
			parsed = await response.json();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		return {
			sources: (parsed.results ?? []).map(mapRestResult).filter((source) => source !== void 0),
			truncated: false
		};
	}
	/**
	* Anonymous search through Exa's hosted MCP server. No credentials are
	* sent; the `x-exa-source` header carries attribution. Rate-limited by Exa
	* (HTTP 429) — configuring an API key lifts the limit via the REST path.
	*/
	async #anonymousMcpSearch(request, options, signal) {
		throwIfAborted(signal);
		const tool = options.mcpTool;
		const isAdvanced = tool === "web_search_advanced_exa";
		const args = { query: request.query };
		const numResults = request.maxResults ?? options.numResults;
		if (numResults !== void 0) args.numResults = numResults;
		if (isAdvanced) {
			args.enableHighlights = true;
			args.highlightsNumSentences = options.highlightsPerResult ?? 1;
		}
		let response;
		try {
			response = await fetch(isAdvanced ? endpointFor(options.mcpURL) : options.mcpURL, {
				method: "POST",
				redirect: "error",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"x-exa-source": MCP_SOURCE
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Math.random().toString(36).slice(2),
					method: "tools/call",
					params: {
						name: tool,
						arguments: args
					}
				}),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa anonymous search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new ExaTransientError(`Exa anonymous search request failed: ${String(error)}`, error);
		}
		if (!response.ok) {
			if (response.status === 429) throw new ExaRateLimitError("Exa anonymous MCP rate limit reached (HTTP 429). The keyless channel is shared and throttled; set EXA_API_KEY (or a literal \"apiKey\" in the web-search-exa config) to use the keyed REST path.");
			if (isTransientStatus(response.status)) throw new ExaTransientError(`Exa anonymous MCP error (HTTP ${response.status})`);
			throw new WebError(`Exa anonymous MCP error (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
		}
		let text;
		try {
			text = await readBoundedBody(response, MAX_MCP_RESPONSE_BYTES);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa anonymous search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			if (error instanceof ExaResponseTooLargeError) throw error;
			throw new ExaTransientError(`Exa returned an unprocessable response body: ${String(error)}`, error);
		}
		const payload = parseSsePayload(text);
		if (payload === null) throw new ExaTransientError("Exa anonymous MCP returned an unprocessable response body");
		if (payload.error != null) throw new WebError(`Exa MCP error: ${String(payload.error.message ?? JSON.stringify(payload.error))}`, "WEB_PROVIDER_ERROR");
		if (payload.result?.isError === true) {
			const detail = collectMcpText(payload).join("\n").trim();
			throw new WebError(`Exa MCP tool error${detail.length > 0 ? `: ${detail}` : ""}`, "WEB_PROVIDER_ERROR");
		}
		const structured = isAdvanced ? parseAdvancedPayload(payload) : null;
		if (structured !== null) return {
			sources: structured,
			truncated: false
		};
		return {
			sources: mapMcpSections(splitExaSections(collectMcpText(payload).join("\n\n"))),
			truncated: false
		};
	}
};
//#endregion
//#region src/index.ts
const Config = z.object({
	/**
	* Provider id registered into `ctx.web`. Defaults to `exa` (same as the
	* official `@deepseek-ai/dsh-web-search-exa`). Change it only when BOTH
	* packages are installed in one profile — the seam rejects duplicate ids
	* with `WEB_DUPLICATE_PROVIDER`. There is no silent override: pick a
	* distinct id here (e.g. `exa-anon`) and select it explicitly with
	* `searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`.
	*/
	providerId: z.string().default("exa"),
	/** Literal Exa API key; an empty/missing value enables the anonymous MCP path. */
	apiKey: z.string().role("secret"),
	/** Environment variable consulted when no literal `apiKey` is configured. */
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	/** Exa API base URL; `/search` is appended for the keyed REST path. */
	baseURL: z.string().default(DEFAULT_BASE_URL),
	/**
	* Legacy full REST endpoint. When set, it takes precedence over `baseURL`;
	* new configurations should use `baseURL` to match the official provider.
	*/
	apiURL: z.string(),
	/** Exa hosted MCP endpoint, used by the anonymous fallback. */
	mcpURL: z.string().default(DEFAULT_MCP_URL),
	/**
	* MCP tool the anonymous path calls. `web_search_advanced_exa` returns a
	* sanitized structured JSON response; `web_search_exa` returns the
	* `Title:`-section text blob. The structured tool is the default because it
	* needs no text parsing, and the text path stays available as a fallback.
	*/
	mcpTool: z.union(["web_search_exa", "web_search_advanced_exa"]).default(DEFAULT_MCP_TOOL),
	/** REST retrieval mode: `auto`, `keyword`, or `neural`. */
	searchType: z.union([
		"auto",
		"keyword",
		"neural"
	]).default(DEFAULT_SEARCH_TYPE),
	/** Default result count when the request carries no `maxResults`. */
	numResults: z.number().step(1).min(1),
	/** Highlight sentences requested per result on the REST path. */
	highlightsPerResult: z.number().step(1).min(1).default(1)
});
/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-exa";
/** The web seam this provider registers into. */
const inject = ["web"];
/**
* Wire the settings service when the host exposes the pre-0.1.7 registration
* API; do nothing (rather than throw) on hosts that do not.
*
* @param settings - the mounted settings service, of either generation.
* @param owner - the consuming context `installSection` attributes the section to.
* @param config - the composition entry, used as the section's base value.
* @param adopt - receives the authoritative section thunk so later searches read
* live edits instead of the boot-time config.
* @returns true when a section was installed.
*/
function installSettingsSection(settings, owner, config, adopt) {
	if (typeof settings.installSection !== "function") return false;
	settings.installSection(owner, SETTINGS_NAMESPACE, Config, config, {
		setSource: adopt,
		onChange: () => {}
	});
	return true;
}
/**
* Register the Exa search provider with `ctx.web` and, when the settings
* service is mounted *and* exposes the pre-0.1.7 registration API, install its
* Settings section.
*
* The settings work is deliberately inside `ctx.inject`, so a profile that
* omits `dsh-settings` still mounts the provider — keyless search must not
* depend on the Settings UI being present. The provider registration happens
* outside it for the same reason, and is never conditional on the settings
* generation.
*/
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(["settings"], (settingsCtx) => {
		installSettingsSection(settingsCtx.settings, ctx, config, (source) => {
			current = source;
		});
	});
	const environment = launchEnvironmentOf(ctx);
	ctx.web.registerSearchProvider(new ExaSearchProvider(() => resolveOptions(current()), (options) => resolveApiKey(options, environment)));
}
//#endregion
export { Config, DEFAULT_API_KEY_ENV, DEFAULT_API_URL, DEFAULT_BASE_URL, DEFAULT_BREAKER_COOLDOWN_MS, DEFAULT_BREAKER_THRESHOLD, DEFAULT_HIGHLIGHTS_PER_RESULT, DEFAULT_MCP_TOOL, DEFAULT_MCP_URL, DEFAULT_PROVIDER_ID, DEFAULT_SEARCH_TYPE, ExaAvailabilityBreaker, ExaRateLimitError, ExaResponseTooLargeError, ExaSearchProvider, ExaTransientError, MAX_MCP_RESPONSE_BYTES, MAX_SNIPPET_CHARS, MCP_SOURCE, MCP_TOOL, MCP_TOOLS_QUERY, MCP_TOOL_ADVANCED, PROVIDER_ID, SETTINGS_NAMESPACE, USER_AGENT, apply, inject, installSettingsSection, name, resolveApiKey, resolveApiKeyFromProcess, resolveOptions };
