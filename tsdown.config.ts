import { defineConfig } from 'tsdown';

/**
 * Bundles `src/index.ts` into the single ESM entry the package publishes as
 * `lib/index.js`, plus one rolled-up declaration file at `lib/index.d.ts`.
 * Mirrors the shape the DeepSeek Harness repo's own package build produces
 * (including the `//#region` markers consumers see when they read the published
 * file), so this package stays readable next to the official
 * `@deepseek-ai/dsh-web-search-exa`.
 *
 * Declarations are bundled rather than emitted per-module: the underlying
 * `rolldown-plugin-dts` has no separate declaration output directory, and a
 * single `.d.ts` next to the bundle removes the old failure mode where
 * hand-written declarations could drift from the shipped implementation.
 */
export default defineConfig({
	entry: ['src/index.ts'],
	outDir: 'lib',
	format: ['esm'],
	platform: 'node',
	target: 'es2024',
	// Keep `index.js` / `index.d.ts` names rather than `.mjs` / `.d.mts`, which
	// the package `exports` map and the committed artifacts both rely on.
	fixedExtension: false,
	dts: true,
	clean: false,
	sourcemap: false,
});
