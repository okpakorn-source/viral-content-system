#!/usr/bin/env node
// ============================================================
// 📊 measure-ref-variety.mjs (29 ก.ค. 69, แบตช์ variety) — วัด "ref หมุนกี่ใบจริง" ที่ MEGA_REF_VARIETY_MARGIN
//   ต่างค่ากัน ก่อนเจ้าของเลือกค่า default (ไม่เปลี่ยน default ในแบตช์นี้ — วัดอย่างเดียว)
// ------------------------------------------------------------
// บริบท: เจ้าของสั่ง "เทมเพลตออกแบบซ้ำเกินไป ต้องเรียกใช้หลายแบบกว่านี้" — pickBestRef (refCoverMatch.js)
//   เก็บ ref ทุกใบที่คะแนนอยู่ในช่วง [bestScore-MARGIN, bestScore] เป็น "ผู้ท้าชิง" แล้วสุ่มถ่วงน้ำหนักตาม
//   คะแนน (เลขนิ่งจาก hash(seedKey) ไม่ใช่ Math.random จริง — ให้ retry งานเดิมได้ผลเดิม) MARGIN กว้างขึ้น =
//   ผู้ท้าชิงเข้าวงมากขึ้น = มีโอกาสหมุนมากขึ้น แต่กว้างเกินไปอาจดึง ref ที่ "ไม่ตรงข่าวจริง" เข้ามาด้วย
// วิธีวัด: จำลอง pickBestRef 200 ครั้งต่อชุด signals (seedKey ต่างกันทุกครั้ง จำลอง "งานใหม่" ของเคสเดิม
//   ตามดีไซน์ seedKey ใหม่ที่ผูก job.id) × 3 ชุด signals (กตัญญู/ความรักคู่/กลางๆ) × 3 ค่า MARGIN (1/1.5/2)
//   ใช้ "คลัง ref จริง" ปัจจุบัน (data/ref-cover-library.json ผ่าน listRefCovers จริง) ไม่ใช่ข้อมูลสังเคราะห์
// ใช้: node scripts/measure-ref-variety.mjs
// ============================================================
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { pickBestRef } = await import('../src/lib/refCoverMatch.js');
const { listRefCovers } = await import('../src/lib/refCoverLibrary.js');

const N_RUNS = 200;
const MARGINS = [1, 1.5, 2];

// 3 ชุด signals ตัวแทน — กตัญญู/ความรักคู่ (หมวดที่มี ref ติดป้ายเจาะจงในคลังจริงตอนนี้ 9 ใบ/2 ใบตามลำดับ
// — ดู REF_CATEGORY_KEYWORDS ในแบตช์ก่อนหน้า) + "กลางๆ" (ไม่มีคำหมวดชี้ชัด อาศัยแค่ human-interest/อารมณ์ทั่วไป
// ที่ ref ส่วนใหญ่ในคลังมีติดตัว — ตัวแทนเคสข่าวทั่วไปที่ไม่เข้าหมวดไหนชัดเจน)
const SIGNAL_SETS = {
  'กตัญญู': {
    emotion: 'ซึ้งใจ',
    text: 'กตัญญู ตอบแทนบุญคุณพ่อแม่ ซื้อบ้านให้แม่',
    charCount: 2,
  },
  'ความรักคู่': {
    emotion: 'อบอุ่น',
    text: 'แต่งงาน คู่รัก ครบรอบแต่ง สามีภรรยา',
    charCount: 2,
  },
  'กลางๆ (ไม่มีหมวดชี้ชัด)': {
    emotion: 'ประทับใจ',
    text: 'เรื่องราวน่าประทับใจของคนธรรมดาที่คนไทยชื่นชม',
    charCount: 1,
  },
};

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

async function measureOne(signals, margin) {
  const seen = new Map(); // ref.id -> count
  for (let i = 0; i < N_RUNS; i++) {
    // ★ จำลอง "งานใหม่" ของเคสเดิมทุกครั้ง (seedKey ผูก job.id ใหม่ตามดีไซน์แบตช์นี้) — seedKey ต่างกันทุกรอบ
    const seedKey = `sim-case-fixed:sim-job-${i}`;
    const origEnv = process.env.MEGA_REF_VARIETY_MARGIN;
    process.env.MEGA_REF_VARIETY_MARGIN = String(margin);
    let result;
    try {
      result = await pickBestRef(signals, { seedKey });
    } finally {
      if (origEnv === undefined) delete process.env.MEGA_REF_VARIETY_MARGIN;
      else process.env.MEGA_REF_VARIETY_MARGIN = origEnv;
    }
    const id = result?.ref?.id || result?.ref?.styleName || '(none)';
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  return seen;
}

async function main() {
  // ★ ปิดเสียง console.warn ระหว่างวัด (refTemplate.js geo-clamp warning ยิงซ้ำหลายพันครั้งจากการ recompute
  //   grade ทุกใบทุกรอบใน refFidelityBonus — ไม่ใช่ error จริง แค่ทำรายงานอ่านยาก) — คืนค่าเดิมก่อนจบสคริปต์เสมอ
  const _origWarn = console.warn;
  console.warn = () => {};
  const pool = await listRefCovers(500);
  console.log(`📚 คลัง ref จริง: ${pool.length} ใบ (data/ref-cover-library.json ผ่าน listRefCovers จริง — ไม่ใช้ข้อมูลสังเคราะห์)\n`);

  for (const [setName, signals] of Object.entries(SIGNAL_SETS)) {
    console.log(`\n=== ชุด signals: "${setName}" (emotion="${signals.emotion}" text="${signals.text}") ===`);
    for (const margin of MARGINS) {
      const dist = await measureOne(signals, margin);
      const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
      const uniqueCount = dist.size;
      console.log(`  MARGIN=${margin}: ref ไม่ซ้ำ ${uniqueCount} ใบ จาก ${N_RUNS} รอบ`);
      for (const [id, count] of sorted) {
        const pct = ((count / N_RUNS) * 100).toFixed(1);
        console.log(`    ${pad(id, 24)} ${pad(count, 4)} รอบ (${pct}%)`);
      }
    }
  }
  console.warn = _origWarn;
  console.log('\n✅ วัดเสร็จ — ไม่ได้แก้ default MEGA_REF_VARIETY_MARGIN ใดๆ ในระบบจริง (แค่รายงานตัวเลข)');
}

main().catch((e) => { console.error('❌ วัดล้ม:', e?.stack || e); process.exit(1); });
