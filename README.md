# @tonydua/dsh-web-search-exa

**English** | [简体中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/@tonydua/dsh-web-search-exa?label=npm)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![GitHub release](https://img.shields.io/github/release/TonyDua/dsh-web-search-exa?label=release)](https://github.com/TonyDua/dsh-web-search-exa/releases/latest)
[![npm downloads](https://img.shields.io/npm/dm/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![License](https://img.shields.io/npm/l/@tonydua/dsh-web-search-exa)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--alpha.2%20%E2%80%93%200.1.7--alpha.1-4c6?logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-339933?logo=node.js&logoColor=white)](package.json)
[![GitHub stars](https://img.shields.io/github/stars/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![GitHub issues](https://img.shields.io/github/issues/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)

Adds [Exa](https://exa.ai) web search to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

Restart `dsh web` and it works. No API key, no config edits, no provider to select.

Background, for reference only:

- **Exa** is a search API. It retrieves pages by keyword or by meaning and returns citable sources with excerpts. It does not generate answers. Exa offers a REST API and also runs an unauthenticated public MCP server.
- **The official [`dsh-web-search-exa`](https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/packages/web/web-search-exa/README.md)** is dsh's Exa search provider. It uses Exa's REST API and is only useful once you configure an API key.
- **This package is a modified copy of the official one.** The REST path works the same. What we added is a keyless channel: with no key it uses Exa's public MCP server, and with a key it still uses REST. The anonymous approach follows the oh-my-pi project, see [Acknowledgements](#acknowledgements).

You can ignore all of this by default. Read [Selecting a provider](#selecting-a-provider) only if you also run the official package, or if dsh reports an ambiguous provider.

Built with [deepseek-v4-flash](https://api-docs.deepseek.com) inside DeepSeek Harness (dsh).

## Features

- Works without a key. Searches go through Exa's public MCP server (`mcp.exa.ai/mcp`) and carry no credentials.
- Upgrades itself when you add a key. Setting `EXA_API_KEY` switches to Exa's `POST /search` REST API for higher limits, with no behavior change.
- Drop-in. It registers into the dsh `ctx.web` seam; the model-facing `web_search` and `web_fetch` tools, their prompt sections, and the result cards all stay as they are.
- Works out of the box. With no official package installed there is no provider to select.
- Backs off when it fails. After repeated failures on the anonymous channel the plugin marks itself unavailable so dsh can pick another provider, instead of failing every search. See [What happens when a search fails](#what-happens-when-a-search-fails).

## Installation

Pick one of three. The choice only decides where the code comes from; all three end up the same.

**From npm.** v0.1.4 and later ship the `dsh.bundle` manifest, so the bundle patch inserts the provider row and you do not edit any patch by hand.

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

**From the GitHub Release.** The same tarball, for when npm is unreachable.

```powershell
dsh plugin --profile web add https://github.com/TonyDua/dsh-web-search-exa/releases/latest/download/dsh-web-search-exa.tgz
```

**From the repository.** Tracks `main`, including work not yet released.

```powershell
dsh plugin --profile web add github:TonyDua/dsh-web-search-exa
```

For a local development checkout, use the same command with a path instead of a package name: `dsh plugin --profile web add ../plugins/dsh-web-search-exa`.

Restart `dsh web` afterwards. That is the whole procedure in most cases.

### Selecting a provider

**Skip this section unless you install the official package too.**

Before each search, the dsh seam picks an available provider. If exactly one is available it is selected automatically. If more than one is available the seam raises `WEB_PROVIDER_AMBIGUOUS` and asks you to name one. So there are only two cases where you have to act:

- **You installed the official package as well.** Both packages register the provider id `exa`, so `dsh web` fails at startup with `WEB_DUPLICATE_PROVIDER`. You must give this package a different id first, see [Coexistence with the official package](#coexistence-with-the-official-package).
- **You see `WEB_PROVIDER_AMBIGUOUS`.** Another provider is available. Name the one you want.

Two ways to name it:

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
```

Or set `$DSH_WEB_SEARCH_PROVIDER=exa` at runtime.

Restart `dsh web` after the change. The model-facing `web_search` tool then uses the selected provider; no tool configuration changes.

<details>
<summary>Release artifacts and install warnings (usually not needed)</summary>

**Release artifacts.** CI packs this version's tarball, verifies it against every supported dsh version, attaches it to the GitHub Release, and publishes that same artifact to npm. So the release asset and the npm tarball are one file, not two builds that happen to match.

**Profile install warnings.** dsh profiles default to `autoInstallPeers: false`, and the harness's own services are provided at runtime by the dsh host rather than resolved by pnpm. If `dsh plugin add` reports peer warnings, add this to the profile's `pnpm-workspace.yaml`:

```yaml
peerDependencyRules:
  ignoreMissing:
    - '@deepseek-ai/cordis'
    - '@deepseek-ai/dsh-*'
```

</details>

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | unset | Literal Exa API key. Empty or missing enables the anonymous MCP path. |
| `apiKeyEnv` | `EXA_API_KEY` | Environment variable read when no literal `apiKey` is set. |
| `baseURL` | `https://api.exa.ai` | Exa API base URL. The keyed REST path appends `/search`, matching the official dsh provider. |
| `apiURL` | unset | Deprecated full REST endpoint alias. Takes precedence over `baseURL` when set. |
| `mcpURL` | `https://mcp.exa.ai/mcp` | Exa hosted MCP endpoint, used by the anonymous path. |
| `searchType` | `auto` | REST retrieval mode: `auto`, `keyword`, or `neural`. |
| `numResults` | unset | Default result count when a request carries no `maxResults`. |
| `highlightsPerResult` | `1` | Highlight sentences requested per result on the REST path. |
| `providerId` | `exa` | Provider id registered into `ctx.web`. Change it only when this package and the official one are installed together, see [Coexistence with the official package](#coexistence-with-the-official-package). |

Where to put the config: edit this plugin's `config` in `$DSH_HOME/profiles/web/cordis.patch.yml`, then restart `dsh web`. The environment variables `EXA_API_KEY` and `$DSH_WEB_SEARCH_PROVIDER` work too. `apiKey` is marked `role('secret')`, so no `describe()` response exposes its value.

### In the Web panel

In this version the config lives in the profile patch layer, not the Web UI, and there is no editable form. The Settings UI only renders cards that client plugins register by hand for fixed namespaces (`shell`, `agent-loop`, `web-search-deepseek`); it has no generic form for an arbitrary plugin namespace. The current state:

- **Plugin inventory** (Settings → Plugins): a `web-search-exa` entry appears automatically once the plugin is enabled. The inventory reads live entries from the Cordis loader, so no extra code is involved.
- **Settings namespace** (server side): the plugin registers a `web-search-exa` section through the `ctx.settings.installSection` API, and the data layer accepts writes. But no client card binds to it, so the UI does not show it. The built-in Web search card edits the official `web-search-deepseek` namespace, which is unrelated to this plugin.
- **Search result cards**: `web_search` calls render the usual `web` result cards through `dsh-tool-web` (sources, excerpts, dates), regardless of provider. Anonymous Exa results look identical to DeepSeek search results.

Roadmap: the next version adds a client card registered into the `settings.plugin.item` slot and bound to the `web-search-exa` namespace, so every field in the table above becomes editable in Settings → Plugins.

## How it works

| Condition | Path | Endpoint |
|---|---|---|
| `apiKey` / `EXA_API_KEY` configured | REST `POST /search` with `Authorization: Bearer` | `https://api.exa.ai/search` (configurable via `baseURL`) |
| No key configured | Anonymous MCP `tools/call web_search_exa` (JSON-RPC 2.0, no credentials) | `https://mcp.exa.ai/mcp` (configurable) |

The anonymous MCP path sends no credentials; attribution rides the `x-exa-source: dsh-anything` header. Results are normalized to the seam's `WebSearchSource` shape (`url`, `title`, `snippet`, `publishedAt`), and the seam enforces `maxResults` on the way back.

### Rate limits

The anonymous channel is a public endpoint run by Exa, and it is rate-limited. When you hit the limit the search fails with the code `WEB_RATE_LIMITED` and a message telling you to configure `EXA_API_KEY`. That code is ours, so that you and the model can tell throttling apart from a broken network.

With a key configured, searches use the REST path and are not subject to this limit.

### What happens when a search fails

**What you will see:**

- The anonymous channel is rate-limited: error code `WEB_RATE_LIMITED`, telling you to configure a key.
- The anonymous channel fails 3 times in a row: this plugin marks itself unavailable for a 5-minute cooldown. During that window `available()` returns `false`.
- You pinned `searchProvider: exa` and the cooldown is active: the search reports `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
- You did not pin `searchProvider` and the cooldown is active: the seam skips this plugin and looks for another provider. With no other provider available it reports `WEB_PROVIDER_UNAVAILABLE`.
- You configured a key, so searches use REST: none of the above applies, and failures surface as usual.

**Why it works this way.** Before each search the seam calls `available()` to decide which provider to use. If this plugin always answered "available", a dead endpoint would make every search fail hard, and what the user sees is a broken dsh. So the plugin adds a circuit breaker: after 3 consecutive transient failures it admits it is temporarily unavailable, giving the seam a chance to choose someone else. That breaker is this plugin's design; Exa has no such mechanism.

**How failures are counted.** Only failures that a retry could fix: 5xx, 429, network errors, and unparseable response bodies. Three of them start a 5-minute cooldown, and any successful search clears the count immediately.

A 4xx other than 429 does not count. That is a configuration error and would fail identically on every retry, so hiding it behind a cooldown would only delay the same error by 5 minutes.

**This trade-off has a cost.** While Exa is down for those 5 minutes, a profile with a pinned `searchProvider: exa` reports an error instead of trying something else. The plugin cannot choose for you:

- Pinning `searchProvider: exa`: predictable behavior normally, but no fallback once the breaker opens.
- Leaving `searchProvider` unset: it can fall back when the breaker opens, at the cost that the seam raises `WEB_PROVIDER_AMBIGUOUS` whenever several providers are usable, and you have to name one.

Choose the second if you want fallback, and install only one alternative provider.

## Compared with the official package

DeepSeek Harness has an official Exa provider, [`@deepseek-ai/dsh-web-search-exa`](https://www.npmjs.com/package/@deepseek-ai/dsh-web-search-exa), which you install separately; dsh does not include it by default. This package is its zero-config variant: it adds the anonymous MCP fallback the official one lacks and keeps the same REST behavior once you configure a key.

| | Official `@deepseek-ai/dsh-web-search-exa` | This package `@tonydua/dsh-web-search-exa` |
|---|---|---|
| REST path (`POST /search`) | ✅ the only path | ✅ used when a key is configured |
| Requires an API key | ✅ yes, an empty key makes it unavailable | ❌ no, with no key it uses the anonymous MCP fallback |
| Anonymous MCP (`mcp.exa.ai/mcp`) | ❌ not implemented | ✅ the default path with no key |
| Zero-config install | ❌ | ✅ |
| Provider id | `exa` (fixed) | `exa` by default, configurable via `providerId` |
| Cordis plugin name | `web-search-exa` | `web-search-exa` |
| Config keys | `apiKey`, `baseURL`, `searchType`, `numResults`, `highlightsPerResult` | `apiKey`, `apiKeyEnv`, `baseURL`, `apiURL` (legacy), `mcpURL`, `searchType`, `numResults`, `highlightsPerResult`, `providerId` |

Which to use:

- You have an `EXA_API_KEY` and want the officially maintained package: use the official one, it is the canonical implementation.
- You want to try Exa search with no configuration, no key, and no cost commitment: use this package. It defaults to the anonymous MCP path and switches to REST once a key appears.
- You want both: install both and separate them with `providerId`, see the next section.

## Coexistence with the official package

Both packages register the same provider id (`exa`) under `ctx.web`, and both use the cordis plugin name `web-search-exa`. The seam rejects duplicate ids with `WEB_DUPLICATE_PROVIDER`, so installing both into one profile without changing the config fails at startup.

Coexistence requires explicit configuration through the `providerId` switch:

1. The official package keeps `exa`; its id is fixed.
2. Give this package a different id. Set `providerId: exa-anon` in this plugin's `config`; any unique string works.
3. Name one of them on the `web` seam. Use `searchProvider: exa-anon` for the anonymous variant, or `searchProvider: exa` for the official package. `$DSH_WEB_SEARCH_PROVIDER` works too.

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

The simplest alternative is to install only one of the two packages per profile, which works with the default config.

## Troubleshooting

**`dsh web` fails at startup with `duplicate loader entry id: web`.** This is a 0.1.2 bug, fixed in 0.1.4, so upgrading the plugin resolves it. If you already run 0.1.4 or later, please open an issue with `dsh --version` and your `cordis.patch.yml`, because a user patch that inserts a `web` row produces the same error.

**Startup fails with `Cannot read properties of undefined (reading 'prepare')`.** `@deepseek-ai/dsh-tools` is a dsh runtime singleton and must resolve to one physical package instance per profile. This plugin does not depend on it. The usual cause is another third-party plugin in the profile declaring it as an ordinary nested dependency rather than a peer dependency. Fix that plugin's dependency declaration, or have the profile's package manager resolve one shared instance, and only then investigate search errors.

**A search reports `WEB_PROVIDER_AMBIGUOUS`.** More than one provider is available. Name one explicitly as described in [Selecting a provider](#selecting-a-provider).

**A search reports `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.** The provider you pinned is currently unavailable. This happens when the keyless channel's breaker is open, see [What happens when a search fails](#what-happens-when-a-search-fails).

**There is no settings entry in the Web UI.** This version has no UI card; configure through `cordis.patch.yml` or environment variables, see [In the Web panel](#in-the-web-panel).

## Version compatibility

Every published dsh version from `0.1.2-alpha.2` to `0.1.7-alpha.1` has been tested. Testing means three things: installing that version in isolation, typechecking against its own declarations, and installing this plugin with npm under strict peer resolution. The last step is the one that fails most easily, because npm's peer rules are stricter than pnpm's. To reproduce: `bash scripts/compat-matrix.sh`.

| dsh line | Tested | Notes |
|---|---|---|
| `0.1.2-alpha.2` … `0.1.2-alpha.5` | ✅ | the oldest supported baseline |
| `0.1.2-rc.1` | ✅ | |
| `0.1.3-alpha.2` | ✅ | |
| `0.1.5-alpha.1`, `0.1.5-alpha.2` | ✅ | |
| `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.5-rc.3` | ✅ | `0.1.5-rc.2` is also verified end to end: a real `dsh --profile headless` task searched through the anonymous MCP path with no API key |
| `0.1.6-alpha.1`, `0.1.6-alpha.2` | ✅ | |
| `0.1.7-alpha.1` | ✅ | the settings service changed shape, see below |

The `>=0.1.8` entry in the peer range carries later stable releases, but those have not been tested yet.

### What differs across versions

Probing the real export surface of all 14 versions, the `ctx.web` seam turns out to be completely stable: `WebError` is always exported from `dsh-web` and extends `HarnessError`, `launchEnvironmentOf` is always present, and `ctx.settings` is mounted in every version. Only two things differ.

First, `0.1.7-alpha.1` replaced the settings API. `SettingsProvider.installSection` is gone, and the service became `SettingsForms`, which derives a config page from the Config schema the Loader already holds (`SettingsDescriptor.schema`, `autoGenerate`). Code that called that method unconditionally throws a `TypeError` there: the plugin loads but fails. It now probes for the method, calls it only when present, and does nothing otherwise. On `0.1.7+` the Loader's schema drives the form and the plugin has nothing to register.

Second, `0.1.7-alpha.1` depends on `@deepseek-ai/cordis` `^4.0.3`, while cordis's `latest` dist-tag still points at `4.0.2`. `4.0.3` is published; the tag simply lags. Install `@deepseek-ai/cordis@4.0.3` alongside a `0.1.7` host. The matrix script pins this per version.

Also supported across that whole range: `@deepseek-ai/dsh-web`, `dsh-settings` (optional), and `dsh-launch-environment`. Node.js needs `>=22.19.0`, matching the harness's own floor.

<details>
<summary>Why the peer range looks like that</summary>

```jsonc
"@deepseek-ai/dsh-web": ">=0.1.2-alpha.2 || >=0.1.3-alpha.2 || >=0.1.4-0 || >=0.1.5-alpha.1 || >=0.1.6-alpha.1 || >=0.1.7-alpha.1 || >=0.1.8"
```

That enumeration is the only form that installs across every published version under both pnpm and npm. The reason is one semver rule:

> A prerelease version satisfies a range only if some comparator in that range carries a prerelease on the same `major.minor.patch` triple.

So `>=0.1.2-rc.1` does not match `0.1.5-rc.2`; the triples differ. A single open-ended lower bound cannot cover a project published as a series of prereleases, and `*` would also admit a future breaking `1.0`. Every `0.1.x` line that shipped a prerelease needs its own comparator. `>=0.1.8` carries later stable releases, so an entry only needs adding when dsh opens a new `0.1.x` prerelease line.

Measured against the real published artifacts:

| Range | Installable npm versions | pnpm |
|---|---|---|
| `>=0.1.2-rc.1` (the earlier form) | **1 / 14** | 14 / 14 |
| The enumeration (current) | **14 / 14** | 14 / 14 |

This was measured, not reasoned. The open-ended range is fine on pnpm, which is what `dsh plugin add` uses. On npm it makes 13 of the 14 versions fail with `ERESOLVE`. If you hit that error installing an older release of this plugin with npm, upgrade, or pass `--legacy-peer-deps` temporarily.

</details>

### Building from source

```sh
pnpm install
pnpm run build      # tsdown -> lib/index.js + lib/index.d.ts
pnpm run typecheck  # tsc --noEmit
pnpm test           # builds, then runs the node:test suite against lib/
```

`src/` is the only source directory. `lib/` is still committed, because both the npm package and git-based installs consume it.

## Acknowledgements

The anonymous MCP integration follows the `web_search` implementation in [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (`packages/coding-agent/src/web/search/providers/exa.ts` and `src/exa/mcp-client.ts`) and the [`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) plugin: the same "REST when a key exists, credential-free `mcp.exa.ai/mcp` otherwise" strategy, the same `x-exa-source` attribution header, and the same `Title:`-section response parsing. Thanks to the oh-my-pi (omp) project for building the zero-config Exa integration first.

Thanks also to **[Exa](https://exa.ai)** for providing and operating the free, unauthenticated hosted MCP server (`mcp.exa.ai/mcp`) that makes this package's zero-config default possible. Exa's hosted MCP is an official Exa product, and anonymous usage is rate-limited, see [Rate limits](#rate-limits).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for all notable changes.

## License

MIT, see [LICENSE](LICENSE).
