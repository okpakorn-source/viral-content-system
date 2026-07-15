/**
 * Cover Image Pool Cache — ข่าวเดิม = ภาพชุดเดิม = ปกนิ่ง
 *
 * ปัญหา: ข่าวเดิมรันซ้ำ → runMultiAgentImageSearch ค้น Google ใหม่ทุกครั้ง → ภาพต่าง → ปกต่าง
 * แก้: cache "ภาพที่ Judge เลือกแล้ว" (post-search) เก็บไว้ · รันซ้ำข่าวเดิม → ดึงจาก cache ข้ามการค้น
 *
 * Key   = hash(newsTitle | mainCharacter)
 * Value = array ของ selected images (เก็บ url + metadata · ตัด buffer/b64 ออก · เฉพาะ http(s) URL)
 * Store = Supabase table `cover_image_pool_cache` (primary) > local JSON `data/image-pool-cache.json` (fallback)
 * opt-in: route.js เช็ค env COVER_POOL_CACHE เอง — ไฟล์นี้ทำแค่ get/set/clear (ไม่รู้จัก env)
 *
 * 🔴 เก็บแค่ URL — ตอน render จะ download ใหม่ทุกครั้ง (กัน buffer หมดอายุ) · ห้ามเจนภาพ
 */
import { getSupabase } from '../supabase.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const CACHE_TTL_HOURS = 72; // 3 วัน — ข่าวเก่ากว่านี้ = ค้นใหม่โดยอัตโนมัติ
const CACHE_TTL_MS = CACHE_TTL_HOURS * 3600 * 1000;
const TABLE = 'cover_image_pool_cache';
const LOCAL_JSON_PATH = path.join(process.cwd(), 'data', 'image-pool-cache.json');

export function makeCacheKey(newsTitle, mainCharacter) {
  const raw = `${(newsTitle || '').trim()}|${(mainCharacter || '').trim()}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}

// ============ Local JSON helpers ============
function loadLocal() {
  try {
    if (fs.existsSync(LOCAL_JSON_PATH)) return JSON.parse(fs.readFileSync(LOCAL_JSON_PATH, 'utf-8')) || {};
  } catch {}
  return {};
}
function saveLocal(obj) {
  try {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) { console.warn('[PoolCache] local save error:', e.message); }
}

// ตัด binary (buffer/b64) เก็บแค่ metadata + url · เฉพาะ http(s) URL (กัน data: URI frame บวม cache)
function sanitizeImages(images) {
  return (images || [])
    .filter(img => img && typeof img.url === 'string' && /^https?:\/\//.test(img.url))
    .map(({ buffer, b64, ...rest }) => rest);
}

/**
 * ดึง cache → { images, createdAt, ageHours } หรือ null (ไม่มี/หมดอายุ)
 */
export async function getPoolCache(key) {
  const now = Date.now();
  // 1. Supabase (primary)
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from(TABLE)
        .select('images, created_at, expires_at')
        .eq('cache_key', key)
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        const created = new Date(row.created_at).getTime();
        const expired = row.expires_at ? new Date(row.expires_at).getTime() < now : (now - created > CACHE_TTL_MS);
        if (!expired && Array.isArray(row.images) && row.images.length) {
          return { images: row.images, createdAt: row.created_at, ageHours: Math.round((now - created) / 3600000) };
        }
      }
    } catch (e) { console.warn(`[PoolCache] Supabase read fail (fallback local): ${e.message || e}`); }
  }
  // 2. Local JSON (fallback)
  try {
    const obj = loadLocal();
    const rec = obj[key];
    if (rec && Array.isArray(rec.images) && rec.images.length) {
      const created = new Date(rec.createdAt).getTime();
      if (now - created <= CACHE_TTL_MS) {
        return { images: rec.images, createdAt: rec.createdAt, ageHours: Math.round((now - created) / 3600000) };
      }
    }
  } catch {}
  return null;
}

/**
 * เก็บ cache (ทั้ง Supabase + local) — คืน true ถ้าเก็บสำเร็จอย่างน้อย 1 ที่
 */
export async function setPoolCache(key, images, meta = {}) {
  const clean = sanitizeImages(images);
  if (clean.length < 4) return false; // ภาพ http ไม่พอทำปก → ไม่ cache (กัน cache ชุดใช้ไม่ได้)
  // ★ CASE-290 safeguard (Hermes): เช็ค "คุณภาพ pool" ไม่ใช่แค่จำนวน — ไม่มี HERO_FACE = ไม่มีหน้าตัวหลักชัด
  //   (identity ผิดคน / pool แกว่ง) → ไม่ cache · lock ภาพผิดไว้ให้รอบหน้าใช้ซ้ำ = ยิ่งพัง · ปล่อยค้นใหม่ทุกรอบดีกว่า
  if (!clean.some(img => img.role === 'HERO_FACE')) {
    console.warn(`[PoolCache] ⛔ ไม่ cache (key=${key}) — pool ไม่มี HERO_FACE (คุณภาพต่ำ/อาจ identity ผิดคน)`);
    return false;
  }
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  let ok = false;

  // 1. Supabase upsert (ทับ key เดิม)
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb.from(TABLE).upsert({
        cache_key: key,
        news_title: String(meta.newsTitle || '').slice(0, 300),
        main_char: String(meta.mainCharacter || '').slice(0, 200),
        images: clean,
        created_at: createdAt,
        expires_at: expiresAt,
      }, { onConflict: 'cache_key' });
      if (error) throw error;
      ok = true;
    } catch (e) { console.warn(`[PoolCache] Supabase save fail (fallback local): ${e.message || e}`); }
  }

  // 2. Local JSON (เสมอ — กัน Supabase table ยังไม่มี / รันเครื่องทีม)
  try {
    const obj = loadLocal();
    obj[key] = { images: clean, newsTitle: meta.newsTitle || '', mainCharacter: meta.mainCharacter || '', createdAt };
    saveLocal(obj);
    ok = true;
  } catch (e) { console.warn('[PoolCache] local save fail:', e.message); }

  return ok;
}

/**
 * ล้าง cache ของ key (สำหรับ forceRefresh)
 */
export async function clearPoolCache(key) {
  const sb = getSupabase();
  if (sb) {
    try { await sb.from(TABLE).delete().eq('cache_key', key); }
    catch (e) { console.warn('[PoolCache] Supabase clear fail:', e.message || e); }
  }
  try {
    const obj = loadLocal();
    if (obj[key]) { delete obj[key]; saveLocal(obj); }
  } catch {}
}
