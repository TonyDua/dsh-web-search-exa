import assert from "node:assert/strict";
import test from "node:test";

import { ExaSearchProvider } from "../lib/index.js";

const baseOptions = {
	apiKey: "",
	apiKeyEnv: "__DSH_EXA_TEST_KEY__",
	apiURL: "https://api.exa.ai/search",
	mcpURL: "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa",
	searchType: "auto",
	numResults: 3,
	highlightsPerResult: 1,
};

function provider(overrides = {}) {
	const options = { ...baseOptions, ...overrides };
	return new ExaSearchProvider(() => options);
}

test("provider id defaults to exa and honors the providerId switch", () => {
	assert.equal(provider().id, "exa");
	assert.equal(provider({ providerId: "exa-anon" }).id, "exa-anon");
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

/** One structured entry in the advanced tool's sanitized output. */
function structuredEntry(overrides = {}) {
	return {
		url: "https://example.com",
		title: "Example",
		publishedDate: "2026-08-14",
		highlights: ["A salient result"],
		...overrides,
	};
}

test("anonymous MCP search calls the advanced tool and maps structured JSON", async () => {
	let call;
	const result = await withFetch(async (url, init) => {
		call = { url: String(url), init };
		return mcpResponse({
			result: {
				content: [{ type: "text", text: JSON.stringify({ results: [structuredEntry()] }) }],
			},
		});
	}, () => provider().search({ query: "example" }));

	assert.equal(call.url, "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa");
	assert.equal(call.init.headers.authorization, undefined);
	assert.equal(call.init.headers["x-exa-source"], "dsh-anything");
	const body = JSON.parse(call.init.body);
	assert.equal(body.params.name, "web_search_advanced_exa");
	assert.deepEqual(body.params.arguments, {
		query: "example",
		numResults: 3,
		type: "auto",
		enableHighlights: true,
		highlightsNumSentences: 1,
	});
	assert.deepEqual(result.sources, [{
		url: "https://example.com",
		title: "Example",
		snippet: "A salient result",
		publishedAt: "2026-08-14",
	}]);
});

test("basic tool selection keeps the text-blob path", async () => {
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
	}, () => provider({ mcpTool: "web_search_exa" }).search({ query: "example" }));

	assert.equal(call.url, "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa");
	assert.equal(JSON.parse(call.init.body).params.name, "web_search_exa");
	assert.deepEqual(result.sources, [{
		url: "https://example.com",
		title: "Example",
		snippet: "A useful result",
		publishedAt: "2026-08-14",
	}]);
});

test("custom MCP URLs get the tools query spliced when it is missing", async () => {
	let url;
	await withFetch(async (calledUrl, init) => {
		url = String(calledUrl);
		return mcpResponse({ result: { content: [] } });
	}, () => provider({ mcpURL: "https://mcp.example.net/mcp" }).search({ query: "example" }));
	assert.equal(url, "https://mcp.example.net/mcp?tools=web_search_exa,web_search_advanced_exa");
});

test("custom MCP URLs with a tools parameter pass through unchanged", async () => {
	const custom = "https://mcp.example.net/mcp?tools=web_search_exa,web_search_advanced_exa&page=2";
	let url;
	await withFetch(async (calledUrl, init) => {
		url = String(calledUrl);
		return mcpResponse({ result: { content: [] } });
	}, () => provider({ mcpURL: custom }).search({ query: "example" }));
	assert.equal(url, custom);
});

test("snippet-less and url-less structured entries are dropped", async () => {
	const result = await withFetch(async () => mcpResponse({
		result: {
			content: [{ type: "text", text: JSON.stringify({ results: [
				{ url: "https://example.com/no-highlight", title: "No highlight" },
				{ url: "", title: "No URL", highlights: ["highlight"] },
				structuredEntry(),
			] }) }],
		},
	}), () => provider().search({ query: "example" }));
	assert.deepEqual(result.sources.map(source => source.url), ["https://example.com"]);
});

test("anonymous MCP responses larger than 256 KiB are rejected", async () => {
	await assert.rejects(
		withFetch(async () => mcpResponse({
			result: { content: [{ type: "text", text: "x".repeat(256 * 1024 + 1) }] },
		}), () => provider().search({ query: "example" })),
		error => error.code === "WEB_PROVIDER_ERROR" && /exceeded 262144 bytes/.test(error.message),
	);
});

test("advanced-tool output that is not JSON falls back to section parsing", async () => {
	const result = await withFetch(async () => mcpResponse({
		result: {
			content: [{
				type: "text",
				text: "Title: Fallback\nURL: https://example.com/fallback\nPublished: 2026-08-15\nHighlights:\nFrom sections",
			}],
		},
	}), () => provider().search({ query: "example" }));
	assert.deepEqual(result.sources, [{
		url: "https://example.com/fallback",
		title: "Fallback",
		snippet: "From sections",
		publishedAt: "2026-08-15",
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