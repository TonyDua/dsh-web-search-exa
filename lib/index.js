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
/** Exa hosted MCP endpoint; the anonymous fallback path. */
const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";
/** Environment variable consulted when no literal `apiKey` is configured. */
const DEFAULT_API_KEY_ENV = "EXA_API_KEY";
/** Default retrieval mode for the REST path: let Exa pick. */
const DEFAULT_SEARCH_TYPE = "auto";
/** Default number of highlight sentences requested per result (REST path). */
const DEFAULT_HIGHLIGHTS_PER_RESULT = 1;
/** MCP tool name for plain web search on Exa's hosted server. */
const MCP_TOOL = "web_search_exa";
/**
* Attribution header sent on anonymous MCP requests. This is the only signal
* Exa's public endpoint receives about the caller, so it is deliberately a
* product-level name rather than a per-install identifier.
*/
const MCP_SOURCE = "dsh-anything";
/** User agent for REST requests. */
const USER_AGENT = "deepseek-harness-exa/0.1.4";
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
		mcpURL: section.mcpURL ?? "https://mcp.exa.ai/mcp",
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
		const args = { query: request.query };
		const numResults = request.maxResults ?? options.numResults;
		if (numResults !== void 0) args.numResults = numResults;
		let response;
		try {
			response = await fetch(options.mcpURL, {
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
						name: MCP_TOOL,
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
		let payload;
		try {
			payload = parseSsePayload(await response.text());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa anonymous search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new ExaTransientError(`Exa returned an unprocessable response body: ${String(error)}`, error);
		}
		if (payload === null) throw new ExaTransientError("Exa anonymous MCP returned an unprocessable response body");
		if (payload.error != null) throw new WebError(`Exa MCP error: ${String(payload.error.message ?? JSON.stringify(payload.error))}`, "WEB_PROVIDER_ERROR");
		if (payload.result?.isError === true) {
			const detail = collectMcpText(payload).join("\n").trim();
			throw new WebError(`Exa MCP tool error${detail.length > 0 ? `: ${detail}` : ""}`, "WEB_PROVIDER_ERROR");
		}
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
* Register the Exa search provider with `ctx.web` and, when the optional
* settings service is mounted, install its Settings section.
*
* The settings install is deliberately inside `ctx.inject`, so a profile that
* omits `dsh-settings` still mounts the provider — keyless search must not
* depend on the Settings UI being present.
*/
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
			setSource: (source) => {
				current = source;
			},
			onChange: () => {}
		});
	});
	const environment = launchEnvironmentOf(ctx);
	ctx.web.registerSearchProvider(new ExaSearchProvider(() => resolveOptions(current()), (options) => resolveApiKey(options, environment)));
}
//#endregion
export { Config, DEFAULT_API_KEY_ENV, DEFAULT_API_URL, DEFAULT_BASE_URL, DEFAULT_BREAKER_COOLDOWN_MS, DEFAULT_BREAKER_THRESHOLD, DEFAULT_HIGHLIGHTS_PER_RESULT, DEFAULT_MCP_URL, DEFAULT_PROVIDER_ID, DEFAULT_SEARCH_TYPE, ExaAvailabilityBreaker, ExaRateLimitError, ExaSearchProvider, ExaTransientError, MAX_SNIPPET_CHARS, MCP_SOURCE, MCP_TOOL, PROVIDER_ID, SETTINGS_NAMESPACE, USER_AGENT, apply, inject, name, resolveApiKey, resolveApiKeyFromProcess, resolveOptions };
