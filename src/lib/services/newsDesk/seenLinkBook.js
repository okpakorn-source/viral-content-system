/**
 * =====================================================
 * 📕 Seen Link Book — ตำราจำลิงก์ที่โต๊ะข่าวเคยจ่ายค่าคัดกรองไปแล้ว (2 ส.ค. 69)
 * =====================================================
 * ที่มา: โต๊ะข่าวลบข่าวเก่าทิ้ง → รหัสลิงก์หลุดจากคลัง → รอบเก็บข่าวหน้าเจอ URL เดิม
 *   ผ่านด่านกันซ้ำ (ด่านเดิมเช็คเฉพาะข่าวที่ยังอยู่บนโต๊ะ) เข้ามาใหม่ = เผาค่า AI คัดกรองซ้ำเรื่องเดิม
 *   (สถิติคลังขยะ 400 ใบ: 89% ถูกตัดทิ้ง "หลัง" จ่ายค่าคัดกรองไปแล้ว)
 * หน้าที่:
 *   1) normalizeUrl(url) — ล้างลิงก์: ตัด utm_*, fbclid, gclid, ตัด trailing slash, lowercase host, ตัด www.
 *   2) linkKey(url) — คีย์สั้น md5 12 ตัวแรกของลิงก์ที่ล้างแล้ว
 *   3) filterUnseen(items) → { fresh, skipped, stats } — แยกใบที่ยังไม่เคยเจอออกจากใบซ้ำในตำรา
 *   4) markSeen(items, meta) — จารึกลิงก์ที่ผ่านด่าน/ถูกตัดสินแล้ว รอบหน้าจะได้ skip ไม่จ่ายซ้ำ
 * 🔴 leaf module — ห้าม import โมดูลโต๊ะข่าวอื่น (กัน import วน) ใช้แค่ crypto + persistStore
 * 🔴 kill-switch DESK_SEEN_BOOK — default = เปิด (ตัวประหยัด) · สั่งปิดได้ด้วย '0' / 'false' / 'off' / 'no'
 *   (ตัวพิมพ์เล็ก-ใหญ่ไม่สำคัญ) → filterUnseen คืน fresh ทุกใบ / markSeen เป็น no-op
 * 🔴 fail-open ทุกจุด — คลังพัง = ถือว่ายังไม่เคยเจอแล้วเดินต่อ ห้าม throw (ตำราพังห้ามลากโต๊ะข่าวลงด้วย)
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';

const STORE_NAME = 'news-desk-seen';
const DEFAULT_DAYS = 30;   // อายุความจำ default — ข่าวเก่ากว่านี้ให้เข้าใหม่ได้
const DEFAULT_MAX = 20000; // เพดานเล่ม default — เกินตัดใบเก่าสุดทิ้ง กันคลังบวม
const DAY_MS = 86400e3;
const WRITE_CHUNK = 200;   // เขียนทีละก้อน — ก้อนพังไม่ลากทั้งรอบ (ดูเหตุผลที่จุดเขียน)

// อ่าน env ทุกครั้งที่ถูกเรียก (ไม่ cache ตอน load) — สลับค่าระหว่างรอบได้โดยไม่ต้องรีสตาร์ท
const _days = () => Math.max(1, Number(process.env.DESK_SEEN_DAYS) || DEFAULT_DAYS);
const _max = () => Math.max(1, Number(process.env.DESK_SEEN_MAX) || DEFAULT_MAX);
// คง default = เปิด (ตัวประหยัด) — รับคำสั่งปิดกว้าง: '0' / 'false' / 'off' / 'no' (ตัวพิมพ์เล็ก-ใหญ่ไม่สำคัญ)
const _isOff = () => ['0', 'false', 'off', 'no'].includes(String(process.env.DESK_SEEN_BOOK ?? '').trim().toLowerCase());

// query ขยะจากแพลตฟอร์ม/ตัวส่งต่อ — เรื่องเดียวกันลิงก์คนละสี ต้องออกมาคีย์เดียวกัน
const JUNK_PARAM = /^(utm_.+|fbclid|gclid)$/i;

function _urlOf(item) {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') return String(item.url || item.link || '').trim();
  return '';
}

/** ล้างลิงก์ให้อยู่รูปเดียวกัน — ลิงก์เดียวกันต้อง normalize แล้วเท่ากันเป๊ะ */
export function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (JUNK_PARAM.test(key)) u.searchParams.delete(key);
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = u.port ? `:${u.port}` : '';
    const path = u.pathname.replace(/\/+$/, ''); // ตัด trailing slash (root '/' → '')
    return `${u.protocol}//${host}${port}${path}${u.search}${u.hash}`;
  } catch {
    // ลิงก์พัง/ไม่ครบ — fail-open: คืนของเดิมที่ตัดช่องว่าง+slash ท้ายแล้ว (ยังคีย์ได้ ห้ามทิ้งข่าว)
    return raw.replace(/\/+$/, '');
  }
}

/** คีย์เล่ม = md5 12 ตัวแรกของลิงก์ที่ล้างแล้ว (สั้น ชนกันยากพอสำหรับเพดาน 2 หมื่นใบ) */
export function linkKey(url) {
  return crypto.createHash('md5').update(normalizeUrl(url)).digest('hex').slice(0, 12);
}

/**
 * 🔴 id ที่ใช้ "ในคลัง" ต้องมีคำนำหน้า sn_ (2 ส.ค. 69 — เจอจากล็อกเซิร์ฟเวอร์จริง)
 * ตาราง store_items มี PK ที่ id เดี่ยว (ไม่ใช่ id+store_name) → linkKey(url) เปล่าๆ ชนกับ
 * id การ์ดบนโต๊ะที่ใช้ md5(url) 12 ตัวเหมือนกัน → insert ทั้งชุดถูกปฏิเสธ
 * ("duplicate key value violates unique constraint store_items_pkey") แล้ว addMany ตีความว่า
 * "ซ้ำ = ข้ามได้" → ตำราว่างเปล่าเงียบๆ ทั้งที่ทุกอย่างดูสำเร็จ
 * (บทเรียนเดียวกับคลังขยะที่ต้องใช้คำนำหน้า 'jk_' ด้วยเหตุผลเดียวกัน)
 */
export function seenRowId(url) {
  return `sn_${linkKey(url)}`;
}

const _ts = (rec) => Date.parse(rec?.lastSeenAt || rec?.firstSeenAt || 0) || 0;

/** คัดเล่ม: ตัดใบหมดอายุ + เกินเพดานตัดเก่าสุด → { kept, dead } */
function _prune(entries, nowMs) {
  const ttlMs = _days() * DAY_MS;
  const kept = [], dead = [];
  for (const e of entries) {
    (nowMs - _ts(e) < ttlMs ? kept : dead).push(e);
  }
  const over = kept.length - _max();
  if (over > 0) {
    kept.sort((a, b) => _ts(a) - _ts(b)); // เก่าสุดขึ้นหัวแถว
    dead.push(...kept.splice(0, over));
  }
  return { kept, dead };
}

/**
 * แยกใบที่ยังไม่เคยเจอ (fresh) ออกจากใบซ้ำตำรา (skipped)
 * ใบไม่มีลิงก์/คีย์ไม่ได้ → นับเป็น fresh เสมอ (ห้ามทิ้งข่าวด้วยมือตัวเอง)
 */
export async function filterUnseen(items) {
  const list = Array.isArray(items) ? items : [];
  const stats = { total: list.length, fresh: 0, skipped: 0, book: 0, live: 0, disabled: _isOff() };
  if (stats.disabled) {
    stats.fresh = list.length;
    return { fresh: [...list], skipped: [], stats };
  }
  let entries = [];
  try {
    entries = (await createStore(STORE_NAME).getAll()) || [];
  } catch (e) {
    console.warn(`[SeenBook] อ่านตำราพัง (${String(e.message || e).slice(0, 60)}) — fail-open ถือว่าทุกใบยังไม่เคยเจอ`);
    entries = [];
  }
  const now = Date.now();
  const ttlMs = _days() * DAY_MS;
  const live = new Set();
  for (const e of entries) {
    if (e && e.id && now - _ts(e) < ttlMs) live.add(e.id);
  }
  const fresh = [], skipped = [];
  for (const item of list) {
    const url = _urlOf(item);
    if (!url) { fresh.push(item); continue; }
    (live.has(seenRowId(url)) ? skipped : fresh).push(item);
  }
  stats.fresh = fresh.length;
  stats.skipped = skipped.length;
  stats.book = entries.length;
  stats.live = live.size;
  return { fresh, skipped, stats };
}

/**
 * จารึกลิงก์ลงตำรา — เรียกหลังใบนั้นผ่านด่านกันซ้ำเดิม (หรือหลัง AI ตัดสินใบนั้นแล้ว)
 * meta = บริบทของรอบนั้น เช่น { round, verdict } — ใบซ้ำจะอัปเดต lastSeenAt + นับ hits แทนสร้างใหม่
 */
export async function markSeen(items, meta) {
  const res = { marked: 0, added: 0, updated: 0, evicted: 0, errors: 0, disabled: _isOff() };
  const list = Array.isArray(items) ? items : [];
  if (res.disabled || list.length === 0) return res;
  try {
    const store = createStore(STORE_NAME);
    let existing = [];
    try { existing = (await store.getAll()) || []; } catch { existing = []; } // fail-open: อ่านไม่ได้ = เล่มว่าง
    const nowIso = new Date().toISOString();
    const byId = new Map();
    for (const e of existing) if (e && e.id) byId.set(e.id, e);
    const adds = [], updates = [];
    for (const item of list) {
      const url = _urlOf(item);
      if (!url) continue;
      const key = seenRowId(url);
      const ex = byId.get(key);
      if (ex) {
        const merged = { ...ex, lastSeenAt: nowIso, hits: (ex.hits || 1) + 1 };
        if (meta != null) merged.meta = meta;
        byId.set(key, merged);
        updates.push(merged);
      } else {
        const rec = { id: key, url: normalizeUrl(url), firstSeenAt: nowIso, lastSeenAt: nowIso, hits: 1 };
        if (meta != null) rec.meta = meta;
        byId.set(key, rec);
        adds.push(rec);
      }
      res.marked++;
    }
    // คัดเล่มทุกครั้งที่เขียน: ตัดหมดอายุ + เกินเพดานไล่เก่าสุดออก
    const { kept, dead } = _prune([...byId.values()], Date.now());
    const keptIds = new Set(kept.map(e => e.id));
    const existingIds = new Set(existing.filter(e => e && e.id).map(e => e.id));
    const deadInStore = dead.filter(d => existingIds.has(d.id)); // ใบใหม่ที่โดนคัด = แค่ไม่เขียน ไม่ต้องลบ
    const finalAdds = adds.filter(a => keptIds.has(a.id));
    const finalUpdates = updates.filter(u => keptIds.has(u.id));
    // เขียน — ห่อ try ทุกชุด ชุดพังไม่ลากทั้งรอบ (fail-open)
    // ★ 2 ส.ค. 69 (บทเรียนจากของจริง): เขียนทีละก้อน ไม่ยิงรวดเดียวทั้งรอบ
    //   คลังกลางเป็น insert ก้อนเดียว = ชนกุญแจใบเดียว "ทั้งก้อนไม่ถูกเขียน" แล้วถูกกลืนเป็น
    //   "ซ้ำ = ข้ามได้" → ตำราว่างเงียบๆ · ก้อนละ 200 + ถ้าก้อนพังค่อยลงมือทีละใบ
    //   (ยอมช้าขึ้นนิดในกรณีพัง ดีกว่าเสียทั้งรอบแบบไม่รู้ตัว)
    for (let i = 0; i < finalAdds.length; i += WRITE_CHUNK) {
      const chunk = finalAdds.slice(i, i + WRITE_CHUNK);
      try {
        await store.addMany(chunk);
        res.added += chunk.length;
      } catch (e) {
        console.warn(`[SeenBook] เขียนก้อน ${chunk.length} ใบพัง (${String(e.message || e).slice(0, 50)}) — ลงมือทีละใบแทน`);
        for (const one of chunk) {
          try { await store.add(one); res.added++; }
          catch (e2) { res.errors++; }
        }
      }
    }
    for (const u of finalUpdates) {
      try { await store.update(u.id, u); res.updated++; }
      catch (e) { res.errors++; console.warn(`[SeenBook] update ${u.id} พัง: ${String(e.message || e).slice(0, 60)}`); }
    }
    for (const d of deadInStore) {
      try { await store.remove(d.id); res.evicted++; }
      catch (e) { res.errors++; console.warn(`[SeenBook] remove ${d.id} พัง: ${String(e.message || e).slice(0, 60)}`); }
    }
    return res;
  } catch (e) {
    // fail-open ชั้นสุดท้าย: ตำราล้มทั้งใบ ห้ามลากงานโต๊ะข่าวพังไปด้วย
    console.warn(`[SeenBook] markSeen ล้มทั้งรอบ (ไม่ throw): ${String(e.message || e).slice(0, 60)}`);
    res.errors++;
    return res;
  }
}
