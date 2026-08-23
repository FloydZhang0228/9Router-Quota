const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

//background是MV3 service worker（manifest里声明了type: module，必须ESM）；
//popup是普通页面脚本，用IIFE避免再给popup.html加type="module"。
const targets = [
  { entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/popup.ts'], outfile: 'dist/popup.js', format: 'iife' },
];

async function main() {
  const contexts = await Promise.all(
    targets.map((t) =>
      esbuild.context({
        ...t,
        bundle: true,
        platform: 'browser',
        target: 'chrome102', //与manifest的minimum_chrome_version对齐，兼顾内核较旧的国产浏览器
        sourcemap: !production,
        minify: production,
      })
    )
  );
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
