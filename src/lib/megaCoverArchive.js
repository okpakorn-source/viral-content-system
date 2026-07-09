// ============================================================
// 🗂️ MEGA Cover Archive — คลังงานปก MEGA (แยกจากคลังปกทั่วไป CASE-xxx)
// ------------------------------------------------------------
// ★ 9 ก.ค. 2026 (ผู้ใช้สั่ง "คลังต้องเห็นบน Vercel ด้วย"): ย้ายหลังบ้านขึ้นคลาวด์
//   เมตา: persistStore 'mega-cover-runs' (Supabase หลัก + data/mega-cover-runs.json fallback — ห้ามลบ fallback)
//   ภาพ: 2 ชั้น — ① ไฟล์ public/mega-covers/ (เครื่องทีม เร็วสุด) ② แถว store_items
//   'mega-cover-images' base64 รายใบ (⚠️ อ่านทีละแถวเท่านั้น ห้าม getAll คลังภาพ — egress บวม)
//   → เครื่องทีมและ Vercel เห็นคลังเดียวกัน เสิร์ฟภาพผ่าน /api/mega-covers/img?id=
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

const store = createStore('mega-cover-runs');
const IMG_STORE = 'mega-cover-images';
const TABLE = 'store_items';
const MAX = 500;           // เมตา (เบา ~1KB/ใบ)
const MAX_CLOUD_IMG = 150; // ภาพ base64 บนคลาวด์ (~350KB/ใบ) เก็บล่าสุดพอ

/** ดึงรายการปกในคลัง (ใหม่สุดก่อน) — เมตาอย่างเดียว ไม่มี base64 */
export async function listMegaCovers(limit = 200) {
  const all = await store.getAll();
  return all
    .slice()
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);
}

/** บันทึกปก 1 ใบเข้าคลัง (auto จากทุกจุดกดสร้างปก) — ล้มไม่ critical ต่อการทำปก
 *  rec.base64 (data URL) → เซฟไฟล์เครื่อง + แถวภาพคลาวด์ ให้ดู/โหลดได้ทั้งเครื่องทีมและ Vercel */
export async function addMegaCover(rec = {}) {
  const id = rec.id || `MCV-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(rec.base64 || '');
  let coverPath = rec.coverPath || null;

  // ① ไฟล์ในเครื่อง (UI เครื่องทีมเปิดตรงได้) — Vercel เขียนดิสก์ไม่ได้ = ข้ามเงียบ ไปพึ่งคลาวด์
  if (m && !coverPath) {
    try {
      const dir = path.join(process.cwd(), 'public', 'mega-covers');
      await fs.mkdir(dir, { recursive: true });
      const file = `${id}.${m[1] === 'png' ? 'png' : 'jpg'}`;
      await fs.writeFile(path.join(dir, file), Buffer.from(m[2], 'base64'));
      coverPath = `/mega-covers/${file}`;
    } catch { /* อ่านผ่าน /api/mega-covers/img แทน */ }
  }

  const entry = {
    id,
    at: new Date().toISOString(),
    title: rec.title || '',
    source: rec.source || 'mega',         // 'mega' | 'compose-test' | 'cover-ref-test'
    imageCaseId: rec.imageCaseId || null, // AC-xxxx (ระบบ keyword)
    coverCaseId: rec.coverCaseId || null, // CASE-xxx (คลังปกทั่วไป)
    coverPath,                            // /mega-covers/xxx.jpg (มีเฉพาะเครื่องที่เขียนไฟล์ได้)
    refId: rec.refId || null,
    refSimilarity: rec.refSimilarity ?? null,
    template: rec.template || '',
    score: rec.score ?? null,
    throughMega: rec.throughMega !== false,
    qcFlags: Array.isArray(rec.qcFlags) && rec.qcFlags.length ? rec.qcFlags : undefined, // เฟส 4.3: ธงคุณภาพต่อใบ
    hasCloudImage: false,
    trace: Array.isArray(rec.trace) ? rec.trace.map((t) => ({ stage: t.stage, status: t.status })) : undefined,
  };

  // ② แถวภาพคลาวด์ (รายใบ — แยกจาก store เมตา ไม่งั้น getAll ลาก base64 ทุกใบ)
  if (m && isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const { error } = await sb.from(TABLE).insert({
        id: `MCVIMG-${id}`,
        store_name: IMG_STORE,
        data: { id, base64: rec.base64 },
        created_at: entry.at,
        updated_at: entry.at,
      });
      if (!error) entry.hasCloudImage = true;
    } catch { /* ไม่มีคลาวด์ = ใช้ไฟล์เครื่องอย่างเดียว */ }
  }

  try { await store.add(entry); } catch { /* คลังเมตาล้มไม่ให้กระทบทำปก */ }
  pruneOld().catch(() => {});
  return entry;
}

/** เมตา 1 ใบ (คลาวด์แถวเดียว → fallback ไฟล์ local) — ไม่ getAll เพื่อประหยัด egress ตอนเสิร์ฟภาพ */
async function getMeta(id) {
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const { data } = await sb.from(TABLE).select('data').eq('store_name', 'mega-cover-runs').eq('id', id).maybeSingle();
      if (data?.data) return data.data;
    } catch { /* ลอง local ต่อ */ }
  }
  try {
    const t = await fs.readFile(path.join(process.cwd(), 'data', 'mega-cover-runs.json'), 'utf8');
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr.find((x) => x && x.id === id) || null : null;
  } catch { return null; }
}

/** ดึงภาพปก 1 ใบเป็น Buffer (ไฟล์เครื่อง → แถวคลาวด์) — null = ไม่พบทั้งสองชั้น */
export async function getMegaCoverImage(id) {
  const rec = await getMeta(id);
  // ① ไฟล์ในเครื่อง
  if (rec?.coverPath) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), 'public', rec.coverPath.replace(/^\//, '')));
      return { buffer: buf, mime: rec.coverPath.endsWith('.png') ? 'image/png' : 'image/jpeg', rec };
    } catch { /* ไฟล์หาย (คนละเครื่อง/deploy ใหม่) → คลาวด์ */ }
  }
  // ② แถวภาพคลาวด์
  if (isSupabaseReady()) {
    try {
      const sb = getSupabase();
      const { data } = await sb.from(TABLE).select('data').eq('store_name', IMG_STORE).eq('id', `MCVIMG-${id}`).maybeSingle();
      const m = /^data:image\/(\w+);base64,(.+)$/.exec(data?.data?.base64 || '');
      if (m) return { buffer: Buffer.from(m[2], 'base64'), mime: `image/${m[1] === 'png' ? 'png' : 'jpeg'}`, rec };
    } catch { /* ไม่พบ */ }
  }
  return null;
}

/** ตัดของเก่า: เมตาเกิน MAX + แถวภาพคลาวด์เกิน MAX_CLOUD_IMG (fire-and-forget — ล้มไม่เป็นไร) */
async function pruneOld() {
  try {
    const all = (await store.getAll())
      .slice()
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    for (const old of all.slice(MAX)) { try { await store.remove(old.id); } catch { /* ข้าม */ } }
    if (!isSupabaseReady()) return;
    const drop = all.filter((x) => x.hasCloudImage).slice(MAX_CLOUD_IMG, MAX_CLOUD_IMG + 20);
    if (!drop.length) return;
    const sb = getSupabase();
    await sb.from(TABLE).delete().eq('store_name', IMG_STORE).in('id', drop.map((x) => `MCVIMG-${x.id}`));
    // ไม่แก้ธง hasCloudImage ย้อนหลัง — /api/mega-covers/img เช็คของจริงแล้ว 404 เองถ้าไม่มี
  } catch { /* prune ล้มไม่กระทบระบบ */ }
}
