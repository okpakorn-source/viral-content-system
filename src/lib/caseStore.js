// ============================================================
// [ระบบทำปกออโต้ → copy เข้า repo ไวรัล 5 ก.ค. 2026] คลังผลลัพธ์การวิเคราะห์
// ------------------------------------------------------------
// เก็บทุกผลวิเคราะห์เป็นเคส (AC-0001, AC-0002, ...) — ต่อท้ายเสมอ ไม่ทับของเก่า
// ★ deviation เดียวจากต้นฉบับ (ผู้ใช้อนุมัติหลักการ): ไส้เก็บเปลี่ยนจากไฟล์
//   data/analysis-cases.json → Supabase store_items (store_name='acs-cases')
//   เพราะ Vercel ไม่มีดิสก์ถาวร · ไม่มี Supabase → fallback ไฟล์แบบต้นฉบับเป๊ะ
//   ทุก function ชื่อ/พารามิเตอร์/ค่าที่คืน ตรงต้นฉบับ 100%
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { resilientFetch } from './supabase.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'analysis-cases.json');
const STORE_NAME = 'acs-cases';
const TABLE = 'store_items';

let _sb = null;
function sb() {
  if (_sb !== null) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  _sb = url && key ? createClient(url, key, { global: { fetch: resilientFetch } }) : false;
  return _sb;
}

// ตัดอักขระ surrogate เดี่ยว (จาก copy-paste เพี้ยน) — JSON ที่มีตัวพวกนี้ทำ Postgres reject ทั้งก้อน
function cleanStr(s) {
  return typeof s === 'string'
    ? s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1')
    : s;
}

// ===== fs fallback (โค้ดต้นฉบับเป๊ะ) =====
async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(STORE_FILE); } catch { await fs.writeFile(STORE_FILE, '[]', 'utf8'); }
}
async function fsReadCases() {
  await ensureFile();
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function readCases() {
  const c = sb();
  if (!c) return fsReadCases();
  const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME).order('created_at', { ascending: true });
  if (error) throw new Error('อ่านคลังเคสไม่สำเร็จ: ' + error.message);
  return (data || []).map((r) => r.data).filter(Boolean);
}

function nextId(cases) {
  // นับจากเลขสูงสุด (ทนต่อการลบ) — ต้นฉบับใช้ length+1
  const nums = cases.map((c) => parseInt(String(c.id).match(/^AC-(\d+)$/)?.[1] || '0', 10));
  const n = Math.max(0, ...nums) + 1;
  return 'AC-' + String(n).padStart(4, '0');
}

// เพิ่มเคสใหม่ คืนเคสที่บันทึกแล้ว (พร้อม id + createdAt)
export async function addCase({ newsText, analysis, meta }) {
  const cases = await readCases();
  const record = {
    id: nextId(cases),
    createdAt: new Date().toISOString(),
    newsText: cleanStr(newsText),
    newsSnippet: cleanStr((newsText || '').replace(/\s+/g, ' ').trim().slice(0, 120)),
    analysis,
    meta: meta || {},
  };
  const c = sb();
  if (!c) {
    cases.push(record);
    await fs.writeFile(STORE_FILE, JSON.stringify(cases, null, 2), 'utf8');
    return record;
  }
  const { error } = await c.from(TABLE).insert({ id: record.id, store_name: STORE_NAME, data: record, created_at: record.createdAt, updated_at: record.createdAt });
  if (error) throw new Error('บันทึกเคสไม่สำเร็จ: ' + error.message);
  return record;
}

// ดึงเคสเดียวตาม id
export async function getCase(id) {
  const c = sb();
  if (!c) {
    const cases = await fsReadCases();
    return cases.find((x) => x.id === id) || null;
  }
  const { data, error } = await c.from(TABLE).select('data').eq('store_name', STORE_NAME).eq('id', id).maybeSingle();
  if (error) throw new Error('อ่านเคสไม่สำเร็จ: ' + error.message);
  return data?.data || null;
}

// อัปเดตเคส (merge patch ทับ) — ใช้ตอนแนบผลขั้นถัดไป เช่น keywords
export async function updateCase(id, patch) {
  const c = sb();
  if (!c) {
    const cases = await fsReadCases();
    const idx = cases.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    cases[idx] = { ...cases[idx], ...patch };
    await fs.writeFile(STORE_FILE, JSON.stringify(cases, null, 2), 'utf8');
    return cases[idx];
  }
  const cur = await getCase(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch };
  const { error } = await c.from(TABLE).update({ data: merged, updated_at: new Date().toISOString() }).eq('store_name', STORE_NAME).eq('id', id);
  if (error) throw new Error('อัปเดตเคสไม่สำเร็จ: ' + error.message);
  return merged;
}

// รายการล่าสุด (ย่อ) สำหรับแสดงในหน้า UI
export async function listRecent(limit = 20) {
  const cases = await readCases();
  return cases
    .slice(-limit)
    .reverse()
    .map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      newsSnippet: c.newsSnippet,
      headline: c.analysis?.headline || '',
      tone: c.analysis?.context?.emotional_tone || '',
    }));
}
