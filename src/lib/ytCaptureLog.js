// ============================================================
// ★ 9 ก.ค. 2026 (เฟส 1 แก้แคปเฟรม YouTube ล้ม) — log รายรอบแคปเฟรม
// ------------------------------------------------------------
// เดิม: S5e/route รายงานแค่ "แคปได้ N เฟรม" แต่ไม่รู้ว่าคลิปไหนถูกเลือก/
//   ตัวไหนโดนเพดานเวลาตัดทิ้ง/เฟรมสะอาดจริงกี่ใบ → ย้อนสืบไม่ได้เวลาปกพัง
// เก็บสรุปรายรอบ (ต่อเคส) ดูย้อนหลังได้ทั้งบนเว็บและเครื่องทีม
// เก็บ Supabase store_items (store 'acs-yt-capture-log') — fallback ไฟล์ data/yt-capture-log.json
// เก็บล่าสุด MAX_ENTRIES รอบ (prune อัตโนมัติ กันบวม)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const STORE_NAME = 'acs-yt-capture-log';
const TABLE = 'store_items';
const FILE = path.join(process.cwd(), 'data', 'yt-capture-log.json');
const MAX_ENTRIES = parseInt(process.env.YT_CAPTURE_LOG_MAX || '200', 10);

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key) : false;
  return _sb;
}

async function fsReadAll() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}
async function fsWriteAll(entries) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(entries, null, 2), 'utf8');
}

// บันทึกสรุป 1 รอบแคปเฟรม — ล้มไม่กระทบสายพาน (caller ห่อ try/catch เอง แต่กันไว้ 2 ชั้น)
export async function logCapture(entry) {
  const rec = {
    id: 'ytc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    ...entry,
  };
  const c = sb();
  if (!c) {
    const all = await fsReadAll();
    all.push(rec);
    await fsWriteAll(all.slice(-MAX_ENTRIES));
    return rec;
  }
  const now = new Date().toISOString();
  const { error } = await c
    .from(TABLE)
    .upsert({ id: rec.id, store_name: STORE_NAME, data: rec, updated_at: now }, { onConflict: 'id' });
  if (error) throw new Error('บันทึก capture-log ไม่สำเร็จ: ' + error.message);
  return rec;
}

// ดูย้อนหลัง — เรียงใหม่สุดก่อน, กรองตามเคสได้
export async function listCaptureLog({ caseId = null, limit = 50 } = {}) {
  const c = sb();
  let all;
  if (!c) {
    all = await fsReadAll();
  } else {
    const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME);
    if (error) throw new Error('อ่าน capture-log ไม่สำเร็จ: ' + error.message);
    all = (data || []).map((r) => r.data).filter(Boolean);
  }
  all.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const filtered = caseId ? all.filter((e) => e.caseId === caseId) : all;
  return filtered.slice(0, limit);
}
