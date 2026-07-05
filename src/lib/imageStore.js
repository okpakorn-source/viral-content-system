// ============================================================
// [ระบบทำปกออโต้ → copy เข้า repo ไวรัล 5 ก.ค. 2026] คลังรูปต่อเคส
// ------------------------------------------------------------
// รวมทุกแพลตฟอร์มต่อเคส mark ที่มา (platform, source) ชัดเจน · ตัดซ้ำด้วย imageUrl
// ★ deviation เดียวจากต้นฉบับ: ไส้เก็บเปลี่ยนจากไฟล์ data/case-images/{caseId}.json
//   → Supabase store_items (store_name='acs-images', "แถวละภาพ") เพราะ Vercel
//   ไม่มีดิสก์ถาวร + ก้อน JSON ใหญ่ทั้งเคสเคยทำ Postgres reject (บทเรียน 5 ก.ค.)
//   ไม่มี Supabase → fallback ไฟล์แบบต้นฉบับเป๊ะ · ทุก function signature ตรงต้นฉบับ 100%
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DIR = path.join(process.cwd(), 'data', 'case-images');
const STORE_NAME = 'acs-images';
const TABLE = 'store_items';

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key) : false;
  return _sb;
}

// ตัดอักขระ surrogate เดี่ยว (title/source จากเว็บสแครปมักมี) — กัน Postgres reject "Empty or invalid json"
function cleanStr(s) {
  return typeof s === 'string'
    ? s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1')
    : s;
}
function cleanImage(im) {
  const out = { ...im };
  for (const k of ['title', 'source', 'sourceLink', 'query', 'imageUrl', 'thumbnailUrl']) out[k] = cleanStr(out[k]);
  return out;
}

// ===== fs fallback (โค้ดต้นฉบับเป๊ะ) =====
function fileFor(id) { return path.join(DIR, `${id}.json`); }
async function ensureDir() { await fs.mkdir(DIR, { recursive: true }); }
async function fsRead(caseId) {
  await ensureDir();
  try {
    const raw = await fs.readFile(fileFor(caseId), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function fsWrite(caseId, imgs) {
  await ensureDir();
  await fs.writeFile(fileFor(caseId), JSON.stringify(imgs, null, 2), 'utf8');
}

export async function readImages(caseId) {
  const c = sb();
  if (!c) return fsRead(caseId);
  const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME).eq('data->>caseId', caseId);
  if (error) throw new Error('อ่านคลังรูปไม่สำเร็จ: ' + error.message);
  return (data || []).map((r) => r.data).filter(Boolean).sort((a, b) => (a.ord || 0) - (b.ord || 0));
}

export function countByPlatform(images) {
  const m = {};
  for (const im of images) {
    const p = im.platform || 'unknown';
    m[p] = (m[p] || 0) + 1;
  }
  return m;
}

// เพิ่มรูปใหม่ (ตัดซ้ำจาก imageUrl) → คืนสถิติ
export async function addImages(caseId, incoming) {
  const c = sb();
  const existing = await readImages(caseId);
  const seen = new Set(existing.map((i) => i.imageUrl));
  let maxOrd = existing.reduce((m, i) => Math.max(m, i.ord || 0), 0);

  const fresh = [];
  for (const im of incoming) {
    const ci = cleanImage(im);
    if (!ci.imageUrl || seen.has(ci.imageUrl)) continue;
    seen.add(ci.imageUrl);
    maxOrd++;
    fresh.push({ id: `${caseId}-${maxOrd}`, addedAt: new Date().toISOString(), ord: maxOrd, caseId, ...ci });
  }

  if (!c) {
    const all = [...existing, ...fresh];
    await fsWrite(caseId, all);
    return { added: fresh.length, total: all.length, byPlatform: countByPlatform(all), images: all };
  }

  // insert เป็นก้อนเล็ก (100 แถว/ครั้ง) — แถวไหนชน id ซ้ำ = ข้าม ไม่พังทั้งชุด
  const now = new Date().toISOString();
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100).map((im) => ({ id: im.id, store_name: STORE_NAME, data: im, created_at: now, updated_at: now }));
    const { error } = await c.from(TABLE).insert(chunk);
    if (error && !/duplicate key|23505/i.test(error.message)) {
      throw new Error('บันทึกรูปไม่สำเร็จ: ' + error.message);
    }
  }
  const all = [...existing, ...fresh];
  return { added: fresh.length, total: all.length, byPlatform: countByPlatform(all), images: all };
}

export async function imageStats(caseId) {
  const imgs = await readImages(caseId);
  return { total: imgs.length, byPlatform: countByPlatform(imgs) };
}

export function countByEmotion(images) {
  const m = {};
  for (const im of images) {
    if (!im.emotion) continue;
    m[im.emotion] = (m[im.emotion] || 0) + 1;
  }
  return m;
}

// อัปเดตรายแถวเฉพาะรูปที่เปลี่ยน (ทีละก้อนเล็ก กันช้า/กันพังทั้งชุด)
async function sbPatchRows(client, imgs) {
  for (let i = 0; i < imgs.length; i += 10) {
    const chunk = imgs.slice(i, i + 10);
    await Promise.all(chunk.map((im) =>
      client.from(TABLE).update({ data: im, updated_at: new Date().toISOString() }).eq('store_name', STORE_NAME).eq('id', im.id)
    ));
  }
}

// เซ็ตอารมณ์ให้รูปตาม id (map: { imageId: emotion }) → คืนรายการที่อัปเดตแล้ว
export async function setEmotions(caseId, map) {
  const c = sb();
  const imgs = await readImages(caseId);
  const changed = [];
  for (const im of imgs) {
    if (map[im.id]) { im.emotion = map[im.id]; changed.push(im); }
  }
  if (!c) await fsWrite(caseId, imgs);
  else await sbPatchRows(c, changed);
  return imgs;
}

// 🧠 เซ็ตผล "คัดกรองคลัง" (triage) ต่อรูปตาม id — เก็บถาวร
export async function setTriage(caseId, map) {
  const c = sb();
  const imgs = await readImages(caseId);
  const at = new Date().toISOString();
  let updated = 0;
  const changed = [];
  for (const im of imgs) {
    const t = map[im.id];
    if (!t) continue;
    im.triage = { ...t, at };
    if (t.emotion) im.emotion = t.emotion; // mirror ให้ตัวกรองอารมณ์เดิมใช้ได้เหมือนเดิม
    changed.push(im);
    updated++;
  }
  if (!c) await fsWrite(caseId, imgs);
  else await sbPatchRows(c, changed);
  return { updated, images: imgs };
}

export function countByCategory(images) {
  const m = {};
  for (const im of images) {
    const cat = im.triage?.category;
    if (cat) m[cat] = (m[cat] || 0) + 1;
  }
  return m;
}

export function countByPerson(images) {
  const m = {};
  for (const im of images) {
    const p = im.triage?.person;
    if (p) m[p] = (m[p] || 0) + 1;
  }
  return m;
}

// นับสถานะคัดกรอง: ยังไม่ตรวจ / เกี่ยวข้อง / ขยะ-ไม่เกี่ยว
export function triageSummary(images) {
  let untagged = 0, relevant = 0, junk = 0;
  for (const im of images) {
    if (!im.triage) untagged++;
    else if (im.triage.relevant === false) junk++;
    else relevant++;
  }
  return { total: images.length, untagged, relevant, junk };
}

// ลบไฟล์ภาพ local (เฟรม YouTube ที่เก็บใน public/) ของรายการที่ถูกลบ — เครื่องทีมเท่านั้น
async function deleteLocalFiles(images) {
  for (const im of images) {
    const url = im.imageUrl;
    if (url && url.startsWith('/')) {
      try {
        await fs.unlink(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
      } catch { /* ไม่มีไฟล์/ดิสก์ read-only ก็ข้าม */ }
    }
  }
}

// เคลียร์คลังตามแหล่ง (platform='all' = ล้างทั้งหมด)
export async function removeByPlatform(caseId, platform) {
  const c = sb();
  const imgs = await readImages(caseId);
  const removed = platform === 'all' ? imgs : imgs.filter((i) => i.platform === platform);
  const kept = platform === 'all' ? [] : imgs.filter((i) => i.platform !== platform);
  await deleteLocalFiles(removed);
  if (!c) await fsWrite(caseId, kept);
  else if (removed.length) {
    const ids = removed.map((i) => i.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await c.from(TABLE).delete().eq('store_name', STORE_NAME).in('id', ids.slice(i, i + 100));
      if (error) throw new Error('ลบรูปไม่สำเร็จ: ' + error.message);
    }
  }
  return { removed: removed.length, total: kept.length, byPlatform: countByPlatform(kept), images: kept };
}

// ลบภาพตาม id (ใช้ตอนคัดขยะ)
export async function removeByIds(caseId, ids) {
  const c = sb();
  const set = new Set(ids);
  const imgs = await readImages(caseId);
  const removed = imgs.filter((i) => set.has(i.id));
  const kept = imgs.filter((i) => !set.has(i.id));
  await deleteLocalFiles(removed);
  if (!c) await fsWrite(caseId, kept);
  else if (removed.length) {
    const rids = removed.map((i) => i.id);
    for (let i = 0; i < rids.length; i += 100) {
      const { error } = await c.from(TABLE).delete().eq('store_name', STORE_NAME).in('id', rids.slice(i, i + 100));
      if (error) throw new Error('ลบรูปไม่สำเร็จ: ' + error.message);
    }
  }
  return { removed: removed.length, total: kept.length, byPlatform: countByPlatform(kept), images: kept };
}
