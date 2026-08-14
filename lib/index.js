/**
 * @tonydua/dsh-web-search-exa
 *
 * Exa-backed `WebSearchProvider` for the DeepSeek Harness web capability seam
 * (`ctx.web`), with an **anonymous** fallback: when no API key is configured,
 * search routes through Exa's hosted MCP server (`https://mcp.exa.ai/mcp`) via
 * JSON-RPC 2.0 with no credentials — Exa's documented unauthenticated public
 * MCP fallback (rate-limited). With a key, the lighter REST endpoint
 * (`POST {apiURL}`) is used instead, mirroring `@deepseek-ai/dsh-web-search-exa`.
 *
 * The anonymous-MCP strategy and its response parsing follow the `web_search`
 * implementation in can1357/oh-my-pi (see README acknowledgements).
 *
 * This is an implementation package: it registers a provider INTO `ctx.web`
 * (`inject: ['web']`) and owns no model-facing tools (those belong to
 * `@deepseek-ai/dsh-tool-web`). It also installs a Settings section
 * (`web-search-exa`) into the settings service; editing it from the Web UI
 * needs a client card (planned for a later version) — today it is configured
 * through the profile patch layer (see README "In the Web panel").
 */

import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { WebError } from "@deepseek-ai/dsh-web";
import z from "@deepseek-ai/schemastery";

/** Default provider id this provider registers under (`ctx.web` registry key). */
const DEFAULT_PROVIDER_ID = "exa";
/** Backward-compatible alias for the default provider id. */
const PROVIDER_ID = DEFAULT_PROVIDER_ID;
/** Exa REST search endpoint; used only when an API key is configured. */
const DEFAULT_API_URL = "https://api.exa.ai/search";
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
/** Attribution header sent on anonymous MCP requests. Bump with the version. */
const MCP_SOURCE = "dsh-anything";
/** User agent for REST requests. */
const USER_AGENT = "deepseek-harness-exa/0.1.0";
/** Snippet cap for text-derived snippets (matching oh-my-pi's choice). */
const MAX_SNIPPET_CHARS = 500;
/** Settings namespace carrying this provider's configuration. */
const SETTINGS_NAMESPACE = settingsNamespace("web-search-exa");

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
	if (signal?.aborted === true) {
		throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal.reason });
	}
}

/**
 * Resolve the API key: literal config first, then the environment variable.
 * `undefined` means the anonymous MCP path is used.
 */
function resolveApiKey(options) {
	if (options.apiKey != null && options.apiKey.length > 0) return options.apiKey;
	const fromEnv = process.env[options.apiKeyEnv];
	if (fromEnv != null && fromEnv.length > 0) return fromEnv;
	return undefined;
}

// ── REST path (with API key) ────────────────────────────────────────────────

/**
 * Map one Exa REST result to a normalized source, or `undefined` when it has
 * no portable snippet (same rule as the official provider).
 */
function mapRestResult(result) {
	const snippet = result.highlights?.find((highlight) => highlight.trim().length > 0);
	if (snippet === undefined) return undefined;
	return {
		url: result.url,
		...result.title != null && result.title.length > 0 ? { title: result.title } : {},
		snippet,
		...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
	};
}

// ── Anonymous MCP path (no API key) ─────────────────────────────────────────

/**
 * Parse an SSE (`text/event-stream`) response body into its first `data:`
 * payload, falling back to plain JSON. Returns `null` when neither parses.
 */
function parseSsePayload(text) {
	const dataLines = text.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^\s/, ""));
	if (dataLines.length > 0) {
		try {
			return JSON.parse(dataLines.join("\n"));
		} catch {
			return null;
		}
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
	return content
		.map((item) => (typeof item?.text === "string" ? item.text.replace(/\r\n?/g, "\n").trim() : ""))
		.filter((text) => text.length > 0);
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
		} else if (/^Highlights:\s*$/.test(line)) {
			field = "highlights";
		} else if (/^Text:\s*$/.test(line)) {
			field = "text";
			textLines = [];
		} else if (field === "highlights") {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				out.highlights ??= [];
				out.highlights.push(trimmed.replace(/^[-•]\s*/, ""));
			}
		} else if (field === "text" && textLines !== null) {
			textLines.push(line);
		}
	}
	if (textLines !== null) out.text = textLines.join("\n").trim();
	if (out.publishedAt === "N/A") delete out.publishedAt;
	if (out.author === "N/A") delete out.author;
	return out;
}

/** Split joined MCP text into per-result sections, each starting with `Title:`. */
function splitExaSections(joined) {
	return joined
		.split(/\n{2,}(?=Title:\s*)/)
		.map((section) => section.trim())
		.filter((section) => section.length > 0 && section.startsWith("Title:"));
}

/** Map parsed Exa MCP sections to normalized sources (snippet-less entries dropped). */
function mapMcpSections(sections) {
	const sources = [];
	for (const section of sections) {
		const parsed = parseExaSection(section);
		if (!parsed.url || parsed.url.length === 0) continue;
		const highlight = parsed.highlights?.find((item) => item.trim().length > 0);
		const snippet = highlight ?? (parsed.text ? parsed.text.slice(0, MAX_SNIPPET_CHARS) : undefined);
		if (snippet === undefined) continue;
		sources.push({
			url: parsed.url,
			...parsed.title != null && parsed.title.length > 0 ? { title: parsed.title } : {},
			snippet,
			...parsed.publishedAt != null && parsed.publishedAt.length > 0 ? { publishedAt: parsed.publishedAt } : {},
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
function resolveOptions(section) {
	return {
		providerId: section.providerId ?? DEFAULT_PROVIDER_ID,
		apiKey: section.apiKey ?? "",
		apiKeyEnv: section.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
		apiURL: section.apiURL ?? DEFAULT_API_URL,
		mcpURL: section.mcpURL ?? DEFAULT_MCP_URL,
		searchType: section.searchType ?? DEFAULT_SEARCH_TYPE,
		numResults: section.numResults,
		highlightsPerResult: section.highlightsPerResult ?? DEFAULT_HIGHLIGHTS_PER_RESULT,
	};
}

class ExaSearchProvider {
	resolveOptions;
	id;

	/**
	 * @param resolveOptions - thunk returning the options for the NEXT
	 * operation, snapshotted once at each operation's entry so one search
	 * never mixes two settings sections (same pattern as the official
	 * DeepSeek provider).
	 */
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
		this.id = resolveOptions().providerId ?? PROVIDER_ID;
	}

	/** The anonymous MCP path needs no credentials, so the provider is always usable. */
	available() {
		const options = this.resolveOptions();
		return URL.canParse(options.apiURL) && URL.canParse(options.mcpURL);
	}

	async search(request, signal) {
		throwIfAborted(signal);
		const options = this.resolveOptions();
		const apiKey = resolveApiKey(options);
		return apiKey !== undefined
			? await this.#restSearch(request, apiKey, options, signal)
			: await this.#anonymousMcpSearch(request, options, signal);
	}

	/** REST search with an API key: `POST {apiURL}` with Bearer auth. */
	async #restSearch(request, apiKey, options, signal) {
		throwIfAborted(signal);
		const numResults = request.maxResults ?? options.numResults;
		let response;
		try {
			response = await fetch(options.apiURL, {
				method: "POST",
				redirect: "error",
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT,
				},
				body: JSON.stringify({
					query: request.query,
					type: options.searchType,
					contents: { highlights: { highlightsPerUrl: options.highlightsPerResult } },
					...numResults !== undefined ? { numResults } : {},
				}),
				...signal !== undefined ? { signal } : {},
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
				if (detail !== undefined && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
				// keep the generic message
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
		const sources = (parsed.results ?? []).map(mapRestResult).filter((source) => source !== undefined);
		return { sources, truncated: false };
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
		if (numResults !== undefined) args.numResults = numResults;
		let response;
		try {
			response = await fetch(options.mcpURL, {
				method: "POST",
				redirect: "error",
				headers: {
					"content-type": "application/json",
					"accept": "application/json, text/event-stream",
					"x-exa-source": MCP_SOURCE,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Math.random().toString(36).slice(2),
					method: "tools/call",
					params: { name: MCP_TOOL, arguments: args },
				}),
				...signal !== undefined ? { signal } : {},
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa anonymous search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new WebError(`Exa anonymous search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			if (response.status === 429) {
				throw new WebError(
					"Exa anonymous MCP rate limit reached (HTTP 429); configure an EXA_API_KEY for higher limits",
					"WEB_PROVIDER_ERROR",
				);
			}
			throw new WebError(`Exa anonymous MCP error (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
		}
		let payload;
		try {
			payload = parseSsePayload(await response.text());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw new WebError("Exa anonymous search aborted", "WEB_ABORTED", { cause: signal?.reason ?? error });
			throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (payload === null) {
			throw new WebError("Exa anonymous MCP returned an unprocessable response body", "WEB_PROVIDER_ERROR");
		}
		if (payload.error != null) {
			throw new WebError(`Exa MCP error: ${String(payload.error.message ?? JSON.stringify(payload.error))}`, "WEB_PROVIDER_ERROR");
		}
		if (payload.result?.isError === true) {
			const detail = collectMcpText(payload).join("\n").trim();
			throw new WebError(`Exa MCP tool error${detail.length > 0 ? `: ${detail}` : ""}`, "WEB_PROVIDER_ERROR");
		}
		const sections = splitExaSections(collectMcpText(payload).join("\n\n"));
		const sources = mapMcpSections(sections);
		return { sources, truncated: false };
	}
}

// ── Cordis plugin wiring ────────────────────────────────────────────────────

/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-exa";
/** The web seam this provider registers into. */
const inject = ["web"];

const Config = z.object({
	/**
	 * Provider id registered into `ctx.web`. Defaults to `exa` (same as the
	 * official `@deepseek-ai/dsh-web-search-exa`). Change it only when BOTH
	 * packages are installed in one profile — the seam rejects duplicate ids
	 * with `WEB_DUPLICATE_PROVIDER`. There is no silent override: pick a
	 * distinct id here (e.g. `exa-anon`) and select it explicitly with
	 * `searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`.
	 */
	providerId: z.string().default(DEFAULT_PROVIDER_ID),
	/** Literal Exa API key; an empty/missing value enables the anonymous MCP path. */
	apiKey: z.string().role("secret"),
	/** Environment variable consulted when no literal `apiKey` is configured. */
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	/** REST search endpoint, used only when an API key is available. */
	apiURL: z.string().default(DEFAULT_API_URL),
	/** Exa hosted MCP endpoint, used by the anonymous fallback. */
	mcpURL: z.string().default(DEFAULT_MCP_URL),
	/** REST retrieval mode: `auto`, `keyword`, or `neural`. */
	searchType: z.union(["auto", "keyword", "neural"]).default(DEFAULT_SEARCH_TYPE),
	/** Default result count when the request carries no `maxResults`. */
	numResults: z.number().step(1).min(1),
	/** Highlight sentences requested per result on the REST path. */
	highlightsPerResult: z.number().step(1).min(1).default(DEFAULT_HIGHLIGHTS_PER_RESULT),
});

/**
 * Register the Exa search provider with `ctx.web` and install its Settings
 * section, so the Web panel edits the same config the provider serves.
 */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
	});
	ctx.web.registerSearchProvider(new ExaSearchProvider(() => resolveOptions(current())));
}

export {
	Config,
	DEFAULT_API_KEY_ENV,
	DEFAULT_API_URL,
	DEFAULT_HIGHLIGHTS_PER_RESULT,
	DEFAULT_MCP_URL,
	DEFAULT_PROVIDER_ID,
	DEFAULT_SEARCH_TYPE,
	PROVIDER_ID,
	SETTINGS_NAMESPACE,
	ExaSearchProvider,
	apply,
	inject,
	name,
};
