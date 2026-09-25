# @tonydua/dsh-web-search-exa

[English](README.md) | **简体中文**

[![npm 版本](https://img.shields.io/npm/v/@tonydua/dsh-web-search-exa?label=npm)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![GitHub release](https://img.shields.io/github/release/TonyDua/dsh-web-search-exa?label=release)](https://github.com/TonyDua/dsh-web-search-exa/releases/latest)
[![npm 下载量](https://img.shields.io/npm/dm/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![License](https://img.shields.io/npm/l/@tonydua/dsh-web-search-exa)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--alpha.2%20%E2%80%93%200.1.7--alpha.1-4c6?logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19.0-339933?logo=node.js&logoColor=white)](package.json)
[![GitHub stars](https://img.shields.io/github/stars/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![GitHub issues](https://img.shields.io/github/issues/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）加上 Exa 网页搜索。装完即可用，**不需要 API key**。

dsh 的 `web_search` 工具需要配置搜索后端。官方包只支持 Exa 的 REST API，而它要求 API key。本包补上了免 key 的通道：没有 key 时走 Exa 官方提供的免认证公共 MCP 服务器，配了 key 就自动换成额度更高的 REST API。

## 快速开始

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

重启 `dsh web`。没有 API key 时，官方 DeepSeek 搜索提供方不可用，seam 会自动选中本插件，不需要改任何配置。模型侧的 `web_search` 工具随即走 Exa。

配了 `EXA_API_KEY` 时，两个 provider 都可能可用，需要你显式选中一个，详见[安装](#安装)。

## 特性

- 免 key 可用。搜索经由 Exa 官方托管的 MCP 服务器（`mcp.exa.ai/mcp`），不携带任何凭据。
- 配 key 自动升级。设置 `EXA_API_KEY` 后自动切到 Exa `POST /search` REST API，额度更高，行为不变。
- 即插即用。注册进 dsh `ctx.web` seam，模型侧的 `web_search` 和 `web_fetch` 工具、提示词区段、结果卡片都无需改动。
- 可与官方包共存。用 `providerId` 区分，不撞 id，也没有黑箱覆盖。
- 网络异常时不静默失败。免 key 通道限流或不可用时如实上报，详见[降级与回退](#降级与回退)。

## 安装

三种方式选一种。方式只决定代码从哪来，配置步骤相同。

**从 npm 安装。** v0.1.4 起自带 `dsh.bundle` manifest，bundle patch 会自动插入 provider 行，无需手动改 patch。

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

**从 GitHub Release 安装。** 同一份 tarball，npm 不可达时用。

```powershell
dsh plugin --profile web add https://github.com/TonyDua/dsh-web-search-exa/releases/latest/download/dsh-web-search-exa.tgz
```

**从仓库安装。** 跟随 `main`，包含尚未发布的改动。

```powershell
dsh plugin --profile web add github:TonyDua/dsh-web-search-exa
```

本地开发目录的装法相同，把包名换成路径即可：`dsh plugin --profile web add ../plugins/dsh-web-search-exa`。

### 选中提供方

没有 API key 时不用做任何事，seam 会自动选中本插件。

配了 key 时，两个 provider 都可能可用，二选一：

- 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里写死（在 bundle patch 之后应用）：

  ```yaml
  - id: web
    name: '@deepseek-ai/dsh-web'
    config:
      searchProvider: exa
  ```

- 或在运行时用环境变量 `$DSH_WEB_SEARCH_PROVIDER=exa` 选中。

改完执行 `dsh web --help` 或重启 `dsh web` 生效。模型侧的 `web_search` 工具随即走本提供方，不需要改工具配置。

### 关于发布产物

CI 打包本版本的 tarball，在每一个受支持的 dsh 版本上验证，挂到 GitHub Release，并把这个产物本身发布到 npm。所以 Release 附件和 npm 上的 tarball 是同一个文件，而不是两次恰好一致的构建。

### profile 安装注意事项

dsh profile 默认 `autoInstallPeers: false`，而 harness 自身的服务由 dsh 宿主在运行时提供，不经 pnpm 解析。把下面这段加进 profile 的 `pnpm-workspace.yaml`，`dsh plugin add` 就不再报警告：

```yaml
peerDependencyRules:
  ignoreMissing:
    - '@deepseek-ai/cordis'
    - '@deepseek-ai/dsh-*'
```

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Exa API 密钥字面值。为空或缺失时启用匿名 MCP 路径。 |
| `apiKeyEnv` | `EXA_API_KEY` | 未设置字面 `apiKey` 时读取的环境变量名。 |
| `baseURL` | `https://api.exa.ai` | Exa API 基础 URL。带 key 的 REST 路径会追加 `/search`，与官方 dsh 提供方一致。 |
| `apiURL` | 未设置 | 已弃用的完整 REST 端点别名，设置后优先于 `baseURL`。 |
| `mcpURL` | `https://mcp.exa.ai/mcp` | Exa 托管 MCP 端点，匿名路径使用。 |
| `searchType` | `auto` | REST 检索模式：`auto`、`keyword` 或 `neural`。 |
| `numResults` | 未设置 | 请求未携带 `maxResults` 时的默认结果数。 |
| `highlightsPerResult` | `1` | REST 路径每个结果请求的 highlight 句子数。 |
| `providerId` | `exa` | 注册进 `ctx.web` 的提供方 id。仅当本包与官方包同时安装时才需要改，见[与官方包共存](#与官方包共存)。 |

配置写在哪里：编辑 `$DSH_HOME/profiles/web/cordis.patch.yml` 里本插件的 `config`，然后重启 `dsh web`。也可以用环境变量 `EXA_API_KEY` 和 `$DSH_WEB_SEARCH_PROVIDER`。`apiKey` 标记了 `role('secret')`，任何 `describe()` 响应都不会暴露它的值。

### 在 Web 面板中的呈现

当前版本的配置入口在 profile 补丁层，不在 Web UI，没有可编辑的界面入口。Settings UI 只渲染客户端插件为固定命名空间（`shell`、`agent-loop`、`web-search-deepseek`）手工注册的卡片，对任意插件命名空间没有通用表单。当前实际情况：

- **插件清单**（Settings → Plugins）：启用后自动出现 `web-search-exa` 条目。清单直接读取 Cordis loader 的实时条目，无需额外代码。
- **设置命名空间**（服务端）：插件通过 `ctx.settings.installSection` API 注册了 `web-search-exa` 段，数据层可写。但没有任何客户端卡片绑定它，所以界面上不显示。内置的 Web search 卡片编辑的是官方 `web-search-deepseek` 命名空间，与本插件无关。
- **搜索结果卡片**：`web_search` 调用经 `dsh-tool-web` 照常渲染 `web` 结果卡片（来源、摘要、日期），与提供方无关。匿名 Exa 的结果和 DeepSeek 搜索显示一致。

路线图：下一版本会新增注册到 `settings.plugin.item` slot 的客户端卡片，绑定 `web-search-exa` 命名空间，让上表所有字段可以在 Settings → Plugins 里实时编辑。

## 工作原理

| 条件 | 路径 | 端点 |
|---|---|---|
| 配置了 `apiKey` / `EXA_API_KEY` | REST `POST /search`，`Authorization: Bearer` | `https://api.exa.ai/search`（可用 `baseURL` 配置） |
| 未配置任何 key | 匿名 MCP `tools/call web_search_exa`（JSON-RPC 2.0，无凭据） | `https://mcp.exa.ai/mcp`（可配置） |

匿名 MCP 路径不发送任何凭据，来源标识通过 `x-exa-source: dsh-anything` 头携带。结果按 seam 的 `WebSearchSource` 形状规范化（`url`、`title`、`snippet`、`publishedAt`），`maxResults` 由 seam 在返回路径上强制执行。

### 限流

匿名使用受 Exa 限流。HTTP 429 会以独立的 `WEB_RATE_LIMITED` 码呈现，而不是笼统的 provider 失败，错误信息里直接点名 `EXA_API_KEY`。配置 key 后自动切到 REST 路径。

### 降级与回退

免 key 通道是共享的尽力而为端点。本 provider 会如实汇报自身健康状况，不假装永远可用：

- 连续 3 次瞬时失败（5xx、429、网络错误、响应体无法解析）会打开熔断器，冷却 5 分钟。这段时间内 `available()` 返回 `false`。任意一次成功搜索即关闭熔断器。
- 429 以外的 4xx 不会触发熔断：这类失败会永远重复，把它藏进冷却期只是推迟同一个错误。
- 配了 key 的 REST 路径不受熔断影响。付费端点的失败应当让你看到。

但是否真的自动回退，取决于 harness 侧。seam 只会选中唯一一个可用 provider，并不存在优先级链。同时存在多个可用 provider 时，它会抛 `WEB_PROVIDER_AMBIGUOUS`。因此：

- 写死 `searchProvider: exa`：选择确定，但没有回退。熔断打开时得到 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
- 不写 `searchProvider`：牺牲确定性。Exa 降级后确实不再是候选，但如果另一个 provider 也可用（比如带有效 `DEEPSEEK_API_KEY` 的 `deepseek-official`），seam 会报“多个可用”，而不是替你挑一个。

两种失败模式各有利弊，插件无法替你做这个决定。

## 与官方包比较

DeepSeek Harness 自带官方 Exa 提供方 [`@deepseek-ai/dsh-web-search-exa`](https://www.npmjs.com/package/@deepseek-ai/dsh-web-search-exa)。本包是它的零配置变体：补上了官方没有的匿名 MCP 兜底，同时保留配置 key 后的相同 REST 行为。

| | 官方 `@deepseek-ai/dsh-web-search-exa` | 本包 `@tonydua/dsh-web-search-exa` |
|---|---|---|
| REST 路径（`POST /search`） | ✅ 唯一路径 | ✅ 配置 key 时使用 |
| 必须有 API key | ✅ 是，key 为空则不可用 | ❌ 不需要，无 key 走匿名 MCP 兜底 |
| 匿名 MCP（`mcp.exa.ai/mcp`） | ❌ 未实现 | ✅ 无 key 时的默认路径 |
| 零配置安装 | ❌ | ✅ |
| Provider id | `exa`（固定） | 默认 `exa`，可用 `providerId` 配置 |
| Cordis 插件名 | `web-search-exa` | `web-search-exa` |
| 配置键 | `apiKey`、`baseURL`、`searchType`、`numResults`、`highlightsPerResult` | `apiKey`、`apiKeyEnv`、`baseURL`、`apiURL`（旧版）、`mcpURL`、`searchType`、`numResults`、`highlightsPerResult`、`providerId` |

该用哪个：

- 你有 `EXA_API_KEY`，且想用官方维护的包：用官方包，它是标准实现。
- 想零配置、免 key 试用 Exa 搜索：用本包。默认走匿名 MCP，出现 key 后自动走 REST。
- 两个都想要：一起装，用 `providerId` 区分，见下节。

## 与官方包共存

两个包默认在 `ctx.web` 下注册相同的 provider id（`exa`），cordis 插件名也都是 `web-search-exa`。seam 会拒绝重复 id，报 `WEB_DUPLICATE_PROVIDER`。所以不改配置就把两个包装进同一个 profile，会在启动时报错。

共存必须显式配置，通过 `providerId` 开关完成：

1. 官方包保持 `exa`，它的 id 固定。
2. 给本包一个不同 id。在本插件的 `config` 里设 `providerId: exa-anon`，任意唯一字符串即可。
3. 在 `web` seam 上显式选中一个。用 `searchProvider: exa-anon` 选匿名变体，或用 `searchProvider: exa` 选官方包。也可以用环境变量 `$DSH_WEB_SEARCH_PROVIDER`。

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

最简单的替代方案是每个 profile 只装其中一个包，默认配置即可直接用。

## 排查

**`dsh web` 启动时报 `duplicate loader entry id: web`。** 这是 0.1.2 的 bug，0.1.4 起已修复，升级本插件即可。如果已在 0.1.4 或更新版本上遇到，请带上 `dsh --version` 和你的 `cordis.patch.yml` 提 issue，因为用户补丁里插入 `web` 行也会产生同样的错误。

**启动时报 `Cannot read properties of undefined (reading 'prepare')`。** `@deepseek-ai/dsh-tools` 是 dsh 的运行时单例包，一个 profile 中必须解析到同一份物理包实例。本插件不依赖它。常见原因是 profile 里其他第三方插件把它声明成了普通嵌套依赖，而不是 peer dependency。先修正那个插件的依赖声明，或让 profile 的包管理器统一解析到共享实例，再排查搜索错误。

**搜索报 `WEB_PROVIDER_AMBIGUOUS`。** 同时存在多个可用 provider。按[选中提供方](#选中提供方)显式指定一个。

**搜索报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。** 你写死的 provider 当前不可用。免 key 通道熔断时会这样，见[降级与回退](#降级与回退)。

**Web UI 里找不到设置入口。** 本版本没有 UI 卡片，用 `cordis.patch.yml` 或环境变量配置，见[在 Web 面板中的呈现](#在-web-面板中的呈现)。

## 版本兼容性

`0.1.2-alpha.2` 到 `0.1.7-alpha.1` 之间每一个已发布的 dsh 版本都实测过。实测包含三件事：独立安装该版本、用该版本自己的类型声明做类型检查、用 npm 严格安装一次本插件。最后一步最容易失败，因为 npm 的 peer 规则比 pnpm 严。复现命令：`bash scripts/compat-matrix.sh`。

| dsh 版本线 | 实测 | 说明 |
|---|---|---|
| `0.1.2-alpha.2` … `0.1.2-alpha.5` | ✅ | 最老的受支持基线 |
| `0.1.2-rc.1` | ✅ | |
| `0.1.3-alpha.2` | ✅ | |
| `0.1.5-alpha.1`、`0.1.5-alpha.2` | ✅ | |
| `0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.5-rc.3` | ✅ | `0.1.5-rc.2` 另有端到端验证：无 API key 时用真实的 `dsh --profile headless` 走通匿名 MCP |
| `0.1.6-alpha.1`、`0.1.6-alpha.2` | ✅ | |
| `0.1.7-alpha.1` | ✅ | settings 服务换了形态，见下 |

peer 范围里的 `>=0.1.8` 用来承接之后的稳定版，但这些版本尚未实测。

### 各版本之间差在哪

我逐个探测了 14 个版本的真实导出面。结论是 `ctx.web` seam 完全稳定：`WebError` 始终由 `dsh-web` 导出且继承 `HarnessError`，`launchEnvironmentOf` 始终存在，`ctx.settings` 在每个版本都被挂载。真正有差异的只有两处。

其一，`0.1.7-alpha.1` 换掉了 settings API。`SettingsProvider.installSection` 被移除，服务变成 `SettingsForms`，它直接从 Loader 已持有的 Config schema 派生配置页（`SettingsDescriptor.schema`、`autoGenerate`）。旧代码无条件调用该方法，会在这个版本上抛 `TypeError`：插件能加载，但会失败。现在改为先探测方法，存在才调用，不存在则什么都不做。在 `0.1.7+` 上由 Loader 的 schema 驱动表单，插件无需注册任何东西。

其二，`0.1.7-alpha.1` 依赖 `@deepseek-ai/cordis` `^4.0.3`，而 cordis 的 `latest` dist-tag 仍指向 `4.0.2`。`4.0.3` 已发布，只是 tag 落后。搭配 `0.1.7` 宿主时请安装 `@deepseek-ai/cordis@4.0.3`。矩阵脚本已按版本固化这一点。

同样支持 `@deepseek-ai/dsh-web`、`dsh-settings`（可选）和 `dsh-launch-environment`，覆盖上述整个范围。Node.js 需要 `>=22.19.0`，与 harness 自身的下限一致。

<details>
<summary>为什么 peer 范围长这样</summary>

```jsonc
"@deepseek-ai/dsh-web": ">=0.1.2-alpha.2 || >=0.1.3-alpha.2 || >=0.1.4-0 || >=0.1.5-alpha.1 || >=0.1.6-alpha.1 || >=0.1.7-alpha.1 || >=0.1.8"
```

这串枚举是**在 pnpm 和 npm 下都能装遍所有已发布版本**的唯一写法。原因是 semver 的一条规则：

> prerelease 版本要满足某个范围，该范围中必须有一个比较器，它的 prerelease 落在**相同的 `major.minor.patch` 三段**上。

所以 `>=0.1.2-rc.1` **匹配不到** `0.1.5-rc.2`，两者三段不同。单一开区间下界覆盖不了“以一串 prerelease 发布的项目”，而 `*` 会连未来的破坏性 `1.0` 一起放行。凡是发布过 prerelease 的 `0.1.x` 版本线，都需要自己的比较器。`>=0.1.8` 承接之后的稳定版，所以只有 dsh 开出新的 `0.1.x` prerelease 线时才需要追加条目。

在真实发布物上实测的结果：

| 范围 | npm 可安装版本数 | pnpm |
|---|---|---|
| `>=0.1.2-rc.1`（先前写法） | **1 / 14** | 14 / 14 |
| 枚举写法（当前） | **14 / 14** | 14 / 14 |

这个结论是测出来的。开区间在 pnpm 下没问题，而 `dsh plugin add` 用的正是 pnpm。但在 npm 下，它会让 14 个版本中的 13 个报 `ERESOLVE`。如果你用 npm 安装旧版本的本插件时遇到该错误，升级即可，或临时加 `--legacy-peer-deps`。

</details>

### 从源码构建

```sh
pnpm install
pnpm run build      # tsdown -> lib/index.js + lib/index.d.ts
pnpm run typecheck  # tsc --noEmit
pnpm test           # 先构建，再对 lib/ 跑 node:test 套件
```

`src/` 是唯一的源文件目录。`lib/` 仍然提交进仓库，因为 npm 发布包和基于 git 的安装都依赖它。

## 致谢

匿名 MCP 接入方式参考了 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 的 `web_search` 实现（`packages/coding-agent/src/web/search/providers/exa.ts` 和 `src/exa/mcp-client.ts`）以及 [`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) 插件：同样的“有 key 走 REST、无 key 走免凭据 `mcp.exa.ai/mcp`”策略、同样的 `x-exa-source` 来源头、同样的 `Title:` 分节响应解析。感谢 oh-my-pi（omp）项目最先做出零配置的 Exa 接入。

同时感谢 **[Exa](https://exa.ai)** 提供并运营这个免费、免认证的托管 MCP 服务器（`mcp.exa.ai/mcp`），正是它让本包的零配置默认路径成为可能。Exa 托管 MCP 是 Exa 的官方产品，匿名使用有限流，见[限流](#限流)。

## 更新日志

所有变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
