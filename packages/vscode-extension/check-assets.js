//全工程图片只有images/ 一处。这个自检守住这条约定：logo / 图标 / README截图一旦被挪走
//或改名（像这次从media/ 合并过来），打包出来的详情页和面板才不会等到装上才发现裂图。
//跑法：node check-assets.js（package.json的test脚本，CI打包前会执行）。
//providers logo的存在性由core的format.test.ts覆盖，这里不重复。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
for (const rel of [manifest.icon, manifest.contributes.viewsContainers.activitybar[0].icon]) {
  assert.ok(rel.startsWith('images/'), `图标未指向images/: ${rel}`);
  assert.ok(fs.existsSync(path.join(__dirname, rel)), `图标文件缺失: ${rel}`);
}

//两份README的图片必须都落在images/ 里，且文件真实存在（vsce只重写前缀，不校验目标）。
for (const readme of ['README.md', '../../README.md']) {
  const file = path.join(__dirname, readme);
  const base = path.dirname(file);
  for (const [, rel] of fs.readFileSync(file, 'utf8').matchAll(/!\[[^\]]*\]\((?!\w+:)([^)]+)\)/g)) {
    assert.ok(rel.includes('images/'), `${readme} 引用了images/ 之外的图片: ${rel}`);
    assert.ok(fs.existsSync(path.join(base, rel)), `${readme} 引用的图片不存在: ${rel}`);
  }
}

console.log('assets ok');
