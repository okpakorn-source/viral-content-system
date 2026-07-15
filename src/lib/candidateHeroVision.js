// ============================================================
// [MEGA · Candidate Hero Vision — Batch B5 SHADOW] ตัววัด hero metrics 3 ตัวสุดท้ายต่อภาพผู้สมัคร
// ------------------------------------------------------------
// heroShotContract.js กำหนด REQUIRED_CANDIDATE_FIELDS ให้ candidate ต้องมี occlusion / cleanliness /
//   visibleBodyRegion (นอกเหนือ identity/geometry) แต่ "ยังไม่มีผู้ผลิตค่าเหล่านี้จริง" ในระบบวันนี้ —
//   _rhHeroCandidate จึงยังไม่ผลิต hero-vision authority. โมดูลนี้คือ authority ที่ถูกต้องของ 3 ค่านั้น:
//     occlusion (0..1) · cleanliness (0..1) · visibleBodyRegion (enum 6 ขั้น) จาก "หลักฐานภาพแท้"
//     (วิเคราะห์ภาพผู้สมัครใบเดียวด้วย vision — ต่างจาก B4 identity ที่ต้องมี reference บุคคล;
//      B5 วัด "ภาพใบนี้เอง" ไม่ต้องมีคนอ้างอิง). วิเคราะห์อย่างเดียว ห้ามเจน/แก้พิกเซล.
//
// B5 = SHADOW: evidence bridge สร้าง authorityEvidence.heroVisionById ขนานกับ
//   factsById/metricsById/cropReadiness/identityById — แต่จุดกักกัน _rhCastCandidate/_rhHeroCandidate
//   "ยังไม่อ่าน" (การ consume คือแบตช์หลัง). heroShotContract.js / candidateCropReadiness.js /
//   castManifest.js เป็น consumer-contract — โมดูลนี้ไม่แก้ไฟล์เหล่านั้นเลย.
//
// 🔴 กฎเหล็ก:
//   • 💰 vision จริงเฉพาะ process.env.MEGA_HERO_VISION === '1' เป๊ะ. OFF (ค่าเริ่มต้น) = อ่าน cache
//     อย่างเดียว ไม่มี network เด็ดขาด → ส่วนใหญ่ absent.
//   • cache 2 ชั้น (mem + data/hero-vision-cache.json) key = (image identity hash, prompt version)
//     — ไม่มี personId (วัดภาพใบเดียว ไม่ผูกบุคคล) — ห้ามวัดภาพเดิมซ้ำ.
//   • แม้ ON: per-call timeout + จำกัด concurrency + เพดานจำนวน vision call ต่อรอบ S6. เกิน/พัง/timeout ⇒ absent เงียบ.
//   • JSON strict + all-or-nothing: ค่าทั้ง 3 ต้อง valid ครบ (occlusion∈[0,1], cleanliness∈[0,1],
//     visibleBodyRegion∈enum) จึงคืนผล; ค่าใดเพี้ยน/นอกช่วง/enum ผิด/JSON เพี้ยน ⇒ absent ทั้งก้อน ไม่ cache
//     (ห้าม clamp เงียบให้ผ่าน · ห้ามคืนผลบางส่วน — consumer heroShotContract ต้องการครบ 3 ค่า).
//   • vision ผ่าน client เดิม (callAI แพตเทิร์น faceDetector/B4) วิเคราะห์ล้วน ห้ามอิงเพศ/ชื่อ.
//
// absent = undefined (ผู้บริโภคเห็น "ไม่มีหลักฐาน" ชัดเจน — ไม่ default ค่ามั่ว).
// ทุก IO/network/ค่า config ฉีดผ่าน `deps` ได้ (DI) เพื่อเทสแบบไม่แตะดิสก์/ไม่ยิงเน็ตเลย.
// ============================================================

export const HERO_VISION_SCOPE = 'candidate_hero_vision_v1';

// prompt version — bump เมื่อ prompt/สัญญาผลลัพธ์เปลี่ยน เพื่อ invalidate cache เดิมทั้งหมด (เข้าเป็นส่วนของ cache key)
export const HERO_VISION_PROMPT_VERSION = 'hv1';

// ── enum ขั้นการเห็นตัวคนหลัก — MIRROR heroShotContract.js:31-33 VISIBLE_BODY_REGIONS เป๊ะ (ascending) ──
//   re-declare local ตามแพตเทิร์นไฟล์เพื่อน (candidateIdentityVerifier re-declare 0.75 local) เพื่อคง import-free;
//   เทสยืนยันว่าเท่ากับ export ของ heroShotContract 100% (กัน drift). ลำดับ index มีความหมาย (ห้ามสลับ).
export const HERO_VISION_BODY_REGIONS = Object.freeze([
  'face_only', 'head_shoulders', 'bust', 'half_body', 'three_quarter', 'full_body',
]);
const BODY_REGION_SET = new Set(HERO_VISION_BODY_REGIONS);

// ── policy อ้างอิง (heroShotContract.js:92-95) — โมดูลนี้ "วัด" ล้วน ไม่บังคับ policy (evaluator เป็นคนบังคับ) ──
//   ใส่ในพร้อมท์เป็นสเกลอ้างอิงให้โมเดลตีความ cleanliness คงเส้นคงวา (ต่ำกว่า 0.5 = ไม่ผ่าน policy)
//   แต่ไม่ clamp/reject ในโมดูลนี้ — คืนค่าดิบที่ valid อย่างเดียว.
const POLICY_MIN_CLEANLINESS_REF = 0.5;   // heroShotContract POLICY_MIN_CLEANLINESS
const POLICY_OCCLUSION_MAX_REF = 0.15;    // heroShotContract POLICY_OCCLUSION_MAX

// ── เพดานคุมค่าใช้จ่าย (มีผลเฉพาะเมื่อ switch ON) ──
// เพดานจำนวน vision call ต่อ "รอบ S6" หนึ่ง — bridge เรียก _resetHeroVisionRound() ก่อนต้นรอบ, เกินเพดาน ⇒ absent
const MAX_HERO_VISION_CALLS_PER_ROUND = 12;
// จำนวน vision call ที่รันพร้อมกันได้สูงสุด (semaphore) — กันยิงถล่ม provider
const MAX_HERO_VISION_CONCURRENCY = 2;
// timeout ต่อ 1 vision call (ms) — เกินเวลา ⇒ absent เงียบ (ยกเลิกด้วย AbortController ด้วยเมื่อ client รองรับ)
const HERO_VISION_TIMEOUT_MS = 20000;

const HERO_VISION_CACHE_FILE_REL = ['data', 'hero-vision-cache.json'];
const MEM_CACHE_CAP = 500;
const FILE_CACHE_CAP = 1000;

const ABSENT = undefined;

// ============================================================
// helpers เล็ก ๆ (บริสุทธิ์)
// ============================================================
const _nonBlank = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function _switchOn(env) {
  const e = env || {};
  return e.MEGA_HERO_VISION === '1';
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

// cache key = (image identity hash, prompt version) — length-prefix (netstring) กันค่าใน field หนึ่งไหลข้ามอีก field
export function _heroVisionCacheKey(imageHash, promptVersion) {
  const parts = [String(imageHash), String(promptVersion)];
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

// อ่าน 1 unit-interval field (0..1) จากผล vision — นอกช่วง/ไม่ finite/ผิดชนิด ⇒ null (ทั้งก้อน absent ที่ผู้เรียก)
function _unit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

// แปลผล vision (JSON strict) → {occlusion, cleanliness, visibleBodyRegion} ครบทั้ง 3 หรือ ABSENT (all-or-nothing)
//   ห้าม clamp เงียบ · ห้ามคืนบางส่วน (consumer heroShotContract ต้องการครบ 3 ค่า — partial = ไร้ประโยชน์ + หลอกว่าผ่าน)
function _parseHeroVision(parsed) {
  if (!parsed || typeof parsed !== 'object') return ABSENT;
  const occlusion = _unit(parsed.occlusion);
  if (occlusion === null) return ABSENT;
  const cleanliness = _unit(parsed.cleanliness);
  if (cleanliness === null) return ABSENT;
  const region = _nonBlank(parsed.visible_body_region);
  if (!region || !BODY_REGION_SET.has(region)) return ABSENT; // enum ผิด/ว่าง ⇒ absent (ห้าม map/เดา)
  return { occlusion, cleanliness, visibleBodyRegion: region };
}

// prompt วัด hero-vision — วิเคราะห์ล้วน, JSON strict, ห้ามอิงเพศ/ชื่อ, ห้ามเจน/บรรยาย/แก้ภาพ
//   rubric ต่อ metric เขียนให้วัดได้จริง+คงเส้นคงวา (ผูก policy scale ของ heroShotContract)
const HERO_VISION_PROMPT = `You are a forensic IMAGE-QUALITY model. You are given ONE candidate photo intended for use as the HERO (main person) on a cover.
Measure THREE properties of THIS single image. Judge STRICTLY from what is visibly present in the pixels. Analysis only — do NOT describe, redraw, edit, upscale, or generate any imagery. Do NOT guess any name/gender/age.

1) occlusion (0.0-1.0): the fraction of the MAIN person's FACE that is blocked/covered by anything in front of it — a hand, microphone, phone, object, another person, or burned-in text/graphics/emoji laid OVER the face. 0.0 = the face is fully visible and unobstructed; 1.0 = the face is essentially fully hidden. (For reference, a hero shot typically needs occlusion at or below ${POLICY_OCCLUSION_MAX_REF}.) If there is NO clear human face, use a value near 1.0.

2) cleanliness (0.0-1.0): how CLEAN the foreground and scene are — free of text overlays, burned-in captions/subtitles, quote/dialogue overlays, watermarks, channel logos, stickers, or heavy graphics laid over the photo. 1.0 = a pristine photograph with no overlaid text/graphics/watermark at all; below ${POLICY_MIN_CLEANLINESS_REF} = clearly not clean (headline graphic, screenshot with captions, or prominent watermark). Judge overlays only — ordinary background scenery is NOT dirtiness.

3) visible_body_region: how much of the MAIN person's body is visible in frame. Choose EXACTLY ONE of these tokens (ascending amount of body shown), and return the token verbatim:
   "face_only" = essentially just the face fills the frame
   "head_shoulders" = head and shoulders
   "bust" = down to mid-chest
   "half_body" = down to about the waist
   "three_quarter" = down to about the knees
   "full_body" = the whole body including legs/feet
Pick the single token that best matches how much of the body is actually visible.

Return JSON ONLY, no prose, no markdown:
{ "occlusion": 0.0, "cleanliness": 0.0, "visible_body_region": "head_shoulders", "evidence": "short reason citing only what is visible" }`;

// ============================================================
// per-round ceiling + concurrency semaphore (module state — resettable ต่อรอบ S6)
// ============================================================
let _visionCallsThisRound = 0;
let _activeSlots = 0;
const _slotWaiters = [];

// เรียกจาก bridge ก่อนต้นรอบ S6 (และในเทส) — รีเซ็ตตัวนับเพดานต่อรอบ
export function _resetHeroVisionRound() {
  _visionCallsThisRound = 0;
}

async function _acquireSlot() {
  if (_activeSlots < MAX_HERO_VISION_CONCURRENCY) { _activeSlots++; return; }
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
  return HERO_VISION_CACHE_FILE_REL.join('/'); // relative cwd/data/hero-vision-cache.json (fs.mkdir recursive จัดการ dir)
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
export async function _flushHeroVisionWrites() {
  const ps = _pendingWrites;
  _pendingWrites = [];
  await Promise.allSettled(ps);
}

// ล้าง cache ทั้ง 2 ชั้นในหน่วยความจำ (เทส/รีเซ็ต state ระหว่างเคส)
export function _clearHeroVisionCaches() {
  _memCache.clear();
  _fileCache = null;
  _fileCacheLoaded = false;
  _pendingWrites = [];
}

// ============================================================
// vision measure (นับเพดาน + semaphore + timeout) — คืน {occlusion,cleanliness,visibleBodyRegion} หรือ absent
// ============================================================
async function _runVisionMeasure({ candidate, deps, env }) {
  const candImg = _imageContent(candidate);
  if (!candImg) return ABSENT; // ไม่มีพิกเซล = vision รันไม่ได้ → absent

  _visionCallsThisRound++; // นับ "ความพยายามเรียก" เข้ากับเพดานต่อรอบ (เช็คเพดานทำก่อนเรียกฟังก์ชันนี้)
  await _acquireSlot();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Number.isFinite(deps?.visionTimeoutMs) ? deps.visionTimeoutMs : HERO_VISION_TIMEOUT_MS;
  let timer = null;
  try {
    const callAI = typeof deps?.callAI === 'function'
      ? deps.callAI
      : (env && _switchOn(env) ? (await import('@/lib/ai/openai')).callAI : null);
    if (typeof callAI !== 'function') return ABSENT;

    const callP = Promise.resolve().then(() => callAI({
      prompt: HERO_VISION_PROMPT,
      imageContents: [candImg], // ภาพผู้สมัครใบเดียว (ไม่ต้องมี reference บุคคล — ต่างจาก B4)
      model: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 300,
      signal: controller ? controller.signal : undefined,
    }));
    const timeoutP = new Promise((_res, rej) => {
      timer = setTimeout(() => { try { controller?.abort(); } catch { /* noop */ } rej(new Error('HERO_VISION_TIMEOUT')); }, timeoutMs);
    });
    const parsed = await Promise.race([callP, timeoutP]);
    return _parseHeroVision(parsed);
  } catch {
    return ABSENT; // timeout / พัง / abort ⇒ absent เงียบ
  } finally {
    if (timer) clearTimeout(timer);
    _releaseSlot();
  }
}

// ============================================================
// PUBLIC — measureHeroVision
// ============================================================
/**
 * วัด hero metrics 3 ตัวของภาพผู้สมัคร 1 ใบ (ไม่ต้องมี reference บุคคล — วัดภาพใบนี้เอง).
 * @param {object} args
 * @param {object} args.candidate  { imageHash?: string, hash?:{value}, facts?:{hash:{value}}, image?:{dataUrl|base64} }
 *                                  — imageHash ที่ผูกได้ (dHash validated) จำเป็นเสมอ; image ต้องมีเมื่อจะ vision จริง
 * @param {object} [args.deps]     DI: callAI, fs, cacheFile, now, env, visionTimeoutMs
 * @returns {Promise<{scope,occlusion,cleanliness,visibleBodyRegion,promptVersion}|undefined>}
 *          — undefined = absent (ไม่มี hash/ปิดสวิตช์ไม่มี cache/พัง/เกินเพดาน/ผลไม่ครบ 3 valid)
 */
export async function measureHeroVision({ candidate, deps } = {}) {
  try {
    const env = deps?.env || (typeof process !== 'undefined' ? process.env : {});

    // 1) candidate ต้องมี image identity hash ที่ผูกได้
    const imageHash = _candidateImageHash(candidate);
    if (!imageHash) return ABSENT;

    // 2) cache key = (image identity hash, prompt version) — อ่าน cache ก่อนเสมอ (ทั้ง ON/OFF)
    const cacheKey = _heroVisionCacheKey(imageHash, HERO_VISION_PROMPT_VERSION);
    const cached = await _getCached(cacheKey, deps);
    if (cached) return cached;

    // 3) สวิตช์: OFF (ค่าเริ่มต้น) = cache-only ไม่มี network เด็ดขาด → absent
    if (!_switchOn(env)) return ABSENT;

    // 4) เพดานจำนวน vision call ต่อรอบ S6 — เกิน ⇒ absent เงียบ (ตรวจก่อนเรียกจริง)
    if (_visionCallsThisRound >= MAX_HERO_VISION_CALLS_PER_ROUND) return ABSENT;

    // 5) vision จริง (semaphore + timeout ภายใน) — ผลต้องครบ 3 valid มิฉะนั้น absent (ไม่ cache ค่าเสีย)
    const m = await _runVisionMeasure({ candidate, deps, env });
    if (m === ABSENT) return ABSENT;

    const result = Object.freeze({
      scope: HERO_VISION_SCOPE,
      occlusion: m.occlusion,
      cleanliness: m.cleanliness,
      visibleBodyRegion: m.visibleBodyRegion,
      promptVersion: HERO_VISION_PROMPT_VERSION,
    });
    _setCached(cacheKey, result, deps);
    return result;
  } catch {
    return ABSENT; // fail-closed ทุกกรณี
  }
}
