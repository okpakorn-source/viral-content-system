// ============================================================
// 🔎 /api/image-search — ค้นภาพหลายแหล่งพร้อมกัน + คลังเคสให้เลือกภาพ
// ------------------------------------------------------------
// ★ 4 ก.ค. 2026 พอร์ตส่วนรีเสิร์ชภาพจากโปรเจกต์ระบบทำปกออโต้ (ผู้ใช้สั่ง)
// GET  ?list=1              → รายชื่อเคสล่าสุด (id/title/จำนวนรูป)
// GET  ?caseId=IS-xxx       → เคสเต็ม (รูปทั้งหมด)
// POST { action, ... }:
//   search  { caseId?, title?, queries[], platforms[] } → ค้นทุกแหล่งขนาน → เก็บเข้าเคส
//   reverse { caseId, imageUrl }                        → Google Lens ย้อนกลับ
//   profile { caseId, username, network }               → instagram|facebook โปรไฟล์
//   remove  { caseId, ids[] } | keep { caseId, ids[] }  → ลบ / เก็บเฉพาะที่เลือก
//   clear   { caseId, platform? }                       → ล้างทั้งเคส/เฉพาะแหล่ง
// เก็บผ่าน persistStore 'image-search-cases' (Supabase หลัก + JSON fallback)
// 🔴 แยกเดี่ยวจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import {
  searchImagesMulti, reverseImageMulti, instagramProfileImages, facebookProfileImages, PLATFORMS,
} from '@/lib/services/imageSearchMulti';
// ★ 5 ก.ค.: สมองครบชุดพอร์ตจากระบบทำปกออโต้ (วิเคราะห์ข่าว→สกัดคีย์เวิร์ด→คำค้นผูกชื่อ + คัดขยะ/แยกอารมณ์)
import {
  callBrain, safeParseJson, buildQueries, isCatalogSource,
  buildAnalysisSystemPrompt, buildAnalysisUserPrompt,
  buildKeywordSystemPrompt, buildKeywordUserPrompt,
} from '@/lib/services/imageSearchBrain';
import { geminiJunkScan, geminiEmotionScan, loadImageBuffer } from '@/lib/services/imageSearchVision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STORE = 'image-search-cases';
const PER_QUERY = 40;      // รูปต่อคำค้นต่อแหล่ง
const GALLERY_CAP = 1500;  // เพดานรูปต่อเคส

const summarize = (c) => ({
  id: c.id, title: c.title, createdAt: c.createdAt,
  total: (c.images || []).length,
  byPlatform: countBy(c.images || []),
});

function countBy(images) {
  const m = {};
  for (const im of images) { const p = im.platform || 'อื่นๆ'; m[p] = (m[p] || 0) + 1; }
  return m;
}

// รวมภาพใหม่เข้าเคส (dedupe ตาม imageUrl) — คืนจำนวนที่เพิ่มจริง
function mergeImages(c, incoming, platform, query) {
  const seen = new Set((c.images || []).map((i) => i.imageUrl));
  let added = 0;
  c.images = c.images || [];
  for (const im of incoming) {
    if (c.images.length >= GALLERY_CAP) break;
    if (!im.imageUrl || seen.has(im.imageUrl)) continue;
    seen.add(im.imageUrl);
    c.images.push({ id: `im_${c.images.length + 1}_${Math.random().toString(36).slice(2, 6)}`, addedAt: new Date().toISOString(), platform, query: (query || '').slice(0, 80), ...im });
    added++;
  }
  return added;
}

async function loadCase(store, caseId) {
  const all = await store.getAll();
  return all.find((c) => c.id === caseId) || null;
}

// ★ 5 ก.ค. (แบบต้นฉบับ AC-0001...): เลขเคสรันต่อเนื่องอ่านง่าย IS-0001, IS-0002, ...
//   นับจากเลขสูงสุดที่มี (ทนต่อการลบเคส) · ล้มเหลว → ถอย timestamp (ไม่บล็อกงาน)
async function nextCaseId(store) {
  try {
    const all = await store.getAll();
    const nums = all.map((c) => parseInt(String(c.id).match(/^IS-(\d+)$/)?.[1] || '0', 10));
    return 'IS-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');
  } catch { return `IS-${Date.now().toString(36)}`; }
}

export async function GET(req) {
  try {
    const store = createStore(STORE);
    const caseId = req.nextUrl.searchParams.get('caseId');
    const all = await store.getAll();
    if (caseId) {
      const c = all.find((x) => x.id === caseId);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ success: true, case: c });
    }
    const list = all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30).map(summarize);
    return NextResponse.json({ success: true, cases: list });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'IMAGE_SEARCH_GET_ERROR' }, { status: 500 });
  }
}

// ค้นหลายแพลตฟอร์มขนานกันด้วยชุดคำค้น → รวมเข้าเคส (ใช้ทั้ง search แมนนวลและ searchAuto)
async function runMultiSearch(c, queries, platforms) {
  const errors = [];
  const perPlatform = {};
  let blockedCatalog = 0;
  await Promise.all(platforms.map(async (p) => {
    let addedP = 0;
    for (const q of queries) {
      try {
        const imgs = await searchImagesMulti(p, q, { num: PER_QUERY });
        // 🚫 บล็อกแหล่งแคตตาล็อก/อสังหา/โฆษณาตั้งแต่ต้นทาง (ภาพวัตถุมั่ว ไม่ใช่ของคนในข่าว)
        const ok = imgs.filter((im) => { const bad = isCatalogSource(im); if (bad) blockedCatalog++; return !bad; });
        addedP += mergeImages(c, ok, p, q);
      } catch (err) {
        if (err.errorType === 'NO_SERPAPI_KEY') throw err;
        errors.push({ platform: p, query: q, error: String(err.message).slice(0, 120) });
      }
    }
    perPlatform[p] = addedP;
  }));
  return { errors, perPlatform, blockedCatalog };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'search';
    const store = createStore(STORE);

    // ── 🧠 วิเคราะห์เนื้อข่าวเต็ม + สกัดคีย์เวิร์ด (สมองขั้น 1+2 จากระบบทำปกออโต้) ──
    if (action === 'analyze') {
      const newsText = String(body.newsText || '').trim();
      if (newsText.length < 40) {
        return NextResponse.json({ success: false, error: 'กรุณาใส่เนื้อข่าวเต็ม (อย่างน้อย 40 ตัวอักษร)', errorType: 'NEWS_TOO_SHORT' }, { status: 400 });
      }
      // เรียกสมอง + parse — ล้ม (JSON โดนตัด/มีข้อความปน) → ลองซ้ำ 1 ครั้ง
      // ★ 5 ก.ค.: maxTokens 4000→8000 — ข่าวตัวละครเยอะ (ทายาท/อัยการ/หลายฝ่าย) ผลวิเคราะห์ยาวจน JSON โดนตัด = ล้มเงียบ
      const brainJson = async (system, user) => {
        let r = await callBrain({ system, user, maxTokens: 8000 });
        let j = safeParseJson(r.text);
        if (!j) {
          r = await callBrain({ system, user: user + '\n\n(ย้ำอีกครั้ง: ตอบเป็น JSON ล้วนเท่านั้น ห้ามมีข้อความอื่นใดนอก JSON)', maxTokens: 8000 });
          j = safeParseJson(r.text);
        }
        return { json: j, provider: r.provider };
      };
      // ขั้น 1: วิเคราะห์ข่าวตามกรอบตายตัว (ห้ามเดา/ห้ามเดาเพศ)
      const a = await brainJson(buildAnalysisSystemPrompt(), buildAnalysisUserPrompt(newsText));
      const analysis = a.json;
      if (!analysis || !analysis.headline) {
        return NextResponse.json({ success: false, error: 'สมอง AI วิเคราะห์ไม่สำเร็จ (ตอบไม่เป็น JSON แม้ลองซ้ำ) — ลองกดใหม่อีกครั้ง', errorType: 'BAD_AI_JSON' }, { status: 502 });
      }
      // ขั้น 2: สกัดคีย์เวิร์ดค้นภาพ (ผูกชื่อบุคคลเสมอ ห้ามคำค้นวัตถุลอย)
      const k = await brainJson(buildKeywordSystemPrompt(), buildKeywordUserPrompt(analysis, newsText));
      const keywords = k.json;
      if (!keywords || !Array.isArray(keywords.subjects)) {
        return NextResponse.json({ success: false, error: 'สกัดคีย์เวิร์ดไม่สำเร็จ (ตอบไม่เป็น JSON แม้ลองซ้ำ) — ลองกดใหม่อีกครั้ง', errorType: 'BAD_AI_JSON' }, { status: 502 });
      }
      // เคสใหม่ (หรืออัปเดตเคสเดิมถ้าส่ง caseId มา)
      let c = body.caseId ? await loadCase(store, body.caseId) : null;
      const isNew = !c;
      if (!c) c = { id: await nextCaseId(store), createdAt: new Date().toISOString(), images: [], queries: [], log: [] };
      c.title = String(analysis.headline || '').slice(0, 80) || c.title || 'เคสใหม่';
      c.newsText = newsText;                 // ★ 5 ก.ค.: เก็บเนื้อข่าวเต็มถาวร (แบบต้นฉบับ — ย้อนดูได้ทุกเคส)
      c.newsSnippet = newsText.replace(/\s+/g, ' ').slice(0, 160);
      c.analysis = analysis;
      c.keywords = keywords;
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'analyze', provider: a.provider }].slice(-30);
      if (isNew) await store.add(c); else await store.update(c.id, () => c);
      const preview = buildQueries(keywords, parseInt(process.env.IMAGES_MAX_QUERIES || '3', 10));
      return NextResponse.json({ success: true, caseId: c.id, case: c, queriesPreview: preview });
    }

    // ── 🔍 ค้นด้วย "คีย์เวิร์ดที่สกัดจากข่าว" (buildQueries: สมดุลต่อคน + การันตีหลักฐาน/สถานที่) ──
    if (action === 'searchAuto') {
      const c = await loadCase(store, body.caseId);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส', errorType: 'CASE_NOT_FOUND' }, { status: 404 });
      if (!c.keywords || !Array.isArray(c.keywords.subjects)) {
        return NextResponse.json({ success: false, error: 'เคสนี้ยังไม่ได้วิเคราะห์+สกัดคีย์เวิร์ด — วางเนื้อข่าวแล้วกดวิเคราะห์ก่อน', errorType: 'NO_KEYWORDS' }, { status: 400 });
      }
      const platforms = (body.platforms || []).filter((p) => PLATFORMS.includes(p));
      if (!platforms.length) return NextResponse.json({ success: false, error: 'ต้องเลือกแหล่งอย่างน้อย 1 แหล่ง', errorType: 'NO_PLATFORMS' }, { status: 400 });
      // จำนวนคำค้น: ทุกบุคคลได้อย่างน้อย PER_SUBJECT คำ (เหมือนต้นฉบับ)
      const MAXQ = parseInt(process.env.IMAGES_MAX_QUERIES || '3', 10);
      const PER_SUBJECT = parseInt(process.env.IMAGES_PER_SUBJECT || '2', 10);
      const CAP_Q = parseInt(process.env.IMAGES_MAX_QUERIES_CAP || '8', 10);
      const nSubjects = (c.keywords.subjects || []).length || 1;
      const queries = buildQueries(c.keywords, Math.min(CAP_Q, Math.max(MAXQ, nSubjects * PER_SUBJECT)));
      if (!queries.length) return NextResponse.json({ success: false, error: 'ไม่มีคำค้นในคีย์เวิร์ด', errorType: 'NO_QUERIES' }, { status: 400 });

      const { errors, perPlatform, blockedCatalog } = await runMultiSearch(c, queries, platforms);
      c.queries = [...new Set([...(c.queries || []), ...queries])].slice(0, 60);
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'searchAuto', platforms, queries, added: perPlatform, blockedCatalog }].slice(-30);
      await store.update(c.id, () => c);
      return NextResponse.json({ success: true, caseId: c.id, queriesUsed: queries, addedByPlatform: perPlatform, blockedCatalog, total: c.images.length, byPlatform: countBy(c.images), errors, case: c });
    }

    // ── 🧹 AI คัดขยะออก (แคตตาล็อกฟรีชั้น 1 + Gemini ส่องทีละแบตช์) ──
    if (action === 'clean') {
      const c = await loadCase(store, body.caseId);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส', errorType: 'CASE_NOT_FOUND' }, { status: 404 });
      const sharp = (await import('sharp')).default;
      const subjects = c.keywords?.subjects || [];
      const newsGist = (c.analysis?.summary || c.newsSnippet || '').slice(0, 600);
      const all = c.images || [];
      const CAP = parseInt(process.env.CLEAN_CAP || '150', 10);
      const catalogIds = all.filter((im) => isCatalogSource(im)).map((im) => im.id);
      const toScan = all.filter((im) => !isCatalogSource(im)).slice(0, CAP);

      const withB64 = [];
      for (const im of toScan) {
        const buf = await loadImageBuffer({ imageUrl: im.thumbnailUrl || im.imageUrl, thumbnailUrl: im.imageUrl });
        if (!buf) continue;
        try {
          const small = await sharp(buf, { failOn: 'none' }).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
          withB64.push({ im, base64: small.toString('base64') });
        } catch { /* รูปเสีย ข้าม */ }
      }
      const junkIds = [...catalogIds];
      const BATCH = 8;
      for (let i = 0; i < withB64.length; i += BATCH) {
        const batch = withB64.slice(i, i + BATCH);
        const frames = batch.map((b, k) => ({ index: i + k, base64: b.base64, source: b.im.source, title: b.im.title }));
        try {
          const res = await geminiJunkScan({ frames, subjects, newsGist });
          for (const r of res) { if (r.junk && withB64[r.index]) junkIds.push(withB64[r.index].im.id); }
        } catch (err) {
          if (err.errorType === 'NO_GEMINI_KEY') return NextResponse.json({ success: false, error: err.message, errorType: 'NO_GEMINI_KEY' }, { status: 400 });
          /* แบตช์นี้พลาด ข้าม */
        }
      }
      const junkSet = new Set(junkIds);
      c.images = all.filter((im) => !junkSet.has(im.id));
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'clean', removed: junkIds.length, catalog: catalogIds.length }].slice(-30);
      await store.update(c.id, () => c);
      return NextResponse.json({ success: true, caseId: c.id, scanned: withB64.length, removed: junkIds.length, catalogRemoved: catalogIds.length, aiRemoved: junkIds.length - catalogIds.length, total: c.images.length, byPlatform: countBy(c.images), case: c });
    }

    // ── 🎭 แยกอารมณ์ภาพ (Gemini เซ็ต emotion ต่อรูป → กรองในคลังได้) ──
    if (action === 'emotions') {
      const c = await loadCase(store, body.caseId);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส', errorType: 'CASE_NOT_FOUND' }, { status: 404 });
      const sharp = (await import('sharp')).default;
      const subjects = c.keywords?.subjects || [];
      const CAP = parseInt(process.env.EMOTION_CAP || '200', 10);
      const targets = (c.images || []).slice(0, CAP);
      const withB64 = [];
      for (const im of targets) {
        const buf = await loadImageBuffer({ imageUrl: im.thumbnailUrl || im.imageUrl, thumbnailUrl: im.imageUrl });
        if (!buf) continue;
        try {
          const small = await sharp(buf, { failOn: 'none' }).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
          withB64.push({ im, base64: small.toString('base64') });
        } catch { /* ข้าม */ }
      }
      const emotionMap = {};
      const BATCH = 8;
      for (let i = 0; i < withB64.length; i += BATCH) {
        const batch = withB64.slice(i, i + BATCH);
        const frames = batch.map((b, k) => ({ index: i + k, base64: b.base64 }));
        try {
          const res = await geminiEmotionScan({ frames, subjects });
          for (const r of res) { const src = withB64[r.index]; if (src) emotionMap[src.im.id] = r.emotion; }
        } catch (err) {
          if (err.errorType === 'NO_GEMINI_KEY') return NextResponse.json({ success: false, error: err.message, errorType: 'NO_GEMINI_KEY' }, { status: 400 });
        }
      }
      for (const im of c.images || []) { if (emotionMap[im.id]) im.emotion = emotionMap[im.id]; }
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'emotions', classified: Object.keys(emotionMap).length }].slice(-30);
      await store.update(c.id, () => c);
      const byEmotion = {};
      for (const im of c.images || []) { if (im.emotion) byEmotion[im.emotion] = (byEmotion[im.emotion] || 0) + 1; }
      return NextResponse.json({ success: true, caseId: c.id, classified: Object.keys(emotionMap).length, byEmotion, total: c.images.length, byPlatform: countBy(c.images), case: c });
    }

    // ── ค้นหลายแหล่งพร้อมกัน (แมนนวล — พิมพ์คำค้นเอง) ──
    if (action === 'search') {
      const queries = (Array.isArray(body.queries) ? body.queries : String(body.queries || '').split(/\n/))
        .map((q) => String(q).trim()).filter(Boolean).slice(0, 5);
      const platforms = (body.platforms || []).filter((p) => PLATFORMS.includes(p));
      if (!queries.length) return NextResponse.json({ success: false, error: 'ต้องใส่คำค้นอย่างน้อย 1 คำ', errorType: 'NO_QUERIES' }, { status: 400 });
      if (!platforms.length) return NextResponse.json({ success: false, error: 'ต้องเลือกแหล่งอย่างน้อย 1 แหล่ง', errorType: 'NO_PLATFORMS' }, { status: 400 });

      // เคสใหม่หรือเติมเคสเดิม
      let c = body.caseId ? await loadCase(store, body.caseId) : null;
      let isNew = false;
      if (!c) {
        c = {
          id: await nextCaseId(store),
          title: (body.title || queries[0]).slice(0, 80),
          createdAt: new Date().toISOString(),
          images: [], queries: [], log: [],
        };
        isNew = true;
      }

      // ยิงขนานรายแพลตฟอร์ม + บล็อกแหล่งแคตตาล็อก (ตัวเดียวกับ searchAuto)
      const { errors, perPlatform, blockedCatalog } = await runMultiSearch(c, queries, platforms);

      c.queries = [...new Set([...(c.queries || []), ...queries])].slice(0, 60);
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'search', platforms, queries, added: perPlatform, blockedCatalog }].slice(-30);

      if (isNew) await store.add(c);
      else await store.update(c.id, () => c);

      return NextResponse.json({ success: true, caseId: c.id, addedByPlatform: perPlatform, blockedCatalog, total: c.images.length, byPlatform: countBy(c.images), errors, case: c });
    }

    // ── ค้นย้อนกลับจากภาพ (Google Lens) ──
    if (action === 'reverse') {
      const imageUrl = String(body.imageUrl || '').trim();
      if (!/^https?:/.test(imageUrl)) return NextResponse.json({ success: false, error: 'ต้องใส่ URL ภาพ (http/https)', errorType: 'BAD_IMAGE_URL' }, { status: 400 });
      let c = body.caseId ? await loadCase(store, body.caseId) : null;
      let isNew = false;
      if (!c) {
        c = { id: await nextCaseId(store), title: 'ค้นย้อนกลับจากภาพ', createdAt: new Date().toISOString(), images: [], queries: [], log: [] };
        isNew = true;
      }
      const imgs = await reverseImageMulti(imageUrl);
      const added = mergeImages(c, imgs, 'reverse', 'lens');
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'reverse', added }].slice(-30);
      if (isNew) await store.add(c); else await store.update(c.id, () => c);
      return NextResponse.json({ success: true, caseId: c.id, added, total: c.images.length, byPlatform: countBy(c.images), case: c });
    }

    // ── ดึงรูปโปรไฟล์ IG/FB ──
    if (action === 'profile') {
      const username = String(body.username || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|facebook)\.com\//, '').replace(/\/.*$/, '');
      const network = body.network === 'facebook' ? 'facebook' : 'instagram';
      if (!username) return NextResponse.json({ success: false, error: 'ต้องใส่ username หรือลิงก์โปรไฟล์', errorType: 'NO_USERNAME' }, { status: 400 });
      let c = body.caseId ? await loadCase(store, body.caseId) : null;
      let isNew = false;
      if (!c) {
        c = { id: await nextCaseId(store), title: `โปรไฟล์ ${username}`, createdAt: new Date().toISOString(), images: [], queries: [], log: [] };
        isNew = true;
      }
      const imgs = network === 'facebook' ? await facebookProfileImages(username) : await instagramProfileImages(username);
      const added = mergeImages(c, imgs, network === 'facebook' ? 'fb_profile' : 'instagram', username);
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'profile', network, username, added }].slice(-30);
      if (isNew) await store.add(c); else await store.update(c.id, () => c);
      return NextResponse.json({ success: true, caseId: c.id, added, total: c.images.length, byPlatform: countBy(c.images), case: c });
    }

    // ── ลบ / เก็บเฉพาะที่เลือก / ล้าง ──
    if (action === 'remove' || action === 'keep' || action === 'clear') {
      const c = await loadCase(store, body.caseId);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส', errorType: 'CASE_NOT_FOUND' }, { status: 404 });
      const ids = new Set(body.ids || []);
      if (action === 'remove') c.images = (c.images || []).filter((i) => !ids.has(i.id));
      else if (action === 'keep') c.images = (c.images || []).filter((i) => ids.has(i.id));
      else c.images = body.platform ? (c.images || []).filter((i) => i.platform !== body.platform) : [];
      await store.update(c.id, () => c);
      return NextResponse.json({ success: true, caseId: c.id, total: c.images.length, byPlatform: countBy(c.images), case: c });
    }

    // ── ลบทั้งเคส ──
    if (action === 'deleteCase') {
      await store.remove(body.caseId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'action ไม่รองรับ: ' + action, errorType: 'BAD_ACTION' }, { status: 400 });
  } catch (error) {
    const status = error.errorType === 'NO_SERPAPI_KEY' ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message, errorType: error.errorType || 'IMAGE_SEARCH_ERROR' }, { status });
  }
}
