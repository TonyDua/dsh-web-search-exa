import assert from "node:assert/strict";
import test from "node:test";

import { apply, ExaAvailabilityBreaker, ExaSearchProvider, installSettingsSection } from "../lib/index.js";

const baseOptions = {
	apiKey: "",
	apiKeyEnv: "__DSH_EXA_TEST_KEY__",
	baseURL: "https://api.exa.ai",
	apiURL: "https://api.exa.ai/search",
	// Deliberately the BARE endpoint (no tools query): the provider is expected
	// to splice it in, so every anonymous test also exercises that path.
	mcpURL: "https://mcp.exa.ai/mcp",
	mcpTool: "web_search_advanced_exa",
	searchType: "auto",
	numResults: 3,
	highlightsPerResult: 1,
};

function provider(overrides = {}) {
	const options = { ...baseOptions, ...overrides };
	return new ExaSearchProvider(() => options);
}

/** A provider wired to an injected breaker and fixed options. */
function providerWith(breaker, overrides = {}) {
	const options = { ...baseOptions, ...overrides };
	return new ExaSearchProvider(() => options, undefined, breaker);
}

test("provider id defaults to exa and honors the providerId switch", () => {
	assert.equal(provider().id, "exa");
	assert.equal(provider({ providerId: "exa-anon" }).id, "exa-anon");
});

function appliedProvider(config = baseOptions, environmentValues = {}) {
	let registered;
	let installArgs;
	const environment = {
		get(name) {
			const value = environmentValues[name];
			return value === undefined ? undefined : { value, source: "process" };
		},
	};
	const ctx = {
		get(key) {
			return key === "launchEnvironment" ? environment : undefined;
		},
		inject(deps, callback) {
			assert.deepEqual(deps, ["settings"]);
			callback({
				settings: {
					installSection(...args) {
						installArgs = args;
						args[4].setSource(() => args[3]);
					},
				},
			});
		},
		web: {
			registerSearchProvider(value) {
				registered = value;
			},
		},
	};
	apply(ctx, config);
	return { installArgs, provider: registered };
}

test("apply uses the dsh 0.1.2 settings API and launch environment", async () => {
	const { installArgs, provider: registered } = appliedProvider(
		{ ...baseOptions, apiKey: "" },
		{ __DSH_EXA_TEST_KEY__: "ambient-secret" },
	);
	assert.equal(installArgs[1], "web-search-exa");
	assert.equal(registered.id, "exa");

	let call;
	await withFetch(async (url, init) => {
		call = { url: String(url), init };
		return new Response(JSON.stringify({ results: [] }), { status: 200 });
	}, () => registered.search({ query: "example" }));
	assert.equal(call.init.headers.authorization, "Bearer ambient-secret");
});

test("baseURL follows the current official Exa option shape", async () => {
	const { provider: registered } = appliedProvider({
		...baseOptions,
		apiKey: "secret",
		apiURL: undefined,
		baseURL: "https://exa.example/v1/",
	});
	let url;
	await withFetch(async (requestUrl) => {
		url = String(requestUrl);
		return new Response(JSON.stringify({ results: [] }), { status: 200 });
	}, () => registered.search({ query: "example" }));
	assert.equal(url, "https://exa.example/v1/search");
});

function withFetch(stub, callback) {
	const original = globalThis.fetch;
	globalThis.fetch = stub;
	return Promise.resolve()
		.then(callback)
		.finally(() => {
			globalThis.fetch = original;
		});
}

function mcpResponse(payload) {
	return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

test("anonymous MCP search sends no credentials and maps SSE results", async () => {
	let call;
	const result = await withFetch(async (url, init) => {
		call = { url: String(url), init };
		return mcpResponse({
			result: {
				content: [{
					type: "text",
					text: "Title: Example\nURL: https://example.com\nPublished: 2026-08-14\nHighlights:\nA useful result",
				}],
			},
		});
	}, () => provider().search({ query: "example" }));

	// baseOptions pins the bare endpoint on purpose: the provider must splice in
	// the tools query itself, because the advanced tool is not servable without
	// it. This asserts the splicing, not the default constant.
	assert.equal(call.url, "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa");
	assert.equal(call.init.headers.authorization, undefined);
	assert.equal(call.init.headers["x-exa-source"], "dsh-anything");
	// A non-JSON body must fall back to Title:-section parsing rather than
	// returning nothing, so the text path stays covered here.
	//
	// `type` must NOT appear: the advanced tool's enum (`auto | fast |
	// instant`) is not the REST enum (`auto | keyword | neural`), so
	// forwarding a configured `keyword`/`neural` fails the tool's argument
	// validation and takes the whole anonymous path down with it.
	assert.deepEqual(JSON.parse(call.init.body).params.arguments, {
		query: "example",
		numResults: 3,
		enableHighlights: true,
		highlightsNumSentences: 1,
	});
	assert.deepEqual(result.sources, [{
		url: "https://example.com",
		title: "Example",
		snippet: "A useful result",
		publishedAt: "2026-08-14",
	}]);
});

test("request maxResults overrides the anonymous default", async () => {
	let body;
	await withFetch(async (_url, init) => {
		body = JSON.parse(init.body);
		return mcpResponse({ result: { content: [] } });
	}, () => provider({ numResults: 9 }).search({ query: "example", maxResults: 2 }));
	assert.equal(body.params.arguments.numResults, 2);
});

test("REST search uses the configured API key and normalizes highlights", async () => {
	let call;
	const result = await withFetch(async (url, init) => {
		call = { url: String(url), init };
		return new Response(JSON.stringify({ results: [{
			url: "https://example.com/rest",
			title: "REST result",
			highlights: ["REST highlight"],
			publishedDate: "2026-08-14T00:00:00Z",
		}] }), { status: 200, headers: { "content-type": "application/json" } });
	}, () => provider({ apiKey: "secret" }).search({ query: "example", maxResults: 1 }));

	assert.equal(call.url, "https://api.exa.ai/search");
	assert.equal(call.init.headers.authorization, "Bearer secret");
	assert.equal(JSON.parse(call.init.body).numResults, 1);
	assert.deepEqual(result.sources[0], {
		url: "https://example.com/rest",
		title: "REST result",
		snippet: "REST highlight",
		publishedAt: "2026-08-14T00:00:00Z",
	});
});

test("MCP tool errors become WEB_PROVIDER_ERROR", async () => {
	await assert.rejects(
		withFetch(async () => mcpResponse({ result: { isError: true, content: [{ type: "text", text: "rate limited" }] } }),
			() => provider().search({ query: "example" })),
		error => error.code === "WEB_PROVIDER_ERROR" && /rate limited/.test(error.message),
	);
});

test("already-aborted searches use the seam cancellation code", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await assert.rejects(
			provider().search({ query: "example" }, controller.signal),
			error => error.code === "WEB_ABORTED",
		);
});

// ── Regressions: health reporting, honest id, actionable rate limits ────────

test("id follows a live providerId change instead of freezing at construction", () => {
	let section = { ...baseOptions, providerId: "exa-anon" };
	const instance = new ExaSearchProvider(() => section);
	assert.equal(instance.id, "exa-anon");

	// A Settings edit swaps the authoritative section; the reported id must follow.
	section = { ...section, providerId: "exa-renamed" };
	assert.equal(instance.id, "exa-renamed");

	// Absent again: fall back to the documented default.
	section = { ...section, providerId: undefined };
	assert.equal(instance.id, "exa");
});

test("repeated transient anonymous failures make the provider report unavailable", async () => {
	const breaker = new ExaAvailabilityBreaker(3, 60_000);
	const instance = providerWith(breaker);
	assert.equal(instance.available(), true);

	await withFetch(async () => new Response("upstream boom", { status: 503 }), async () => {
		// Below the threshold the provider still advertises itself.
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
		assert.equal(instance.available(), true, "two failures must not trip the breaker");

		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
		assert.equal(instance.available(), false, "the third transient failure must open the breaker");
	});
});

test("one successful search closes the breaker again", async () => {
	const breaker = new ExaAvailabilityBreaker(1, 60_000);
	const instance = providerWith(breaker);

	await withFetch(async () => new Response("boom", { status: 500 }), () =>
		assert.rejects(instance.search({ query: "example" })));
	assert.equal(instance.available(), false);

	await withFetch(async () => mcpResponse({ result: { content: [] } }), () =>
		instance.search({ query: "example" }));
	assert.equal(instance.available(), true, "a healthy search must clear the failure state");
});

test("a 4xx configuration error does not trip the breaker", async () => {
	const breaker = new ExaAvailabilityBreaker(2, 60_000);
	const instance = providerWith(breaker);

	await withFetch(async () => new Response("nope", { status: 404 }), async () => {
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
	});
	assert.equal(instance.available(), true, "a permanent 4xx would fail identically forever; do not hide it");
});

test("anonymous 429 surfaces WEB_RATE_LIMITED with an actionable message", async () => {
	await assert.rejects(
		withFetch(async () => new Response("slow down", { status: 429 }),
			() => provider().search({ query: "example" })),
		error => error.code === "WEB_RATE_LIMITED" && /EXA_API_KEY/.test(error.message),
	);
});

test("the keyed REST path is never hidden by the breaker", async () => {
	const breaker = new ExaAvailabilityBreaker(1, 60_000);
	const instance = providerWith(breaker, { apiKey: "secret" });

	await withFetch(async () => new Response("boom", { status: 500 }), async () => {
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
		await assert.rejects(instance.search({ query: "example" }), error => error.code === "WEB_PROVIDER_ERROR");
	});
	assert.equal(instance.available(), true, "a paid endpoint failure is the caller's to see, not something to hide");
});

// ── Cross-version: the settings service changed shape in dsh 0.1.7 ──────────

test("a dsh >= 0.1.7 settings service (no installSection) is tolerated", () => {
	// 0.1.7 replaced SettingsProvider.installSection with SettingsForms, which
	// derives the page from the entry's Config schema instead. The plugin has
	// nothing to register there and must return false rather than throw.
	const newer = { configure() {}, describe() {}, prepareDocument() {} };
	const adopted = [];
	assert.equal(
		installSettingsSection(newer, {}, { ...baseOptions }, source => adopted.push(source)),
		false,
	);
	assert.deepEqual(adopted, [], "nothing to adopt when there is no authoritative source");
});

test("apply still registers the provider on a dsh >= 0.1.7 settings service", () => {
	let registered;
	const ctx = {
		get(key) {
			return key === "launchEnvironment" ? { get: () => undefined } : undefined;
		},
		inject(deps, callback) {
			assert.deepEqual(deps, ["settings"]);
			// A 0.1.7-shaped service: no installSection anywhere.
			callback({ settings: { configure() {}, describe() {} } });
		},
		web: {
			registerSearchProvider(value) {
				registered = value;
			},
		},
	};
	assert.doesNotThrow(() => apply(ctx, { ...baseOptions }));
	assert.equal(registered?.id, "exa", "the provider must register regardless of the settings generation");
});

test("installSettingsSection reports true and adopts the source on the older API", () => {
	const entry = { ...baseOptions };
	let installed;
	const older = {
		installSection(...args) {
			installed = args;
			args[4].setSource(() => ({ ...entry, numResults: 42 }));
		},
	};
	let current = () => entry;
	assert.equal(
		installSettingsSection(older, "owner-ctx", entry, source => {
			current = source;
		}),
		true,
	);
	assert.equal(installed[1], "web-search-exa", "namespace must stay stable across versions");
	assert.equal(current().numResults, 42, "live edits must reach the provider");
});

// ── Structured anonymous path (web_search_advanced_exa) ─────────────────────

/** The full JSON-RPC payload whose text content is the sanitized structured envelope. */
function structuredEnvelope(envelope) {
	return { result: { content: [{ type: "text", text: JSON.stringify(envelope) }] } };
}

/** An MCP response whose text content is the sanitized structured envelope. */
function structuredResponse(envelope) {
	return mcpResponse(structuredEnvelope(envelope));
}

const STRUCTURED = {
	requestId: "req-1",
	resolvedSearchType: "auto",
	results: [
		{
			id: "https://example.com/a",
			url: "https://example.com/a",
			title: "Structured A",
			publishedDate: "2026-08-14",
			highlights: ["First highlight"],
			text: "# long page text that must NOT become the snippet",
		},
		// No highlight: must be dropped, not given a snippet from `text`.
		{ url: "https://example.com/no-highlight", title: "Dropped", text: "body only" },
		// Blank highlight: same rule.
		{ url: "https://example.com/blank", highlights: ["   "] },
		{ title: "No url at all", highlights: ["x"] },
	],
};

test("structured anonymous results map without text parsing", async () => {
	let body;
	const result = await withFetch(async (_url, init) => {
		body = JSON.parse(init.body);
		return structuredResponse(STRUCTURED);
	}, () => provider().search({ query: "example" }));

	assert.equal(body.params.name, "web_search_advanced_exa");
	assert.deepEqual(result.sources, [{
		url: "https://example.com/a",
		title: "Structured A",
		snippet: "First highlight",
		publishedAt: "2026-08-14",
	}], "snippet-less and url-less entries must be dropped, never back-filled from text");
});

test("mcpTool selects the text-blob path when pinned to web_search_exa", async () => {
	let call;
	const result = await withFetch(async (url, init) => {
		call = { url: String(url), body: JSON.parse(init.body) };
		return mcpResponse({
			result: { content: [{ type: "text", text: "Title: T\nURL: https://example.com/t\nHighlights:\nH" }] },
		});
	}, () => provider({ mcpTool: "web_search_exa" }).search({ query: "example" }));

	assert.equal(call.body.params.name, "web_search_exa");
	assert.equal(call.url, "https://mcp.exa.ai/mcp", "the text tool needs no tools query");
	// No highlight-request arguments on the text path.
	assert.deepEqual(call.body.params.arguments, { query: "example", numResults: 3 });
	assert.equal(result.sources[0].snippet, "H");
});

test("an MCP URL that already carries tools is left byte-for-byte alone", async () => {
	const withTools = "https://mcp.exa.ai/mcp?tools=web_search_exa&other=1";
	let url;
	await withFetch(async (requestUrl) => {
		url = String(requestUrl);
		return structuredResponse({ results: [] });
	}, () => provider({ mcpURL: withTools }).search({ query: "example" }));
	assert.equal(url, withTools);
});

test("a tools query with an existing but empty value is completed", async () => {
	let url;
	await withFetch(async (requestUrl) => {
		url = String(requestUrl);
		return structuredResponse({ results: [] });
	}, () => provider({ mcpURL: "https://mcp.exa.ai/mcp?x=1&tools=" }).search({ query: "example" }));
	assert.equal(url, "https://mcp.exa.ai/mcp?x=1&tools=&tools=web_search_exa,web_search_advanced_exa");
});

/**
 * An SSE MCP response with an explicit `content-length` header.
 *
 * `new Response(string)` sets no such header, so the size-cap tests have to
 * declare it themselves: without one the provider cannot pre-flight the size
 * and must fall back to counting bytes while streaming. Both paths therefore
 * need their own case, and this helper builds the first.
 */
function mcpResponseWithLength(payload) {
	const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
	return new Response(body, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
			"content-length": String(new TextEncoder().encode(body).byteLength),
		},
	});
}

test("a declared over-limit content-length is rejected without reading the body", async () => {
	const huge = "x".repeat(256 * 1024 + 1);
	await assert.rejects(
		withFetch(async () => mcpResponseWithLength({ result: { content: [{ type: "text", text: huge }] } }),
			() => provider().search({ query: "example" })),
		error => /exceeded 262144 bytes/.test(error.message),
	);
});

test("a response within its declared content-length still reads normally", async () => {
	// The other half of the pre-flight branch: a present, in-limit header must
	// not itself become a rejection. The envelope is the full JSON-RPC payload
	// (`result.content[].text`), not just the inner search response.
	const result = await withFetch(async () =>
		mcpResponseWithLength(structuredEnvelope({ results: [{ url: "https://example.com/a", highlights: ["H"] }] })),
		() => provider().search({ query: "example" }));
	assert.deepEqual(result.sources, [{ url: "https://example.com/a", snippet: "H" }]);
});

test("a body that outgrows the cap mid-stream is aborted, not buffered", async () => {
	// A chunk stream that never ends on its own: it only stops when the provider
	// cancels it, which is exactly the behavior under test. A guard that ran
	// after `response.text()` would hang here instead of throwing.
	let cancelled = false;
	const stream = new ReadableStream({
		pull(controller) {
			if (cancelled) return;
			controller.enqueue(new Uint8Array(64 * 1024));
		},
		cancel() {
			cancelled = true;
		},
	});
	await assert.rejects(
		withFetch(async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
			() => provider().search({ query: "example" })),
		error => /exceeded 262144 bytes/.test(error.message),
	);
	assert.equal(cancelled, true, "the transfer must be aborted once the cap is passed");
});

test("the anonymous path never forwards the REST searchType to the advanced tool", async () => {
	// The regression that motivates this test: `searchType` is the REST enum
	// (`auto | keyword | neural`) while the advanced tool accepts only
	// `auto | fast | instant`, so forwarding `neural` made the tool answer
	// `MCP error -32602: Input validation error` and the whole search failed.
	// `keyword` is covered because it is equally invalid on the tool's side.
	for (const searchType of ["neural", "keyword", "auto"]) {
		let body;
		await withFetch(async (_url, init) => {
			body = JSON.parse(init.body);
			return structuredResponse({ results: [] });
		}, () => provider({ searchType }).search({ query: "example" }));
		assert.equal(body.params.arguments.type, undefined,
			`searchType "${searchType}" must not reach the advanced tool`);
		assert.deepEqual(body.params.arguments, {
			query: "example",
			numResults: 3,
			enableHighlights: true,
			highlightsNumSentences: 1,
		});
	}
});

test("a non-structured body falls back to section parsing instead of failing", async () => {
	// Simulates Exa changing the advanced tool's output shape: the request must
	// still yield sources via the text path rather than returning nothing.
	const result = await withFetch(async () => mcpResponse({
		result: { content: [{ type: "text", text: "Title: Fallback\nURL: https://example.com/f\nHighlights:\nFallback snippet" }] },
	}), () => provider().search({ query: "example" }));
	assert.equal(result.sources.length, 1);
	assert.equal(result.sources[0].url, "https://example.com/f");
});

test("an advanced response without a results key is an empty search, not a failure", async () => {
	const result = await withFetch(async () => structuredResponse({ requestId: "r", searchTime: 1 }),
		() => provider().search({ query: "example" }));
	assert.deepEqual(result.sources, []);
});
