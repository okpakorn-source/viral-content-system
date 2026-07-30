// ============================================================
// 🧮 coverFormulaCheck.js — ตัวเช็คสูตร 478 ใบ (เฟส D-2, 29 ก.ค. 69 — advisory)
// ------------------------------------------------------------
// ที่มาสูตร: _research-igdara-15k/RESEARCH-REPORT.md (วิจัยปกเพจ "รวมไอจีดารา" 478 ใบ ≥15,000 ไลค์,
//   28 ก.ค. 69) ประกอบกับ coverPagePlaybook.js (คัมภีร์ v3 ที่ inject เข้าสมองจริงอยู่แล้ว)
//
// PURE ล้วน (แพทเทิร์นเดียวกับ slotSolver.js): ไม่มี IO/AI/Math.random/Date — input เดิม → ผลเดิมทุกครั้ง
// import เดียวที่มี = slotSolver.js (ก็ PURE + ไม่ล็อก) เพื่อ reuse hammingDistanceHex/PHASH_DUP_HAMMING_MAX
// ตัวเดียวกับที่ megaAdapters.js ใช้อยู่แล้ว (ไม่เดาค่าคาลิเบรตใหม่/ไม่ก็อปปี้ให้ดริฟท์กันภายหลัง)
//
// 🔌 ใช้งานจริงแบบ advisory: megaAdapters S7 และ megaCoverArchive เรียกโมดูลนี้เพื่อคำนวณ/เก็บ formulaScore
//   แต่ไม่ต่อเข้า coverQcGate และไม่มีผลต่อ pass/fail ของ QC; MEGA_FORMULA_CHECK=0 ปิดการคำนวณได้
//
// รับ input รูปแบบ (ทุกฟิลด์ optional — ไม่มี = check นั้นๆ degrade เป็น pass:null "วัดไม่ได้" ไม่ใช่ fail):
//   {
//     slots: [{
//       role: 'hero'|'context'|'action'|'moment'|'reaction'|'circle'|...,
//       faceSharePct: number|null,        // % สูงหน้าเทียบช่อง (ฟิลด์เดียวกับ panelCropGeometry.js faceSharePct)
//       faceVisible: 0|1|2|null,          // ตาสอง megaAdapters.js: 2=ยืนยันชัด, 1=บางส่วน, 0=ไม่เห็น/ไม่มี
//       sameAsHeroPerson: boolean|null,   // เฉพาะ role='circle' — ตาสองยืนยันว่าเป็นคนเดียวกับ hero หรือไม่
//       triage: { newsScene: boolean|null, textOverlay: number|null, pHash64: string|null },
//     }],
//     qcFlags: string[],   // ธงจาก coverQcGate.js/megaComposerService.js จริง (ใช้เป็น fallback signal
//                          //   เมื่อ per-slot data ข้างบนไม่มี — รู้จักเฉพาะรูปแบบที่ยืนยันแล้วใน coverQcGate.js
//                          //   ห้ามเดาธงใหม่: face_share_out:<slot>:<pct> · hero_face_unmeasured ·
//                          //   duplicate_scene:<a>:<b> · circle_same_person_as_hero · blind_crop:<slot> ·
//                          //   person_cut:<slot>)
//     template: { panelCount?: number, hasCircle?: boolean },
//   }
// คืน { score: number|null (0-100, เฉลี่ยเฉพาะ check ที่วัดได้ — null ถ้าวัดไม่ได้เลยสักข้อ),
//       checks: [{ key, pass: boolean|null, value, target, note }] }
// ============================================================

import { hammingDistanceHex, PHASH_DUP_HAMMING_MAX } from './slotSolver.js';

// Composer slot id -> canonical formula role. Kept in this pure leaf so archive callers
// never need to load megaAdapters/megaBrains/AI clients merely to shape formula input.
export function formulaRoleOfSlotId(slotId, shape) {
  const id = String(slotId || '');
  if (shape === 'circle') return 'circle';
  if (/main|hero/i.test(id)) return 'hero';
  if (/^context/i.test(id) || /^evidence/i.test(id)) return 'context';
  if (/^action/i.test(id)) return 'action';
  if (/^moment/i.test(id)) return 'moment';
  if (/^reaction/i.test(id)) return 'reaction';
  return null;
}

// Build the evaluator's real slot/template input from S7/archive evidence.
// Unknown numeric measurements stay undefined because Number(null) would fabricate zero.
export function buildFormulaInputFromCoverResult({ qcFlags, manifestSlots, pickImagesSlots } = {}) {
  const _qcFlags = Array.isArray(qcFlags) ? qcFlags : [];
  const _mSlots = Array.isArray(manifestSlots) ? manifestSlots : [];
  const _pickSlots = pickImagesSlots && typeof pickImagesSlots === 'object' ? pickImagesSlots : {};
  const byRole = new Map();
  const ensure = (role) => {
    if (!byRole.has(role)) {
      byRole.set(role, {
        role,
        faceSharePct: undefined,
        faceVisible: undefined,
        sameAsHeroPerson: null,
        triage: {
          newsScene: null,
          textOverlay: undefined,
          pHash64: null,
        },
      });
    }
    return byRole.get(role);
  };
  for (const [role, ps] of Object.entries(_pickSlots)) {
    if (!ps || typeof ps.newsScene !== 'boolean') continue;
    ensure(role).triage.newsScene = ps.newsScene;
  }
  for (const ms of _mSlots) {
    const role = formulaRoleOfSlotId(ms?.slot, ms?.shape);
    if (!role || ms?.measured?.faceSharePct == null) continue;
    ensure(role).faceSharePct = ms.measured.faceSharePct;
  }
  for (const f of _qcFlags) {
    let mm;
    if ((mm = /^face_share_out:([^:]+):(-?\d+(?:\.\d+)?)$/.exec(f))) {
      const role = formulaRoleOfSlotId(mm[1], mm[1] === 'circle' ? 'circle' : undefined);
      if (role) {
        const rec = ensure(role);
        if (rec.faceSharePct == null) rec.faceSharePct = Number(mm[2]);
      }
    } else if ((mm = /^(blind_crop|person_cut):(.+)$/.exec(f))) {
      const role = formulaRoleOfSlotId(mm[2]);
      if (role) ensure(role).faceVisible = 0;
    }
  }
  const heroPerson = String(_pickSlots.hero?.person || '').trim().toLowerCase();
  const circlePerson = String(_pickSlots.circle?.person || '').trim().toLowerCase();
  if (_pickSlots.circle) {
    ensure('circle').sameAsHeroPerson = (heroPerson && circlePerson)
      ? heroPerson === circlePerson
      : null;
  }
  const slots = [...byRole.values()];
  const template = {
    panelCount: _mSlots.length || Object.keys(_pickSlots).length || null,
    hasCircle: _mSlots.some((slot) => slot?.shape === 'circle') || !!_pickSlots.circle,
  };
  return { slots, template };
}

// ── เป้าจากวิจัย 478 ใบ (ตัวเลขระบุมาโดยตรงจากผู้ประสานงานเฟสนี้ — ยังไม่ได้คำนวณซ้ำจาก analysis/all-478.json
//   ดิบในรอบนี้ เพราะ RESEARCH-REPORT.md ที่สรุปไว้ไม่มีตัวเลข facePct ระดับนี้ตรงๆ ให้ยืนยันคู่ขนาน) ──
export const HERO_FACE_SHARE_MIN_PCT = 40;
export const HERO_FACE_SHARE_MAX_PCT = 46;
export const HERO_FACE_SHARE_MEDIAN_PCT = 44;

// เกณฑ์ "เห็นหน้าชัด" — ใช้สเกล 0/1/2 เดียวกับที่ megaAdapters.js second-eye ใช้อยู่แล้ว (2 = ยืนยันชัด)
const FACE_VISIBLE_OK = 2;
// role ที่ตั้งใจให้เป็น "ภาพคน" ต้องเห็นหน้า — ไม่รวม hero (เช็คแยกที่ face_share_hero) ไม่รวม context
// (มักเป็นวัตถุ/สถานที่ ไม่บังคับหน้า ตามกฎเดียวกับ MEGA_SUBSLOT_FACE_GATE ใน megaAdapters.js)
const PERSON_SUBSLOT_ROLES = ['action', 'moment', 'reaction', 'circle'];
// เกณฑ์ textOverlay ที่ถือว่า "ติดตัวหนังสือฝังมากเกิน" — เดียวกับที่ megaAdapters.js ใช้กรองผู้สมัครแทนที่ (>1)
const TEXT_OVERLAY_BAD_THRESHOLD = 1;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slotsArr(input) {
  return Array.isArray(input?.slots) ? input.slots.filter(Boolean) : [];
}

function flagsArr(input) {
  return Array.isArray(input?.qcFlags) ? input.qcFlags.map((f) => String(f)) : [];
}

function findSlot(slots, role) {
  return slots.find((s) => s && s.role === role) || null;
}

function mk(key, pass, value, target, note) {
  return { key, pass, value, target, note };
}

// ============================================================
// 1) face_share_hero — สัดส่วนหน้า hero ในช่อง เป้า 40-46% (median 44)
// ============================================================
function checkFaceShareHero(slots, flags) {
  const target = `${HERO_FACE_SHARE_MIN_PCT}-${HERO_FACE_SHARE_MAX_PCT}% (median ${HERO_FACE_SHARE_MEDIAN_PCT})`;
  const hero = findSlot(slots, 'hero');

  let value = hero ? num(hero.faceSharePct) : null;
  let fromFlag = false;
  if (value === null && flags.some((f) => f === 'hero_face_unmeasured')) {
    // ธงบอกตรงๆ ว่า "วัดหน้า hero ไม่ได้" — วัดไม่ได้จริง ไม่ใช่ fail
    return mk('face_share_hero', null, null, target, 'ธง hero_face_unmeasured — hero วัดหน้าไม่ได้');
  }
  if (value === null) {
    const m = flags.map((f) => /^face_share_out:hero:(\d+(?:\.\d+)?)$/.exec(f)).find(Boolean);
    if (m) { value = num(m[1]); fromFlag = true; }
  }

  if (value === null) {
    return mk('face_share_hero', null, null, target, hero ? 'hero slot ไม่มี faceSharePct/ธงที่วัดได้' : 'ไม่มี hero slot ในข้อมูลที่ส่งมา');
  }
  const pass = value >= HERO_FACE_SHARE_MIN_PCT && value <= HERO_FACE_SHARE_MAX_PCT;
  const src = fromFlag ? ' (จากธง qcFlags)' : '';
  const note = pass
    ? `หน้า hero ${value}% อยู่ในช่วงเป้า${src}`
    : `หน้า hero ${value}% ${value < HERO_FACE_SHARE_MIN_PCT ? 'เล็กไป' : 'ใหญ่ไป'} (เป้า ${HERO_FACE_SHARE_MIN_PCT}-${HERO_FACE_SHARE_MAX_PCT}%)${src}`;
  return mk('face_share_hero', pass, value, target, note);
}

// ============================================================
// 2) evidence_present — มีภาพเหตุการณ์จริง ≥1 ช่อง (triage.newsScene)
// ============================================================
function checkEvidencePresent(slots) {
  const target = '≥1 ช่อง';
  const measured = slots.filter((s) => typeof s?.triage?.newsScene === 'boolean');
  if (!measured.length) {
    return mk('evidence_present', null, null, target, 'ไม่มีช่องไหนมี triage.newsScene ให้วัด');
  }
  const hit = measured.filter((s) => s.triage.newsScene === true);
  const note = hit.length
    ? `มีภาพเหตุการณ์จริง ${hit.length} ช่อง (${hit.map((s) => s.role).join(', ')})`
    : 'ไม่มีช่องไหนเป็นภาพเหตุการณ์จริงเลย';
  return mk('evidence_present', hit.length >= 1, hit.length, target, note);
}

// ============================================================
// 3) no_baked_text — ไม่มีช่องติดธง text ฝัง (triage.textOverlay)
// ============================================================
function checkNoBakedText(slots) {
  const target = '0 ช่อง';
  const measured = slots.filter((s) => num(s?.triage?.textOverlay) !== null);
  if (!measured.length) {
    return mk('no_baked_text', null, null, target, 'ไม่มีช่องไหนมี triage.textOverlay ให้วัด');
  }
  const bad = measured.filter((s) => num(s.triage.textOverlay) > TEXT_OVERLAY_BAD_THRESHOLD);
  const note = bad.length
    ? `พบตัวอักษรฝังเกินเกณฑ์ใน ${bad.map((s) => s.role).join(', ')}`
    : 'ไม่มีช่องไหนติดตัวหนังสือฝังเกินเกณฑ์';
  return mk('no_baked_text', bad.length === 0, bad.length, target, note);
}

// ============================================================
// 4) no_dup — ไม่มีคู่ช่องภาพซ้ำ/ใกล้ซ้ำ (รับผล dedup ที่ระบบมี: pHash64 + qcFlags duplicate_scene)
// ============================================================
function checkNoDup(slots, flags) {
  const target = '0 คู่ซ้ำ';
  const dupPairs = [];
  const seen = new Set();
  const addPair = (a, b) => {
    const key = [a, b].sort().join('|');
    if (!seen.has(key)) { seen.add(key); dupPairs.push([a, b]); }
  };

  const withHash = slots.filter((s) => typeof s?.triage?.pHash64 === 'string' && s.triage.pHash64);
  let measured = withHash.length >= 2;
  for (let i = 0; i < withHash.length; i++) {
    for (let j = i + 1; j < withHash.length; j++) {
      const d = hammingDistanceHex(withHash[i].triage.pHash64, withHash[j].triage.pHash64);
      if (d !== null && d <= PHASH_DUP_HAMMING_MAX) addPair(withHash[i].role, withHash[j].role);
    }
  }
  // fallback/เสริม: ธง duplicate_scene:<a>:<b> จาก qcFlags จริง (megaComposerService.js)
  for (const f of flags) {
    const m = /^duplicate_scene:([^:]+):([^:]+)$/.exec(f);
    if (m) { measured = true; addPair(m[1], m[2]); }
  }

  if (!measured) {
    return mk('no_dup', null, null, target, 'ช่องที่วัด pHash64/ธง duplicate_scene ได้น้อยกว่า 2 ช่อง — เทียบคู่ไม่ได้');
  }
  const note = dupPairs.length
    ? `พบคู่ภาพใกล้ซ้ำ: ${dupPairs.map((p) => p.join('↔')).join(', ')}`
    : 'ไม่มีคู่ภาพซ้ำ/ใกล้ซ้ำ';
  return mk('no_dup', dupPairs.length === 0, dupPairs.length, target, note);
}

// ============================================================
// 5) face_visible_subslots — ช่องคนเห็นหน้าครบ (action/moment/reaction/circle)
// ============================================================
function checkFaceVisibleSubslots(slots, flags, template) {
  const target = `faceVisible=${FACE_VISIBLE_OK} ทุกช่อง`;
  const present = PERSON_SUBSLOT_ROLES.map((role) => findSlot(slots, role)).filter(Boolean);
  if (!present.length) {
    const reason = template && template.panelCount != null
      ? `เทมเพลตนี้ไม่มีช่อง action/moment/reaction/circle (panelCount=${template.panelCount})`
      : 'ไม่มีช่อง action/moment/reaction/circle ในข้อมูลที่ส่งมา';
    return mk('face_visible_subslots', null, null, target, reason);
  }

  const bad = new Set();
  const measuredRoles = new Set();
  for (const s of present) {
    if (num(s.faceVisible) !== null) {
      measuredRoles.add(s.role);
      if (num(s.faceVisible) < FACE_VISIBLE_OK) bad.add(s.role);
    }
  }
  // fallback: ธง blind_crop:<slot> / person_cut:<slot> จาก qcFlags จริง = ชัดเจนว่าไม่เห็นหน้า
  for (const f of flags) {
    const m = /^(blind_crop|person_cut):(.+)$/.exec(f);
    if (m && present.some((s) => s.role === m[2])) { measuredRoles.add(m[2]); bad.add(m[2]); }
  }

  if (!measuredRoles.size) {
    return mk('face_visible_subslots', null, null, target, 'มีช่องคนแต่ไม่มี faceVisible/ธงที่วัดได้');
  }
  const note = bad.size
    ? `เห็นหน้าไม่ครบใน ${[...bad].join(', ')}`
    : 'ช่องคนเห็นหน้าครบทุกช่องที่วัดได้';
  return mk('face_visible_subslots', bad.size === 0, `${measuredRoles.size - bad.size}/${measuredRoles.size}`, target, note);
}

// ============================================================
// 6) circle_distinct — คนในวง ≠ hero (sameAsHeroPerson)
// ============================================================
function checkCircleDistinct(slots, flags, template) {
  const target = 'ไม่ใช่คนเดียวกับ hero';
  if (template && template.hasCircle === false) {
    return mk('circle_distinct', null, null, target, 'เทมเพลตนี้ไม่มีวงกลม — ไม่เกี่ยว');
  }
  const circle = findSlot(slots, 'circle');
  if (!circle) {
    return mk('circle_distinct', null, null, target, 'ไม่มี circle slot ในข้อมูลที่ส่งมา');
  }
  if (typeof circle.sameAsHeroPerson === 'boolean') {
    const pass = circle.sameAsHeroPerson !== true;
    return mk(
      'circle_distinct',
      pass,
      circle.sameAsHeroPerson,
      target,
      pass ? 'คนในวงคนละคนกับ hero' : 'คนในวงเป็นคนเดียวกับ hero (เสียช่อง — ควรสลับ)'
    );
  }
  // fallback: ธง circle_same_person_as_hero จาก qcFlags จริง (coverQcGate.js)
  if (flags.some((f) => f === 'circle_same_person_as_hero')) {
    return mk('circle_distinct', false, true, target, 'ธง circle_same_person_as_hero — คนในวงเป็นคนเดียวกับ hero');
  }
  return mk('circle_distinct', null, null, target, 'circle slot ไม่มี sameAsHeroPerson/ธงที่วัดได้');
}

/**
 * ประเมินสูตรปก 478 ใบ (pure — ไม่มี IO/AI, input เดิม→ผลเดิมเสมอ)
 * @param {object} [input={}] ดูรูปแบบเต็มที่หัวไฟล์
 * @returns {{score: number|null, checks: Array<{key:string,pass:boolean|null,value:*,target:string,note:string}>}}
 */
export function evaluateCoverFormula(input = {}) {
  const slots = slotsArr(input);
  const flags = flagsArr(input);
  const template = input?.template && typeof input.template === 'object' ? input.template : null;

  const checks = [
    checkFaceShareHero(slots, flags),
    checkEvidencePresent(slots),
    checkNoBakedText(slots),
    checkNoDup(slots, flags),
    checkFaceVisibleSubslots(slots, flags, template),
    checkCircleDistinct(slots, flags, template),
  ];

  const measurable = checks.filter((c) => c.pass !== null);
  const score = measurable.length
    ? Math.round((measurable.filter((c) => c.pass).length / measurable.length) * 100)
    : null;

  return { score, checks };
}
