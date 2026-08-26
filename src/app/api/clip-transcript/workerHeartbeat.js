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

const STORE_NAME = 'clip-jobs';
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
      const store = createStore(STORE_NAME);
      const all = await store.getAll();
      const row = (all || []).find((x) => x && x.id === HEARTBEAT_ID);
      const payload = {
        id: HEARTBEAT_ID,
        lastSeenAt: new Date(now).toISOString(),
        host: String(meta.host || '').slice(0, 60),
        version: String(meta.version || '').slice(0, 40),
      };
      if (row) await store.update(HEARTBEAT_ID, () => payload);
      else await store.add(payload);
    } catch { /* ชีพจรพลาดไม่กระทบคิว */ }
  })();
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
