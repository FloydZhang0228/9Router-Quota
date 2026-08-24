import assert from 'node:assert';
import { iconTransform } from './toolIcons';

// 基准字形不缩不平
assert.strictEqual(iconTransform('◎'), 'translateY(0px) scale(1.000)');
// 未收录字形兜底
assert.strictEqual(iconTransform('?', 1), 'translateY(0px) scale(1.000)');
// 每字形缩放后墨迹 = targetEm：ink_ratio * (target/ratio) = target
assert.match(iconTransform('◐'), /scale\(1\.923\)/);
assert.match(iconTransform('☰', 0.77), /scale\(1\.000\)/);
// 垂直找平值进 transform，且 translateY 在 scale 前（先平移后缩放，dy 不被放大）
assert.match(iconTransform('◐'), /^translateY\(-1px\) scale/);
assert.match(iconTransform('☰'), /^translateY\(0\.5px\) scale/);

console.log('toolIcons.test.ts passed');
