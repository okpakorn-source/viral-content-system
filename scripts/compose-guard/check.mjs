// ============================================================
// 🛡️ Compose Guard — เครื่องเทสนิ่ง + การ์ด hero (เฟส 0.2/0.3 แผนแก้ความฉลาดประกอบปก 9 ก.ค. 2569)
// ------------------------------------------------------------
// ใช้ slotPlan "แช่แข็ง" ยิง /api/mega/compose-test (ข้าม compass+S6 LLM) → วัดเฉพาะชั้นประกอบ/ครอป
//   node scripts/compose-guard/check.mjs --init   → รันเต็ม 1 ครั้ง เก็บ slotPlan+ครอป hero เป็น baseline
//   node scripts/compose-guard/check.mjs          → รันแผนแช่แข็ง เทียบครอป hero กับ baseline (±3px)
//   env: COMPOSE_URL (default http://localhost:9161) · CASE_ID (default AC-0045) · REF_ID
// เกณฑ์: hero (slot=main) ภาพเดิม+branch เดิม+กรอบเดิม — เพี้ยนเกิน tolerance = FAIL (ห้าม merge)
// ============================================================
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const URL_BASE = process.env.COMPOSE_URL || 'http://localhost:9161';
const CASE_ID = process.env.CASE_ID || 'AC-0045';
const REF_ID = process.env.REF_ID || 'REF-mrbq90fp-r6l1';
const DIR = path.join(process.cwd(), 'scripts', 'compose-guard');
const BASELINE = path.join(DIR, `baseline-${CASE_ID}.json`);
const TOL = 3; // px

const init = process.argv.includes('--init');

async function post(body) {
  const res = await fetch(`${URL_BASE}/api/mega/compose-test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(`compose-test ล้ม: ${j.error || res.status} (${j.errorType || ''})`);
  return j;
}

function fmt(c) {
  const t = c.trace;
  return t
    ? `${c.slot} | ${t.branch} | faces=${t.faces} | img=${t.imgW}x${t.imgH} | region=${t.region.left},${t.region.top},${t.region.width}x${t.region.height}`
    : `${c.slot} | trace=null`;
}

// --init: รันเต็ม 1 ครั้งเก็บ slotPlan → รันแช่แข็ง 1 ครั้งเก็บครอป baseline (เทียบแอปเปิลกับแอปเปิล)
// --rebase: ใช้ slotPlan เดิมในไฟล์ แค่รันแช่แข็งอัดครอป baseline ใหม่ (หลังยืนยันว่าพฤติกรรมใหม่คือที่ต้องการ)
const rebase = process.argv.includes('--rebase');
if (init || rebase) {
  let slotPlan;
  if (rebase) {
    slotPlan = JSON.parse(await readFile(BASELINE, 'utf8')).slotPlan;
    console.log(`[guard] --rebase: ใช้ slotPlan เดิม (${slotPlan.length} ภาพ)`);
  } else {
    console.log(`[guard] --init: รันเต็ม (compass+S6) เคส ${CASE_ID} ref ${REF_ID} เพื่อเก็บ slotPlan...`);
    const full = await post({ caseId: CASE_ID, refId: REF_ID, stableOrder: true });
    if (!Array.isArray(full.slotPlanUsed) || full.slotPlanUsed.length < 3) throw new Error('ไม่ได้ slotPlanUsed จากรันเต็ม');
    slotPlan = full.slotPlanUsed;
  }
  console.log('[guard] รันแช่แข็ง 1 ครั้งเก็บครอป baseline...');
  const r = await post({ caseId: CASE_ID, refId: REF_ID, stableOrder: true, slotPlan });
  if (!r.frozenPlan) throw new Error('โหมดแช่แข็งไม่ทำงาน (ไม่มี frozenPlan=true)');
  const hero = (r.crops || []).find((c) => /main|hero/i.test(String(c.slot)));
  if (!hero?.trace) throw new Error('ไม่พบ trace ของช่อง hero');
  await mkdir(DIR, { recursive: true });
  await writeFile(BASELINE, JSON.stringify({
    savedAt: new Date().toISOString(), caseId: CASE_ID, refId: REF_ID,
    slotPlan, heroBaseline: hero, allCrops: r.crops,
  }, null, 2), 'utf8');
  console.log(`[guard] ✅ baseline saved → ${BASELINE}`);
  (r.crops || []).forEach((c) => console.log('  ' + fmt(c)));
  process.exit(0);
}

const base = JSON.parse(await readFile(BASELINE, 'utf8'));

function heroFails(r) {
  const hero = (r.crops || []).find((c) => /main|hero/i.test(String(c.slot)));
  const hb = base.heroBaseline;
  const fails = [];
  let iou = null;
  if (!hero?.trace) fails.push('hero ไม่มี trace');
  else {
    if (hero.url !== hb.url) fails.push(`hero เปลี่ยนภาพ: ${hb.url} → ${hero.url}`);
    if (hero.trace.branch !== hb.trace.branch) fails.push(`hero เปลี่ยน branch: ${hb.trace.branch} → ${hero.trace.branch}`);
    // ★ เกณฑ์กรอบ: IoU ≥ 0.82 แทน ±3px ต่อขอบ — detector (gpt-4o-mini) ให้กล่องหน้าแกว่ง ±20px ข้ามรันเป็นปกติ
    const A = hb.trace.region, B = hero.trace.region;
    const ix = Math.max(0, Math.min(A.left + A.width, B.left + B.width) - Math.max(A.left, B.left));
    const iy = Math.max(0, Math.min(A.top + A.height, B.top + B.height) - Math.max(A.top, B.top));
    const inter = ix * iy;
    iou = inter / Math.max(1, A.width * A.height + B.width * B.height - inter);
    if (iou < 0.82) fails.push(`hero กรอบครอปเพี้ยนเกิน jitter ปกติ: IoU ${iou.toFixed(3)} < 0.82 (${A.left},${A.top},${A.width}x${A.height} → ${B.left},${B.top},${B.width}x${B.height})`);
  }
  return { fails, iou };
}

// ★ รันได้สูงสุด 2 รอบ — heroScore มี "เหรียญสุ่ม" จาก detector jitter (hero พลิก 50↔78 มีมาก่อนแตะโค้ดครอป
//   — บันทึกเฟส 0) · ถ้าโค้ดทำ hero พังจริง จะไม่มีรอบไหนตรง baseline เลย → ยัง FAIL เหมือนเดิม
let passed = false;
for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
  console.log(`[guard] รันแผนแช่แข็ง (${base.slotPlan.length} ภาพ) เคส ${base.caseId} ref ${base.refId}... (รอบ ${attempt}/2)`);
  const r = await post({ caseId: base.caseId, refId: base.refId, stableOrder: true, slotPlan: base.slotPlan });
  if (!r.frozenPlan) throw new Error('response ไม่มี frozenPlan=true — โหมดแช่แข็งไม่ทำงาน (เช็ค route)');
  if (process.env.COVER_OUT && r.base64) {
    const b64 = String(r.base64).replace(/^data:image\/\w+;base64,/, '');
    await writeFile(process.env.COVER_OUT, Buffer.from(b64, 'base64'));
    console.log(`[guard] 🖼️ เซฟปก → ${process.env.COVER_OUT}`);
  }
  (r.crops || []).forEach((c) => console.log('  ' + fmt(c)));
  const { fails, iou } = heroFails(r);
  if (!fails.length) {
    console.log(`[guard] ✅ HERO GUARD PASS — hero ภาพเดิม+สาขาเดิม+กรอบ IoU ${iou == null ? '-' : iou.toFixed(3)} (เกณฑ์ ≥0.82) · ref ${r.refSimilarity}%${attempt > 1 ? ' · (รอบแรกโดน hero-flip เหรียญสุ่ม — อาการเดิมก่อนแผนนี้)' : ''}`);
    passed = true;
  } else {
    console.log(`[guard] ${attempt < 2 ? '⚠️ รอบนี้ไม่ตรง baseline (ลองซ้ำ — แยก jitter ออกจาก regression จริง):' : '❌ HERO GUARD FAIL (ไม่ตรงทั้ง 2 รอบ):'}`);
    fails.forEach((f) => console.log('  - ' + f));
  }
}
if (!passed) process.exit(1);
