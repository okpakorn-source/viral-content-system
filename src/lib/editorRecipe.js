// ============================================================
// 🗂️ editorRecipe — แปลง "งานคิวปก MEGA" → สูตรเปิดในเอดิเตอร์ /cover-tester
// ------------------------------------------------------------
// PURE ล้วน (ไม่มี IO/LLM/network/fs) — เทสได้โดด (tests/editor-recipe.test.mjs)
// รับ dossier ของงาน (refMatch.dna.template.slots แบบ % + pickImages.slots ราย role)
//   แล้วผลิต:
//     • template.slots แบบ px ของเอดิเตอร์ (แปลง %→px, circle→diameter, คง zIndex/border)
//     • imagesBySlot: editorSlotId → imageUrl (เลือก URL ที่ rehost=supabase storage ก่อนเสมอ)
//     • pool: คลังภาพเคสทั้งหมด (prefer-rehosted) ให้คนคลิกสลับภาพเองในเอดิเตอร์
//     • qc: ผล QC (pass/reasons) ให้คนเห็นว่าระบบติดตรงไหน
// ------------------------------------------------------------
// mapping role↔slot อิงโครงจริงจาก dossier:
//   • semantic  — pickImages entry มี refSlotId → จับคู่ตาม refSlotId/slotOrder (positional)
//   • legacy    — role ของ pickImages ตรง/เทียบเคียงกับ slot.role ใน dna template
//     (คำศัพท์ 2 ชุดต่างกัน: pickImages=hero/reaction/action/context/circle · template=hero/context/evidence/moment/reaction
//      → ตาราง alias ด้านล่างเชื่อมความหมาย เช่น action→moment, circle→evidence)
//   ★ ห้ามแตะ refTemplate.dnaToTemplateSpec (ท่อจริง strict) — โมดูลนี้เป็นสายเอดิเตอร์คนละเส้น เบา/แก้มือได้
// ============================================================

// ★ 18 ก.ค. 69 (บั๊ก "ภาพสลับมั่วใน editor" — เคส AC-0147): ผัง+id ของ editor ต้องมาจาก dnaToTemplateSpec
//   ตัวจริง (สูตรเดียวกับ composer) — import มา "เรียกใช้" อย่างเดียว ไม่แตะตัวฟังก์ชัน (กฎหัวไฟล์ยังคงเดิม)
import { dnaToTemplateSpec } from './refTemplate.js';

const CANVAS_W = 1080;
const CANVAS_H = 1350;

// URL ที่ rehost บน Supabase Storage = CORS เปิด → วาดลง canvas แล้ว export ได้ (ไม่ taint)
//   ภาพเว็บนอก (ไทยรัฐ/pptv ฯลฯ) วาดได้แต่ export ไม่ได้ — จึง prefer rehosted เสมอ
export function isRehostedUrl(url) {
  return typeof url === 'string' && /supabase\.co\/storage\/v1\/object\//.test(url);
}

// เลือก URL ดีที่สุดจากตัวเลือก: rehosted ตัวแรก > ตัวแรกที่ไม่ว่าง > null
function pickBestUrl(candidates) {
  const urls = (Array.isArray(candidates) ? candidates : [])
    .filter((u) => typeof u === 'string' && u.trim());
  return urls.find(isRehostedUrl) || urls[0] || null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// สีขอบปลอดภัย: hex 3/6 หลักเท่านั้น (กันค่าเพี้ยน '-' / neon วัดพลาด) — ไม่ผ่าน = null
function safeBorderColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : null;
}

// ป้ายไทยอ่านง่ายต่อช่อง (ตาม role + shape)
function labelFor(role, shape, idx) {
  const r = String(role || '').toLowerCase();
  if (shape === 'circle') return '⭕ วงกลม';
  if (r.includes('hero')) return '★ ภาพหลัก';
  if (r.includes('context') || r.includes('scene')) return '🖼 ฉาก/บริบท';
  if (r.includes('evidence')) return '⭐ หลักฐาน';
  if (r.includes('moment') || r.includes('action')) return '🖼 โมเมนต์';
  if (r.includes('reaction')) return '🖼 รีแอ็กชัน';
  return `🖼 ช่อง ${idx + 1}`;
}

// สร้าง editor slots จาก dna.template.slots (% → px · circle → diameter · คง zIndex/border)
//   คงคอนเวนชัน id เดียวกับ dnaToTemplateSpec: hero→'main', circle→'circle', อื่น→`${role}_${i}`
export function slotsFromTemplate(templateSlots) {
  const out = [];
  const seen = new Set();
  let heroDone = false;
  (Array.isArray(templateSlots) ? templateSlots : []).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const isCircle = s.shape === 'circle';
    const xPct = num(s.xPct), yPct = num(s.yPct), wPct = num(s.wPct), hPct = num(s.hPct);
    const x = Math.round((xPct / 100) * CANVAS_W);
    const y = Math.round((yPct / 100) * CANVAS_H);

    let id;
    if (isCircle) id = 'circle';
    else if (!heroDone && /hero/i.test(String(s.role || ''))) { id = 'main'; heroDone = true; }
    else id = `${(String(s.role || 'p').toLowerCase().replace(/[^a-z]/g, '') || 'p')}_${i}`;
    while (seen.has(id)) id = `${id}_${i}`; // กัน id ซ้ำ (เช่น 2 วงกลม)
    seen.add(id);

    const bColor = s.border ? safeBorderColor(s.borderColor) : null;
    const zIndex = Number.isFinite(Number(s.zIndex)) ? Number(s.zIndex) : (isCircle ? 4 : 0);

    if (isCircle) {
      // เส้นผ่านศูนย์กลางจาก wPct (ช่องวงกลม dna วัด w≈h) — คุมช่วงกันค่าเพี้ยนสุดขั้ว
      const diameter = Math.max(80, Math.round((wPct / 100) * CANVAS_W));
      out.push({
        id, label: labelFor(s.role, 'circle', i), role: s.role || 'reaction',
        shape: 'circle', x, y, diameter,
        border: bColor || '#FFFFFF',
        borderWidth: s.border ? Math.max(4, Math.round((num(s.borderWidthPct) || 2) / 100 * CANVAS_W)) : 6,
        zIndex, draggable: true,
      });
    } else {
      const w = Math.max(8, Math.round((wPct / 100) * CANVAS_W));
      const h = Math.max(8, Math.round((hPct / 100) * CANVAS_H));
      const slot = {
        id, label: labelFor(s.role, 'rect', i), role: s.role || 'p',
        x, y, w, h, zIndex,
      };
      if (bColor) {
        slot.border = bColor;
        slot.borderWidth = Math.max(4, Math.round((num(s.borderWidthPct) || 1.5) / 100 * CANVAS_W));
        slot.draggable = true; // ช่องมีกรอบ (inset/หลักฐาน) = ลากจัดเองได้
      }
      out.push(slot);
    }
  });
  return out;
}

// ★ 18 ก.ค. 69: สร้าง editor slots จาก "ผังจริงของ composer" (dnaToTemplateSpec) — single source of truth
//   ปิดบั๊กภาพสลับ: slotsFromTemplate เดิมเป็นก๊อปปี้ไม่ครบ (ขาด grid-snap/ปิดผืน/ด่านกันชนตัดช่อง/
//   hero-fallback "ช่องใหญ่สุด→main"/dedup คนละสูตร) → id+ผัง ไม่ตรง manifest.slots → ภาพลงผิดช่อง
//   ที่นี่: เรียก spec ตัวจริง (px 1080×1350 + id สุดท้ายหลังทุก relabel = id เดียวกับ manifest เป๊ะ)
//   แล้วแปลงเป็นรูปช่องของ editor (label/role/diameter) · spec คืน null → ผู้เรียก fallback ก๊อปปี้เดิม
export function slotsFromSpec(dna) {
  let spec = null;
  try { spec = dnaToTemplateSpec(dna); } catch { spec = null; }
  const specSlots = spec && Array.isArray(spec.slots) ? spec.slots : null;
  if (!specSlots || !specSlots.length) return null;
  const orig = (dna && dna.template && Array.isArray(dna.template.slots)) ? dna.template.slots : [];
  return specSlots.map((s, idx) => {
    const isCircle = s.shape === 'circle';
    // role จริงจาก dna.template.slots ผ่าน _sourceIndex (non-enumerable — อ่านได้ใน process เดียวกัน)
    let si = null;
    try { const d = Object.getOwnPropertyDescriptor(s, '_sourceIndex'); si = d ? d.value : null; } catch { si = null; }
    const role = (si != null && orig[si] && orig[si].role)
      ? orig[si].role
      : (s.id === 'main' ? 'hero' : (String(s.id).replace(/[^a-z]/g, '') || 'p'));
    if (isCircle) {
      return {
        id: s.id, label: labelFor(role, 'circle', idx), role: role || 'reaction',
        shape: 'circle', x: s.x, y: s.y, diameter: Math.max(80, num(s.w)),
        border: s.border || '#FFFFFF',
        borderWidth: num(s.borderWidth) || 6,
        zIndex: Number.isFinite(Number(s.zIndex)) ? Number(s.zIndex) : 4,
        draggable: true,
      };
    }
    const slot = {
      id: s.id, label: labelFor(role, 'rect', idx), role: role || 'p',
      x: s.x, y: s.y, w: Math.max(8, num(s.w)), h: Math.max(8, num(s.h)),
      zIndex: Number.isFinite(Number(s.zIndex)) ? Number(s.zIndex) : 0,
    };
    if (s.border) {
      slot.border = s.border;
      slot.borderWidth = num(s.borderWidth) || 8;
      slot.draggable = true; // ช่องมีกรอบ (inset/หลักฐาน) = ลากจัดเองได้ — เท่าพฤติกรรมเดิม
    }
    return slot;
  });
}

// ★ 19 ก.ค. 69 (ด่านกันเหนียว — editor จอดำเมื่อ compose รัน "ไม่มี ref"):
//   ไม่มี ref → dna ว่าง → dnaToTemplateSpec คืน null + template.slots ว่าง → slotsFromSpec/slotsFromTemplate
//   คืน slots ว่าง → ภาพจาก manifest ลงไม่ได้ (slotIds.has(m.slot) เป็น false เสมอ) → editor จอดำ
//   ทางแก้ที่ถูกต้อง: composer แนบ "ผังจริงต่อช่อง" (geometry) ลง manifest.slots แล้ว (fix 19 ก.ค. megaComposerService)
//   → ที่นี่แปลง manifest.slots (id=slot · px + shape/zIndex) เป็น editor slot รูปเดียวกับ slotsFromSpec
//   geometry เป็น px ในผืน manifestCanvas (spec.canvasW×H ของรอบประกอบ — fallback vt_ref_tri/vt_faces_circle=1200×1350)
//   → สเกลลงผืน 1080×1350 ของ editor (ไม่สเกล = ช่องล้นขอบขวาเมื่อ canvas ต้นทาง 1200) · ไม่มี canvas = ถือเป็น 1080×1350
export function slotsFromManifest(manifestSlots, manifestCanvas) {
  const list = Array.isArray(manifestSlots) ? manifestSlots : [];
  const cw = num(manifestCanvas && manifestCanvas.w) || CANVAS_W;
  const ch = num(manifestCanvas && manifestCanvas.h) || CANVAS_H;
  const sx = cw > 0 ? CANVAS_W / cw : 1; // สเกลกว้าง (ต้นทาง 1200 → 0.9) · วงกลม/ช่องกว้าง ใช้ตัวนี้
  const sy = ch > 0 ? CANVAS_H / ch : 1; // สเกลสูง (ต้นทางทุกเทมเพลต ×1350 = 1:1)
  const out = [];
  const seen = new Set();
  list.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    // ต้องมี geometry ครบ (x/y/w/h finite) — ขาด = ข้าม (ไม่มั่ว/ไม่เดา)
    if (![m.x, m.y, m.w, m.h].every((v) => Number.isFinite(Number(v)))) return;
    let id = (typeof m.slot === 'string' && m.slot.trim()) ? m.slot : `slot_${i}`;
    while (seen.has(id)) id = `${id}_${i}`; // กัน id ซ้ำ (ปกติ manifest ไม่ซ้ำอยู่แล้ว)
    seen.add(id);

    const isCircle = m.shape === 'circle';
    // role อนุมานจาก id (คงคอนเวนชันเดียวกับ slotsFromSpec: main→hero, วงกลม→reaction, อื่น→ตัวอักษรของ id)
    const role = isCircle ? 'reaction'
      : (id === 'main' ? 'hero' : (String(id).replace(/[^a-z]/g, '') || 'p'));
    const x = Math.round(num(m.x) * sx);
    const y = Math.round(num(m.y) * sy);
    const bColor = safeBorderColor(m.border);

    if (isCircle) {
      out.push({
        id, label: labelFor(role, 'circle', i), role,
        shape: 'circle', x, y, diameter: Math.max(80, Math.round(num(m.w) * sx)),
        border: bColor || '#FFFFFF',
        borderWidth: num(m.borderWidth) || 6,
        zIndex: Number.isFinite(Number(m.zIndex)) ? Number(m.zIndex) : 4,
        draggable: true,
      });
    } else {
      const slot = {
        id, label: labelFor(role, 'rect', i), role,
        x, y,
        w: Math.max(8, Math.round(num(m.w) * sx)),
        h: Math.max(8, Math.round(num(m.h) * sy)),
        zIndex: Number.isFinite(Number(m.zIndex)) ? Number(m.zIndex) : 0,
      };
      if (bColor) {
        slot.border = bColor;
        slot.borderWidth = num(m.borderWidth) || 8;
        slot.draggable = true; // ช่องมีกรอบ = ลากจัดเองได้ (เท่าพฤติกรรม slotsFromSpec/slotsFromTemplate)
      }
      out.push(slot);
    }
  });
  return out;
}

// ตาราง alias (legacy): editor slot role → ลำดับ pickImages key ที่เติมช่องนี้ได้
//   คำศัพท์ pickImages = hero/reaction/action/context/circle (SLOT_ORDER ท่อจริง)
//   คำศัพท์ template   = hero/context/evidence/moment/reaction
const ROLE_FILL = {
  hero: ['hero'],
  context: ['context', 'action'],
  scene: ['context', 'action'],
  evidence: ['circle', 'action', 'context'],   // ช่องหลักฐาน (กรอบเขียว) ← pickImages 'circle' (ภาพหลักฐาน)
  moment: ['action', 'context'],               // ช่องโมเมนต์ ← pickImages 'action'
  action: ['action', 'context'],
  reaction: ['reaction', 'circle'],            // ช่องวงกลมคน ← pickImages 'reaction'
  circle: ['circle', 'reaction'],
};

function normRole(role) {
  return String(role || '').toLowerCase().replace(/[^a-z]/g, '');
}

// จับคู่ภาพเข้าช่อง → { [editorSlotId]: pickImagesKey }
//   คืน map ของ slotId → entryKey (ยังไม่เลือก URL — ทำต่อใน buildImagesBySlot)
export function assignSlots(editorSlots, pickSlots, slotOrder) {
  const result = {};
  const slots = Array.isArray(editorSlots) ? editorSlots : [];
  const pick = (pickSlots && typeof pickSlots === 'object') ? pickSlots : {};
  const keys = Object.keys(pick);
  if (!slots.length || !keys.length) return result;

  const used = new Set();
  const order = Array.isArray(slotOrder) ? slotOrder.filter((k) => keys.includes(k)) : [];
  const isSemantic = order.length > 0 && keys.some((k) => {
    const e = pick[k];
    return e && e.refSlotId != null && e.refSlotId !== '';
  });

  if (isSemantic) {
    // ── SEMANTIC ──
    // ① จับคู่ตรงตัวก่อน: entry.refSlotId === editorSlot.id (เมื่อ refSlotId บังเอิญตรง id ที่ derive)
    const byRefSlotId = new Map();
    for (const k of keys) {
      const rs = pick[k] && pick[k].refSlotId;
      if (rs != null && rs !== '') byRefSlotId.set(String(rs), k);
    }
    for (const sl of slots) {
      const k = byRefSlotId.get(String(sl.id));
      if (k && !used.has(k)) { result[sl.id] = k; used.add(k); }
    }
    // ② ช่องที่ยังว่าง → เติมตามลำดับ slotOrder (= ลำดับ sourceIndex ของ contract)
    let oi = 0;
    for (const sl of slots) {
      if (result[sl.id]) continue;
      while (oi < order.length && used.has(order[oi])) oi++;
      if (oi < order.length) { result[sl.id] = order[oi]; used.add(order[oi]); oi++; }
    }
    return result;
  }

  // ── LEGACY (role/alias) ──
  // ① exact key === role · ② alias ตาม ROLE_FILL
  for (const sl of slots) {
    const r = normRole(sl.role);
    const cands = [];
    if (keys.includes(r)) cands.push(r);
    for (const a of (ROLE_FILL[r] || [])) if (!cands.includes(a)) cands.push(a);
    const hit = cands.find((k) => keys.includes(k) && !used.has(k));
    if (hit) { result[sl.id] = hit; used.add(hit); }
  }
  // ③ ช่องที่ยังว่าง → เติมด้วย pickImages ที่เหลือ (คงลำดับ keys) กันภาพหล่นหาย
  const leftoverKeys = keys.filter((k) => !used.has(k));
  let li = 0;
  for (const sl of slots) {
    if (result[sl.id]) continue;
    if (li < leftoverKeys.length) { result[sl.id] = leftoverKeys[li]; used.add(leftoverKeys[li]); li++; }
  }
  return result;
}

// จาก slotId→entryKey + pickSlots + caseImages → { [slotId]: imageUrl } (prefer rehosted)
function buildImagesBySlot(slotAssign, pickSlots, caseImages) {
  const imgs = {};
  const cases = Array.isArray(caseImages) ? caseImages : [];
  for (const [slotId, key] of Object.entries(slotAssign || {})) {
    const entry = pickSlots[key];
    if (!entry) continue;
    const ci = cases.find((c) => c && c.id === entry.id);
    // prefer rehosted: ข้ามทุก URL ที่รู้จักของภาพ "ใบเดียวกัน" (id ตรง) — เลือก supabase storage ก่อน
    const url = pickBestUrl([
      ci && ci.imageUrl,
      ci && ci.thumbnailUrl,
      entry.imageUrl,
    ]);
    if (url) imgs[slotId] = url;
  }
  return imgs;
}

// คลังภาพเคส → pool item (prefer-rehosted url/thumb)
function buildPool(caseImages) {
  return (Array.isArray(caseImages) ? caseImages : [])
    .map((ci) => {
      if (!ci) return null;
      const url = pickBestUrl([ci.imageUrl, ci.thumbnailUrl]);
      const thumb = pickBestUrl([ci.thumbnailUrl, ci.imageUrl]);
      if (!url) return null;
      return { id: ci.id || null, url, thumb: thumb || url, note: ci.note || '', person: ci.person || '' };
    })
    .filter(Boolean);
}

// ผล QC จาก dossier.cover.qcVerdict → { pass, reasons[], advisory[], summary }
function buildQc(job) {
  const qcv = job && job.dossier && job.dossier.cover && job.dossier.cover.qcVerdict;
  if (!qcv || typeof qcv !== 'object') {
    return {
      pass: null, reasons: [], advisory: [],
      summary: 'ยังไม่ได้ตรวจ QC (งานยังไม่ถึงขั้นประกอบปก) — เปิดจัดภาพเองได้เลย',
    };
  }
  const pass = typeof qcv.pass === 'boolean' ? qcv.pass : null;
  const reasons = Array.isArray(qcv.reasons) ? qcv.reasons.filter((r) => typeof r === 'string') : [];
  const advisory = Array.isArray(qcv.advisory) ? qcv.advisory.filter((r) => typeof r === 'string') : [];
  // ไม่ผ่านแต่ reasons ว่าง (เช่นล้มก่อน QC ตัดสิน) → ใช้ advisory เป็นเช็คลิสต์ให้คนดู
  const list = reasons.length ? reasons : (pass === false ? advisory : reasons);
  const summary = pass === true ? 'ผ่าน QC ระบบแล้ว'
    : pass === false ? `ระบบ QC ไม่ผ่าน (${list.length} ข้อ) — ปรับภาพ/ตำแหน่งตามเช็คลิสต์แล้วบันทึกใหม่`
      : 'ยังไม่มีผล QC ชัดเจน';
  return { pass, reasons: list, advisory, summary };
}

// เช็คว่างานพร้อมทำ recipe ไหม (มี pickImages + refMatch.dna.template.slots)
export function isRecipeReady(job) {
  const d = job && job.dossier;
  if (!d) return false;
  const hasPick = d.pickImages && d.pickImages.slots
    && typeof d.pickImages.slots === 'object'
    && Object.keys(d.pickImages.slots).length > 0;
  const tpl = d.refMatch && d.refMatch.dna && d.refMatch.dna.template;
  const hasRef = tpl && Array.isArray(tpl.slots) && tpl.slots.length > 0;
  return !!(hasPick && hasRef);
}

// ── main ──
export function buildEditorRecipe({ job, caseImages } = {}) {
  const d = (job && job.dossier) || {};
  const refMatch = d.refMatch || {};
  const dna = refMatch.dna || {};
  const templateSlots = (dna.template && Array.isArray(dna.template.slots)) ? dna.template.slots : [];
  const pickSlots = (d.pickImages && d.pickImages.slots && typeof d.pickImages.slots === 'object')
    ? d.pickImages.slots : {};
  const slotOrder = Array.isArray(d.pickImages && d.pickImages.slotOrder) ? d.pickImages.slotOrder : null;

  // ★ 18 ก.ค. 69: ผังจริงจาก composer ก่อนเสมอ (id ตรง manifest 100%) — spec ใช้ไม่ได้ค่อย fallback ก๊อปปี้เดิม
  let slots = slotsFromSpec(dna) || slotsFromTemplate(templateSlots);
  // ★ 19 ก.ค. 69 (ด่านกันเหนียว — editor จอดำเมื่อ compose ไม่มี ref): มี dna = path เดิมทั้งหมด ไม่แตะ
  //   ไม่มี dna → slots ว่าง (dna ว่าง = spec null + template.slots ว่าง) แต่ manifest.slots พก geometry ต่อช่อง
  //   (composer แนบ x/y/w/h/shape/zIndex ให้แล้ว) → สร้าง editor slot จาก manifest แทน (ไม่งั้นภาพลงไม่ได้ = จอดำ)
  if (!slots.length) {
    const mSlotsGeom = (d.cover && d.cover.manifest && Array.isArray(d.cover.manifest.slots))
      ? d.cover.manifest.slots : null;
    const hasGeom = mSlotsGeom && mSlotsGeom.some((m) => m
      && [m.x, m.y, m.w, m.h].every((v) => Number.isFinite(Number(v))));
    if (hasGeom) {
      const mCanvas = (Number.isFinite(Number(d.cover.manifest.canvasW)) && Number.isFinite(Number(d.cover.manifest.canvasH)))
        ? { w: Number(d.cover.manifest.canvasW), h: Number(d.cover.manifest.canvasH) } : null;
      slots = slotsFromManifest(mSlotsGeom, mCanvas);
    }
  }
  const slotAssign = assignSlots(slots, pickSlots, slotOrder);
  let imagesBySlot = buildImagesBySlot(slotAssign, pickSlots, caseImages);

  // ★ 17 ก.ค. (บั๊กจริงจากผู้ใช้: ปกที่ประกอบ ≠ ผังใน editor): composer มีสิทธิ์สลับ/ย้ายภาพตอนประกอบ
  //   (ตาแก้/สลับสำรอง/จัดลำดับ) — ความจริงสุดท้ายอยู่ใน manifest.slots ({slot, imageUrl หลังทุกการสลับ})
  //   ซึ่งใช้ id ระบบเดียวกับ editor template (dnaToTemplateSpec: main/circle/role_i)
  //   → ถ้ามี manifest ให้ยึดก่อนเสมอ (เฉพาะ id ที่แมตช์ช่องจริง) · role-mapping เดิม = fallback งานที่ยังไม่เคยประกอบ
  const mSlots = d.cover && d.cover.manifest && Array.isArray(d.cover.manifest.slots)
    ? d.cover.manifest.slots : null;
  if (mSlots && mSlots.length) {
    const slotIds = new Set(slots.map((s) => s.id));
    const byManifest = {};
    for (const m of mSlots) {
      if (m && typeof m.slot === 'string' && slotIds.has(m.slot) && typeof m.imageUrl === 'string' && m.imageUrl.trim()) {
        // ยกระดับเป็น URL rehost ของ "ภาพเดียวกัน" ถ้าเจอในพูลเคส — ไม่เจอ = ใช้ url จริงจาก manifest
        // ★ 18 ก.ค. 69 (บั๊กภาพหาย/สลับใน editor — เคส AC-0147): เดิมเทียบ+เลือกเฉพาะ imageUrl ทำ URL
        //   ต้นทางดิบ (เช่น TikTok CDN ที่บล็อก hotlink — เบราว์เซอร์โหลดไม่ได้) หลุดเข้า editor ทั้งที่ภาพ
        //   เดียวกันมี thumbnailUrl ที่ rehost บน supabase อยู่แล้ว → ต้องเทียบ+พิจารณา thumbnailUrl ด้วย
        //   (เท่ามาตรฐานเดียวกับเส้น role-mapping ใน buildImagesBySlot ที่ใช้ ci.thumbnailUrl มาตลอด)
        const hit = (Array.isArray(caseImages) ? caseImages : []).find((x) => x
          && (x.imageUrl === m.imageUrl || x.url === m.imageUrl || x.thumbnailUrl === m.imageUrl));
        byManifest[m.slot] = pickBestUrl([hit && hit.imageUrl, hit && hit.url, hit && hit.thumbnailUrl, m.imageUrl]);
      }
    }
    if (Object.keys(byManifest).length) imagesBySlot = byManifest;
  }

  const pool = buildPool(caseImages);
  const qc = buildQc(job);

  const jobId = (job && job.id) || 'unknown';
  const title = (d.desk && d.desk.title) || '';

  return {
    jobId,
    title,
    status: (job && job.status) || null,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    refStyle: refMatch.styleName || null,
    layoutFamily: dna.layoutFamily || null,
    caseId: (d.images && d.images.caseId) || null,
    template: {
      id: `recipe-${jobId}`,
      name: `🗂️ ${(title || jobId).slice(0, 42)}`,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      slots,
      textSlots: [],
    },
    imagesBySlot,
    pool,
    qc,
  };
}
