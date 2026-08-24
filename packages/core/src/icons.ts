/**
 * 工具栏图标统一改用内联 SVG（feather 风格，viewBox 0 0 24 24，描边制）。
 *
 * 字体字形路线已失败三次：各 Unicode 字形墨迹比例、基线摆位由平台字体决定
 * （Chromium/Noto、iOS 苹方、微信自带字体各不相同），font-size 猜值和
 * transform scale 都收敛不了。SVG 几何固定，不依赖任何字体度量——这是
 * 唯一能保证三端大小严格一致、且天然水平居中的方案。
 *
 * 网页端（Chrome 扩展 / VSCode webview）用 toolIconSvg() 内联 <svg>，
 * 颜色走 currentColor 跟随主题；
 * 微信小程序 wxml 不支持内联 svg，同一份路径源生成 WXSS -webkit-mask
 * 数据 URI（见 packages/miniprogram/src/pages/index/index.vue 样式段，
 * 两处需同步改）。
 */
export const TOOL_ICONS: Record<string, string> = {
  refresh: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  grid: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  'theme-system': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
  'theme-dark': '<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>',
  'theme-light':
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
};

/** 生成网页端内联 svg 字符串；currentColor 跟随宿主 color。 */
export function toolIconSvg(name: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICONS[name] ?? ''}</svg>`;
}
