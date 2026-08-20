# 9Router Quota

查看 [9Router](https://github.com/) 各 AI 账号配额用量的多端客户端。

## 目录结构

```
packages/
  core/               平台无关核心逻辑：登录、拉取账号/配额、文案格式化。
                      纯 TypeScript + 原生 fetch，不依赖任何平台 API，
                      供各端复用或移植。
  vscode-extension/   VSCode 扩展客户端：状态栏按钮 + 底部 Panel 展示配额。
```

后续 Windows / Linux / macOS / iOS / Android 客户端计划用跨平台框架实现，
待框架选型后在 `packages/` 下新增对应目录，复用或移植 `core` 的逻辑。

## 开发

```bash
npm install
npm run build
```

VSCode 扩展调试：打开 `packages/vscode-extension`，按 F5 启动扩展开发宿主。
