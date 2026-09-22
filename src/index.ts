/**
 * `@tonydua/dsh-web-search-exa`
 *
 * Exa-backed `WebSearchProvider` for the DeepSeek Harness web capability seam
 * (`ctx.web`), with an **anonymous** fallback: when no API key is configured,
 * search routes through Exa's hosted MCP server (`https://mcp.exa.ai/mcp`) via
 * JSON-RPC 2.0 with no credentials — Exa's documented unauthenticated public
 * MCP fallback (rate-limited). With a key, the lighter REST endpoint
 * (`POST {baseURL}/search`) is used instead, mirroring
 * `@deepseek-ai/dsh-web-search-exa`.
 *
 * This is an implementation package: it registers a provider INTO `ctx.web`
 * (`inject: ['web']`) and owns no model-facing tools (those belong to
 * `@deepseek-ai/dsh-tool-web`). It also installs a Settings section
 * (`web-search-exa`) into the settings service; editing it from the Web UI
 * needs a client card (planned for a later version) — today it is configured
 * through the profile patch layer (see README "In the Web panel").
 *
 * @module @tonydua/dsh-web-search-exa
 */

import type { Context } from '@deepseek-ai/cordis';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
// Type-only, and deliberately a bare `{}`: this import exists so TypeScript
// loads dsh-settings' `declare module '@deepseek-ai/cordis'` augmentation that
// adds `ctx.settings`. It emits no runtime import, so `dsh-settings` stays an
// optional peer — a profile without it still mounts the provider (the install
// happens inside `ctx.inject(['settings'])`).
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import {
	DEFAULT_API_KEY_ENV,
	DEFAULT_BASE_URL,
	DEFAULT_HIGHLIGHTS_PER_RESULT,
	DEFAULT_MCP_URL,
	DEFAULT_PROVIDER_ID,
	DEFAULT_SEARCH_TYPE,
	SETTINGS_NAMESPACE,
} from './constants.ts';
import { ExaSearchProvider, resolveApiKey, resolveOptions } from './provider.ts';
import type { ExaKeyEnvironment, ExaSearchProviderConfig } from './provider.ts';

export * from './constants.ts';
export {
	DEFAULT_BREAKER_COOLDOWN_MS,
	DEFAULT_BREAKER_THRESHOLD,
	ExaAvailabilityBreaker,
	ExaRateLimitError,
	ExaSearchProvider,
	ExaTransientError,
	resolveApiKey,
	resolveApiKeyFromProcess,
	resolveOptions,
} from './provider.ts';
export type {
	ExaApiKeyResolver,
	ExaKeyEnvironment,
	ExaOptionsResolver,
	ExaSearchProviderConfig,
	ExaSearchProviderOptions,
} from './provider.ts';
export type {
	ExaMcpSection,
	ExaRestResponse,
	ExaRestResult,
	ExaSearchType,
	McpContentItem,
	McpJsonRpcError,
	McpPayload,
	McpToolResult,
} from './types.ts';

const Config = z.object({
	/**
	 * Provider id registered into `ctx.web`. Defaults to `exa` (same as the
	 * official `@deepseek-ai/dsh-web-search-exa`). Change it only when BOTH
	 * packages are installed in one profile — the seam rejects duplicate ids
	 * with `WEB_DUPLICATE_PROVIDER`. There is no silent override: pick a
	 * distinct id here (e.g. `exa-anon`) and select it explicitly with
	 * `searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`.
	 */
	providerId: z.string().default(DEFAULT_PROVIDER_ID),
	/** Literal Exa API key; an empty/missing value enables the anonymous MCP path. */
	apiKey: z.string().role('secret'),
	/** Environment variable consulted when no literal `apiKey` is configured. */
	apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
	/** Exa API base URL; `/search` is appended for the keyed REST path. */
	baseURL: z.string().default(DEFAULT_BASE_URL),
	/**
	 * Legacy full REST endpoint. When set, it takes precedence over `baseURL`;
	 * new configurations should use `baseURL` to match the official provider.
	 */
	apiURL: z.string(),
	/** Exa hosted MCP endpoint, used by the anonymous fallback. */
	mcpURL: z.string().default(DEFAULT_MCP_URL),
	/** REST retrieval mode: `auto`, `keyword`, or `neural`. */
	searchType: z.union(['auto', 'keyword', 'neural']).default(DEFAULT_SEARCH_TYPE),
	/** Default result count when the request carries no `maxResults`. */
	numResults: z.number().step(1).min(1),
	/** Highlight sentences requested per result on the REST path. */
	highlightsPerResult: z.number().step(1).min(1).default(DEFAULT_HIGHLIGHTS_PER_RESULT),
});

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-exa';
/** The web seam this provider registers into. */
export const inject = ['web'] as const;

/**
 * The subset of the settings service this plugin uses, described structurally
 * rather than by the concrete `dsh-settings` class, because that API changed
 * shape and the plugin must work on both sides of the change.
 *
 * - **dsh ≤ 0.1.6** exposes `SettingsProvider.installSection`, which registered
 *   a namespace and — the part the provider actually depends on — handed back
 *   the authoritative section thunk through `setSource`.
 * - **dsh ≥ 0.1.7** replaces that with `SettingsForms`, which derives a page
 *   from the Config schema the Loader already holds for this entry
 *   (`SettingsDescriptor.schema`, `autoGenerate`). There is no namespace to
 *   install, so this plugin has nothing to register and must simply not
 *   crash.
 *
 * Both members are optional: a host with neither still gets a working provider,
 * only without live Settings-driven reconfiguration.
 */
interface SettingsServiceLike {
	installSection?: (
		owner: unknown,
		ns: string,
		schema: unknown,
		entry: unknown,
		hooks: { setSource: (source: () => ExaSearchProviderConfig) => void; onChange: () => void },
	) => void;
}

/**
 * Wire the settings service when the host exposes the pre-0.1.7 registration
 * API; do nothing (rather than throw) on hosts that do not.
 *
 * @param settings - the mounted settings service, of either generation.
 * @param owner - the consuming context `installSection` attributes the section to.
 * @param config - the composition entry, used as the section's base value.
 * @param adopt - receives the authoritative section thunk so later searches read
 * live edits instead of the boot-time config.
 * @returns true when a section was installed.
 */
function installSettingsSection(
	settings: SettingsServiceLike,
	owner: unknown,
	config: ExaSearchProviderConfig,
	adopt: (source: () => ExaSearchProviderConfig) => void,
): boolean {
	if (typeof settings.installSection !== 'function') return false;
	settings.installSection(owner, SETTINGS_NAMESPACE, Config, config, {
		setSource: adopt,
		onChange: () => {},
	});
	return true;
}

/**
 * Register the Exa search provider with `ctx.web` and, when the settings
 * service is mounted *and* exposes the pre-0.1.7 registration API, install its
 * Settings section.
 *
 * The settings work is deliberately inside `ctx.inject`, so a profile that
 * omits `dsh-settings` still mounts the provider — keyless search must not
 * depend on the Settings UI being present. The provider registration happens
 * outside it for the same reason, and is never conditional on the settings
 * generation.
 */
export function apply(ctx: Context, config: ExaSearchProviderConfig): void {
	let current = (): ExaSearchProviderConfig => config;
	ctx.inject(['settings'], (settingsCtx) => {
		installSettingsSection(
			settingsCtx.settings as unknown as SettingsServiceLike,
			ctx,
			config,
			(source) => {
				current = source;
			},
		);
	});
	const environment = launchEnvironmentOf(ctx) as unknown as ExaKeyEnvironment;
	ctx.web.registerSearchProvider(
		new ExaSearchProvider(
			() => resolveOptions(current()),
			(options) => resolveApiKey(options, environment),
		),
	);
}

export { Config, installSettingsSection };
