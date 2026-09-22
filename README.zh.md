# @tonydua/dsh-web-search-exa

[English](README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![npm downloads](https://img.shields.io/npm/dm/@tonydua/dsh-web-search-exa)](https://www.npmjs.com/package/@tonydua/dsh-web-search-exa)
[![License](https://img.shields.io/npm/l/@tonydua/dsh-web-search-exa)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![GitHub issues](https://img.shields.io/github/issues/TonyDua/dsh-web-search-exa)](https://github.com/TonyDua/dsh-web-search-exa)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](package.json)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--rc.1-4c6?logo=deepseek&logoColor=white)](https://www.npmjs.com/package/@deepseek-ai/dsh)

> 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供**零配置**的 [Exa](https://exa.ai) 网页搜索：
> **无需 API key** —— 一个 `ctx.web` seam 的 `WebSearchProvider`，内置匿名 MCP 兜底 + 带 key 的 REST 路径。

使用 [deepseek-v4-flash](https://api-docs.deepseek.com) 在 DeepSeek Harness（dsh）内开发。

## 当前支持的版本

**npm 上从 `0.1.2-alpha.2` 到 `0.1.7-alpha.1` 的每一个 dsh 版本都经过实测**，不是只写在文档里：
每个版本会被独立安装、用**该版本自己的类型声明**做类型检查、并跑完整测试套件。
复现命令：`bash scripts/compat-matrix.sh`。

| dsh 版本线 | 实测 | 说明 |
|---|---|---|
| `0.1.2-alpha.2` … `0.1.2-alpha.5` | ✅ | 最老的受支持基线 |
| `0.1.2-rc.1` | ✅ | |
| `0.1.3-alpha.2` | ✅ | |
| `0.1.5-alpha.1`、`0.1.5-alpha.2` | ✅ | |
| `0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.5-rc.3` | ✅ | `0.1.5-rc.2` 另有端到端验证：无 API key 下用真实 `dsh --profile headless` 走通匿名 MCP |
| `0.1.6-alpha.1`、`0.1.6-alpha.2` | ✅ | |
| `0.1.7-alpha.1` | ✅ | settings 服务改了形态，见下 |

peer 范围写成开区间（`>=0.1.2-rc.1`，`@deepseek-ai/cordis` `>=4.0.2`），因为闭区间
无法表达"每条发布线都能用"：semver 会把 prerelease 排除在普通范围外，所以
`^0.1.2-rc.1` 匹配不到 `0.1.5-rc.2`。

### 各版本之间究竟差在哪

我把 14 个版本的**真实导出面**逐个探测过，结论是 `ctx.web` seam **完全稳定**：
`WebError` 始终由 `dsh-web` 导出且继承 `HarnessError`，`launchEnvironmentOf` 始终存在，
`ctx.settings` 在每个版本都被挂载。真正有差异的只有两处：

1. **`0.1.7-alpha.1` 换掉了 settings API。** `SettingsProvider.installSection` 被移除，
   服务变为 `SettingsForms`，它直接从 Loader 已持有的 Config schema 派生配置页
   （`SettingsDescriptor.schema`、`autoGenerate`）。旧代码无条件调用该方法会在该版本上抛
   `TypeError`——插件能加载但会失败。现在改为探测该方法：存在才调用，不存在则什么都不做；
   在 `0.1.7+` 上由 Loader 的 schema 驱动表单，插件无需注册任何东西。
2. **`0.1.7-alpha.1` 依赖 `@deepseek-ai/cordis` `^4.0.3`**，而 cordis 的 `latest`
   dist-tag 仍指向 `4.0.2`。`4.0.3` 已发布，只是 tag 落后。搭配 `0.1.7` 宿主时请安装
   `@deepseek-ai/cordis@4.0.3`。矩阵脚本已按版本固化这一点。

同样支持：`@deepseek-ai/dsh-web`、`dsh-settings`（可选）、`dsh-launch-environment`
覆盖上述整个范围；Node.js `>=22.19.0`（与 harness 自身下限一致）。

### profile 安装注意事项

dsh profile 默认 `autoInstallPeers: false`，且 harness 自身的服务由 dsh 宿主在运行时
提供、并不经 pnpm 解析。把下面这段加进 profile 的 `pnpm-workspace.yaml`，
`dsh plugin add` 就不会再报警告：

```yaml
peerDependencyRules:
  ignoreMissing:
    - '@deepseek-ai/cordis'
    - '@deepseek-ai/dsh-*'
```

### 降级与回退

免 key 通道是共享的尽力而为端点。本 provider 会如实汇报自身健康状况，而不是假装永远可用：

- 连续 3 次瞬时失败（5xx、429、网络错误、响应体无法解析）会打开熔断器并冷却 5 分钟，
  期间 `available()` 返回 `false`；任意一次成功搜索即关闭熔断器。
- 429 以外的 4xx **不会**触发熔断——这类失败会永远重复，把它藏进冷却期只是推迟同一个错误。
- 匿名通道的 429 抛出 `WEB_RATE_LIMITED`（而非笼统的 `WEB_PROVIDER_ERROR`），
  错误信息里直接点名 `EXA_API_KEY`。
- 配了 key 的 REST 路径不受熔断影响：付费端点的失败应当让你看到。

**但"是否真的自动回退"取决于 harness 侧。** seam 只会选中唯一一个可用 provider，
并不存在优先级链——同时存在多个可用 provider 时会抛 `WEB_PROVIDER_AMBIGUOUS`。因此：

- 写死 `searchProvider: exa`：选择确定，但**没有**回退；熔断打开时得到
  `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
- 不写 `searchProvider`：牺牲确定性。Exa 降级后确实不再是候选，但如果另一个
  provider（比如带有效 `DEEPSEEK_API_KEY` 的 `deepseek-official`）也可用，
  seam 会报"多个可用"而不是替你挑一个。

两种失败模式各有利弊，插件无法替你做这个决定。

### 从源码构建

```sh
pnpm install
pnpm run build      # tsdown -> lib/index.js + lib/index.d.ts
pnpm run typecheck  # tsc --noEmit
pnpm test           # 先构建，再对 lib/ 跑 node:test 套件
```

`src/` 是唯一事实来源；`lib/` 仍然提交进仓库，因为 npm 发布包与基于 git 的安装都依赖它。

## 特性

- 🆓 **零配置、默认免 key** —— 搜索经由 Exa 官方托管的 MCP 服务器（`mcp.exa.ai/mcp`），**完全不携带凭据**（Exa 官方提供的免认证公共 MCP，有限流）。
- 🔑 **配 key 自动升级 REST** —— 设置 `EXA_API_KEY` 后自动切换到 Exa `POST /search` REST API（额度更高，行为不变）。
- 🔌 **即插即用** —— 注册进 dsh `ctx.web` seam；模型侧的 `web_search` / `web_fetch` 工具、提示词区段与结果卡片无需任何改动。
- 🎛️ **`providerId` 开关** —— 可与官方 `@deepseek-ai/dsh-web-search-exa` 在同一 profile 共存（不撞 id、无黑箱覆盖）。
- 📦 **可直接发布** —— MIT、ESM、内置类型声明、`files` 仅含 `lib/`。

## 为什么有这个包（与官方包的差异）

DeepSeek Harness 自带官方 Exa 提供方 [`@deepseek-ai/dsh-web-search-exa`](https://www.npmjs.com/package/@deepseek-ai/dsh-web-search-exa)。本包是它的**零配置变体**：补上了官方没有的匿名 MCP 兜底，同时保留配置 key 后的相同 REST 行为。

| | 官方 `@deepseek-ai/dsh-web-search-exa` | 本包 `@tonydua/dsh-web-search-exa` |
|---|---|---|
| REST 路径（`POST /search`） | ✅ 唯一路径 | ✅ 配置 key 时使用 |
| 必须有 API key | ✅ **是——key 为空则不可用** | ❌ 不需要——无 key 走匿名 MCP 兜底 |
| 匿名 MCP（`mcp.exa.ai/mcp`） | ❌ 未实现 | ✅ 无 key 时默认路径 |
| 零配置安装 | ❌ | ✅ |
| Provider id | `exa`（固定） | 默认 `exa`，**可用 `providerId` 配置** |
| Cordis 插件名 | `web-search-exa` | `web-search-exa` |
| 配置键 | `apiKey`、`baseURL`、`searchType`、`numResults`、`highlightsPerResult` | `apiKey`、`apiKeyEnv`、`baseURL`、`apiURL`（旧版）、`mcpURL`、`searchType`、`numResults`、`highlightsPerResult`、`providerId` |

## 我该用哪个？

- **你有 `EXA_API_KEY`，且想要官方维护的包** → 用 `@deepseek-ai/dsh-web-search-exa`，它是官方标准实现。
- **想零配置、免 key、无成本负担地试用 Exa 搜索** → 用本包。优雅降级：默认匿名 MCP，出现 key 自动走 REST。
- **两个都想要** → 一起装，用 `providerId` 开关（见[与官方包共存](#与官方包共存)）。

## 工作原理

| 条件 | 路径 | 端点 |
|---|---|---|
| 配置了 `apiKey` / `EXA_API_KEY` | REST `POST /search`，`Authorization: Bearer` | `https://api.exa.ai/search`（可用 `baseURL` 配置） |
| 未配置任何 key | 匿名 MCP `tools/call web_search_exa`（JSON-RPC 2.0，无凭据） | `https://mcp.exa.ai/mcp`（可配置） |

匿名 MCP 路径不发送任何凭据，来源标识通过 `x-exa-source: dsh-anything` 头携带。结果按 seam 的 `WebSearchSource` 形状规范化（`url`、`title`、`snippet`、`publishedAt`），`maxResults` 由 seam 在返回路径上强制执行。匿名使用受 Exa 限流：HTTP 429 会以 `WEB_PROVIDER_ERROR` 呈现，并提示配置 API key（配置后自动切换到 REST 路径）。

## 安装（装入 dsh profile）

**一条命令从 npm 安装**（v0.1.4+ 自带 `dsh.bundle` manifest——bundle patch 会自动插入 provider 行，无需手动改 patch）：

```powershell
dsh plugin --profile web add @tonydua/dsh-web-search-exa
```

重启 `dsh web` 生效。**无 API key 时**官方 DeepSeek 搜索提供方不可用，seam 会自动选中本插件——完全零配置。**配了 key 时**，需在你的 `$DSH_HOME/profiles/web/cordis.patch.yml`（在 bundle patch 之后应用）里显式选中 Exa：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
```

…或用环境变量 `$DSH_WEB_SEARCH_PROVIDER=exa` 在运行时选中。

**本地开发目录：**

```powershell
dsh plugin --profile web add ../plugins/dsh-web-search-exa
```

然后启用并选中该提供方。合并进 `$DSH_HOME/profiles/web/cordis.patch.yml`（持久生效）：

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

也可以不修改配置，直接用环境变量 `$DSH_WEB_SEARCH_PROVIDER=exa` 在运行时选中该提供方。

重启 `dsh web` 生效。模型侧的 `web_search` 工具随即走该提供方，无需改任何工具配置。

### 运行时单例兼容性

`@deepseek-ai/dsh-tools` 是 dsh 的运行时单例包，一个 profile 中必须解析到同一份物理包实例。本插件本身不依赖它；这是宿主 profile 的依赖约束。如果 profile 中的其他第三方插件把 `@deepseek-ai/dsh-tools` 错误声明成普通嵌套依赖，而不是 peer dependency，应先修正该插件的依赖声明，或让 profile 的包管理器统一解析到共享实例，再排查搜索错误。否则 dsh agent loop 可能在 provider 被调用前就因 `Cannot read properties of undefined (reading 'prepare')` 失败。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `exa` | 注册进 `ctx.web` 的提供方 id。仅当本包与官方包同时安装时才需要改（见下一节）。 |
| `apiKey` | 未设置 | Exa API 密钥字面值。为空/缺失时启用匿名 MCP 路径。 |
| `apiKeyEnv` | `EXA_API_KEY` | 未设置字面 `apiKey` 时读取的环境变量名。 |
| `baseURL` | `https://api.exa.ai` | Exa API 基础 URL；带 key 的 REST 路径会追加 `/search`，与官方 dsh 提供方一致。 |
| `apiURL` | 未设置 | 已弃用的完整 REST 端点别名；设置后优先于 `baseURL`。 |
| `mcpURL` | `https://mcp.exa.ai/mcp` | Exa 托管 MCP 端点（匿名路径使用）。 |
| `searchType` | `auto` | REST 检索模式：`auto` / `keyword` / `neural`。 |
| `numResults` | 未设置 | 请求未携带 `maxResults` 时的默认结果数。 |
| `highlightsPerResult` | `1` | REST 路径每个结果请求的 highlight 句子数。 |

## 与官方包共存

两个包默认在 `ctx.web` 下注册**相同的 provider id（`exa`）**，cordis 插件名也都是 `web-search-exa`。seam 会拒绝重复 id（`WEB_DUPLICATE_PROVIDER`），所以**不改配置就把两个包装进同一个 profile 会在启动时报错**。

**没有黑箱覆盖**——共存必须显式配置，通过 `providerId` 开关完成：

1. 官方包保持 `exa`（它的 id 固定）。
2. 给本包一个不同 id——在本插件 `config` 里设 `providerId: exa-anon`（任意唯一字符串）。
3. 在 `web` seam 上显式选中匿名变体：`searchProvider: exa-anon`（或用环境变量 `$DSH_WEB_SEARCH_PROVIDER=exa-anon`）；若还想用官方包，再配 `searchProvider: exa` 切换。

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

最简单的替代方案：每个 profile 只装其中一个包，默认配置即可直接使用。

## 在 Web 面板中的呈现

**状态：本版本的配置入口在 profile 补丁层，不在 Web UI —— 没有可编辑的界面入口。** Settings UI 只渲染客户端插件为固定命名空间（`shell`、`agent-loop`、`web-search-deepseek`）手工注册的卡片，对任意插件命名空间没有通用表单。当前实际情况：

- **插件清单**（Settings → Plugins）：启用后自动出现 `web-search-exa`（`@tonydua/dsh-web-search-exa`）条目 —— 清单直接读取 Cordis loader 的实时条目，无需额外代码。
- **设置命名空间**（服务端）：插件通过当前的 `ctx.settings.installSection` API 注册了 `web-search-exa` 段，数据层可写——但**没有任何客户端卡片绑定它**，所以界面上不显示。内置的 "Web search" 卡片编辑的是官方 `web-search-deepseek` 命名空间，与本插件无关。
- **现在怎么改配置**：编辑 `$DSH_HOME/profiles/web/cordis.patch.yml` 里本插件的 `config`（字段与默认值见上方配置表），重启 `dsh web`；或用环境变量 `EXA_API_KEY` / `$DSH_WEB_SEARCH_PROVIDER`。`apiKey` 标记了 `role('secret')`，任何 `describe()` 响应都不会暴露其值。
- **搜索结果卡片**：`web_search` 调用经 `dsh-tool-web` 照常渲染 `web` 结果卡片（来源、摘要、日期），与提供方无关 —— 匿名 Exa 的结果与 DeepSeek 搜索显示完全一致。

**路线图（下一版本）**：新增注册到 `settings.plugin.item` slot 的客户端卡片，绑定 `web-search-exa` 命名空间，让上表所有字段可以在 Settings → Plugins 里实时编辑（与官方卡片同机制）。

## 常见问题（FAQ）

**Q: 需要 Exa API key 吗？**
不需要。无 key 时走 Exa 免费匿名托管 MCP；配 key 后走 REST API 获得更高额度。

**Q: 遇到 HTTP 429 / 限流怎么办？**
这是 Exa 匿名 MCP 的限流。配置 `EXA_API_KEY`（或 `apiKey` 字段），提供方会自动切到 REST 路径。

**Q: 能和官方 Exa 提供方一起装吗？**
可以——给本包一个不同的 `providerId` 并显式选中即可（见[与官方包共存](#与官方包共存)）。

**Q: 为什么 Web UI 里没有设置入口？**
本版本只在服务端注册了 `web-search-exa` 设置命名空间；UI 卡片计划在下一版本提供。现阶段通过 `cordis.patch.yml` 或环境变量配置（见[在 Web 面板中的呈现](#在-web-面板中的呈现)）。

**Q: 支持哪些 dsh 版本？**
本版本支持 dsh `0.1.2-rc.1` 及其匹配的 `dsh-web`、`dsh-settings`、`dsh-launch-environment` 包；`0.1.5-alpha.1` 线未经本版本测试。

## 致谢（Acknowledgements）

匿名 MCP 接入方式参考了 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 的 `web_search` 实现（`packages/coding-agent/src/web/search/providers/exa.ts` 与 `src/exa/mcp-client.ts`）以及 [`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) 插件：同样的"有 key 走 REST、无 key 走免凭据 `mcp.exa.ai/mcp`"策略、同样的 `x-exa-source` 来源头、同样的 `Title:` 分节响应解析。感谢 oh-my-pi（omp）项目率先打通了零配置的 Exa 接入。

同时感谢 **[Exa](https://exa.ai)** 提供并运营这个**免费、免认证的托管 MCP 服务器**（`mcp.exa.ai/mcp`）——正是它让本包的零配置默认路径成为可能。Exa 托管 MCP 是 Exa 的官方产品；匿名使用有限流（见 FAQ）。

## 更新日志（Changelog）

所有变更见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
