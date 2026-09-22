# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TypeScript source tree** (`src/`) — the implementation is now real source
  rather than only a committed compile artifact: `constants.ts`, `types.ts`,
  `provider.ts`, and `index.ts`, carrying the JSDoc the bundle used to hold.
- **Build toolchain** matching the harness's own packages: `tsdown` bundles
  `src/index.ts` to `lib/index.js` and rolls the declarations into
  `lib/index.d.ts`; `tsc --noEmit` gates types.
- `pnpm run build`, `pnpm run typecheck`, `pnpm run test:only`, and a
  `prepublishOnly` build hook so the tarball cannot ship stale artifacts.

### Changed

- **Peer ranges are no longer pinned to `0.1.2-rc.1`.** They are now open-ended
  (`>=0.1.2-rc.1`, `@deepseek-ai/cordis` `>=4.0.2`) because semver excludes
  pre-release versions from ordinary ranges: `^0.1.2-rc.1` did **not** match
  `0.1.5-rc.2`, so every install on the 0.1.5 line reported missing peers even
  though the plugin worked. `0.1.2-rc.1` remains the oldest tested baseline.
- `@deepseek-ai/dsh-settings` is now declared an **optional** peer
  (`peerDependenciesMeta`): the provider registers whether or not a settings
  service is mounted, so a keyless profile without the Settings UI is supported.
- `engines.node` raised to `>=22.19.0`, matching the harness.
- **Declarations are generated, not hand-written.** The former
  `lib/types/index.d.ts` was maintained by hand next to the bundle and could
  drift from it; types now come from `src/` and land in `lib/index.d.ts`.
- `README` gains a supported-version matrix, the profile `peerDependencyRules`
  recipe that silences host-provided peer warnings, and source-build steps.

### Verified

- 8/8 `node:test` cases pass against the rebuilt artifact on dsh `0.1.5-rc.2`.
- End-to-end: `dsh --profile headless` searched through the anonymous MCP path
  with no API key in the environment, both before and after the rebuild.

## [0.1.4] - 2026-09-09

### Fixed

- **dsh 0.1.2 compatibility**: use the current `ctx.settings.installSection`
  API instead of the removed `installSettingsSection` helper, so importing the
  plugin no longer fails on the current dsh runtime.
- Resolve `EXA_API_KEY` through dsh's launch-environment snapshot, while
  retaining the `process.env` fallback for direct library use and older hosts.

### Changed

- Align peer and development dependencies with dsh `0.1.2-rc.1`, Cordis
  `4.0.2`, and Schemastery `3.18.2`.
- Add the official-compatible `baseURL` option; the existing full `apiURL`
  option remains supported as a deprecated compatibility alias.

## [0.1.3] - 2026-08-14

### Fixed

- **Bundle patch no longer re-defines the `web` row** (`duplicate loader entry
  id: web` boot failure when installed via `dsh plugin add`): dsh-base's
  official patch already owns `- id: web`, and duplicate ids inside the bundle
  group fail the loader (only the user's own profile patch may override rows
  by id). The bundle now inserts only the `web-search-exa` provider row;
  keyless installs auto-select it, keyed users select it explicitly (README).

## [0.1.2] - 2026-08-14

### Added

- **`dsh.bundle` manifest** (`cordis.patch.yml`): the package is now a proper
  profile bundle — installable in one command via
  `dsh plugin --profile web add @tonydua/dsh-web-search-exa`; the bundle patch
  inserts the provider and selects it as the web seam's search provider.
- `cordis.patch.yml` shipped in the npm tarball (`files`).

## [0.1.1] - 2026-08-14

### Changed

- **README overhaul**: shields.io badges, `English | 简体中文` language switch,
  restructured sections (features → vs official → which one to use → how it
  works → install → config → coexistence → Web panel → FAQ → thanks →
  changelog), new "Which one should I use?" recommendation section, new FAQ.
- **`package.json`**: search-friendly description and expanded keywords
  (`exa-search`, `mcp`, `mcp-server`, `zero-config`, `no-api-key`, …).
- **LICENSE**: correct the copyright holder line.

### Added

- `CHANGELOG.md` (Keep a Changelog).

## [0.1.0] - 2026-08-14

### Added

- Exa-backed `WebSearchProvider` for the DeepSeek Harness web capability seam (`ctx.web`).
- **Anonymous MCP fallback**: keyless search through Exa's hosted MCP server
  (`mcp.exa.ai/mcp`) via JSON-RPC 2.0 with no credentials — Exa's documented
  unauthenticated public MCP (rate-limited).
- **Keyed REST path**: with an `EXA_API_KEY` (or literal `apiKey`), search uses
  Exa's `POST /search` endpoint with Bearer auth and highlight contents.
- **`providerId` config switch** so this package can coexist with the official
  `@deepseek-ai/dsh-web-search-exa` in one profile (defaults to `exa`; no
  silent overrides, duplicate ids rejected by the seam).
- Server-side settings section (`web-search-exa`) via `installSettingsSection`.
- Bilingual README (`README.md` / `README.zh.md`) with i18n consistency record.
- MIT license, npm-packable layout (`files: ["lib"]`, ESM, bundled types).
