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
import { resilientFetch } from './supabase.js';
// ★ Stage-A (candidate authority): NO static import ของ candidateFactAuthority ที่นี่ —
//   default/legacy path ต้องไม่โหลด/ไม่ activate authority เลย · โหลดแบบ dynamic import
//   เฉพาะใน opt-in branch ของ buildImagesRouteResponse เท่านั้น

const DIR = path.join(process.cwd(), 'data', 'case-images');
const STORE_NAME = 'acs-images';
const TABLE = 'store_items';

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key, { global: { fetch: resilientFetch } }) : false;
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

// ============================================================
// ★ ยืมรูปข้ามเคส (cross-case image borrow) — kill-switch MEGA_CROSS_CASE_BORROW='1' ที่ฝั่งผู้เรียก (megaAdapters.js)
// ------------------------------------------------------------
// readImages/addImages เดิมด้านบน "ห้ามแตะ byte/semantic เดิม" — ฟังก์ชันนี้เป็นของใหม่ล้วน แยก path เต็ม
// หาภาพของ "คนคนเดียวกัน" จากเคสข่าวอื่นในคลัง acs-images (ข้าม caseId ปัจจุบัน) — ใช้ตอนเคสนี้ขาดภาพหน้าดี
// ของตัวละครหลัก ห้าม throw เด็ดขาด (ยืมพัง = คืน [] เงียบ ให้ผู้เรียกเดินต่อได้เสมอ)
// ============================================================
// dep injection: client (เทสเท่านั้น — production ไม่ส่ง ใช้ sb() ของจริงเสมอ)
export async function findImagesByPerson({ personName, excludeCaseId, minShortSide = 0, limit = 12, client } = {}) {
  const name = typeof personName === 'string' ? personName.trim() : '';
  if (name.length < 2) return []; // กันชื่อว่าง/สั้นเกินไป match มั่ว

  const nameLc = name.toLowerCase();
  const shortSideOf = (im) => {
    const rw = Number(im?.realWidth), rh = Number(im?.realHeight);
    if (rw > 0 && rh > 0) return Math.min(rw, rh);
    const ts = Number(im?.triage?.realShortSide);
    return ts > 0 ? ts : null;
  };
  // ★ เทียบชื่อระดับ "คำ" — parity กับ _namesMatchSimple ใน s6 (megaAdapters) กัน over-match ชื่อสั้น
  //   (raw-substring เดิมจับ "แอน" ปนกับ "แอนนา" ข้ามขอบคำได้ → token-based ตัด title + เทียบทีละคำ)
  const _TITLE_WORDS = new Set(['นาย', 'นาง', 'นางสาว', 'คุณ', 'ดร.', 'หมอ', 'ผู้ก่อตั้ง', 'อดีต']);
  const _nameTokens = (s) => String(s || '').toLowerCase().replace(/[()"'“”]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !_TITLE_WORDS.has(t));
  const _queryToks = _nameTokens(nameLc);
  const matchesPerson = (im) => {
    const p = im?.triage?.person;
    if (typeof p !== 'string' || !p) return false;
    const pt = _nameTokens(p);
    return _queryToks.some((x) => pt.some((y) => x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y))));
  };
  const isEligible = (im) => {
    if (!im || typeof im !== 'object') return false;
    if (im.triage?.clean === false) return false;
    if (im.triage?.relevant === false) return false;
    if (excludeCaseId != null && im.caseId === excludeCaseId) return false;
    if (!matchesPerson(im)) return false;
    if (minShortSide > 0) {
      const rss = shortSideOf(im);
      if (rss != null && rss < minShortSide) return false; // วัดได้แล้วเล็กกว่าเกณฑ์ = ตัด (วัดไม่ได้ = ยอมผ่าน)
    }
    return true;
  };
  const sortBySizeDesc = (a, b) => {
    const sa = shortSideOf(a), sb = shortSideOf(b);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1; // วัดไม่ได้ไปท้าย
    if (sb == null) return -1;
    return sb - sa;
  };

  try {
    const c = client || sb();
    if (c) {
      const { data, error } = await c
        .from(TABLE)
        .select('data')
        .eq('store_name', STORE_NAME)
        .ilike('data->triage->>person', `%${name}%`);
      if (error) return [];
      const rows = (data || []).map((r) => r.data).filter(Boolean).filter(isEligible);
      return rows.sort(sortBySizeDesc).slice(0, limit);
    }
    // Supabase ไม่มี → fallback: อ่านทุกไฟล์ data/case-images/*.json ยกเว้น excludeCaseId
    let files;
    try {
      await ensureDir();
      files = await fs.readdir(DIR);
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const cid = f.slice(0, -5);
      if (excludeCaseId != null && cid === excludeCaseId) continue;
      try {
        const raw = await fs.readFile(path.join(DIR, f), 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const im of arr) if (isEligible(im)) out.push(im);
        }
      } catch { /* ไฟล์เดี่ยวพัง/อ่านไม่ได้ = ข้าม ไม่ล้มทั้งชุด */ }
    }
    return out.sort(sortBySizeDesc).slice(0, limit);
  } catch {
    return []; // ห้าม throw — ยืมพังต้องไม่กระทบผู้เรียก
  }
}

export function countByPlatform(images) {
  const m = {};
  for (const im of images) {
    const p = im.platform || 'unknown';
    m[p] = (m[p] || 0) + 1;
  }
  return m;
}

// ★ 8 ก.ค. (เร่งค้นภาพขนาน): คิวเขียน "ต่อเคส" — ค้นหลายแหล่งพร้อมกันทำให้ addImages
//   ถูกเรียกขนานบนเคสเดียว ถ้าไม่เข้าคิว: ทั้งคู่อ่าน existing ชุดเดียวกัน → fs mode เขียนทับกัน
//   (รูปแหล่งแรกหายยกชุด) / Supabase mode สร้าง id ชนกัน → แถวโดน skip เงียบ
//   เข้าคิวแล้วพฤติกรรมต่อ caller เท่าเดิมทุกอย่าง (signature/ผลลัพธ์เดิม) แค่เรียงลำดับเขียนทีละงานต่อเคส
const addQueues = globalThis.__IMG_ADD_QUEUES || (globalThis.__IMG_ADD_QUEUES = new Map());

// เพิ่มรูปใหม่ (ตัดซ้ำจาก imageUrl) → คืนสถิติ
export async function addImages(caseId, incoming) {
  const prev = addQueues.get(caseId) || Promise.resolve();
  const run = prev.then(() => addImagesUnlocked(caseId, incoming));
  const tail = run.catch(() => {}); // งานก่อนหน้าพัง ไม่ลามงานถัดไปในคิว
  addQueues.set(caseId, tail);
  tail.then(() => {
    if (addQueues.get(caseId) === tail) addQueues.delete(caseId);
  });
  return run;
}

async function addImagesUnlocked(caseId, incoming) {
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

// ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง "ภาพพร้อมใช้"): ภาพที่ยังเป็นลิงก์เว็บนอก (hotlink หมดอายุได้/ครอปไม่ได้)
//   → worker เครื่องทีมจะโหลดไฟล์ต้นฉบับเต็มมาเก็บ Supabase Storage แล้วสลับ imageUrl เป็นไฟล์ถาวร
// ★ เฟส 1 (9 ก.ค.): คิว rehost 3 ชั้น (เรียงความสำคัญ A → B → C, กันซ้ำด้วย id, รวมไม่เกิน limit)
//   (A) ลิงก์เว็บนอก (http, ไม่ใช่ supabase.co) — ของใหม่ยังไม่เซฟ + ใบ rehostQuality='thumbnail' แบบใหม่
//       (หลังแก้ 1.1 imageUrl ยังชี้ต้นฉบับ) จึงวนกลับเข้า query นี้เอง = retry ต้นฉบับ (1.3)
//   (B) เฟรม local (/case-frames/..) ที่คลาวด์เปิดไม่ได้ → worker เครื่องทีมอ่านดิสก์แล้วอัป Supabase (1.6)
//   (C) กู้ record เก่าก่อนเฟส 1 ที่ "ถูกสลับแล้ว" — imageUrl ชี้สำเนา thumbnail บน supabase.co
//       แต่ originUrl ยังเก็บต้นฉบับ → เข้าคิวให้ worker ลอง ladder จาก originUrl (~49% ของคลังเคสเดิม)
//   worker คุมเพดานรอบด้วย rehostTries: ครบ MAX แล้วยังไม่ได้ต้นฉบับ → ตั้ง rehostFailed='thumbnail-max-retries' → หลุดคิว
export async function listNeedingRehost(limit = 8) {
  const c = sb();
  if (!c) return [];
  const runQuery = (apply) => {
    let q = c.from(TABLE).select('data').eq('store_name', STORE_NAME).is('data->rehostFailed', null);
    q = apply(q);
    return q.order('created_at', { ascending: false }).limit(limit);
  };
  // (A) ลิงก์เว็บนอก (http) ที่ยังไม่ได้เซฟลง supabase — รวม thumbnail-only ที่รอ retry ต้นฉบับ (1.3)
  const web = await runQuery((q) =>
    q.ilike('data->>imageUrl', 'http%').not('data->>imageUrl', 'ilike', '%supabase.co%')
  );
  if (web.error) throw new Error('หารายการภาพรอเซฟไม่สำเร็จ: ' + web.error.message);
  let items = (web.data || []).map((r) => r.data).filter(Boolean);
  const pushUnique = (extra) => {
    const have = new Set(items.map((i) => i.id));
    for (const it of extra) { if (it && !have.has(it.id)) { have.add(it.id); items.push(it); } }
  };
  // (B) ★ 1.6: เฟรม local (imageUrl ขึ้นต้น '/') — worker อ่านไฟล์จากดิสก์แล้วอัป Supabase
  if (items.length < limit) {
    const local = await runQuery((q) => q.like('data->>imageUrl', '/%'));
    if (!local.error) pushUnique((local.data || []).map((r) => r.data));
  }
  // (C) ★ กู้ของเก่าที่ถูกสลับเป็นสำเนา thumbnail — เฉพาะโหมดใหม่ (kill-switch REHOST_PRESERVE_ORIGINAL=0 → ไม่กู้)
  if (items.length < limit && process.env.REHOST_PRESERVE_ORIGINAL !== '0') {
    const legacy = await runQuery((q) =>
      q.ilike('data->>imageUrl', '%supabase.co%')
        .eq('data->>rehostQuality', 'thumbnail')
        .ilike('data->>originUrl', 'http%')
    );
    if (!legacy.error) pushUnique((legacy.data || []).map((r) => r.data));
  }
  return items.slice(0, limit);
}

// อัปเดตภาพหลังเซฟไฟล์ถาวร (หรือ mark ว่าเซฟไม่ได้ จะได้ไม่วนซ้ำ)
export async function applyRehost(id, patch) {
  const c = sb();
  if (!c) return null;
  const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME).eq('id', id).single();
  if (error || !data?.data) return null;
  const merged = { ...data.data, ...patch };
  const { error: e2 } = await c
    .from(TABLE)
    .update({ data: merged, updated_at: new Date().toISOString() })
    .eq('store_name', STORE_NAME)
    .eq('id', id);
  if (e2) throw new Error('อัปเดตภาพไม่สำเร็จ: ' + e2.message);
  return merged;
}

// ล้างธง rehostFailed (หลังปรับวิธีโหลดใหม่ ให้ตัวที่เคยพลาดกลับเข้าคิว)
export async function resetRehostFailed(limit = 200) {
  const c = sb();
  if (!c) return 0;
  const { data, error } = await c
    .from(TABLE)
    .select('id, data')
    .eq('store_name', STORE_NAME)
    .not('data->rehostFailed', 'is', null)
    .limit(limit);
  if (error) throw new Error('หารายการพลาดไม่สำเร็จ: ' + error.message);
  let n = 0;
  for (const row of data || []) {
    const d = { ...row.data };
    delete d.rehostFailed;
    const { error: e2 } = await c
      .from(TABLE)
      .update({ data: d, updated_at: new Date().toISOString() })
      .eq('store_name', STORE_NAME)
      .eq('id', row.id);
    if (!e2) n++;
  }
  return n;
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

// ============================================================
// ★ Stage-A (candidate authority) — readImagesSnapshot + route glue
// ------------------------------------------------------------
// readImages() ด้านบน "ห้ามแตะ byte/semantic เดิม" — ทุกอย่างข้างล่างนี้เป็นของใหม่ล้วน
// ============================================================

const SNAPSHOT_SCOPE = 'case_image_store_snapshot_v1';
const SNAPSHOT_MAX_ROWS = 2000;

// อ่านคลังรูปแบบ "snapshot พิสูจน์ได้" — Supabase ใช้ RPC ตัวเดียว (count(*) + jsonb_agg ที่ bound ≤2000
//   ใน SQL statement เดียว = MVCC snapshot เดียว) กัน TOCTOU (ห้าม count-then-page แยกคำสั่ง)
//   Node ตรวจ count ซ้ำเทียบ rows.length + ทุกแถวต้องมี own caseId (string) ตรงคำขอ ถึงจะ complete
//   Filesystem = "พิสูจน์ complete ไม่ได้" → complete:false เสมอ (reason FS_UNPROVEN) · [] จาก corruption
//   ก็ยัง complete:false (ไม่มีวันเป็น complete-empty)
//   ★ ไม่มี side-effect global ใด ๆ — เทสนับ call ด้วย dependency injection (client จำลอง) แทน
export async function readImagesSnapshot(caseId, { client } = {}) {
  const c = client || sb();

  if (!c) {
    let rows = [];
    try {
      const r = await fsRead(caseId);
      rows = Array.isArray(r) ? r : [];
    } catch {
      rows = []; // corruption/ดิสก์พัง → [] แต่ยัง complete:false ด้านล่าง
    }
    return { scope: SNAPSHOT_SCOPE, caseId, complete: false, truncated: false, count: rows.length, rows, reason: 'FS_UNPROVEN' };
  }

  const { data, error } = await c.rpc('read_case_image_snapshot', { p_case_id: caseId });
  if (error) throw new Error('อ่าน snapshot คลังรูปไม่สำเร็จ: ' + (error.message || 'RPC error'));

  const rowsRaw = data && typeof data === 'object' ? data.rows : null;
  const rows = Array.isArray(rowsRaw) ? rowsRaw : null;
  const count = data && typeof data === 'object' ? Number(data.count) : NaN;

  if (rows === null || !Number.isInteger(count) || count < 0) {
    const safeRows = Array.isArray(rows) ? rows : [];
    return { scope: SNAPSHOT_SCOPE, caseId, complete: false, truncated: false, count: safeRows.length, rows: safeRows, reason: 'RPC_MALFORMED' };
  }
  if (rows.length > SNAPSHOT_MAX_ROWS) {
    return { scope: SNAPSHOT_SCOPE, caseId, complete: false, truncated: true, count, rows, reason: 'OVERSIZE' };
  }
  // ทุกแถวต้องพก own caseId (string) เท่ากับคำขอเป๊ะ — หาย/ไม่ใช่ string/ไม่ตรง = complete:false
  for (const r of rows) {
    const ok = r && typeof r === 'object'
      && Object.prototype.hasOwnProperty.call(r, 'caseId')
      && typeof r.caseId === 'string'
      && r.caseId === caseId;
    if (!ok) {
      return { scope: SNAPSHOT_SCOPE, caseId, complete: false, truncated: false, count, rows, reason: 'CASE_MISMATCH' };
    }
  }

  const complete = count === rows.length;
  const truncated = count > rows.length;
  let reason;
  if (!complete) reason = truncated ? 'TRUNCATED' : 'COUNT_MISMATCH';
  return { scope: SNAPSHOT_SCOPE, caseId, complete, truncated, count, rows, ...(reason ? { reason } : {}) };
}

// สร้าง payload ของ route GET /api/images/[id] — แยกออกมาให้เทสได้ offline (route.js เป็นแค่เปลือกบาง)
//   candidateAuthorityRaw = ค่า query 'candidateAuthority' ดิบ · เปิด authority path เฉพาะ '1' เป๊ะ เท่านั้น
//   • default (ไม่ใช่ '1') = legacy path เป๊ะ: อ่าน readImages ครั้งเดียว · ไม่แตะ snapshot/authority เลย
//   • opt-in สำเร็จ = SINGLE READ: อ่าน snapshot ครั้งเดียว → images/total/byPlatform + authority มาจาก
//     snapshot rows ชุดเดียวกัน (ไม่มี legacy read นำ, ไม่มี read ซ้ำ)
//   • opt-in snapshot ล้ม/ไม่ complete = ค่อย fallback ไป readImages (legacy payload + marker incomplete, ไม่มี proof)
//   deps (เทสเท่านั้น): { readImages, readImagesSnapshot, authority } ฉีดของจำลอง/ตัวนับ — prod ไม่ส่ง
export async function buildImagesRouteResponse(caseId, candidateAuthorityRaw, deps = {}) {
  const readLegacy = deps.readImages || readImages;
  const legacyPayload = async () => {
    const images = await readLegacy(caseId);
    return { success: true, caseId, total: images.length, byPlatform: countByPlatform(images), images };
  };

  if (candidateAuthorityRaw !== '1') {
    return { status: 200, body: await legacyPayload() };
  }

  // opt-in: อ่าน snapshot ครั้งเดียว (การอ่านเดียวของ path นี้)
  const readSnap = deps.readImagesSnapshot || readImagesSnapshot;
  let snap = null;
  let readFailed = false;
  try {
    snap = await readSnap(caseId);
  } catch {
    readFailed = true;
  }

  if (!readFailed && snap && snap.complete === true) {
    const mod = deps.authority || (await import('./candidateFactAuthority.js'));
    const universe = mod.buildCandidateAuthoritySnapshotV1(snap);
    // payload มาจาก snapshot rows ชุดเดียวกัน — ไม่มี legacy read
    const images = Array.isArray(snap.rows) ? snap.rows : [];
    const base = { success: true, caseId, total: images.length, byPlatform: countByPlatform(images), images };
    // ★ B2 SHADOW: มินต์ candidateMetrics คู่กับ candidateAuthority — วัดจาก validated facts (universe.candidates)
    //   + face-cache (read-only). พังใด ๆ = ไม่ใส่ candidateMetrics (route ตอบเหมือนเดิมทุกไบต์) · consumer เดียว
    //   ตอนนี้ = B1 shadow bridge (megaAdapters `_rhMetricsCarrier`) ที่อ่านเงาเท่านั้น — ไม่เปลี่ยน HOLD/pick ใด ๆ
    let candidateMetrics;
    try {
      candidateMetrics = await buildCandidateMetricsCarrier({ caseId, universe, rows: images, deps });
    } catch {
      candidateMetrics = undefined;
    }
    return {
      status: 200,
      body: {
        ...base,
        candidateAuthority: { available: universe.universeComplete === true, ...universe },
        ...(candidateMetrics ? { candidateMetrics } : {}),
      },
    };
  }

  // snapshot ล้ม/ไม่ complete → fallback legacy read เท่านั้น (ห้ามกุ authority complete ปลอม)
  const base = await legacyPayload();
  return {
    status: 200,
    body: { ...base, candidateAuthority: { available: false, incomplete: true, reason: readFailed ? 'SNAPSHOT_READ_FAILED' : (snap && snap.reason) || 'SNAPSHOT_INCOMPLETE' } },
  };
}

// ============================================================
// ★ B2 SHADOW — candidateMetrics minter (route glue)
// ------------------------------------------------------------
// อ่าน validated facts จาก universe.candidates (ผ่าน candidateFactAuthority แล้ว) → วัดผ่าน producer PURE
//   (candidateMetricMeasurements) → แช่แข็ง/hash/bind ผ่าน candidateMetricAuthority → snapshot carrier เดียว
//   ★ dynamic import ทั้ง 2 โมดูลในนี้เท่านั้น (legacy path ไม่โหลด) · face-cache อ่านแบบ read-only ล้วน
//     (ไม่ยิง AI/HTTP) · ไม่มี key จับคู่ = faceCount absent · พังจุดใด = คืน null (route ไม่กระทบ)
// ============================================================
const FACE_CACHE_FILE = path.join(process.cwd(), 'data', 'face-cache.json');

// อ่าน data/face-cache.json แบบ read-only best-effort — พัง/ไม่มีไฟล์ = {} (ห้าม throw, ห้ามยิง network)
async function loadFaceCacheReadOnly() {
  try {
    const raw = await fs.readFile(FACE_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

// resolver จาก imageId/row → faceCacheEntry (มี faces เป็น array) หรือ undefined
//   face-cache keyed ด้วย buffer-hash (ไม่ใช่ imageId) — row จริงวันนี้ยังไม่พก key ⇒ undefined (faceCount absent)
//   forward-compatible: row.faceCacheKey / row.triage.faceCacheKey ถ้ามี → คืน entry.result (faces เป็น array)
function makeFaceCacheLookup(cache) {
  return (_imageId, row) => {
    if (row === null || typeof row !== 'object') return undefined;
    let key = typeof row.faceCacheKey === 'string' ? row.faceCacheKey : null;
    if (!key && row.triage && typeof row.triage === 'object' && typeof row.triage.faceCacheKey === 'string') {
      key = row.triage.faceCacheKey;
    }
    if (!key) return undefined;
    const entry = cache[key];
    return entry && typeof entry === 'object' && entry.result && typeof entry.result === 'object' ? entry.result : undefined;
  };
}

async function buildCandidateMetricsCarrier({ caseId, universe, rows, deps }) {
  const candidates = universe && Array.isArray(universe.candidates) ? universe.candidates : null;
  if (!candidates || !candidates.length) return null; // universe fail / ไม่มี candidate = ไม่มินต์

  const metricMod = (deps && deps.metricAuthority) || (await import('./candidateMetricAuthority.js'));
  const measureMod = (deps && deps.metricMeasurements) || (await import('./candidateMetricMeasurements.js'));
  const buildV1 = metricMod.buildCandidateMetricsV1;
  const buildSnap = metricMod.buildCandidateMetricsSnapshotV1;
  const measure = measureMod.measureCandidateMetrics;
  if (typeof buildV1 !== 'function' || typeof buildSnap !== 'function' || typeof measure !== 'function') return null;

  const faceLookup = (deps && deps.faceCacheLookup) || makeFaceCacheLookup(await loadFaceCacheReadOnly());
  const rowById = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r === 'object' && typeof r.id === 'string') rowById.set(r.id, r);
  }

  const imageIds = [];
  const metricsById = {};
  for (const cand of candidates) {
    const imageId = cand && typeof cand === 'object' ? cand.imageId : null;
    if (typeof imageId !== 'string' || !imageId || metricsById[imageId]) continue;
    imageIds.push(imageId);
    let faceCacheEntry;
    try {
      faceCacheEntry = faceLookup(imageId, rowById.get(imageId));
    } catch {
      faceCacheEntry = undefined;
    }
    const measurements = measure({ facts: cand.facts, faceCacheEntry });
    metricsById[imageId] = buildV1({ sourceAssetId: imageId, caseId, measurements });
  }
  if (!imageIds.length) return null;

  const snapshot = buildSnap({ caseId, imageIds, metricsById });
  // แนบเฉพาะ snapshot ที่สำเร็จ (success ไม่มี key `ok`; fail มี ok:false) — carrier ที่ล้ม = ไม่แนบ
  return snapshot && snapshot.ok !== false ? snapshot : null;
}
