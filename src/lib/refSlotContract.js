// Ref-slot contract for MEGA shadow diagnostics.
// Pure by design: no imports, IO, time, random, or environment reads.

export const LEGACY_MEGA_SLOT_ORDER = Object.freeze(['hero', 'reaction', 'action', 'context', 'circle']);

function cleanRole(value, fallback) {
  const role = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return role || fallback;
}

function solverRoleFor(refRole, shape) {
  if (refRole === 'hero' || refRole === 'main') return 'hero';
  if (shape === 'circle') return 'circle';
  if (refRole === 'context') return 'context';
  if (refRole === 'evidence') return 'evidence';
  return 'secondary';
}

function geometryOf(slot) {
  const xPct = Number(slot?.xPct);
  const yPct = Number(slot?.yPct);
  const wPct = Number(slot?.wPct);
  const hPct = Number(slot?.hPct);
  if (![xPct, yPct, wPct, hPct].every(Number.isFinite)) return null;
  return { xPct, yPct, wPct, hPct, zIndex: Number(slot?.zIndex) || 0 };
}

function orderFor(orders, index, refRole) {
  const list = Array.isArray(orders) ? orders : [];
  return list.find((order) => Number(order?.i) === index)
    || list.find((order) => cleanRole(order?.role, '') === refRole)
    || null;
}

function uniqueId(base, counts) {
  const next = (counts.get(base) || 0) + 1;
  counts.set(base, next);
  return next === 1 ? base : `${base}_${next}`;
}

/**
 * Build the immutable semantic contract used only by solver shadow diagnostics.
 * Geometry slots are canonical when available; semantic slots fill missing labels.
 */
export function buildRefSlotContract({ refDNA = null, artBriefOrders = [], legacySlots = LEGACY_MEGA_SLOT_ORDER } = {}) {
  const dna = refDNA && typeof refDNA === 'object' ? refDNA : {};
  const templateSlots = Array.isArray(dna.template?.slots) ? dna.template.slots : [];
  const semanticSlots = Array.isArray(dna.slots) ? dna.slots : [];
  const legacyOrder = (Array.isArray(legacySlots) && legacySlots.length ? legacySlots : LEGACY_MEGA_SLOT_ORDER)
    .map((slot, index) => cleanRole(slot, `slot_${index + 1}`));

  let source = 'legacy';
  let rawSlots;
  if (templateSlots.length) {
    source = 'template.slots';
    rawSlots = templateSlots.map((slot, index) => ({ ...(semanticSlots[index] || {}), ...slot }));
  } else if (semanticSlots.length) {
    source = 'slots';
    rawSlots = semanticSlots.map((slot) => ({ ...slot }));
  } else {
    rawSlots = legacyOrder.map((role) => ({ role, shape: role === 'circle' ? 'circle' : 'rect' }));
  }

  const counts = new Map();
  const slots = rawSlots.map((raw, index) => {
    const legacySlot = legacyOrder[index] || null;
    const refRole = cleanRole(raw?.role || raw?.id, legacySlot || `slot_${index + 1}`);
    const id = uniqueId(refRole, counts);
    const shape = cleanRole(raw?.shape, refRole === 'circle' ? 'circle' : 'rect');
    const order = orderFor(artBriefOrders, index, refRole);
    return {
      id,
      refRole,
      solverRole: solverRoleFor(refRole, shape),
      legacySlot,
      sourceIndex: index,
      shape,
      subject: String(raw?.subject || '').trim() || null,
      eventIntent: String(order?.want || '').trim() || null,
      wantPerson: String(order?.personHint || '').trim() || null,
      refShot: String(order?.shot || raw?.shot || '').trim() || null,
      position: String(raw?.pos || '').trim() || null,
      geometry: geometryOf(raw),
    };
  });

  const mismatches = slots
    .filter((slot) => slot.legacySlot && slot.refRole !== slot.legacySlot)
    .map((slot) => ({ id: slot.id, refRole: slot.refRole, legacySlot: slot.legacySlot, sourceIndex: slot.sourceIndex }));

  return { v: 1, source, legacyOrder, slots, mismatches };
}

export function projectLegacySelections(legacySelections, contract) {
  const source = legacySelections && typeof legacySelections === 'object' ? legacySelections : {};
  const slots = Array.isArray(contract?.slots) ? contract.slots : [];
  return Object.fromEntries(slots.map((slot) => {
    const raw = slot.legacySlot ? source[slot.legacySlot] : null;
    const id = raw && typeof raw === 'object' ? raw.id : raw;
    return [slot.id, id == null ? null : String(id)];
  }));
}

export function restrictCandidateUniverse(images, visibleIds) {
  const list = Array.isArray(images) ? images : [];
  if (!Array.isArray(visibleIds)) return list.slice();
  const visible = new Set(visibleIds.map(String));
  return list.filter((image) => visible.has(String(image?.id)));
}

function contractSlotForFinalSlot(finalSlot, contract) {
  const name = String(finalSlot || '').trim().toLowerCase();
  const slots = Array.isArray(contract?.slots) ? contract.slots : [];
  if (/^(main|hero)/.test(name)) return slots.find((slot) => slot.solverRole === 'hero') || null;
  if (name === 'circle' || name.startsWith('circle_')) return slots.find((slot) => slot.shape === 'circle') || null;
  const prefix = cleanRole(name.replace(/_\d+$/, ''), '');
  return slots.find((slot) => slot.id === prefix || slot.refRole === prefix) || null;
}

function legacyRoleForFinalSlot(finalSlot) {
  const name = cleanRole(String(finalSlot || '').replace(/_\d+$/, ''), '');
  if (name === 'main' || name === 'hero') return 'hero';
  if (name === 'circle') return 'circle';
  return LEGACY_MEGA_SLOT_ORDER.includes(name) ? name : null;
}

/**
 * Join S6 primaries to the final composer manifest without mutating either side.
 * A missing URL match is intentionally reported as backup-or-unknown because old manifests
 * do not persist candidate ids for every backup.
 */
export function buildFinalAssignmentTrace({ plannedSlots = {}, manifestSlots = [], placed = [], refSlotContract = null, selectionSpec = null } = {}) {
  const plans = Object.entries(plannedSlots && typeof plannedSlots === 'object' ? plannedSlots : {})
    .map(([role, value]) => ({
      role: cleanRole(role, role),
      id: value?.id == null ? null : String(value.id),
      imageUrl: String(value?.imageUrl || ''),
    }));
  const placedBySlot = new Map((Array.isArray(placed) ? placed : []).map((item) => [String(item?.slot || ''), item]));
  const finals = Array.isArray(manifestSlots) ? manifestSlots : [];
  // ★ รอบ 5 P0-1: มี SelectionSpec = spec เป็น authority เดียว — ทุก manifest slot ต้อง exact match
  //   composerSlotId เท่านั้น · ช่องนอกสัญญา (composer เพิ่ม/เปลี่ยนชื่อเอง) = unmapped ห้ามถอย legacy
  //   (ไม่งั้น legacy positional อาจนับช่องเถื่อนเป็น kept ได้) · legacy ใช้เฉพาะเมื่อ "ไม่มี spec เลย"
  //   · composerSlotId ซ้ำใน spec = ambiguous ห้าม Map last-wins เงียบๆ — ช่องนั้นตกเป็น unmapped
  // ★ Checkpoint A รอบ 2 (P0-A): spec "present" แม้ malformed ({}, slots:[], slots:'bad') = ห้ามถอย legacy
  //   เด็ดขาด — v1 ใช้เฉพาะ absent/null/undefined จริงเท่านั้น · malformed → specSlots=[] → ทุก row = unmapped
  const hasSpec = selectionSpec != null;

  // ★ รอบ 7 P0: ไม่มี SelectionSpec = เดิน algorithm + คืน shape v1 ของ HEAD เดิมทุก byte —
  //   slot ไม่มี field ใหม่ (refSlotId/resolvedBy) · status ใช้ 'no_expected_primary' แบบ HEAD ·
  //   counter นับแบบ HEAD เป๊ะ (changed รวมเคส expected หาย — คงพฤติกรรมเดิมไว้เพื่อ byte-parity
  //   เมื่อ switch off; การนับแบบ partition ที่ถูกต้องอยู่ฝั่ง v2 เมื่อมี spec เท่านั้น)
  if (!hasSpec) {
    const slots = finals.map((item) => {
      const finalSlot = String(item?.slot || '');
      const finalImageUrl = String(item?.imageUrl || '');
      const contractSlot = contractSlotForFinalSlot(finalSlot, refSlotContract);
      const expectedPlanRole = contractSlot?.legacySlot || legacyRoleForFinalSlot(finalSlot);
      const expected = plans.find((plan) => plan.role === expectedPlanRole) || null;
      const sourceByUrl = finalImageUrl ? plans.find((plan) => plan.imageUrl && plan.imageUrl === finalImageUrl) || null : null;
      const placedRole = cleanRole(placedBySlot.get(finalSlot)?.role, '') || null;
      const sourcePlanRole = sourceByUrl?.role || placedRole;
      const keptExpectedPrimary = !!(expected?.imageUrl && finalImageUrl && expected.imageUrl === finalImageUrl);
      let status = 'no_expected_primary';
      if (expected) status = keptExpectedPrimary
        ? 'kept_expected_primary'
        : (sourceByUrl ? 'reselected_other_primary' : 'reselected_backup_or_unknown');
      return {
        finalSlot,
        refRole: contractSlot?.refRole || null,
        expectedPlanRole: expectedPlanRole || null,
        expectedCandidateId: expected?.id || null,
        sourcePlanRole: sourcePlanRole || null,
        sourceCandidateId: sourceByUrl?.id || null,
        keptExpectedPrimary,
        status,
      };
    });
    return {
      v: 1,
      total: slots.length,
      keptExpectedPrimary: slots.filter((slot) => slot.keptExpectedPrimary).length,
      changedExpectedPrimary: slots.filter((slot) => slot.expectedPlanRole && !slot.keptExpectedPrimary).length,
      unknownExpected: slots.filter((slot) => !slot.expectedPlanRole).length,
      slots,
    };
  }

  const specSlots = Array.isArray(selectionSpec.slots) ? selectionSpec.slots : []; // malformed → [] (ทุก row unmapped)
  const specIdCount = new Map();
  for (const s of specSlots) {
    if (s?.composerSlotId) {
      const cid = String(s.composerSlotId);
      specIdCount.set(cid, (specIdCount.get(cid) || 0) + 1);
    }
  }
  const specByComposerId = new Map();
  for (const s of specSlots) {
    const cid = s?.composerSlotId ? String(s.composerSlotId) : null;
    if (cid && specIdCount.get(cid) === 1) specByComposerId.set(cid, s);
  }

  const _processedFinals = new Set(); // ★ รอบ 2 (P1-D): manifest row ซ้ำช่องเดิม — ห้ามนับ kept ซ้ำ
  const slots = finals.map((item) => {
    const finalSlot = String(item?.slot || '');
    const finalImageUrl = String(item?.imageUrl || '');
    const sourceByUrl = finalImageUrl ? plans.find((plan) => plan.imageUrl && plan.imageUrl === finalImageUrl) || null : null;
    const placedRole = cleanRole(placedBySlot.get(finalSlot)?.role, '') || null;
    const specSlot = specByComposerId.get(finalSlot) || null;
    if (specSlot && _processedFinals.has(finalSlot)) {
      // row ซ้ำของช่องที่ประมวลผลแล้ว → unmapped พร้อมป้ายซ้ำชัด (row แรกเท่านั้นที่นับจริง)
      return {
        finalSlot,
        refSlotId: specSlot.refSlotId || null,
        refRole: specSlot.refRole || null,
        expectedPlanRole: null,
        expectedCandidateId: null,
        sourcePlanRole: sourceByUrl?.role || placedRole || null,
        sourceCandidateId: sourceByUrl?.id || null,
        keptExpectedPrimary: false,
        status: 'unmapped',
        resolvedBy: 'selection_spec_duplicate_manifest',
      };
    }
    if (specSlot) _processedFinals.add(finalSlot);
    if (!specSlot) {
      // มี spec แล้วห้ามถอย legacy — ช่องนอกสัญญา/id ซ้ำ = unmapped เสมอ (P0-1 รอบ 5 คงครบ)
      // (completeness ของ "spec slot ที่หายจาก manifest" เติมหลังลูป — Checkpoint A)
      return {
        finalSlot,
        refSlotId: null,
        refRole: null,
        expectedPlanRole: null,
        expectedCandidateId: null,
        sourcePlanRole: sourceByUrl?.role || placedRole || null,
        sourceCandidateId: sourceByUrl?.id || null,
        keptExpectedPrimary: false,
        status: 'unmapped',
        resolvedBy: specIdCount.get(finalSlot) > 1 ? 'selection_spec_ambiguous' : 'selection_spec_unmapped',
      };
    }
    const expectedPlanRole = specSlot.legacySlot || null;
    const primary = specSlot.primary && specSlot.primary.candidateId && specSlot.primary.imageUrl ? specSlot.primary : null;
    const keptExpectedPrimary = !!(primary && finalImageUrl && primary.imageUrl === finalImageUrl);
    // spec บอก primary=null (เช่น circle ในแผน 4 ช่อง) → ภาพใดๆ ที่ลงช่องนี้ = missing ห้ามนับ kept
    let status;
    if (!primary) status = expectedPlanRole ? 'missing_expected' : 'unmapped';
    else if (keptExpectedPrimary) status = 'kept_expected_primary';
    else status = sourceByUrl ? 'reselected_other_primary' : 'reselected_backup_or_unknown';
    return {
      finalSlot,
      refSlotId: specSlot.refSlotId || null,
      refRole: specSlot.refRole || null,
      expectedPlanRole,
      expectedCandidateId: primary?.candidateId || null,
      sourcePlanRole: sourceByUrl?.role || placedRole || null,
      sourceCandidateId: sourceByUrl?.id || null,
      keptExpectedPrimary,
      status,
      resolvedBy: 'selection_spec',
    };
  });

  // ★ รอบ 3 (P1-2): spec มีตัวตนแต่ไร้ช่อง ({}, slots:[], slots:'bad') + manifest ว่าง —
  //   เดิมได้ trace v2 total0/partition ศูนย์ล้วน ซึ่งเครื่องอ่านภายนอกตีความว่า "ผ่าน" ได้
  //   → เติม sentinel unmapped 1 row (total1/unmapped1) ให้ spec พังมองเห็นเสมอ
  //   (spec ดี + manifest ว่าง ไม่เข้าเงื่อนไขนี้ — completeness ด้านล่างเติม missing ครบตามเดิม)
  if (specSlots.length === 0 && slots.length === 0) {
    slots.push({
      finalSlot: null,
      refSlotId: null,
      refRole: null,
      expectedPlanRole: null,
      expectedCandidateId: null,
      sourcePlanRole: null,
      sourceCandidateId: null,
      keptExpectedPrimary: false,
      status: 'unmapped',
      resolvedBy: 'selection_spec_invalid',
    });
  }

  // ★ Strict Renderer Checkpoint A: completeness — spec slot ที่ "ควรมี" แต่ไม่มี row ใน manifest เลย
  //   ต้องโผล่เป็น missing_expected (เดิม trace มองเฉพาะ row ที่ manifest มี = ช่องหายเงียบ)
  //   เฉพาะเส้นมี spec (v2) — เส้น legacy v1 คืนก่อนถึงจุดนี้ ไม่ถูกแตะ
  const _seenFinalSlots = new Set(finals.map((item) => String(item?.slot || '')));
  for (const s of specSlots) {
    const cid = s?.composerSlotId ? String(s.composerSlotId) : null;
    // ★ รอบ 2 (P1-D): mapping พัง (blank/ซ้ำ) + ไม่มี row ใน manifest — ห้ามหายเงียบเป็น total=0
    //   เติม missing พร้อม resolvedBy บอกสาเหตุ (validator ยัง reject spec แบบนี้อยู่แล้ว — นี่คือชั้น audit)
    let resolvedBy = 'selection_spec_missing_manifest';
    if (!cid) resolvedBy = 'selection_spec_invalid_mapping';
    else if (specIdCount.get(cid) !== 1) resolvedBy = 'selection_spec_ambiguous_mapping';
    if (cid && _seenFinalSlots.has(cid)) continue; // มี row จริงใน manifest แล้ว (รวมเคส ambiguous ที่ถูกฟ้องเป็น unmapped row)
    slots.push({
      finalSlot: cid,
      refSlotId: (s && s.refSlotId) || null,
      refRole: (s && s.refRole) || null,
      expectedPlanRole: (s && s.legacySlot) || null,
      expectedCandidateId: (s && s.primary && s.primary.candidateId) || null,
      sourcePlanRole: null,
      sourceCandidateId: null,
      keptExpectedPrimary: false,
      status: 'missing_expected',
      resolvedBy,
    });
  }

  const kept = slots.filter((slot) => slot.status === 'kept_expected_primary').length;
  const changed = slots.filter((slot) => slot.status === 'reselected_other_primary' || slot.status === 'reselected_backup_or_unknown').length;
  const missingExpected = slots.filter((slot) => slot.status === 'missing_expected').length;
  const unmapped = slots.filter((slot) => slot.status === 'unmapped').length;
  return {
    v: 2,
    total: slots.length,
    partition: { kept, changed, missingExpected, unmapped }, // invariant: รวมสี่ก้อน = total เสมอ
    keptExpectedPrimary: kept,       // ชื่อเดิม — ผู้บริโภค log ใน s7_wait ยังอ่านได้
    changedExpectedPrimary: changed, // แก้บั๊ก: ไม่รวม missing อีกต่อไป
    missingExpected,                 // ★ รอบ 4 P1: field ใหม่แยกชัด — "มีบทแต่แผนไม่มีภาพ"
    unknownExpected: unmapped,       // ★ รอบ 4 P1: คืนความหมาย legacy เดิม = เฉพาะ "หาบทไม่ได้" ห้ามรวม missing
    slots,
  };
}

// ---------- 🛡️ Strict Renderer — Checkpoint A: pure activation validator (11 ก.ค. 69) ----------
// ผู้ตัดสิน "เปิด strict render ได้ไหม" จาก SelectionSpec ล้วนๆ — pure 100%: ห้าม import/IO/env/time/random
// สัญญา 3 ทาง (คำสั่ง Codex):
//   · input ไม่มี own-property `selectionSpec` = งาน legacy แท้ → {decision:'legacy_absent', active:false, failClosed:false}
//   · มี property แต่ค่า/โครง/ความพร้อมไม่ผ่าน → {decision:'reject_invalid', active:false, failClosed:true, reasons[...]}
//     — ห้ามไหลลง legacy เงียบๆ เด็ดขาด (caller ต้อง hold/แจ้ง ไม่ใช่ประกอบต่อ)
//   · ครบทุกข้อ → {decision:'strict_ready', active:true, failClosed:false, authority: สำเนา normalized}
// kill switch อยู่ฝั่ง caller (บายพาสก่อนเรียก) — ฟังก์ชันนี้ห้ามอ่าน env เอง

const _srNonblank = (v) => typeof v === 'string' && v.trim().length > 0;
// ★ รอบ 2 (P1-C): plain object แท้เท่านั้น — prototype ต้องเป็น Object.prototype หรือ null
//   (Date/Map/Set/class instance = ไม่ใช่สัญญา ห้ามหลุดผ่าน)
const _srPlain = (v) => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

export function validateStrictRenderActivation(input = {}) {
  // ★ รอบ 2 (P1-B): เช็ค own-property ก่อนชนิด — array/function ที่ "พก" selectionSpec ห้ามได้ legacy_absent
  const hasOwnSpec = input != null && (typeof input === 'object' || typeof input === 'function')
    && Object.prototype.hasOwnProperty.call(input, 'selectionSpec');
  if (!hasOwnSpec) {
    return { decision: 'legacy_absent', active: false, failClosed: false, reasons: [] };
  }
  if (!_srPlain(input)) {
    return { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['input_not_plain_object'] };
  }
  const spec = input.selectionSpec;
  if (!_srPlain(spec)) {
    return { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['spec_not_plain_object'] };
  }
  const reasons = [];
  if (spec.v !== 1) reasons.push('bad_version');
  if (spec.mode !== 'ref_slot_exact') reasons.push('bad_mode');
  if (spec.source !== 'template.slots') reasons.push('bad_source');
  if (!_srNonblank(spec.refId)) reasons.push('missing_ref_id');
  if (spec.authorityStale === true) reasons.push('authority_stale');
  // ★ รอบ 2 (P1-C): ค่าครึ่งจริง ('true', 1, {}) = สัญญาเชื่อไม่ได้ — ยอมเฉพาะ true/false/undefined
  else if (spec.authorityStale !== undefined && spec.authorityStale !== false) reasons.push('authority_stale_invalid');
  if (spec.strictReady !== true) reasons.push('strict_ready_false');

  const slots = Array.isArray(spec.slots) ? spec.slots : null;
  if (!slots || slots.length < 3) {
    reasons.push('too_few_slots');
    return { decision: 'reject_invalid', active: false, failClosed: true, reasons };
  }

  // ── ราย slot: โหมด/ids/primary ครบและไม่ว่าง ──
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!_srPlain(s)) { reasons.push(`slot_not_object:${i}`); continue; }
    if (s.mappingMode !== 'ref_slot_exact') reasons.push(`slot_mapping_mode:${i}`);
    if (!_srNonblank(s.refSlotId)) reasons.push(`slot_ref_id_blank:${i}`);
    if (!_srNonblank(s.composerSlotId)) reasons.push(`slot_composer_id_blank:${i}`);
    const p = s.primary;
    if (!_srPlain(p) || !_srNonblank(p.candidateId) || !_srNonblank(p.imageUrl)) reasons.push(`primary_invalid:${i}`);
    // ★ รอบ 2 (P1-C) + รอบ 3 (P1-1): shape ต้องเป็น enum จริงของระบบ ('rect'|'circle' — ref library มีสองแบบเท่านั้น)
    //   garbage/object/BigInt/cyclic = reject ไม่ throw · การเทียบกับ realized อยู่ท่อน realized ด้านล่าง
    if (s.shape !== 'rect' && s.shape !== 'circle') reasons.push(`slot_shape_invalid:${i}`);
  }

  // ── uniqueness ──
  const refIds = slots.map((s) => s?.refSlotId).filter(_srNonblank);
  const compIds = slots.map((s) => s?.composerSlotId).filter(_srNonblank);
  const primIds = slots.map((s) => s?.primary?.candidateId).filter(_srNonblank);
  const primUrls = slots.map((s) => s?.primary?.imageUrl).filter(_srNonblank);
  if (new Set(refIds).size !== refIds.length) reasons.push('dup_ref_slot_id');
  if (new Set(compIds).size !== compIds.length) reasons.push('dup_composer_slot_id');
  if (new Set(primIds).size !== primIds.length) reasons.push('dup_primary_candidate');
  if (new Set(primUrls).size !== primUrls.length) reasons.push('dup_primary_url');

  // ── counts ต้อง "คำนวณซ้ำแล้วตรง" — กัน counts ปลอมที่ไม่สะท้อน slots จริง ──
  const c = _srPlain(spec.counts) ? spec.counts : {};
  const expectCounts = {
    total: slots.length,
    mapped: slots.length,
    unmapped: 0,
    missingPrimary: 0,
    duplicatePrimary: 0,
    duplicatePrimaryUrl: 0,
    semanticFallback: 0,
  };
  for (const k of Object.keys(expectCounts)) {
    if (c[k] !== expectCounts[k]) reasons.push(`counts_mismatch:${k}`);
  }

  // ── diagnostics = ชั้น fail-closed ที่ hash "ไม่ได้ผูก" — ต้องมีตัวตน+shape ครบเสมอ ห้ามหาย
  //   (★ P0 Codex reproduce: forge strictReady=true + delete diagnostics เคยหลุดเป็น strict_ready —
  //    เดิม field หายถูกมองว่าสะอาด) · duplicateBackupsDropped = sanitation ยอม nonempty ได้
  //   แต่ต้องเป็น array จริง และ backup ที่เหลือยังถูกตรวจเต็มด้านล่าง ──
  const d = spec.diagnostics;
  if (!_srPlain(d)) {
    reasons.push('diagnostics_not_object');
  } else {
    for (const f of ['extraPlannedKeys', 'invalidPrimary', 'aliasPrimaryUrls', 'duplicateBackupsDropped']) {
      if (!Array.isArray(d[f])) reasons.push(`diagnostics_malformed:${f}`);
    }
    if (Array.isArray(d.extraPlannedKeys) && d.extraPlannedKeys.length > 0) reasons.push('diagnostics_blocking:extraPlannedKeys');
    if (Array.isArray(d.invalidPrimary) && d.invalidPrimary.length > 0) reasons.push('diagnostics_blocking:invalidPrimary');
    if (Array.isArray(d.aliasPrimaryUrls) && d.aliasPrimaryUrls.length > 0) reasons.push('diagnostics_blocking:aliasPrimaryUrls');
    if (d.missingRefId === true) reasons.push('diagnostics_blocking:missingRefId');
    // ★ รอบ 3 (P1-3): ยอมเฉพาะ absent/false (ค่าจริงจาก builder) — ครึ่งจริง ('true',1,{},null) = เชื่อไม่ได้
    else if (d.missingRefId !== undefined && d.missingRefId !== false) reasons.push('diagnostics_malformed:missingRefId');
  }

  // ── backups: ครบ/ไม่ว่าง + unique ข้าม owner + ห้ามชน primary ทั้ง id และ URL ──
  const primIdSet = new Set(primIds);
  const primUrlSet = new Set(primUrls);
  const bkIds = new Set();
  const bkUrls = new Set();
  for (let i = 0; i < slots.length; i++) {
    const bks = slots[i]?.backups;
    // ★ รอบ 2 (P1-C): backups ต้องเป็น array จริงทุกช่อง — missing/null/ชนิดผิด = reject (builder ให้ [] เสมอ)
    if (!Array.isArray(bks)) { reasons.push(`backups_not_array:${i}`); continue; }
    for (const b of bks) {
      if (!_srPlain(b) || !_srNonblank(b.candidateId) || !_srNonblank(b.imageUrl)) { reasons.push(`backup_invalid:${i}`); continue; }
      if (primIdSet.has(b.candidateId) || primUrlSet.has(b.imageUrl)) { reasons.push(`backup_collides_primary:${i}`); continue; }
      if (bkIds.has(b.candidateId) || bkUrls.has(b.imageUrl)) { reasons.push(`backup_dup_across_owners:${i}`); continue; }
      bkIds.add(b.candidateId);
      bkUrls.add(b.imageUrl);
    }
  }

  // ── recompute hashes ด้วย algorithm เดิมของ exact branch — จับ tamper ราย candidate/URL/backup ──
  // ★ รอบ 2 (P1-C): กัน throw จาก BigInt/cyclic — ค่าที่ไม่ใช่ string ถูกลดเป็น null ก่อน stringify
  //   (spec จริงจาก builder เป็น string ล้วน → hash ตรงเดิม 100% · ค่าเพี้ยน → hash ไม่ตรง = reject ปกติ)
  const _str = (v) => (typeof v === 'string' ? v : null);
  const identity = slots.map((s) => [_str(s?.refSlotId), _str(s?.composerSlotId), _str(s?.primary?.candidateId)]);
  const wantSpecHash = fnv1a32(JSON.stringify({ refId: _str(spec.refId), identity }));
  const wantBackupPoolHash = fnv1a32(JSON.stringify(slots.map((s) => [_str(s?.refSlotId), (Array.isArray(s?.backups) ? s.backups : []).map((b) => _str(b?.candidateId))])));
  const wantReplayHash = fnv1a32(JSON.stringify({
    refId: _str(spec.refId),
    identity,
    urls: slots.map((s) => _str(s?.primary?.imageUrl)),
    backups: slots.map((s) => [_str(s?.refSlotId), (Array.isArray(s?.backups) ? s.backups : []).map((b) => [_str(b?.candidateId), _str(b?.imageUrl)])]),
  }));
  if (spec.specHash !== wantSpecHash) reasons.push('spec_hash_mismatch');
  if (spec.backupPoolHash !== wantBackupPoolHash) reasons.push('backup_pool_hash_mismatch');
  if (spec.replayHash !== wantReplayHash) reasons.push('replay_hash_mismatch');

  // ── realized template: ids ไม่ว่าง/unique และเป็นเซ็ตเดียวกันเป๊ะกับ composerSlotId — ขาด/เกิน/เปลี่ยนชื่อ = reject ──
  const rt = input.realizedTemplate;
  const rtSlots = _srPlain(rt) && Array.isArray(rt.slots) ? rt.slots : null;
  if (!rtSlots) {
    reasons.push('realized_missing');
  } else {
    const rtIds = rtSlots.map((s) => (s && s.id != null ? String(s.id) : ''));
    if (!rtIds.every(_srNonblank)) reasons.push('realized_ids_invalid');
    else if (new Set(rtIds).size !== rtIds.length) reasons.push('realized_ids_duplicate');
    else {
      const want = new Set(compIds);
      const got = new Set(rtIds);
      const sameAll = want.size === got.size && compIds.length === rtIds.length && [...want].every((id) => got.has(id));
      if (!sameAll) reasons.push('realized_set_mismatch');
      // ★ รอบ 3 (P1-1): hash ไม่ผูก shape — เปลี่ยน circle→rect เคยหลุด strict_ready ทั้งที่ authority แบกค่าปลอม
      //   ต้องเทียบกับ realized ของจริงราย composerSlotId · canonical ฝั่ง realized:
      //   dnaToTemplateSpec ใส่ shape เฉพาะ circle (rect ไม่มี property) → shape==='circle' ? 'circle' : 'rect'
      const rtShapeById = new Map(rtSlots.map((r) => [String(r?.id ?? ''), r?.shape === 'circle' ? 'circle' : 'rect']));
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const cid = s?.composerSlotId;
        // enum พัง/ id ว่าง = ฟ้องไปแล้วข้างบน — ไม่เทียบซ้ำ (กัน reason เบิ้ลต่อ defect เดียว)
        if (!_srNonblank(cid) || (s?.shape !== 'rect' && s?.shape !== 'circle')) continue;
        const wantShape = rtShapeById.get(cid);
        if (wantShape !== undefined && s.shape !== wantShape) reasons.push(`shape_mismatch:${i}`);
      }
    }
  }

  if (reasons.length) {
    return { decision: 'reject_invalid', active: false, failClosed: true, reasons };
  }
  // ผ่านครบ → authority normalized (สำเนาลึก — กัน caller mutate ย้อนเข้าสัญญา)
  const authority = JSON.parse(JSON.stringify({
    refId: spec.refId,
    specHash: spec.specHash,
    backupPoolHash: spec.backupPoolHash,
    replayHash: spec.replayHash,
    slots: slots.map((s) => ({
      refSlotId: s.refSlotId,
      composerSlotId: s.composerSlotId,
      shape: s.shape ?? null,
      primary: { candidateId: s.primary.candidateId, imageUrl: s.primary.imageUrl },
      backups: (Array.isArray(s.backups) ? s.backups : []).map((b) => ({ candidateId: b.candidateId, imageUrl: b.imageUrl })),
    })),
  }));
  return { decision: 'strict_ready', active: true, failClosed: false, reasons: [], authority };
}

// ---------- 📜 SelectionSpec v1 (Codex ตรวจรอบ 2 ข้อ 2-5 — 10 ก.ค. 69) ----------
// สัญญา "S6 เลือกภาพไหน → ต้องลงช่องไหนของ realized template" สร้างที่ S7 ก่อนเรียก composer
// shadow/additive ล้วน (ยังไม่มีผู้บริโภคฝั่งประกอบ) · pure เหมือนทั้งไฟล์: ห้าม import/IO/random
// realizedTemplate = ผลจริงจาก dnaToTemplateSpec(refDNA) — ผู้เรียกส่งเข้ามา (คงความ pure ของไฟล์นี้)

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * จับคู่ contract slot (จาก DNA ต้นทาง ลำดับ dna.template.slots) ↔ realized template slot
 * ทางหลัก: จำนวนเท่ากัน → map ตามลำดับ (dnaToTemplateSpec คงลำดับต้นทางเสมอ แค่ซ่อม geometry/ตั้ง id)
 * ทางสำรอง (realized ตัดช่องทิ้ง → จำนวนไม่เท่า): จับ shape ตรงกันที่จุดศูนย์กลางใกล้สุด (deterministic)
 * คืน array ยาวเท่า contractSlots — ค่า null = unmapped
 */
function mapContractToRealized(contractSlots, realizedTemplate) {
  const realized = Array.isArray(realizedTemplate?.slots) ? realizedTemplate.slots : [];
  if (!realized.length) return contractSlots.map(() => null);
  if (realized.length === contractSlots.length) return realized.map((r) => String(r.id));
  const W = Number(realizedTemplate?.canvasW) || 1080;
  const H = Number(realizedTemplate?.canvasH) || 1350;
  const taken = new Set();
  return contractSlots.map((cs) => {
    const g = cs.geometry;
    if (!g) return null;
    const cx = g.xPct + g.wPct / 2;
    const cy = g.yPct + g.hPct / 2;
    let best = null;
    let bestD = Infinity;
    for (const r of realized) {
      if (taken.has(String(r.id))) continue;
      const isCircleR = String(r.shape || '') === 'circle' || /^circle/.test(String(r.id));
      if (isCircleR !== (cs.shape === 'circle')) continue;
      const px = (Number(r.x) || 0) / W * 100;
      const py = (Number(r.y) || 0) / H * 100;
      const pw = (Number(r.w) || 0) / W * 100;
      const ph = (Number(r.h) || 0) / H * 100;
      const d = Math.abs(px + pw / 2 - cx) + Math.abs(py + ph / 2 - cy);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best || bestD > 30) return null; // ไกลเกิน = ช่องนี้ถูก realized ตัดทิ้งจริง
    taken.add(String(best.id));
    return String(best.id);
  });
}

// ★ Codex ตรวจรอบ 3 ข้อ 1: จับคู่ "ภาพที่ S6 เลือก" กับช่องด้วยความหมายของบท ไม่ใช่ตำแหน่ง —
//   วงกลมต้องกิน plannedSlots.circle เท่านั้น (แผนไม่มี circle = primary ว่าง เปิดโปงตรงๆ ห้ามยืมบทอื่น)
//   root cause ฝั่ง S6 (SLOT_ORDER.slice ตาม panelCount ทำ circle หายจากแผน 4 ช่อง) = งาน batch
//   semantic-selection ถัดไปภายใต้ kill switch — batch นี้ห้ามแตะ S6 จริง
const LEGACY_RECT_ROLES = ['hero', 'reaction', 'action', 'context'];

// ★ รอบ 4 P0: คืนทั้ง key และ mappingMode — fallback เชิงตำแหน่งต้องถูกป้ายชื่อชัด ห้ามปลอมเป็นบทแท้
//   exact_role/circle_exact = บทแท้ · legacy_fallback = join ชั่วคราวกับแผนตำแหน่ง (strictReady ต้อง false)
function planKeyFor(cs, usedKeys) {
  if (cs.shape === 'circle') {
    return usedKeys.has('circle') ? { key: null, mode: 'unmapped' } : { key: 'circle', mode: 'circle_exact' }; // วงกลม = บท circle เท่านั้น
  }
  if (LEGACY_RECT_ROLES.includes(cs.refRole) && !usedKeys.has(cs.refRole)) return { key: cs.refRole, mode: 'exact_role' }; // บทตรงชื่อ
  // บทนอกคลังศัพท์ S6 (victim/evidence/moment-rect/pair): fallback deterministic เพื่อ join กับแผนปัจจุบัน —
  // ใช้ตำแหน่งเดิมก่อน (เฉพาะบท rect ที่ยังว่าง) แล้วค่อยไล่ตามลำดับ SLOT_ORDER (ห้ามหยิบ 'circle' เด็ดขาด)
  if (LEGACY_RECT_ROLES.includes(cs.legacySlot) && !usedKeys.has(cs.legacySlot)) return { key: cs.legacySlot, mode: 'legacy_fallback' };
  const free = LEGACY_RECT_ROLES.find((r) => !usedKeys.has(r));
  return free ? { key: free, mode: 'legacy_fallback' } : { key: null, mode: 'unmapped' };
}

/**
 * SelectionSpec v1 — ต่อช่อง: refSlotId (unique จาก contract) + composerSlotId (unique จาก realized)
 * + sourceIndex/refRole/legacySlot(บทแผน S6 เชิงความหมาย) + primary {candidateId, imageUrl} + backups
 * + specHash = identity mapping ล้วน (refSlotId+composerSlotId+candidateId — ไม่ผูก URL ชั่วคราว)
 * + replayHash = identity + URL (ไว้เช็คว่าไฟล์จริงเปลี่ยนไหม — คนละหน้าที่กับ specHash)
 */
export function buildSelectionSpec({ contract = null, realizedTemplate = null, plannedSlots = {}, backups = [], refId = null, plannedByRefSlot = undefined, authorityStale = false } = {}) {
  const contractSlots = Array.isArray(contract?.slots) ? contract.slots : [];
  const plans = plannedSlots && typeof plannedSlots === 'object' ? plannedSlots : {};
  const composerIds = mapContractToRealized(contractSlots, realizedTemplate);

  // ══════════ ★ SEM-2 (Codex): exact-authority branch — plannedByRefSlot ══════════
  // param "ไม่มี" (undefined/ไม่ใช่ object) = legacy branch เดิมทั้งอัลกอริทึม/เอาต์พุตด้านล่าง byte เดิม
  // param เป็น object (รวม {}) = exact เท่านั้น: lookup ด้วย cs.id ตรงตัว — ห้ามเรียก planKeyFor
  // ห้าม fallback generic/positional ทุกกรณี · semanticFallback = 0 เสมอในโหมดนี้
  if (plannedByRefSlot && typeof plannedByRefSlot === 'object' && !Array.isArray(plannedByRefSlot)) {
    const diagnostics = { extraPlannedKeys: [], invalidPrimary: [], duplicateBackupsDropped: [] };
    const idSet = new Set(contractSlots.map((s) => s.id));
    for (const k of Object.keys(plannedByRefSlot)) {
      if (!idSet.has(k)) diagnostics.extraPlannedKeys.push(k); // stale/extra authority keys — additive report
    }
    // ★ SEM-2 audit B: exact strict ต้องมี ref identity จริง — null/ว่าง/ช่องว่างล้วน = ไม่ ready (legacy ไม่แตะ)
    const _refIdOk = refId != null && String(refId).trim().length > 0;
    if (!_refIdOk) diagnostics.missingRefId = true;
    // pass 1: primaries ก่อน (ต้องรู้ครบทั้งสัญญา เพื่อกัน backup ชน primary ข้ามช่อง — audit E)
    const _prims = contractSlots.map((cs) => {
      const e = plannedByRefSlot[cs.id];
      if (e == null) return null;
      const cid = e.candidateId == null ? null : String(e.candidateId);
      const url = String(e.imageUrl || '');
      if (cid && url) return { candidateId: cid, imageUrl: url };
      diagnostics.invalidPrimary.push(cs.id); // มี entry แต่ id/URL ไม่ครบ = ใช้ไม่ได้ (นับ missing)
      return null;
    });
    const _primIdSet = new Set(_prims.filter(Boolean).map((p) => p.candidateId));
    const _primUrlSet = new Set(_prims.filter(Boolean).map((p) => p.imageUrl));
    // pass 2: backups — drop deterministic สองเหตุ (ระบุ reason ชัด):
    //   collides_primary = ชน primary ใดๆ ทั้งสัญญา (id หรือ URL) — ห้ามคง backup ที่ซ้ำ primary
    //   duplicate_across_owners = ซ้ำ backup ช่องก่อนหน้า (contract order → owner แรกชนะ)
    const _bkIds = new Set();
    const _bkUrls = new Set();
    const slots = contractSlots.map((cs, i) => {
      const e = plannedByRefSlot[cs.id];
      const primary = _prims[i];
      const bks = [];
      for (const b of (e?.backups || [])) {
        const cid = b?.candidateId == null ? null : String(b.candidateId);
        const url = String(b?.imageUrl || '');
        if (!cid || !url) continue;
        if (_primIdSet.has(cid) || _primUrlSet.has(url)) {
          diagnostics.duplicateBackupsDropped.push({ candidateId: cid, imageUrl: url, droppedFromOwner: cs.id, reason: 'collides_primary' });
          continue;
        }
        if (_bkIds.has(cid) || _bkUrls.has(url)) {
          diagnostics.duplicateBackupsDropped.push({ candidateId: cid, imageUrl: url, droppedFromOwner: cs.id, reason: 'duplicate_across_owners' });
          continue;
        }
        _bkIds.add(cid);
        _bkUrls.add(url);
        bks.push({ candidateId: cid, imageUrl: url });
      }
      return {
        refSlotId: cs.id,
        composerSlotId: composerIds[i],
        sourceIndex: cs.sourceIndex,
        refRole: cs.refRole,
        legacySlot: e?.legacySlot ?? null, // display/compat เท่านั้น — ไม่ใช่ authority และไม่เข้า specHash
        mappingMode: 'ref_slot_exact',
        shape: cs.shape,
        primary,
        backups: bks, // ผูกช่องของตัวเองเท่านั้น (ไม่มีพูลกลาง)
      };
    });
    const mapped = slots.filter((s) => s.composerSlotId).length;
    const missingPrimary = slots.filter((s) => !s.primary).length;
    const refIdsUnique = new Set(slots.map((s) => s.refSlotId)).size === slots.length;
    const compIds = slots.map((s) => s.composerSlotId).filter(Boolean);
    const compIdsUnique = new Set(compIds).size === compIds.length;
    const primIds = slots.map((s) => s.primary?.candidateId).filter(Boolean);
    const duplicatePrimary = primIds.length - new Set(primIds).size;
    // ★ SEM-2 P2 (Codex): primary URL alias — คนละ candidateId แต่ไฟล์เดียวกันข้ามช่อง = ไม่ ready
    //   นับเฉพาะ id "ต่างกัน" ที่ชน URL เดียว (คู่ที่ id ซ้ำอยู่แล้วถูกนับใน duplicatePrimary — ห้ามนับซ้ำ)
    const _primUrlGroups = new Map();
    for (const s of slots) {
      const p = s.primary;
      if (!p) continue;
      if (!_primUrlGroups.has(p.imageUrl)) _primUrlGroups.set(p.imageUrl, new Set());
      _primUrlGroups.get(p.imageUrl).add(p.candidateId);
    }
    let duplicatePrimaryUrl = 0;
    const aliasPrimaryUrls = [];
    for (const [url, ids] of _primUrlGroups) {
      if (ids.size > 1) {
        duplicatePrimaryUrl += ids.size - 1;
        aliasPrimaryUrls.push({ imageUrl: url, candidateIds: [...ids] });
      }
    }
    diagnostics.aliasPrimaryUrls = aliasPrimaryUrls;
    // specHash = primary identity + composer mapping ตาม contract order เท่านั้น (backup/legacySlot/extras ห้ามขยับ hash
    //   — invariant: readiness/diagnostics เป็นผู้ปิด fail-closed ไม่ใช่ hash)
    const identity = slots.map((s) => [s.refSlotId, s.composerSlotId, s.primary?.candidateId || null]);
    const specHash = fnv1a32(JSON.stringify({ refId: refId || null, identity }));
    const backupPoolHash = fnv1a32(JSON.stringify(slots.map((s) => [s.refSlotId, s.backups.map((b) => b.candidateId)])));
    const replayHash = fnv1a32(JSON.stringify({
      refId: refId || null,
      identity,
      urls: slots.map((s) => s.primary?.imageUrl || null),
      backups: slots.map((s) => [s.refSlotId, s.backups.map((b) => [b.candidateId, b.imageUrl])]),
    }));
    return {
      v: 1,
      refId: refId || null,
      source: contract?.source || null,
      mode: 'ref_slot_exact',
      specHash,
      backupPoolHash,
      replayHash,
      // fail-closed: ขาด/ซ้ำ (ทั้ง id และ URL alias)/ไม่ครบ/key เกินสัญญา/authority เก่า = strictReady=false
      //   — ห้ามถอย legacy join เด็ดขาด (★ SEM-2 P1: extraPlannedKeys > 0 ก็ต้องไม่ ready)
      strictReady: contractSlots.length > 0 && mapped === slots.length && refIdsUnique && compIdsUnique
        && missingPrimary === 0 && duplicatePrimary === 0 && duplicatePrimaryUrl === 0
        && diagnostics.invalidPrimary.length === 0 && diagnostics.extraPlannedKeys.length === 0
        && _refIdOk && !authorityStale, // ★ audit B: ไร้ ref identity = ห้าม ready
      counts: { total: slots.length, mapped, unmapped: slots.length - mapped, missingPrimary, duplicatePrimary, duplicatePrimaryUrl, semanticFallback: 0 },
      diagnostics,
      ...(authorityStale ? { authorityStale: true } : {}),
      slots,
    };
  }
  // ══════════ (จบ exact branch — ด้านล่าง = legacy เดิม byte-parity) ══════════
  // ★ รอบ 3 ข้อ 4: dedupe สำรองแบบ deterministic (candidateId แรกชนะ ตามลำดับที่ส่งเข้ามา)
  const _seenBk = new Set();
  const backupList = (Array.isArray(backups) ? backups : [])
    .map((b) => ({ candidateId: b?.candidateId == null ? null : String(b.candidateId), imageUrl: String(b?.imageUrl || '') }))
    .filter((b) => {
      if (!b.candidateId || !b.imageUrl || _seenBk.has(b.candidateId)) return false;
      _seenBk.add(b.candidateId);
      return true;
    });
  const usedKeys = new Set();
  const slots = contractSlots.map((cs, i) => {
    const pk = planKeyFor(cs, usedKeys);
    if (pk.key) usedKeys.add(pk.key);
    const planned = pk.key ? plans[pk.key] : null;
    const primary = planned && (planned.id != null || planned.imageUrl) ? {
      candidateId: planned.id == null ? null : String(planned.id),
      imageUrl: String(planned.imageUrl || ''),
    } : null;
    return {
      refSlotId: cs.id,
      composerSlotId: composerIds[i], // null = unmapped (realized ตัดช่อง/จับคู่ไม่ได้ — ห้ามเดา)
      sourceIndex: cs.sourceIndex,
      refRole: cs.refRole,
      legacySlot: pk.key, // บทในแผน S6 ที่ join เชิงความหมาย (null = ไม่มีบทให้ join — เปิดโปงตรงๆ)
      mappingMode: pk.mode, // ★ รอบ 4 P0: exact_role | circle_exact | legacy_fallback | unmapped
      shape: cs.shape,
      primary, // null = missingPrimary (S6 ไม่ได้วางภาพให้บทนี้ เช่น circle ในแผน 4 ช่อง)
      backups: backupList, // v1: พูลสำรองกลางที่ส่งเข้าโรงประกอบจริง (role-based pool = งานขั้นถัดไป)
    };
  });
  const mapped = slots.filter((s) => s.composerSlotId).length;
  const missingPrimary = slots.filter((s) => !(s.primary && s.primary.candidateId && s.primary.imageUrl)).length;
  const refIdsUnique = new Set(slots.map((s) => s.refSlotId)).size === slots.length;
  const compIds = slots.map((s) => s.composerSlotId).filter(Boolean);
  const compIdsUnique = new Set(compIds).size === compIds.length;
  const primIds = slots.map((s) => s.primary?.candidateId).filter(Boolean);
  const duplicatePrimary = primIds.length - new Set(primIds).size;
  const semanticFallback = slots.filter((s) => s.mappingMode === 'legacy_fallback').length;
  const unmappedPlanKey = slots.filter((s) => s.mappingMode === 'unmapped').length;
  // ★ รอบ 4 (ผู้ตรวจอิสระยืนยัน): specHash = committed primary assignment ล้วน — ห้ามผูก backup pool
  //   (strict ห้ามใช้ backup อยู่แล้ว — พูลสำรองเปลี่ยนต้องไม่ทำให้ตัวตนของแผนเปลี่ยน)
  const identity = slots.map((s) => [s.refSlotId, s.composerSlotId, s.primary?.candidateId || null]);
  const specHash = fnv1a32(JSON.stringify({ refId: refId || null, identity }));
  const backupPoolHash = fnv1a32(JSON.stringify(backupList.map((b) => b.candidateId)));
  const replayHash = fnv1a32(JSON.stringify({
    refId: refId || null,
    identity,
    urls: slots.map((s) => s.primary?.imageUrl || null),
    backups: backupList.map((b) => [b.candidateId, b.imageUrl]),
  }));
  return {
    v: 1,
    refId: refId || null,
    source: contract?.source || null,
    specHash,       // ตัวตนของ "แผนภาพหลักที่ commit แล้ว" เท่านั้น
    backupPoolHash, // ตัวตนของพูลสำรอง (แยกหน้าที่ — เปลี่ยนได้โดย specHash ไม่ขยับ)
    replayHash,     // identity + URL จริงทั้งหมด (เช็คไฟล์/พูลเปลี่ยนสำหรับ replay)
    // ★ รอบ 4 P0: strictReady ต้องบทแท้ล้วน — มี legacy_fallback/unmapped แม้ช่องเดียว = false
    //   (จนกว่า batch semantic-selection จะทำให้ S6 ผลิตบท exact ได้จริง)
    strictReady: contractSlots.length > 0 && mapped === slots.length && refIdsUnique && compIdsUnique
      && missingPrimary === 0 && duplicatePrimary === 0 && semanticFallback === 0 && unmappedPlanKey === 0,
    counts: { total: slots.length, mapped, unmapped: slots.length - mapped, missingPrimary, duplicatePrimary, semanticFallback },
    slots,
  };
}
