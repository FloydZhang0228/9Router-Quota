# 9Router Quota

查看 [9Router](https://github.com/decolua/9router) 各 AI 账号配额用量的客户端，提供 VSCode 扩展与 Chromium 系浏览器扩展（Chrome / Edge / 360 等）两种形态。

## 一、工程简介

### 1. 项目背景

9Router 是一个 AI 服务聚合网关，可接入 Claude、OpenAI、Gemini、DeepSeek 等多家供应商账号。本工程为其配套的配额监控客户端：VSCode 扩展在编辑器内实时掌握各账号剩余配额，Chromium 系浏览器扩展则以工具栏弹窗形式提供同一套功能，两端共用同一份展示逻辑（`packages/core`），界面保持一致。9Router 服务端的部署请参考其官方仓库：[decolua/9router](https://github.com/decolua/9router)（含 Docker 一键部署与配置说明）。

### 2. 运行截图

全工程图片只有 `packages/vscode-extension/images/` 一处（截图、扩展图标、各供应商 logo），文档与代码一律从这里取，不另存副本。

#### VSCode 扩展

登录页 · 浅色 / 深色：

<img src="packages/vscode-extension/images/screenshot-login-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-login-dark.png" width="45%" />

侧边栏面板 · 列表视图（进度条 + 剩余百分比 + 重置倒计时，底部为实时最近请求）：

<img src="packages/vscode-extension/images/screenshot-list-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-list-dark.png" width="45%" />

侧边栏面板 · 圆环视图（同一份数据的紧凑排布，适合账号配额条目较多时速览）：

<img src="packages/vscode-extension/images/screenshot-ring-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-ring-dark.png" width="45%" />

#### Chromium 系浏览器扩展

登录页 · 浅色 / 深色：

<img src="packages/vscode-extension/images/screenshot-chromium-login-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-chromium-login-dark.png" width="45%" />

弹窗 · 列表视图：

<img src="packages/vscode-extension/images/screenshot-chromium-list-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-chromium-list-dark.png" width="45%" />

弹窗 · 圆环视图：

<img src="packages/vscode-extension/images/screenshot-chromium-grid-light.png" width="45%" /> <img src="packages/vscode-extension/images/screenshot-chromium-grid-dark.png" width="45%" />

### 3. 功能特性

<1> 面板展示：分组卡片展示各账号配额，支持列表/圆环双视图切换；VSCode 在活动栏侧边栏，Chromium 扩展在工具栏弹窗（圆角窗口，宽度按屏幕宽度自适应）。

<2> VSCode 状态栏指示：右下角常驻 `9` 图标，悬浮显示配额摘要卡片（账号分段 + 进度条 + 剩余百分比/余额 + 重置倒计时），每 5 分钟自动刷新。

<3> 实时最近请求：面板底部状态条通过 SSE 长连接实时推送最近两条请求（模型、输入/输出 token、相对时间），无需手动刷新。

<4> 单账号刷新：每个账号卡片带独立刷新按钮，可单独重拉该账号数据。

<5> 主题切换：深色 / 浅色 / 跟随系统三档循环切换，首次启动默认跟随系统，手动切换后偏好跨会话保留。

<6> 余额型配额直读：DeepSeek 等信用池类账号直接显示真实余额数字而非百分比。

### 4. 配置与登录

<1> VSCode：打开左侧活动栏的 `9` 图标，在面板中填入 9Router 服务地址（如 `http://9router.example.com`）与 Dashboard 密码；密码仅保存在 VSCode 本地凭据库（SecretStorage），不同步、不明文落盘。服务地址也可通过设置项 `9routerQuota.baseUrl` 预先配置。

<2> Chromium 扩展：点击工具栏图标打开弹窗，同样填入服务地址与密码；密码保存在浏览器扩展的本地存储中，不会同步到云端。

### 5. 目录结构

```
packages/
  core/                平台无关核心逻辑：登录、拉取账号/配额、SSE 流式订阅、
                       文案格式化。纯 TypeScript + 原生 fetch，不依赖平台 API，
                       供各端复用或移植。
  vscode-extension/    VSCode 扩展客户端：活动栏面板 + 状态栏悬浮卡片。
    media/             面板前端资源（app.js / style.css）。
    images/            全工程唯一图片目录：README 截图、扩展图标、各供应商 logo。
  chromium-extension/  Chromium 系浏览器扩展客户端：工具栏弹窗，Manifest V3。
    src/               background service worker + popup 前端。
    images/            扩展自身运行时图标（工具栏、供应商 logo），跟文档截图目录分开。
  .github/             （仓库级）CI 工作流：tag 触发自动打包发布 vsix 与 chromium zip。
```

### 6. 技术栈

① TypeScript + esbuild：core 与扩展均为 TS,esbuild 打包无框架依赖。

② 原生 VSCode Webview API / Chrome Extension Manifest V3:面板均为自制 HTML/CSS/JS,不引入 React 等前端框架，两端渲染逻辑同源。

③ 原生 fetch + SSE:与 9Router 服务端交互零第三方 HTTP 库。

## 二、本地编译打包

### 1. 前置条件

<1> Node.js ≥ 20 及随附的 npm。

<2> 一个运行中的 9Router 服务实例及其 Dashboard 密码。

### 2. 安装与构建

① 安装依赖（仓库根目录执行）：

```bash
npm install
```

② 构建全部包：

```bash
npm run build
```

该命令依次执行：core 的 `tsc` 编译 → 扩展的 `esbuild` 打包。

### 3. 开发调试

用 VSCode 打开 `packages/vscode-extension` 目录，按 F5 启动扩展开发宿主即可调试。

### 4. 本地打包 vsix

```bash
cd packages/vscode-extension
npm run package
```

产物为当前目录下的 `9router-quota-<版本号>.vsix`。

不要直接调 `vsce package`：该脚本会先跑 `check-assets.js` 校验图片，并带上 `--baseImagesUrl`，把 README 里的截图相对路径重写成 `raw.githubusercontent.com` 的绝对地址。vsce 默认按仓库根解析相对路径，而图片在 `packages/vscode-extension/` 下，少了这个前缀扩展详情页的截图会全部裂图。

截图必须走 https 绝对地址，不能内联成 data URI：VSCode 1.104 起扩展详情页的 Markdown 消毒器只放行 `http`/`https` 协议的 `src`，`data:` 图片会被整个剥掉。也因此仓库必须保持公开，否则 raw 地址匿名访问 404。

### 5. 本地安装 vsix

```bash
code --install-extension 9router-quota-<版本号>.vsix
```

或在 VSCode 命令面板执行 `Extensions: Install from VSIX...` 选择文件。

### 6. 本地打包 chromium 扩展

```bash
cd packages/chromium-extension
npm run package
```

产物为当前目录下的 `9router-quota-chromium-<版本号>.zip`（manifest/popup/dist/images 运行时文件，不含源码）。本地加载调试：`chrome://extensions` 打开开发者模式 → 加载已解压的扩展程序 → 选中 `packages/chromium-extension` 目录（需先 `npm run compile` 生成 `dist/`）。

## 三、GitHub 上编译打包与分发

本扩展通过 GitHub Release 分发，不上架 VSCode Marketplace（上架需 Azure DevOps 组织，而创建组织已强制要求绑定 Azure 订阅）与 Chrome Web Store（同理需要开发者账号与审核流程）。

### 1. 工作流说明

仓库内置 `.github/workflows/release.yml`：推送 `v` 开头的 SemVer tag（如 `v0.2.0`）时自动触发，流程为拉取代码 → `npm ci` → 构建 core → 从 tag 同步两个扩展的 manifest 版本 → 分别打包 vsix 与 chromium zip → 校验产物文件名版本 → 创建 GitHub Release 并上传两份附件。

### 2. 发布步骤

① 提交并推送代码至 `master`：

```bash
git add -A && git commit -m "..." && git push origin master
```

② 打 tag 并推送（无需手动修改 `package.json` 的 `version`）：

```bash
git tag v<版本号>
git push origin v<版本号>
```

例如 `v0.2.0` 会自动产出 `9router-quota-0.2.0.vsix` 与 `9router-quota-chromium-0.2.0.zip`。版本同步只发生在 GitHub Actions 的临时工作区，不会回写仓库。

③ 到仓库 Actions 页确认 Release 工作流执行成功，Releases 页即可下载两份产物。

### 3. 注意事项

<1> tag 必须符合 `v<SemVer>` 格式（如 `v0.2.0`）；非法格式会在版本同步步骤直接失败。

<2> 相同版本号不应重复打 tag；发布失败修复后应 bump 版本号再发。

<3> 打包在干净环境进行，`packages/core` 会由工作流先构建，无需提交 `dist/` 产物。

### 4. 用户安装方式

从仓库 [Releases](https://github.com/FloydZhang0228/9Router-Quota/releases) 页下载对应版本的产物：

<1> VSCode：下载 `.vsix`，然后 `code --install-extension 9router-quota-<版本号>.vsix`，或在命令面板执行 `Extensions: Install from VSIX...` 选择文件。

<2> Chromium 系浏览器：下载 `.zip` 并解压，打开 `chrome://extensions`（Edge 对应 `edge://extensions`）开启开发者模式，选择「加载已解压的扩展程序」指向解压目录。

