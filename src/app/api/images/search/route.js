// ============================================================
// [ระบบทำปกออโต้] POST /api/images/search
// ------------------------------------------------------------
// body: { caseId, platform } (platform: google|facebook|youtube|tiktok)
// เอาคีย์เวิร์ดของเคส → ค้นภาพผ่าน SerpApi หลายคำค้น → ตัดซ้ำ
// → เก็บเข้าคลังรูปของเคส (mark ที่มา) → คืนสถิติแยกหมวด
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { searchImages, buildQueries, PLATFORMS } from '@/lib/imageSearch';
import { addImages, readImages } from '@/lib/imageStore';
import { isCatalogSource, isOwnPageSource, isMismatchedFbMedia } from '@/lib/junkSources';
import { vetImages } from '@/lib/libraryTriage';

export const runtime = 'nodejs';
export const maxDuration = 600; // ★ 7 ก.ค.: 300→600 — ค้น+vet (EyeScreen ทุกใบ) ต่อแหล่งแตะ 5+ นาทีได้ (กันตายถ้าย้ายขึ้น Vercel)

const MAX_QUERIES = parseInt(process.env.IMAGES_MAX_QUERIES || '3', 10);
const PER_SUBJECT = parseInt(process.env.IMAGES_PER_SUBJECT || '2', 10); // คำค้นขั้นต่ำต่อบุคคล
const MAX_QUERIES_CAP = parseInt(process.env.IMAGES_MAX_QUERIES_CAP || '8', 10);
const PER_QUERY = parseInt(process.env.IMAGES_PER_QUERY || '20', 10); // รูปต่อคำค้น — เอาเฉพาะผลบนสุดที่ตรงสุด (>20 เริ่มมั่ว/ไม่เกี่ยว)
const HARD_CAP = parseInt(process.env.IMAGES_HARD_CAP || '120', 10); // เพดานรวม/แหล่ง — น้อยลงแต่ตรงกว่า (ปรับที่ env ได้)
// ★ 8 ก.ค. แก้ 1 (เร่งค้นภาพ): ยิง SerpApi ขนานเป็นชุดละ N คำ (คำค้นแต่ละคำไม่เกี่ยวกัน)
//   ประมวลผลเรียงตามลำดับคำค้นเดิมเสมอ (การันตีหลักฐาน/โมเมนต์นำหน้าเหมือนเดิม) + หยุดระหว่างชุดเมื่อถึงเพดาน
//   kill-switch: IMG_QUERY_CONC=1 = กลับพฤติกรรมยิงทีละคำแบบเดิมเป๊ะ
const QUERY_CONC = Math.max(1, parseInt(process.env.IMG_QUERY_CONC || '4', 10));
// ★ เฟส 1.5 (9 ก.ค.): ด่านนำเข้า — ถ้า SerpApi ให้ขนาดมาและ shortSide < นี้ → ติดธง lowRes=true (ห้ามทิ้งภาพ)
//   ใช้ห้ามขึ้นช่องใหญ่/hero (จะยืดแตก) — หลัง rehost วัดจริง (1.2) จะ recompute lowRes จากไฟล์จริง
const LOWRES_MIN_SHORT = parseInt(process.env.IMAGES_LOWRES_MIN_SHORT || '500', 10);
// ★ 9 ก.ค. เฟส 4a: โควตาคำค้นต่อแหล่ง — ยกเป็น ≥12 (จากเดิม ~4-8 ไม่คงเส้นคงวา) ให้หมวดเรื่องราว/emotion ได้ยิงครบ
//   กระทบต้นทุน SerpApi (ยิงมากขึ้นเมื่อภาพหายาก) → ผู้ใช้ปรับได้ที่ env · เพดานภาพรวม/แหล่งยังคุมด้วย HARD_CAP เดิม
const QUERIES_PER_SOURCE = parseInt(process.env.IMG_QUERIES_PER_SOURCE || '12', 10);
// kill-switch: IMG_STORY_QUERIES=0 = โควตา/พฤติกรรมคำค้นเดิม (ตัดหมวดเรื่องราว/emotion + regex สถานที่ไทยล้วน) · unset/'1' = เปิด
const STORY_QUERIES_ON = process.env.IMG_STORY_QUERIES !== '0';

// 🔎 Search Provenance V1 (shadow/diagnostic — โผล่ใน response เฉพาะ MEGA_SEARCH_PROVENANCE=1)
//   สร้าง object นับล้วน bounded — safe non-negative integer หรือ null (vetKept ตอน vet ไม่รัน/ล้ม)
//   ห้ามเก็บ URL/คำค้น/ข้อมูลส่วนตัว · นับไม่ได้/ไม่ปลอดภัย = ตัดฟิลด์ทิ้ง (ไม่เดา) · key order คงที่
export function _searchProvenance(raw) {
  try {
    if (!raw || typeof raw !== 'object') return {}; // ไม่ destructure ก่อน validate — null/accessor/throwing proxy ต้องไม่ throw
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    const out = {};
    const put = (k, v) => { const n = _int(v); if (n !== null) out[k] = n; };
    put('queriesFired', raw.queriesFired);
    put('urlsReturned', raw.urlsReturned);
    put('urlsVetted', raw.urlsVetted);
    if (raw.vetKept === null) out.vetKept = null; else put('vetKept', raw.vetKept);
    put('vetDropped', raw.vetDropped);
    put('vetFailed', raw.vetFailed);
    return out;
  } catch { return {}; } // อ่าน property ใดๆ แล้ว throw (getter/proxy trap) → {} (ไม่ throw ออกไป)
}

// 🔎 Search V2 shadow — joinable candidate provenance (diagnostic-only, opt-in MEGA_SEARCH_SHADOW_V2=1)
//   ให้หลักฐานภายหลัง join candidateId (id ที่ persist แล้ว) กลับไป provider/queryIndex/providerRank ได้
//   pure · ไม่แตะ selection/vet/add · ห้าม URL/query/title/PII · fail-closed descriptor-only sanitizer
const _V2_PROVIDERS = new Set(['google', 'google_news', 'yandex', 'facebook', 'tiktok']);
const _V2_MAX_EMIT = 160;
const _V2_MAX_BYTES = 32 * 1024;
const _V2_ID_MAX = 192;
const _V2_ENC = new TextEncoder(); // UTF-8 byte length (ไม่ใช่ UTF-16 code unit)
const _v2bytes = (s) => _V2_ENC.encode(s).length;
export function _sanitizeSearchShadowV2(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null;
    const top = new Map();
    for (const k of Reflect.ownKeys(raw)) {
      const d = Object.getOwnPropertyDescriptor(raw, k);
      if (!d || !('value' in d)) return null; // accessor/แปลก = ทิ้งทั้ง carrier (descriptor-only)
      top.set(k, d.value);
    }
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    if (top.get('version') !== 2) return null;
    const totalCandidates = _int(top.get('totalCandidates'));
    const emittedCandidates = _int(top.get('emittedCandidates'));
    const truncatedCandidates = _int(top.get('truncatedCandidates'));
    const capped = top.get('capped');
    if (totalCandidates === null || emittedCandidates === null || truncatedCandidates === null || typeof capped !== 'boolean') return null;
    const candRaw = top.get('candidates');
    if (!Array.isArray(candRaw) || Object.getPrototypeOf(candRaw) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(candRaw, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    if (lenD.value > _V2_MAX_EMIT) return null; // bounded work: reject ก่อน iterate row/descriptor ใดๆ
    const out = [];
    for (let i = 0; i < lenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(candRaw, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor = ทิ้ง
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const em = new Map();
      for (const k of Reflect.ownKeys(el)) {
        const dd = Object.getOwnPropertyDescriptor(el, k);
        if (!dd || !('value' in dd)) return null;
        em.set(k, dd.value);
      }
      const candidateId = em.get('candidateId');
      const provider = em.get('provider');
      const queryIndex = _int(em.get('queryIndex'));
      const providerRank = em.get('providerRank');
      if (typeof candidateId !== 'string' || candidateId.length === 0 || candidateId.length > _V2_ID_MAX) return null;
      if (typeof provider !== 'string' || !_V2_PROVIDERS.has(provider)) return null;
      if (queryIndex === null) return null;
      if (!Number.isSafeInteger(providerRank) || providerRank < 1) return null;
      out.push({ candidateId, provider, queryIndex, providerRank }); // canonical key order
    }
    if (emittedCandidates !== out.length) return null;
    if (truncatedCandidates !== totalCandidates - emittedCandidates) return null;
    if (capped !== (truncatedCandidates > 0)) return null;
    if (emittedCandidates > _V2_MAX_EMIT) return null;
    const carrier = { version: 2, totalCandidates, emittedCandidates, truncatedCandidates, capped, candidates: out };
    if (_v2bytes(JSON.stringify(carrier)) > _V2_MAX_BYTES) return null; // UTF-8 bytes ≤ 32 KiB
    return carrier;
  } catch { return null; } // ownKeys/descriptor/prototype trap throw → null
}
export function _buildSearchShadowV2(cands) {
  const list = Array.isArray(cands) ? cands : [];
  const total = list.length;
  let emitted = list.slice(0, Math.min(_V2_MAX_EMIT, total)); // cap 160 (tail-trim)
  const mk = (arr) => ({ version: 2, totalCandidates: total, emittedCandidates: arr.length, truncatedCandidates: total - arr.length, capped: total - arr.length > 0, candidates: arr });
  while (emitted.length > 0 && _v2bytes(JSON.stringify(mk(emitted))) > _V2_MAX_BYTES) emitted = emitted.slice(0, emitted.length - 1); // 32 KiB UTF-8 tail-trim
  return _sanitizeSearchShadowV2(mk(emitted));
}
// fresh-suffix trust boundary — descriptor-snapshot saved.images/added + own-data-only rows (ไม่เรียก getter/proxy trap)
export function _buildSearchShadowV2FromSaved(saved, attr) {
  try {
    if (!saved || typeof saved !== 'object' || !attr) return null;
    const imD = Object.getOwnPropertyDescriptor(saved, 'images');
    if (!imD || !('value' in imD)) return null; // accessor/หาย → omit
    const all = imD.value;
    if (!Array.isArray(all) || Object.getPrototypeOf(all) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(all, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    const len = lenD.value;
    const adD = Object.getOwnPropertyDescriptor(saved, 'added');
    if (!adD || !('value' in adD)) return null;
    const addedN = adD.value;
    if (!Number.isSafeInteger(addedN) || addedN < 0 || addedN > len) return null; // inconsistent/added>len → omit (ห้ามนับ historical เป็น fresh)
    const cands = [];
    for (let i = len - addedN; i < len; i++) {
      const ed = Object.getOwnPropertyDescriptor(all, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor index → omit V2
      const img = ed.value;
      if (!img || typeof img !== 'object' || Array.isArray(img)) return null; // malformed fresh row → omit V2
      const idD = Object.getOwnPropertyDescriptor(img, 'id');
      const urlD = Object.getOwnPropertyDescriptor(img, 'imageUrl');
      if ((idD && !('value' in idD)) || (urlD && !('value' in urlD))) return null; // accessor id/imageUrl → omit V2 (never invoke getter)
      const id = idD ? idD.value : undefined;
      const url = urlD ? urlD.value : undefined;
      const a = url === undefined ? undefined : attr.get(url);
      if (!a || typeof id !== 'string' || id.length === 0 || id.length > _V2_ID_MAX) continue; // join ไม่ได้ = omit ใบนี้ (ไม่ publish imageUrl)
      cands.push({ candidateId: id, provider: a.provider, queryIndex: a.queryIndex, providerRank: a.providerRank });
    }
    return _buildSearchShadowV2(cands);
  } catch { return null; } // storage/join พัง = omit V2 (V1 คงเดิม)
}

// 🔎 Search V2 Outcome Shadow V1 (diagnostic-only, opt-in MEGA_SEARCH_OUTCOME_SHADOW_V1=1)
//   aggregate counters ต่อ (queryIndex, provider) — ไม่มี URL/query text/PII · bound 32 rows / 16 KiB UTF-8
//   diagnostic reads ทุกจุด = own-data descriptor เท่านั้น (ไม่เรียก getter/proxy trap · ไม่แตะ business path)
//   accessor/exotic/anomaly ที่จุดใดก็ตาม = omit ทั้ง carrier · pure · fail-closed sanitizer + semantic invariants
const _OS_MAX_ROWS = 32;
const _OS_MAX_BYTES = 16 * 1024;
const _OS_KEYSEP = String.fromCharCode(0); // ตัวคั่น tuple (NUL runtime) — source ไม่มี NUL literal · ชน provider/int ไม่ได้
const _OS_COUNTERS = ['raw', 'sourceBlocked', 'inCallDuplicate', 'capSkipped', 'existingDuplicate', 'vetted', 'relevant', 'irrelevant', 'failed', 'freshPersisted', 'rank1_5', 'rank6_10', 'rank11_20'];
function _osOwnVal(obj, key) { // own DATA descriptor เท่านั้น · accessor/exotic/throw = { bad:true } (ไม่เรียก getter)
  try {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return { has: false };
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d) return { has: false };
    if (!('value' in d)) return { bad: true };
    return { has: true, value: d.value };
  } catch { return { bad: true }; }
}
function _osUrlOf(obj, box) { const v = _osOwnVal(obj, 'imageUrl'); if (v.bad) { box.fail = true; return null; } return v.has && typeof v.value === 'string' && v.value ? v.value : null; }
function _osRow(rows, qi, provider) {
  const key = qi + _OS_KEYSEP + provider;
  let r = rows.get(key);
  if (!r) { r = { queryIndex: qi, provider }; for (const c of _OS_COUNTERS) r[c] = 0; rows.set(key, r); }
  return r;
}
// เก็บ "ทุก occurrence" ของ url จัดกลุ่มตาม (queryIndex, provider) เก็บ best/min normalized rank ต่อกลุ่ม (ห้าม overwrite ข้ามคำค้น)
function _osOcc(os, url, qi, provider, rank) {
  let g = os.occ.get(url); if (!g) { g = new Map(); os.occ.set(url, g); }
  const qk = qi + _OS_KEYSEP + provider;
  const ex = g.get(qk);
  if (!ex || rank < ex.providerRank) g.set(qk, { queryIndex: qi, provider, providerRank: rank });
}
// occurrence ที่ยังไม่ผ่าน source-blocker ในสายธุรกิจก่อน _osOcc (dup branch fire ก่อน blocker · cap-tail break ก่อน blocker) → ตรวจ eligibility เองแบบ pure
//   ห้าม record occ (=รับ verdict join) ให้ occurrence ที่ source-blocked โดย metadata ตัวเอง แม้ imageUrl ซ้ำกับใบสะอาด (source/title/link คนละใบ)
//   descriptor-safe อ่าน own DATA เฉพาะ 4 field ที่ blocker อ่าน (imageUrl/source/sourceLink/title) · ยอมรับเฉพาะ string/null/undefined
//   accessor/exotic/ค่าที่ไม่ใช่ string → os.fail (fail-closed omit carrier) · plain string-only object แล้วเรียก blocker บน plain (ไม่แตะ getter/proxy ของผล provider)
function _osBlocked(im, os, B) {
  if (!im || typeof im !== 'object') { os.fail = true; return true; }
  let proto;
  try { proto = Object.getPrototypeOf(im); } catch { os.fail = true; return true; } // Proxy getPrototypeOf trap throw → fail-closed (exception ไม่ escape เข้า business response)
  if (proto !== Object.prototype && proto !== null) { os.fail = true; return true; } // custom/exotic prototype → fail-closed (blocker เห็น inherited field แต่ descriptor-read มองไม่เห็น)
  const plain = {};
  for (const f of ['imageUrl', 'source', 'sourceLink', 'title']) {
    const d = _osOwnVal(im, f);
    if (d.bad) { os.fail = true; return true; } // own accessor/exotic descriptor (descriptor-only, throw=bad)
    if (d.has) { const v = d.value; if (typeof v === 'string') plain[f] = v; else if (v !== null && v !== undefined) { os.fail = true; return true; } }
    else if (proto === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, f); } catch { os.fail = true; return true; } if (pd) { os.fail = true; return true; } } // ไม่มี own → เช็ค Object.prototype pollution ตรงๆ (ไม่แตะ im เลย: ไม่มี in/get/has trap · proto=null = ไม่มี inherited)
  }
  try { return B.isCatalogSource(plain) || B.isOwnPageSource(plain) || B.isMismatchedFbMedia(plain); } catch { os.fail = true; return true; }
}
const _OS_BLK = { isCatalogSource, isOwnPageSource, isMismatchedFbMedia };
// fail-closed อ่าน verdict it.triage.relevant — mirror _osBlocked: plain/null proto ทั้ง it และ triage + Object.prototype pollution → os.fail · descriptor-only (ไม่เรียก getter/has/in)
function _osTriageOf(it, os) {
  if (it === null || it === undefined) return undefined;
  if (typeof it === 'function') { os.fail = true; return undefined; } // function-valued vetted row → fail-closed (ก่อน proto check)
  if (typeof it !== 'object') return undefined; // primitive → no verdict (benign)
  let ip; try { ip = Object.getPrototypeOf(it); } catch { os.fail = true; return undefined; }
  if (ip !== Object.prototype && ip !== null) { os.fail = true; return undefined; }
  const td = _osOwnVal(it, 'triage');
  if (td.bad) { os.fail = true; return undefined; }
  if (!td.has) { if (ip === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, 'triage'); } catch { os.fail = true; return undefined; } if (pd) { os.fail = true; return undefined; } } return undefined; }
  const tri = td.value;
  if (typeof tri === 'function') { os.fail = true; return undefined; } // function triage → fail-closed (ก่อน proto check)
  if (!tri || typeof tri !== 'object') return undefined; // triage present แต่ไม่ใช่ object → no-verdict (failed)
  let tp; try { tp = Object.getPrototypeOf(tri); } catch { os.fail = true; return undefined; }
  if (tp !== Object.prototype && tp !== null) { os.fail = true; return undefined; }
  const rd = _osOwnVal(tri, 'relevant');
  if (rd.bad) { os.fail = true; return undefined; }
  if (!rd.has) { if (tp === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, 'relevant'); } catch { os.fail = true; return undefined; } if (pd) { os.fail = true; return undefined; } } return undefined; }
  return rd.value;
}
// descriptor-safe fresh-suffix (saved.images/added/length/index/imageUrl) → { ok, urls:[string,...] } | null(+box.fail on anomaly)
function _osFreshUrls(saved, box) {
  const imD = _osOwnVal(saved, 'images'); if (imD.bad || !imD.has) { box.fail = true; return null; }
  const all = imD.value; if (!Array.isArray(all) || Object.getPrototypeOf(all) !== Array.prototype) { box.fail = true; return null; }
  const lenD = _osOwnVal(all, 'length'); if (lenD.bad || !lenD.has || !Number.isSafeInteger(lenD.value) || lenD.value < 0) { box.fail = true; return null; }
  const len = lenD.value;
  const adD = _osOwnVal(saved, 'added'); if (adD.bad || !adD.has) { box.fail = true; return null; }
  const addedN = adD.value; if (!Number.isSafeInteger(addedN) || addedN < 0 || addedN > len) { box.fail = true; return null; } // added>len ห้าม clamp เข้า historical
  const urls = [];
  for (let i = len - addedN; i < len; i++) {
    const eD = _osOwnVal(all, i); if (eD.bad || !eD.has) { box.fail = true; return null; } // hole/accessor
    const img = eD.value; if (!img || typeof img !== 'object' || Array.isArray(img)) { box.fail = true; return null; }
    const uD = _osOwnVal(img, 'imageUrl'); if (uD.bad || !uD.has || typeof uD.value !== 'string') { box.fail = true; return null; }
    urls.push(uD.value);
  }
  return { ok: true, urls };
}
export function _sanitizeSearchOutcomeShadowV1(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null;
    const top = new Map();
    for (const k of Reflect.ownKeys(raw)) { const d = Object.getOwnPropertyDescriptor(raw, k); if (!d || !('value' in d)) return null; top.set(k, d.value); }
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    if (top.get('version') !== 1) return null;
    const rowsTruncated = _int(top.get('rowsTruncated'));
    const capped = top.get('capped');
    if (rowsTruncated === null || typeof capped !== 'boolean') return null;
    if (capped !== (rowsTruncated > 0)) return null; // cap metadata ต้องสอดคล้อง
    const rowsRaw = top.get('rows');
    if (!Array.isArray(rowsRaw) || Object.getPrototypeOf(rowsRaw) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(rowsRaw, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    if (lenD.value > _OS_MAX_ROWS) return null; // bounded work: reject ก่อน iterate row ใดๆ
    const out = [];
    let prev = null;
    for (let i = 0; i < lenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(rowsRaw, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const em = new Map();
      for (const k of Reflect.ownKeys(el)) { const dd = Object.getOwnPropertyDescriptor(el, k); if (!dd || !('value' in dd)) return null; em.set(k, dd.value); }
      const queryIndex = _int(em.get('queryIndex'));
      const provider = em.get('provider');
      if (queryIndex === null) return null;
      if (typeof provider !== 'string' || !_V2_PROVIDERS.has(provider)) return null; // allowlisted provider เท่านั้น
      const row = { queryIndex, provider };
      for (const c of _OS_COUNTERS) { const v = _int(em.get(c)); if (v === null) return null; row[c] = v; }
      // semantic invariants ต่อแถว
      if (row.vetted !== row.relevant + row.irrelevant + row.failed) return null;
      if (row.rank1_5 + row.rank6_10 + row.rank11_20 > row.relevant) return null;
      if (row.sourceBlocked + row.inCallDuplicate + row.capSkipped > row.raw) return null;
      if (row.vetted > row.raw) return null; // vetted (distinct URL join ต่อแถว) ≤ occurrences ดิบ
      if (row.freshPersisted + row.existingDuplicate > row.raw) return null; // canonical persistence ต่อแถว ≤ raw
      // tuple (queryIndex, provider) ต้อง unique + canonical-sorted (strictly ascending)
      const cmp = prev === null ? 1 : ((row.queryIndex - prev.queryIndex) || (row.provider < prev.provider ? -1 : row.provider > prev.provider ? 1 : 0));
      if (cmp <= 0) return null;
      prev = row;
      out.push(row); // canonical key order
    }
    const carrier = { version: 1, rows: out, rowsTruncated, capped };
    if (_v2bytes(JSON.stringify(carrier)) > _OS_MAX_BYTES) return null; // UTF-8 bytes ≤ 16 KiB
    return carrier;
  } catch { return null; }
}
export function _buildSearchOutcomeShadowV1(rowsIn) {
  try {
    // descriptor-only normalize input ก่อน filter/sort/map (exported → hostile-safe: getter invocation 0, malformed → null)
    if (!Array.isArray(rowsIn) || Object.getPrototypeOf(rowsIn) !== Array.prototype) return null;
    const inLenD = Object.getOwnPropertyDescriptor(rowsIn, 'length');
    if (!inLenD || !('value' in inLenD) || !Number.isSafeInteger(inLenD.value) || inLenD.value < 0) return null;
    if (inLenD.value > 4096) return null; // bounded work ก่อน iterate (DoS guard — producer จริง ≪ นี้)
    const norm = [];
    for (let i = 0; i < inLenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(rowsIn, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor element
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const qd = Object.getOwnPropertyDescriptor(el, 'queryIndex'); if (!qd || !('value' in qd) || !Number.isSafeInteger(qd.value) || qd.value < 0) return null; // scalar-validate ก่อน sort (กัน valueOf/coerce)
      const pd = Object.getOwnPropertyDescriptor(el, 'provider'); if (!pd || !('value' in pd) || typeof pd.value !== 'string' || !_V2_PROVIDERS.has(pd.value)) return null; // provider ต้อง string + allowlisted (non-allowlisted = reject ที่ extraction ไม่ filter เงียบ · กัน '<' coercion)
      const row = { queryIndex: qd.value, provider: pd.value };
      for (const c of _OS_COUNTERS) { const cd = Object.getOwnPropertyDescriptor(el, c); if (cd && (!('value' in cd) || !Number.isSafeInteger(cd.value) || cd.value < 0)) return null; row[c] = cd ? cd.value : 0; }
      norm.push(row);
    }
    const list = norm; // provider ผ่าน allowlist ตั้งแต่ descriptor extraction แล้ว (reject ทั้ง carrier ถ้าไม่ allowlisted — ไม่ filter เงียบ)
    list.sort((a, b) => (a.queryIndex - b.queryIndex) || (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0)); // deterministic canonical
    const total = list.length;
    let rows = list.slice(0, _OS_MAX_ROWS); // cap 32 (tail-trim)
    const mk = (arr) => ({ version: 1, rows: arr.map((r) => { const o = { queryIndex: r.queryIndex, provider: r.provider }; for (const c of _OS_COUNTERS) o[c] = r[c] || 0; return o; }), rowsTruncated: total - arr.length, capped: total - arr.length > 0 });
    while (rows.length > 0 && _v2bytes(JSON.stringify(mk(rows))) > _OS_MAX_BYTES) rows = rows.slice(0, rows.length - 1); // 16 KiB UTF-8 tail-trim
    return _sanitizeSearchOutcomeShadowV1(mk(rows));
  } catch { return null; }
}

export async function POST(req) {
  // 🔎 Search Provenance V1 — snapshot สวิตช์ + ตัวนับ + _prov "นอก try" ให้ outer catch (UNEXPECTED หลัง attempt) แนบ sidecar ได้
  const provenanceOn = process.env.MEGA_SEARCH_PROVENANCE === '1';
  let provQueriesFired = 0; // ยิงคำค้นจริง (รวมที่ล้ม)
  let provUrlsReturned = 0; // รูปดิบ provider คืน ก่อนกรอง/ตัดซ้ำ/เพดาน
  let provUrlsVetted = 0;   // candidates ที่ส่งเข้า vet จริง
  let provVetKept = null;   // vet classifier: kept (null = vet ไม่รัน/ล้มทั้งชุด — ไม่มี decision)
  let provVetDropped = 0;   // vet classifier: dropped (relevant===false) — แยกจาก legacy vetDropped เด็ดขาด
  let provVetFailed = 0;    // vet classifier: failed (โหลด/ติดป้ายไม่ได้) หรือทั้งชุด throw = N
  const _prov = () => _searchProvenance({ queriesFired: provQueriesFired, urlsReturned: provUrlsReturned, urlsVetted: provUrlsVetted, vetKept: provVetKept, vetDropped: provVetDropped, vetFailed: provVetFailed });
  // 🔎 Search V2 shadow — snapshot สวิตช์ครั้งเดียวก่อน await (อิสระจาก V1) + แผนที่ attribution (imageUrl→provider/queryIndex/providerRank)
  const shadowV2On = process.env.MEGA_SEARCH_SHADOW_V2 === '1';
  const _v2attr = shadowV2On ? new Map() : null;
  // 🔎 Outcome Shadow V1 — snapshot สวิตช์ครั้งเดียวก่อน await (อิสระ) · OFF = _os null (ไม่มี read เพิ่ม)
  //   collector: first (canonical collected occ → existingDuplicate/freshPersisted) · occ (ทุก occurrence จัดกลุ่ม (queryIndex,provider) เก็บ best/min rank → URL-verdict join ทุกกลุ่ม)
  const outcomeOn = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 === '1';
  const _os = outcomeOn ? { rows: new Map(), first: new Map(), occ: new Map(), fail: false } : null;
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    const platform = (body.platform || 'google').trim();

    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'แพลตฟอร์มไม่รองรับ: ' + platform, errorType: 'BAD_PLATFORM' },
        { status: 400 }
      );
    }

    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    let keywords = c.keywords;
    // ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง): ติ๊กเลือกคีย์เวิร์ดได้ — UI ส่งรายการที่ "ไม่ติ๊ก" มา
    //   กรองออกจากทุกหมวดก่อนเข้า buildQueries (โควตา/round-robin/การันตีหลักฐานยังทำงานเหมือนเดิม)
    if (keywords && Array.isArray(body.excludeQueries) && body.excludeQueries.length) {
      const ex = new Set(body.excludeQueries.map((s) => String(s).trim()));
      const keep = (arr) => (arr || []).filter((q) => !ex.has(String(q).trim()));
      keywords = {
        ...keywords,
        queries_th: keep(keywords.queries_th),
        queries_en: keep(keywords.queries_en),
        object_queries: keep(keywords.object_queries),
        moment_action: keep(keywords.moment_action),
        scene_place: keep(keywords.scene_place),
        // ★ 9 ก.ค. เฟส 4a: หมวดเรื่องราว/emotion/source_show ก็ต้องกรองตามที่ผู้ใช้ติ๊กออกด้วย (คงพฤติกรรม tick-to-exclude ให้ครบ)
        emotion: keep(keywords.emotion),
        source_show: keep(keywords.source_show),
        relationship_archive: keep(keywords.relationship_archive),
        lifestyle_travel: keep(keywords.lifestyle_travel),
        family_album: keep(keywords.family_album),
        landmark_context: keep(keywords.landmark_context),
      };
    }
    if (!keywords || typeof keywords !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: 'ต้องสกัดคีย์เวิร์ดก่อนจึงจะค้นภาพได้',
          errorType: 'NO_KEYWORDS',
        },
        { status: 400 }
      );
    }

    // จำนวนคำค้น: ให้ทุกบุคคลได้อย่างน้อย PER_SUBJECT คำ (สมดุลต่อคน)
    const nSubjects = (keywords.subjects || []).length || 1;
    // ★ 9 ก.ค. เฟส 4a: เปิดหมวดเรื่องราว → โควตา ≥ QUERIES_PER_SOURCE (default 12); ปิด → เพดานเดิม (CAP 8)
    const maxQ = STORY_QUERIES_ON
      ? Math.max(QUERIES_PER_SOURCE, nSubjects * PER_SUBJECT)
      : Math.min(MAX_QUERIES_CAP, Math.max(MAX_QUERIES, nSubjects * PER_SUBJECT));
    // ★ G1 gap hunt: ถ้าผู้เรียกส่ง body.keywords (array of string) มา → ใช้เป็นคำค้นตรงๆ (ข้าม buildQueries)
    //   ให้ค้นเติมช่องว่างแบบเจาะจงบุคคลได้ (rt_gaphunt) · trim/dedupe/cap ด้วย maxQ · ไม่ส่ง = พฤติกรรมเดิม byte-identical
    let queries;
    if (Array.isArray(body.keywords) && body.keywords.length) {
      const seenQ = new Set();
      queries = body.keywords
        .map((s) => String(s || '').trim())
        .filter((q) => { if (!q || seenQ.has(q)) return false; seenQ.add(q); return true; })
        .slice(0, maxQ);
    } else {
      queries = buildQueries(keywords, maxQ);
    }
    // ★ G3 วินัยโควตา: เพดานคำค้นต่อรอบ (MEGA_SEARCH_QUERY_CAP int) — ตัดตามลำดับความสำคัญเดิม (buildQueries เรียงให้แล้ว)
    //   ไม่ตั้ง/ตั้งไม่ถูก (NaN/≤0) = ไม่ตัด = พฤติกรรมเดิมเป๊ะ · ตั้งแล้ว = slice หัวรายการ
    const _queryCap = parseInt(process.env.MEGA_SEARCH_QUERY_CAP || '', 10);
    if (Number.isInteger(_queryCap) && _queryCap > 0 && queries.length > _queryCap) {
      queries = queries.slice(0, _queryCap);
    }
    if (queries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีคำค้นในคีย์เวิร์ด', errorType: 'NO_QUERIES' },
        { status: 400 }
      );
    }

    // เพดานรวม = ให้ทุกคำค้น (ทุกคน) ได้รันครบ ไม่ตัดคำค้นท้ายทิ้ง (กันเสียสมดุล)
    const cap = Math.min(HARD_CAP, queries.length * PER_QUERY);

    const collected = [];
    const seen = new Set();
    const errors = [];
    let blockedCatalog = 0; // 🚫 บ้านแคตตาล็อก/อสังหา/โฆษณา ที่บล็อกตั้งแต่ต้นทาง
    let blockedOwnPage = 0; // 🚫 ★ 8 ก.ค.: ภาพจากเพจของเราเอง (คอลลาจวนกลับ = กับดักผิดคน)
    let blockedMismatch = 0; // 🚫 ★ 8 ก.ค. ดึก: ภาพ FB ที่ Google จับคู่ผิดโพสต์ (media_id ≠ เลขภาพในลิงก์)

    // ★ แก้ 1: ยิงเป็น "ชุด" ชุดละ QUERY_CONC คำพร้อมกัน แล้วเก็บผล "เรียงตามลำดับคำค้นเดิม"
    //   (ลำดับ collected/ตัดซ้ำ/เพดาน เหมือนยิงทีละคำทุกประการ — QUERY_CONC=1 คือชุดละ 1 = โค้ดเดิม)
    for (let w = 0; w < queries.length && collected.length < cap; w += QUERY_CONC) {
      const wave = queries.slice(w, w + QUERY_CONC);
      provQueriesFired += wave.length; // 🔎 ยิงจริงทั้ง wave (Promise.all ยิงทุกคำ รวมที่ throw)
      const settled = await Promise.all(
        wave.map(async (q) => {
          try {
            return { imgs: await searchImages(platform, q, { num: PER_QUERY, caseId }) };
          } catch (err) {
            return { err };
          }
        })
      );
      for (let k = 0; k < wave.length; k++) {
        const q = wave[k];
        const { imgs, err } = settled[k];
        if (err) {
          // คีย์หาย = หยุดทันที (ทุกคำค้นจะล้มเหมือนกัน)
          if (err.errorType === 'NO_SERPAPI_KEY') {
            return NextResponse.json(
              { success: false, error: err.message, errorType: 'NO_SERPAPI_KEY', ...(provenanceOn ? { provenance: _prov() } : {}) },
              { status: 400 }
            );
          }
          errors.push({ query: q, error: err.message });
          continue;
        }
        provUrlsReturned += imgs.length; // 🔎 ดิบก่อนกรอง/ตัดซ้ำ/เพดาน (เฉพาะคำค้นที่คืนสำเร็จ)
        if (_os && !_os.fail) _osRow(_os.rows, w + k, platform).raw += imgs.length; // 🔎 OS: raw = searchImages-returned occurrence count ต่อ (queryIndex, provider)
        let _v2rank = 0; // 🔎 V2: rank ดิบ 1-based ตามลำดับ provider response ก่อน filter/dedup (ห้าม renumber)
        for (const im of imgs) {
          _v2rank++;
          let _osUrl = null;
          if (_os && !_os.fail) _osUrl = _osUrlOf(im, _os); // 🔎 OS: descriptor-safe url (occ บันทึกเฉพาะ occurrence ที่ eligible ด้านล่าง — ไม่รวม source-blocked)
          if (collected.length >= cap) { if (_os && !_os.fail) { _osRow(_os.rows, w + k, platform).capSkipped += (imgs.length - _v2rank + 1); for (let _j = _v2rank - 1; _j < imgs.length; _j++) { const _u = _osUrlOf(imgs[_j], _os); if (_os.fail) break; if (_u && !_osBlocked(imgs[_j], _os, _OS_BLK)) _osOcc(_os, _u, w + k, platform, _j + 1); if (_os.fail) break; } } break; } // 🔎 OS: cap-skipped occ เฉพาะที่ "ไม่ source-blocked" (query-quality evidence) — eligible ได้ verdict join แต่ persistence ต้อง canonical first เท่านั้น · capSkipped counter ยังนับ tail ทั้งหมดตามเดิม
          if (!im.imageUrl || seen.has(im.imageUrl)) { if (_os && !_os.fail && _osUrl) { _osRow(_os.rows, w + k, platform).inCallDuplicate++; if (!_osBlocked(im, _os, _OS_BLK)) _osOcc(_os, _osUrl, w + k, platform, _v2rank); } continue; } // 🔎 OS: dup counter ตาม business · occ เฉพาะ occurrence ที่ไม่ source-blocked (imageUrl ซ้ำแต่ source/title/link เป็น junk = ห้ามรับ verdict)
          // 🚫 ต้นทาง: กันบ้าน/โครงการจากเว็บอสังหา/รับสร้างบ้าน/วัสดุก่อสร้าง ไม่ให้เข้าคลัง
          //    (พวกนี้ไม่ใช่บ้านของคนในข่าว — แค่คีย์เวิร์ดตรง)
          if (isCatalogSource(im)) { blockedCatalog++; if (_os && !_os.fail) _osRow(_os.rows, w + k, platform).sourceBlocked++; continue; }
          // 🚫 ★ 8 ก.ค.: กันภาพจากเพจเราเอง (บทเรียน AC-0043-61: คอลลาจ IG.dara → เดาผิดคน)
          if (isOwnPageSource(im)) { blockedOwnPage++; if (_os && !_os.fail) _osRow(_os.rows, w + k, platform).sourceBlocked++; continue; }
          // 🚫 ★ 8 ก.ค. ดึก: กันภาพ FB ที่ Google จับคู่ผิดโพสต์ (ภาพไม่เคยอยู่ในโพสต์ที่ลิงก์อ้าง)
          if (isMismatchedFbMedia(im)) { blockedMismatch++; if (_os && !_os.fail) _osRow(_os.rows, w + k, platform).sourceBlocked++; continue; }
          seen.add(im.imageUrl);
          // ★ 1.5: ติดธง lowRes จากขนาด SerpApi (มีค่าจริงเท่านั้น — ไม่รู้ขนาด = ไม่ตีตรา)
          const sw = Number(im.width) || 0, sh = Number(im.height) || 0;
          const lowRes = sw > 0 && sh > 0 ? Math.min(sw, sh) < LOWRES_MIN_SHORT : undefined;
          collected.push({ ...im, platform, query: q, ...(lowRes !== undefined ? { lowRes } : {}) });
          // 🔎 V2: บันทึก attribution ตอน URL เข้า collected ครั้งแรก (dup ถูก seen กันก่อน push → first attribution คงเดิม)
          if (_v2attr) _v2attr.set(im.imageUrl, { queryIndex: w + k, provider: platform, providerRank: _v2rank });
          if (_os && !_os.fail && _osUrl) { _os.first.set(_osUrl, { queryIndex: w + k, provider: platform, providerRank: _v2rank }); _osOcc(_os, _osUrl, w + k, platform, _v2rank); } // 🔎 OS: canonical first/collected occ (→ freshPersisted/existingDuplicate) + record occ
        }
      }
    }

    if (collected.length === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'ค้นภาพไม่สำเร็จทุกคำค้น',
          errorType: 'SEARCH_FAILED',
          errors,
          ...(provenanceOn ? { provenance: _prov() } : {}),
        },
        { status: 502 }
      );
    }

    // ★ 8 ก.ค. แก้ 2 (เร่งค้นภาพ): ตัดรูปที่คลังเคสมีอยู่แล้วออก "ก่อน" ส่งตา Gemini
    //   เดิม: รูปซ้ำข้ามแหล่ง (Google/News/Yandex มักคืนใบเดียวกัน) ถูกส่งไปให้ตาตรวจเต็มราคา
    //   แล้วค่อยโดน addImages ตัดทิ้งเงียบๆ ตอนเก็บ = จ่ายเวลา+ค่า Gemini ฟรี
    //   ผลลัพธ์ในคลังเท่าเดิม 100% (รูปซ้ำไม่เคยถูกเก็บอยู่แล้ว) · kill-switch: PRE_VET_DEDUP=0
    let candidates = collected;
    let skippedDup = 0;
    if (process.env.PRE_VET_DEDUP !== '0' && collected.length) {
      try {
        const have = new Set((await readImages(caseId)).map((i) => i.imageUrl));
        candidates = collected.filter((im) => !have.has(im.imageUrl));
        skippedDup = collected.length - candidates.length;
        if (_os && !_os.fail) { try { for (const [url, a] of _os.first) if (have.has(url)) _osRow(_os.rows, a.queryIndex, a.provider).existingDuplicate++; } catch { _os.fail = true; } } // 🔎 OS: existingDuplicate (first/collected occ ที่อยู่ในคลังแล้ว)
      } catch {
        candidates = collected; // อ่านคลังไม่ได้ → ทำแบบเดิม (vet ทั้งหมด) ห้ามล้ม
      }
    }

    // 👁️ ตากรองตอนค้น: ให้ตาดูรูปที่ค้นได้ "ก่อนเก็บ" → เก็บเฉพาะที่เกี่ยวข้องจริง + ติดป้าย triage ในตัว
    //   (ปิดได้ด้วย body.vet=false หรือ env SEARCH_VET=0 ; ตาล้ม/ไม่มีคีย์ → เก็บทั้งหมด กันค้นแล้วได้ศูนย์)
    const VET = process.env.SEARCH_VET !== '0' && body.vet !== false;
    let toStore = candidates;
    let vetDropped = 0;
    let vetOn = false;
    if (VET && candidates.length) {
      provUrlsVetted = candidates.length; // 🔎 candidates ที่ "ส่งเข้า vet" จริง
      const chars = c.analysis?.characters || [];
      const genderOf = (name) => {
        const n = (name || '').trim();
        const hit = chars.find((ch) => ch.name === n || (ch.name && (n.includes(ch.name) || ch.name.includes(n))));
        return hit?.gender || '';
      };
      const subjects = (c.keywords?.subjects || []).map((s) => ({ ...s, gender: s.gender || genderOf(s.name) }));
      // ★ N1 (18 ก.ค.): ให้ "ตา" (vet) เห็นบริบทข่าว "เต็ม" ขึ้น — เดิมเห็นแค่ 600 ตัวจาก analysis.summary (บทสรุปสั้น)
      //   → ตัดสิน relevant/story-fit จากสรุปย่อ ไม่เห็นรายละเอียดจริงในข่าว = ภาพเชิงบริบทถูกตีว่าไม่เกี่ยว/สื่อเรื่องไม่ตรง
      //   แก้: ใช้เนื้อข่าว "เต็ม" (c.newsText) เป็นหลัก + เพดานยาวขึ้น (default 1800 ตัว ≈ +400 tokens/แบตช์ ส่งครั้งเดียวต่อ ~10 ใบ)
      //   kill-switch: VET_GIST_FULL=0 = คืนพฤติกรรมเดิม (summary-first, 600) · VET_GIST_CHARS = ปรับเพดานเอง
      const VET_GIST_FULL = process.env.VET_GIST_FULL !== '0';
      const gistChars = Math.max(200, parseInt(process.env.VET_GIST_CHARS || (VET_GIST_FULL ? '1800' : '600'), 10));
      const gistSrc = VET_GIST_FULL
        ? (c.newsText || c.analysis?.content || c.analysis?.summary || c.newsSnippet || '')
        : (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '');
      const newsGist = String(gistSrc).slice(0, gistChars);
      try {
        const { vetted, kept, dropped, failed } = await vetImages({ images: candidates, subjects, newsGist, caseId });
        // ★ DEVIATION โหมดตาเข้ม (ผู้ใช้สั่ง 6 ก.ค.): เก็บเฉพาะใบที่ตา "ยืนยันว่าเกี่ยว" เท่านั้น
        //   (ต้นฉบับเก็บใบที่ตาดูไม่ทัน/ไม่ติดป้ายด้วย → ขยะเล็ดได้) — ถ้าตาล้มทั้งชุดจนไม่มีป้ายเลย
        //   ค่อย fail-open เก็บแบบต้นฉบับ กัน "ค้นแล้วได้ศูนย์" ตอน Gemini ล่ม · ปิดกลับ: SEARCH_VET_STRICT=0
        const strict = process.env.SEARCH_VET_STRICT !== '0';
        const anyTag = vetted.some((x) => x.triage);
        toStore = strict && anyTag
          ? vetted.filter((x) => x.triage?.relevant === true)
          : vetted.filter((x) => x.triage?.relevant !== false);
        vetDropped = candidates.length - toStore.length; // legacy — คงความหมาย/ค่าเดิมเป๊ะ (compat, ห้ามเปลี่ยน)
        vetOn = true;
        // 🔎 provenance ใช้ตัวนับ "classifier จริง" จาก vetImages (kept/dropped/failed) — ไม่ใช่ legacy subtraction
        provVetKept = kept; provVetDropped = dropped; provVetFailed = failed;
        if (_os && !_os.fail) { try { for (const it of vetted) { const u = _osUrlOf(it, _os); if (_os.fail) break; if (!u) continue; const g = _os.occ.get(u); if (!g) continue; const rel = _osTriageOf(it, _os); if (_os.fail) break; for (const a of g.values()) { const r = _osRow(_os.rows, a.queryIndex, a.provider); r.vetted++; if (rel === true) { r.relevant++; const rk = a.providerRank; if (rk >= 1 && rk <= 5) r.rank1_5++; else if (rk <= 10) r.rank6_10++; else if (rk <= 20) r.rank11_20++; } else if (rel === false) r.irrelevant++; else r.failed++; } } } catch { _os.fail = true; } } // 🔎 OS: URL-verdict join — propagate ไปทุก (queryIndex,provider) occurrence (best/min rank ต่อกลุ่ม) · อาจซ้อน inCallDuplicate/capSkipped
      } catch {
        toStore = candidates; // ตาล้ม/ไม่มีคีย์ → เก็บทั้งหมดไปก่อน (fail-open legacy เดิม)
        provVetFailed = candidates.length; // 🔎 ทั้งชุด throw = execution failure ทั้ง N (vetKept=null, provVetDropped=0)
        if (_os && !_os.fail) { try { for (const im of candidates) { const u = _osUrlOf(im, _os); if (_os.fail) break; if (!u) continue; const g = _os.occ.get(u); if (!g) continue; for (const a of g.values()) { const r = _osRow(_os.rows, a.queryIndex, a.provider); r.vetted++; r.failed++; } } } catch { _os.fail = true; } } // 🔎 OS: vet throw = failed (join ทุก occurrence)
      }
    }

    const saved = await addImages(caseId, toStore);

    // 🔎 Search V2 shadow — join id ที่เพิ่ง persist (N ใบท้ายของ saved.images) → provider/queryIndex/providerRank (ON เท่านั้น · pure)
    const searchShadowV2 = shadowV2On ? _buildSearchShadowV2FromSaved(saved, _v2attr) : null;

    // 🔎 Outcome Shadow V1 — descriptor-safe fresh-suffix → freshPersisted (via canonical first) + late add-time dedup → existingDuplicate (via canonical first)
    //   freshPersisted = "addImages-returned fresh-suffix acceptance" (ไม่ใช่หลักฐาน durable insert ปลายทาง)
    if (_os && !_os.fail) { try {
      const _toUrls = [];
      for (const it of toStore) { const u = _osUrlOf(it, _os); if (_os.fail) break; if (u) _toUrls.push(u); }
      const _fr = _os.fail ? null : _osFreshUrls(saved, _os);
      if (!_os.fail && _fr) {
        const _freshSet = new Set(_fr.urls);
        for (const url of _fr.urls) { const a = _os.first.get(url); if (a) _osRow(_os.rows, a.queryIndex, a.provider).freshPersisted++; else { _os.fail = true; break; } } // 🔎 OS: freshPersisted = canonical first/collected occ เท่านั้น (ไม่ใช้ all-occurrence map)
        if (!_os.fail) for (const url of _toUrls) if (!_freshSet.has(url)) { const a = _os.first.get(url); if (a) _osRow(_os.rows, a.queryIndex, a.provider).existingDuplicate++; else { _os.fail = true; break; } }
      }
    } catch { _os.fail = true; } }
    const searchOutcomeShadowV1 = (_os && !_os.fail) ? _buildSearchOutcomeShadowV1([..._os.rows.values()]) : null;

    return NextResponse.json({
      success: true,
      caseId,
      platform,
      found: collected.length,
      added: saved.added,
      total: saved.total,
      blockedCatalog, // 🚫 กันบ้านแคตตาล็อก/อสังหาออกกี่ใบ (โปร่งใส)
      blockedOwnPage, // 🚫 ★ 8 ก.ค.: กันภาพจากเพจเราเองออกกี่ใบ
      blockedMismatch, // 🚫 ★ 8 ก.ค. ดึก: กันภาพ FB จับคู่ผิดโพสต์ออกกี่ใบ
      skippedDup, // ⚡ ตัดรูปที่คลังมีแล้วก่อนส่งตา (ไม่เสียเวลา/ค่า Gemini ซ้ำ)
      vetOn, // 👁️ ตากรองตอนค้นทำงานไหม
      vetDropped, // 👁️ ตากรองรูป "ไม่เกี่ยว" ออกกี่ใบ
      byPlatform: saved.byPlatform,
      images: saved.images,
      queriesUsed: queries,
      errors,
      // 🔎 Search Provenance V1 — ON เท่านั้น (OFF = ไม่มี key นี้เลย → response เดิม byte-for-byte)
      //   provenance.vetDropped = classifier dropped (ไม่ใช่ legacy vetDropped ด้านบน) · vetKept/vetFailed = classifier จริง
      ...(provenanceOn ? { provenance: _prov() } : {}),
      // 🔎 Search V2 shadow — ON+valid เท่านั้น (OFF/omit = ไม่มี key นี้) · วางหลัง provenance
      ...(searchShadowV2 ? { searchShadowV2 } : {}),
      // 🔎 Outcome Shadow V1 — top-level ON+valid เท่านั้น · วางหลัง V2
      ...(searchOutcomeShadowV1 ? { searchOutcomeShadowV1 } : {}),
    });
  } catch (err) {
    // UNEXPECTED หลัง attempt วัดได้ (เช่น addImages throw หลัง search/vet) → แนบ sidecar (ON) · OFF = legacy shape/order เป๊ะ
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED', ...(provenanceOn ? { provenance: _prov() } : {}) },
      { status: 500 }
    );
  }
}
