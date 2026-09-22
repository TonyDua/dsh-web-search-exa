# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-09-22

### Fixed

- **The peer range now actually installs on every claimed version.** The earlier
  `>=0.1.2-rc.1` was verified with pnpm, where it works, and assumed to work
  everywhere. Measured with npm against the real tarball it installs on **1 of
  14** versions and fails the other 13 with `ERESOLVE`. The cause is the
  pre-release rule: a prerelease satisfies a range only when some comparator
  carries a prerelease on the same `major.minor.patch` tuple, so
  `>=0.1.2-rc.1` excludes `0.1.5-rc.2`. Each `0.1.x` line that shipped a
  prerelease now gets its own comparator, ending with `>=0.1.8` to carry future
  stable releases. Result: **14/14 under both npm and pnpm.** A future `0.1.9`
  prerelease line needs one added entry.
- **Runs on dsh 0.1.7+.** `0.1.7-alpha.1` removed
  `SettingsProvider.installSection` and replaced the service with
  `SettingsForms`, which derives a page from the Config schema the Loader
  already holds. The old unconditional call threw a `TypeError` there — the
  plugin loaded but failed. `installSettingsSection()` now describes the service
  structurally, calls `installSection` only when it is a function, and
  otherwise returns `false`; provider registration was already outside that
  branch and stays unconditional.
- **`id` no longer freezes at construction.** It was assigned once in the
  constructor, so a live Settings change to `providerId` left the provider
  reporting a stale id. It is now read per access.
- **The keyless channel now reports its own health.** A new
  `ExaAvailabilityBreaker` opens after 3 consecutive transient failures
  (5xx/429/network/parse) for a 5-minute cooldown, during which
  `available()` returns false — previously it returned true unconditionally, so
  a throttled public endpoint produced a hard error on every search with no way
  for the seam to route around it. One successful search closes the breaker.
  A 4xx other than 429 deliberately does not trip it: that failure would repeat
  forever, and hiding it behind a cooldown only delays the same error.
- **429 is no longer indistinguishable from a network failure.** The anonymous
  path throws `ExaRateLimitError` with code `WEB_RATE_LIMITED` and a message
  naming `EXA_API_KEY`, instead of a generic `WEB_PROVIDER_ERROR`, so the model
  can tell throttling from breakage. The keyed REST path is unaffected by the
  breaker — a paid endpoint's failure is the caller's to see.

### Added

- **TypeScript source tree** (`src/`) — the implementation is now real source
  rather than only a committed compile artifact: `constants.ts`, `types.ts`,
  `provider.ts`, and `index.ts`, carrying the JSDoc the bundle used to hold.
- **Build toolchain** matching the harness's own packages: `tsdown` bundles
  `src/index.ts` to `lib/index.js` and rolls the declarations into
  `lib/index.d.ts`; `tsc --noEmit` gates types.
- `pnpm run build`, `pnpm run typecheck`, `pnpm run test:only`, and a
  `prepublishOnly` build hook so the tarball cannot ship stale artifacts.
- 6 regression tests covering the three fixes above (the frozen-`id` test was
  confirmed to fail against the previous build).
- **Cross-version compatibility matrix** (`scripts/compat-matrix.sh`, `pnpm run
  compat`): installs every published dsh version in isolation and typechecks +
  tests the plugin against each one's own declarations. Wired into CI as a
  separate job. This is the evidence behind the README's compatibility table
  rather than a hand-written claim.
- 3 regression tests pinning the settings-generation behaviour: the 0.1.7 shape
  is tolerated, `apply` still registers the provider on it, and the older API
  still adopts live Settings edits.

### Audit findings (no code change needed)

- The `ctx.web` seam is byte-stable across all 14 published versions:
  `WebError` is exported from `dsh-web` and extends `HarnessError` in every one,
  `launchEnvironmentOf` is always present, and `ctx.settings` is always mounted.
- `0.1.7-alpha.1` peers `@deepseek-ai/cordis` `^4.0.3` while the cordis `latest`
  dist-tag still points at `4.0.2`; `4.0.3` is published and resolves it.

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

- 14/14 `node:test` cases pass against the rebuilt artifact on dsh `0.1.5-rc.2`.
- End-to-end: `dsh --profile headless` searched through the anonymous MCP path
  with no API key in the environment, both before and after the rebuild.

### Known limitation

- The plugin can now *report* that it is degraded, but the harness seam has no
  provider priority chain: it selects exactly one usable provider and errors
  (`WEB_PROVIDER_AMBIGUOUS`) when several are usable. So this makes failover
  *possible*, not automatic — see the README note on unpinning `searchProvider`.

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
