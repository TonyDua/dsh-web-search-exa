# @tonydua/dsh-web-search-exa

**English** | [简体中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![npm downloads](https://img.shields.io/npm/dm/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![License](https://img.shields.io/npm/l/@tonydua/dsh-web-search-exa)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![GitHub issues](https://img.shields.io/github/issues/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](package.json)

> Zero-config [Exa](https://exa.ai) web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
> **no API key required** — a `WebSearchProvider` for the `ctx.web` seam with an
> anonymous MCP fallback plus a keyed REST path.

Built with [deepseek-v4-flash](https://api-docs.deepseek.com) inside DeepSeek Harness (dsh).

## Features

- 🆓 **Zero-config, keyless by default** — searches route through Exa's hosted MCP
  server (`mcp.exa.ai/mcp`) with **no credentials at all** (Exa's documented
  unauthenticated public MCP, rate-limited). The anonymous path calls
  `web_search_advanced_exa`, whose text content is a sanitized structured search
  response — results map onto the seam vocabulary without parsing text blobs.
- 🔑 **Keyed REST upgrade** — set `EXA_API_KEY` and it automatically switches to
  Exa's `POST /search` REST API (higher limits, no behavior change).
- 🔌 **Drop-in provider** — registers into the dsh `ctx.web` seam; the existing
  model-facing `web_search` / `web_fetch` tools, prompt sections, and result
  cards work unchanged.
- 🎛️ **`providerId` switch** — can coexist with the official
  `@deepseek-ai/dsh-web-search-exa` package in one profile (no duplicate-id
  collisions, no silent overrides).
- 📦 **npm-publishable** — MIT, ESM, bundled types, `files` limited to `lib/`.

## Why this package exists (vs. the official one)

The DeepSeek Harness ships an official Exa provider,
[`@deepseek-ai/dsh-web-search-exa`](https://www.npmjs.com/package/@deepseek-ai/dsh-web-search-exa).
This package is its **zero-config variant**: it adds the anonymous MCP fallback
the official one does not have, and keeps the same keyed REST behavior.

| | Official `@deepseek-ai/dsh-web-search-exa` | This package `@tonydua/dsh-web-search-exa` |
|---|---|---|
| REST path (`POST /search`) | ✅ only path | ✅ used when a key is configured |
| Requires an API key | ✅ **yes — empty key makes it unavailable** | ❌ no — keyless anonymous MCP fallback |
| Anonymous MCP (`mcp.exa.ai/mcp`) | ❌ not implemented | ✅ default when no key |
| Anonymous result source | n/a | structured JSON (`web_search_advanced_exa`), text-blob parsing as fallback |
| Zero-config install | ❌ | ✅ |
| Provider id | `exa` (fixed) | `exa` by default, **configurable via `providerId`** |
| Cordis plugin name | `web-search-exa` | `web-search-exa` |
| Config keys | `apiKey`, `baseURL`, `searchType`, `numResults`, `highlightsPerResult` | `apiKey`, `apiKeyEnv`, `apiURL`, `mcpURL`, `mcpTool`, `searchType`, `numResults`, `highlightsPerResult`, `providerId` |

## Which one should I use?

- **You have an `EXA_API_KEY` and want the officially maintained package** →
  use `@deepseek-ai/dsh-web-search-exa`. It is the canonical implementation.
- **You want to try Exa search with zero setup, no key, no cost commitment** →
  use this package. It degrades gracefully: anonymous MCP by default, REST
  automatically when a key appears.
- **You want both** → install both and use the `providerId` switch (see
  [Coexistence](#coexistence-with-the-official-package)).

## How it works

| Condition | Path | Endpoint |
|---|---|---|
| `apiKey` / `EXA_API_KEY` set | REST `POST /search` with `Authorization: Bearer` | `https://api.exa.ai/search` (configurable) |
| No key configured | Anonymous MCP `tools/call web_search_advanced_exa` (JSON-RPC 2.0, no credentials, sanitized JSON output) | `https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa` (configurable; a URL without a `tools` parameter gets it spliced in) |

The anonymous MCP path sends no credentials; attribution rides the
`x-exa-source: dsh-anything` header. Results are normalized to the seam's
`WebSearchSource` shape (`url`, `title`, `snippet`, `publishedAt`) and the seam
enforces `maxResults` on the way back. Anonymous usage is rate-limited by Exa:
an HTTP 429 surfaces as a `WEB_PROVIDER_ERROR` with a hint to configure an API
key (which also switches to the REST path automatically).

## Installation (into a dsh profile)

**One command from npm** (v0.1.3+ ships the `dsh.bundle` manifest — the bundle
patch inserts the provider row, so no manual patch editing is needed):

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

Restart `dsh web`. **Without an API key** the official DeepSeek search
provider is unavailable, so the seam auto-selects this provider — fully
zero-config. **With a key configured**, select Exa explicitly in your own
`$DSH_HOME/profiles/web/cordis.patch.yml` (applied after bundle patches):

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
```

…or at runtime with the environment variable `$DSH_WEB_SEARCH_PROVIDER=exa`.

**Local development checkout:**

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

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerId` | `exa` | Provider id registered into `ctx.web`. Only change it when both this and the official package are installed (see next section). |
| `apiKey` | unset | Literal Exa API key. Empty/missing enables the anonymous MCP path. |
| `apiKeyEnv` | `EXA_API_KEY` | Environment variable consulted when no literal `apiKey` is set. |
| `apiURL` | `https://api.exa.ai/search` | REST search endpoint (keyed path only). |
| `mcpURL` | `https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa` | Exa hosted MCP endpoint (anonymous path). A URL without a `tools` parameter gets the tools query spliced in. |
| `mcpTool` | `web_search_advanced_exa` | MCP tool for the anonymous path: `web_search_advanced_exa` (structured JSON output) or `web_search_exa` (text-blob output parsed by `Title:` sections). |
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

## FAQ

**Q: Do I need an Exa API key?**
No. Without a key the provider uses Exa's free anonymous hosted MCP. With a key
it uses the REST API for higher limits.

**Q: I got HTTP 429 / rate limited.**
That's Exa's anonymous-MCP rate limit. Configure `EXA_API_KEY` (or the
`apiKey` field) and the provider switches to the REST path automatically.

**Q: Can I run this alongside the official Exa provider?**
Yes — give this package a distinct `providerId` and select it explicitly
(see [Coexistence](#coexistence-with-the-official-package)).

**Q: Why don't I see a settings entry in the Web UI?**
This version registers the `web-search-exa` settings namespace server-side
only; a UI card is planned for the next version. Configure through
`cordis.patch.yml` or environment variables for now (see
[In the Web panel](#in-the-web-panel)).

## Acknowledgements

The anonymous MCP integration follows the `web_search` implementation in
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (`packages/coding-agent/src/web/search/providers/exa.ts`
and `src/exa/mcp-client.ts`) and the
[`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) plugin: same
"REST when a key exists, credential-free `mcp.exa.ai/mcp` otherwise" strategy,
same `x-exa-source` attribution header, same `Title:`-section response parsing.
The structured-tool path — `web_search_advanced_exa` as the anonymous default,
the endpoint `tools` query splicing, the highlight-request arguments, and the
256 KiB response cap — follows the keyed-and-keyless Exa MCP provider work in
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(`packages/web/web-search-exa-mcp`).
Thanks to the oh-my-pi (omp) project for pioneering the zero-config Exa
integration.

Thanks also to **[Exa](https://exa.ai)** for providing and operating the
**free, unauthenticated hosted MCP server** (`mcp.exa.ai/mcp`) that makes this
package's zero-config default possible. Exa's hosted MCP is an official Exa
product; anonymous usage is rate-limited (see FAQ).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for all notable changes.

## License

MIT — see [LICENSE](LICENSE).
