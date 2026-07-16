// ============================================================
// 🎯 refTestPipeline — ท่อทดสอบปก "ผ่าน MEGA จริงทุกขั้น" (shared core)
// ------------------------------------------------------------
// ไฟล์นี้คือ "ตรรกะท่อกลาง" ที่ทั้งสองโหมดใช้ร่วมกันเป๊ะ:
//   • SYNC  : POST /api/cover-ref-test เรียก runCoverRefTest() ตรง (พฤติกรรม/ทุก field เดิม — delegate)
//   • QUEUE : /api/mega/tick เดิน rt_* stage ทีละขั้น (STAGE_FLOW map) — ผู้ใช้ปิดบราวเซอร์ได้
// รวม strict seam (makeStrictFetchJson) + compose in-process (composeAndVerify) + QC hard gate
// (evaluateCoverQc) + archive เฉพาะสำเร็จ — โค้ดชุดเดียวกัน แชร์จากที่นี่.
//
// ⚠️ ย้ายมาจาก src/app/api/cover-ref-test/route.js แบบ move+delegate: runCoverRefTest / runS7CaptureOnly
//    และตัวช่วยทั้งหมด "ยกมาเป๊ะ" (byte-for-byte) เพื่อให้ sync mode พฤติกรรมเดิมทุกประการ —
//    ผู้พิทักษ์คือ tests/ac0099-strict-ref-test.test.mjs + tests/ac0084-capture-seam.test.mjs.
// ============================================================

import { compassBrain } from '@/lib/megaBrains';
import { s5_case, s5_keywords, s5_search, s5_triage, s5_clipframe, s6_slots, s7_cover } from '@/lib/megaAdapters';
import { evaluateCoverQc } from '@/lib/coverQcGate';        // ★ Lane D (frozen) — advisory ใน legacy, gate ใน strict
import { composeAndVerify } from '@/lib/services/megaComposerService'; // ★ Lane D (frozen) — always-exported named binding
// ★ link-compat: read the shared pure activation seam (_strictActivate) from the module NAMESPACE at RUNTIME, not as a
//   link-time named import. An ordinary-route test double that stubs only composeAndVerify then still links (a missing
//   name is `undefined`, not an ESM link error). Production binds the exact real _strictActivate; capture-only asserts
//   its availability and fails closed (never a fallback/reimplementation) before using it.
import * as _composerModule from '@/lib/services/megaComposerService';
import { buildImagesRouteResponse } from '@/lib/imageStore'; // ★ อ่านคลังรูป in-process (โมดูลจริงที่ /api/images/[id] ใช้)

const QUEUE_ADD_PATH = '/api/queue/add';
const IMAGE_CASE_RE = /^\/api\/images\/[^/]+$/;
const INLINE_ACK = { success: true, jobId: 'REFTEST-INLINE' }; // ★ ack ปลอมเดียวที่ S7 มองเห็น

// exact host ของท่อ capture-only (operator) — ใช้ร่วมกับ claim gate ฝั่ง route.js
export const _CAPTURE_HOST = 'http://127.0.0.2:3900';

// ── typed error สำหรับ seam (whitelist/pair/queue) — map เป็น 422 ที่ orchestrator ──
function seamError(errorType, message, extra = {}) {
  const e = new Error(message || errorType);
  e.reftestSeam = true;
  e.errorType = errorType;
  e.holdReason = extra.holdReason || errorType;
  Object.assign(e, extra);
  return e;
}

// ── Lane B interface: resolveStrictLatches / STRICT_LATCH_KEYS (canonical = MEGA_STRICT_RENDER) ──
//   เขียนแบบ defensive: Lane B (resolveStrictLatches) integrate แล้ว — fallback อ่าน canonical latch เองเฉพาะเมื่อโมดูล/ฟังก์ชันไม่พร้อมหรือ dynamic import ล้มเท่านั้น
//   (MEGA_STRICT_RENDERER ห้าม arm strict เด็ดขาด — ไม่ถูกอ่านทั้งใน Lane B และ fallback)
async function resolveLatchReport(env) {
  try {
    const mod = await import('@/lib/refSlotContract');
    if (typeof mod.resolveStrictLatches === 'function') {
      // Lane B shape: { armedProducer, armedRenderer, armedRefShotAuthority, values, unknownStrictLikeKeys }
      const r = mod.resolveStrictLatches(env) || {};
      return {
        canonicalLatch: 'MEGA_STRICT_RENDER',   // point 6: sole canonical wire latch
        armed: !!r.armedRenderer,               // "armed" = canonical renderer latch (=== '1' exactly)
        armedRenderer: !!r.armedRenderer,
        armedProducer: !!r.armedProducer,       // full ordinary-strict wire (4 core latches)
        armedRefShotAuthority: !!r.armedRefShotAuthority,
        latchKeys: Array.isArray(mod.STRICT_LATCH_KEYS) ? [...mod.STRICT_LATCH_KEYS] : null,
        latchValues: r.values || null,
        unknownStrictLikeKeys: Array.isArray(r.unknownStrictLikeKeys) ? r.unknownStrictLikeKeys : [], // จับ alias เช่น MEGA_STRICT_RENDERER
        rendererIgnored: true,                  // MEGA_STRICT_RENDERER ไม่มีสิทธิ์ arm (โผล่ใน unknownStrictLikeKeys)
        _source: 'refSlotContract.resolveStrictLatches',
      };
    }
  } catch { /* dynamic import ล้ม/โมดูลไม่พร้อม — ตก fallback canonical (ไม่ได้แปลว่า Lane B ไม่มี) */ }
  return {
    canonicalLatch: 'MEGA_STRICT_RENDER',
    armed: env.MEGA_STRICT_RENDER === '1',
    armedRenderer: env.MEGA_STRICT_RENDER === '1',
    armedProducer: false,
    armedRefShotAuthority: false,
    latchKeys: ['MEGA_STRICT_RENDER'],
    latchValues: { MEGA_STRICT_RENDER: env.MEGA_STRICT_RENDER ?? null },
    unknownStrictLikeKeys: [],
    rendererIgnored: true,
    _source: 'fallback',
  };
}

// ── ดึง "ค่า authority ที่ต้อง carry ผ่านโดยไม่แก้" (point 4) จาก payload/dossier จริงของ S7 ──
//   ห้ามใช้ค่า SLOT_ORDER ของ legacy เป็น semantic instance id — อ่านจาก pickImages.slotOrder จริงเท่านั้น
function extractAuthorityLatches(payload, dossier) {
  const hasSpec = payload && Object.prototype.hasOwnProperty.call(payload, 'selectionSpec');
  const hasV2 = payload && Object.prototype.hasOwnProperty.call(payload, 'refHeroV2');
  // ★ (item 5) V2 carrier: the canonical selectionSpec lives INSIDE refHeroV2 — surface authority from there so a
  //   V2 wire reports the same latch fields (refId/specHash/replayHash/refSlotIds/composerSlotIds) as a V1 wire.
  const v2 = hasV2 && payload.refHeroV2 && typeof payload.refHeroV2 === 'object' && !Array.isArray(payload.refHeroV2) ? payload.refHeroV2 : null;
  const spec = hasSpec ? payload.selectionSpec : (v2 ? v2.selectionSpec : null);
  const pick = (dossier && dossier.pickImages) || {};
  const slots = Array.isArray(spec?.slots) ? spec.slots : [];
  return {
    slotOrder: Array.isArray(pick.slotOrder) ? pick.slotOrder : null, // semantic instance ids (ของจริงจาก S6)
    heroSlotId: pick.heroSlotId ?? (spec?.hero?.heroSlotId ?? null),
    slotContractHash: pick.slotContractHash ?? null,
    plannedByRefSlot: spec?.plannedByRefSlot ?? pick.plannedByRefSlot ?? null,
    specHash: spec?.specHash ?? null,
    replayHash: spec?.replayHash ?? null,
    backupPoolHash: spec?.backupPoolHash ?? null,
    refId: spec?.refId ?? (dossier?.refMatch?.refId ?? dossier?.refMatch?.dnaHash ?? null),
    refSlotIds: slots.map((s) => s?.refSlotId).filter((x) => x != null && x !== ''),
    composerSlotIds: slots.map((s) => s?.composerSlotId).filter((x) => x != null && x !== ''),
  };
}

// ── 🔒 fail-closed whitelist fetchJson: ดัก S7 ให้อ่านคลังรูป in-process + ยิงคิว 1 ครั้ง (จับ body) ──
//   whitelist (EXACT: origin + path + method, ห้าม query):
//     GET  <origin>/api/images/<caseId>       (caseId ต้อง === dossier.images.caseId) → อ่าน in-process
//     POST <coverOrigin>/api/queue/add        (ครั้งเดียว) → เก็บ body string ต้นฉบับ, parse ตรวจ both-or-neither, คืน ack ปลอม
//   origin/URL/method/query อื่น · queue ครั้งที่ 2 · body พัง · passthrough network ใดๆ ⇒ typed error (throw)
//   ไม่ self-HTTP · ไม่แตะ global.fetch
function makeStrictFetchJson({ job, origin, coverOrigin, readImageCase, captured }) {
  return async function fetchJson(url, opts = {}) {
    let u;
    try { u = new URL(String(url)); } catch { throw seamError('SEAM_BAD_URL', `bad url: ${String(url).slice(0, 80)}`); }
    const method = String(opts?.method || 'GET').toUpperCase();
    const path = u.pathname;

    // (A) อ่านคลังรูปของเคส — in-process เท่านั้น (ไม่ HTTP) · EXACT origin+path+method, ห้าม query
    if (method === 'GET' && IMAGE_CASE_RE.test(path)) {
      if (u.origin !== origin) throw seamError('SEAM_IMAGE_ORIGIN_MISMATCH', `origin '${u.origin}' != '${origin}'`);
      if (u.search) throw seamError('SEAM_IMAGE_QUERY_NOT_ALLOWED', `query blocked: ${u.search}`);
      const caseId = decodeURIComponent(path.split('/').pop() || '');
      const expected = job?.dossier?.images?.caseId != null ? String(job.dossier.images.caseId) : null;
      if (!expected || caseId !== expected) throw seamError('SEAM_IMAGE_CASE_MISMATCH', `caseId '${caseId}' != expected '${expected}'`);
      const { status, body } = await readImageCase(caseId);
      return { httpStatus: status, ...(body || {}) }; // เลียนแบบ jfetch: { httpStatus, ...json }
    }

    // (B) ส่งคิวทำปก — ครั้งเดียวเท่านั้น, จับ body ต้นฉบับ, ตรวจ both-or-neither, คืน ack ปลอม · EXACT origin+path, ห้าม query
    if (method === 'POST' && path === QUEUE_ADD_PATH) {
      if (u.origin !== coverOrigin) throw seamError('SEAM_QUEUE_ORIGIN_MISMATCH', `origin '${u.origin}' != '${coverOrigin}'`);
      if (u.search) throw seamError('SEAM_QUEUE_QUERY_NOT_ALLOWED', `query blocked: ${u.search}`);
      if (captured.queueCount >= 1) throw seamError('SEAM_SECOND_QUEUE_CALL', 'queue/add ถูกเรียกครั้งที่สอง');
      captured.queueCount += 1;
      const bodyStr = typeof opts?.body === 'string' ? opts.body : null;
      if (bodyStr == null) throw seamError('SEAM_QUEUE_BODY_NOT_STRING', 'queue body ไม่ใช่ string');
      captured.queueBody = bodyStr; // ★ เก็บ ORIGINAL wire body string ไม่แก้
      let payload;
      try { payload = JSON.parse(bodyStr); } catch { throw seamError('SEAM_QUEUE_BODY_INVALID_JSON', 'queue body parse ล้ม'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw seamError('SEAM_QUEUE_BODY_NOT_OBJECT', 'queue body ไม่ใช่ plain object');
      // ★ both-or-neither own-property บน parsed payload — mixed = typed error
      const hasSpec = Object.prototype.hasOwnProperty.call(payload, 'selectionSpec');
      const hasRealized = Object.prototype.hasOwnProperty.call(payload, 'realizedTemplate');
      const hasV2 = Object.prototype.hasOwnProperty.call(payload, 'refHeroV2');
      if (hasSpec !== hasRealized) {
        throw seamError('SEAM_STRICT_PAIR_MIXED', `selectionSpec=${hasSpec} realizedTemplate=${hasRealized} (ต้องครบคู่หรือไม่มีทั้งคู่)`);
      }
      // ★ (item 5) a V2 (refHeroV2) carrier must NOT ride the same wire as a V1 pair — mirror the composer's
      //   STRICT_RENDER_CARRIER_AMBIGUOUS (never let both versions co-exist on one wire)
      if (hasV2 && (hasSpec || hasRealized)) {
        throw seamError('SEAM_STRICT_CARRIER_AMBIGUOUS', `refHeroV2 + selectionSpec/realizedTemplate อยู่บน wire เดียวกัน (กำกวม V1/V2)`);
      }
      captured.queuePayload = payload; // ★ parse ไว้ "สำหรับเรียก composer in-process" เท่านั้น
      return { ...INLINE_ACK }; // ★ ack ปลอมเดียวที่ S7 เห็น (composer/QC ท่อนี้เก็บไว้ตรวจเอง)
    }

    // (C) อื่นๆ ทั้งหมด — fail-closed, ห้าม passthrough
    throw seamError('SEAM_WHITELIST_REJECT', `blocked ${method} ${path}`);
  };
}

// ── ตัวช่วยประกอบ body 422 (HOLD/QC/COVER) — แนบ holdReason + effectiveMode + canonical latch + authority ──
function holdBody({ error, errorType, holdReason, effectiveMode, latchReport, authority, extra, trace }) {
  return {
    success: false,
    error,
    errorType,
    holdReason: holdReason || null,
    effectiveMode,
    strictLatches: latchReport || null,   // canonical latch state (Lane B) — informational
    authority: authority || null,         // slotOrder/heroSlotId/refSlotId/composerSlotId/hashes/plannedByRefSlot
    ...(extra || {}),
    trace,
  };
}

// ★ Preview MVP — outward effectiveMode label: 'strict' เฉพาะ strict engaged จริงเท่านั้น (ไม่แตะ gate/behavior
//   ใดๆ) · ไม่ engaged = 'preview_advisory' (เดิม 'legacy') — สื่อสารตรงว่าเป็นผล advisory/preview ไม่ใช่ strict
//   Production parity · renderMode = ค่าความจริงภายในเดิม ('strict'|'legacy') แยกไว้สำหรับ debug/log เท่านั้น
function computeEffectiveMode(isStrictEngaged) {
  const renderMode = isStrictEngaged ? 'strict' : 'legacy';
  const effectiveMode = isStrictEngaged ? 'strict' : 'preview_advisory';
  return { effectiveMode, renderMode };
}

// ★ Preview MVP item 3 — fields ร่วมของ response 200 ทั้งสองเส้นทาง (QC-pass จริง + QC-fail preview_advisory
//   แบบ mirror /mega-compose-test): ต่างกันแค่ productionQcPass/coverPath/archiveId (QC-fail preview_advisory =
//   null ทั้งคู่ เพราะไม่ persist/archive เด็ดขาด) — outputId ผูก archive id จริงถ้ามี ไม่งั้นผูก REFTEST job id เดิม
function buildCoverResponseBody({ cover, qcVerdict, productionQcPass, effectiveMode, renderMode, latchReport, authority, matchedRef, job, sourceLinks, trace, t0, coverPath, archiveId }) {
  const outputId = archiveId || job.id;
  return {
    ...cover,               // base64, template, score, directorReason, assignments, caseId...
    success: true,
    qcVerdict,
    productionQcPass,       // ★ item 3: mirror /mega-compose-test — Production hard gate จะ 422 เมื่อ false
    effectiveMode,          // ★ 'strict' | 'preview_advisory' (genuine arming — ไม่มีทาง fabricate)
    renderMode,             // ★ ค่าความจริงภายใน ('strict'|'legacy') — debug/log เท่านั้น
    strictLatches: latchReport,
    authority,
    holdReason: null,
    coverPath,
    outputId,                                  // ★ item 3: nonempty เสมอ — ผูก archive id จริงหรือ REFTEST job id
    ...(archiveId ? { archiveId } : {}),        // ★ item 3: โผล่เฉพาะเมื่อมี archive entry จริงเท่านั้น
    matchedRef,
    throughMega: true,
    imageCaseId: job.dossier.images?.caseId || null,
    keywordsCount: job.dossier.images?.keywordsCount ?? null,
    poolSize: job.dossier.pickImages?.poolSize ?? null,
    queueJobId: job.dossier.cover?.queueJobId || null, // 'REFTEST-INLINE' (in-process ack)
    sourceLinks,
    elapsedTotal: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    trace,
  };
}

// ============================================================
// R1.6 SAFE CAPTURE-ONLY — TRUE fail-closed branch, replaces the old additive captureEvidence-after-full-run
// design. When the one-shot claim grants, this path NEVER calls the ordinary full runner (no compass/S5/S6/
// compose/QC/persist/archive/fs/db/real-queue/real-network of any kind) — it ONLY replays an operator-supplied,
// already-completed post-S6 dossier through the REAL s7_cover producer + the existing fail-closed in-process
// queue interceptor (makeStrictFetchJson), and returns the exact raw wire the moment S7 serializes it.
//
// Honesty contract: the returned evidence is a REPLAY of operator-supplied input, not a fresh/live-authenticated
// pipeline run, and carries NO cryptographic authenticity guarantee — it proves the S7 contract given the
// supplied inputs, nothing about how those inputs were originally produced. If a genuine post-S6 dossier is not
// supplied (or fails any guard below), this returns a typed 4xx/422 HOLD — it never synthesizes one.
// ============================================================
const CAPTURE_ONLY_SCHEMA = 'ac0084-s7-capture-v1';
// R1.6A: this bounds the UTF-8 byte length of the POST-PARSE payload only — the value req.json() already
//   produced by the time _captureSafeClone runs. It is NOT a bound on the raw HTTP request/transport size
//   (framework/body-parser limits, if any, apply upstream of this function).
const CAPTURE_MAX_BYTES = 1_000_000;

// serializability + size + cycle guard, AND an isolated deep clone (JSON round-trip) so the caller's original
// object can never be mutated by anything downstream — malformed/non-plain/cyclic/oversized all fail closed here
function _captureSafeClone(value, maxBytes) {
  let json;
  try { json = JSON.stringify(value); } catch { return { ok: false, errorType: 'CAPTURE_INPUT_NOT_SERIALIZABLE' }; }
  if (typeof json !== 'string') return { ok: false, errorType: 'CAPTURE_INPUT_NOT_SERIALIZABLE' };
  if (new TextEncoder().encode(json).length > maxBytes) return { ok: false, errorType: 'CAPTURE_INPUT_TOO_LARGE' };
  try { return { ok: true, clone: JSON.parse(json) }; } catch { return { ok: false, errorType: 'CAPTURE_INPUT_NOT_SERIALIZABLE' }; }
}

// pure in-memory image-case reader — serves ONLY the operator-supplied frozen snapshot, exact caseId match
// required. Never touches buildImagesRouteResponse/imageStore/fs/db/network. (Snapshot ROW corroboration —
// non-empty/plain/canonical id+url/no-duplicates — happens earlier in runS7CaptureOnly, before this is ever
// wired up; this reader just serves whatever already passed that guard.)
function makeCaptureReadImageCase(snapshot, expectedCaseId) {
  return async (caseId) => {
    if (String(caseId) !== String(expectedCaseId)) {
      throw seamError('CAPTURE_IMAGE_CASE_MISMATCH', `caseId '${caseId}' != expected '${expectedCaseId}'`, { holdReason: 'image_case_id_mismatch' });
    }
    return { status: 200, body: { success: true, images: Array.isArray(snapshot?.images) ? snapshot.images : [] } };
  };
}

function captureBody(errorType, error, extra = {}) {
  return { success: false, error, errorType, holdReason: extra.holdReason || errorType, mode: 'capture_only', ...extra };
}

// ============================================================
// runS7CaptureOnly — the TRUE fail-closed capture-only path. Exported + independently testable/injectable.
// Never calls compassBrain/s5_*/s6_slots/composeAndVerify/evaluateCoverQc/persistCoverImage/loadArchive.
// Never touches buildImagesRouteResponse/global fetch/fs/db. Only real s7_cover + the same in-process seam
// interceptor the ordinary path already uses.
// ============================================================
export async function runS7CaptureOnly(input = {}, deps = {}) {
  const trace = [];
  const { s7_cover: _s7 = s7_cover, env: _env = process.env } = deps;

  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 400, body: captureBody('CAPTURE_INPUT_NOT_PLAIN_OBJECT', 'capture-only input must be a plain object') };
  }
  const cloneResult = _captureSafeClone(input, CAPTURE_MAX_BYTES);
  if (!cloneResult.ok) {
    return { status: 400, body: captureBody(cloneResult.errorType, 'capture-only input failed the serializability/size/cycle guard') };
  }
  const payload = cloneResult.clone; // isolated clone — the caller's original object is never touched/mutated

  if (payload.schema !== CAPTURE_ONLY_SCHEMA) {
    return { status: 400, body: captureBody('CAPTURE_SCHEMA_MISMATCH', `payload.schema must be exactly '${CAPTURE_ONLY_SCHEMA}'`) };
  }

  // strict switches must ALL be exactly '1' — these are the same real env vars megaAdapters.s7_cover itself
  // reads directly from process.env (not injectable), so callers/tests must set real process.env to match
  const switchesOn = _env.MEGA_SEMANTIC_SELECTION === '1' && _env.MEGA_SELECTION_SPEC === '1'
    && _env.MEGA_STRICT_PRODUCER === '1' && _env.MEGA_STRICT_RENDER === '1';
  if (!switchesOn) {
    return { status: 422, body: captureBody('CAPTURE_STRICT_SWITCHES_NOT_ARMED', 'MEGA_SEMANTIC_SELECTION/MEGA_SELECTION_SPEC/MEGA_STRICT_PRODUCER/MEGA_STRICT_RENDER must all be exactly \'1\'') };
  }
  // R1.6A: this capture closes ref-authority/W3-3, not ordinary strict only — MEGA_REF_SHOT_AUTHORITY is a
  // FIFTH required latch, checked separately from the four above so a mismatch is diagnosable on its own.
  if (_env.MEGA_REF_SHOT_AUTHORITY !== '1') {
    return { status: 422, body: captureBody('CAPTURE_REF_AUTHORITY_NOT_ARMED', 'MEGA_REF_SHOT_AUTHORITY must be exactly \'1\' — this capture-only path closes ref-authority/W3-3, not ordinary strict alone') };
  }
  if (_env.MEGA_COVER_ORIGIN !== _CAPTURE_HOST) {
    return { status: 422, body: captureBody('CAPTURE_COVER_ORIGIN_MISMATCH', `MEGA_COVER_ORIGIN must be exactly '${_CAPTURE_HOST}'`) };
  }

  const job = payload.job;
  const dossier = job && typeof job === 'object' && !Array.isArray(job) ? job.dossier : null;
  if (!dossier || typeof dossier !== 'object' || Array.isArray(dossier)) {
    return { status: 400, body: captureBody('CAPTURE_DOSSIER_MISSING', 'payload.job.dossier (a completed post-S6 dossier) is required') };
  }
  const caseId = dossier.images?.caseId;
  if (!caseId || typeof caseId !== 'string') {
    return { status: 400, body: captureBody('CAPTURE_IMAGE_CASE_ID_MISSING', 'payload.job.dossier.images.caseId is required') };
  }
  const snapshot = payload.imageCaseSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { status: 400, body: captureBody('CAPTURE_IMAGE_SNAPSHOT_MISSING', 'payload.imageCaseSnapshot (a frozen, exact-matching image-case snapshot) is required') };
  }
  if (String(snapshot.caseId) !== String(caseId)) {
    return { status: 422, body: captureBody('CAPTURE_IMAGE_CASE_MISMATCH', 'imageCaseSnapshot.caseId does not match dossier.images.caseId') };
  }

  // R1.6A: snapshot corroboration — non-empty images array (the old silent `|| []` default in the reader is
  // gone: a missing/non-array/empty snapshot is now a fail-closed guard, not a quietly-served empty library),
  // every row plain with a canonical non-empty id+imageUrl, and no duplicate row id or duplicate row imageUrl.
  if (!Array.isArray(snapshot.images) || snapshot.images.length === 0) {
    return { status: 422, body: captureBody('CAPTURE_IMAGE_SNAPSHOT_EMPTY', 'imageCaseSnapshot.images must be a non-empty array') };
  }
  const snapshotById = new Map();
  const snapshotByUrl = new Map();
  for (const row of snapshot.images) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.id == null || String(row.id) === ''
      || typeof row.imageUrl !== 'string' || !row.imageUrl) {
      return { status: 422, body: captureBody('CAPTURE_SNAPSHOT_ROW_INVALID', 'every imageCaseSnapshot.images row must be a plain object with a non-empty canonical id + imageUrl') };
    }
    const rid = String(row.id);
    if (snapshotById.has(rid)) {
      return { status: 422, body: captureBody('CAPTURE_SNAPSHOT_DUPLICATE_ROW', `duplicate snapshot row id '${rid}'`) };
    }
    if (snapshotByUrl.has(row.imageUrl)) {
      return { status: 422, body: captureBody('CAPTURE_SNAPSHOT_DUPLICATE_ROW', `duplicate snapshot row imageUrl '${row.imageUrl}'`) };
    }
    snapshotById.set(rid, row);
    snapshotByUrl.set(row.imageUrl, row);
  }

  const pick = dossier.pickImages;
  const slots = pick?.slots;
  if (!pick || typeof slots !== 'object' || Array.isArray(slots) || slots === null || Object.keys(slots).length === 0
    || !Array.isArray(pick.slotOrder) || pick.slotOrder.length < 3
    || typeof pick.heroSlotId !== 'string' || !pick.heroSlotId
    || typeof pick.slotContractHash !== 'string' || !pick.slotContractHash) {
    return { status: 422, body: captureBody('CAPTURE_PICKIMAGES_INCOMPLETE', 'payload.job.dossier.pickImages must carry non-empty slots + slotOrder(>=3) + heroSlotId + slotContractHash') };
  }
  if (!pick.slotOrder.every((id) => typeof id === 'string' && id && Object.prototype.hasOwnProperty.call(slots, id))) {
    return { status: 422, body: captureBody('CAPTURE_PICKIMAGES_INCOMPLETE', 'pickImages.slotOrder entries must all exist as keys in pickImages.slots') };
  }
  // R1.6D: slotOrder must be duplicate-free (a duplicate would let the exact-set-size check below pass
  // while a real ghost key still hid among pickImages.slots).
  if (new Set(pick.slotOrder).size !== pick.slotOrder.length) {
    return { status: 422, body: captureBody('CAPTURE_PICKIMAGES_INCOMPLETE', 'pickImages.slotOrder must not contain duplicate entries') };
  }
  // ...and Object.keys(pickImages.slots) must equal slotOrder as an EXACT SET — no extra/ghost keys. Real
  // s7_cover gathers backup ids from Object.values(slots) (ALL slot keys, not just the ones in slotOrder —
  // see megaAdapters.js: `Object.values(slots).flatMap((s) => s?.backups || [])`), so a stale/extra
  // slots.ghost key sitting outside slotOrder would silently bypass the primary/backup corroboration below
  // (which only walks slotOrder) and still reach S7's own backup resolution. Reject that shape here, before
  // S7/queue is ever touched, rather than validating only the slotOrder subset.
  if (Object.keys(slots).length !== pick.slotOrder.length) {
    return { status: 422, body: captureBody('CAPTURE_SLOT_SET_MISMATCH', `pickImages.slots must contain EXACTLY the ${pick.slotOrder.length} keys listed in slotOrder — no extra/ghost keys (pickImages.slots has ${Object.keys(slots).length} keys)`) };
  }
  if (!pick.slotOrder.includes(pick.heroSlotId)) {
    return { status: 422, body: captureBody('CAPTURE_PICKIMAGES_INCOMPLETE', 'pickImages.heroSlotId must be one of pickImages.slotOrder') };
  }

  // duplicate/missing primary candidate id/url across the slots actually in play
  const candByUrl = new Map(); // imageUrl -> candidateId (first seen)
  const urlByCand = new Map(); // candidateId -> imageUrl (first seen)
  for (const key of pick.slotOrder) {
    const s = slots[key];
    if (!s || s.id == null || String(s.id) === '' || !s.imageUrl || typeof s.imageUrl !== 'string') {
      return { status: 422, body: captureBody('CAPTURE_SLOT_CANDIDATE_INVALID', `pickImages.slots.${key} is missing a candidate id/imageUrl`) };
    }
    const cid = String(s.id);
    if (urlByCand.has(cid) && urlByCand.get(cid) !== s.imageUrl) {
      return { status: 422, body: captureBody('CAPTURE_DUPLICATE_CANDIDATE', `duplicate candidate id '${cid}' bound to two different imageUrls`) };
    }
    urlByCand.set(cid, s.imageUrl);
    if (candByUrl.has(s.imageUrl) && candByUrl.get(s.imageUrl) !== cid) {
      return { status: 422, body: captureBody('CAPTURE_DUPLICATE_CANDIDATE', `duplicate imageUrl '${s.imageUrl}' bound to two different candidate ids`) };
    }
    candByUrl.set(s.imageUrl, cid);
  }

  // R1.6A: snapshot corroboration for primaries + backups — every primary's id+imageUrl must match EXACTLY
  // ONE snapshot row (cross-checked, not just "id exists"), and every referenced backup id (production shape:
  // pickImages.slots[key].backups is an array of bare candidate-id strings — see megaAdapters.js s7_cover,
  // which itself resolves backup ids against the same in-process image-case fetch) must match exactly one
  // snapshot row too. A slot with zero backups is valid (vacuous case) — this only rejects a backup id that IS
  // present but doesn't resolve.
  for (const key of pick.slotOrder) {
    const s = slots[key];
    const row = snapshotById.get(String(s.id));
    if (!row || row.imageUrl !== s.imageUrl) {
      return { status: 422, body: captureBody('CAPTURE_SNAPSHOT_PRIMARY_MISMATCH', `slot '${key}' primary (id=${JSON.stringify(s.id)}, imageUrl=${JSON.stringify(s.imageUrl)}) does not match exactly one snapshot row`) };
    }
    // R1.6C: own backups present but not an array — INCLUDING null — is a malformed shape, failed typed
    // BEFORE the array-or-empty coercion below (the old `Array.isArray(s.backups) ? s.backups : []` silently
    // treated any malformed non-array `backups` the same as "no backups", swallowing the corruption; an
    // earlier `s.backups != null` guard also wrongly let a null value slip through uncaught). An OMITTED key
    // (no own 'backups' property at all) is still legitimately treated as [] by the coercion below.
    if (Object.prototype.hasOwnProperty.call(s, 'backups') && !Array.isArray(s.backups)) {
      return { status: 422, body: captureBody('CAPTURE_SLOT_BACKUPS_INVALID', `slot '${key}' backups must be an array (got ${s.backups === null ? 'null' : typeof s.backups})`) };
    }
    const backups = Array.isArray(s.backups) ? s.backups : [];
    for (const b of backups) {
      if ((typeof b !== 'string' && typeof b !== 'number') || String(b) === '' || !snapshotById.has(String(b))) {
        return { status: 422, body: captureBody('CAPTURE_SNAPSHOT_BACKUP_MISMATCH', `slot '${key}' backup id ${JSON.stringify(b)} does not match exactly one snapshot row`) };
      }
    }
  }

  const rm = dossier.refMatch;
  const boundRefId = rm?.refId || rm?.dnaHash || null;
  if (!rm || typeof rm !== 'object' || !rm.dna || typeof rm.dna !== 'object' || !boundRefId || !rm.dnaHash || !rm.refBoundAt) {
    return { status: 422, body: captureBody('CAPTURE_REF_IDENTITY_MISSING', 'dossier.refMatch must carry dna + refId/dnaHash + dnaHash + refBoundAt') };
  }

  // R1.6A: this capture closes ref-authority/W3-3 — BOTH artBrief.refShotAuthority and pickImages.refShotAuthority
  // are now REQUIRED (not merely "paired if present"). We only validate their PRESENCE/plain-shape here — the
  // actual equality/staleness/freshness decision (canonical marker equality, contract rebuild, effectiveViewHash,
  // slotContractHash) is NOT recreated here; it is left entirely to the real s7_cover producer's own canonical
  // authority validation below (a mismatch there surfaces as a real 'waiting' summary -> CAPTURE_S7_NOT_DONE).
  const isMarkerShape = (m) => m != null && typeof m === 'object' && !Array.isArray(m);
  const abMarker = dossier.artBrief && typeof dossier.artBrief === 'object' && !Array.isArray(dossier.artBrief) ? dossier.artBrief.refShotAuthority : undefined;
  const piMarker = pick.refShotAuthority;
  if (!isMarkerShape(abMarker) || !isMarkerShape(piMarker)) {
    return { status: 422, body: captureBody('CAPTURE_REF_SHOT_MARKER_MISSING', 'both dossier.artBrief.refShotAuthority and dossier.pickImages.refShotAuthority are required (plain-object shape) — equality/staleness is judged by the real S7 producer, not this guard') };
  }

  // ---- every fail-closed guard above has passed — ONLY now do we touch the real producer, via the SAME
  //      fail-closed in-process seam interceptor the ordinary path uses, and a pure in-memory reader of the
  //      operator-supplied frozen snapshot. job/dossier passed to s7_cover is the isolated clone from step 1 —
  //      the caller's original object is never mutated. ----
  const captured = { queueCount: 0, queueBody: null, queuePayload: null };
  const readImageCase = makeCaptureReadImageCase(snapshot, caseId);
  const fetchJson = makeStrictFetchJson({ job, origin: _CAPTURE_HOST, coverOrigin: _CAPTURE_HOST, readImageCase, captured });

  let s7;
  try {
    s7 = await _s7(job, { origin: _CAPTURE_HOST, _deps: { fetchJson, queueTransport: 'cover_ref_test_in_process' } });
  } catch (err) {
    if (err && err.reftestSeam) {
      trace.push({ stage: 's7_cover_capture_only', status: 'seam_reject', summary: `${err.errorType}: ${(err.message || '').slice(0, 120)}` });
      return { status: 422, body: captureBody(err.errorType || 'CAPTURE_SEAM_REJECT', err.message || 'strict seam ปฏิเสธ', { holdReason: err.holdReason || err.errorType, trace }) };
    }
    throw err;
  }
  trace.push({ stage: 's7_cover_capture_only', status: s7?.status, summary: (s7?.summary || '').slice(0, 160) });

  if (!s7 || s7.status !== 'done') {
    return { status: 422, body: captureBody('CAPTURE_S7_NOT_DONE', s7?.summary || 'S7 ไม่พร้อมส่งปก', { holdReason: s7?.summary || s7?.status || 'not_done', trace, s7Status: s7?.status || null, queueCalls: captured.queueCount }) };
  }
  if (!captured.queuePayload || captured.queueCount !== 1) {
    return { status: 422, body: captureBody('CAPTURE_PAYLOAD_MISSING', 'S7 done แต่ไม่พบ queue payload ที่ถูกจับ (queueCalls=' + captured.queueCount + ')', { holdReason: 'queue_payload_uncaptured', trace }) };
  }

  const wirePayload = captured.queuePayload;
  // ★ (P1-R2) CONSUMER-EQUIVALENT: validate the wire's strict carrier through the SAME pure IO-free activation seam
  //   the composer uses (_strictActivate). Capture-only may return success ONLY from canonical validated activation
  //   data — every wire the consumer would reject (missing/partial/dual/invalid V1 or V2) HOLDs here too, BEFORE any
  //   success, and the authoritative ref identity comes from the validated activation (never a shallow field peek).
  //   Reconstruct the composer carrier args from the wire exactly as the full path does. This is pure — no fetch,
  //   queue, compose, decode, network, or IO (composeCore is never reached from here).
  const _hasSpec = Object.prototype.hasOwnProperty.call(wirePayload, 'selectionSpec');
  const _hasRealized = Object.prototype.hasOwnProperty.call(wirePayload, 'realizedTemplate');
  const _hasV2 = Object.prototype.hasOwnProperty.call(wirePayload, 'refHeroV2');
  const _capArgs = {
    slotPlan: wirePayload.slotPlan,
    ...(_hasSpec ? { selectionSpec: wirePayload.selectionSpec } : {}),
    ...(_hasRealized ? { realizedTemplate: wirePayload.realizedTemplate } : {}),
    ...(_hasV2 ? { refHeroV2: wirePayload.refHeroV2 } : {}),
  };
  // capture-only REQUIRES the exact shared seam — resolve it from the composer namespace at runtime and fail closed
  //   with a typed HOLD if it is unavailable (never reimplement/downgrade/silently succeed).
  const _strictActivate = _composerModule._strictActivate;
  if (typeof _strictActivate !== 'function') {
    return { status: 422, body: captureBody('CAPTURE_STRICT_SEAM_UNAVAILABLE', 'shared strict activation seam (_strictActivate) ไม่พร้อม — capture-only ต้องใช้ seam จริงเท่านั้น (ห้าม reimplement/downgrade)', { holdReason: 'strict_seam_unavailable', trace }) };
  }
  const _capGate = _strictActivate({ args: _capArgs, slotPlan: _capArgs.slotPlan });
  if (_capGate.none) {
    return { status: 422, body: captureBody('CAPTURE_STRICT_PAIR_MISSING', 'strict armed แต่ wire ไม่มี strict carrier (V1 pair หรือ refHeroV2)', { holdReason: 'strict_wire_missing', trace }) };
  }
  if (_capGate.error) {
    return { status: 422, body: captureBody('CAPTURE_STRICT_CONTRACT_REJECT', `consumer จะปฏิเสธ wire นี้: ${_capGate.errorType}`, { holdReason: _capGate.errorType, reasons: _capGate.reasons || null, trace }) };
  }
  // valid canonical activation — ref identity MUST come from the VALIDATED ctx.authority, be present, and match the bind
  const specRefId = (_capGate.ctx && _capGate.ctx.authority) ? _capGate.ctx.authority.refId : null;
  if (specRefId == null || String(specRefId) === '') {
    return { status: 422, body: captureBody('CAPTURE_REF_IDENTITY_MISSING', 'validated activation ไม่มี ref identity', { holdReason: 'ref_identity_missing', trace }) };
  }
  if (boundRefId && String(specRefId) !== String(boundRefId)) {
    return { status: 422, body: captureBody('CAPTURE_REF_IDENTITY_STALE', 'ref identity ไม่ตรงกับที่ operator ผูกไว้ (stale)', { holdReason: 'ref_identity_stale', trace, specRefId, boundRefId }) };
  }

  // raw/parsed cross-check — captured.queuePayload is JSON.parse(captured.queueBody) by construction inside
  // makeStrictFetchJson (the two never diverge), re-verified explicitly here per the capture-only contract
  let reparsed;
  try { reparsed = JSON.parse(captured.queueBody); } catch {
    return { status: 422, body: captureBody('CAPTURE_QUEUE_BODY_INVALID_JSON', 'raw queueBody ไม่ใช่ JSON ที่ parse ได้', { holdReason: 'queue_body_invalid_json', trace }) };
  }
  if (JSON.stringify(reparsed) !== JSON.stringify(captured.queuePayload)) {
    return { status: 422, body: captureBody('CAPTURE_QUEUE_PAYLOAD_MISMATCH', 'queuePayload ไม่ deep-equal กับ JSON.parse(queueBody)', { holdReason: 'queue_payload_mismatch', trace }) };
  }

  // ---- SUCCESS: return IMMEDIATELY — no compose/QC/persist/archive/fs/db/real-queue/real-network of any kind ----
  return {
    status: 200,
    body: {
      success: true,
      mode: 'capture_only',
      evidenceKind: 'replay_operator_supplied', // honest label — see file-header note; NOT fresh/live-authenticated
      evidenceDisclaimer: 'Replay of an operator-supplied post-S6 dossier through the real S7 producer + the fail-closed in-process queue interceptor. NOT a fresh/live pipeline run. Carries NO cryptographic authenticity guarantee — this proves the S7 contract given the supplied inputs, nothing about how those inputs were originally obtained.',
      queueBody: captured.queueBody,
      queuePayload: captured.queuePayload,
      refId: boundRefId,
      imageCaseId: caseId,
      trace,
    },
  };
}

// ============================================================
// thin orchestration seam — export ให้ Lane-E fixture (later wave) inject deps offline ได้
//   คืน { status, body } (ไม่แตะ NextResponse ในนี้ — POST wrapper ห่อให้)
// ============================================================
export async function runCoverRefTest(input = {}, deps = {}) {
  const trace = [];
  const t0 = Date.now();

  const {
    compassBrain: _compass = compassBrain,
    s5_case: _s5_case = s5_case,
    s5_keywords: _s5_keywords = s5_keywords,
    s5_search: _s5_search = s5_search,
    s5_triage: _s5_triage = s5_triage,
    s5_clipframe: _s5_clipframe = s5_clipframe,
    s6_slots: _s6_slots = s6_slots,
    s7_cover: _s7_cover = s7_cover,
    composeAndVerify: _compose_ = composeAndVerify,
    evaluateCoverQc: _qc = evaluateCoverQc,
    readImageCase: _readImageCase = (caseId) => buildImagesRouteResponse(caseId, null),
    resolveLatchReport: _latches = resolveLatchReport,
    loadArchive: _loadArchive = () => import('@/lib/megaCoverArchive'),
    // DI seam (A3): เขียนไฟล์ปกลง public/mega-covers — default = พฤติกรรมเดิมเป๊ะ · เทสฉีด async () => null เพื่อกัน fs IO โดย archive counter ยังวิ่งครั้งเดียว
    persistCoverImage: _persistCoverImage = async ({ format, base64 }) => {
      const { promises: fsp } = await import('fs');
      const pathMod = await import('path');
      const dir = pathMod.join(process.cwd(), 'public', 'mega-covers');
      await fsp.mkdir(dir, { recursive: true });
      const fname = `reftest-${Date.now().toString(36)}.${format === 'png' ? 'png' : 'jpg'}`;
      await fsp.writeFile(pathMod.join(dir, fname), Buffer.from(base64, 'base64'));
      return `/mega-covers/${fname}`;
    },
    // ★ audit แบตช์ 2 (code-auditor): จังหวะรอระหว่างรอบ clipframe — วนถี่ไร้ delay = อ่านคลังเปล่า 5 ครั้ง ไม่ได้ "รอ" จริง · เทสฉีด 0
    clipframeWaitMs: _clipframeWaitMs = 5000,
    env: _env = process.env,
  } = deps;

  const content = String(input.content || '').trim();
  const newsTitle = String(input.newsTitle || '').trim();
  const forceTemplateId = input.forceTemplateId || null;
  const origin = String(input.origin || '');

  if (content.length < 100) {
    return { status: 400, body: { success: false, error: 'ต้องมีเนื้อข่าวเต็ม (≥100 ตัวอักษร)', errorType: 'NO_CONTENT' } };
  }
  // ★ 15 ก.ค. (แบตช์ 1 + Codex audit): fail-fast กระจกด่าน s5_case เป๊ะ — s5_case วัด "หัว+เนื้อ" ผ่าน fullNewsText
  //   ([title, body].join('\n\n') ≥200, megaAdapters:476-490) ไม่ใช่ content เดี่ยว — เนื้อ 100-199 ที่หัวช่วยดันถึง 200
  //   ต้องผ่านเหมือนเดิม ส่วนที่รวมแล้วไม่ถึงให้ตายที่นี่ก่อนจ่ายค่า compass (เดิมไปตายที่ s5_case หลังจ่ายแล้ว)
  const gateText = [newsTitle, content].filter(Boolean).join('\n\n');
  if (gateText.length < 200) {
    return { status: 400, body: { success: false, error: `เนื้อไม่พอเปิดเคสภาพ (หัว+เนื้อรวม ${gateText.length} ตัว — ด่าน s5_case ต้อง ≥200)`, errorType: 'NO_CONTENT' } };
  }

  const latchReport = await _latches(_env);

  // ★ 15 ก.ค. (แบตช์ 2 — B2 pre-flight): V2 producer เปิดแต่ render latch ปิด = ตัดสินที่ t=0
  //   MEGA_REF_HERO_V2=1 จะแนบ carrier ที่ consumer (composer) ตั้งใจ HOLD เมื่อ MEGA_STRICT_RENDER ปิด
  //   → งานจะไปตายที่ S7 หลังเผาเวลา ~457s (compass/S5 4 แหล่ง/S6) อยู่ดี · fail เร็วขึ้นทางเดียว
  //   happy path (V2+RENDER คู่กัน หรือ V2 OFF) = ไม่แตะ · ไม่ถอย legacy เงียบ (ยัง fail-closed)
  if (_env.MEGA_REF_HERO_V2 === '1' && _env.MEGA_STRICT_RENDER !== '1') {
    trace.push({ stage: 'preflight', status: 'hold', summary: 'MEGA_REF_HERO_V2=1 ต้องเปิด MEGA_STRICT_RENDER=1 คู่กัน' });
    return { status: 422, body: holdBody({ error: 'MEGA_REF_HERO_V2=1 ต้องเปิด MEGA_STRICT_RENDER=1 คู่กัน (V2 producer จะแนบ carrier ที่ consumer ตั้งใจ HOLD เมื่อ render latch ปิด) — ตัดสินที่ t=0 แทนการเผา ~457s แล้วค่อย 422', errorType: 'STRICT_CONFIG_MISMATCH', holdReason: 'v2_producer_without_render_latch', effectiveMode: 'strict', latchReport, authority: null, trace }) };
  }

  // ── in-memory dossier (จำลอง S4 จบแล้ว) — ขับ adapter จริงเหมือน conductor ──
  const job = {
    id: `REFTEST-${Date.now().toString(36)}`,
    dossier: {
      desk: { title: newsTitle, lane: '', category: '' },
      extract: { text: content, chars: content.length },
      generate: { newsData: { newsTitle, newsBody: content } },
    },
  };
  // ★ ให้ผู้ใช้ล็อก ref ใบเจาะจงได้ — S6 เป็นผู้ bind identity เอง (ท่อนี้ไม่ synthesize refMatch)
  if (forceTemplateId) job.dossier.refIdLock = String(forceTemplateId);

  const merge = (r) => { if (r?.dossierPatch) Object.assign(job.dossier, r.dossierPatch); return r; };
  const step = (name, r) => { trace.push({ stage: name, status: r?.status, summary: (r?.summary || '').slice(0, 160) }); return r; };
  const failed = (r) => (r?.status === 'failed');

  // ── S2.5 เข็มทิศ ──
  let compassFailed = false;
  try {
    job.dossier.compass = await _compass({ card: { title: newsTitle, lane: '', category: '' }, extractText: content });
    trace.push({ stage: 's2.5_compass', status: 'done', summary: `${job.dossier.compass?.angle || ''} · ${job.dossier.compass?.primaryEmotion || ''}`.slice(0, 160) });
  } catch (e) {
    compassFailed = true;
    job.dossier.compass = { mainCharacters: [], visualDreamShots: [] };
    trace.push({ stage: 's2.5_compass', status: 'failed', summary: 'compass ล้ม (ใช้ค่าว่าง): ' + (e.message || '').slice(0, 80) });
  }

  // ★ 15 ก.ค. (แบตช์ 2 — N1 compass fail-fast): โหมด V2 ต้องมีตัวละครหลักจากข่าวจริง
  //   compass ล้ม/ไม่มี mainCharacters → S6 จะ HOLD ด้วย REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE อยู่ดี
  //   → ตายที่นี่ก่อนจ่ายค่าค้นภาพ 4 แหล่ง · ไม่ retry compass (นอกขอบเขต) · flag OFF: ไม่แตะพฤติกรรมเดิมเลย
  if (_env.MEGA_REF_HERO_V2 === '1' && (compassFailed || !job.dossier.compass?.mainCharacters?.length)) {
    trace.push({ stage: 'preflight_compass', status: 'hold', summary: 'V2 ต้องมีตัวละครหลักจากข่าวจริง' });
    return { status: 422, body: holdBody({ error: 'compass ล้ม/ไม่มีตัวละครหลัก — โหมด V2 ต้องมีคนจากข่าวจริง (REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE จะ HOLD ที่ S6 อยู่ดี) — ตายที่นี่ก่อนจ่ายค่าค้นภาพ 4 แหล่ง', errorType: 'COMPASS_REQUIRED_FOR_V2', holdReason: 'compass_empty_for_v2', effectiveMode: 'strict', latchReport, authority: null, trace }) };
  }

  // ★ REF IDENTITY: ไม่ pre-set refMatch — ปล่อยให้ S6 bind identity จริง (refId/dnaHash/refBoundAt)
  //   ท่อนี้ห้าม synthesize/fallback identity ใดๆ (point 2)

  // ── S5a เปิดเคสภาพ (AC-xxxx) ──
  let r = merge(step('s5_case', await _s5_case(job, { origin })));
  if (failed(r)) return { status: 502, body: { success: false, error: r.summary, errorType: 'S5_CASE_FAILED', trace } };

  // ── S5b สกัดคีย์เวิร์ด ──
  r = merge(step('s5_keywords', await _s5_keywords(job, { origin })));
  if (failed(r)) return { status: 502, body: { success: false, error: r.summary, errorType: 'S5_KEYWORDS_FAILED', trace } };

  // ── S5c ค้นภาพ (staged: วนจน s5_search คืน non-wait) ──
  for (let i = 0; i < 8; i++) {
    r = merge(step('s5_search', await _s5_search(job, { origin })));
    if (failed(r)) return { status: 502, body: { success: false, error: r.summary, errorType: 'S5_SEARCH_FAILED', trace } };
    if (r.nextAction !== 'wait') break;
  }
  // ── S5d ตาคัดคลัง (วนจน done) ──
  for (let i = 0; i < 10; i++) {
    r = merge(step('s5_triage', await _s5_triage(job, { origin })));
    if (failed(r)) return { status: 502, body: { success: false, error: r.summary, errorType: 'S5_TRIAGE_FAILED', trace } };
    if (r.nextAction !== 'wait') break;
  }
  // ── S5e เฟรมคลิป (staged: วนจน non-wait สูงสุด 6 รอบ ตามแพทเทิร์น s5_search) ──
  //   ★ 15 ก.ค. (แบตช์ 2 — #8): คงหลักเดิม clipframe ล้ม ≠ ล้มทั้งงาน (ไม่มี failed(r) return) — วน wait ก็เดินต่อ S6
  for (let i = 0; i < 6; i++) {
    r = merge(step('s5_clipframe', await _s5_clipframe(job, { origin })));
    if (r.nextAction !== 'wait') break;
    if (i < 5 && _clipframeWaitMs > 0) await new Promise((res) => setTimeout(res, _clipframeWaitMs)); // เว้นจังหวะจริงให้เฟรมคลิปพื้นหลังมีเวลามาถึง
  }

  // ── S6 เลือกภาพลงช่อง (slotDirectorBrain + ด่านโค้ด) — เป็นผู้ bind refMatch identity ──
  r = merge(step('s6_slots', await _s6_slots(job, { origin })));
  if (failed(r)) return { status: 502, body: { success: false, error: r.summary, errorType: 'S6_SLOTS_FAILED', trace, pickImages: job.dossier.pickImages } };

  // ★ 15 ก.ค. (S6 hold short-circuit): S6 คืน waiting (hold ทุกรูปแบบของ S6) ต้องจบที่นี่ — ห้ามไหลเข้า
  //   S7/queue/compose (เดิม waiting ไหลต่อ → carrier {ok:false} ถูก S7 ตีป้ายทับเป็น ref_hero_v2_carrier_not_ok
  //   กลบเหตุจริง เช่น REF_HERO_V2_INSUFFICIENT_CAST_ASSETS) · เหตุ root = pass-through ค่าที่ S6 ผลิตเป๊ะ:
  //   marker จาก dossierPatch.pickImages.refHeroV2.hold (วินัยเดียวกับ _v2HoldDecision ฝั่ง tick — สตริง
  //   REF_HERO_V2 เท่านั้น) · ไม่มี marker → ใช้ summary ของ S6 เอง · ไม่แปล/ไม่ synthesize/ไม่ถอย fallback
  //   สถานะอื่นนอกเหนือ waiting (นอก failed ที่จัดการแล้ว) = เส้นทางเดิม byte-identical
  if (r?.status === 'waiting') {
    const _rawHold = r?.dossierPatch?.pickImages?.refHeroV2?.hold;
    const s6Hold = (typeof _rawHold === 'string' && _rawHold.startsWith('REF_HERO_V2')) ? _rawHold : null;
    const { effectiveMode: _s6Mode, renderMode: _s6RenderMode } = computeEffectiveMode(_env.MEGA_STRICT_RENDER === '1');
    trace.push({ stage: 'mode', status: _s6Mode, summary: `renderMode=${_s6RenderMode}` });
    return {
      status: 422,
      body: holdBody({
        error: r?.summary || 'S6 พักงาน (ยังไม่พร้อมเลือกภาพ)',
        errorType: 'STRICT_HOLD',
        holdReason: s6Hold || r?.summary || r?.status || null,
        effectiveMode: _s6Mode,
        latchReport,
        authority: extractAuthorityLatches(null, job.dossier),
        trace,
        extra: { s6Status: r?.status ?? null, renderMode: _s6RenderMode, ...(s6Hold ? { refHeroV2Hold: s6Hold } : {}), pickImages: job.dossier.pickImages ?? null },
      }),
    };
  }

  // ============================================================
  // S7 — เรียก "โปรดิวเซอร์จริง" ผ่าน in-process seam แล้วบริโภค payload ที่ S7 ส่งจริง
  // ============================================================
  const captured = { queueCount: 0, queueBody: null, queuePayload: null };
  // queue origin = เดียวกับ coverOrigin() ใน megaAdapters (MEGA_COVER_ORIGIN || http://localhost:3000)
  const coverOrigin = _env.MEGA_COVER_ORIGIN || 'http://localhost:3000';
  const fetchJson = makeStrictFetchJson({ job, origin, coverOrigin, readImageCase: _readImageCase, captured });

  let s7;
  try {
    s7 = await _s7_cover(job, {
      origin,
      _deps: { fetchJson, queueTransport: 'cover_ref_test_in_process' },
    });
  } catch (err) {
    // seam throw (whitelist/pair/queue) ⇒ 422 typed · อื่น ⇒ โยนต่อให้ POST wrapper (500)
    if (err && err.reftestSeam) {
      trace.push({ stage: 's7_cover', status: 'seam_reject', summary: `${err.errorType}: ${(err.message || '').slice(0, 120)}` });
      const authority = extractAuthorityLatches(captured.queuePayload, job.dossier);
      const { effectiveMode: _seamMode, renderMode: _seamRenderMode } = computeEffectiveMode(_env.MEGA_STRICT_RENDER === '1');
      trace.push({ stage: 'mode', status: _seamMode, summary: `renderMode=${_seamRenderMode}` });
      return {
        status: 422,
        body: holdBody({
          error: err.message || 'strict seam ปฏิเสธ', errorType: err.errorType || 'STRICT_SEAM_REJECT',
          holdReason: err.holdReason || err.errorType,
          effectiveMode: _seamMode,
          latchReport, authority, trace, extra: { queueCalls: captured.queueCount, renderMode: _seamRenderMode },
        }),
      };
    }
    throw err;
  }

  trace.push({ stage: 's7_cover', status: s7?.status, summary: (s7?.summary || '').slice(0, 160) });

  // ── S7 ไม่ 'done' (waiting/failed/HOLD) ⇒ 422 (zero archive) ──
  if (!s7 || s7.status !== 'done') {
    merge(s7); // เผื่อ dossierPatch ติดมาบางส่วน (ไม่กระทบ — archive ไม่เกิด)
    const authority = extractAuthorityLatches(captured.queuePayload, job.dossier);
    const isWaiting = s7?.status === 'waiting';
    const { effectiveMode: _s7Mode, renderMode: _s7RenderMode } = computeEffectiveMode(_env.MEGA_STRICT_RENDER === '1');
    trace.push({ stage: 'mode', status: _s7Mode, summary: `renderMode=${_s7RenderMode}` });
    return {
      status: 422,
      body: holdBody({
        error: s7?.summary || 'S7 ไม่พร้อมส่งปก', errorType: isWaiting ? 'STRICT_HOLD' : 'S7_FAILED',
        holdReason: s7?.summary || s7?.status || 'not_done',
        effectiveMode: _s7Mode,
        latchReport, authority, trace, extra: { s7Status: s7?.status || null, queueCalls: captured.queueCount, renderMode: _s7RenderMode },
      }),
    };
  }

  // S7 done — merge dossierPatch แล้วบริโภค payload ที่ถูกจับจาก wire
  merge(s7);
  const payload = captured.queuePayload;
  if (!payload || captured.queueCount !== 1) {
    // S7 done แต่ไม่ยิงคิว/ยิงผิดจำนวน = สัญญาแตก → 422 (ไม่ประกอบ/ไม่ archive)
    const authority = extractAuthorityLatches(payload, job.dossier);
    return {
      status: 422,
      body: holdBody({
        error: 'S7 done แต่ไม่พบ queue payload ที่ถูกจับ (queueCalls=' + captured.queueCount + ')',
        errorType: 'STRICT_PAYLOAD_MISSING', holdReason: 'queue_payload_uncaptured',
        effectiveMode: 'strict', latchReport, authority, trace,
      }),
    };
  }

  // ── strict engaged? = payload พก carrier (own) + RENDER=1 (composer จะตื่น strict เฉพาะกรณีนี้) ──
  //   ★ (item 5) V1 = selectionSpec+realizedTemplate ครบคู่ · V2 = refHeroV2 carrier (ไม่ต้องมี top-level pair)
  //   → V2 ต้องไม่ถูกป้าย 'legacy' · both = ambiguous ⇒ HOLD (mirror composer)
  const hasSpec = Object.prototype.hasOwnProperty.call(payload, 'selectionSpec');
  const hasRealized = Object.prototype.hasOwnProperty.call(payload, 'realizedTemplate');
  const hasV2 = Object.prototype.hasOwnProperty.call(payload, 'refHeroV2');
  const _renderArmed = _env.MEGA_STRICT_RENDER === '1';
  const strictEngaged = _renderArmed && (hasV2 ? !(hasSpec || hasRealized) : (hasSpec && hasRealized));
  const { effectiveMode, renderMode } = computeEffectiveMode(strictEngaged);
  trace.push({ stage: 'mode', status: effectiveMode, summary: `renderMode=${renderMode}` });
  const authority = extractAuthorityLatches(payload, job.dossier);

  if (hasV2 && (hasSpec || hasRealized)) {
    return { status: 422, body: holdBody({ error: 'wire มีทั้ง refHeroV2 และ selectionSpec/realizedTemplate (กำกวม V1/V2)', errorType: 'STRICT_CARRIER_AMBIGUOUS', holdReason: 'strict_carrier_ambiguous', effectiveMode: 'strict', latchReport, authority, trace }) };
  }

  // ── E15 fail-closed guard: latch armed ครบแต่ wire ไม่มี strict carrier เลย (ทั้ง V1 pair และ V2) = producer
  //   หลุดสัญญา — ห้ามแอบ compose legacy · (mixed pair มีการ์ดของตัวเองอยู่แล้ว) ──
  if (latchReport?.armedProducer === true && !hasSpec && !hasRealized && !hasV2) {
    return { status: 422, body: holdBody({ error: 'strict armed แต่ wire ไม่มี strict carrier (V1 pair หรือ refHeroV2) — ห้ามถอย legacy เงียบ', errorType: 'STRICT_HOLD', holdReason: 'strict_wire_missing', effectiveMode: 'strict', latchReport, authority, trace }) };
  }

  // ── REF IDENTITY guard (strict): identity ต้องมีจริง + ตรงกับที่ S6 bind — หาย/เพี้ยน ⇒ 422 HOLD ──
  //   ★ (item 5) ref มาจาก VALIDATED spec: V1 = payload.selectionSpec.refId · V2 = payload.refHeroV2.selectionSpec.refId
  if (strictEngaged) {
    const rm = job.dossier.refMatch || {};
    const boundId = rm.refId || rm.dnaHash || null;
    if (!boundId || !rm.refBoundAt) {
      return { status: 422, body: holdBody({ error: 'strict: ref identity ไม่ถูก bind ที่ S6', errorType: 'STRICT_HOLD', holdReason: 'ref_identity_missing', effectiveMode, latchReport, authority, trace }) };
    }
    const specRefId = hasV2
      ? (payload.refHeroV2?.selectionSpec?.refId ?? null)
      : (payload.selectionSpec?.refId ?? null);
    if (specRefId && boundId && String(specRefId) !== String(boundId)) {
      return { status: 422, body: holdBody({ error: 'strict: ref identity ไม่ตรงกับที่ S6 bind (stale)', errorType: 'STRICT_HOLD', holdReason: 'ref_identity_stale', effectiveMode, latchReport, authority, trace, extra: { specRefId, boundRefId: boundId } }) };
    }
  }

  // ── ประกอบ in-process จาก payload จริงของ S7 (ห้าม re-derive) ──
  //   both-or-neither ถูกบังคับที่ fetchJson แล้ว — re-assert กันพลาด
  if (hasSpec !== hasRealized) {
    return { status: 422, body: holdBody({ error: 'strict pair mixed ใน payload', errorType: 'STRICT_PAIR_MIXED', holdReason: 'strict_pair_mixed', effectiveMode, latchReport, authority, trace }) };
  }
  const composerArgs = {
    newsTitle: payload.newsTitle || newsTitle,
    slotPlan: payload.slotPlan,
    refDNA: Object.prototype.hasOwnProperty.call(payload, 'refDNA') ? payload.refDNA : null,
    refImagePath: Object.prototype.hasOwnProperty.call(payload, 'refImagePath') ? payload.refImagePath : null,
    stableOrder: _env.MEGA_STABLE_ORDER !== '0',
    ...(hasSpec && hasRealized ? { selectionSpec: payload.selectionSpec, realizedTemplate: payload.realizedTemplate } : {}),
    // ★ Wave1A (LANE C — P0-1): ส่งผ่าน carrier V2 (refHeroV2) แบบ own-property "additive" เหมือน selectionSpec —
    //   ไม่มี env alias ที่ route · canonical latch = MEGA_STRICT_RENDER อยู่ที่ consumer เท่านั้น
    //   consumer เป็นผู้ตัดสิน/HOLD เอง (latch OFF + carrier = HOLD, ไม่ downgrade) · absent = composerArgs เดิมไม่เพิ่ม key
    ...(Object.prototype.hasOwnProperty.call(payload, 'refHeroV2') ? { refHeroV2: payload.refHeroV2 } : {}),
  };

  let cover;
  try {
    cover = await _compose_(composerArgs);
  } catch (e) {
    // consumer throw ⇒ typed 422 เสมอ (ทุกโหมด) ก่อน archive — ห้าม 502/success (audit point 4)
    trace.push({ stage: 's7_compose', status: 'failed', summary: 'โรงประกอบ throw: ' + (e.message || '').slice(0, 120) });
    return { status: 422, body: holdBody({ error: e.message || 'โรงประกอบล้ม', errorType: 'COVER_FAILED', holdReason: 'compose_threw', effectiveMode, latchReport, authority, trace }) };
  }
  trace.push({
    stage: 's7_compose',
    status: cover?.success ? 'done' : 'failed',
    summary: `โรงประกอบ: ${cover?.template || '-'}${cover?.refSimilarity != null ? ` · เหมือน ref ${cover.refSimilarity}%` : ''}${cover?.eyeFixed ? ` · ตาแก้ ${cover.eyeFixed} จุด` : ''}`,
  });

  // ── compose fail (รวม hero/readiness/strict contract error) ⇒ typed 422 เสมอ, zero archive (audit point 4) ──
  if (!cover?.success) {
    return { status: 422, body: holdBody({ error: cover?.error || 'โรงประกอบล้ม', errorType: cover?.errorType || 'COVER_FAILED', holdReason: cover?.errorType || 'compose_failed', effectiveMode, latchReport, authority, trace, extra: { reasons: cover?.reasons || null, qcFlags: cover?.qcFlags || null } }) };
  }

  // ── ด่าน QC ──
  const qcVerdict = _qc({ qcFlags: cover.qcFlags, refSimilarity: cover.refSimilarity, manifest: cover.manifest });
  cover.score = cover.refSimilarity != null ? `เหมือน ref ${cover.refSimilarity}%` : '-';
  // ★ item 3: productionQcPass เป็นค่าผกผันเป๊ะของเงื่อนไข "QC ไม่ผ่าน" เดิม (qcVerdict && qcVerdict.pass===false)
  //   — qcVerdict หาย/null = ไม่ถือว่าถูกปฏิเสธ (เหมือนพฤติกรรมเดิมทุกประการ) mirror /mega-compose-test เป๊ะ
  const productionQcPass = qcVerdict?.pass !== false;
  const sourceLinks = (payload.slotPlan || []).map((p) => p.url).filter(Boolean);
  const rm = job.dossier.refMatch || null;
  const matchedRef = rm ? { imagePath: rm.imagePath || null, styleName: rm.styleName || null, dna: rm.dna || null, refId: rm.refId || null, dnaHash: rm.dnaHash || null, refBoundAt: rm.refBoundAt || null, reason: rm.reason || null } : null;

  // QC pass===false:
  //   strict (item 1 — ไม่แตะ) ⇒ typed 422 QC_REJECTED เสมอ ก่อน archive — archiveCalls=0 (byte-identical เดิม)
  //   preview_advisory (item 3) ⇒ mirror /mega-compose-test advisory semantics เฉพาะจุดตัดสินนี้: HTTP 200
  //     success:true + qcVerdict + productionQcPass:false — ห้าม persist/archive ผลนี้เด็ดขาด (return ก่อนถึง
  //     บล็อก archive ด้านล่างเสมอ)
  if (!productionQcPass) {
    if (effectiveMode === 'strict') {
      return { status: 422, body: holdBody({ error: 'QC ไม่ผ่าน: ' + (qcVerdict.reasons || []).join(' · ').slice(0, 160), errorType: 'QC_REJECTED', holdReason: 'qc_failed', effectiveMode, latchReport, authority, trace, extra: { qcVerdict, qcFlags: cover.qcFlags || [] } }) };
    }
    return {
      status: 200,
      body: buildCoverResponseBody({
        cover, qcVerdict, productionQcPass, effectiveMode, renderMode, latchReport, authority,
        matchedRef, job, sourceLinks, trace, t0, coverPath: null, archiveId: null,
      }),
    };
  }

  // ── archive ครั้งเดียว (สำเร็จ + QC ผ่านเท่านั้น — item 3: preserve the existing single persist/archive path) ──
  //   ล้มไม่ critical ต่อผลปก
  let coverPath = null;
  let archiveId = null;
  try {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(cover.base64 || '');
    if (m) {
      try { coverPath = (await _persistCoverImage({ format: m[1], base64: m[2] })) || null; } catch { /* พึ่งคลาวด์แทน */ }
      const { addMegaCover } = await _loadArchive();
      const ent = await addMegaCover({
        title: newsTitle || content.slice(0, 60),
        source: 'cover-ref-test',
        imageCaseId: job.dossier.images?.caseId || null,
        coverCaseId: cover.caseId || null,
        coverPath, base64: cover.base64, template: cover.template, score: cover.score, throughMega: true, trace,
        qcFlags: Array.isArray(cover.qcFlags) ? cover.qcFlags : [],
        // ★ 15 ก.ค. (แบตช์ 4 — บัค #6): archive รองรับสอง field นี้อยู่แล้ว (megaCoverArchive:85-86) แต่ route ไม่เคยส่ง
        //   → ปกในคลังเสียลิงก์ ref ตลอด — ส่ง identity ที่ S6 bind จริง (แนว refId guard ที่ strict ใช้)
        refId: job.dossier.refMatch?.refId || job.dossier.refMatch?.dnaHash || null,
        refSimilarity: cover.refSimilarity ?? null,
      });
      archiveId = ent?.id || null;
      if (!coverPath && ent?.id) coverPath = `/api/mega-covers/img?id=${encodeURIComponent(ent.id)}`;
    }
  } catch { /* คลังล้ม ไม่ให้กระทบผลปก */ }

  return {
    status: 200,
    body: buildCoverResponseBody({
      cover, qcVerdict, productionQcPass, effectiveMode, renderMode, latchReport, authority,
      matchedRef, job, sourceLinks, trace, t0, coverPath, archiveId,
    }),
    // R1.6: no residual capture-after-writes path — this function is now ALWAYS the ordinary full run.
    //   Capture-only evidence, when authorized, comes exclusively from runS7CaptureOnly (see above), which
    //   never reaches this function at all.
  };
}

// ============================================================
// 🚚 QUEUE MODE — rt_* stage functions (ขับด้วย /api/mega/tick, ทีละงาน×ทีละขั้น)
// ------------------------------------------------------------
// สัญญาเดียวกับ stage อื่น: (job, { origin, _deps, env }) → { status, nextAction, summary, dossierPatch }
//   • คุณภาพ/ด่าน/loop เท่ากับโหมด sync (runCoverRefTest) เป๊ะ — แชร์ makeStrictFetchJson + composeAndVerify +
//     evaluateCoverQc + archive จากไฟล์นี้
//   • HOLD/waiting/QC-fail ทุกชนิด → nextAction:'fail' + summary ระบุเหตุ (โหมดคิวไม่มี 422 — job.status='failed')
//   • archive เฉพาะ QC ผ่านจริงเท่านั้น (zero-archive คงเดิม)
//   • _deps รับ override adapter/compose/qc/archive เพื่อเทส (default = โมดูลจริง — ไม่ยิง network เมื่อ inject)
// ============================================================

// helper: loop stage ที่วน adapter จน non-wait แล้วรวม dossierPatch (mirror sync merge)
async function _rtLoopStage({ job, origin, runAdapter, maxIters, failOnFailed, waitMs }) {
  const acc = {};
  const merge = (res) => {
    if (res?.dossierPatch) { Object.assign(job.dossier, res.dossierPatch); Object.assign(acc, res.dossierPatch); }
    return res;
  };
  let r;
  for (let i = 0; i < maxIters; i++) {
    r = merge(await runAdapter());
    if (failOnFailed && r?.status === 'failed') return { failed: r, acc };
    if (r?.nextAction !== 'wait') break;
    if (waitMs > 0 && i < maxIters - 1) await new Promise((res) => setTimeout(res, waitMs));
  }
  return { last: r, acc };
}

export async function rt_compass(job, opts = {}) {
  const { _deps = {}, env = process.env } = opts;
  const _compass = _deps.compassBrain || compassBrain;
  const d = job.dossier || {};
  const content = String(d.extract?.text || '').trim();
  const newsTitle = String(d.desk?.title || '').trim();
  let compassFailed = false;
  let compass;
  try {
    compass = await _compass({ card: { title: newsTitle, lane: '', category: '' }, extractText: content });
  } catch (e) {
    compassFailed = true;
    compass = { mainCharacters: [], visualDreamShots: [] };
  }
  // ★ N1 compass fail-fast (mirror sync): โหมด V2 ต้องมีตัวละครหลักจากข่าวจริง — ไม่มี → ปิดงานก่อนจ่ายค่าค้นภาพ
  //   (config-mismatch V2-without-RENDER ถูกกันที่ tick POST แล้ว — 503 ก่อนหยิบงาน)
  if (env.MEGA_REF_HERO_V2 === '1' && (compassFailed || !compass?.mainCharacters?.length)) {
    return { status: 'failed', nextAction: 'fail', summary: 'COMPASS_REQUIRED_FOR_V2: compass ล้ม/ไม่มีตัวละครหลัก — โหมด V2 ต้องมีคนจากข่าวจริง', dossierPatch: { compass } };
  }
  return { status: 'done', nextAction: 'continue', summary: `${compass?.angle || ''} · ${compass?.primaryEmotion || ''}`.slice(0, 160), dossierPatch: { compass } };
}

export async function rt_s5case(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s5_case = _deps.s5_case || s5_case;
  const r = await _s5_case(job, { origin });
  if (r?.status === 'failed') return { status: 'failed', nextAction: 'fail', summary: 'S5_CASE_FAILED: ' + (r.summary || '') };
  return { status: 'done', nextAction: 'continue', summary: r?.summary || '', dossierPatch: r?.dossierPatch || {} };
}

export async function rt_s5keywords(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s5_keywords = _deps.s5_keywords || s5_keywords;
  const r = await _s5_keywords(job, { origin });
  if (r?.status === 'failed') return { status: 'failed', nextAction: 'fail', summary: 'S5_KEYWORDS_FAILED: ' + (r.summary || '') };
  return { status: 'done', nextAction: 'continue', summary: r?.summary || '', dossierPatch: r?.dossierPatch || {} };
}

export async function rt_s5search(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s5_search = _deps.s5_search || s5_search;
  const { failed, last, acc } = await _rtLoopStage({ job, origin, runAdapter: () => _s5_search(job, { origin }), maxIters: 8, failOnFailed: true, waitMs: 0 });
  if (failed) return { status: 'failed', nextAction: 'fail', summary: 'S5_SEARCH_FAILED: ' + (failed.summary || ''), dossierPatch: acc };
  return { status: 'done', nextAction: 'continue', summary: last?.summary || '', dossierPatch: acc };
}

export async function rt_s5triage(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s5_triage = _deps.s5_triage || s5_triage;
  const { failed, last, acc } = await _rtLoopStage({ job, origin, runAdapter: () => _s5_triage(job, { origin }), maxIters: 10, failOnFailed: true, waitMs: 0 });
  if (failed) return { status: 'failed', nextAction: 'fail', summary: 'S5_TRIAGE_FAILED: ' + (failed.summary || ''), dossierPatch: acc };
  return { status: 'done', nextAction: 'continue', summary: last?.summary || '', dossierPatch: acc };
}

export async function rt_s5clipframe(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s5_clipframe = _deps.s5_clipframe || s5_clipframe;
  const waitMs = _deps.clipframeWaitMs != null ? _deps.clipframeWaitMs : 5000;
  // ★ clipframe ล้ม ≠ ล้มทั้งงาน (mirror sync — ไม่มี failOnFailed) · วน wait สูงสุด 6 รอบ พร้อมเว้นจังหวะ
  const { last, acc } = await _rtLoopStage({ job, origin, runAdapter: () => _s5_clipframe(job, { origin }), maxIters: 6, failOnFailed: false, waitMs });
  return { status: 'done', nextAction: 'continue', summary: last?.summary || '', dossierPatch: acc };
}

export async function rt_s6slots(job, opts = {}) {
  const { origin = '', _deps = {} } = opts;
  const _s6_slots = _deps.s6_slots || s6_slots;
  const r = await _s6_slots(job, { origin });
  if (r?.status === 'failed') return { status: 'failed', nextAction: 'fail', summary: 'S6_SLOTS_FAILED: ' + (r.summary || ''), dossierPatch: r?.dossierPatch || {} };
  // ★ S6 waiting/HOLD (ทุกรูปแบบ) → fail พร้อมเหตุ (โหมดคิวไม่มี 422) — mirror sync short-circuit
  if (r?.status === 'waiting') {
    const _rawHold = r?.dossierPatch?.pickImages?.refHeroV2?.hold;
    const s6Hold = (typeof _rawHold === 'string' && _rawHold.startsWith('REF_HERO_V2')) ? _rawHold : null;
    return { status: 'failed', nextAction: 'fail', summary: 'STRICT_HOLD: ' + (s6Hold || r?.summary || 'S6 พักงาน (ยังไม่พร้อมเลือกภาพ)'), dossierPatch: r?.dossierPatch || {} };
  }
  return { status: 'done', nextAction: 'continue', summary: r?.summary || '', dossierPatch: r?.dossierPatch || {} };
}

// default persist สำหรับ queue — เขียนไฟล์ปกลง public/mega-covers (เหมือน sync default) · เขียนล้ม = คลาวด์รับช่วง
async function _defaultPersistCoverImage({ format, base64 }) {
  const { promises: fsp } = await import('fs');
  const pathMod = await import('path');
  const dir = pathMod.join(process.cwd(), 'public', 'mega-covers');
  await fsp.mkdir(dir, { recursive: true });
  const fname = `reftest-${Date.now().toString(36)}.${format === 'png' ? 'png' : 'jpg'}`;
  await fsp.writeFile(pathMod.join(dir, fname), Buffer.from(base64, 'base64'));
  return `/mega-covers/${fname}`;
}

export async function rt_s7compose(job, opts = {}) {
  const { origin = '', _deps = {}, env = process.env } = opts;
  const _s7_cover = _deps.s7_cover || s7_cover;
  const _compose = _deps.composeAndVerify || composeAndVerify;
  const _qc = _deps.evaluateCoverQc || evaluateCoverQc;
  const _readImageCase = _deps.readImageCase || ((caseId) => buildImagesRouteResponse(caseId, null));
  const _loadArchive = _deps.loadArchive || (() => import('@/lib/megaCoverArchive'));
  const _persistCoverImage = _deps.persistCoverImage || _defaultPersistCoverImage;
  const _latches = _deps.resolveLatchReport || resolveLatchReport;

  const d = job.dossier || {};
  const newsTitle = String(d.desk?.title || '').trim();
  const content = String(d.extract?.text || '').trim();

  const latchReport = await _latches(env);

  const captured = { queueCount: 0, queueBody: null, queuePayload: null };
  const coverOrigin = env.MEGA_COVER_ORIGIN || 'http://localhost:3000';
  const fetchJson = makeStrictFetchJson({ job, origin, coverOrigin, readImageCase: _readImageCase, captured });

  let s7;
  try {
    s7 = await _s7_cover(job, { origin, _deps: { fetchJson, queueTransport: 'cover_ref_test_in_process' } });
  } catch (err) {
    if (err && err.reftestSeam) {
      return { status: 'failed', nextAction: 'fail', summary: `STRICT_SEAM_REJECT: ${err.errorType || ''} ${(err.message || '').slice(0, 120)}`.trim() };
    }
    throw err; // อื่น ⇒ ให้ tick จับ (retry/fail ตามตัวนับ)
  }

  if (!s7 || s7.status !== 'done') {
    const isWaiting = s7?.status === 'waiting';
    return { status: 'failed', nextAction: 'fail', summary: (isWaiting ? 'STRICT_HOLD: ' : 'S7_FAILED: ') + (s7?.summary || s7?.status || 'S7 ไม่พร้อมส่งปก') };
  }

  // S7 done — merge dossierPatch (queueJobId/selectionSpec/sourceLinks) เก็บไว้ carry ต่อ
  const s7Cover = (s7?.dossierPatch && s7.dossierPatch.cover) ? s7.dossierPatch.cover : {};
  if (s7?.dossierPatch) Object.assign(job.dossier, s7.dossierPatch);

  const payload = captured.queuePayload;
  if (!payload || captured.queueCount !== 1) {
    return { status: 'failed', nextAction: 'fail', summary: 'STRICT_PAYLOAD_MISSING: queueCalls=' + captured.queueCount };
  }

  const hasSpec = Object.prototype.hasOwnProperty.call(payload, 'selectionSpec');
  const hasRealized = Object.prototype.hasOwnProperty.call(payload, 'realizedTemplate');
  const hasV2 = Object.prototype.hasOwnProperty.call(payload, 'refHeroV2');
  const strictEngaged = env.MEGA_STRICT_RENDER === '1' && (hasV2 ? !(hasSpec || hasRealized) : (hasSpec && hasRealized));

  if (hasV2 && (hasSpec || hasRealized)) {
    return { status: 'failed', nextAction: 'fail', summary: 'STRICT_CARRIER_AMBIGUOUS: wire มีทั้ง refHeroV2 และ selectionSpec/realizedTemplate' };
  }
  // E15: latch armed ครบแต่ wire ไม่มี strict carrier เลย = producer หลุดสัญญา — ห้ามถอย legacy เงียบ
  if (latchReport?.armedProducer === true && !hasSpec && !hasRealized && !hasV2) {
    return { status: 'failed', nextAction: 'fail', summary: 'STRICT_HOLD: strict_wire_missing (armed แต่ wire ไม่มี strict carrier)' };
  }
  if (strictEngaged) {
    const rm = d.refMatch || {};
    const boundId = rm.refId || rm.dnaHash || null;
    if (!boundId || !rm.refBoundAt) return { status: 'failed', nextAction: 'fail', summary: 'STRICT_HOLD: ref_identity_missing' };
    const specRefId = hasV2 ? (payload.refHeroV2?.selectionSpec?.refId ?? null) : (payload.selectionSpec?.refId ?? null);
    if (specRefId && String(specRefId) !== String(boundId)) return { status: 'failed', nextAction: 'fail', summary: 'STRICT_HOLD: ref_identity_stale' };
  }
  if (hasSpec !== hasRealized) {
    return { status: 'failed', nextAction: 'fail', summary: 'STRICT_PAIR_MIXED' };
  }

  const composerArgs = {
    newsTitle: payload.newsTitle || newsTitle,
    slotPlan: payload.slotPlan,
    refDNA: Object.prototype.hasOwnProperty.call(payload, 'refDNA') ? payload.refDNA : null,
    refImagePath: Object.prototype.hasOwnProperty.call(payload, 'refImagePath') ? payload.refImagePath : null,
    stableOrder: env.MEGA_STABLE_ORDER !== '0',
    ...(hasSpec && hasRealized ? { selectionSpec: payload.selectionSpec, realizedTemplate: payload.realizedTemplate } : {}),
    ...(hasV2 ? { refHeroV2: payload.refHeroV2 } : {}),
  };

  let cover;
  try {
    cover = await _compose(composerArgs);
  } catch (e) {
    return { status: 'failed', nextAction: 'fail', summary: 'COVER_FAILED: โรงประกอบ throw: ' + (e.message || '').slice(0, 120) };
  }
  if (!cover?.success) {
    return { status: 'failed', nextAction: 'fail', summary: (cover?.errorType || 'COVER_FAILED') + ': ' + (cover?.error || 'โรงประกอบล้ม').slice(0, 120) };
  }

  // ── ด่าน QC hard gate (โหมดคิว: ไม่ผ่าน = failed 'QC_REJECTED' เสมอ, zero archive) ──
  const qcVerdict = _qc({ qcFlags: cover.qcFlags, refSimilarity: cover.refSimilarity, manifest: cover.manifest });
  const productionQcPass = qcVerdict?.pass !== false;
  cover.score = cover.refSimilarity != null ? `เหมือน ref ${cover.refSimilarity}%` : '-';
  if (!productionQcPass) {
    return { status: 'failed', nextAction: 'fail', summary: 'QC_REJECTED: ' + (qcVerdict?.reasons || []).join(' · ').slice(0, 160) };
  }

  // ── archive ครั้งเดียว (สำเร็จ + QC ผ่านเท่านั้น) — ล้มไม่ critical ต่อผลปก ──
  let coverPath = null;
  let archiveId = null;
  try {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(cover.base64 || '');
    if (m) {
      try { coverPath = (await _persistCoverImage({ format: m[1], base64: m[2] })) || null; } catch { /* พึ่งคลาวด์แทน */ }
      const { addMegaCover } = await _loadArchive();
      const ent = await addMegaCover({
        title: newsTitle || content.slice(0, 60),
        source: 'cover-ref-test',
        imageCaseId: d.images?.caseId || null,
        coverCaseId: cover.caseId || null,
        coverPath, base64: cover.base64, template: cover.template, score: cover.score, throughMega: true, trace: [],
        qcFlags: Array.isArray(cover.qcFlags) ? cover.qcFlags : [],
        refId: d.refMatch?.refId || d.refMatch?.dnaHash || null,
        refSimilarity: cover.refSimilarity ?? null,
      });
      archiveId = ent?.id || null;
      if (!coverPath && ent?.id) coverPath = `/api/mega-covers/img?id=${encodeURIComponent(ent.id)}`;
    }
  } catch { /* คลังล้ม ไม่ให้กระทบผลปก */ }

  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ปกเสร็จ ${cover.template || '-'}${cover.refSimilarity != null ? ` · เหมือน ref ${cover.refSimilarity}%` : ''}`,
    dossierPatch: {
      cover: {
        ...s7Cover,
        coverPath,
        ...(archiveId ? { archiveId } : {}),
        template: cover.template || null,
        score: cover.score,
        coverCaseId: cover.caseId || null,
        qcVerdict,
        productionQcPass: true,
        effectiveMode: strictEngaged ? 'strict' : 'preview_advisory',
      },
    },
  };
}

// ============================================================
// 🎫 ENQUEUE / CANCEL / DUPLICATE — pure over store deps (newJob/updateJob/getJob) เพื่อเทสฉีด in-memory
// ============================================================

// ตรวจ 1 รายการตามเกณฑ์เดิม (เนื้อ≥100 · หัว+เนื้อ≥200) — คืน { ok, error } หรือ prepared
function _validateRefTestItem(item, idx) {
  const content = String(item?.content || '').trim();
  const newsTitle = String(item?.newsTitle || '').trim();
  if (content.length < 100) {
    return { ok: false, error: `รายการที่ ${idx + 1}: ต้องมีเนื้อข่าวเต็ม (≥100 ตัวอักษร)` };
  }
  const gateText = [newsTitle, content].filter(Boolean).join('\n\n');
  if (gateText.length < 200) {
    return { ok: false, error: `รายการที่ ${idx + 1}: เนื้อไม่พอเปิดเคสภาพ (หัว+เนื้อรวม ${gateText.length} ตัว — ด่าน s5_case ต้อง ≥200)` };
  }
  return { ok: true, content, newsTitle, forceTemplateId: item?.forceTemplateId ? String(item.forceTemplateId) : null };
}

// seed dossier มาตรฐานของงานคิว reftest (จำลอง S4 จบแล้ว — เหมือน sync job.dossier)
function _seedRefTestDossier({ newsTitle, content, forceTemplateId }) {
  return {
    desk: { title: newsTitle, lane: '', category: '' },
    extract: { text: content, chars: content.length },
    generate: { newsData: { newsTitle, newsBody: content } },
    ...(forceTemplateId ? { refIdLock: String(forceTemplateId) } : {}),
  };
}

// POST /api/cover-ref-test { mode:'queue', items:[{newsTitle,content,forceTemplateId?}] } (หรือ top-level เดี่ยว)
//   validate ต่อรายการ — รายการเสียไม่ล้มทั้งชุด: รายการผ่าน=เข้าคิว, รายการพัง=รายงานใน rejected[{index,error}]
//   ทุกรายการพัง = 400 (ไม่มีอะไรเข้าคิว) · สร้าง sequential ในลูปเดียว
export async function enqueueRefTest(body = {}, deps = {}) {
  const { newJob: _newJob, updateJob: _updateJob } = deps;
  if (typeof _newJob !== 'function' || typeof _updateJob !== 'function') {
    return { status: 500, body: { success: false, error: 'store deps (newJob/updateJob) ไม่พร้อม', errorType: 'INTERNAL' } };
  }
  const rawItems = Array.isArray(body.items) && body.items.length
    ? body.items
    : [{ newsTitle: body.newsTitle, content: body.content, forceTemplateId: body.forceTemplateId }];

  const prepared = [];
  const rejected = [];
  for (let idx = 0; idx < rawItems.length; idx++) {
    const v = _validateRefTestItem(rawItems[idx], idx);
    if (!v.ok) { rejected.push({ index: idx, error: v.error }); continue; }
    prepared.push(v);
  }
  if (!prepared.length) {
    // เข้าคิวไม่ได้สักรายการ — สัญญาเดิมของสายเดี่ยวคงไว้เป๊ะ (error = ข้อความรายการแรก + itemIndex)
    return { status: 400, body: { success: false, error: rejected[0].error, errorType: 'NO_CONTENT', itemIndex: rejected[0].index, rejected } };
  }

  // สร้าง sequential ในลูปเดียว = ปลอดภัยจาก id race ของ newJob
  const jobs = [];
  for (const p of prepared) {
    const created = await _newJob({ mode: 'reftest' });
    await _updateJob(created.id, {
      stage: 'rt_compass',
      status: 'pending',
      dossier: _seedRefTestDossier(p),
    });
    jobs.push({ jobId: created.id, title: p.newsTitle });
  }
  return { status: 200, body: { success: true, jobs, ...(rejected.length ? { rejected } : {}) } };
}

// action:'cancel' {id} — pending/waiting/running → cancelled (terminal)
export async function cancelRefTestJob(id, deps = {}) {
  const { getJob: _getJob, updateJob: _updateJob } = deps;
  if (typeof _getJob !== 'function' || typeof _updateJob !== 'function') {
    return { status: 500, body: { success: false, error: 'store deps ไม่พร้อม', errorType: 'INTERNAL' } };
  }
  const job = await _getJob(id);
  if (!job) return { status: 404, body: { success: false, error: 'ไม่พบงาน', errorType: 'NOT_FOUND' } };
  if (!['pending', 'waiting', 'running'].includes(job.status)) {
    return { status: 409, body: { success: false, error: `ยกเลิกไม่ได้: งานอยู่สถานะ ${job.status} (ยกเลิกได้เฉพาะ pending/waiting/running)`, errorType: 'NOT_CANCELLABLE' } };
  }
  const updated = await _updateJob(id, { status: 'cancelled' });
  return { status: 200, body: { success: true, job: updated } };
}

// action:'duplicate' {id} — clone seed dossier (desk/extract/generate/refIdLock) เป็น job ใหม่ pending
export async function duplicateRefTestJob(id, deps = {}) {
  const { getJob: _getJob, newJob: _newJob, updateJob: _updateJob } = deps;
  if (typeof _getJob !== 'function' || typeof _newJob !== 'function' || typeof _updateJob !== 'function') {
    return { status: 500, body: { success: false, error: 'store deps ไม่พร้อม', errorType: 'INTERNAL' } };
  }
  const src = await _getJob(id);
  if (!src) return { status: 404, body: { success: false, error: 'ไม่พบงานต้นฉบับ', errorType: 'NOT_FOUND' } };
  const sd = src.dossier || {};
  const seedDossier = {
    ...(sd.desk ? { desk: sd.desk } : {}),
    ...(sd.extract ? { extract: sd.extract } : {}),
    ...(sd.generate ? { generate: sd.generate } : {}),
    ...(sd.refIdLock ? { refIdLock: sd.refIdLock } : {}),
  };
  const created = await _newJob({ mode: src.mode || 'reftest' });
  const updated = await _updateJob(created.id, { stage: 'rt_compass', status: 'pending', dossier: seedDossier });
  return { status: 200, body: { success: true, job: updated, sourceId: id } };
}
