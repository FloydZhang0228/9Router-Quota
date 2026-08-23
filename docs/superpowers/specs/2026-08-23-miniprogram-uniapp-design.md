# 微信/支付宝/字节小程序客户端(uni-app)设计

## 背景

`9Router-Quota` 目前有两个独立客户端:`packages/chromium-extension`(Chrome 扩展)和 `packages/vscode-extension`(VSCode 扩展)。两者共享 `packages/core` 里的纯逻辑(格式化、provider 信息、类型、请求客户端),但各自的 UI 层(`popup.ts` / `media/app.js`)完全独立手写,互不复用。

本次要新增第三类客户端:微信/支付宝/字节小程序,要求**一套代码同时编译出三端产物**。

## 目标

1. 新增 `packages/miniprogram`,用 uni-app(CLI/vite 方式,Vue3 + `<script setup>` + TypeScript)开发,一份源码通过 `build:mp-weixin` / `build:mp-alipay` / `build:mp-toutiao` 三条命令分别产出微信、支付宝、字节小程序包。
2. 尽量复用 `packages/core` 现有逻辑,复用不了的地方在小程序端单独写。
3. 小程序端界面风格(登录卡片、配额环形图、list/grid 切换、最近请求两行)尽量与 VSCode/Chrome 两端保持一致。
4. 小程序端不做 VSCode 扩展独有的状态栏 tooltip / `asciiBar` / `buildTooltip` 功能。

## 非目标

- 不改动 `/home/floyd/WorkSpace/9router`(9Router 后端)任何代码。
- 不把 VSCode/Chrome 现有 UI 代码迁移到 uni-app 上——现有两端 UI 代码保持原样,零改动、零风险。
- 不追求"最近请求"的实时推送体验,轮询即可(见下方方案)。

## 架构总览

```
packages/
  core/                 既有,少量重构(见下)
  chromium-extension/   既有,不改
  vscode-extension/     既有,不改
  miniprogram/          新增,uni-app 项目,npm workspace 新成员
```

`packages/miniprogram` 用标准 uni-app CLI(vite)脚手架搭建,加入根 `package.json` 的 `workspaces`(通配符 `packages/*` 已覆盖,无需改根配置)。

## `core` 复用范围

| 文件 | 处理方式 |
|---|---|
| `format.ts` | 原样复用,零改动。纯函数,无浏览器 API 依赖 |
| `providers.ts` | 原样复用,零改动 |
| `types.ts` | 原样复用,零改动 |
| `client.ts` | **小改**:抽出可注入的请求适配器(见下),`login`/`fetchConnections`/`fetchUsage`/分页/报错逻辑三端共享 |
| `client.ts` 的 `openRecentRequestsStream` | **不复用**。小程序端"最近请求"走独立轮询方案(见下),不调用这个函数 |

### `client.ts` 重构方案

```ts
// 新增类型:请求适配器接口,行为对齐 fetch 的最小子集
export type RequestAdapter = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; headers: { get(name: string): string | null } }>;

export class NineRouterClient {
  constructor(baseUrl: string, authMode: AuthMode = 'manual', adapter: RequestAdapter = fetchAdapter) { ... }
  // 内部所有 fetch(...) 调用替换成 this.adapter(...)
}
```

- 不传 `adapter` 参数时,默认使用包装了全局 `fetch` 的 `fetchAdapter`,行为与现在完全一致——**VSCode/Chrome 两端调用代码不用改一行**。
- `openRecentRequestsStream` 保持依赖原生 `fetch` + `ReadableStream`,不纳入适配器改造范围(小程序端本来就不用它)。
- 重构完成后必须跑通:`packages/core` 的 `npm run build && node dist/format.test.js`,以及 `packages/chromium-extension`/`packages/vscode-extension` 的现有 build + test,确认零回归。

### `miniprogram/src/lib/uniRequestAdapter.ts`(新增)

把 `uni.request` 包成符合 `RequestAdapter` 接口的适配器:

- 发请求前,如果本地已有缓存的 Cookie,手动加到 `headers.Cookie`(与 VSCode 的 `manual` 鉴权模式同思路)。
- `login()` 响应回来后,尝试从响应头里读 `Set-Cookie`(`uni.request` 的 `res.header` 是否暴露这个字段是本设计**最大的不确定项**,见下方"风险"章节)。
- 用 `NineRouterClient(baseUrl, 'manual', uniRequestAdapter)` 构造客户端。

### `miniprogram/src/lib/recentLogsPoller.ts`(新增,不进 core)

- 定时(10~15 秒)`GET /api/usage/logs`(9Router 现成接口,已在 `PROTECTED_API_PATHS` 里,鉴权方式与 `fetchConnections` 相同,不需要后端改动)。
- 响应是字符串数组,每行格式:`"HH:mm:ss | model | PROVIDER | account | promptTokens | completionTokens | status"`(见 `usageRepo.js` 的 `getRecentLogs`)。按 `" | "` 切分成 7 段,映射成:

```ts
interface PolledLogRow {
  displayTime: string;   // 后端已格式化好的时间,不是 ISO,不能复用 core 的 timeAgo()
  model: string;
  provider: string;
  account: string;
  promptTokens: string;  // 后端可能给 "-",不保证是数字,按字符串展示
  completionTokens: string;
  status: string;
}
```

- 只展示前 2 条(与 VSCode/Chrome 两端 `footerRows` 的 `slice(0, 2)` 行为一致)。
- 页面 `onHide` 时停止轮询、`onShow` 时恢复,避免小程序在后台空耗流量。

## UI 范围

三端一致复刻的界面(样式尽量照搬现有 CSS 的间距/圆角/配色分档):

- 登录卡片(logo、标题、地址输入、密码输入、提示文案——提示文案按平台调整措辞,如"密码保存在小程序本地存储中")
- 配额环形图(复用 `format.ts` 的 `levelOf`/`remainingOf`/`amountText`,SVG 环形算法照搬 `RING_RADIUS`/`RING_CIRCUMFERENCE` 那套)
- list / grid 视图切换
- 最近请求两行(数据来自 `recentLogsPoller`,不是 SSE)

明确不做:状态栏 tooltip、`asciiBar`、`buildTooltip`(VSCode 独有,小程序没有对应宿主能力,也不需要)。

## 鉴权与密码存储

- 鉴权:`manual` 模式,手动摘 Cookie、手动带 Cookie,与 VSCode 扩展主机模式一致。
- 密码存储:`uni.setStorageSync`/`getStorageSync`(跨三端统一 API)明文存 `baseUrl` + `password`,与 Chrome 扩展的 `chrome.storage.local` 安全等级相当,不是新引入的降级。

## 定时刷新

参考 Chrome 端 `REFRESH_INTERVAL_MIN`,用标准 `setInterval`(小程序前台页面生命周期内可用,不需要像 Chrome service worker 那样应对进程回收,所以不需要 `chrome.alarms` 那一套)。`onHide`/`onShow` 生命周期钩子控制启停。

## 风险与验证顺序

**唯一的不确定项(必须作为实现计划第一个任务先验证,验证不通过则本设计不成立)**:

`uni.request` 在微信 / 支付宝 / 字节三端,登录响应的 `Set-Cookie` 是否能被 JS 读到(`res.header['Set-Cookie']` 或等价字段)。这是"手动摘 Cookie 再回传"这条鉴权路径成立的前提。三个平台是否一致、`uni.request` 是否统一抹平差异,目前没有把握,且约定不改后端,没有 plan B。

验证方式:先写一个最小可运行的登录页 + `uniRequestAdapter`,在微信开发者工具 / 支付宝小程序开发者工具 / 字节小程序开发者工具里各跑一次真实登录,打印响应头确认。三端只要有一端读不到,需要回来重新讨论方案(不在本设计文档预先假设解法)。

## 测试策略

- `core`:新增一个小测试,验证 `NineRouterClient` 不传 `adapter` 时行为与重构前完全一致(防止重构引入回归)。
- `uniRequestAdapter` 的 Cookie 提取逻辑、`recentLogsPoller` 的日志行解析逻辑:写不依赖小程序运行时的普通 Node 单测(纯函数,输入输出断言)。
- UI 部分:小程序生态没有等价的无头自动化测试方案,人工在三端开发者工具里过一遍登录、配额展示、list/grid 切换、最近请求刷新。

## 构建产物

`packages/miniprogram/package.json` 新增标准 uni-app 脚本:

```json
{
  "scripts": {
    "dev:mp-weixin": "uni -p mp-weixin",
    "build:mp-weixin": "uni build -p mp-weixin",
    "build:mp-alipay": "uni build -p mp-alipay",
    "build:mp-toutiao": "uni build -p mp-toutiao"
  }
}
```

三端产物目录分别在 `dist/build/mp-weixin`、`dist/build/mp-alipay`、`dist/build/mp-toutiao`,分别导入对应平台开发者工具预览/上传(小程序上架需人工提交审核,不纳入本次 CI 自动化范围)。
