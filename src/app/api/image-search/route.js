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

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'search';
    const store = createStore(STORE);

    // ── ค้นหลายแหล่งพร้อมกัน ──
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
          id: `IS-${Date.now().toString(36)}`,
          title: (body.title || queries[0]).slice(0, 80),
          createdAt: new Date().toISOString(),
          images: [], queries: [], log: [],
        };
        isNew = true;
      }

      // ยิงขนานรายแพลตฟอร์ม (แต่ละแพลตฟอร์มไล่คำค้นตามลำดับ) — ล้มรายแหล่งไม่พังทั้งชุด
      const errors = [];
      const perPlatform = {};
      await Promise.all(platforms.map(async (p) => {
        let addedP = 0;
        for (const q of queries) {
          try {
            const imgs = await searchImagesMulti(p, q, { num: PER_QUERY });
            addedP += mergeImages(c, imgs, p, q);
          } catch (err) {
            if (err.errorType === 'NO_SERPAPI_KEY') throw err;
            errors.push({ platform: p, query: q, error: String(err.message).slice(0, 120) });
          }
        }
        perPlatform[p] = addedP;
      }));

      c.queries = [...new Set([...(c.queries || []), ...queries])].slice(0, 40);
      c.log = [...(c.log || []), { at: new Date().toISOString(), action: 'search', platforms, queries, added: perPlatform }].slice(-30);

      if (isNew) await store.add(c);
      else await store.update(c.id, () => c);

      return NextResponse.json({ success: true, caseId: c.id, addedByPlatform: perPlatform, total: c.images.length, byPlatform: countBy(c.images), errors, case: c });
    }

    // ── ค้นย้อนกลับจากภาพ (Google Lens) ──
    if (action === 'reverse') {
      const imageUrl = String(body.imageUrl || '').trim();
      if (!/^https?:/.test(imageUrl)) return NextResponse.json({ success: false, error: 'ต้องใส่ URL ภาพ (http/https)', errorType: 'BAD_IMAGE_URL' }, { status: 400 });
      let c = body.caseId ? await loadCase(store, body.caseId) : null;
      let isNew = false;
      if (!c) {
        c = { id: `IS-${Date.now().toString(36)}`, title: 'ค้นย้อนกลับจากภาพ', createdAt: new Date().toISOString(), images: [], queries: [], log: [] };
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
        c = { id: `IS-${Date.now().toString(36)}`, title: `โปรไฟล์ ${username}`, createdAt: new Date().toISOString(), images: [], queries: [], log: [] };
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
