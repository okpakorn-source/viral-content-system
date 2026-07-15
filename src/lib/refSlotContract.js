// Ref-slot contract for MEGA shadow diagnostics.
// Pure by design: no imports, IO, time, random, or environment reads.
// (Enforced by scripts/test-ref-slot-contract.mjs: the source must contain no
//  import or require call, no environment reads, no filesystem or network IO,
//  and no time or randomness.) The WAVE1C SelectionAuthority + SelectionSpec-v2
//  layer at the bottom computes REAL SHA-256 via a self-contained pure
//  implementation, and hardens against hostile input with descriptor-first
//  capture (no external Proxy-detection dependency).

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

function nonBlank(value) {
  const s = String(value ?? '').trim();
  return s.length ? s : null;
}

// ★ D3-B1.3 (Codex P1): normalize template slot role "จุดเดียว" ใช้ทั้ง matcher + emitted view + diagnostics —
//   role ว่าง/whitespace → ถอยไป id ที่ nonblank → สุดท้าย slot_N (กันเคส {role:'', id:'hero'} matcher เห็น
//   slot_1 แต่ view เห็น hero = เสีย semantic fallback/provenance)
function templateSlotRole(slot, index) {
  const fromRole = cleanRole(slot?.role, '');
  if (fromRole) return fromRole;
  const fromId = cleanRole(slot?.id, '');
  if (fromId) return fromId;
  return `slot_${index + 1}`;
}

function uniqueId(base, counts) {
  const next = (counts.get(base) || 0) + 1;
  counts.set(base, next);
  return next === 1 ? base : `${base}_${next}`;
}

// ★ D3-B1.1: main↔hero = family เดียวสำหรับ "alias fallback" (exact-first เสมอ)
function heroFamily(role) {
  return role === 'hero' || role === 'main';
}

// ★ D3-B1.1 (Codex P1-1/P1-2): จับคู่ DNA→template แบบ 2 pass, ห้าม reuse, exact ก่อน alias เสมอ
//   pass1: exact normalized role, nth template-role ↔ nth DNA same-role (FIFO queue ต่อ role)
//   pass2: เฉพาะ template ที่ยัง unmatched + role อยู่ family hero → หยิบ DNA family ที่เหลือ (index order)
//   คืน match[templateIndex] = { semanticIndex, aliasUsed } | null · usedDna set (deterministic, no reuse)
function resolveSemanticMatches(templateSlots, semanticSlots) {
  const tRoles = templateSlots.map((t, i) => templateSlotRole(t, i)); // ★ D3-B1.3: role เดียวกับ emitted view เป๊ะ
  const sRoles = semanticSlots.map((s, i) => cleanRole(s?.role, `slot_${i + 1}`));
  const usedDna = new Set();
  const match = new Array(templateSlots.length).fill(null);
  // pass1 — exact role FIFO (nth-to-nth)
  const exactQueue = new Map();
  sRoles.forEach((r, i) => { if (!exactQueue.has(r)) exactQueue.set(r, []); exactQueue.get(r).push(i); });
  tRoles.forEach((r, ti) => {
    const q = exactQueue.get(r);
    if (q && q.length) { const di = q.shift(); usedDna.add(di); match[ti] = { semanticIndex: di, aliasUsed: false }; }
  });
  // pass2 — hero-family alias เฉพาะ template ที่ยัง unmatched (ห้าม pool ก่อน exact)
  const remainingHeroDna = sRoles.map((r, i) => ({ r, i })).filter((x) => !usedDna.has(x.i) && heroFamily(x.r)).map((x) => x.i);
  let hp = 0;
  tRoles.forEach((r, ti) => {
    if (match[ti] || !heroFamily(r)) return;
    if (hp < remainingHeroDna.length) { const di = remainingHeroDna[hp++]; usedDna.add(di); match[ti] = { semanticIndex: di, aliasUsed: true }; }
  });
  return { match, usedDna };
}

// ★ D3-B1.1/B1.2 (Codex P1-2): จับ order→template slot แบบ preassign no-reuse + provenance
//   passA: exact index+role (exact_index) · passB: exact role FIFO (exact_role) · passC: hero-family (hero_alias)
//   คืน entries[vi] = { order, orderIndex, orderRole, matchMode } | null + unusedOrderIndices (deterministic)
function preassignOrders(views, orders) {
  const list = Array.isArray(orders) ? orders : [];
  const usedOrder = new Set();
  const entries = new Array(views.length).fill(null);
  const takeEntry = (vi, matchMode, predicate) => {
    for (let i = 0; i < list.length; i++) {
      if (usedOrder.has(i)) continue;
      if (predicate(list[i])) {
        usedOrder.add(i);
        entries[vi] = { order: list[i], orderIndex: i, orderRole: cleanRole(list[i]?.role, '') || null, matchMode };
        return;
      }
    }
  };
  views.forEach((v, vi) => takeEntry(vi, 'exact_index', (o) => Number(o?.i) === v.index && cleanRole(o?.role, '') === v.role));
  views.forEach((v, vi) => { if (!entries[vi]) takeEntry(vi, 'exact_role', (o) => cleanRole(o?.role, '') === v.role); });
  views.forEach((v, vi) => { if (!entries[vi] && heroFamily(v.role)) takeEntry(vi, 'hero_alias', (o) => heroFamily(cleanRole(o?.role, ''))); });
  const unusedOrderIndices = list.map((o, i) => i).filter((i) => !usedOrder.has(i));
  return { entries, unusedOrderIndices };
}

/**
 * ★ D3-B1 PURE resolver — no imports/IO/time/random/env.
 * template.slots = axis (order/count/role/shape/geometry/pos). DNA semantic merged by
 * normalized role + occurrence (nth-to-nth) เท่านั้น + main↔hero alias เมื่อ exact ไม่พอ — ห้าม array index,
 * ห้าม reuse DNA slot ซ้ำ · shot: template nonblank ชนะ · same-role DNA shot = fallback เมื่อ template ว่าง ·
 * ไม่มีทั้งคู่ = null · subject: template ก่อน มิฉะนั้น same-role DNA · emotion/facing/desc: same-role DNA (ไม่ cross-role)
 * · faceSizePct: template ก่อน DNA · DNA-only role = ไม่สร้าง slot · template-only role = อยู่+semantic null
 * คืน provenance/aliasUsed/diagnostics deterministic.
 * @param {'legacy'|'template_v1'} opts.mode
 */
export function resolveRefSlotView(refDNA = null, { mode = 'legacy' } = {}) {
  const dna = refDNA && typeof refDNA === 'object' ? refDNA : {};
  const templateSlots = Array.isArray(dna.template?.slots) ? dna.template.slots : [];
  const semanticSlots = Array.isArray(dna.slots) ? dna.slots : [];

  if (mode !== 'template_v1') {
    // legacy view = สะท้อน cascade ของ buildRefSlotContract (สำหรับ diagnostics/parity เท่านั้น)
    let source = 'legacy';
    let rawSlots = [];
    if (templateSlots.length) { source = 'template.slots'; rawSlots = templateSlots.map((slot, index) => ({ ...(semanticSlots[index] || {}), ...slot })); }
    else if (semanticSlots.length) { source = 'slots'; rawSlots = semanticSlots.map((slot) => ({ ...slot })); }
    const views = rawSlots.map((raw, index) => ({
      index,
      role: cleanRole(raw?.role || raw?.id, `slot_${index + 1}`),
      shape: cleanRole(raw?.shape, cleanRole(raw?.role || raw?.id, `slot_${index + 1}`) === 'circle' ? 'circle' : 'rect'),
      pos: nonBlank(raw?.pos),
      geometry: geometryOf(raw),
      faceSizePct: Number(raw?.faceSizePct) || null,
      shot: nonBlank(raw?.shot),
      shotProvenance: nonBlank(raw?.shot) ? 'raw' : 'none',
      subject: nonBlank(raw?.subject),
      subjectProvenance: nonBlank(raw?.subject) ? 'raw' : 'none',
      emotion: nonBlank(raw?.emotion),
      facing: nonBlank(raw?.facing),
      desc: nonBlank(raw?.desc),
      semanticMatched: null,
      semanticIndex: null,
      semanticRole: null,
      aliasUsed: false,
    }));
    return { mode: 'legacy', source, views, diagnostics: { templateCount: templateSlots.length, dnaCount: semanticSlots.length, danglingDnaRoles: [] } };
  }

  // template_v1: template = axis · DNA matched by role+occurrence + main↔hero alias · ไม่ reuse
  const { match, usedDna } = resolveSemanticMatches(templateSlots, semanticSlots);
  const roleCounts = new Map();
  const views = templateSlots.map((t, index) => {
    const role = templateSlotRole(t, index); // ★ D3-B1.3: role เดียวกับ matcher เป๊ะ
    const occurrence = roleCounts.get(role) || 0;
    roleCounts.set(role, occurrence + 1);
    const m = match[index];
    const sem = m ? semanticSlots[m.semanticIndex] : null;
    const semanticRole = sem ? cleanRole(sem?.role, `slot_${m.semanticIndex + 1}`) : null;
    const shape = cleanRole(t?.shape, role === 'circle' ? 'circle' : 'rect');
    const tShot = nonBlank(t?.shot);
    const sShot = sem ? nonBlank(sem?.shot) : null;
    const tSubject = nonBlank(t?.subject);
    const sSubject = sem ? nonBlank(sem?.subject) : null;
    return {
      index,
      role,
      occurrence,
      shape,
      pos: nonBlank(t?.pos),
      geometry: geometryOf(t),
      faceSizePct: Number(t?.faceSizePct ?? (sem ? sem?.faceSizePct : undefined)) || null,
      shot: tShot ?? sShot ?? null,
      shotProvenance: tShot ? 'template' : (sShot ? 'dna' : 'none'),
      subject: tSubject ?? sSubject ?? null,
      subjectProvenance: tSubject ? 'template' : (sSubject ? 'dna' : 'none'),
      emotion: sem ? nonBlank(sem?.emotion) : null,
      facing: sem ? nonBlank(sem?.facing) : null,
      desc: sem ? nonBlank(sem?.desc) : null,
      semanticMatched: !!sem,
      semanticIndex: m ? m.semanticIndex : null,
      semanticRole,
      aliasUsed: m ? m.aliasUsed : false,
    };
  });
  const danglingDnaRoles = semanticSlots
    .map((s, i) => ({ index: i, role: cleanRole(s?.role, `slot_${i + 1}`) }))
    .filter((x) => !usedDna.has(x.index));
  return { mode: 'template_v1', source: 'template.slots', views, diagnostics: { templateCount: templateSlots.length, dnaCount: semanticSlots.length, danglingDnaRoles } };
}

// ★ D3-B1.2: viewDiagnostics = ชั้น "semantic view" ล้วน (เข้า effectiveViewHash) — ไม่มีข้อมูล artBrief order
//   สะท้อน DNA จริงแม้ไม่มี template (danglingDnaRoles = DNA ทุกตัว) เพื่อ D1 แยก DNA ต่างกันได้จาก hash
function buildViewDiagnostics(view) {
  return {
    templateCount: view.diagnostics.templateCount,
    dnaCount: view.diagnostics.dnaCount,
    unmatchedTemplateRoles: view.views.filter((v) => !v.semanticMatched).map((v) => ({ index: v.index, role: v.role })),
    missingShotSlots: view.views.filter((v) => v.shot === null).map((v) => ({ index: v.index, role: v.role })),
    danglingDnaRoles: view.diagnostics.danglingDnaRoles,
    aliasMatches: view.views.filter((v) => v.aliasUsed).map((v) => ({ index: v.index, role: v.role, fromRole: v.semanticRole, semanticRole: v.semanticRole, semanticIndex: v.semanticIndex })),
  };
}

// ★ D3-B1.2: effectiveViewHash = hash ของ "resolved ref view + viewDiagnostics" เท่านั้น
//   (ไม่รวม artBrief order/eventIntent/wantPerson — post-artBrief S6↔S7 คุมด้วย whole-contract hash ของ adapter ภายหลัง)
//   mode อยู่ใน hash → template_v1 vs legacy แยกกันแม้ค่า slot เหมือน
function effectiveViewHashOf(view, viewDiagnostics) {
  return fnv1a32(JSON.stringify({
    mode: 'template_v1',
    axis: 'template.slots',
    slots: view.views.map((v) => ({
      index: v.index, role: v.role, occurrence: v.occurrence, shape: v.shape, pos: v.pos, geometry: v.geometry,
      shot: v.shot, shotProvenance: v.shotProvenance, subject: v.subject, subjectProvenance: v.subjectProvenance,
      emotion: v.emotion, facing: v.facing, desc: v.desc, faceSizePct: v.faceSizePct,
      semanticIndex: v.semanticIndex, semanticRole: v.semanticRole, semanticMatched: v.semanticMatched, aliasUsed: v.aliasUsed,
    })),
    viewDiagnostics,
  }));
}

// ★ D3-B1.2: orderDiagnostics = ชั้น artBrief order (แยกจาก view · ไม่เข้า effectiveViewHash)
function buildOrderDiagnostics(views, preassign, orders) {
  const list = Array.isArray(orders) ? orders : [];
  const { entries, unusedOrderIndices } = preassign;
  const orderAliasMatches = [];
  entries.forEach((e, vi) => {
    if (e && e.matchMode === 'hero_alias') orderAliasMatches.push({ index: views[vi].index, role: views[vi].role, orderIndex: e.orderIndex, orderRole: e.orderRole });
  });
  return {
    orderAliasMatches,
    unmatchedOrderIndices: unusedOrderIndices,
    unmatchedOrderRoles: unusedOrderIndices.map((i) => cleanRole(list[i]?.role, '') || null),
  };
}

/**
 * Build the immutable semantic contract used only by solver shadow diagnostics.
 * Geometry slots are canonical when available; semantic slots fill missing labels.
 * ★ D3-B1.1: canonical input เดียว = mode:'template_v1' (explicit — ไม่มี env, ไม่มี alias boolean).
 * default / 'legacy' / junk / ไม่ส่ง = legacy exact เดิมทุก byte · template_v1 มี top-level authority.
 */
export function buildRefSlotContract({ refDNA = null, artBriefOrders = [], legacySlots = LEGACY_MEGA_SLOT_ORDER, mode = 'legacy' } = {}) {
  const dna = refDNA && typeof refDNA === 'object' ? refDNA : {};
  const templateSlots = Array.isArray(dna.template?.slots) ? dna.template.slots : [];
  const semanticSlots = Array.isArray(dna.slots) ? dna.slots : [];
  const legacyOrder = (Array.isArray(legacySlots) && legacySlots.length ? legacySlots : LEGACY_MEGA_SLOT_ORDER)
    .map((slot, index) => cleanRole(slot, `slot_${index + 1}`));

  // ★ D3-B1.1/B1.2: template_v1 = explicit input เท่านั้น (ไม่มี dual API/alias boolean)
  if (mode === 'template_v1') {
    // resolve view เสมอ (แม้ไม่มี template → views=[] · danglingDnaRoles = DNA ทุกตัว) →
    //   viewDiagnostics/effectiveViewHash สะท้อน DNA จริง (D1 แยก DNA ต่างกันได้แม้ slots=[])
    const view = resolveRefSlotView(refDNA, { mode: 'template_v1' });
    const viewDiagnostics = buildViewDiagnostics(view);
    const effectiveViewHash = effectiveViewHashOf(view, viewDiagnostics);
    // ★ P0-2 + B1.2 readiness boundary: axisReady = "มี template axis ให้ resolve" เท่านั้น
    //   (ไม่ใช่ strict/pipeline ready — B2 ต้อง gate slots>=3 + geometry/realized/strict แยกเอง)
    //   ไม่มี template → axisReady=false HOLD · มี template (แม้ missing shot/unmatched/geometry เพี้ยน) = true + diagnostics
    const axisReady = templateSlots.length > 0;
    const preassign = preassignOrders(view.views, artBriefOrders);
    const orderDiagnostics = buildOrderDiagnostics(view.views, preassign, artBriefOrders);
    const authority = { mode: 'template_v1', axis: 'template.slots', axisReady, effectiveViewHash, viewDiagnostics, orderDiagnostics };

    if (!axisReady) {
      return { v: 1, source: 'template.slots', legacyOrder, slots: [], mismatches: [], authority };
    }
    const counts = new Map();
    const slots = view.views.map((v, vi) => {
      const legacySlot = legacyOrder[v.index] || null;
      const refRole = v.role;
      const id = uniqueId(refRole, counts);
      const e = preassign.entries[vi];
      const order = e ? e.order : null;
      return {
        id,
        refRole,
        solverRole: solverRoleFor(refRole, v.shape),
        legacySlot,
        sourceIndex: v.index,
        shape: v.shape,
        subject: v.subject,
        eventIntent: nonBlank(order?.want),
        wantPerson: nonBlank(order?.personHint),
        refShot: v.shot, // effective shot จาก resolver — order.shot ไม่ override เด็ดขาด
        position: v.pos,
        geometry: v.geometry,
        // ★ P1-3 semantic per-slot metadata (template_v1 เท่านั้น — legacy ไม่มี field พวกนี้)
        refShotProvenance: v.shotProvenance,
        subjectProvenance: v.subjectProvenance,
        semanticIndex: v.semanticIndex,
        semanticMatched: v.semanticMatched,
        aliasUsed: v.aliasUsed,
        // ★ B1.2 order provenance per-slot
        orderIndex: e ? e.orderIndex : null,
        orderRole: e ? e.orderRole : null,
        orderMatchMode: e ? e.matchMode : null,
      };
    });
    const mismatches = slots
      .filter((slot) => slot.legacySlot && slot.refRole !== slot.legacySlot)
      .map((slot) => ({ id: slot.id, refRole: slot.refRole, legacySlot: slot.legacySlot, sourceIndex: slot.sourceIndex }));
    return { v: 1, source: 'template.slots', legacyOrder, slots, mismatches, authority };
  }

  // ── LEGACY (default / อะไรที่ไม่ใช่ template_v1) — EXACT เดิมทุก byte ──
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
// additive · ผู้บริโภคฝั่งประกอบ = สาย strict composer ที่คุมด้วย flag default OFF (megaComposerService, latch MEGA_STRICT_RENDER) · pure เหมือนทั้งไฟล์: ห้าม import/IO/random
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

// ---------- 🔐 Strict latch resolution (AC-0099 LANE-B — canonical env-key authority) ----------
// SINGLE SOURCE OF TRUTH for the strict pipeline's environment latches. Every consumer
// (S7 producer wiring, the ac0084 canary preflight, the semantic-selection harness) MUST
// derive its key list from STRICT_LATCH_KEYS so the lists can NEVER drift.
//
// PURE like the rest of this file: this function reads NO environment itself — the caller
// passes an env-like object as a parameter (keeps the module's no-env-read contract intact).
//
// Arming rule (fail-closed): a latch is armed iff its value is EXACTLY the string '1'.
//   No coercion, no trim — '1 ', the number 1, 'true', 'yes', '01' are all NOT armed.
// MEGA_STRICT_RENDER is the SOLE canonical renderer latch; no alias (e.g. MEGA_STRICT_RENDERER)
// may ever be treated as arming — aliases surface only as unknownStrictLikeKeys warnings.

export const STRICT_LATCH_KEYS = Object.freeze([
  'MEGA_SEMANTIC_SELECTION',
  'MEGA_SELECTION_SPEC',
  'MEGA_STRICT_PRODUCER',
  'MEGA_STRICT_RENDER',
  'MEGA_REF_SHOT_AUTHORITY',
]);

// The 4 core latches of the ORDINARY semantic-strict wire — this MIRRORS S7's arm matrix
// exactly (megaAdapters.js:3655-3656: strictProducerRequested = _sem && _semEnvOn &&
// MEGA_STRICT_PRODUCER; strictWireOn adds MEGA_STRICT_RENDER). _semEnvOn is the
// SEMANTIC+SELECTION_SPEC pair. armedProducer here == a fully-armed ordinary-strict wire.
//   ⚠️ MEGA_REF_SHOT_AUTHORITY is NOT part of ordinary strict — it gates ONLY the marked
//   template_v1 / ref-shot path (megaAdapters.js:3638) and is exposed as a SEPARATE
//   armedRefShotAuthority field. It must NEVER be folded into armedProducer.
//   This resolver is REPORTING/PREFLIGHT only — it mirrors the switch matrix, never redefines it.
const STRICT_PRODUCER_CORE_KEYS = Object.freeze([
  'MEGA_SEMANTIC_SELECTION',
  'MEGA_SELECTION_SPEC',
  'MEGA_STRICT_PRODUCER',
  'MEGA_STRICT_RENDER',
]);

// Matches strict-pipeline-shaped env keys. Own keys that match this but are NOT canonical
// (e.g. the typo'd MEGA_STRICT_RENDERER) are reported as unknownStrictLikeKeys so a
// mis-set latch is loud instead of silently doing nothing. Exact regex is contract.
const _STRICT_LIKE_RE = /MEGA_.*(STRICT|RENDER)/;

// Descriptor-safe own-value read — never throws on hostile getters / Proxy traps.
function _latchRead(obj, key) {
  try {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
    return obj[key];
  } catch {
    return undefined;
  }
}

// armed iff EXACTLY the string '1' (no coercion, no trim).
const _latchArmed = (v) => v === '1';

/**
 * Resolve the strict-pipeline latches from an env-like object.
 * PURE + fail-closed: reads no environment of its own, and NEVER throws — a hostile
 * env-like (null, primitive, Proxy with throwing traps, throwing getters) yields the
 * safe "nothing armed" result rather than an exception.
 *
 * @param {object} envLike - env-like object (e.g. the process environment, or a plain fixture).
 * @returns {{ armedProducer: boolean, armedRenderer: boolean, armedRefShotAuthority: boolean,
 *             values: Record<string, string|undefined>, unknownStrictLikeKeys: string[] }}
 *   - values: raw values of the 5 canonical keys (string in a real env, undefined if absent).
 *   - armedRenderer: MEGA_STRICT_RENDER === '1' EXACTLY (the sole renderer/wire latch).
 *   - armedProducer: all 4 ORDINARY-strict core latches === '1' EXACTLY (SEMANTIC, SPEC,
 *     PRODUCER, RENDER — mirrors S7 strictWireOn). Does NOT include REF_SHOT_AUTHORITY.
 *   - armedRefShotAuthority: MEGA_REF_SHOT_AUTHORITY === '1' EXACTLY — the SEPARATE ref-shot /
 *     template_v1 path latch, reported on its own so it can never be folded into armedProducer.
 *   - unknownStrictLikeKeys: own keys matching /MEGA_.*(STRICT|RENDER)/ that are NOT canonical
 *     (catches aliases like MEGA_STRICT_RENDERER). Deterministic order = own-key order.
 */
export function resolveStrictLatches(envLike) {
  const values = {};
  const isObjLike = envLike != null && (typeof envLike === 'object' || typeof envLike === 'function');

  // fail-closed default: nothing armed, all canonical values undefined.
  if (!isObjLike) {
    for (const k of STRICT_LATCH_KEYS) values[k] = undefined;
    return { armedProducer: false, armedRenderer: false, armedRefShotAuthority: false, values, unknownStrictLikeKeys: [] };
  }

  for (const k of STRICT_LATCH_KEYS) values[k] = _latchRead(envLike, k);

  const armedRenderer = _latchArmed(values.MEGA_STRICT_RENDER);
  const armedProducer = STRICT_PRODUCER_CORE_KEYS.every((k) => _latchArmed(values[k]));
  // SEPARATE ref-shot/template path latch — reported alone, never mixed into armedProducer.
  const armedRefShotAuthority = _latchArmed(values.MEGA_REF_SHOT_AUTHORITY);

  // Enumerate own keys to catch strict-like aliases — Proxy ownKeys trap may throw.
  const unknownStrictLikeKeys = [];
  let ownKeys = [];
  try {
    ownKeys = Object.keys(envLike);
  } catch {
    ownKeys = [];
  }
  const canonical = new Set(STRICT_LATCH_KEYS);
  for (const k of ownKeys) {
    if (typeof k !== 'string' || canonical.has(k)) continue;
    if (_STRICT_LIKE_RE.test(k)) unknownStrictLikeKeys.push(k);
  }

  return { armedProducer, armedRenderer, armedRefShotAuthority, values, unknownStrictLikeKeys };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔐 WAVE1C — SelectionAuthority v1 + SelectionSpec v2 (pure SHA-256, fail-closed)
// ---------------------------------------------------------------------------
// FLAG-GATED contract layer: the WAVE1A ref-hero-v2 path wires these behind the
// default-OFF env gate (S6 producer in megaAdapters + S7 carrier + the strict V2
// consumer in megaComposerService); they stay inert only while that gate is unset.
// Each builder and validator FAILS CLOSED — a structural defect yields a typed HOLD
// carrying FIXED reason codes (bounded strings + numeric indices only; caller-supplied
// ids/urls/messages are NEVER echoed), never a partial or coerced result, never
// a thrown exception. All returned objects are deep-frozen.
//
// PURE by the module contract (enforced by scripts/test-ref-slot-contract.mjs):
// no imports, no environment reads, no IO, no time, no randomness. The digests
// are REAL SHA-256, implemented here in self-contained pure JS (proven in the owned
// test to be byte-identical to node:crypto — which is itself pinned to the NIST
// known-answer vectors), NOT the 32-bit fnv1a32 checksum the legacy layer still uses.
//
// Capture is DESCRIPTOR-FIRST: every untrusted object/array is read once into a
// fully-owned snapshot via property descriptors (never via a getter, so an
// accessor is rejected and a Proxy's get-trap is never triggered), with every
// reflection call guarded so a throwing trap yields a stable HOLD rather than an
// exception. Collections are length-bounded BEFORE iteration.
//
// Hash grammars are EXACT and per-source: story / cast / assignment authority
// hashes are SHA-256 (64 lowercase hex); the hero contract hash is fnv1a32
// (8 lowercase hex) in-tree; every hash this module computes is 64 lowercase hex.
// ═══════════════════════════════════════════════════════════════════════════

export const SELECTION_AUTHORITY_VERSION = 1;
export const SELECTION_SPEC_V2_VERSION = 2;

// ---- pure SHA-256 (no imports) ---------------------------------------------
// UTF-8 encode a JS string to a byte array (lone surrogates → U+FFFD, matching
// node:crypto's utf8 handling — cross-checked in the owned test).
function saUtf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        out.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

const SA_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function saRotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function saSha256Hex(str) {
  const bytes = saUtf8Bytes(str);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000) >>> 0;
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
    h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (saRotr32(w[i - 15], 7) ^ saRotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (saRotr32(w[i - 2], 17) ^ saRotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (saRotr32(e, 6) ^ saRotr32(e, 11) ^ saRotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ ((~e >>> 0) & g)) >>> 0;
      const t1 = (h + S1 + ch + SA_SHA256_K[i] + w[i]) >>> 0;
      const S0 = (saRotr32(a, 2) ^ saRotr32(a, 13) ^ saRotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const hx = (x) => ('00000000' + (x >>> 0).toString(16)).slice(-8);
  return hx(h0) + hx(h1) + hx(h2) + hx(h3) + hx(h4) + hx(h5) + hx(h6) + hx(h7);
}

// ---- canonical JSON over an already-owned snapshot -------------------------
function saCodeUnitCompare(a, b) {
  const as = String(a), bs = String(b);
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}
function saSortDeep(v) {
  if (Array.isArray(v)) return v.map(saSortDeep);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(saCodeUnitCompare)) out[k] = saSortDeep(v[k]);
    return out;
  }
  return v;
}
function saHashJson(canon) { return saSha256Hex(JSON.stringify(saSortDeep(canon))); }

// ---- descriptor-first capture primitives (no node:util) --------------------
// Plain-record capture: own enumerable DATA properties only (accessors rejected
// by !('value' in d) — the getter is never invoked), prototype Object.prototype
// or null, no symbol keys, EXACT required key set. Every reflection guarded so a
// hostile Proxy trap yields null (→ HOLD), never a throw. Reads each value once
// into a fully-owned record; callers never touch the original object again.
function saCaptureRecord(v, requiredKeys) {
  if (v === null || typeof v !== 'object') return null;
  // Array.isArray THROWS on a revoked Proxy — guard it so a revoked object/array
  // Proxy yields a stable HOLD (null), never an exception.
  let isArr;
  try { isArr = Array.isArray(v); } catch { return null; }
  if (isArr) return null;
  let proto, names;
  try { proto = Object.getPrototypeOf(v); } catch { return null; }
  if (proto !== Object.prototype && proto !== null) return null;
  try { if (Object.getOwnPropertySymbols(v).length > 0) return null; } catch { return null; }
  try { names = Object.getOwnPropertyNames(v); } catch { return null; }
  if (names.length !== requiredKeys.length) return null;
  const want = new Set(requiredKeys);
  const out = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!want.has(name)) return null;
    let d;
    try { d = Object.getOwnPropertyDescriptor(v, name); } catch { return null; }
    if (!d || d.enumerable !== true || !('value' in d)) return null;
    out[name] = d.value;
  }
  return out;
}

// Bounded dense-array capture: maxLen is enforced BEFORE any element iteration
// (oversize → null). Wrong prototype / holes / extra or symbol keys / accessor
// length → null. All reflection guarded; no getter invoked.
function saCaptureArrayBounded(v, maxLen) {
  if (v === null || typeof v !== 'object') return null;
  // Array.isArray THROWS on a revoked Proxy — guard it so a revoked Proxy yields
  // a stable HOLD (null), never an exception.
  let isArr;
  try { isArr = Array.isArray(v); } catch { return null; }
  if (!isArr) return null;
  let proto, lenDesc, names;
  try { proto = Object.getPrototypeOf(v); } catch { return null; }
  if (proto !== Array.prototype) return null;
  try { if (Object.getOwnPropertySymbols(v).length > 0) return null; } catch { return null; }
  try { lenDesc = Object.getOwnPropertyDescriptor(v, 'length'); } catch { return null; }
  if (!lenDesc || lenDesc.enumerable !== false || !('value' in lenDesc)) return null;
  const length = lenDesc.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;
  if (length > maxLen) return null;
  try { names = Object.getOwnPropertyNames(v); } catch { return null; }
  if (names.length !== length + 1) return null;
  const out = [];
  for (let i = 0; i < length; i++) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(v, String(i)); } catch { return null; }
    if (!d || d.enumerable !== true || !('value' in d)) return null;
    out.push(d.value);
  }
  return out;
}

// Cheap, safe "longer than maxLen" peek (reads only the length descriptor).
function saArrayTooLong(v, maxLen) {
  try {
    if (!Array.isArray(v)) return false;
    const d = Object.getOwnPropertyDescriptor(v, 'length');
    return !!d && ('value' in d) && typeof d.value === 'number' && d.value > maxLen;
  } catch { return false; }
}

// ---- scalar validators -----------------------------------------------------
const SA_MAX_ID_LEN = 512;
// Control-char detection WITHOUT a literal control byte or \u escape in source.
function saHasControlChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}
function saIsCleanString(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= SA_MAX_ID_LEN && !saHasControlChar(v);
}
function saIsCleanIdOrNull(v) { return v === null || saIsCleanString(v); }
const _SA_HEX64_RE = /^[0-9a-f]{64}$/;
const _SA_HEX8_RE = /^[0-9a-f]{8}$/;
function saIs64Hex(v) { return typeof v === 'string' && _SA_HEX64_RE.test(v); }
function saIs8Hex(v) { return typeof v === 'string' && _SA_HEX8_RE.test(v); }
function saIsSafeUint(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }

function saDeepFreeze(v) {
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) saDeepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

function saHold(reasons, key) {
  return { ok: false, decision: 'hold', reasons, [key]: null };
}

// ═══ SelectionAuthority v1 ═══════════════════════════════════════════════════
const SA_SHAPES = Object.freeze(['rect', 'circle', 'rounded']);
const SA_MAX_SLOTS = 8;
const SA_SLOT_KEYS = Object.freeze(['refSlotId', 'order', 'role', 'shape', 'personId', 'candidateId', 'sourceAssetId']);
const SA_HERO_KEYS = Object.freeze(['heroContractHash', 'refSlotId', 'personId', 'candidateId', 'sourceAssetId']);
const SA_ENVELOPE_KEYS = Object.freeze(['v', 'storyAuthorityHash', 'castManifestHash', 'assignmentHash', 'hero', 'slots', 'selectionAuthorityHash']);
const SA_BUILD_INPUT_KEYS = Object.freeze([
  'storyAuthorityHash', 'castManifestHash', 'assignmentHash', 'hero', 'slots',
  'expectedSelectionAuthorityHash', 'expectedStoryAuthorityHash', 'expectedCastManifestHash',
  'expectedAssignmentHash', 'expectedHeroContractHash',
]);
const SA_VALIDATE_INPUT_KEYS = Object.freeze([
  'selectionAuthority', 'expectedSelectionAuthorityHash', 'expectedStoryAuthorityHash',
  'expectedCastManifestHash', 'expectedAssignmentHash', 'expectedHeroContractHash',
]);

// hero.personId is AUTHORITATIVE identity → must be a bounded clean NONBLANK
// string; it may never be null. heroContractHash is fnv1a32 (exactly 8 hex).
function saCaptureHeroRow(v, reasons) {
  const raw = saCaptureRecord(v, SA_HERO_KEYS);
  if (raw === null) { reasons.push('sa_hero_keys'); return null; }
  let ok = true;
  if (!saIs8Hex(raw.heroContractHash)) { reasons.push('sa_hero_contract_hash'); ok = false; }
  if (!saIsCleanString(raw.refSlotId)) { reasons.push('sa_hero_refSlotId'); ok = false; }
  if (!saIsCleanString(raw.personId)) { reasons.push('sa_hero_personId_required'); ok = false; }
  if (!saIsCleanString(raw.candidateId)) { reasons.push('sa_hero_candidateId'); ok = false; }
  if (!saIsCleanString(raw.sourceAssetId)) { reasons.push('sa_hero_sourceAssetId'); ok = false; }
  if (!ok) return null;
  return {
    heroContractHash: raw.heroContractHash, refSlotId: raw.refSlotId,
    personId: raw.personId, candidateId: raw.candidateId, sourceAssetId: raw.sourceAssetId,
  };
}

// non-hero slots: personId nullable (contract permits null for non-hero rows).
function saCaptureSlotRow(v, i, reasons) {
  const raw = saCaptureRecord(v, SA_SLOT_KEYS);
  if (raw === null) { reasons.push(`sa_slot_keys:${i}`); return null; }
  let ok = true;
  if (!saIsCleanString(raw.refSlotId)) { reasons.push(`sa_slot_refSlotId:${i}`); ok = false; }
  if (!saIsSafeUint(raw.order) || raw.order < 1 || raw.order > SA_MAX_SLOTS) { reasons.push(`sa_slot_order:${i}`); ok = false; }
  if (!saIsCleanString(raw.role)) { reasons.push(`sa_slot_role:${i}`); ok = false; }
  if (!SA_SHAPES.includes(raw.shape)) { reasons.push(`sa_slot_shape:${i}`); ok = false; }
  if (!saIsCleanIdOrNull(raw.personId)) { reasons.push(`sa_slot_personId:${i}`); ok = false; }
  if (!saIsCleanString(raw.candidateId)) { reasons.push(`sa_slot_candidateId:${i}`); ok = false; }
  if (!saIsCleanString(raw.sourceAssetId)) { reasons.push(`sa_slot_sourceAssetId:${i}`); ok = false; }
  if (!ok) return null;
  return {
    refSlotId: raw.refSlotId, order: raw.order, role: raw.role, shape: raw.shape,
    personId: raw.personId, candidateId: raw.candidateId, sourceAssetId: raw.sourceAssetId,
  };
}

function saCaptureAuthorityBody(src, reasons) {
  if (!saIs64Hex(src.storyAuthorityHash)) reasons.push('sa_story_hash');
  if (!saIs64Hex(src.castManifestHash)) reasons.push('sa_cast_hash');
  if (!saIs64Hex(src.assignmentHash)) reasons.push('sa_assignment_hash');
  const hero = saCaptureHeroRow(src.hero, reasons);
  let slots = null;
  if (saArrayTooLong(src.slots, SA_MAX_SLOTS)) {
    reasons.push('sa_slots_too_many');
  } else {
    const rawSlots = saCaptureArrayBounded(src.slots, SA_MAX_SLOTS);
    if (rawSlots === null) reasons.push('sa_slots_not_array');
    else if (rawSlots.length < 1) reasons.push('sa_slots_empty');
    else {
      slots = [];
      for (let i = 0; i < rawSlots.length; i++) {
        const s = saCaptureSlotRow(rawSlots[i], i, reasons);
        if (s) slots.push(s);
      }
      if (slots.length !== rawSlots.length) slots = null;
    }
  }
  if (reasons.length || !hero || !slots) return null;

  let ascending = true;
  for (let i = 1; i < slots.length; i++) if (slots[i].order <= slots[i - 1].order) { ascending = false; break; }
  let contiguous = true;
  const sortedOrders = slots.map((s) => s.order).sort((a, b) => a - b);
  for (let i = 0; i < sortedOrders.length; i++) if (sortedOrders[i] !== i + 1) { contiguous = false; break; }
  if (!ascending) reasons.push('sa_order_not_ascending');
  if (!contiguous) reasons.push('sa_order_not_contiguous');

  const refIds = slots.map((s) => s.refSlotId);
  const candIds = slots.map((s) => s.candidateId);
  const assetIds = slots.map((s) => s.sourceAssetId);
  if (new Set(refIds).size !== refIds.length) reasons.push('sa_dup_refSlotId');
  if (new Set(candIds).size !== candIds.length) reasons.push('sa_dup_candidateId');
  if (new Set(assetIds).size !== assetIds.length) reasons.push('sa_dup_sourceAssetId');

  const heroRows = slots.filter((s) => s.refSlotId === hero.refSlotId);
  if (heroRows.length !== 1) reasons.push('sa_hero_no_row_match');
  else {
    const r = heroRows[0];
    if (r.personId !== hero.personId || r.candidateId !== hero.candidateId || r.sourceAssetId !== hero.sourceAssetId) {
      reasons.push('sa_hero_tuple_mismatch');
    }
  }
  if (reasons.length) return null;
  return {
    storyAuthorityHash: src.storyAuthorityHash,
    castManifestHash: src.castManifestHash,
    assignmentHash: src.assignmentHash,
    hero,
    slots,
  };
}

function saComputeAuthorityHash(body) {
  return saHashJson({
    v: SELECTION_AUTHORITY_VERSION,
    storyAuthorityHash: body.storyAuthorityHash,
    castManifestHash: body.castManifestHash,
    assignmentHash: body.assignmentHash,
    hero: {
      heroContractHash: body.hero.heroContractHash, refSlotId: body.hero.refSlotId,
      personId: body.hero.personId, candidateId: body.hero.candidateId, sourceAssetId: body.hero.sourceAssetId,
    },
    slots: body.slots.map((s) => ({
      refSlotId: s.refSlotId, order: s.order, role: s.role, shape: s.shape,
      personId: s.personId, candidateId: s.candidateId, sourceAssetId: s.sourceAssetId,
    })),
  });
}

function saBuildEnvelope(body, selectionAuthorityHash) {
  return saDeepFreeze({
    v: SELECTION_AUTHORITY_VERSION,
    storyAuthorityHash: body.storyAuthorityHash,
    castManifestHash: body.castManifestHash,
    assignmentHash: body.assignmentHash,
    hero: {
      heroContractHash: body.hero.heroContractHash, refSlotId: body.hero.refSlotId,
      personId: body.hero.personId, candidateId: body.hero.candidateId, sourceAssetId: body.hero.sourceAssetId,
    },
    slots: body.slots.map((s) => ({
      refSlotId: s.refSlotId, order: s.order, role: s.role, shape: s.shape,
      personId: s.personId, candidateId: s.candidateId, sourceAssetId: s.sourceAssetId,
    })),
    selectionAuthorityHash,
  });
}

/**
 * Assemble a SelectionAuthority v1 envelope from raw components and self-verify
 * against the five separately-supplied expected witnesses. Fail-closed.
 */
export function buildSelectionAuthorityV1(input = {}) {
  const top = saCaptureRecord(input, SA_BUILD_INPUT_KEYS);
  if (top === null) return saHold(['sa_input_keys'], 'selectionAuthority');

  const reasons = [];
  const body = saCaptureAuthorityBody(top, reasons);
  if (!body) return saHold(reasons, 'selectionAuthority');

  if (!saIs64Hex(top.expectedSelectionAuthorityHash)) reasons.push('sa_expected_selection_hash');
  if (!saIs64Hex(top.expectedStoryAuthorityHash)) reasons.push('sa_expected_story_hash');
  if (!saIs64Hex(top.expectedCastManifestHash)) reasons.push('sa_expected_cast_hash');
  if (!saIs64Hex(top.expectedAssignmentHash)) reasons.push('sa_expected_assignment_hash');
  if (!saIs8Hex(top.expectedHeroContractHash)) reasons.push('sa_expected_hero_hash');
  if (reasons.length) return saHold(reasons, 'selectionAuthority');

  if (body.storyAuthorityHash !== top.expectedStoryAuthorityHash) reasons.push('sa_story_hash_expected_mismatch');
  if (body.castManifestHash !== top.expectedCastManifestHash) reasons.push('sa_cast_hash_expected_mismatch');
  if (body.assignmentHash !== top.expectedAssignmentHash) reasons.push('sa_assignment_hash_expected_mismatch');
  if (body.hero.heroContractHash !== top.expectedHeroContractHash) reasons.push('sa_hero_hash_expected_mismatch');

  const selectionAuthorityHash = saComputeAuthorityHash(body);
  if (selectionAuthorityHash !== top.expectedSelectionAuthorityHash) reasons.push('sa_selection_hash_expected_mismatch');
  if (reasons.length) return saHold(reasons, 'selectionAuthority');

  return { ok: true, decision: 'assigned', selectionAuthority: saBuildEnvelope(body, selectionAuthorityHash) };
}

/**
 * Re-validate an already-built SelectionAuthority v1 envelope against the five
 * expected witnesses AND its own embedded selectionAuthorityHash. Fail-closed.
 */
export function validateSelectionAuthorityV1(input = {}) {
  const top = saCaptureRecord(input, SA_VALIDATE_INPUT_KEYS);
  if (top === null) return saHold(['sa_input_keys'], 'selectionAuthority');
  const env = saCaptureRecord(top.selectionAuthority, SA_ENVELOPE_KEYS);
  if (env === null) return saHold(['sa_envelope_keys'], 'selectionAuthority');

  const reasons = [];
  if (env.v !== SELECTION_AUTHORITY_VERSION) reasons.push('sa_envelope_version');
  if (!saIs64Hex(env.selectionAuthorityHash)) reasons.push('sa_envelope_selection_hash_format');
  const body = saCaptureAuthorityBody(env, reasons);
  if (!body) return saHold(reasons, 'selectionAuthority');

  if (!saIs64Hex(top.expectedSelectionAuthorityHash)) reasons.push('sa_expected_selection_hash');
  if (!saIs64Hex(top.expectedStoryAuthorityHash)) reasons.push('sa_expected_story_hash');
  if (!saIs64Hex(top.expectedCastManifestHash)) reasons.push('sa_expected_cast_hash');
  if (!saIs64Hex(top.expectedAssignmentHash)) reasons.push('sa_expected_assignment_hash');
  if (!saIs8Hex(top.expectedHeroContractHash)) reasons.push('sa_expected_hero_hash');
  if (reasons.length) return saHold(reasons, 'selectionAuthority');

  if (body.storyAuthorityHash !== top.expectedStoryAuthorityHash) reasons.push('sa_story_hash_expected_mismatch');
  if (body.castManifestHash !== top.expectedCastManifestHash) reasons.push('sa_cast_hash_expected_mismatch');
  if (body.assignmentHash !== top.expectedAssignmentHash) reasons.push('sa_assignment_hash_expected_mismatch');
  if (body.hero.heroContractHash !== top.expectedHeroContractHash) reasons.push('sa_hero_hash_expected_mismatch');

  const computed = saComputeAuthorityHash(body);
  if (computed !== env.selectionAuthorityHash) reasons.push('sa_selection_hash_self_mismatch');
  if (computed !== top.expectedSelectionAuthorityHash) reasons.push('sa_selection_hash_expected_mismatch');
  if (reasons.length) return saHold(reasons, 'selectionAuthority');

  return { ok: true, decision: 'assigned', selectionAuthority: saBuildEnvelope(body, computed) };
}

// ═══ SelectionSpec v2 ════════════════════════════════════════════════════════
const V2_MAX_CANVAS = 100000;   // canvas dimension hard cap (documented)
const V2_MAX_ZINDEX = 4096;     // z-index hard cap
const V2_MAX_FEATHER = 512;     // feather hard cap
const V2_MAX_DIAG_CODES = 32;   // diagnostics.codes length hard cap
const V2_BUILD_INPUT_KEYS = Object.freeze(['selectionAuthority', 'expectedSelectionAuthorityHash', 'renderBindings', 'realizedTemplate', 'refId']);
const V2_VALIDATE_INPUT_KEYS = Object.freeze(['selectionSpec', 'selectionAuthority', 'expectedSelectionAuthorityHash', 'expectedSpecHash', 'expectedReplayHash', 'realizedTemplate']);
const V2_BINDING_KEYS = Object.freeze(['refSlotId', 'composerSlotId', 'candidateId', 'sourceAssetId', 'imageUrl']);
const V2_REALIZED_KEYS = Object.freeze(['templateId', 'canvasW', 'canvasH', 'feather', 'slots']);
const V2_REALIZED_SLOT_KEYS = Object.freeze(['id', 'x', 'y', 'w', 'h', 'zIndex', 'border', 'borderWidth', 'shape']);
const V2_SPEC_KEYS = Object.freeze(['v', 'mode', 'source', 'refId', 'strictReady', 'authority', 'hero', 'canvas', 'counts', 'diagnostics', 'specHash', 'replayHash', 'slots']);
const V2_AUTHORITY_KEYS = Object.freeze(['selectionAuthorityHash', 'storyAuthorityHash', 'castManifestHash', 'assignmentHash', 'heroContractHash']);
const V2_HERO_KEYS = Object.freeze(['heroSlotId', 'personId', 'candidateId', 'sourceAssetId']);
const V2_CANVAS_KEYS = Object.freeze(['templateId', 'canvasW', 'canvasH', 'feather']);
const V2_COUNTS_KEYS = Object.freeze(['total', 'mapped', 'unmapped', 'missingPrimary', 'duplicateCandidate', 'duplicateSourceAsset', 'duplicatePrimaryUrl', 'semanticFallback']);
const V2_DIAG_KEYS = Object.freeze(['codes']);
const V2_SLOT_KEYS = Object.freeze(['refSlotId', 'composerSlotId', 'order', 'role', 'shape', 'render', 'primary', 'backups']);
const V2_RENDER_KEYS = Object.freeze(['x', 'y', 'w', 'h', 'zIndex', 'border', 'borderWidth']);
const V2_PRIMARY_KEYS = Object.freeze(['personId', 'candidateId', 'sourceAssetId', 'imageUrl']);

// Re-validate a selectionAuthority envelope for V2 use. expectedSelectionAuthority-
// Hash cryptographically pins every component hash, so no per-component expected is
// needed here. Emits ONLY v2_* codes.
function saValidateAuthorityForV2(envRaw, expectedSelectionAuthorityHash, reasons) {
  const env = saCaptureRecord(envRaw, SA_ENVELOPE_KEYS);
  if (env === null) { reasons.push('v2_authority_keys'); return null; }
  if (env.v !== SELECTION_AUTHORITY_VERSION) reasons.push('v2_authority_version');
  if (!saIs64Hex(env.selectionAuthorityHash)) reasons.push('v2_authority_hash_format');
  const local = [];
  const body = saCaptureAuthorityBody(env, local);
  if (!body) { reasons.push('v2_authority_invalid'); return null; }
  const computed = saComputeAuthorityHash(body);
  if (computed !== env.selectionAuthorityHash) reasons.push('v2_authority_self_mismatch');
  if (!saIs64Hex(expectedSelectionAuthorityHash) || computed !== expectedSelectionAuthorityHash) reasons.push('v2_authority_hash_mismatch');
  if (reasons.length) return null;
  return { body, selectionAuthorityHash: computed };
}

function saCaptureBinding(v, i, reasons) {
  const raw = saCaptureRecord(v, V2_BINDING_KEYS);
  if (raw === null) { reasons.push(`v2_binding_keys:${i}`); return null; }
  let ok = true;
  if (!saIsCleanString(raw.refSlotId)) { reasons.push(`v2_binding_refSlotId:${i}`); ok = false; }
  if (!saIsCleanString(raw.composerSlotId)) { reasons.push(`v2_binding_composerSlotId:${i}`); ok = false; }
  if (!saIsCleanString(raw.candidateId)) { reasons.push(`v2_binding_candidateId:${i}`); ok = false; }
  if (!saIsCleanString(raw.sourceAssetId)) { reasons.push(`v2_binding_sourceAssetId:${i}`); ok = false; }
  if (!saIsCleanString(raw.imageUrl)) { reasons.push(`v2_binding_imageUrl:${i}`); ok = false; }
  if (!ok) return null;
  return {
    refSlotId: raw.refSlotId, composerSlotId: raw.composerSlotId,
    candidateId: raw.candidateId, sourceAssetId: raw.sourceAssetId, imageUrl: raw.imageUrl,
  };
}

function saCaptureRealizedSlot(v, i, reasons) {
  const raw = saCaptureRecord(v, V2_REALIZED_SLOT_KEYS);
  if (raw === null) { reasons.push(`v2_realized_slot_keys:${i}`); return null; }
  let ok = true;
  if (!saIsCleanString(raw.id)) { reasons.push(`v2_realized_slot_id:${i}`); ok = false; }
  for (const k of ['x', 'y', 'zIndex', 'borderWidth']) {
    if (!saIsSafeUint(raw[k])) { reasons.push(`v2_realized_slot_num:${i}`); ok = false; break; }
  }
  if (!saIsSafeUint(raw.w) || raw.w < 1 || !saIsSafeUint(raw.h) || raw.h < 1) { reasons.push(`v2_realized_slot_dim:${i}`); ok = false; }
  if (typeof raw.border !== 'boolean') { reasons.push(`v2_realized_slot_border:${i}`); ok = false; }
  if (!SA_SHAPES.includes(raw.shape)) { reasons.push(`v2_realized_slot_shape:${i}`); ok = false; }
  if (!ok) return null;
  return {
    id: raw.id, x: raw.x, y: raw.y, w: raw.w, h: raw.h,
    zIndex: raw.zIndex, border: raw.border, borderWidth: raw.borderWidth, shape: raw.shape,
  };
}

function saCaptureRealized(v, reasons) {
  const raw = saCaptureRecord(v, V2_REALIZED_KEYS);
  if (raw === null) { reasons.push('v2_realized_keys'); return null; }
  let ok = true;
  if (!saIsCleanString(raw.templateId)) { reasons.push('v2_realized_templateId'); ok = false; }
  if (!saIsSafeUint(raw.canvasW) || raw.canvasW < 1 || raw.canvasW > V2_MAX_CANVAS) { reasons.push('v2_realized_canvasW'); ok = false; }
  if (!saIsSafeUint(raw.canvasH) || raw.canvasH < 1 || raw.canvasH > V2_MAX_CANVAS) { reasons.push('v2_realized_canvasH'); ok = false; }
  if (!saIsSafeUint(raw.feather) || raw.feather > V2_MAX_FEATHER) { reasons.push('v2_realized_feather'); ok = false; }
  let slots = null;
  if (saArrayTooLong(raw.slots, SA_MAX_SLOTS)) { reasons.push('v2_realized_slots_too_many'); ok = false; }
  else {
    const rawSlots = saCaptureArrayBounded(raw.slots, SA_MAX_SLOTS);
    if (rawSlots === null) { reasons.push('v2_realized_slots_not_array'); ok = false; }
    else if (rawSlots.length < 1) { reasons.push('v2_realized_slots_empty'); ok = false; }
    else {
      slots = [];
      for (let i = 0; i < rawSlots.length; i++) {
        const s = saCaptureRealizedSlot(rawSlots[i], i, reasons);
        if (s) slots.push(s);
      }
      if (slots.length !== rawSlots.length) { slots = null; ok = false; }
    }
  }
  if (!ok || !slots) return null;
  const ids = slots.map((s) => s.id);
  if (new Set(ids).size !== ids.length) { reasons.push('v2_realized_duplicate_id'); return null; }

  // geometry safety: canvas containment + practical caps (fail-closed HOLD).
  if (2 * raw.feather > Math.min(raw.canvasW, raw.canvasH)) { reasons.push('v2_realized_feather_bounds'); ok = false; }
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i];
    if (r.x + r.w > raw.canvasW || r.y + r.h > raw.canvasH) { reasons.push(`v2_realized_offcanvas:${i}`); ok = false; }
    if (r.zIndex > V2_MAX_ZINDEX) { reasons.push(`v2_realized_zindex:${i}`); ok = false; }
    if (2 * r.borderWidth > Math.min(r.w, r.h)) { reasons.push(`v2_realized_border_bounds:${i}`); ok = false; }
  }
  if (!ok) return null;
  return { templateId: raw.templateId, canvasW: raw.canvasW, canvasH: raw.canvasH, feather: raw.feather, slots };
}

// The canonical join: authority body ⋈ renderBindings ⋈ realized — ONLY by exact
// refSlotId (bindings) and exact composerSlotId (realized). No role / index /
// position / nearest-geometry fallback. Deterministic: output slots in authority
// order. Returns the (unfrozen) v2 spec object or null (with typed reasons).
function saAssembleSpecV2(body, selectionAuthorityHash, bindings, realized, refId, reasons) {
  if (!saIsCleanString(refId)) reasons.push('v2_refId_invalid');

  const authRefSet = new Set(body.slots.map((s) => s.refSlotId));
  const bindByRef = new Map();
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    if (!authRefSet.has(b.refSlotId)) { reasons.push(`v2_binding_unknown_refSlot:${i}`); continue; }
    if (bindByRef.has(b.refSlotId)) { reasons.push('v2_binding_duplicate_refSlot'); continue; }
    bindByRef.set(b.refSlotId, b);
  }
  for (let i = 0; i < body.slots.length; i++) {
    if (!bindByRef.has(body.slots[i].refSlotId)) reasons.push(`v2_binding_missing:${i}`);
  }
  if (reasons.length) return null;

  const usedBindings = body.slots.map((s) => bindByRef.get(s.refSlotId));
  const composerIds = usedBindings.map((b) => b.composerSlotId);
  const urls = usedBindings.map((b) => b.imageUrl);
  if (new Set(composerIds).size !== composerIds.length) reasons.push('v2_dup_composer_id');
  if (new Set(urls).size !== urls.length) reasons.push('v2_dup_primary_url');

  const realizedById = new Map(realized.slots.map((r) => [r.id, r]));
  const compSet = new Set(composerIds);
  const oneToOne = realized.slots.length === body.slots.length
    && compSet.size === realized.slots.length
    && [...compSet].every((id) => realizedById.has(id));
  if (!oneToOne) reasons.push('v2_realized_set_mismatch');
  if (reasons.length) return null;

  const slots = [];
  for (let i = 0; i < body.slots.length; i++) {
    const a = body.slots[i];
    const b = bindByRef.get(a.refSlotId);
    const r = realizedById.get(b.composerSlotId);
    if (b.candidateId !== a.candidateId || b.sourceAssetId !== a.sourceAssetId) { reasons.push(`v2_asset_substitution:${i}`); continue; }
    if (a.shape === 'rounded') {
      if (r.shape !== 'rounded') { reasons.push(`v2_shape_unsupported:${i}`); continue; }
    } else if (r.shape !== a.shape) {
      reasons.push(`v2_shape_mismatch:${i}`); continue;
    }
    slots.push({
      refSlotId: a.refSlotId, composerSlotId: b.composerSlotId, order: a.order, role: a.role, shape: a.shape,
      render: { x: r.x, y: r.y, w: r.w, h: r.h, zIndex: r.zIndex, border: r.border, borderWidth: r.borderWidth },
      primary: { personId: a.personId, candidateId: a.candidateId, sourceAssetId: a.sourceAssetId, imageUrl: b.imageUrl },
      backups: [],
    });
  }
  if (reasons.length) return null;

  const heroSlotId = body.hero.refSlotId;
  const heroRow = slots.find((s) => s.refSlotId === heroSlotId);
  if (!heroRow
    || heroRow.primary.personId !== body.hero.personId
    || heroRow.primary.candidateId !== body.hero.candidateId
    || heroRow.primary.sourceAssetId !== body.hero.sourceAssetId) {
    reasons.push('v2_hero_mismatch');
    return null;
  }

  const total = body.slots.length;
  const counts = {
    total, mapped: slots.length, unmapped: total - slots.length, missingPrimary: 0,
    duplicateCandidate: 0, duplicateSourceAsset: 0, duplicatePrimaryUrl: 0, semanticFallback: 0,
  };
  const authority = {
    selectionAuthorityHash, storyAuthorityHash: body.storyAuthorityHash,
    castManifestHash: body.castManifestHash, assignmentHash: body.assignmentHash, heroContractHash: body.hero.heroContractHash,
  };
  const heroV2 = { heroSlotId, personId: body.hero.personId, candidateId: body.hero.candidateId, sourceAssetId: body.hero.sourceAssetId };
  const canvas = { templateId: realized.templateId, canvasW: realized.canvasW, canvasH: realized.canvasH, feather: realized.feather };

  const identity = slots.map((s) => ({
    refSlotId: s.refSlotId, composerSlotId: s.composerSlotId, order: s.order, role: s.role, shape: s.shape,
    render: { x: s.render.x, y: s.render.y, w: s.render.w, h: s.render.h, zIndex: s.render.zIndex, border: s.render.border, borderWidth: s.render.borderWidth },
    primary: { personId: s.primary.personId, candidateId: s.primary.candidateId, sourceAssetId: s.primary.sourceAssetId },
  }));
  const specPayload = { v: SELECTION_SPEC_V2_VERSION, refId, authority, hero: heroV2, canvas, slots: identity };
  const specHash = saHashJson(specPayload);
  const replayHash = saHashJson({ ...specPayload, urls: slots.map((s) => ({ refSlotId: s.refSlotId, imageUrl: s.primary.imageUrl })) });

  return {
    v: SELECTION_SPEC_V2_VERSION, mode: 'semantic_global_exact', source: 'selection_authority',
    refId, strictReady: true, authority, hero: heroV2, canvas, counts,
    diagnostics: { codes: [] }, specHash, replayHash, slots,
  };
}

/**
 * Build a SelectionSpec v2 by joining a verified SelectionAuthority envelope,
 * render bindings, and a realized template — exact refSlotId join only.
 * Fail-closed: any defect yields a typed HOLD, never a partial spec.
 */
export function buildSelectionSpecV2(input = {}) {
  const top = saCaptureRecord(input, V2_BUILD_INPUT_KEYS);
  if (top === null) return saHold(['v2_input_keys'], 'selectionSpec');

  const reasons = [];
  const auth = saValidateAuthorityForV2(top.selectionAuthority, top.expectedSelectionAuthorityHash, reasons);
  if (!auth) return saHold(reasons, 'selectionSpec');

  let bindings = null;
  if (saArrayTooLong(top.renderBindings, SA_MAX_SLOTS)) reasons.push('v2_bindings_too_many');
  else {
    const rawBind = saCaptureArrayBounded(top.renderBindings, SA_MAX_SLOTS);
    if (rawBind === null) reasons.push('v2_bindings_not_array');
    else if (rawBind.length < 1) reasons.push('v2_bindings_empty');
    else {
      bindings = [];
      for (let i = 0; i < rawBind.length; i++) {
        const b = saCaptureBinding(rawBind[i], i, reasons);
        if (b) bindings.push(b);
      }
      if (bindings.length !== rawBind.length) bindings = null;
    }
  }
  const realized = saCaptureRealized(top.realizedTemplate, reasons);
  if (reasons.length || !bindings || !realized) return saHold(reasons, 'selectionSpec');

  const spec = saAssembleSpecV2(auth.body, auth.selectionAuthorityHash, bindings, realized, top.refId, reasons);
  if (!spec) return saHold(reasons, 'selectionSpec');
  return { ok: true, decision: 'assigned', selectionSpec: saDeepFreeze(spec) };
}

// Structurally capture an already-built v2 spec into a fully-owned normalized
// snapshot (identical field shape to saAssembleSpecV2 output). Enforces the exact
// schema — including hero.personId NONBLANK, backups === [], and diagnostics.codes
// bounded to clean strings (so a hostile codes element can never reach saHashJson).
function saCaptureSpecV2(v, reasons) {
  const raw = saCaptureRecord(v, V2_SPEC_KEYS);
  if (raw === null) { reasons.push('v2_spec_keys'); return null; }
  let ok = true;
  if (raw.v !== SELECTION_SPEC_V2_VERSION) { reasons.push('v2_spec_version'); ok = false; }
  if (raw.mode !== 'semantic_global_exact') { reasons.push('v2_spec_mode'); ok = false; }
  if (raw.source !== 'selection_authority') { reasons.push('v2_spec_source'); ok = false; }
  if (raw.strictReady !== true) { reasons.push('v2_spec_strictReady'); ok = false; }
  if (!saIsCleanString(raw.refId)) { reasons.push('v2_spec_refId'); ok = false; }
  if (!saIs64Hex(raw.specHash)) { reasons.push('v2_spec_specHash'); ok = false; }
  if (!saIs64Hex(raw.replayHash)) { reasons.push('v2_spec_replayHash'); ok = false; }

  const authority = saCaptureRecord(raw.authority, V2_AUTHORITY_KEYS);
  if (authority === null) { reasons.push('v2_spec_authority'); ok = false; }
  else {
    if (!saIs64Hex(authority.selectionAuthorityHash)) { reasons.push('v2_spec_authority_hash'); ok = false; }
    if (!saIs64Hex(authority.storyAuthorityHash)) { reasons.push('v2_spec_authority_story'); ok = false; }
    if (!saIs64Hex(authority.castManifestHash)) { reasons.push('v2_spec_authority_cast'); ok = false; }
    if (!saIs64Hex(authority.assignmentHash)) { reasons.push('v2_spec_authority_assignment'); ok = false; }
    if (!saIs8Hex(authority.heroContractHash)) { reasons.push('v2_spec_authority_hero'); ok = false; }
  }

  const hero = saCaptureRecord(raw.hero, V2_HERO_KEYS);
  if (hero === null) { reasons.push('v2_spec_hero'); ok = false; }
  else {
    if (!saIsCleanString(hero.heroSlotId)) { reasons.push('v2_spec_hero_slot'); ok = false; }
    if (!saIsCleanString(hero.personId)) { reasons.push('v2_spec_hero_person_required'); ok = false; }
    if (!saIsCleanString(hero.candidateId)) { reasons.push('v2_spec_hero_candidate'); ok = false; }
    if (!saIsCleanString(hero.sourceAssetId)) { reasons.push('v2_spec_hero_asset'); ok = false; }
  }

  const canvas = saCaptureRecord(raw.canvas, V2_CANVAS_KEYS);
  if (canvas === null) { reasons.push('v2_spec_canvas'); ok = false; }
  else {
    if (!saIsCleanString(canvas.templateId)) { reasons.push('v2_spec_canvas_templateId'); ok = false; }
    if (!saIsSafeUint(canvas.canvasW) || canvas.canvasW < 1 || canvas.canvasW > V2_MAX_CANVAS) { reasons.push('v2_spec_canvas_w'); ok = false; }
    if (!saIsSafeUint(canvas.canvasH) || canvas.canvasH < 1 || canvas.canvasH > V2_MAX_CANVAS) { reasons.push('v2_spec_canvas_h'); ok = false; }
    if (!saIsSafeUint(canvas.feather) || canvas.feather > V2_MAX_FEATHER) { reasons.push('v2_spec_canvas_feather'); ok = false; }
  }

  const counts = saCaptureRecord(raw.counts, V2_COUNTS_KEYS);
  if (counts === null) { reasons.push('v2_spec_counts'); ok = false; }
  else {
    for (const k of V2_COUNTS_KEYS) if (!saIsSafeUint(counts[k])) { reasons.push('v2_spec_counts_num'); ok = false; break; }
  }

  const diagnostics = saCaptureRecord(raw.diagnostics, V2_DIAG_KEYS);
  let diagCodes = null;
  if (diagnostics === null) { reasons.push('v2_spec_diagnostics'); ok = false; }
  else if (saArrayTooLong(diagnostics.codes, V2_MAX_DIAG_CODES)) { reasons.push('v2_spec_diag_codes_too_many'); ok = false; }
  else {
    const codes = saCaptureArrayBounded(diagnostics.codes, V2_MAX_DIAG_CODES);
    if (codes === null) { reasons.push('v2_spec_diag_codes'); ok = false; }
    else {
      diagCodes = [];
      for (let ci = 0; ci < codes.length; ci++) {
        if (!saIsCleanString(codes[ci])) { reasons.push('v2_spec_diag_code_invalid'); ok = false; break; }
        diagCodes.push(codes[ci]);
      }
    }
  }

  let slots = null;
  if (saArrayTooLong(raw.slots, SA_MAX_SLOTS)) { reasons.push('v2_spec_slots_too_many'); ok = false; }
  else {
    const rawSlots = saCaptureArrayBounded(raw.slots, SA_MAX_SLOTS);
    if (rawSlots === null) { reasons.push('v2_spec_slots_not_array'); ok = false; }
    else if (rawSlots.length < 1) { reasons.push('v2_spec_slots_empty'); ok = false; }
    else {
      slots = [];
      for (let i = 0; i < rawSlots.length; i++) {
        const s = saCaptureSpecSlotV2(rawSlots[i], i, reasons);
        if (s) slots.push(s);
      }
      if (slots.length !== rawSlots.length) { slots = null; ok = false; }
    }
  }

  if (!ok || !slots || !diagCodes) return null;
  return {
    v: SELECTION_SPEC_V2_VERSION, mode: raw.mode, source: raw.source, refId: raw.refId, strictReady: true,
    authority: {
      selectionAuthorityHash: authority.selectionAuthorityHash, storyAuthorityHash: authority.storyAuthorityHash,
      castManifestHash: authority.castManifestHash, assignmentHash: authority.assignmentHash, heroContractHash: authority.heroContractHash,
    },
    hero: { heroSlotId: hero.heroSlotId, personId: hero.personId, candidateId: hero.candidateId, sourceAssetId: hero.sourceAssetId },
    canvas: { templateId: canvas.templateId, canvasW: canvas.canvasW, canvasH: canvas.canvasH, feather: canvas.feather },
    counts: {
      total: counts.total, mapped: counts.mapped, unmapped: counts.unmapped, missingPrimary: counts.missingPrimary,
      duplicateCandidate: counts.duplicateCandidate, duplicateSourceAsset: counts.duplicateSourceAsset,
      duplicatePrimaryUrl: counts.duplicatePrimaryUrl, semanticFallback: counts.semanticFallback,
    },
    diagnostics: { codes: diagCodes.slice() },
    specHash: raw.specHash, replayHash: raw.replayHash, slots,
  };
}

function saCaptureSpecSlotV2(v, i, reasons) {
  const raw = saCaptureRecord(v, V2_SLOT_KEYS);
  if (raw === null) { reasons.push(`v2_spec_slot_keys:${i}`); return null; }
  let ok = true;
  if (!saIsCleanString(raw.refSlotId)) { reasons.push(`v2_spec_slot_refSlotId:${i}`); ok = false; }
  if (!saIsCleanString(raw.composerSlotId)) { reasons.push(`v2_spec_slot_composerSlotId:${i}`); ok = false; }
  if (!saIsSafeUint(raw.order) || raw.order < 1 || raw.order > SA_MAX_SLOTS) { reasons.push(`v2_spec_slot_order:${i}`); ok = false; }
  if (!saIsCleanString(raw.role)) { reasons.push(`v2_spec_slot_role:${i}`); ok = false; }
  if (!SA_SHAPES.includes(raw.shape)) { reasons.push(`v2_spec_slot_shape:${i}`); ok = false; }

  const render = saCaptureRecord(raw.render, V2_RENDER_KEYS);
  if (render === null) { reasons.push(`v2_spec_slot_render:${i}`); ok = false; }
  else {
    for (const k of ['x', 'y', 'zIndex', 'borderWidth']) if (!saIsSafeUint(render[k])) { reasons.push(`v2_spec_slot_render_num:${i}`); ok = false; break; }
    if (!saIsSafeUint(render.w) || render.w < 1 || !saIsSafeUint(render.h) || render.h < 1) { reasons.push(`v2_spec_slot_render_dim:${i}`); ok = false; }
    if (typeof render.border !== 'boolean') { reasons.push(`v2_spec_slot_render_border:${i}`); ok = false; }
  }

  const primary = saCaptureRecord(raw.primary, V2_PRIMARY_KEYS);
  if (primary === null) { reasons.push(`v2_spec_slot_primary:${i}`); ok = false; }
  else {
    if (!saIsCleanIdOrNull(primary.personId)) { reasons.push(`v2_spec_slot_primary_person:${i}`); ok = false; }
    if (!saIsCleanString(primary.candidateId)) { reasons.push(`v2_spec_slot_primary_candidate:${i}`); ok = false; }
    if (!saIsCleanString(primary.sourceAssetId)) { reasons.push(`v2_spec_slot_primary_asset:${i}`); ok = false; }
    if (!saIsCleanString(primary.imageUrl)) { reasons.push(`v2_spec_slot_primary_url:${i}`); ok = false; }
  }

  if (saArrayTooLong(raw.backups, 0)) { reasons.push(`v2_backup_nonempty:${i}`); ok = false; }
  else {
    const backups = saCaptureArrayBounded(raw.backups, 0);
    if (backups === null) { reasons.push(`v2_spec_slot_backups_not_array:${i}`); ok = false; }
    else if (backups.length !== 0) { reasons.push(`v2_backup_nonempty:${i}`); ok = false; }
  }

  if (!ok || render === null || primary === null) return null;
  return {
    refSlotId: raw.refSlotId, composerSlotId: raw.composerSlotId, order: raw.order, role: raw.role, shape: raw.shape,
    render: { x: render.x, y: render.y, w: render.w, h: render.h, zIndex: render.zIndex, border: render.border, borderWidth: render.borderWidth },
    primary: { personId: primary.personId, candidateId: primary.candidateId, sourceAssetId: primary.sourceAssetId, imageUrl: primary.imageUrl },
    backups: [],
  };
}

/**
 * Validate that an already-built SelectionSpec v2 can activate strict render.
 * EXTERNALLY PINNED: expectedSpecHash and expectedReplayHash are trusted witnesses
 * supplied out-of-band (SelectionAuthority alone binds neither composerSlotId nor
 * refId nor URL, so a re-signed provided spec cannot self-certify). The activator
 * independently re-derives the canonical spec from the authority envelope + the
 * realized template + the spec's own primary bindings, then requires: the provided
 * spec equals that re-derivation (drift), AND both the re-derived and provided
 * specHash/replayHash equal the external pins. Fail-closed → HOLD.
 */
export function validateSelectionSpecV2Activation(input = {}) {
  const top = saCaptureRecord(input, V2_VALIDATE_INPUT_KEYS);
  if (top === null) return saHold(['v2_input_keys'], 'selectionSpec');

  const reasons = [];
  if (!saIs64Hex(top.expectedSpecHash)) reasons.push('v2_expected_spec_hash');
  if (!saIs64Hex(top.expectedReplayHash)) reasons.push('v2_expected_replay_hash');
  if (reasons.length) return saHold(reasons, 'selectionSpec');

  const provided = saCaptureSpecV2(top.selectionSpec, reasons);
  if (!provided) return saHold(reasons, 'selectionSpec');

  const auth = saValidateAuthorityForV2(top.selectionAuthority, top.expectedSelectionAuthorityHash, reasons);
  if (!auth) return saHold(reasons, 'selectionSpec');

  const realized = saCaptureRealized(top.realizedTemplate, reasons);
  if (reasons.length || !realized) return saHold(reasons, 'selectionSpec');

  const bindings = provided.slots.map((s) => ({
    refSlotId: s.refSlotId, composerSlotId: s.composerSlotId,
    candidateId: s.primary.candidateId, sourceAssetId: s.primary.sourceAssetId, imageUrl: s.primary.imageUrl,
  }));
  const canonical = saAssembleSpecV2(auth.body, auth.selectionAuthorityHash, bindings, realized, provided.refId, reasons);
  if (!canonical) return saHold(reasons, 'selectionSpec');

  // External pins bind everything the SelectionAuthority does not (composerSlotId,
  // refId, geometry, URL). Re-derived AND provided must both match the trusted pins.
  if (canonical.specHash !== top.expectedSpecHash) reasons.push('v2_spec_hash_pin_mismatch');
  if (canonical.replayHash !== top.expectedReplayHash) reasons.push('v2_replay_hash_pin_mismatch');
  if (provided.specHash !== top.expectedSpecHash) reasons.push('v2_spec_hash_mismatch');
  if (provided.replayHash !== top.expectedReplayHash) reasons.push('v2_replay_hash_mismatch');
  if (saHashJson(provided) !== saHashJson(canonical)) reasons.push('v2_spec_drift');
  if (reasons.length) return saHold(reasons, 'selectionSpec');

  return { ok: true, decision: 'assigned', selectionSpec: saDeepFreeze(canonical) };
}

// ═══ Version dispatch ════════════════════════════════════════════════════════
// Safely read the own DATA property `v` of input.selectionSpec (descriptor-first,
// no getter invocation, never throws). Returns the raw value or undefined.
function saPeekSpecVersion(input) {
  try {
    if (input === null || (typeof input !== 'object' && typeof input !== 'function')) return undefined;
    const specDesc = Object.getOwnPropertyDescriptor(input, 'selectionSpec');
    if (!specDesc || !('value' in specDesc)) return undefined;
    const spec = specDesc.value;
    if (spec === null || typeof spec !== 'object') return undefined;
    const vDesc = Object.getOwnPropertyDescriptor(spec, 'v');
    if (!vDesc || !('value' in vDesc)) return undefined;
    return vDesc.value;
  } catch {
    return undefined;
  }
}

/**
 * Version-dispatching strict-render activation. Reads the spec's own data property
 * `v`: iff it is EXACTLY the number 2, route to the v2 activation validator; for
 * anything else (1, undefined, 0, 3, a `version` property, a string '2') delegate
 * VERBATIM to validateStrictRenderActivation so current v1 behaviour is preserved
 * byte-for-byte and never downgraded.
 */
export function validateStrictRenderActivationVersioned(input = {}) {
  if (saPeekSpecVersion(input) === SELECTION_SPEC_V2_VERSION) {
    return validateSelectionSpecV2Activation(input);
  }
  return validateStrictRenderActivation(input);
}
