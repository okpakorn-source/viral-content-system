/**
 * 💓 workerHeartbeat — จับว่า "เครื่องทีมยังเปิดอยู่ไหม" (26 ส.ค. 69)
 *
 * เจ้าของสั่ง: "ทุกช่องทางถอดเครื่องทีมปุ่มเดียว · เครื่องทีมปิดค่อยถอดสำรองบน Vercel เฉพาะอันที่ถอดได้"
 * → หน้าเว็บต้องรู้ก่อนกดว่าเครื่องทีมพร้อมไหม
 *
 * วิธี: clip-worker วนขอclaim งานทุก 5 วิอยู่แล้ว (แม้คิวว่าง) → ใช้จังหวะนั้นแตะชีพจร
 * ⚠️ กันเปลืองโควตา DB: เขียนอย่างมากทุก WRITE_EVERY_MS (ไม่ใช่ทุก 5 วิ)
 * ⚠️ ห้ามพังทับงานหลัก — ทุกฟังก์ชันกลืน error เงียบ (ชีพจรพลาด ≠ คิวพัง)
 *
 * เก็บเป็นแถวพิเศษใน store 'clip-jobs' (id คงที่) — โค้ดคิวข้ามแถวนี้เพราะไม่มี status ที่ claim ได้
 */
import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

const STORE_NAME = 'clip-jobs';
const TABLE = 'store_items';
export const HEARTBEAT_ID = '__clip_worker_heartbeat__';
const WRITE_EVERY_MS = 60000;    // เขียนจริงอย่างมากนาทีละครั้ง
export const ALIVE_WINDOW_MS = 150000; // ไม่แตะชีพจรเกิน 2.5 นาที = ถือว่าเครื่องทีมปิด

let lastWriteAt = 0; // กันเขียนรัวในโปรเซสเดียวกัน (ชั้นแรก ราคาถูกสุด)

/** เรียกตอน worker มาขอclaim — คืนทันที ไม่ทำให้ผู้เรียกช้า */
export function touchWorkerHeartbeat(meta = {}) {
  const now = Date.now();
  if (now - lastWriteAt < WRITE_EVERY_MS) return;
  lastWriteAt = now;
  // ยิงแบบไม่รอผล — ชีพจรไม่ใช่งานหลัก
  (async () => {
    try {
      const nowIso = new Date(now).toISOString();
      const payload = {
        id: HEARTBEAT_ID,
        lastSeenAt: nowIso,
        host: String(meta.host || '').slice(0, 60),
        version: String(meta.version || '').slice(0, 40),
      };
      // ★ 25 ต.ค. 69 (P1): เขียนแถวเดียวตรงๆ — เดิม getAll ทั้งคิว (รวมผลถอดเต็ม ~4.7 MB) ทุกนาทีเพื่อหาแถวนี้แถวเดียว
      if (isSupabaseReady()) {
        const sb = getSupabase();
        const { data, error } = await sb.from(TABLE)
          .update({ data: payload, updated_at: nowIso })
          .eq('id', HEARTBEAT_ID)
          .eq('store_name', STORE_NAME)
          .select('id');
        if (error) return;
        if (!data?.length) {
          await sb.from(TABLE).insert({ id: HEARTBEAT_ID, store_name: STORE_NAME, data: payload, created_at: nowIso, updated_at: nowIso });
        }
        return;
      }
      const store = createStore(STORE_NAME); // ไม่มี Supabase (เครื่อง dev) = ทางไฟล์เดิม
      const all = await store.getAll();
      const row = (all || []).find((x) => x && x.id === HEARTBEAT_ID);
      if (row) await store.update(HEARTBEAT_ID, () => payload);
      else await store.add(payload);
    } catch { /* ชีพจรพลาดไม่กระทบคิว */ }
  })();
}

/** ★ 25 ต.ค. 69 (P1): อ่านแถวชีพจรแถวเดียว สำหรับผู้เรียกที่ไม่ได้โหลดทั้งคิวแล้ว (คืน null = อ่านไม่ได้/ไม่มี) */
export async function readWorkerHeartbeatRow() {
  try {
    if (isSupabaseReady()) {
      const { data, error } = await getSupabase().from(TABLE)
        .select('data')
        .eq('id', HEARTBEAT_ID)
        .eq('store_name', STORE_NAME)
        .maybeSingle();
      if (error) return null;
      return data?.data || null;
    }
    const all = await createStore(STORE_NAME).getAll();
    return (all || []).find((x) => x && x.id === HEARTBEAT_ID) || null;
  } catch { return null; }
}

/** อ่านสถานะเครื่องทีมจากรายการงานที่โหลดมาแล้ว (ไม่ยิง DB ซ้ำ) */
export function readWorkerStatus(allJobs) {
  const row = (allJobs || []).find((x) => x && x.id === HEARTBEAT_ID);
  const t = row ? Date.parse(row.lastSeenAt || '') : NaN;
  if (!Number.isFinite(t)) {
    return { alive: false, lastSeenAt: null, secondsAgo: null, known: false };
  }
  const secondsAgo = Math.max(0, Math.round((Date.now() - t) / 1000));
  return {
    alive: Date.now() - t < ALIVE_WINDOW_MS,
    lastSeenAt: row.lastSeenAt,
    secondsAgo,
    known: true,
    host: row.host || '',
  };
}

/** แถวชีพจรไม่ใช่ใบงาน — ตัวไหนวนรายการงานต้องกรองออก */
export function isHeartbeatRow(x) { return !!x && x.id === HEARTBEAT_ID; }
