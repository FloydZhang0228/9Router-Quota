// 打包前自检：manifest 引用的每个文件都得真实存在。浏览器加载扩展时缺文件只会给一句
// 含糊的报错，而 providers logo 缺失更隐蔽——只在那个 provider 的账号出现时才裂图。
// providers logo 与 PROVIDERS 表的对应关系由 core 的 format.test.ts 覆盖，这里不重复。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const must = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
for (const rel of must) {
  assert.ok(fs.existsSync(path.join(__dirname, rel)), `manifest 引用的文件不存在: ${rel}`);
}

// popup.html 自己引的资源（样式与脚本）manifest 里看不到，单独校验
const html = fs.readFileSync(path.join(__dirname, manifest.action.default_popup), 'utf8');
for (const [, rel] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  assert.ok(fs.existsSync(path.join(__dirname, rel)), `popup.html 引用的文件不存在: ${rel}`);
}

// 扩展版本必须与 package.json 一致，否则 CI 按 tag 同步版本时会漏掉 manifest
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
assert.strictEqual(manifest.version, pkg.version, `manifest.json 与 package.json 版本不一致`);

console.log('chromium assets ok');
