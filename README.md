# @tonydua/dsh-web-search-exa

> **Built with [deepseek-v4-flash](https://api-docs.deepseek.com) inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

An Exa-backed `WebSearchProvider` for the DeepSeek Harness web capability seam
(`ctx.web`), with an **anonymous** fallback: when no API key is configured,
search routes through Exa's hosted MCP server (`https://mcp.exa.ai/mcp`) via
JSON-RPC 2.0 with **no credentials at all** — Exa's documented unauthenticated
public MCP fallback (rate-limited). With an `EXA_API_KEY`, the lighter REST
endpoint is used instead.

This is an implementation package: it registers a provider INTO `ctx.web`
(`inject: ['web']`) and owns no model-facing tools (those belong to
`@deepseek-ai/dsh-tool-web`). The model-facing `web_search` / `web_fetch` tools,
their prompt sections, and the Web result cards are unchanged.

## Why this package exists (difference from the official one)

The DeepSeek Harness ships an official Exa provider,
[`@deepseek-ai/dsh-web-search-exa`](https://www.npmjs.com/package/@deepseek-ai/dsh-web-search-exa).
This package is the **zero-config variant**: it adds the anonymous MCP fallback
the official one does not have, and keeps the same keyed REST behavior when an
API key is configured.

| | Official `@deepseek-ai/dsh-web-search-exa` | This package `@tonydua/dsh-web-search-exa` |
|---|---|---|
| REST path (`POST /search`) | ✅ only path | ✅ used when a key is configured |
| Requires an API key | ✅ **yes — empty key makes it unavailable** | ❌ no — keyless anonymous MCP fallback |
| Anonymous MCP (`mcp.exa.ai/mcp`) | ❌ not implemented | ✅ default when no key |
| Zero-config install | ❌ | ✅ |
| Provider id | `exa` (fixed) | `exa` by default, **configurable via `providerId`** |
| Cordis plugin name | `web-search-exa` | `web-search-exa` |
| Config keys | `apiKey`, `baseURL`, `searchType`, `numResults`, `highlightsPerResult` | `apiKey`, `apiKeyEnv`, `apiURL`, `mcpURL`, `searchType`, `numResults`, `highlightsPerResult`, `providerId` |

## Acknowledgements

The anonymous MCP integration follows the `web_search` implementation in
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (`packages/coding-agent/src/web/search/providers/exa.ts`
and `src/exa/mcp-client.ts`) and the
[`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) plugin: same
"REST when a key exists, credential-free `mcp.exa.ai/mcp` otherwise" strategy,
same `x-exa-source` attribution header, same `Title:`-section response parsing.
Thanks to the oh-my-pi (omp) project for pioneering the zero-config Exa
integration.

Thanks also to **[Exa](https://exa.ai)** for providing and operating the
**free, unauthenticated hosted MCP server** (`mcp.exa.ai/mcp`) that makes this
package's zero-config default possible. Exa's hosted MCP is an official Exa
product; anonymous usage is rate-limited (see Known limitations).

## How it works

| Condition | Path | Endpoint |
|---|---|---|
| `apiKey` / `EXA_API_KEY` set | REST `POST /search` with `Authorization: Bearer` | `https://api.exa.ai/search` (configurable) |
| No key configured | Anonymous MCP `tools/call web_search_exa` (JSON-RPC 2.0, no credentials) | `https://mcp.exa.ai/mcp` (configurable) |

The anonymous MCP path sends no credentials; attribution rides the
`x-exa-source: dsh-anything` header. Results are normalized to the seam's
`WebSearchSource` shape (`url`, `title`, `snippet`, `publishedAt`) and the seam
enforces `maxResults` on the way back. Anonymous usage is rate-limited by Exa:
an HTTP 429 surfaces as a `WEB_PROVIDER_ERROR` with a hint to configure an API
key (which also switches to the REST path automatically).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerId` | `exa` | Provider id registered into `ctx.web`. Only change it when both this and the official package are installed (see next section). |
| `apiKey` | unset | Literal Exa API key. Empty/missing enables the anonymous MCP path. |
| `apiKeyEnv` | `EXA_API_KEY` | Environment variable consulted when no literal `apiKey` is set. |
| `apiURL` | `https://api.exa.ai/search` | REST search endpoint (keyed path only). |
| `mcpURL` | `https://mcp.exa.ai/mcp` | Exa hosted MCP endpoint (anonymous path). |
| `searchType` | `auto` | REST retrieval mode: `auto` / `keyword` / `neural`. |
| `numResults` | unset | Default result count when the request carries no `maxResults`. |
| `highlightsPerResult` | `1` | Highlight sentences requested per result on the REST path. |

## Coexistence with the official package

Both packages register their provider under the **same default provider id
(`exa`)** and the same cordis plugin name (`web-search-exa`). The seam rejects
duplicate ids with `WEB_DUPLICATE_PROVIDER`, so **installing both into one
profile without changes breaks at startup**.

There is **no silent override** — coexistence is explicit, via the `providerId`
switch:

1. Keep the official package on `exa` (its id is fixed).
2. Give this package a distinct id — set `providerId: exa-anon` (any unique
   string) in this plugin's `config`.
3. Select the anonymous variant explicitly with
   `searchProvider: exa-anon` on the `web` seam (or
   `$DSH_WEB_SEARCH_PROVIDER=exa-anon`), and keep
   `searchProvider: exa` → the official one if you want it selectable too.

```yaml
- insert:
    - id: web-search-exa
      name: '@tonydua/dsh-web-search-exa'
      config:
        providerId: exa-anon
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa-anon
```

Simplest alternative: install only one of the two packages per profile — the
defaults then work as-is.

## Installation (into a dsh profile)

From this repository:

```powershell
dsh plugin --profile web add ../plugins/dsh-web-search-exa
```

Then enable the provider and select it. Either merge into
`$DSH_HOME/profiles/web/cordis.patch.yml` (persistent):

```yaml
- id: web-search-exa
  name: '@tonydua/dsh-web-search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
```

…or pass `patches/exa-anon-search.patch.yml` as an overlay:

```powershell
dsh --profile web --patch patches/exa-anon-search.patch.yml
```

Alternatively, select the provider at runtime with the environment variable
`$DSH_WEB_SEARCH_PROVIDER=exa` (no config edit needed).

Restart `dsh web` for changes to take effect. The existing model-facing
`web_search` tool then routes through this provider — no tool config changes.

### Runtime singleton compatibility

`@deepseek-ai/dsh-tools` is a dsh runtime singleton and must resolve to one
physical package instance in a profile. This provider does not depend on it;
the requirement belongs to the host profile. If another third-party plugin
installs `@deepseek-ai/dsh-tools` as a nested regular dependency instead of a
peer dependency, fix that plugin's dependency declaration or make the profile
package manager resolve the shared instance before debugging search errors.
Otherwise dsh's agent loop can fail before the provider is called with an
error such as `Cannot read properties of undefined (reading 'prepare')`.

## In the Web panel

**Status: configuration is done in the profile patch layer, not the Web UI —
this version ships no editable UI entry.** The Settings UI only renders cards
that are hand-registered by client plugins for fixed namespaces (`shell`,
`agent-loop`, `web-search-deepseek`); it has no generic form for arbitrary
plugin namespaces. What is true today:

- **Plugin inventory** (Settings → Plugins): the entry appears automatically
  as `web-search-exa` (`@tonydua/dsh-web-search-exa`) once enabled — the
  inventory reads the live Cordis loader, no extra code needed.
- **Settings namespace** (server-side): the plugin registers the
  `web-search-exa` section via `installSettingsSection`, so the data layer is
  writable — but **no client card binds to it**, so nothing shows in the UI.
  The built-in "Web search" card edits the official
  `web-search-deepseek` namespace, not this plugin.
- **Changing configuration today**: edit the plugin's `config` in
  `$DSH_HOME/profiles/web/cordis.patch.yml` (fields and defaults in the table
  above) and restart `dsh web`; or set `EXA_API_KEY` / `$DSH_WEB_SEARCH_PROVIDER`
  as environment variables. The `apiKey` field is `role('secret')`: it never
  appears in `describe()` responses.
- **Search result cards**: `web_search` calls render the usual `web` cards
  (sources, snippets, dates) through `dsh-tool-web`, independent of the
  provider — anonymous Exa results display exactly like DeepSeek ones.

**Roadmap (next version)**: a client-side card registered into the
`settings.plugin.item` slot bound to the `web-search-exa` namespace, so all
fields above become editable live in Settings → Plugins (mirroring how the
official cards work).

## Open-source notes

- License: MIT (see `LICENSE`).
- Repository: <https://github.com/TonyDua/dsh-web-search-exa>.
- The package is npm-packable: `publishConfig.access: public`, `files` limited
  to `lib/`, ESM with an `exports` map and bundled type declarations. Run
  `npm test` and `npm pack --dry-run` before publishing.
- To publish: `npm login` (against `registry.npmjs.org`, not the npmmirror
  default in your `.npmrc`), then
  `npm publish --registry https://registry.npmjs.org --cache <writable-cache>`.
  The `@tonydua` scope is claimed on first publish by the publishing account.

## Known limitations

- **Anonymous MCP is rate-limited** (HTTP 429 → `WEB_PROVIDER_ERROR` with a
  hint). Configure `EXA_API_KEY` for higher limits; the provider then uses the
  REST path automatically.
- **Snippet-less results are dropped** (seam rule: no portable snippet).
  Anonymous MCP usually returns full `Text` blocks, which are truncated to
  `MAX_SNIPPET_CHARS` (500) for the snippet.
- **Only `query` + result-count controls are exposed**; recency, domain
  filters, and deep-search modes are not mapped (they can be added later, as
  the seam's provider-neutral fields evolve).
- Anonymous MCP responses are parsed from the `Title:`-section text format;
  structural changes to Exa's hosted MCP output may require a parser update.
- **No Web UI settings entry yet** — configuration goes through the profile
  patch layer (see "In the Web panel").
