//打包前自检：manifest引用的每个文件都得真实存在。浏览器加载扩展时缺文件只会给一句
//含糊的报错，而providers logo缺失更隐蔽——只在那个provider的账号出现时才裂图。
//providers logo与PROVIDERS表的对应关系由core的format.test.ts覆盖，这里不重复。
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
  assert.ok(fs.existsSync(path.join(__dirname, rel)), `manifest引用的文件不存在: ${rel}`);
}

//popup.html自己引的资源（样式与脚本）manifest里看不到，单独校验
const html = fs.readFileSync(path.join(__dirname, manifest.action.default_popup), 'utf8');
for (const [, rel] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  assert.ok(fs.existsSync(path.join(__dirname, rel)), `popup.html引用的文件不存在: ${rel}`);
}

//扩展版本必须与package.json一致，否则CI按tag同步版本时会漏掉manifest
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
assert.strictEqual(manifest.version, pkg.version, `manifest.json与package.json版本不一致`);

console.log('chromium assets ok');
