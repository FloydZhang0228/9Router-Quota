# 9Router Quota

在 VSCode 里查看 [9Router](https://github.com/decolua/9router) 各 AI 账号配额用量的客户端扩展。

## 一、工程简介

### 1. 项目背景

9Router 是一个 AI 服务聚合网关，可接入 Claude、OpenAI、Gemini、DeepSeek 等多家供应商账号。本工程为其配套的配额监控客户端，当前提供 VSCode 扩展形态，方便在编辑器内实时掌握各账号的剩余配额与请求动态。9Router 服务端的部署请参考其官方仓库：[decolua/9router](https://github.com/decolua/9router)（含 Docker 一键部署与配置说明）。

### 2. 运行截图

截图素材统一放在 `packages/vscode-extension/images/`（要随 vsix 打包给市场页面用），这里直接引用同一份，不另存一套。

<1> 侧边栏面板 · 列表视图（进度条 + 剩余百分比 + 重置倒计时，底部为实时最近请求）：

<img src="packages/vscode-extension/images/screenshot-list.png" alt="列表视图" width="340" />

<2> 侧边栏面板 · 圆环视图（同一份数据的紧凑排布，适合账号配额条目较多时速览）：

<img src="packages/vscode-extension/images/screenshot-ring.png" alt="圆环视图" width="340" />

<3> 状态栏悬浮配额卡片（悬停右下角 `9R` 图标）：

<img src="packages/vscode-extension/images/screenshot-tooltip.png" alt="状态栏悬浮卡片" width="360" />

### 3. 功能特性

<1> 活动栏侧边栏面板：分组卡片展示各账号配额，支持列表/圆环双视图切换。

<2> 状态栏指示：右下角常驻 `9R` 图标，悬浮显示配额摘要卡片（账号分段 + 进度条 + 剩余百分比/余额 + 重置倒计时），每 5 分钟自动刷新。

<3> 实时最近请求：面板底部状态条通过 SSE 长连接实时推送最近两条请求（模型、输入/输出 token、相对时间），无需手动刷新。

<4> 单账号刷新：每个账号卡片带独立刷新按钮，可单独重拉该账号数据。

<5> 主题切换：深色 / 浅色 / 跟随 VSCode 主题三档循环切换，偏好跨会话保留。

<6> 余额型配额直读：DeepSeek 等信用池类账号直接显示真实余额数字而非百分比。

### 4. 配置与登录

<1> 首次使用：打开 VSCode 左侧活动栏的 `9R` 图标，在面板中填入 9Router 服务地址（如 `http://9router.example.com`）与 Dashboard 密码。

<2> 密码存储：密码仅保存在 VSCode 本地凭据库（SecretStorage），不同步、不明文落盘。

<3> 服务地址也可通过设置项 `9routerQuota.baseUrl` 预先配置。

### 5. 目录结构

```
packages/
  core/               平台无关核心逻辑：登录、拉取账号/配额、SSE 流式订阅、
                      文案格式化。纯 TypeScript + 原生 fetch，不依赖平台 API，
                      供各端复用或移植。
  vscode-extension/   VSCode 扩展客户端：活动栏面板 + 状态栏悬浮卡片。
    media/            面板前端资源（app.js / style.css / 各供应商 logo）。
    images/           README 截图，随 vsix 打包供 Marketplace 页面显示。
    .github/          （仓库级）CI 工作流：tag 触发自动打包发布。
```

### 6. 技术栈

① TypeScript + esbuild：core 与扩展均为 TS,esbuild 打包无框架依赖。

② 原生 VSCode Webview API:面板为自制 HTML/CSS/JS,不引入 React 等前端框架。

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
npx @vscode/vsce package --no-dependencies
```

产物为当前目录下的 `9router-quota-<版本号>.vsix`。

### 5. 本地安装 vsix

```bash
code --install-extension 9router-quota-<版本号>.vsix
```

或在 VSCode 命令面板执行 `Extensions: Install from VSIX...` 选择文件。

## 三、GitHub 上编译打包

### 1. 工作流说明

仓库内置 `.github/workflows/release.yml`：推送 `v` 开头的 SemVer tag（如 `v0.2.0`）时自动触发，流程为拉取代码 → `npm ci` → 构建 core → 从 tag 同步扩展 manifest 版本 → `vsce package` 打包 → 校验 VSIX 文件名版本 → 创建 GitHub Release 并上传附件。

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

例如 `v0.2.0` 会自动产出 `9router-quota-0.2.0.vsix`。版本同步只发生在 GitHub Actions 的临时工作区，不会回写仓库。

③ 到仓库 Actions 页确认 Release 工作流执行成功，Releases 页即可下载 vsix。

### 3. 注意事项

<1> tag 必须符合 `v<SemVer>` 格式（如 `v0.2.0`）；非法格式会在版本同步步骤直接失败。

<2> 相同版本号不应重复打 tag；发布失败修复后应 bump 版本号再发。

<3> 打包在干净环境进行，`packages/core` 会由工作流先构建，无需提交 `dist/` 产物。

## 四、发布到 VSCode Marketplace

整个流程涉及两个不同的站点，务必用**同一个 Microsoft 账号**登录：Azure DevOps（签发 PAT）和 Marketplace 管理页（创建 Publisher）。绝大多数发布失败都源于这两处账号不一致，或下面第 2 步的 PAT 参数选错。

### 1. 注册 Azure DevOps（一次性）

① 访问 [dev.azure.com](https://dev.azure.com/)，用 Microsoft 账号登录。

② 首次登录会提示创建组织（organization），名称随意、免费。这个组织本身跟扩展发布没有关系，仅仅是 Azure DevOps 要求账号至少归属一个组织才能签发 PAT。

### 2. 创建 PAT（一次性，也是最容易出错的一步）

在 Azure DevOps 右上角头像旁的 **User settings（齿轮/人像图标）→ Personal access tokens → + New Token**，按下表填写：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| Name | 随意，如 `vsce-publish` | 仅用于自己识别 |
| **Organization** | **All accessible organizations** | 顶部的独立下拉框，默认是你刚建的那个组织名。**必须改成这一项**，否则 PAT 只对该组织有效，发布时报 401 |
| Expiration | 按需，最长 1 年 | 到期后需重新签发并更新 CI Secret |
| **Scopes** | 选 **Custom defined**，然后点列表最下方的 **Show all scopes**，展开后勾选 **Marketplace → Manage** | `Manage` 在默认的精简列表里**不显示**，不点 "Show all scopes" 根本找不到；勾 `Manage` 会自动包含 `Acquire` 和 `Publish` |

点 Create 后**立即复制保存**这串 token，关闭弹窗后无法再次查看。

> 常见误区：`Organization` 和 `Scopes` 是两个独立字段。"All accessible organizations" 属于前者，不是 Scope 的一个选项。

### 3. 创建 Publisher（一次性）

① 访问 [Marketplace 发布管理页](https://marketplace.visualstudio.com/manage)，用**与第 1 步相同的 Microsoft 账号**登录。

② 点 **Create publisher**，其中 **ID** 必须与 `packages/vscode-extension/package.json` 里的 `publisher` 字段完全一致（本仓库为 `FloydZhang0228`）。ID 创建后不可更改，Display name 可以随时改。

③ 创建完成后，管理页应能看到这个 publisher 名下的扩展列表（首次为空）。

若跳过这一步直接 publish，会报 `The Personal Access Token used has expired` 或权限类错误——实际原因往往是 publisher 不存在，而非 token 有问题。

### 4. 手动发布

① 安装发布工具（如尚未安装）：

```bash
npm install -g @vscode/vsce
```

② 验证 PAT 与 publisher 均配置正确（这一步失败就不必往下走，先回查第 2、3 步）：

```bash
vsce login FloydZhang0228
```

粘贴第 2 步的 PAT。看到 `The Personal Access Token succeeded.` 即为通过。

③ 打包并发布：

```bash
npm run build                      # 仓库根目录，先构建 core 与扩展
cd packages/vscode-extension
vsce publish --no-dependencies
```

发布后约几分钟完成校验，扩展出现在 `https://marketplace.visualstudio.com/items?itemName=FloydZhang0228.9router-quota`，用户可在 VSCode 扩展面板搜索 `9Router Quota` 安装。

> `--no-dependencies` 不能省：本仓库是 npm workspace，扩展依赖的 `@9router-quota/core` 已由 esbuild 打进 `dist/`，不加该参数 vsce 会尝试解析 workspace 依赖树并失败。

### 5. 通过 CI 自动发布（可选）

① 在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：Name 填 `VSCE_PAT`，Secret 填第 2 步的 PAT。

② 修改 `.github/workflows/release.yml`，在 `Package vsix` 步骤之后、`Create GitHub Release` 之前加入：

```yaml
      - name: Publish to Marketplace
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
        run: cd packages/vscode-extension && npx @vscode/vsce publish --no-dependencies
```

`vsce` 会自动读取 `VSCE_PAT` 环境变量。用 env 而非命令行 `-p` 参数，可避免 token 出现在 Actions 日志的命令回显里。

之后每次推 tag，除了产出 GitHub Release，还会同步把新版本推上市场。

### 6. 发布失败对照表

| 报错 | 实际原因 |
| --- | --- |
| `401 Unauthorized` | PAT 的 Organization 没选 "All accessible organizations"（第 2 步） |
| `You do not have permission to publish` | Scopes 没勾到 `Marketplace → Manage`，或漏点 "Show all scopes"（第 2 步） |
| `The Personal Access Token used has expired` | token 真过期，或 publisher 尚未创建（第 3 步） |
| `Missing publisher name` | `package.json` 缺 `publisher` 字段 |
| `package.json` 报 private | `"private": true` 会被 vsce 拒绝，须删除该字段 |
| 版本号已存在 | 同一版本号不能重复发布，需 bump 版本 |

### 7. 仓库侧要求（本仓库均已满足）

<1> `packages/vscode-extension/package.json` 含 `publisher`、`repository`、`license`，且**不含** `"private": true`。

<2> 仓库根目录有 `LICENSE` 文件。

<3> `packages/vscode-extension/README.md` 即 Marketplace 页面正文，其中的截图放在同目录 `images/` 下走相对路径（本仓库为私有，raw.githubusercontent.com 的绝对地址匿名访问会 404）。

<4> `packages/vscode-extension/.vscodeignore` 控制打包内容，避免把源码、CI 配置打进 vsix。
