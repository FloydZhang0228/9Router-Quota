//打成应用店/手动加载都能用的zip。Chromium系没有vsce那样的官方打包工具，
//上架Chrome网上应用店、Edge Add-ons、360开放平台提交的都是zip（crx由平台签名生成）。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

require('./check-assets.js');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const out = path.join(__dirname, `9router-quota-chromium-${pkg.version}.zip`);
fs.rmSync(out, { force: true });

//只打运行时需要的东西：源码、构建脚本、sourcemap都不进包
const entries = ['manifest.json', 'popup.html', 'styles.css', 'dist', 'images'];
execFileSync('zip', ['-r', '-q', out, ...entries, '-x', '*.map'], { cwd: __dirname });

console.log(`已打包: ${path.basename(out)} (${Math.round(fs.statSync(out).size / 1024)}KB)`);
