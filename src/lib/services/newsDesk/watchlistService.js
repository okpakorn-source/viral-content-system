/**
 * =====================================================
 * 👁️ Living Watchlist — ทะเบียนคนที่ "พิสูจน์แล้วว่าคนตาม" (2 ก.ค. 69)
 * =====================================================
 * ที่มา: ทะเบียนดาราเดิม (CELEB_REGISTRY ~190 ชื่อ) เป็นลิสต์ตายตัว — คนที่เพิ่งดัง/คนที่เพจโพสต์แล้วปังจริง
 *   ไม่ถูกเพิ่มเข้าเอง · watchlist นี้ "โตเอง" จาก 2 สัญญาณ:
 *   • ทีมกด 🔥 ปังจริง (Discord/เว็บ)  → น้ำหนัก +3 (พิสูจน์ด้วยผลจริง)
 *   • ทีมส่งข่าวเข้าไลน์เขียน (sendWorkflow) → น้ำหนัก +1 (รสนิยมทีม)
 * ทุกรอบ harvest หมุนชื่อ × มุมน้ำดี → ยิงคำค้น (เกาะคนที่พิสูจน์แล้ว ไม่ใช่เดา)
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';

const CAP = 120; // เก็บสูงสุด — เกินแล้วตัดตัวคะแนนต่ำ/เก่าสุด
const idOf = (name) => 'wl_' + crypto.createHash('md5').update(String(name)).digest('hex').slice(0, 10);

async function getStore() { return createStore('desk-watchlist'); }

export async function getWatchlist() {
  try { return (await (await getStore()).getAll()).filter(w => w.id !== '_meta'); } catch { return []; }
}

/**
 * ดึงชื่อบุคคลจากพาดหัว (gpt-4o-mini ~฿0.02) → upsert เข้า watchlist
 * @param {string} title - พาดหัวข่าวที่ปัง/ถูกส่งทำ
 * @param {'viral'|'sent'} from - แหล่งสัญญาณ (viral หนักกว่า)
 */
export async function addFromTitle(title, from = 'sent') {
  const t = String(title || '').trim();
  if (t.length < 8) return { added: 0 };
  let names = [];
  try {
    const res = await callAI({
      prompt: `จากพาดหัวข่าวไทยนี้ ดึง "ชื่อบุคคล/ฉายาที่ระบุตัวได้" (ดารา คนดัง หรือชาวบ้านที่มีชื่อ-ฉายาให้ตามต่อได้)
พาดหัว: ${t.slice(0, 160)}
ตอบ JSON เท่านั้น: {"names":["ชื่อ/ฉายา"]}
- เอาเฉพาะชื่อคนจริง (เช่น "พี่หนุ่ม กรรชัย", "ต่าย อรทัย", "ป้าขยัน") — ไม่เอาชื่อสถานที่/รายการ/บริษัท/หน่วยงาน
- ชื่อยาว 3-30 ตัวอักษร · ไม่มีชื่อคนเลย = {"names":[]}`,
      model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 200,
    });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    names = (parsed?.names || []).map(n => String(n).trim()).filter(n => n.length >= 3 && n.length <= 30).slice(0, 4);
  } catch (e) {
    console.log('[Watchlist] extract ล่ม (ข้าม):', e.message?.slice(0, 40));
    return { added: 0 };
  }
  if (!names.length) return { added: 0 };

  const store = await getStore();
  const all = await store.getAll();
  const weight = from === 'viral' ? 3 : 1;
  const now = new Date().toISOString();
  let added = 0;
  for (const name of names) {
    const id = idOf(name);
    const ex = all.find(w => w.id === id);
    if (ex) {
      await store.update(id, (e) => ({ ...e, count: (e.count || 0) + weight, lastSeenAt: now })).catch(() => {});
    } else {
      await store.add({ id, name, count: weight, from, addedAt: now, lastSeenAt: now }).catch(() => {});
      added++;
    }
  }
  // เกินเพดาน → ตัดตัวอ่อนสุด (คะแนนต่ำ+เก่าสุด) — watchlist ต้อง "สด" เสมอ
  try {
    const fresh = (await store.getAll()).filter(w => w.id !== '_meta');
    if (fresh.length > CAP) {
      fresh.sort((a, b) => ((a.count || 0) - (b.count || 0)) || (new Date(a.lastSeenAt || 0) - new Date(b.lastSeenAt || 0)));
      for (const w of fresh.slice(0, fresh.length - CAP)) await store.remove(w.id).catch(() => {});
    }
  } catch { /* ตัดไม่ได้ไม่เป็นไร */ }
  if (added || names.length) console.log(`[Watchlist] 👁️ ${from === 'viral' ? '🔥' : '📤'} ${names.join(', ')} (ใหม่ ${added})`);
  return { added, names };
}

// มุมค้นคู่ชื่อ — หมุนตามชั่วโมง (แนวเดียวกับ GOOD_DEED เดิมแต่สั้น เน้นความเคลื่อนไหว+น้ำดี)
const WATCH_ANGLES = ['ล่าสุด', 'เปิดใจ ล่าสุด', 'ทำบุญ ช่วยเหลือ', 'กตัญญู ครอบครัว', 'ข่าวดี ล่าสุด'];

/**
 * คำค้นจาก watchlist ของรอบนี้ — หมุนชื่อ (ถ่วงด้วยคะแนน: ตัวท็อปโผล่บ่อยกว่า) × มุม
 * @returns {Array<{q:string, category?:string}>} ป้อนเข้า runGroup ของ harvester ได้เลย
 */
export async function getWatchlistQueries(n = 3) {
  const list = await getWatchlist();
  if (!list.length) return [];
  // เรียงคะแนน (count หลัก + ความสดรอง) → ครึ่งบนของลิสต์เท่านั้นที่ถูกหมุน (ตัวท็อปได้รอบบ่อย)
  list.sort((a, b) => ((b.count || 0) - (a.count || 0)) || (new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0)));
  const pool = list.slice(0, Math.max(6, Math.ceil(list.length / 2)));
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const w = pool[(slot * n + i) % pool.length];
    // ★ เทสจริง 2 ก.ค.: "ชื่อ"+มุมเจาะ ใน /news แคบเกิน (คืน 0) — ใบแรก = "ล่าสุด" (กว้าง เจอจริง) · มุมเจาะเป็นตัวเสริมใบถัดไป
    const angle = i === 0 ? 'ล่าสุด' : WATCH_ANGLES[(slot + i) % WATCH_ANGLES.length];
    out.push({ q: `"${w.name}" ${angle}` });
  }
  return out;
}
