/**
 * 🏷️ สร้าง/รีเฟรช "ป้ายสาระ" การ์ดพร้อมท์ทุกใบ → data/card-essences.json
 * ใช้เมื่อ: เพิ่ม/แก้การ์ดในคลัง แล้วอยากให้สารบัญ 201 ใบคมเหมือนเดิม
 * รัน: node scripts/build-card-essences.mjs        (เฉพาะใบที่ยังไม่มีป้าย)
 *      node scripts/build-card-essences.mjs --all  (ทำใหม่ทุกใบ)
 * ค่าใช้จ่าย ~฿1 ต่อการทำครบ 201 ใบ (gpt-5.6-luna แบตช์ละ 20)
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const envRaw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const KEY = (envRaw.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error('ไม่พบ OPENAI_API_KEY ใน .env.local'); process.exit(1); }

const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/prompt-library.json'), 'utf8'));
const cards = (Array.isArray(lib) ? lib : (lib.items || [])).filter(c => c.id && c.promptText);
const essFile = path.join(ROOT, 'data/card-essences.json');
const redoAll = process.argv.includes('--all');
let essences = {};
if (!redoAll && fs.existsSync(essFile)) { try { essences = JSON.parse(fs.readFileSync(essFile, 'utf8')); } catch {} }

const missing = cards.filter(c => !essences[c.id]);
if (missing.length === 0) { console.log('ป้ายครบทุกใบแล้ว (' + cards.length + ' ใบ) — ไม่มีอะไรต้องทำ'); process.exit(0); }
console.log(`ติดป้าย ${missing.length} ใบ...`);

const BATCH = 20;
const batches = [];
for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));

await Promise.all(batches.map(async (b) => {
  const listing = b.map((c, i) => `--- ใบ ${i + 1} (id: ${c.id}) ---\nชื่อ: ${c.promptName}\nโครง: ${String(c.promptText || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
  const prompt = `สรุปการ์ดพร้อมท์แต่ละใบเป็น "บรรทัดสาระ" 1 บรรทัด ไม่เกิน 18 คำ: แกนเรื่อง + กติกาเด่นถ้ามี (เช่น รองรับผู้เสียชีวิต/เน้นของเล็กๆ/ตัวเลขนำ)\n${listing}\nตอบ JSON: { "<id>": "บรรทัดสาระ", ... } ครบทุกใบ`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: prompt }], max_completion_tokens: 3000, response_format: { type: 'json_object' } }),
  });
  const j = await r.json();
  try { Object.assign(essences, JSON.parse(j.choices?.[0]?.message?.content || '{}')); } catch {}
}));

// ★ Opus P2-D: กันเขียนทับด้วยของที่แย่กว่าเดิม (คีย์ผิด/เน็ตหลุด/luna ตอบว่าง → ป้ายหายเกลี้ยง)
const done = cards.filter(c => essences[c.id]).length;
let oldCount = 0;
if (fs.existsSync(essFile)) { try { oldCount = Object.keys(JSON.parse(fs.readFileSync(essFile, 'utf8'))).length; } catch {} }
if (done < oldCount) {
  console.error(`❌ ป้ายใหม่ (${done}) น้อยกว่าไฟล์เดิม (${oldCount}) — ไม่เขียนทับ ตรวจคีย์/เน็ตแล้วรันใหม่`);
  process.exit(1);
}
fs.writeFileSync(essFile, JSON.stringify(essences, null, 1), 'utf8');
console.log(`เสร็จ: มีป้าย ${done}/${cards.length} ใบ → data/card-essences.json`);
