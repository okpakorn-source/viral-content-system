/**
 * =====================================================
 * 🧬 DNA Queries — ป้อนคำค้นจากคลัง DNA ให้ "ทุกเลน" ใช้ร่วมกัน (4 ก.ค. 69)
 * =====================================================
 * โจทย์ผู้ใช้: ทุกเลน (ลิงก์/คลิป/ทุกแพลตฟอร์ม) ต้องค้นเหมือนกัน จากดีเอ็นเอแนวข่าวเดียวกัน
 * ที่มาคำค้น: dnaExtractor เก็บไว้ที่ store 'desk-dna' (id 'latest') — สกัดจากโพสต์จริงของเพจ
 *   แต่ละแนวมี weight (ความปัง) → ถ่วงน้ำหนัก: แนวปังโผล่บ่อยกว่า
 * cache 10 นาที (ไม่อ่าน store ทุกครั้ง) · ไม่มี DNA = คืน [] (harvester ใช้คลัง manual เดิมต่อ ไม่พัง)
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */
import { createStore } from '@/lib/persistStore';

let _cache = { at: 0, dna: null };
async function loadDna() {
  if (Date.now() - _cache.at < 10 * 60 * 1000) return _cache.dna;
  try { _cache = { at: Date.now(), dna: (await createStore('desk-dna').getAll()).find(x => x.id === 'dna_latest') || null }; }
  catch { _cache = { at: Date.now(), dna: null }; }
  return _cache.dna;
}

// สร้าง "สระคำค้นถ่วงน้ำหนัก" — แนว weight สูงใส่ซ้ำมากขึ้น (โผล่บ่อยกว่าตอนหมุน)
function weightedPool(themes, key) {
  const pool = [];
  for (const t of (themes || [])) {
    const qs = t[key] || [];
    const reps = Math.max(1, Math.round((t.weight || 5) / 3)); // weight 10→3 รอบ, 5→2, 3→1
    for (const q of qs) for (let r = 0; r < reps; r++) pool.push({ q, category: t.category || '' });
  }
  return pool;
}

/** หมุนคำค้นจากสระ ตาม slot เวลา (ไม่ซ้ำในรอบ) */
function rotate(pool, n, salt = 0) {
  if (!pool.length) return [];
  const slot = Math.floor(Date.now() / 3600e3) + salt;
  const seen = new Set(); const out = [];
  for (let i = 0; out.length < n && i < pool.length * 2; i++) {
    const x = pool[(slot * n + i) % pool.length];
    if (seen.has(x.q)) continue; seen.add(x.q); out.push(x);
  }
  return out;
}

/** 📰 คำค้นบทความ (news/broad/exa) จาก DNA — [{q, category}] */
export async function dnaNewsQueries(n = 14) {
  const dna = await loadDna();
  if (!dna?.themes?.length) return [];
  return rotate(weightedPool(dna.themes, 'newsQueries'), n, 0);
}

/** 🎬 คำค้นคลิปทุกแพลตฟอร์ม จาก DNA — [{q, platform, category, lane:'clip'}] */
export async function dnaClipQueries(perPlatform = 3) {
  const dna = await loadDna();
  if (!dna?.themes?.length) return [];
  const platforms = ['youtube', 'tiktok', 'instagram', 'reels', 'facebook'];
  const pool = weightedPool(dna.themes, 'clipQueries');
  const out = [];
  platforms.forEach((platform, pi) => {
    for (const { q, category } of rotate(pool, perPlatform, pi * 7)) out.push({ q, platform, category, lane: 'clip' });
  });
  return out;
}

/** ให้ค้นด้วยชื่อคน (watchlist) แนบ "มุม DNA" — ใช้ต่อยอดภายหลัง */
export async function hasDna() {
  const dna = await loadDna();
  return !!(dna?.themes?.length);
}
