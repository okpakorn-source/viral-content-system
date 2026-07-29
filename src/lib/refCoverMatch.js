// ============================================================
// 🎯 Ref Cover Match — เลือกปก reference จากคลังที่ "แนวตรงข่าว" ที่สุด
// ------------------------------------------------------------
// ให้คะแนนแต่ละปกในคลังจาก DNA (matchNewsType + emotion + จำนวนช่อง) เทียบสัญญาณข่าว
// คลังว่าง → null · ไม่มีแนวตรง → คืนปกล่าสุดเป็น generic
// ============================================================

import { listRefCovers } from '@/lib/refCoverLibrary';
import { refPoolGateOpen, computeTemplateGrade } from '@/lib/refCoverGrade';

const norm = (s) => String(s || '').toLowerCase().trim();

// ★ 29 ก.ค. 69 (เจ้าของถาม "ทำไม ref template ไม่เคยเปลี่ยน" — สืบพบ 2 ชั้น: (1) ref เพจจริง 20 ใบ ติดป้าย
//   matchNewsType เป็น tag ทั่วไป (human-interest/ครอบครัว-ดราม่า/กตัญญู/สูญเสีย ฯลฯ) ไม่ใช่คำใน "11 หมวด" ของ
//   คัมภีร์ v3 (coverPagePlaybook.js 【ช. สูตรรายหมวด】) เลย → substring match กับ signals.text (angle+
//   secondaryEmotions) แทบไม่ตรงเป๊ะ (2) signals ที่ส่งเข้า pickBestRef ตอน compose (megaAdapters.js) ไม่เคยมี
//   "หมวดเคส" เลยด้วยซ้ำ — มีแต่ compass.angle/secondaryEmotions ซึ่งเป็นประโยคเล่าเรื่อง ไม่ใช่คำหมวดตรงๆ):
//   สะพานคำศัพท์ "หมวดเคสข่าว (DESK_CATEGORIES, deskBrain.js)" → "หมวด ref/คัมภีร์ v3" (สูตรรายหมวด) — สอง
//   vocabulary คนละชุดกันไม่ตรง 1:1 จับคู่ได้เฉพาะที่ความหมายตรงจริง เหลือ→ปล่อยว่าง (signals.text เดิมจาก
//   angle/emotion ยังทำงานคู่ขนานต่อไป ไม่ตัดทางเดิม) · ★ ไม่ import DESK_CATEGORIES ตรงๆ จาก deskBrain.js
//   (กัน circular import ข้ามโดเมน desk↔cover — เกิน scope) คีย์เป็น literal string เดียวกันเป๊ะ พังไม่ crash
//   แค่ mapping จะไม่ตรงถ้าแหล่งเปลี่ยนชื่อหมวด (fail-safe เดียวกับแพทเทิร์นทั่วทั้งไฟล์นี้)
export const DESK_TO_REF_CATEGORY = {
  'น้ำใจ/ช่วยเหลือ': 'น้ำใจคนธรรมดา',
  'กตัญญู/ครอบครัวอบอุ่น': 'กตัญญู',
  'สู้ชีวิต': 'สู้ชีวิต',
  'คนดังทำดี/ติดดิน': 'น้ำใจคนดัง',
  'ความรัก/แต่งงาน': 'ความรักคู่',
  'ดราม่าสังคม': 'ความยุติธรรม',
  'อาชญากรรม/คดีดัง': 'ความยุติธรรม',
};

/** แปล "หมวดเคสข่าว" (เช่น job.dossier.desk.category) → "หมวด ref คัมภีร์ v3" — ไม่ตรง/ไม่มี = '' (ไม่เติม) */
export function refCategoryHint(deskCategory) {
  return DESK_TO_REF_CATEGORY[String(deskCategory || '').trim()] || '';
}

// ★ 29 ก.ค. 69 (แบตช์ 2 — พิสูจน์จริง: "compose เส้นทางลัด" ยังได้ ref ใบเดิมซ้ำ เพราะไม่มีสัญญาณหมวดเลย):
//   job.dossier.desk.category มีแค่เส้นโต๊ะข่าว (deskBrain.js S1 เท่านั้น) — เส้น quick (src/app/api/mega/
//   compose-test/route.js สร้าง `desk:{title: compass.angle}` เปล่าๆ ไม่มี category เลย) → refCategoryHint()
//   ได้ '' เสมอ → signals.text ไม่เคยมีคำหมวดจริงส่งเข้า pickBestRef เลย ตกไปแมตช์แค่อารมณ์/role generic
//   (นี่คือสาเหตุลึกอีกชั้นที่ ref ไม่หมุนบนเส้นนี้ นอกเหนือจาก ref 20 ใบไม่มี tag ที่แก้ไปแล้วก่อนหน้า)
// แก้: อนุมานหมวดจาก "เนื้อความล้วนที่มีอยู่แล้วในมือ" (หัวข้อเคส+compass.angle+อารมณ์รอง) ด้วยกลไกคำนวณ
//   ล้วน (ตาราง keyword → เทียบ substring) — ห้ามเพิ่ม LLM call เด็ดขาด (ข้อมูลมีอยู่แล้ว ไม่ต้องถามซ้ำ)
//   ความมั่นใจต่ำกว่า desk.category เสมอ (เดามาจากคำ ไม่ใช่บก.ตัดสินจริง) → ใช้เป็น "fallback เมื่อไม่มี
//   สัญญาณอื่นเลย" เท่านั้น จุดเสียบ (megaAdapters.js) ต้องเรียก refCategoryHint ก่อนเสมอ desk มี category
//   จริง = ชนะเสมอ ไม่แตะ — inferRefCategory ทำงานเฉพาะตอน refCategoryHint คืน '' เท่านั้น
// คีย์เวิร์ดคัดจากคัมภีร์ v3 (11 หมวด — coverPagePlaybook.js 【ช. สูตรรายหมวด】) + สอบเทียบกับ heroDesc/
//   storyShape จริงของโพสต์ไวรัล 478 โพสต์ (_research-igdara-15k/analysis/all-478.json) — เลือกเฉพาะคำที่
//   ชี้ชัดหมวดเดียว หลีกเลี่ยงคำกว้างที่ชนหลายหมวด (เช่น "ช่วยเหลือ" เดี่ยวๆ ไม่ผูกกับหมวดไหนเป็นพิเศษ)
// รูปแบบ term: ปกติ = substring เดี่ยว (พบ = +1) · มี '+' คั่น = compound ("a+b") ต้องพบ "ทุกส่วน" (ที่ไหน
//   ก็ได้ในข้อความ ไม่ต้องติดกัน) จึงนับ +1 — ใช้กับหมวดที่ต้องมีทั้ง "ตัวละคร" (ดารา/เด็ก) คู่กับ "การกระทำ"
//   (มอบ/ทำดี) ถึงจะชี้หมวดได้จริง (กันคำเดี่ยวกว้างเกินไปชนหมวดอื่น)
export const REF_CATEGORY_KEYWORDS = {
  'อาลัย': ['เสียชีวิต', 'จากไป', 'สิ้นใจ', 'ไว้อาลัย', 'งานศพ', 'ฌาปนกิจ', 'สวรรคต', 'ถึงแก่กรรม'],
  'กตัญญู': ['กตัญญู', 'ตอบแทนบุญคุณ', 'เลี้ยงดูพ่อแม่', 'ซื้อบ้านให้แม่', 'ซื้อบ้านให้พ่อ', 'ตอบแทนพระคุณ', 'ปลดหนี้ให้แม่'],
  'ความรักคู่': ['แต่งงาน', 'ขอแต่งงาน', 'คู่รัก', 'ครบรอบแต่ง', 'สามีภรรยา', 'จดทะเบียนสมรส'],
  'สู้ชีวิต': ['สู้ชีวิต', 'หาเช้ากินค่ำ', 'เก็บขวด', 'ไรเดอร์', 'แบกของ', 'หาเลี้ยงครอบครัว', 'ขายของหาเลี้ยงชีพ'],
  'พลิกชีวิต': ['อดีตนักร้อง', 'อดีตพระเอก', 'อดีตดารา', 'อดีตนางเอก', 'ผันตัว', 'วันนี้กลายเป็น', 'จากคนดังสู่', 'พลิกชีวิต'],
  'น้ำใจคนดัง': [
    'ยื่นมือช่วย',
    'ดารา+มอบ', 'ดารา+ช่วยเหลือ', 'ดารา+บริจาค',
    'นักร้อง+มอบ', 'นักร้อง+ช่วยเหลือ', 'นักร้อง+บริจาค',
    'นักแสดง+มอบ', 'นักแสดง+ช่วยเหลือ', 'นักแสดง+บริจาค',
    'ศิลปิน+มอบ', 'ศิลปิน+ช่วยเหลือ', 'ศิลปิน+บริจาค',
    'คนดัง+มอบ', 'คนดัง+ช่วยเหลือ', 'คนดัง+บริจาค',
  ],
  'เด็กดี': [
    'เด็กดี',
    'เด็ก+ทำดี', 'นักเรียน+ทำดี',
    'เด็ก+เก็บเงินคืน', 'นักเรียน+เก็บเงินคืน',
    'เด็ก+ช่วยเหลือ', 'นักเรียน+ช่วยเหลือ',
  ],
  'สัตว์': ['สุนัข', 'แมว', 'หมา', 'สัตว์'],
  'ความยุติธรรม': ['แจ้งความ', 'คดี', 'ทนาย', 'เรียกร้องความเป็นธรรม', 'ผู้ต้องหา', 'ฟ้องร้อง'],
  'ความรักครอบครัว': ['พ่อลูก', 'แม่ลูก', 'ครอบครัว+รัก', 'ครอบครัว+อบอุ่น'],
  'น้ำใจคนธรรมดา': [
    'คนธรรมดา', 'จิตอาสา', 'ผู้ใจบุญ',
    'ชาวบ้าน+ช่วยเหลือ', 'คนแปลกหน้า+ช่วยเหลือ',
    'ผู้โดยสาร+ช่วยเหลือ', 'คนขับ+ช่วยเหลือ',
  ],
};

/**
 * อนุมานหมวด ref (11 หมวดคัมภีร์ v3) จากข้อความล้วน — กลไกคำนวณ 100% ไม่มี LLM เรียกเพิ่ม (ดูคอมเมนต์ยาวด้านบน)
 * ให้คะแนนแต่ละหมวดจากจำนวนคีย์เวิร์ดที่เจอใน REF_CATEGORY_KEYWORDS แล้วเลือกหมวดคะแนนสูงสุด (ต้อง ≥1)
 * เสมอกันหลายหมวด หรือไม่เจอเลย = '' (ห้ามเดา — ปลอดภัยไว้ก่อนดีกว่าทายหมวดผิด)
 * @param {string} text - หัวข้อเคส+angle+เนื้อย่อที่มีในมือ (ผู้เรียกต่อกันมาให้แล้ว) — ฟังก์ชันนี้ PURE ไม่โหลด/ไม่ยิง network เอง
 * @returns {string} ชื่อหมวด (ตรงคีย์ REF_CATEGORY_KEYWORDS) หรือ '' ถ้าไม่ชัด
 */
export function inferRefCategory(text) {
  const hay = norm(text);
  if (!hay) return '';
  let best = '';
  let bestScore = 0;
  let tie = false;
  for (const [category, terms] of Object.entries(REF_CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const term of terms) {
      if (term.includes('+')) {
        const parts = term.split('+').filter(Boolean);
        if (parts.length && parts.every((p) => hay.includes(norm(p)))) score++;
      } else if (hay.includes(norm(term))) {
        score++;
      }
    }
    if (score > bestScore) { best = category; bestScore = score; tie = false; }
    else if (score > 0 && score === bestScore) { tie = true; }
  }
  if (bestScore <= 0 || tie) return '';
  return best;
}

// ★ 19 ก.ค. (เคสเป็กกี้ REF-mrraukej-6ky5 grade C ถูกเลือก → ปกวงกลมล้น/hero ยืด — pickBestRef เดิม
//   ไม่ถ่วงน้ำหนัก fidelity/geometry เลย): โบนัสคะแนนตาม "grade" ปัจจุบันของ ref (recompute ผ่าน
//   computeTemplateGrade รวม R6 human-verified floor เสมอ — ไม่ใช้เกรดค้างที่ persist ไว้)
//   A→+2 · B→+1 · C→+0 · F→-3 (กันเลือกใบพัง) · ไม่มี grade (คำนวณไม่ได้) → fallback _fidelity.score/100*2
//   ตั้งใจให้ "น้อยกว่า" matchNewsType (+3 เสมอ) — แนวข่าวตรงยังชนะก่อนเสมอ ใบ fidelity สูงชนะแค่ใน
//   กลุ่มคะแนนใกล้กัน (MARGIN) เท่านั้น. PURE ยกเว้นอ่าน env ตัวเดียวเพื่อ kill-switch (แพทเทิร์นเดียวกับ
//   refPoolGateOpen/computeTemplateGrade — รับ env พารามิเตอร์ที่ 2 ให้เทสส่ง env สังเคราะห์แทนได้)
//   kill-switch: MEGA_REF_FIDELITY_PREF==='0' → คืน 0 เสมอ (ปิดเทอมนี้ทั้งหมด = byte-parity เดิม)
export function refFidelityBonus(record, env = process.env) {
  if (env?.MEGA_REF_FIDELITY_PREF === '0') return 0;
  let grade = null;
  try {
    grade = computeTemplateGrade(record, env)?.grade || null;
  } catch {
    grade = null;
  }
  if (grade === 'A') return 2;
  if (grade === 'B') return 1;
  if (grade === 'C') return 0;
  if (grade === 'F') return -3;
  const fs = Number(record?.dna?._fidelity?.score);
  if (Number.isFinite(fs)) return (fs / 100) * 2;
  return 0;
}

// ★ 10 ก.ค. Wave1-A: FNV-1a 32-bit hash นิ่ง (string เดิม → เลขเดิมเสมอ) — ใช้แทน Math.random() ตอน tiebreak
//   ให้เคส seedKey เดิม re-run กี่รอบก็ได้ ref ใบเดิม (deterministic) ไม่ใช่สุ่มจริงทุกครั้ง
function _fnv1aHash(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0; // uint32
}

// ★ 29 ก.ค. 69 (แบตช์ variety — เจ้าของสั่ง "เทมเพลตออกแบบซ้ำเกินไป"; Opus ตรวจรอบ 2 FAIL แล้วแก้):
//   seedKey เดิม (caseId/หัวข่าวล้วน) → เคสเดิมได้ ref เดิมตลอดกาล ไม่ว่าสร้างงานใหม่กี่ครั้ง (กดปุ่ม 🎲
//   ประกอบใหม่ก็ยังใบเดิม) — ต้องผูก "ตัวบ่งชี้งาน" (varietySeed เช่น job.id) เข้า seedKey ด้วย: งานใหม่
//   (varietySeed ต่าง) = seedKey ใหม่ → มีโอกาสได้ ref อื่นในวง near-tie · retry ของ "งานเดียวกัน" (varietySeed
//   เดิม) = seedKey เดิม → ผลซ้ำเดิมตามดีไซน์เดิม (ห้ามพัง — งานหนึ่งเรียกซ้ำ 6 รอบต้องได้ ref เดิมเสมอ)
// ★ Opus รอบ 2 (จุดหักล้าง): เดิมแต่ละจุดเสียบ (compose-test route / megaAdapters S6 / S7) copy สูตร
//   `varietySeed ? \`${identity}:${varietySeed}\` : identity` ไว้เอง 3 ที่ — เส้นเต็มท่อ (refTestPipeline.js,
//   /api/cover-ref-test) synthesize job.id ใหม่ทุก HTTP request (`REFTEST-${Date.now()...}`) ไม่ใช่ id ที่นิ่ง
//   ตลอด retry แบบ quick-test job.id จริง → ผูกเข้า seedKey ตรงๆ ทำให้ retry รอบ 2-6 ของงานเดียวกัน (เส้น ref)
//   ได้ ref คนละใบ (พิสูจน์จริง: ก่อนแก้ 6 attempt=ใบเดียว, บั๊ก=2ใบสลับ) — แก้โดยแยก "id เฉพาะกิจของ pipeline
//   run นี้" ออกจาก "ตัวบ่งชี้งานที่นิ่งตลอด retry" เด็ดขาด: ต้นทางจริง (quick-test) ส่ง job.id ของตัวเอง
//   ลงมาผ่าน body.varietySeed → refTestPipeline.js เก็บเป็น job.varietySeed แยกจาก job.id (ephemeral) →
//   ผู้เรียก (megaAdapters.js) ต้องใช้ `job.varietySeed || job.id` เสมอ (varietySeed ถ้ามี ชนะ id เฉพาะกิจ)
//   ไม่ส่ง varietySeed มา (เช่น ผู้ใช้กดหน้า /cover-ref-test ตรงๆ ไม่ผ่าน quick-test) = fallback job.id เดิม
//   (พฤติกรรมเดิมของเส้นนั้น — เรียกครั้งเดียวไม่มี retry loop อยู่แล้วในกรณีนี้ ไม่ต่างจากเดิม)
// รวมสูตรกลางไว้ที่นี่ที่เดียว (ผู้เรียกทั้ง 3 จุดต้องเรียกฟังก์ชันนี้จริง ห้าม copy สูตรแยก — กันบั๊กแบบ
//   Opus รอบ 2 ที่จุดเสียบแยกกันดริฟท์จากกันได้) + kill-switch MEGA_REF_VARIETY_SEED==='0' → ไม่ผูก varietySeed
//   เลย (คืน caseIdentity ดิบล้วน) default (ไม่ตั้ง/ค่าอื่น) = เปิด ตามแบบแผนสวิตช์อื่นในไฟล์นี้
//   (MEGA_REF_SEEDED/MEGA_REF_CAT_QUICK/MEGA_REF_TAG_EXACT)
// ★ Opus รอบ 3 (ตรวจจุดหลุด 2 ข้อ — คอมเมนต์เดิมตรงนี้เขียนเท็จ แก้ให้ตรงจริงแล้ว):
//   (1) "คืน caseIdentity ล้วน = พฤติกรรมเดิมทุก byte ทั้ง S6/S7/compose-test" — ไม่จริงสำหรับ S7: HEAD เดิม
//       ของ S7 ไม่เคยส่ง opts.seedKey เข้า pickBestRef เลย (ตกไปใช้ signals.newsTitle → JSON.stringify(signals)
//       แทน) ไม่ใช่ title-based seedKey แบบนี้ — ฟังก์ชันนี้ "คืน caseIdentity ล้วน" ได้แค่กรณีที่ผู้เรียกยัง
//       ตัดสินใจส่ง opts.seedKey มาอยู่ดี (เช่น S6/compose-test ที่ HEAD เดิมมี seedKey title-based อยู่แล้ว)
//       — ส่วน S7 ต้อง "ไม่ส่ง opts.seedKey เลย" ตอนไม่มี varietySeed จริง/สวิตช์ปิด (เงื่อนไข spread ที่ตัว
//       เรียก ไม่ใช่หน้าที่ของฟังก์ชันนี้ — ดู megaAdapters.js S7 ที่ห่อ opts แบบมีเงื่อนไข)
//   (2) caseIdentity ต้อง "ไม่ trim" — Opus โพรบพบเคสหลุด: ถ้า trim ตรงนี้ แต่ต้นทาง (เช่น S6's
//       job.dossier.desk?.title) ส่งค่าดิบที่มีช่องว่างหัว/ท้ายมา ผลลัพธ์ตอนไม่มี seed (คืน caseIdentity ล้วน)
//       จะไม่ตรงกับพฤติกรรมเดิม (ที่ใช้ title ดิบไม่ผ่าน trim ใดๆ เป็น seedKey ตรงๆ) → seedKey ต่างกัน →
//       hash ต่างกัน → เลือกคนละใบ ทั้งที่ควรได้ผลเดิมเป๊ะ (trim เฉพาะ varietySeed พอ เพราะเป็นค่าที่สร้างขึ้น
//       ใหม่โดยฟีเจอร์นี้เอง ไม่ใช่ค่าที่มาจาก byte-parity เดิม)
/**
 * @param {string} caseIdentity - ตัวบ่งชี้เคส (title/caseId เดิม) — ส่งเข้ามาเป็นค่าดิบเป๊ะ (ห้าม trim ในนี้ —
 *   ต้องเท่ากับค่าที่ผู้เรียกเคยใช้เป็น seedKey ตรงๆ ก่อนมีฟีเจอร์นี้ ไม่งั้น byte-parity หลุดตอนไม่มี seed)
 * @param {string} varietySeed - ตัวบ่งชี้ "งานนี้" (เช่น job.id ถาวรจริงของ quick-test) — นิ่งตลอด retry ของ
 *   งานเดียวกัน เปลี่ยนเฉพาะตอนสร้างงานใหม่จริงๆ — ห้ามใช้ id ที่ synthesize ใหม่ทุก HTTP request (ดู
 *   isEphemeralPipelineId ด้านล่าง — ผู้เรียกต้องกรองก่อนส่งเข้ามาที่นี่)
 * @param {object} env - process.env (รับพารามิเตอร์ให้เทสฉีด env สังเคราะห์แทนได้ แบบเดียวกับ refFidelityBonus)
 * @returns {string} seedKey สำหรับส่งเข้า pickBestRef({}, { seedKey }) — ถ้าไม่มี seed จริง/สวิตช์ปิด คืน
 *   caseIdentity ดิบเป๊ะ (ผู้เรียกที่ HEAD เดิมไม่เคยส่ง opts.seedKey เลย เช่น S7 ต้องเช็คเองว่าจะเรียกฟังก์ชัน
 *   นี้หรือไม่ส่ง opts เลย — ฟังก์ชันนี้ไม่รู้ context ของผู้เรียกแต่ละจุด)
 */
// ★ Opus รอบ 3: แยก kill-switch ออกมาเป็นฟังก์ชันเดี่ยว export ให้ผู้เรียกที่ต้อง "ไม่ส่ง opts.seedKey เลย"
//   (เช่น S7 — ดู megaAdapters.js) เช็คก่อนตัดสินใจ spread opts ได้ โดยไม่ต้อง copy เงื่อนไข env ซ้ำเอง
export function isVarietySeedEnabled(env = process.env) {
  return env?.MEGA_REF_VARIETY_SEED !== '0';
}

export function buildVarietySeedKey(caseIdentity, varietySeed, env = process.env) {
  const identity = caseIdentity == null ? '' : String(caseIdentity); // ★ ห้าม trim (ดูคอมเมนต์ Opus รอบ 3 ด้านบน)
  const seed = String(varietySeed || '').trim();
  if (!isVarietySeedEnabled(env) || !seed) return identity;
  return `${identity}:${seed}`;
}

// ★ 29 ก.ค. 69 (แบตช์ variety รอบ 3 — Opus ตรวจ): job.id บางเส้น (refTestPipeline.js /api/cover-ref-test)
//   เป็นแค่ trace id ชั่วคราวของ "1 HTTP request นี้" (synthesize ใหม่ทุกครั้ง — ขึ้นต้น 'REFTEST-') ไม่ใช่
//   ตัวบ่งชี้งานถาวร — ใช้เป็น variety seed ไม่ได้เด็ดขาด (ทำให้ retry รอบ 2-6 ของงานเดียวกันได้ ref คนละใบ)
//   ตัวบ่งชี้งานถาวรจริง (เช่น MG-#### จาก megaJobStore.js คิวข่าวจริง, qtj_... จาก quickTestJobs.js) นิ่ง
//   ตลอดอายุงาน ใช้ได้ปกติ — เช็คแบบ blocklist (กันเฉพาะ prefix ที่รู้ว่าเป็นปัญหา) แทน allowlist เพราะ
//   รูปแบบ id ถาวรมีได้หลายแบบ (MG-####/qtj_.../ฯลฯ) ไม่อยากผูกติดรูปแบบเดียว
export function isEphemeralPipelineId(id) {
  return /^REFTEST-/.test(String(id || ''));
}

/**
 * @param {object} signals - { emotion, text, charCount }
 *   emotion: อารมณ์หลักข่าว · text: มุมเล่า+อารมณ์รอง+หมวด (ไว้จับคำ) · charCount: จำนวนตัวละครหลัก
 * @param {object} opts - { seedKey } — คีย์นิ่งต่อเคส (เช่น caseId/job.id) ให้ tiebreak ได้ผลเดิมทุกรอบ retry
 *   ไม่ส่ง → fallback signals.newsTitle → JSON.stringify(signals) (ยังนิ่งกว่า Math.random() เดิม)
 *   (ประกอบ seedKey ด้วย buildVarietySeedKey ด้านบน — ห้าม copy สูตรเอง)
 * @returns {Promise<{ref, score, reason}|null>}
 */
export async function pickBestRef(signals = {}, opts = {}) {
  const items = await listRefCovers(500);
  // ★ 9 ก.ค. (ผู้ใช้เคาะ "ใช้เฉพาะ ref ที่ทำตามได้จริง 100%"): ตัด ref ที่เครื่องวัดตะเข็บชี้ว่า
  //   ขอบภาพถูกกลืน/ตกแต่งจนวางช่องตามไม่ได้ (_reproducible=false จาก _ref_apply_reproducible.mjs)
  // ★ R3 (16 ก.ค.): ตัวกรองพูลย้ายไป refPoolGateOpen (PURE) — OFF = พฤติกรรมเดิมเป๊ะ
  //   (dna+imagePath+_reproducible!==false) · REF_TEMPLATE_GRADE_GATE='1' = รับเฉพาะเกรด A/B ไม่ซ้ำ
  const pool = items.filter((x) => refPoolGateOpen(x));
  if (!pool.length) return null;

  const emo = norm(signals.emotion);
  const hay = norm(`${signals.emotion || ''} ${signals.text || ''}`);
  // ★ 29 ก.ค. 69 (Opus ตรวจแบตช์ ref-category-rotation รอบ 2 — FAIL): matchNewsType เดิมให้ +3 เท่ากันหมดไม่ว่า
  //   ตรงทั้งป้ายหรือแค่บางส่วน (substring/fragment) — ป้ายรวม/กว้าง (เช่น "น้ำใจ") ยุบรวมแมตช์กับเคสที่ควรตรง
  //   ป้ายเจาะจงกว่า (เช่น "น้ำใจคนดัง") เพราะเป็น substring ของกันและกัน · เช่นเดียวกัน "ความรักคู่" กับ
  //   "ความรักครอบครัว" ชนกันได้ผ่าน tag ทั่วไปอื่น (เช่น "ความรัก") ที่ ref บางใบพกมาด้วย — แก้: แยก 2 ระดับ
  //   "เป๊ะ" (ป้ายทั้งก้อน = "คำ/วลี" ที่แยกด้วยช่องว่างได้ใน hay พอดี — เคสของจริงคือ category hint จาก
  //   refCategoryHint() ที่ต่อเข้า signals.text เป็นชิ้นแยกด้วยช่องว่างเสมอ) = +3 ต่างจาก "แค่ substring ฝังอยู่ใน
  //   ประโยคยาว" (สัญญาณอ่อนกว่า ไม่น่าเชื่อเท่า) = +1 · ใต้ env ใหม่ MEGA_REF_TAG_EXACT default ON —
  //   ==='0' → พฤติกรรมเดิมทุก byte (+3 เท่ากันทั้งสองกรณี ไม่แยกระดับ)
  const _tagExactOn = process.env.MEGA_REF_TAG_EXACT !== '0';
  const hayTokens = hay.split(/\s+/).filter(Boolean);
  const cc = Number(signals.charCount) || 0;
  // ★ ช็อตที่ "ข่าวต้องมี" (จากเนื้อเต็ม → compass visualDreamShots) = หัวใจการเลือกแบบ content-driven
  const dreamRoles = (signals.dreamShots || []).map(norm).filter(Boolean);

  const scored = [];
  let bestScore = -1;
  for (const it of pool) {
    const d = it.dna || {};
    let score = 0;
    let typeHit = false;
    const hits = [];
    // ① แนวข่าวที่ปกนี้เหมาะ (matchNewsType) ตรงข่าว — MEGA_REF_TAG_EXACT: เป๊ะ(+3) แยกจาก substring(+1) (ดูคอมเมนต์ hayTokens ด้านบน)
    for (const t of d.matchNewsType || []) {
      const tn = norm(t);
      if (!tn) continue;
      const isSubstringHit = hay.includes(tn) || tn.split(/[\s\-/]+/).some((w) => w.length >= 3 && hay.includes(w));
      if (!isSubstringHit) continue;
      if (_tagExactOn) {
        const isExact = hayTokens.includes(tn);
        if (isExact) { score += 3; typeHit = true; hits.push(t); }
        else { score += 1; typeHit = true; hits.push(`${t}(บางส่วน)`); }
      } else {
        score += 3; typeHit = true; hits.push(t); // ปิดสวิตช์ = พฤติกรรมเดิมทุก byte (+3 ทั้งสองกรณี ไม่แยกระดับ)
      }
    }
    // ② อารมณ์ปก/matchEmotion ↔ อารมณ์ข่าว
    const refEmos = [d.emotion, ...(d.matchEmotion || [])].map(norm).filter(Boolean);
    if (emo && refEmos.some((e) => e && (e.includes(emo) || emo.includes(e)))) { score += 2; hits.push('อารมณ์ตรง'); }
    // ③ role coverage — ชื่อ role (hero/reaction/...) generic ทุก ref มีเหมือนกัน → ให้คะแนนเบาลง (แค่ตัวเสริม ไม่ใช่ตัวชี้ขาด)
    let covered = 0;
    if (dreamRoles.length) {
      const refRoles = [
        ...(d.template?.slots || []).map((s) => norm(s.role)),
        ...(d.slots || []).map((s) => norm(s.role)),
        ...(d.neededShots || []).map(norm),
      ].filter(Boolean);
      for (const dr of dreamRoles) {
        if (refRoles.some((rr) => rr && (rr.includes(dr) || dr.includes(rr)))) covered++;
      }
      if (covered) { score += covered * 0.5; hits.push(`ช่องตรงข่าว ${covered}/${dreamRoles.length}`); }
    }
    // ④ จำนวนคน ↔ จำนวนช่อง
    if (cc >= 2 && (Number(d.panelCount) || 0) >= 4) score += 0.5;
    // ⑤ 🛠 เฟส 2 (8 ก.ค.): ใบที่ "ตาคนยืนยันเทมเพลตแล้ว" เชื่อถือได้กว่า AI วัด → บวกแต้มให้ชนะ near-tie
    //   (1.5 > MARGIN 1 = ใบยืนยันชนะใบไม่ยืนยันที่คะแนนเนื้อหาเท่ากันเสมอ แต่ไม่ล้ม matchNewsType ที่ต่าง 3)
    if (d._humanVerified) score += 1.5;
    // ⑥ ★ 19 ก.ค.: fidelity/grade — ใบ geometry แม่นกว่าชนะใบคะแนนใกล้กัน (ดู refFidelityBonus ด้านบน)
    const fidBonus = refFidelityBonus(it);
    if (fidBonus) { score += fidBonus; hits.push(`fidelity ${fidBonus > 0 ? '+' : ''}${fidBonus}`); }

    scored.push({ it, score, reason: hits.join(' · '), covered, typeHit });
    if (score > bestScore) bestScore = score;
  }

  const matched = bestScore > 0;
  if (!matched) {
    return { ref: pool[0], score: 0, roleCoverage: 0, typeMatched: false, reason: 'ไม่มีแนวตรงในคลัง — ใช้ปกล่าสุดเป็นต้นแบบ' };
  }

  // ★ 8 ก.ค. (คลัง 18/21 ตระกูลเดียว + role generic ทำคะแนนเสมอกันบ่อย): เดิม argmax ตัวแรกชนะซ้ำทุกครั้ง
  //   → เก็บทุกตัวที่คะแนนอยู่ในช่วงใกล้สุด (margin) แล้วสุ่มถ่วงน้ำหนักตามคะแนน — ตรงเนื้อข่าวจริงชนะขาดเหมือนเดิม (คะแนนไม่เสมอ)
  //   ตรงแบบ generic (เสมอกันบ่อย) → หมุนเวียน ref อื่นในกลุ่มเดียวกันจริง ไม่ใช่ตัวเดิมทุกครั้ง
  // ★ 29 ก.ค. 69 (งานหมุนเวียน ref — เจ้าของถาม "ทำไม ref template ไม่เคยเปลี่ยน"): หลังติดป้ายหมวดจริงให้
  //   ref 20 ใบแล้ว หลายใบจะอยู่หมวดเดียวกัน (เช่น "อาลัย" มี 5 ใบ) — MARGIN เดิม (1) อาจแคบไปสำหรับสภาพนี้
  //   (คะแนน matchNewsType เท่ากันหมดในกลุ่มเดียวกัน แต่ fidelity/humanVerified อาจถ่างเกิน margin เดิมจนใบ
  //   เดียวชนะซ้ำในกลุ่ม) → เปิดให้ปรับได้ผ่าน MEGA_REF_VARIETY_MARGIN (float, parse ไม่ได้/ติดลบ = fallback 1
  //   ค่าเดิมเป๊ะ) ไม่ตั้ง env = พฤติกรรมเดิมทุก byte (MARGIN=1 เหมือนเดิม)
  const _marginRaw = parseFloat(process.env.MEGA_REF_VARIETY_MARGIN);
  const MARGIN = Number.isFinite(_marginRaw) && _marginRaw >= 0 ? _marginRaw : 1; // เผื่อคะแนนห่างไม่เกิน MARGIN (เช่น matchNewsType hit เดียว = 3 แต้ม ยังชนะขาดเหนือ margin default นี้)
  const candidates = scored.filter((s) => s.score >= bestScore - MARGIN && s.score > 0);
  const totalW = candidates.reduce((n, c) => n + c.score, 0);
  // ★ 10 ก.ค. Wave1-A: เดิม Math.random() → เคสเดิม re-run ได้ ref คนละใบ (สุ่มจริงทุกครั้ง)
  //   → เปลี่ยนเป็นเลขนิ่งจาก hash(seedKey) แทน (เคสเดิม→เลขเดิม→ใบเดิมเสมอ) คงเจตนาเดิม (ถ่วงน้ำหนัก กระจายใบ ไม่ใช่ argmax ตัวแรกชนะตลอด)
  //   kill switch: MEGA_REF_SEEDED=0 → ใช้ Math.random() แบบเดิมเป๊ะ
  const useSeeded = process.env.MEGA_REF_SEEDED !== '0';
  let r;
  if (useSeeded) {
    const seedKey = opts.seedKey || signals.newsTitle || JSON.stringify(signals);
    r = (_fnv1aHash(seedKey) / 0xffffffff) * totalW;
  } else {
    r = Math.random() * totalW;
  }
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) { r -= c.score; if (r <= 0) { chosen = c; break; } }

  return {
    ref: chosen.it,
    score: bestScore,
    roleCoverage: chosen.covered,
    // ★ 8 ก.ค. (CASE-360): แนวข่าว (matchNewsType) ตรงจริงไหม — typeMatched=false = แมตช์หลวม
    //   → ผู้เรียกควรใช้แค่ "โครง" ห้ามใช้ slot subject นำการเลือกภาพ
    typeMatched: chosen.typeHit,
    reason: chosen.reason + (candidates.length > 1 ? ` (สุ่ม 1/${candidates.length} จากคะแนนใกล้กัน)` : ''),
  };
}
