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
export function buildFinalAssignmentTrace({ plannedSlots = {}, manifestSlots = [], placed = [], refSlotContract = null } = {}) {
  const plans = Object.entries(plannedSlots && typeof plannedSlots === 'object' ? plannedSlots : {})
    .map(([role, value]) => ({
      role: cleanRole(role, role),
      id: value?.id == null ? null : String(value.id),
      imageUrl: String(value?.imageUrl || ''),
    }));
  const placedBySlot = new Map((Array.isArray(placed) ? placed : []).map((item) => [String(item?.slot || ''), item]));
  const finals = Array.isArray(manifestSlots) ? manifestSlots : [];

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
