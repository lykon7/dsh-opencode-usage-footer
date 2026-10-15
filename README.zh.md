# dsh-opencode-usage-footer

> 在 DeepSeek Harness Web 输入框下方，安静地显示 OpenCode Go 用量（`5h` / `7d` / `30d`）。

```
…  ▂▃▅  Go   5h ▓░░ 12%   7d ▓░░ 34%   30d ▓▓▓ 56%
```

这是一个 `dsh` 插件：只占用输入框底部那一行——和 Harness 自己的统计药丸、上下文
计量并排。鼠标悬停某个窗口可看到它的名称、占额度比例和重置倒计时；悬停整行可看到
最近一次刷新时间。它不可点击，只是一块读数。

## 为什么还要有这一个

已经有三个插件能在这个界面显示 OpenCode Go 用量
（[`dsh-plugin-opencode-usage`](https://www.npmjs.com/package/dsh-plugin-opencode-usage)、
[`dsh-opencode-go-usage`](https://www.npmjs.com/package/dsh-opencode-go-usage)、
[`dsh-opencode-usage`](https://www.npmjs.com/package/dsh-opencode-usage)）。
需要历史、趋势、告警或 agent 工具，请用它们——它们功能更多。

这一个刻意做小，理由只有三条：

- **位置**：待在输入框底部那一行，与 Harness 已有的信息并排；不是悬浮面板，也不是
  侧边栏徽标。不遮挡会话内容，也不新增需要点击的入口。
- **没人看的时候就停下来**：宿主端只在页面近期轮询过时才刷新；最后一次轮询两分钟
  后，不再向 opencode.ai 发出任何请求。空转的界面不给上游添负担。
- **会说明自己为什么是空的**：`no key`、`key rejected`、`offline`、`timeout`、
  `api changed`，而不是显示一个理直气壮的 `0%`。

## 安装

```sh
dsh plugin --profile web add dsh-opencode-usage-footer
```

然后重启 `dsh web`（或让 HMR 重新组合 profile），打开任意会话即可在输入框下方看到。
从本地目录安装：

```sh
dsh plugin --profile web add /path/to/dsh-opencode-usage-footer
```

**前提**：OpenCode Go 订阅，按正常方式在 **设置 → 模型 → 添加模型提供商 → opencode-go**
里添加。Harness 会把这个提供商的 Console API Key 存为凭据 `OPENCODE_GO_API_KEY`，
本插件读的就是它（也是该提供商推理时用的同一个 Key）——不需要浏览器 Cookie，
也不需要第二个 Key。也可以直接导出同名环境变量，它的优先级更高。

## 工作原理

```text
浏览器  ── GET /opencode-usage ──▶  宿主端
                                     │ ctx.credentials.resolve("OPENCODE_GO_API_KEY")
                                     │ GET https://opencode.ai/zen/go/v1/usage
                                     ▼
                                   缓存快照（被观察时每 60 秒刷新一次）
```

上游只返回三个窗口的百分比与重置时间（见英文 README 的 JSON 示例）；宿主端补充
缓存状态与错误类型，因此读不到数据时也能说清原因。

| 节奏 | 取值 | 位置 |
| --- | --- | --- |
| 浏览器轮询（标签页可见） | 30 秒，回到前台再拉一次 | `lib/client.js` |
| 被观察时的宿主刷新 | 60 秒 | `lib/index.js` |
| 直接返回缓存的时长 | 45 秒 | `lib/index.js` |
| 后台刷新停止 | 最后一次轮询后 2 分钟 | `lib/index.js` |
| 上游请求超时 | 15 秒 | `lib/index.js` |

## 失败状态

| 显示 | 含义 | 处理 |
| --- | --- | --- |
| `Go …` | 首次读取中 | — |
| `Go no key` | 没有找到 `OPENCODE_GO_API_KEY` | 在 **设置 → 模型 → 添加模型提供商** 里添加，或导出环境变量 |
| `Go key rejected` | opencode.ai 返回 401/403 | 到 OpenCode 控制台重新签发 Key |
| `Go offline` / `Go timeout` | 宿主端无法访问 opencode.ai | 检查网络 |
| `Go api changed` | 响应里没有用量窗口 | 更新 `lib/index.js` 中的 `parseUsage` |
| 数字变暗 | 显示的是上一次成功读数，最新刷新失败 | 悬停可看到具体错误 |

## 兼容性

| DSH 版本 | 状态 |
| --- | --- |
| `0.2.0-rc.2` | 已验证——本插件用到的每个 seam |

包内按社区惯例声明了两处兼容信息：`engines.dsh` 与逐版本对齐的
`@deepseek-ai/dsh-*` peer 依赖（host webserver、client slot renderer、
可选的 credentials），以及供目录界面读取的 `dsh.compatibility.dshReleases`。
范围写法提醒：`>=0.2.0-rc.2 <0.3.0-0` 必须单独成段，写宽了会静默排除其他
`major.minor.patch` 元组的预发布版本。

## 安全与隐私

- API Key 不离开宿主进程；到浏览器的只有百分比、重置时间和错误文本。
- `GET /opencode-usage` 不做鉴权，继承 webserver 的绑定地址。默认 `127.0.0.1`
  时只有本机可读；若绑定 `0.0.0.0` 或放在反向代理后，能访问该端口的人就能读到
  这三个百分比——介意就保持回环，或在代理层限制该路径。
- 与所有 Harness 插件一样，这段代码以你的权限运行在宿主与浏览器中，安装前请自行阅读。

## 开发

```sh
pnpm install
pnpm test        # 离线：上游接口被打桩，不需要 Key
```

`test/host-half.test.mjs` 用假的宿主上下文驱动真实的 `apply()`，覆盖路由注册、
快照结构、缓存行为、`HEAD`/`405` 以及全部错误码；`test/client-half.test.mjs`
通过真实的 `window.__ModuleLoader__` 加载发布包，在 jsdom 中用 react-dom 挂载，
断言首屏、三个窗口的百分比、进度条、aria 标签、悬停提示、过期状态与两种失败界面。

## 发布

按标签发布，使用 npm trusted publishing（OIDC），任何机器上都不存在长期 token：

```sh
npm version patch
git push --follow-tags
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
