# @tonydua/dsh-web-search-exa

> **使用 [deepseek-v4-flash](https://api-docs.deepseek.com) 与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）开发。**

为 DeepSeek Harness web 能力 seam（`ctx.web`）提供的 Exa 搜索提供方（`WebSearchProvider`），内置**匿名兜底**：未配置 API key 时，搜索经由 Exa 官方托管的 MCP 服务器（`https://mcp.exa.ai/mcp`）以 JSON-RPC 2.0 发起，**完全不携带任何凭据** —— 即 Exa 官方提供的免认证公共 MCP fallback（有限流）。配置了 `EXA_API_KEY` 时则改用更轻量的 REST 端点。

这是一个**实现**包：它向 `ctx.web` 注册提供方（`inject: ['web']`），不拥有面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。模型侧的 `web_search` / `web_fetch` 工具、提示词区段与 Web 结果卡片均不受影响。

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
| 配置键 | `apiKey`、`baseURL`、`searchType`、`numResults`、`highlightsPerResult` | `apiKey`、`apiKeyEnv`、`apiURL`、`mcpURL`、`searchType`、`numResults`、`highlightsPerResult`、`providerId` |

## 致谢（Acknowledgements）

匿名 MCP 接入方式参考了 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 的 `web_search` 实现（`packages/coding-agent/src/web/search/providers/exa.ts` 与 `src/exa/mcp-client.ts`）以及 [`@oh-my-pi/exa`](https://www.npmjs.com/package/@oh-my-pi/exa) 插件：同样的"有 key 走 REST、无 key 走免凭据 `mcp.exa.ai/mcp`"策略、同样的 `x-exa-source` 来源头、同样的 `Title:` 分节响应解析。感谢 oh-my-pi（omp）项目率先打通了零配置的 Exa 接入。

同时感谢 **[Exa](https://exa.ai)** 提供并运营这个**免费、免认证的托管 MCP 服务器**（`mcp.exa.ai/mcp`）——正是它让本包的零配置默认路径成为可能。Exa 托管 MCP 是 Exa 的官方产品；匿名使用有限流（见"已知限制"）。

## 工作原理

| 条件 | 路径 | 端点 |
|---|---|---|
| 配置了 `apiKey` / `EXA_API_KEY` | REST `POST /search`，`Authorization: Bearer` | `https://api.exa.ai/search`（可配置） |
| 未配置任何 key | 匿名 MCP `tools/call web_search_exa`（JSON-RPC 2.0，无凭据） | `https://mcp.exa.ai/mcp`（可配置） |

匿名 MCP 路径不发送任何凭据，来源标识通过 `x-exa-source: dsh-anything` 头携带。结果按 seam 的 `WebSearchSource` 形状规范化（`url`、`title`、`snippet`、`publishedAt`），`maxResults` 由 seam 在返回路径上强制执行。匿名使用受 Exa 限流：HTTP 429 会以 `WEB_PROVIDER_ERROR` 呈现，并提示配置 API key（配置后自动切换到 REST 路径）。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `exa` | 注册进 `ctx.web` 的提供方 id。仅当本包与官方包同时安装时才需要改（见下一节）。 |
| `apiKey` | 未设置 | Exa API 密钥字面值。为空/缺失时启用匿名 MCP 路径。 |
| `apiKeyEnv` | `EXA_API_KEY` | 未设置字面 `apiKey` 时读取的环境变量名。 |
| `apiURL` | `https://api.exa.ai/search` | REST 搜索端点（仅带 key 的路径使用）。 |
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

## 安装（装入 dsh profile）

在本仓库目录下：

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

或把 `patches/exa-anon-search.patch.yml` 作为覆盖层传入：

```powershell
dsh --profile web --patch patches/exa-anon-search.patch.yml
```

也可以不修改配置，直接用环境变量 `$DSH_WEB_SEARCH_PROVIDER=exa` 在运行时选中该提供方。

重启 `dsh web` 生效。模型侧的 `web_search` 工具随即走该提供方，无需改任何工具配置。

### 运行时单例兼容性

`@deepseek-ai/dsh-tools` 是 dsh 的运行时单例包，一个 profile 中必须解析到同一份物理包实例。本插件本身不依赖它；这是宿主 profile 的依赖约束。如果 profile 中的其他第三方插件把 `@deepseek-ai/dsh-tools` 错误声明成普通嵌套依赖，而不是 peer dependency，应先修正该插件的依赖声明，或让 profile 的包管理器统一解析到共享实例，再排查搜索错误。否则 dsh agent loop 可能在 provider 被调用前就因 `Cannot read properties of undefined (reading 'prepare')` 失败。

## 在 Web 面板中的呈现

**状态：本版本的配置入口在 profile 补丁层，不在 Web UI —— 没有可编辑的界面入口。** Settings UI 只渲染客户端插件为固定命名空间（`shell`、`agent-loop`、`web-search-deepseek`）手工注册的卡片，对任意插件命名空间没有通用表单。当前实际情况：

- **插件清单**（Settings → Plugins）：启用后自动出现 `web-search-exa`（`@tonydua/dsh-web-search-exa`）条目 —— 清单直接读取 Cordis loader 的实时条目，无需额外代码。
- **设置命名空间**（服务端）：插件通过 `installSettingsSection` 注册了 `web-search-exa` 段，数据层可写——但**没有任何客户端卡片绑定它**，所以界面上不显示。内置的 "Web search" 卡片编辑的是官方 `web-search-deepseek` 命名空间，与本插件无关。
- **现在怎么改配置**：编辑 `$DSH_HOME/profiles/web/cordis.patch.yml` 里本插件的 `config`（字段与默认值见上方配置表），重启 `dsh web`；或用环境变量 `EXA_API_KEY` / `$DSH_WEB_SEARCH_PROVIDER`。`apiKey` 标记了 `role('secret')`，任何 `describe()` 响应都不会暴露其值。
- **搜索结果卡片**：`web_search` 调用经 `dsh-tool-web` 照常渲染 `web` 结果卡片（来源、摘要、日期），与提供方无关 —— 匿名 Exa 的结果与 DeepSeek 搜索显示完全一致。

**路线图（下一版本）**：新增注册到 `settings.plugin.item` slot 的客户端卡片，绑定 `web-search-exa` 命名空间，让上表所有字段可以在 Settings → Plugins 里实时编辑（与官方卡片同机制）。

## 开源说明

- 许可证：MIT（见 `LICENSE`）。
- 仓库：<https://github.com/TonyDua/dsh-web-search-exa>。
- 包已可执行 npm 打包：`publishConfig.access: public`、`files` 仅含 `lib/`、ESM 且带 `exports` 映射与类型声明。发布前请执行 `npm test` 和 `npm pack --dry-run`。
- 发布：先 `npm login`（对着 `registry.npmjs.org`，不是 `.npmrc` 里的 npmmirror 默认源），再 `npm publish --registry https://registry.npmjs.org --cache <可写缓存目录>`。`@tonydua` scope 会在首次发布时自动归属到发布账号。

## 已知限制

- **匿名 MCP 有限流**（HTTP 429 → `WEB_PROVIDER_ERROR` 并附提示）。配置 `EXA_API_KEY` 可提额，提供方会自动切到 REST 路径。
- **无 snippet 的结果会被丢弃**（seam 规则：没有可移植的摘要）。匿名 MCP 通常返回完整 `Text` 块，会截断到 `MAX_SNIPPET_CHARS`（500 字符）作为 snippet。
- **只暴露查询与结果数控制**：新近程度、域名过滤、深度搜索等尚未映射（可等 seam 的提供方无关字段扩展后补充）。
- 匿名 MCP 响应按 `Title:` 分节文本格式解析；Exa 托管 MCP 输出结构变化时可能需要更新解析器。
- **暂无 Web UI 设置入口**——配置走 profile 补丁层（见"在 Web 面板中的呈现"）。
