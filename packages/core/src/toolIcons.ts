/**
 * 工具栏 Unicode 图标的墨迹校准数据。
 *
 * 背景：各图标取自不同 Unicode 区块（几何图形/杂项符号/补充箭头/彩色 emoji），
 * 字体的 em 框设计与字形墨迹比例各不相同——同一个 font-size 下，
 * ◎ 墨迹 ≈ 1.0em，◐ 只有 ≈ 0.5em，☰ ≈ 0.77em。逐个猜 font-size 已经
 * 在 Chrome 扩展上修挂过两次（跨平台字体还不一样），换思路：
 * 统一字号，按每字形实测的墨迹比例算 scale，用 CSS transform 放缩墨迹
 * 本体，槽位行盒不动，视觉尺寸严格一致。
 *
 * dy 是墨迹垂直中心相对基线偏移（以 ◎ 为基准的差值，13px 坐标系），
 * 修正"同一行视觉上不齐线"的残差；配合 translate 在 scale 前、不被缩放。
 *
 * ink/dy 值来自 canvas measureText 的 actualBoundingBox，在
 * Chromium/Windows(Noto/Segoe UI Symbol) 实测；iOS/Android 系统 emoji
 * 字体略有出入，但比例差异远小于原来的跨字形差异，肉眼找平够用。
 * ponytail: 若某平台仍明显不齐，把该平台的实测比例并进该表即可。
 */
const INK: Record<string, { ratio: number; dy: number }> = {
  '☰': { ratio: 0.77, dy: 0.5 },
  '◎': { ratio: 1.0, dy: 0 },
  '◐': { ratio: 0.52, dy: -1 },
  '🌙': { ratio: 0.66, dy: 0 },
  '☀️': { ratio: 1.0, dy: 0 },
  '⟳': { ratio: 0.87, dy: 0 },
  '⏻': { ratio: 0.62, dy: 0 },
};

/** 把 glyph 的墨迹缩放到 targetEm 个 em 宽并垂直找平。返回 CSS transform 值。 */
export function iconTransform(glyph: string, targetEm = 1): string {
  const { ratio, dy } = INK[glyph] ?? { ratio: 1, dy: 0 };
  return `translateY(${dy}px) scale(${(targetEm / ratio).toFixed(3)})`;
}
