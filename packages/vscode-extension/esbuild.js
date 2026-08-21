const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * 把 README 里的截图内联成 data URI，产出 README.packaged.md 供 vsce 打包。
 *
 * 起因：vsce 会把 README 里的相对图片路径重写成
 * `https://github.com/<repo>/raw/HEAD/<路径>`。本仓库是私有的，该地址匿名访问一律
 * 404；且它按仓库根解析，而图片在 packages/vscode-extension/ 下，路径本身也是错的。
 * `--baseContentUrl` 只能改前缀，治不了私有仓库这一层。data URI 不触发任何网络请求，
 * vsce 也不会重写绝对 URI，是唯一稳的做法。
 *
 * README.md 本身保持相对路径不变——它在 GitHub 上要正常显示，也便于阅读和 diff。
 */
function buildPackagedReadme() {
  const src = path.join(__dirname, 'README.md');
  const out = path.join(__dirname, 'README.packaged.md');
  const md = fs.readFileSync(src, 'utf8').replace(/!\[([^\]]*)\]\((?!\w+:)([^)]+)\)/g, (all, alt, rel) => {
    const file = path.join(__dirname, rel);
    if (!fs.existsSync(file)) throw new Error(`README 引用的图片不存在: ${rel}`);
    const mime = path.extname(file) === '.png' ? 'image/png' : 'image/jpeg';
    return `![${alt}](data:${mime};base64,${fs.readFileSync(file).toString('base64')})`;
  });
  fs.writeFileSync(out, md);
  console.log(`README.packaged.md 已生成（${Math.round(md.length / 1024)}KB）`);
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    buildPackagedReadme();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
