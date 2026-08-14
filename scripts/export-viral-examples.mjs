// ★ 14 ส.ค. 69 (สูตรแสนไลก์) — ส่งออกคลังครูตัวจริงจากตาราง viral_examples แบบ "อ่านอย่างเดียว"
//   ใช้คู่กับ scripts/match-real-likes.mjs ผ่าน MATCH_LIBRARY_FILE · ห้ามมีการเขียน Supabase ในไฟล์นี้
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_hits-formula-workspace', 'viral-examples-export.json');

// อ่านกุญแจจาก .env.local ตรงๆ (สคริปต์ CLI ไม่ผ่าน next จึงไม่มี env อัตโนมัติ)
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const pick = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const url = pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL');
const key = pick('SUPABASE_SERVICE_KEY') || pick('SUPABASE_SERVICE_ROLE_KEY') || pick('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!url || !key) { console.error('ไม่พบกุญแจ Supabase ใน .env.local'); process.exit(1); }

const res = await fetch(`${url}/rest/v1/viral_examples?select=id,title,content,category,engagement_likes&limit=500`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error('ดึงล้ม:', res.status, (await res.text()).slice(0, 120)); process.exit(1); }
const rows = await res.json();
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
const cats = {};
rows.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + 1; });
console.log(`ส่งออก ${rows.length} ใบ → ${OUT}`);
console.log('หมวด:', Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(' '));
