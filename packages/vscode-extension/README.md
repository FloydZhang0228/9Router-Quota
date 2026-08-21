# 9Router Quota

在 VSCode 里查看 [9Router](https://github.com/decolua/9router) 各 AI 账号配额用量的客户端扩展。支持 Claude、OpenAI、Gemini、DeepSeek、GLM、Kimi 等 19 家供应商。

<!-- 图片必须用绝对 raw URL：市场渲染相对路径时按 vsce 默认分支（main）改写，
     本仓库主分支是 master，改写后会 404。绝对地址不受这个默认值影响。 -->
## 运行截图

侧边栏面板 · 列表视图（进度条 + 剩余百分比 + 重置倒计时，底部为实时最近请求）：

<img src="https://raw.githubusercontent.com/FloydZhang0228/9Router-Quota/master/docs/screenshot-list.png" alt="列表视图" width="340" />

侧边栏面板 · 圆环视图（同一份数据的紧凑排布，适合配额条目较多时速览）：

<img src="https://raw.githubusercontent.com/FloydZhang0228/9Router-Quota/master/docs/screenshot-ring.png" alt="圆环视图" width="340" />

状态栏悬浮配额卡片（悬停右下角 `9R` 图标）：

<img src="https://raw.githubusercontent.com/FloydZhang0228/9Router-Quota/master/docs/screenshot-tooltip.png" alt="状态栏悬浮卡片" width="360" />

## 功能特性

- **侧边栏面板**：分组卡片展示各账号配额，列表 / 圆环双视图切换。
- **状态栏指示**：右下角常驻 `9R` 图标，悬浮显示配额摘要，每 5 分钟自动刷新。
- **实时最近请求**：面板底部通过 SSE 长连接推送最近两条请求（模型、输入/输出 token、相对时间）。
- **单账号刷新**：每个账号卡片带独立刷新按钮，可单独重拉。
- **主题切换**：深色 / 浅色 / 跟随 VSCode 三档循环，偏好跨会话保留。
- **余额型配额直读**：DeepSeek 等信用池账号直接显示真实余额而非百分比。

## 快速开始

1. 点击左侧活动栏的 `9R` 图标打开面板。
2. 填入 9Router 服务地址（如 `http://9router.example.com`）与 Dashboard 密码。
3. 密码仅存于 VSCode 本地凭据库（SecretStorage），不同步、不明文落盘。

## 设置项

| 配置 | 说明 |
| --- | --- |
| `9routerQuota.baseUrl` | 9Router 服务地址，也可在面板登录时填写 |

## 前置条件

一个运行中的 9Router 服务实例及其 Dashboard 密码。服务端部署见 [decolua/9router](https://github.com/decolua/9router)。

## 许可

MIT。源码与开发文档见 [FloydZhang0228/9Router-Quota](https://github.com/FloydZhang0228/9Router-Quota)。
