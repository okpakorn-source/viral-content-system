import { setTimeout as delay } from 'node:timers/promises';
import { isSupabaseReady } from '@/lib/supabase';

/**
 * อ่าน "แถวเดียว" จาก store ให้ถูกกับโหมดที่รันอยู่ (Fable 8 ก.ย. 69 — กัน egress Supabase พุ่ง)
 *   Supabase (เครื่องแอดมิน/Vercel): findById = select แถวเดียว สดทุกครั้ง — ไม่ดึงทั้งตาราง
 *     (clip-jobs ~0.9 MB · clip-insights ~9 MB ต่อการอ่าน 1 ครั้ง; long-poll ทุก 2 วิ จะทะลุหลายสิบ MB/คำขอ)
 *     ⚠️ findById โหมด Supabase คืน null ทั้ง "ไม่มีแถว" และ "อ่านพัง" (persistStore.js กลืน error)
 *        → null รอบแรกลองซ้ำอีก 1 ครั้งหลังพักสั้นๆ กันสะดุดชั่วคราวกลายเป็น 404 (ผู้เรียก status ยังมีด่านกันอีกชั้น)
 *   ไฟล์ (แล็บ/เทส): findById โหมดไฟล์อ่านจาก cache ค้าง มองไม่เห็นที่ worker อีกโปรเซสเขียน
 *     → ต้อง getAll({authoritative:true}) อ่านไฟล์จริง (ถูก เพราะอยู่ในเครื่องเดียวกัน)
 *   persistStore.js เป็นไฟล์ล็อก จึงเลือกโหมดจากตรงนี้แทนการแก้ store
 */
export async function readRowFresh(store, id, { supabase = isSupabaseReady(), retryDelayMs = 300 } = {}) {
  if (!id) return null;
  if (supabase) {
    const first = await store.findById(id);
    if (first) return first;
    if (retryDelayMs > 0) await delay(retryDelayMs);
    return (await store.findById(id)) ?? null;
  }
  const all = await store.getAll({ authoritative: true });
  return (Array.isArray(all) ? all : []).find((row) => row && row.id === id) ?? null;
}
