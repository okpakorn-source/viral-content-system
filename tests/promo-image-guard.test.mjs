// ============================================================
// promo-image-guard.test.mjs — TIER2 สายงาน ข (เคส AC-0196 ศรราม)
//   (1) isPromoNote/isPromoImage (src/lib/promoImageGuard.js) — ตาราง regex จริง 15-20+ ข้อความไทย
//       ทั้งฝั่งต้องแบน (ปกคลิป/กราฟิกทับ/โปสเตอร์ล้วน) และห้ามแบน (ปฏิเสธ/บริบทคนละความหมาย)
//   (2) s6_slots wiring (src/lib/megaAdapters.js) — แบนระดับพูล + พื้นกันพูลล่ม (เติมภาพโปรโมทคะแนนดีสุด
//       กลับเมื่อพูล < POOL_MIN_FLOOR) + สวิตช์ MEGA_PROMO_BAN / MEGA_TIER2_OFF + ข้อความ error แยกเหตุ
//   ไม่ยิง LLM/network/store จริง (loader stubs + injected fakes) · deterministic ล้วน
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// pin gates ที่ไม่เกี่ยวออกให้หมด (isolate promo ban) — module-level constants อ่านครั้งเดียวตอน import
process.env.S6_REAL_SIZE_GATE = '0';
process.env.S6_STORY_FIT = '0';
process.env.MEGA_QUARANTINE = '0';
process.env.POOL_CLEAN_GATE = '0';     // ปิดด่านสะอาด — เทสนี้โฟกัสเฉพาะ promo ban ไม่ให้ clean-gate ปนผล
process.env.MEGA_S6_MIN_CLEAN = '0';
process.env.MEGA_SOLVER_DIAGNOSTICS_V2 = '0';
process.env.MEGA_CROP_PREFILTER = '0'; // ปิดเลนครอป (ไม่มี refMatch ใน job อยู่แล้ว แต่ปิดซ้ำกันชน)
delete process.env.MEGA_SEMANTIC_SELECTION;
delete process.env.MEGA_SELECTION_SPEC;
delete process.env.MEGA_REF_HERO_V2;
delete process.env.MEGA_ROLE_READINESS;
delete process.env.MEGA_FINAL_DECISION_EVIDENCE_V2;

const { isPromoNote, isPromoImage } = await import('../src/lib/promoImageGuard.js');
const { s6_slots } = await import('../src/lib/megaAdapters.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };

// ═══════════════════════ (1) isPromoNote — ตาราง regex จริง ═══════════════════════

// ── ต้องแบน (12 เคส) — คัดจากตัวอย่างจริงในรายงานตรวจ (ปกคลิป/กราฟิกทับ/โปสเตอร์ล้วน/รายการ+ฉากหลัง) ──
const BAN_CASES = [
  ['ภาพโปรโมทรายการทีวี มีไฟ marquee ฉากหลัง ตัวหนังสือ SHOW', 'เคสจริง ศรราม: โปรโมทรายการ+ฉากหลัง'],
  ['โปสเตอร์ล้วน ไม่มีคนจริง แค่กราฟิกโปรโมท', 'โปสเตอร์ล้วน + กราฟิกโปรโมท'],
  ['เป็นโปสเตอร์หนังเรื่องใหม่ แปะเต็มเฟรม', 'เป็นโปสเตอร์'],
  ['ภาพโปสเตอร์การเลือกตั้ง แปะเต็มบอร์ดประกาศ', 'ภาพโปสเตอร์'],
  ['ปกรายการที่ช่องทำเอง มีโลโก้มุมขวา', 'ปกรายการ'],
  ['ภาพนิ่งจากปกวิดีโอ กราฟิกล้วนไม่มีภาพจริง', 'กราฟิกล้วน (ปกคลิป)'],
  ['แถบกราฟิกพาดหัวข่าวทับภาพคนในข่าว', 'แถบกราฟิกทับภาพ'],
  ['การ์ดกราฟิกโควตคำพูด ไม่มีภาพคนเลย', 'การ์ดกราฟิก'],
  ['คอลลาจกราฟิกรวมหลายภาพในเฟรมเดียว', 'คอลลาจกราฟิก'],
  ['ตัวหนังสือใหญ่เต็มจอ อ่านไม่ออกว่าใคร', 'ตัวหนังสือใหญ่'],
  ['logo รายการ มุมซ้ายบน พื้นหลังไฟกระพริบ', 'logo รายการ'],
  ['ยืนอยู่หน้าฉากหลังรายการ มีไฟส่องจัดเต็ม', 'ฉากหลัง+รายการ สลับลำดับ (ไม่ผูกลำดับ)'],
];
for (const [note, label] of BAN_CASES) {
  await test(`promo regex ต้องแบน: ${label}`, async () => {
    assert.equal(isPromoNote(note), true, `คาดว่าแบน แต่ไม่แบน — note="${note}"`);
  });
}

// ── ห้ามแบน (10 เคส) — ปฏิเสธนำหน้า + บริบทคนละความหมาย (เคสจริงจากรายงานตรวจ) ──
const NOBAN_CASES = [
  ['ไม่มีกราฟิกทับใบหน้า ภาพชัดสะอาด', 'ปฏิเสธ: ไม่มีกราฟิกทับ'],
  ['ไม่ใช่โปสเตอร์ เป็นภาพถ่ายจริงจากงานแถลงข่าว', 'ปฏิเสธ: ไม่ใช่โปสเตอร์'],
  ['ปราศจากตัวหนังสือใหญ่ ภาพสะอาดพร้อมใช้', 'ปฏิเสธ: ปราศจากตัวหนังสือใหญ่'],
  ['ยืนถ่ายกับโปสเตอร์ภาพยนตร์ในงานเปิดตัว ยิ้มสดใส', 'บริบท: ยืนถ่ายกับโปสเตอร์ในงาน (ภาพข่าวจริง ไม่ใช่ภาพโปสเตอร์เอง)'],
  ['รายการทรัพย์สินที่ถูกอายัด วางเรียงบนโต๊ะแถลงข่าว', '"รายการ" = บัญชี/ทรัพย์สิน ไม่ใช่รายการทีวี (ไม่มีฉากหลัง)'],
  ['ยืนหน้าฉากหลังบ้าน สวนดอกไม้ ไม่มีกราฟิกใดๆ', 'ฉากหลังบ้านจริง ไม่มีคำว่า "รายการ" เลย'],
  ['ภาพข่าวจริง คนเดินผ่านตลาด ฉากหลังเป็นร้านค้า', 'มี "ฉากหลัง" แต่ไม่มี "รายการ" คู่กัน'],
  ['แถลงข่าวเปิดตัวรายการใหม่ นั่งพูดในสตูดิโอ ไม่มีตัวหนังสือใหญ่', 'มี "รายการ" แต่ไม่มี "ฉากหลัง" + ปฏิเสธตัวหนังสือใหญ่'],
  ['ภาพคู่ยิ้มให้กล้อง บรรยากาศอบอุ่น ไม่มีคำเสี่ยงเลย', 'ภาพปกติทั่วไป'],
  ['', 'note ว่าง/ไม่มีค่า'],
];
for (const [note, label] of NOBAN_CASES) {
  await test(`promo regex ห้ามแบน: ${label}`, async () => {
    assert.equal(isPromoNote(note), false, `คาดว่าไม่แบน แต่ดันแบน — note="${note}"`);
  });
}

await test('isPromoImage: อ่านจาก x.triage.note ของแถวพูล (backstop input พิสดาร)', async () => {
  assert.equal(isPromoImage({ triage: { note: 'โปสเตอร์ล้วน' } }), true);
  assert.equal(isPromoImage({ triage: { note: 'ภาพข่าวปกติ' } }), false);
  assert.equal(isPromoImage({ triage: {} }), false);
  assert.equal(isPromoImage({}), false);
  assert.equal(isPromoImage(null), false);
  assert.equal(isPromoImage(undefined), false);
});

// ═══════════════════════ (2) s6_slots wiring — pool-level ban + พื้นกันพูลล่ม ═══════════════════════

const IMG = (id, note, t = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  thumbnailUrl: '',
  realWidth: 1200, realHeight: 1600,
  triage: { relevant: true, clean: true, faceCount: 1, person: null, persons: [], category: 'context', emotion: 'warm', note: note || '', newsScene: true, quality: 7, ...t },
});
const CHARS = [{ name: 'ทดสอบโปรโมท', role: 'hero' }];
// ★ hero ต้องเป็น "ตัวตนถูกคน" (identity gate เดิม — คนละเรื่องกับ promo ban) — แปะ person ให้ตรง CHARS เสมอ
//   (ตามแพทเทิร์นเดียวกับ crop-guard.test.mjs BIG/SMALL) กัน false-fail 'ไม่มีภาพตัวเอกที่ถูกคนเลย' ที่ไม่เกี่ยวกับสิ่งที่เทสนี้ตรวจ
const HERO_ID = { person: 'ทดสอบโปรโมท', persons: ['ทดสอบโปรโมท'] };
// ★ ไม่มี refMatch (ไม่มี DNA) → _refDNA=null → เลน crop-prefilter ข้ามทั้งบล็อกเอง (โฟกัสเฉพาะ promo ban)
const mkJob = () => ({ dossier: { images: { caseId: 'PROMO-TEST' }, compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: CHARS, visualDreamShots: [], doNotUse: [] }, desk: { title: 'ข่าวทดสอบภาพโปรโมท' } } });
const mkDeps = ({ pool, answer, captures }) => ({
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: answer, note: 'mock' }; },
  fetchJson: async (url) => { captures.fetches.push(url); if (String(url).includes('/api/images/')) return { success: true, images: pool }; throw new Error('unexpected fetch: ' + url); },
});

await test('promo ban: พูลพอ (≥ POOL_MIN_FLOOR หลังตัด) → ตัดภาพโปรโมททิ้งเงียบ ไม่ต้องเติมกลับ', async () => {
  setEnv('MEGA_PROMO_BAN', null); // default ON
  setEnv('MEGA_TIER2_OFF', null);
  const H = IMG('H', '', HERO_ID); const R = IMG('R', ''); const A = IMG('A', ''); const C = IMG('C', ''); const CI = IMG('CI', '');
  const G1 = IMG('G1', ''); // ตัวเติมให้ non-promo ครบ 6 ใบ (≥ floor)
  const P1 = IMG('P1', 'โปสเตอร์ล้วน ภาพโปรโมทรายการ', { faceCount: 2, quality: 9 });
  const P2 = IMG('P2', 'แถบกราฟิกพาดหัวทับภาพ', { faceCount: 1, quality: 4 });
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'H', reason: 'x', backups: [] }, reaction: { id: 'R', reason: 'x', backups: [] }, action: { id: 'A' }, context: { id: 'C' }, circle: { id: 'CI' } };
  await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [H, R, A, C, CI, G1, P1, P2], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const ids = meta.map((m) => m.id);
  assert.ok(!ids.includes('P1') && !ids.includes('P2'), 'ภาพโปรโมททั้งคู่ต้องไม่เข้าพูล (non-promo พอแล้ว 6 ใบ ไม่ต้องเติมกลับ)');
  assert.equal(meta.length, 6, 'พูลใช้จริง = 6 ใบ (H R A C CI G1) หลังตัดโปรโมท 2 ใบ');
});

await test('promo ban: พูลบางกว่าพื้น (< POOL_MIN_FLOOR) → เติมภาพโปรโมทคะแนนดีสุดกลับ (กันพูลล่ม) + ใช้งานได้จริง', async () => {
  setEnv('MEGA_PROMO_BAN', null); // default ON
  const H = IMG('H', '', HERO_ID); const R = IMG('R', ''); const A = IMG('A', ''); const C = IMG('C', ''); const CI = IMG('CI', '');
  // เหลือ non-promo แค่ 5 ใบ (ต่ำกว่าพื้น 6) — มี 2 ใบโปรโมท คะแนนต่างกันชัด
  const P1 = IMG('P1', 'โปสเตอร์ล้วน ภาพโปรโมทรายการ', { faceCount: 2, quality: 9 }); // ดีกว่า → ต้องถูกเติมกลับ
  const P2 = IMG('P2', 'แถบกราฟิกพาดหัวทับภาพ', { faceCount: 1, quality: 4 });        // แย่กว่า → ยังโดนตัดทิ้ง
  const captures = { brainArgs: [], fetches: [] };
  // ให้สมองเลือก P1 (ใบที่เติมกลับ) ลงช่อง circle ตรงๆ เพื่อยืนยันว่าใช้งานได้จริงหลังเติมกลับ (ไม่ใช่แค่โผล่ใน meta เฉยๆ)
  const answer = { hero: { id: 'H', reason: 'x', backups: [] }, reaction: { id: 'R' }, action: { id: 'A' }, context: { id: 'C' }, circle: { id: 'P1' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [H, R, A, C, CI, P1, P2], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  const ids = meta.map((m) => m.id);
  assert.ok(ids.includes('P1'), 'P1 (คะแนนดีสุดในกลุ่มโปรโมท) ต้องถูกเติมกลับเข้าพูล');
  assert.ok(!ids.includes('P2'), 'P2 (คะแนนแย่กว่า) ยังโดนตัดทิ้ง (เติมแค่พอถึงพื้น)');
  assert.equal(s6.status !== 'failed', true, 'งานไม่ fail แม้พูลเดิม (ไม่รวมโปรโมท) บางกว่าพื้น');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.circle.id, 'P1', 'ช่อง circle ได้ P1 ตามที่สมองเลือก (ยืนยันว่าใช้งานได้จริงหลังเติมกลับ ไม่ใช่แค่ค้างในพูล)');
  assert.equal(pi.slots.circle.dirtyFallback, true, 'P1 ติดธง dirtyFallback (เตือนว่าเป็นของเติมพื้นกันล่ม ไม่ใช่ตัวเลือกสะอาดปกติ)');
});

await test('kill-switch เฉพาะจุด: MEGA_PROMO_BAN=0 → ไม่กรองภาพโปรโมทเลย (พฤติกรรมเดิมเป๊ะ)', async () => {
  setEnv('MEGA_PROMO_BAN', '0');
  const H = IMG('H', '', HERO_ID); const R = IMG('R', ''); const A = IMG('A', ''); const C = IMG('C', ''); const CI = IMG('CI', '');
  const P1 = IMG('P1', 'โปสเตอร์ล้วน ภาพโปรโมทรายการ');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'H' }, reaction: { id: 'R' }, action: { id: 'A' }, context: { id: 'C' }, circle: { id: 'P1' } };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [H, R, A, C, CI, P1], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  assert.ok(meta.map((m) => m.id).includes('P1'), 'MEGA_PROMO_BAN=0 → P1 (โปรโมท) ต้องเข้าพูลตามปกติ ไม่ถูกกรอง');
  const pi = s6.dossierPatch.pickImages;
  assert.equal(pi.slots.circle.id, 'P1');
  assert.equal(pi.slots.circle.dirtyFallback, false, 'ไม่ผ่านด่านโปรโมท (ปิดสวิตช์) → ไม่ติดธง dirtyFallback');
  setEnv('MEGA_PROMO_BAN', null);
});

await test('สวิตช์แม่ MEGA_TIER2_OFF=1 → ปิด promo ban ไปด้วย (ถอยกลับทั้งชุด TIER2 ด้วยตัวเดียว)', async () => {
  setEnv('MEGA_TIER2_OFF', '1');
  const H = IMG('H', '', HERO_ID); const R = IMG('R', ''); const A = IMG('A', ''); const C = IMG('C', ''); const CI = IMG('CI', '');
  const P1 = IMG('P1', 'โปสเตอร์ล้วน ภาพโปรโมทรายการ');
  const captures = { brainArgs: [], fetches: [] };
  const answer = { hero: { id: 'H' }, reaction: { id: 'R' }, action: { id: 'A' }, context: { id: 'C' }, circle: { id: 'P1' } };
  await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [H, R, A, C, CI, P1], answer, captures }) });
  const meta = captures.brainArgs[0].imagesMeta;
  assert.ok(meta.map((m) => m.id).includes('P1'), 'MEGA_TIER2_OFF=1 → promo ban ปิดไปด้วย → P1 เข้าพูลได้เหมือน MEGA_PROMO_BAN=0');
  setEnv('MEGA_TIER2_OFF', null);
});

await test('error message: ภาพทั้งหมดถูกซ่อน junkHidden ล้วน (ไม่เกี่ยวกับ promo) → ข้อความเดิม ไม่พูดถึงโปรโมท', async () => {
  setEnv('MEGA_PROMO_BAN', null);
  const H = IMG('H', '', HERO_ID); H.triage.junkHidden = true;
  const R = IMG('R', ''); R.triage.junkHidden = true;
  const captures = { brainArgs: [], fetches: [] };
  const s6 = await s6_slots(mkJob(), { origin: 'http://mock', _deps: mkDeps({ pool: [H, R], answer: {}, captures }) });
  assert.equal(s6.status, 'failed');
  assert.ok(/junkHidden/.test(s6.summary), `ข้อความต้องพูดถึง junkHidden (ได้: ${s6.summary})`);
  assert.ok(!/โปรโมท/.test(s6.summary), `ไม่ควรพูดถึงโปรโมทเมื่อไม่มีส่วนเกี่ยว (ได้: ${s6.summary})`);
});

console.log(`\n1..${passed}`);
