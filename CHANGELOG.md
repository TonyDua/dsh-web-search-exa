# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
