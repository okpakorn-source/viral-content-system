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
    const queries = buildQueries(keywords, maxQ);
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
        let _v2rank = 0; // 🔎 V2: rank ดิบ 1-based ตามลำดับ provider response ก่อน filter/dedup (ห้าม renumber)
        for (const im of imgs) {
          _v2rank++;
          if (collected.length >= cap) break;
          if (!im.imageUrl || seen.has(im.imageUrl)) continue;
          // 🚫 ต้นทาง: กันบ้าน/โครงการจากเว็บอสังหา/รับสร้างบ้าน/วัสดุก่อสร้าง ไม่ให้เข้าคลัง
          //    (พวกนี้ไม่ใช่บ้านของคนในข่าว — แค่คีย์เวิร์ดตรง)
          if (isCatalogSource(im)) { blockedCatalog++; continue; }
          // 🚫 ★ 8 ก.ค.: กันภาพจากเพจเราเอง (บทเรียน AC-0043-61: คอลลาจ IG.dara → เดาผิดคน)
          if (isOwnPageSource(im)) { blockedOwnPage++; continue; }
          // 🚫 ★ 8 ก.ค. ดึก: กันภาพ FB ที่ Google จับคู่ผิดโพสต์ (ภาพไม่เคยอยู่ในโพสต์ที่ลิงก์อ้าง)
          if (isMismatchedFbMedia(im)) { blockedMismatch++; continue; }
          seen.add(im.imageUrl);
          // ★ 1.5: ติดธง lowRes จากขนาด SerpApi (มีค่าจริงเท่านั้น — ไม่รู้ขนาด = ไม่ตีตรา)
          const sw = Number(im.width) || 0, sh = Number(im.height) || 0;
          const lowRes = sw > 0 && sh > 0 ? Math.min(sw, sh) < LOWRES_MIN_SHORT : undefined;
          collected.push({ ...im, platform, query: q, ...(lowRes !== undefined ? { lowRes } : {}) });
          // 🔎 V2: บันทึก attribution ตอน URL เข้า collected ครั้งแรก (dup ถูก seen กันก่อน push → first attribution คงเดิม)
          if (_v2attr) _v2attr.set(im.imageUrl, { queryIndex: w + k, provider: platform, providerRank: _v2rank });
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
      const newsGist = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);
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
      } catch {
        toStore = candidates; // ตาล้ม/ไม่มีคีย์ → เก็บทั้งหมดไปก่อน (fail-open legacy เดิม)
        provVetFailed = candidates.length; // 🔎 ทั้งชุด throw = execution failure ทั้ง N (vetKept=null, provVetDropped=0)
      }
    }

    const saved = await addImages(caseId, toStore);

    // 🔎 Search V2 shadow — join id ที่เพิ่ง persist (N ใบท้ายของ saved.images) → provider/queryIndex/providerRank (ON เท่านั้น · pure)
    const searchShadowV2 = shadowV2On ? _buildSearchShadowV2FromSaved(saved, _v2attr) : null;

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
    });
  } catch (err) {
    // UNEXPECTED หลัง attempt วัดได้ (เช่น addImages throw หลัง search/vet) → แนบ sidecar (ON) · OFF = legacy shape/order เป๊ะ
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED', ...(provenanceOn ? { provenance: _prov() } : {}) },
      { status: 500 }
    );
  }
}
