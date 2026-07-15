// ============================================================
// [MEGA · Candidate Identity Verifier — Batch B4 SHADOW] แหล่งความจริงของ "ตัวตน" ต่อภาพผู้สมัคร
// ------------------------------------------------------------
// วัด "คนในภาพผู้สมัครใบนี้ คือบุคคลเดียวกับหลักฐานอ้างอิงที่ระบบยืนยันแล้วหรือไม่" → ผลิต
//   identityConfidence (0..1) + identityVerified (boolean) จาก "หลักฐานภาพแท้" เท่านั้น
//   (เทียบใบหน้า reference ↔ candidate ด้วย vision — วิเคราะห์อย่างเดียว ห้ามเจน/แก้พิกเซล).
//
// เหตุผลที่มี (P0 boundary — ดู megaAdapters.js:2047-2048): วันนี้ระบบ "ไม่มี identity-verifier
//   authority" จริง → _rhCastCandidate hardcode identityVerified:false และ _rhHeroCandidate ปล่อย
//   identityConfidence=undefined (absent). โมดูลนี้คือ authority ที่ถูกต้องของค่านั้น. B4 = SHADOW:
//   evidence bridge สร้าง authorityEvidence.identityById ขนานกับ factsById/metricsById/cropReadiness
//   แต่จุดกักกัน _rhCastCandidate/_rhHeroCandidate "ยังไม่อ่าน" — การ consume คือแบตช์หลัง.
//
// 🔴 กฎเหล็ก:
//   • หลักฐานอ้างอิงต้องเป็น "reference asset ที่ระบบยืนยันแล้วต่อ personId" และตรวจย้อนได้เท่านั้น
//     (มี provenance ในชุด TRUSTED_REFERENCE_PROVENANCE + referenceHash ที่ผูกได้) — ไม่มี/ไม่น่าเชื่อ
//     ⇒ absent (ห้ามเรียก vision ด้วยซ้ำ, ห้ามเดา, ห้ามใช้ชื่อ/เพศแทนภาพ). claimedPerson = "ข้อกล่าวอ้าง
//     ที่จะถูกตรวจ" ไม่ใช่หลักฐาน.
//   • 💰 vision จริงเฉพาะ process.env.MEGA_IDENTITY_VERIFIER === '1' เป๊ะ. OFF (ค่าเริ่มต้น) = อ่าน
//     cache อย่างเดียว ไม่มี network เด็ดขาด → ส่วนใหญ่ absent.
//   • cache 2 ชั้น (mem + data/identity-cache.json) key = (image identity hash, personId, prompt version)
//     — ห้ามวัดภาพ+คนเดิมซ้ำ.
//   • แม้ ON: per-call timeout + จำกัด concurrency + เพดานจำนวน vision call ต่อรอบ S6. เกิน/พัง/timeout ⇒ absent เงียบ.
//   • vision ผ่าน client เดิม (callAI แพตเทิร์น faceDetector) วิเคราะห์ล้วน JSON strict ห้ามอิงเพศ/ชื่อ.
//
// absent = undefined (ผู้บริโภคเห็น "ไม่มีหลักฐาน" ชัดเจน — ไม่ default ค่ามั่ว).
// ทุก IO/network/ค่า config ฉีดผ่าน `deps` ได้ (DI) เพื่อเทสแบบไม่แตะดิสก์/ไม่ยิงเน็ตเลย.
// ============================================================

export const IDENTITY_SCOPE = 'candidate_identity_v1';

// prompt version — bump เมื่อ prompt/สัญญาผลลัพธ์เปลี่ยน เพื่อ invalidate cache เดิมทั้งหมด (เข้าเป็นส่วนของ cache key)
export const IDENTITY_PROMPT_VERSION = 'idv1';

// เกณฑ์ตัดสิน identityVerified — สอดคล้อง DEFAULT_IDENTITY_CONFIDENCE_MIN ใน heroShotContract.js:84 (0.75)
export const IDENTITY_CONFIDENCE_MIN = 0.75;

// แหล่งอ้างอิงตัวตนที่ "เชื่อถือได้ + ตรวจย้อนได้" — reference evidence จะถูกเชื่อก็ต่อเมื่อ provenance อยู่ในชุดนี้
//   story_verified_reference  = ภาพอ้างอิงจาก STORY authority (identities/eligibleAssetProvenance ที่ยืนยันแล้ว)
//   enrolled_cast_reference   = ภาพอ้างอิงของ cast ที่ถูก enroll/ยืนยันเข้าสัญญาแล้ว
// อื่นใด (เช่น "triage.person guess" / label ดิบ / ชื่อ) = untrusted → absent
const TRUSTED_REFERENCE_PROVENANCE = new Set(['story_verified_reference', 'enrolled_cast_reference']);

// ── เพดานคุมค่าใช้จ่าย (มีผลเฉพาะเมื่อ switch ON) ──
// เพดานจำนวน vision call ต่อ "รอบ S6" หนึ่ง — bridge เรียก _resetIdentityRound() ก่อนต้นรอบ, เกินเพดาน ⇒ absent
const MAX_IDENTITY_VISION_CALLS_PER_ROUND = 12;
// จำนวน vision call ที่รันพร้อมกันได้สูงสุด (semaphore) — กันยิงถล่ม provider
const MAX_IDENTITY_VISION_CONCURRENCY = 2;
// timeout ต่อ 1 vision call (ms) — เกินเวลา ⇒ absent เงียบ (ยกเลิกด้วย AbortController ด้วยเมื่อ client รองรับ)
const IDENTITY_VISION_TIMEOUT_MS = 20000;

const IDENTITY_CACHE_FILE_REL = ['data', 'identity-cache.json'];
const MEM_CACHE_CAP = 500;
const FILE_CACHE_CAP = 1000;

const ABSENT = undefined;

// ============================================================
// helpers เล็ก ๆ (บริสุทธิ์)
// ============================================================
const _nonBlank = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function _switchOn(env) {
  const e = env || {};
  return e.MEGA_IDENTITY_VERIFIER === '1';
}

// fnv1a32 (แพตเทิร์นในไฟล์เพื่อน) — cache key ล้วน (ไม่ใช่ security digest) จึงพอเพียง; length-prefix กันขอบเขต field ปน
function _fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// cache key = (image identity hash, personId, prompt version) — length-prefix (netstring) กันค่าใน field หนึ่งไหลข้ามอีก field
export function _identityCacheKey(imageHash, personId, promptVersion) {
  const parts = [String(imageHash), String(personId), String(promptVersion)];
  return _fnv1a32(parts.map((s) => `${s.length}:${s}`).join(''));
}

// stable "image identity hash" ของ candidate — ใช้ dHash ที่ validate แล้ว (facts.hash.value) เป็นตัวผูก cache
//   (ตรวจย้อนได้ · ภาพเดียวกัน = คีย์เดียวกัน) · รับได้ทั้ง candidate.imageHash ตรง หรือ facts.hash.value
function _candidateImageHash(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const direct = _nonBlank(candidate.imageHash);
  if (direct) return direct;
  const h = candidate.hash && typeof candidate.hash === 'object' ? candidate.hash : null;
  if (h && _nonBlank(h.value)) return _nonBlank(h.value);
  const f = candidate.facts && typeof candidate.facts === 'object' ? candidate.facts : null;
  if (f && f.hash && typeof f.hash === 'object' && _nonBlank(f.hash.value)) return _nonBlank(f.hash.value);
  return null;
}

// สร้าง image_url content สำหรับ callAI จาก {dataUrl} หรือ {base64} — ไม่มีพิกเซล ⇒ null (vision รันไม่ได้ ⇒ absent)
function _imageContent(holder) {
  const img = holder && typeof holder === 'object' && holder.image && typeof holder.image === 'object' ? holder.image : null;
  if (!img) return null;
  let url = _nonBlank(img.dataUrl);
  if (!url) {
    const b64 = _nonBlank(img.base64);
    if (b64) url = `data:image/jpeg;base64,${b64}`;
  }
  if (!url) return null;
  return { type: 'image_url', image_url: { url, detail: 'low' } };
}

// ตรวจ referenceEvidence ว่าเป็น "หลักฐานอ้างอิงตัวตนที่เชื่อได้ + ตรวจย้อนได้ + เป็นของบุคคลที่ถูกกล่าวอ้างคนเดียวกัน"
//   ไม่ผ่านข้อใด ⇒ null (⇒ absent, ห้ามเรียก vision). ห้ามเดา — ต้องมี provenance ที่ trusted + referenceHash ผูกได้.
function _validateReferenceEvidence(re, personId) {
  if (!re || typeof re !== 'object') return null;
  const rp = _nonBlank(re.personId);
  if (!rp || rp !== personId) return null;                 // reference ต้องเป็นของ "บุคคลที่ถูกกล่าวอ้าง" คนเดียวกันเป๊ะ
  const prov = _nonBlank(re.provenance);
  if (!prov || !TRUSTED_REFERENCE_PROVENANCE.has(prov)) return null; // แหล่งอ้างอิงต้อง trusted เท่านั้น
  const referenceHash = _nonBlank(re.referenceHash);
  if (!referenceHash) return null;                          // ต้องผูกกลับไปยัง reference asset ที่ระบุตัวได้
  const image = re.image && typeof re.image === 'object' ? re.image : null; // พิกเซล — จำเป็นเฉพาะตอนต้อง vision จริง
  return { personId: rp, provenance: prov, referenceHash, image };
}

// อ่าน identity_confidence (0..1) จากผล vision (JSON strict) — นอกช่วง/ไม่ finite/ผิดชนิด ⇒ absent
function _parseConfidence(parsed) {
  if (!parsed || typeof parsed !== 'object') return ABSENT;
  const c = Number(parsed.identity_confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) return ABSENT;
  return c;
}

// prompt เทียบใบหน้า — วิเคราะห์ล้วน, JSON strict, ห้ามอิงเพศ/ชื่อ/ฉาก, ห้ามเจน/บรรยาย/แก้ภาพ
const IDENTITY_PROMPT = `You are a forensic FACE-COMPARISON model. You are given TWO images:
IMAGE 1 = a VERIFIED reference photo of ONE specific person.
IMAGE 2 = a candidate photo to check.
Decide ONLY whether the most prominent REAL human face in IMAGE 2 is the SAME individual as the person shown in IMAGE 1.
Judge STRICTLY from visible facial structure (eye shape/spacing, nose, mouth, jawline, overall proportions).
Do NOT infer identity from clothing, background, on-image text/captions, the scene, or any assumed gender/age/ethnicity — you are given no names and must not guess any.
Do NOT describe, redraw, edit, upscale, or generate any imagery. Analysis only.
Return JSON ONLY, no prose, no markdown:
{ "identity_confidence": 0.0, "same_person": false, "evidence": "short reason citing facial features only" }
identity_confidence = your probability (0.0-1.0) that IMAGE 2 shows the SAME individual as IMAGE 1. If the face in IMAGE 2 is unclear, occluded, or absent, use a value near 0.5 and same_person=false.`;

// ============================================================
// per-round ceiling + concurrency semaphore (module state — resettable ต่อรอบ S6)
// ============================================================
let _visionCallsThisRound = 0;
let _activeSlots = 0;
const _slotWaiters = [];

// เรียกจาก bridge ก่อนต้นรอบ S6 (และในเทส) — รีเซ็ตตัวนับเพดานต่อรอบ
export function _resetIdentityRound() {
  _visionCallsThisRound = 0;
}

async function _acquireSlot() {
  if (_activeSlots < MAX_IDENTITY_VISION_CONCURRENCY) { _activeSlots++; return; }
  await new Promise((res) => _slotWaiters.push(res)); // ถูกปลุกโดยผู้ปล่อย slot (นับ slot ถูกส่งต่อ ไม่เพิ่มซ้ำ)
}
function _releaseSlot() {
  const next = _slotWaiters.shift();
  if (next) next();          // ส่งต่อ slot ให้คิวถัดไป — _activeSlots คงเดิม
  else _activeSlots = Math.max(0, _activeSlots - 1);
}

// ============================================================
// cache 2 ชั้น (mem + ไฟล์) — IO ฉีดผ่าน deps.fs / deps.cacheFile / deps.now ได้ (เทสไม่แตะดิสก์)
// ============================================================
const _memCache = new Map();   // key -> frozen result
let _fileCache = null;          // key -> { ts, result } (null = ยังไม่โหลด)
let _fileCacheLoaded = false;
let _pendingWrites = [];

function _now(deps) { return typeof deps?.now === 'function' ? deps.now() : Date.now(); }
function _cacheFilePath(deps) {
  if (_nonBlank(deps?.cacheFile)) return deps.cacheFile;
  return IDENTITY_CACHE_FILE_REL.join('/'); // relative cwd/data/identity-cache.json (fs.mkdir recursive จัดการ dir)
}
async function _fsMod(deps) {
  if (deps?.fs && typeof deps.fs.readFile === 'function') return deps.fs;
  const m = await import('node:fs/promises');
  return { readFile: m.readFile, writeFile: m.writeFile, mkdir: m.mkdir };
}

function _evict(map, cap) {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}
function _capByTs(entries, cap) {
  const keys = Object.keys(entries || {});
  if (keys.length <= cap) return;
  const sorted = keys.sort((a, b) => (entries[a]?.ts || 0) - (entries[b]?.ts || 0));
  for (let i = 0; i < keys.length - cap; i++) delete entries[sorted[i]];
}

async function _loadFileCache(deps) {
  if (_fileCacheLoaded) return _fileCache;
  try {
    const fsm = await _fsMod(deps);
    const raw = await fsm.readFile(_cacheFilePath(deps), 'utf-8');
    const parsed = JSON.parse(raw);
    _fileCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    _fileCache = {}; // ไม่มีไฟล์/พัง/parse ไม่ได้ → เริ่มว่าง (best-effort, ไม่ทำให้ measure พัง)
  }
  _fileCacheLoaded = true;
  return _fileCache;
}

// อ่าน cache: mem ก่อน → ไฟล์ (warm mem) — คืน result หรือ null
async function _getCached(key, deps) {
  if (!key) return null;
  if (_memCache.has(key)) {
    const r = _memCache.get(key);
    _memCache.delete(key); _memCache.set(key, r); // bump LRU
    return r;
  }
  try {
    const fc = await _loadFileCache(deps);
    const entry = fc[key];
    if (entry && entry.result) {
      _memCache.set(key, entry.result);
      _evict(_memCache, MEM_CACHE_CAP);
      return entry.result;
    }
  } catch { /* อ่านไม่ได้ = ไม่มี cache */ }
  return null;
}

// เขียน cache 2 ชั้น — mem ทันที (sync) + ไฟล์เบื้องหลัง (best-effort, track ใน _pendingWrites ให้เทส flush ได้)
function _setCached(key, result, deps) {
  if (!key) return;
  _memCache.set(key, result);
  _evict(_memCache, MEM_CACHE_CAP);
  const p = (async () => {
    try {
      const fsm = await _fsMod(deps);
      const fc = await _loadFileCache(deps);
      fc[key] = { ts: _now(deps), result };
      _capByTs(fc, FILE_CACHE_CAP);
      const path = _cacheFilePath(deps);
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      if (slash > 0) { try { await fsm.mkdir(path.slice(0, slash), { recursive: true }); } catch { /* dir อาจมีอยู่แล้ว */ } }
      await fsm.writeFile(path, JSON.stringify(fc), 'utf-8');
    } catch { /* เขียนไม่ได้ = ไม่กระทบผล (mem ยังใช้ได้) */ }
  })();
  _pendingWrites.push(p);
}

// รอ file-write เบื้องหลังจบ (สำหรับเทสยืนยันไฟล์ · production ไม่จำเป็นต้องเรียก)
export async function _flushIdentityWrites() {
  const ps = _pendingWrites;
  _pendingWrites = [];
  await Promise.allSettled(ps);
}

// ล้าง cache ทั้ง 2 ชั้นในหน่วยความจำ (เทส/รีเซ็ต state ระหว่างเคส)
export function _clearIdentityCaches() {
  _memCache.clear();
  _fileCache = null;
  _fileCacheLoaded = false;
  _pendingWrites = [];
}

// ============================================================
// vision compare (นับเพดาน + semaphore + timeout) — คืน confidence 0..1 หรือ absent
// ============================================================
async function _runVisionCompare({ candidate, ref, deps, env }) {
  const candImg = _imageContent(candidate);
  const refImg = _imageContent(ref);
  if (!candImg || !refImg) return ABSENT; // ไม่มีพิกเซลฝั่งใด = vision รันไม่ได้ → absent

  _visionCallsThisRound++; // นับ "ความพยายามเรียก" เข้ากับเพดานต่อรอบ (เช็คเพดานทำก่อนเรียกฟังก์ชันนี้)
  await _acquireSlot();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Number.isFinite(deps?.visionTimeoutMs) ? deps.visionTimeoutMs : IDENTITY_VISION_TIMEOUT_MS;
  let timer = null;
  try {
    const callAI = typeof deps?.callAI === 'function'
      ? deps.callAI
      : (env && _switchOn(env) ? (await import('@/lib/ai/openai')).callAI : null);
    if (typeof callAI !== 'function') return ABSENT;

    const callP = Promise.resolve().then(() => callAI({
      prompt: IDENTITY_PROMPT,
      imageContents: [refImg, candImg], // IMAGE 1 = reference (ยืนยันแล้ว), IMAGE 2 = candidate
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 300,
      signal: controller ? controller.signal : undefined,
    }));
    const timeoutP = new Promise((_res, rej) => {
      timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } rej(new Error('IDENTITY_VISION_TIMEOUT')); }, timeoutMs);
    });
    const parsed = await Promise.race([callP, timeoutP]);
    return _parseConfidence(parsed);
  } catch {
    return ABSENT; // timeout / พัง / abort ⇒ absent เงียบ
  } finally {
    if (timer) clearTimeout(timer);
    _releaseSlot();
  }
}

// ============================================================
// PUBLIC — measureCandidateIdentity
// ============================================================
/**
 * วัดตัวตนของภาพผู้สมัคร 1 ใบ เทียบหลักฐานอ้างอิงที่ยืนยันแล้ว.
 * @param {object} args
 * @param {object} args.candidate        { imageHash?: string, hash?:{value}, facts?:{hash:{value}}, image?:{dataUrl|base64} }
 *                                        — imageHash ที่ผูกได้ (dHash validated) จำเป็นเสมอ; image ต้องมีเมื่อจะ vision จริง
 * @param {object} args.claimedPerson    { personId: string, name?: string } — "ข้อกล่าวอ้าง" ที่จะถูกตรวจ (ไม่ใช่หลักฐาน)
 * @param {object} args.referenceEvidence { personId, provenance, referenceHash, image?:{dataUrl|base64} }
 *                                        — หลักฐานอ้างอิงตัวตนที่ยืนยันแล้วของ personId เดียวกัน; ไม่น่าเชื่อ ⇒ absent
 * @param {object} [args.deps]           DI: callAI, fs, cacheFile, now, env, visionTimeoutMs
 * @returns {Promise<{scope,personId,identityConfidence,identityVerified,promptVersion}|undefined>}
 *          — undefined = absent (ไม่มีหลักฐาน/ปิดสวิตช์ไม่มี cache/พัง/เกินเพดาน)
 */
export async function measureCandidateIdentity({ candidate, claimedPerson, referenceEvidence, deps } = {}) {
  try {
    const env = deps?.env || (typeof process !== 'undefined' ? process.env : {});

    // 1) candidate ต้องมี image identity hash ที่ผูกได้
    const imageHash = _candidateImageHash(candidate);
    if (!imageHash) return ABSENT;

    // 2) claim (personId) — ข้อกล่าวอ้าง ต้องมีเพื่อผูก cache/หลักฐาน แต่ "ไม่ trust เป็นหลักฐาน"
    const personId = _nonBlank(claimedPerson?.personId);
    if (!personId) return ABSENT;

    // 3) หลักฐานอ้างอิงต้องเชื่อได้ + ตรวจย้อนได้ + เป็นของ personId เดียวกัน — ไม่ผ่าน ⇒ absent (ห้าม vision)
    const ref = _validateReferenceEvidence(referenceEvidence, personId);
    if (!ref) return ABSENT;

    // 4) cache key = (image identity hash, personId, prompt version) — อ่าน cache ก่อนเสมอ (ทั้ง ON/OFF)
    const cacheKey = _identityCacheKey(imageHash, personId, IDENTITY_PROMPT_VERSION);
    const cached = await _getCached(cacheKey, deps);
    if (cached) return cached;

    // 5) สวิตช์: OFF (ค่าเริ่มต้น) = cache-only ไม่มี network เด็ดขาด → absent
    if (!_switchOn(env)) return ABSENT;

    // 6) เพดานจำนวน vision call ต่อรอบ S6 — เกิน ⇒ absent เงียบ (ตรวจก่อนเรียกจริง)
    if (_visionCallsThisRound >= MAX_IDENTITY_VISION_CALLS_PER_ROUND) return ABSENT;

    // 7) vision จริง (semaphore + timeout ภายใน)
    const conf = await _runVisionCompare({ candidate, ref, deps, env });
    if (conf === ABSENT) return ABSENT;

    const result = Object.freeze({
      scope: IDENTITY_SCOPE,
      personId,
      identityConfidence: conf,
      identityVerified: conf >= IDENTITY_CONFIDENCE_MIN,
      promptVersion: IDENTITY_PROMPT_VERSION,
    });
    _setCached(cacheKey, result, deps);
    return result;
  } catch {
    return ABSENT; // fail-closed ทุกกรณี
  }
}
