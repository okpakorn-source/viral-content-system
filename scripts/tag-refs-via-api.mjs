#!/usr/bin/env node
// ============================================================
// 🏷️ tag-refs-via-api.mjs (29 ก.ค. 69) — ติดป้ายหมวด (คัมภีร์ v3, 11 หมวด "สูตรรายหมวด") ให้ ref เพจจริง 20 ใบ
// ------------------------------------------------------------
// ★★★ เหตุผลที่ต้องยิงผ่าน API (ไม่แก้ data/ref-cover-library.json ตรงๆ): ไฟล์ local ใน working tree โดน
//   Supabase sync ทับได้ทุกเมื่อที่ getAll() เจอ Supabase มีข้อมูล (บั๊กเก่าที่รู้กัน — เคยเจอเหลือ 3 ใบ) การแก้ไฟล์
//   ตรงๆ จึงไม่ถาวร ต้องยิงผ่าน PATCH /api/ref-covers (ผ่าน updateRefCover → sync ถูกทางทั้ง Supabase+local cache)
// 🔴 ห้ามใช้ {reanalyze:true} กับ ref พวกนี้เด็ดขาด — ล้าง matchNewsType/template ที่ตั้งไว้ทั้งหมด (ดูคอมเมนต์
//   หัว PATCH ใน src/app/api/ref-covers/route.js) — สคริปต์นี้ยิงแค่ {id, matchNewsType} เท่านั้น ปลอดภัย
//
// การใช้งาน:
//   node scripts/tag-refs-via-api.mjs                    # ยิงจริงทั้ง 20 ใบ ผ่าน http://localhost:3000
//   node scripts/tag-refs-via-api.mjs --base=http://localhost:3900   # เปลี่ยน origin (เช่นเครื่อง :3900 งานหนัก)
//   node scripts/tag-refs-via-api.mjs --dry-run          # ไม่ยิงจริง แค่พิมพ์ว่าจะส่งอะไรไปบ้าง
//
// หลังยิงแต่ละใบ: ตรวจกลับด้วย GET /api/ref-covers ทันที — ยืนยัน (ก) dna.matchNewsType[0] = ป้ายใหม่ตัวแรก
//   ตามตาราง (ข) dna.template?.slots ยังเป็น array ไม่ว่าง (ไม่ถูกทับหาย) — พิมพ์สรุป ✅/❌ ต่อใบ + สรุปรวมท้ายสุด
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const baseArg = args.find((a) => a.startsWith('--base='));
const BASE_URL = (baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000').replace(/\/$/, '');

// ★ ตารางเดียวกับที่รายงานไว้ (มอบหมาย 29 ก.ค. 69) — ป้ายใหม่ขึ้นก่อนเสมอ (endpoint merge เข้า dna.matchNewsType
//   เดิม + dedupe + เพดาน 12 ป้าย/40 ตัวอักษรต่อป้ายเอง ไม่ต้องกังวลเรื่องนี้ในสคริปต์)
const CATEGORY_MAP = {
  'REF-ms38g20z-6gij': ['พลิกชีวิต'],
  'REF-ms38ffkz-koim': ['พลิกชีวิต'],
  'REF-ms38e1tr-cfkw': ['สู้ชีวิต'],
  'REF-ms38dg8a-nbor': ['กตัญญู'],
  'REF-ms38csns-lbgz': ['อาลัย'],
  'REF-ms38c2x8-o2o6': ['สู้ชีวิต'],
  'REF-ms38bfq2-5k7n': ['พลิกชีวิต'],
  'REF-ms38auuy-2kgy': ['ความรักครอบครัว'],
  'REF-ms38a66e-75s7': ['ความรักคู่'],
  'REF-ms389jqn-mzxi': ['อาลัย'],
  'REF-ms388tb2-fkqx': ['น้ำใจคนธรรมดา'],
  'REF-ms38840u-0pf2': ['พลิกชีวิต'],
  'REF-ms387ch0-fmu3': ['ความยุติธรรม'],
  'REF-ms386vax-g6vc': ['อาลัย'],
  'REF-ms386aij-qtkg': ['ความรักคู่'],
  'REF-ms385ooj-zvyx': ['ความยุติธรรม'],
  'REF-ms3852dc-egyh': ['อาลัย'],
  'REF-ms384g0y-9inn': ['อาลัย'],
  'REF-ms383qmx-li4g': ['กตัญญู', 'สู้ชีวิต'],
  'REF-ms3829pc-d227': ['สู้ชีวิต'],
};

async function patchRef(id, tags) {
  const res = await fetch(`${BASE_URL}/api/ref-covers`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, matchNewsType: tags }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* ปล่อย body=null ถ้า parse ไม่ได้ */ }
  return { ok: res.ok, status: res.status, body };
}

async function getAllRefs() {
  const res = await fetch(`${BASE_URL}/api/ref-covers`);
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.items) ? body.items : [];
}

async function main() {
  console.log(`🏷️  tag-refs-via-api — ${DRY_RUN ? 'DRY-RUN (ไม่ยิงจริง)' : 'LIVE'} — base=${BASE_URL}`);
  const ids = Object.keys(CATEGORY_MAP);
  console.log(`จะติดป้าย ${ids.length} ใบ ตามตาราง\n`);

  if (DRY_RUN) {
    for (const id of ids) {
      console.log(`  [dry-run] PATCH ${BASE_URL}/api/ref-covers  { id: '${id}', matchNewsType: ${JSON.stringify(CATEGORY_MAP[id])} }`);
    }
    console.log('\n(dry-run เสร็จ — ไม่ได้ยิงจริง ไม่ได้ตรวจกลับ)');
    return;
  }

  let okCount = 0, failCount = 0;
  const failedIds = [];

  for (const id of ids) {
    const tags = CATEGORY_MAP[id];
    process.stdout.write(`  PATCH ${id} → ${JSON.stringify(tags)} ... `);
    const { ok, status, body } = await patchRef(id, tags);
    if (!ok || !body?.success) {
      console.log(`❌ ล้ม (status=${status}, error=${body?.error || 'unknown'})`);
      failCount++;
      failedIds.push(id);
      continue;
    }
    console.log('ส่งสำเร็จ');
  }

  console.log('\n🔎 ตรวจกลับ (GET) — ยืนยัน matchNewsType[0] ตรงป้ายใหม่ + template/slots ยังครบ...\n');
  const allRefs = await getAllRefs();
  const byId = new Map(allRefs.map((r) => [r.id, r]));

  for (const id of ids) {
    const expectedFirst = CATEGORY_MAP[id][0];
    const rec = byId.get(id);
    if (!rec) {
      console.log(`  ❌ ${id}: หาไม่เจอใน GET (คลังอาจโดน sync ทับระหว่างทาง — ตรวจ Supabase/local ด้วยตา)`);
      failCount++;
      failedIds.push(id);
      continue;
    }
    const actualFirst = rec.dna?.matchNewsType?.[0];
    const slotsOk = Array.isArray(rec.dna?.template?.slots) && rec.dna.template.slots.length > 0;
    const tagOk = actualFirst === expectedFirst;
    if (tagOk && slotsOk) {
      console.log(`  ✅ ${id}: matchNewsType[0]="${actualFirst}" · template.slots=${rec.dna.template.slots.length} ช่อง`);
      okCount++;
    } else {
      console.log(`  ❌ ${id}: ${!tagOk ? `matchNewsType[0]="${actualFirst}" (คาดหวัง "${expectedFirst}")` : ''} ${!slotsOk ? 'template.slots หายไป/ว่างเปล่า!' : ''}`.trim());
      failCount++;
      failedIds.push(id);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`สรุป: ผ่าน ${okCount}/${ids.length} ใบ${failCount ? ` — ล้ม ${failCount} ใบ: ${failedIds.join(', ')}` : ''}`);
  if (failCount) process.exitCode = 1;
}

main().catch((e) => {
  console.error('❌ สคริปต์ล้มเหลวไม่คาดคิด:', e.message);
  process.exitCode = 1;
});
