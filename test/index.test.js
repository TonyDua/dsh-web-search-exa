import assert from "node:assert/strict";
import test from "node:test";

import { apply, ExaAvailabilityBreaker, ExaSearchProvider } from "../lib/index.js";

const baseOptions = {
	apiKey: "",
	apiKeyEnv: "__DSH_EXA_TEST_KEY__",
	baseURL: "https://api.exa.ai",
	apiURL: "https://api.exa.ai/search",
	mcpURL: "https://mcp.exa.ai/mcp",
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

	assert.equal(call.url, "https://mcp.exa.ai/mcp");
	assert.equal(call.init.headers.authorization, undefined);
	assert.equal(call.init.headers["x-exa-source"], "dsh-anything");
	assert.deepEqual(JSON.parse(call.init.body).params.arguments, { query: "example", numResults: 3 });
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
