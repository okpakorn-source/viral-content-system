// ============================================================
// 🧪 QC mirror MEGA_FACE_FORWARD (21 ก.ค. — แผนครอประยะ 0)
// ------------------------------------------------------------
// บั๊ก: executor ครอป context ตามสวิตช์ ([5,16]→[22,45]) แต่ QC (measureTechRules)
//   วัดด้วย [5,16] ตายตัว → เปิดสวิตช์แล้วปกหน้าใหญ่ที่ครอปถูกโดนธง face_share_out
// แก้: ทั้งคู่อ้าง TECH_RULES.CONTEXT_FACE_SHARE_FORWARD ตัวเดียว + QC เช็คสวิตช์เอง
// พิสูจน์ (ช่อง context faceShare = 30%):
//   (a) OFF (default): 30 นอก [5,16] → ธง face_share_out:context_1 (พฤติกรรมเดิมเป๊ะ)
//   (b) ON  ('1')    : 30 ใน  [22,45] → ไม่มีธง face_share_out ของ context_1
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const SHARP_STUB = MOD(`export default function sharp(){ return {}; }`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { measureTechRules } = await import('../src/lib/services/megaComposerService.js');

// ช่อง context_1 region สูง 1000px · หน้า (y2-y1)=0.15 บนภาพสูง 2000px = faceHpx 300 → faceShare 30%
// ศูนย์กลางหน้า (320,700) ตกใน region → ถูกวัดแน่นอน
const fixture = () => ({
  assignments: [{ slotId: 'context_1', imageIndex: 0 }],
  spec: { canvasW: 1080, slots: [{ id: 'context_1', x: 0, y: 0, w: 400, h: 500 }] },
  faceBoxes: [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.25, imgW: 1600, imgH: 2000 }],
  cropTrace: [{ slot: 'context_1', region: { left: 0, top: 0, width: 800, height: 1000 } }],
});

const contextShareFlags = (r) => (r.flags || []).filter((f) => f.startsWith('face_share_out:context_1'));

test('(a) OFF (default): context faceShare 30% นอก [5,16] → ธง face_share_out (พฤติกรรมเดิมเป๊ะ)', () => {
  delete process.env.MEGA_FACE_FORWARD;
  const r = measureTechRules(fixture());
  assert.equal(r.measured.bySlot.context_1.faceSharePct, 30, 'ฟิกซ์เจอร์ต้องวัดได้ 30%');
  assert.equal(contextShareFlags(r).length, 1, 'OFF ต้องธง (30 นอก [5,16])');
});

test('(b) ON: context faceShare 30% ใน [22,45] → ไม่มีธง (QC วัดตรงกับ executor แล้ว)', () => {
  process.env.MEGA_FACE_FORWARD = '1';
  try {
    const r = measureTechRules(fixture());
    assert.equal(r.measured.bySlot.context_1.faceSharePct, 30);
    assert.equal(contextShareFlags(r).length, 0, 'ON ต้องไม่ธง (30 ใน [22,45]) — เดิมโดนธงเพราะ QC ไม่รู้จักสวิตช์');
  } finally {
    delete process.env.MEGA_FACE_FORWARD;
  }
});
