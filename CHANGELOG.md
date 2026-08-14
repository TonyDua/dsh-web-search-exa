# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
