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

  const slots = slotsFromTemplate(templateSlots);
  const slotAssign = assignSlots(slots, pickSlots, slotOrder);
  const imagesBySlot = buildImagesBySlot(slotAssign, pickSlots, caseImages);
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
