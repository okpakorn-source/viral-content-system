/**
 * Clip Before/After (14 ส.ค. 69 — เจ้าของสั่งหลังย้อนพรอมต์ยุคนิ่ง + โมเดล gemini-3.7-flash-high)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าที่: สุ่มหยิบเคสจากคลังถอดประเด็น (clip-insights) มา N คลิป → สั่งถอดใหม่ (force)
 *          ด้วยโค้ด/โมเดลปัจจุบัน → พิมพ์ตารางเทียบ "ก่อน (ผลเดิมในคลัง) vs หลัง (ถอดสด)"
 *          + เซฟรายงานเต็มเป็นไฟล์ .md และ .json ใน scratch/
 *
 * วิธีใช้ (เครื่องทีม — ต้องมีเซิร์ฟเวอร์รันอยู่และโค้ดเป็นรุ่นใหม่แล้ว):
 *   npm run dev  (หรือ next start)  ค้างไว้หน้าต่างหนึ่ง แล้วอีกหน้าต่าง:
 *   node scripts/clip-before-after.mjs
 * ปรับได้ด้วย env:
 *   CLIP_BA_BASE=http://localhost:3000   ชี้เซิร์ฟเวอร์ (หรือ URL production หลัง deploy)
 *   CLIP_BA_COUNT=3                      จำนวนคลิปที่สุ่ม
 *   CLIP_BA_PLATFORMS=youtube,tiktok     จำกัดแพลตฟอร์ม (ค่าว่าง = ทุกแพลตฟอร์ม —
 *                                        FB/IG ต้องรันบนเครื่องทีมที่มี yt-dlp เท่านั้น)
 *
 * 🔴 อ่านอย่างเดียว + ยิงถอดใหม่ผ่าน API ปกติเท่านั้น — ไม่แตะคลัง/คิว/ระบบข่าวโดยตรง
 *    ผลถอดใหม่เข้าคลังตามกลไกปกติของ route (จ่ายค่า Gemini จริงตามจำนวนคลิปที่สุ่ม)
 */
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const BASE = process.env.CLIP_BA_BASE || 'http://localhost:3000';
const COUNT = Math.max(1, Number(process.env.CLIP_BA_COUNT) || 3);
const PLATFORMS = String(process.env.CLIP_BA_PLATFORMS || '').split(',').map(s => s.trim()).filter(Boolean);

// ถอดคลิปยาวกินเวลาหลายนาที — ตั้ง timeout ยาวแบบเดียวกับ clip-worker (กัน fetch failed ที่ 5 นาที)
let dispatcher = null;
try {
  const { Agent } = await import('undici');
  dispatcher = new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000, connectTimeout: 30_000 });
} catch { /* ไม่มี undici = ใช้ค่าเริ่มต้น (คลิปสั้นยังไหว) */ }

const log = (...a) => console.log(...a);
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// ── ตัววัดที่ใช้เทียบสองฝั่งด้วยไม้บรรทัดเดียวกัน ──
function metrics(ins) {
  const raw = String(ins?.rawData || '');
  return {
    headline: String(ins?.headline || ''),
    rawLen: raw.length,
    paragraphs: raw.split(/\n\s*\n/).filter(s => s.trim()).length,
    quoteMarksInBody: (raw.match(/"/g) || []).length, // เครื่องหมายคำพูดแทรกในเนื้อ (ยุคนิ่งต้อง ~0)
    subStories: (ins?.subStories || []).length,
    subTopics: (ins?.subStories || []).map(s => cut(s?.topic, 40)),
    quotes: (ins?.quotes || []).length,
    keyPoints: (ins?.keyPoints || []).length,
    opening: cut(raw, 180),
    ending: cut(raw.slice(-220), 180),
  };
}

function sideBySide(label, b, a) {
  const rows = [
    ['ความยาวเนื้อดิบ', `${b.rawLen} ตัวอักษร`, `${a.rawLen} ตัวอักษร`],
    ['ย่อหน้า', b.paragraphs, a.paragraphs],
    ['ประเด็นย่อย', b.subStories, a.subStories],
    ['คำพูดในช่อง quotes', b.quotes, a.quotes],
    ['เครื่องหมายคำพูดแทรกในเนื้อ', b.quoteMarksInBody, a.quoteMarksInBody],
    ['keyPoints', b.keyPoints, a.keyPoints],
  ];
  const md = [
    `## ${label}`,
    '', '| ตัววัด | ก่อน (ในคลัง) | หลัง (โค้ดใหม่) |', '|---|---|---|',
    ...rows.map(([k, x, y]) => `| ${k} | ${x} | ${y} |`),
    '', `**พาดหัว · ก่อน:** ${b.headline}`, `**พาดหัว · หลัง:** ${a.headline}`,
    '', `**เปิดเรื่อง · ก่อน:** ${b.opening}`, `**เปิดเรื่อง · หลัง:** ${a.opening}`,
    '', `**จบเรื่อง · ก่อน:** ${b.ending}`, `**จบเรื่อง · หลัง:** ${a.ending}`,
    '', `**ประเด็นย่อย · ก่อน:** ${b.subTopics.join(' · ') || '—'}`, `**ประเด็นย่อย · หลัง:** ${a.subTopics.join(' · ') || '—'}`,
  ];
  return md.join('\n');
}

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, ...(dispatcher ? { dispatcher } : {}) });
  const d = await r.json().catch(() => ({}));
  if (!d?.success) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

// 1) ดึงคลัง → คัดเคสที่ใช้เทียบได้ (มีเนื้อจริง + ไม่ซ้ำลิงก์) → สุ่ม
log(`\n🎬 Clip Before/After — base=${BASE} · สุ่ม ${COUNT} คลิป${PLATFORMS.length ? ` · เฉพาะ ${PLATFORMS.join('/')}` : ''}\n`);
const cases = (await getJson(`${BASE}/api/clip-transcript/cases?kind=insight&limit=100`)).cases || [];
const seen = new Set();
const pool = cases.filter(c => {
  const ok = String(c?.insight?.rawData || '').length >= 300 && c.url && !seen.has(c.url)
    && (!PLATFORMS.length || PLATFORMS.includes(c.platform));
  if (ok) seen.add(c.url);
  return ok;
});
if (pool.length < COUNT) { console.error(`❌ คลังมีเคสที่ใช้ได้แค่ ${pool.length} (ต้องการ ${COUNT}) — ลองปรับ CLIP_BA_PLATFORMS`); process.exit(1); }
const picked = pool.sort(() => Math.random() - 0.5).slice(0, COUNT);
picked.forEach((c, i) => log(`  ${i + 1}. [${c.platform}] ${cut(c.title, 60)}\n     ${c.url}`));

// 2) ถอดใหม่ทีละคลิป (force ข้ามคลัง — ได้ผลจากพรอมต์/โมเดลปัจจุบันแน่ๆ) แล้วเทียบ
const results = [];
for (const [i, c] of picked.entries()) {
  log(`\n⏳ (${i + 1}/${COUNT}) ถอดใหม่: ${cut(c.title, 60)} …`);
  const t0 = Date.now();
  try {
    const d = await getJson(`${BASE}/api/clip-transcript/insight`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // CLIP_BA_USER = ชื่อผู้ส่งที่ติดลงคลัง (มาร์คใบทดสอบให้ทีมเห็น เช่น 'เอไอทดสอบ')
      body: JSON.stringify({ url: c.url, force: true, user: process.env.CLIP_BA_USER || 'before-after-test' }),
    });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    log(`   ✅ เสร็จใน ${mins} นาที`);
    results.push({ c, after: d.data, ms: Date.now() - t0 });
  } catch (e) {
    log(`   ❌ ล้ม: ${String(e.message).slice(0, 120)} — ข้ามคลิปนี้`);
    results.push({ c, error: String(e.message).slice(0, 200) });
  }
}

// 3) รายงาน — console + ไฟล์ .md/.json ใน scratch/
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const parts = [`# เทียบถอดประเด็น ก่อน vs หลัง (ยุคนิ่ง + gemini-3.7-flash-high) — ${new Date().toLocaleString('th-TH')}`];
for (const r of results) {
  const label = `[${r.c.platform}] ${cut(r.c.title, 70)}\n${r.c.url}`;
  if (r.error) { parts.push(`## ${label}\n\n❌ ถอดใหม่ไม่สำเร็จ: ${r.error}`); continue; }
  const before = metrics(r.c.insight);
  const after = metrics(r.after);
  parts.push(sideBySide(label, before, after));
  parts.push(`_ใบก่อนถอดเมื่อ ${r.c.createdAt || '-'} (${r.c.styleLabel || r.c.promptRev || 'ไม่ระบุรุ่น'}) · ถอดใหม่ใช้เวลา ${(r.ms / 60000).toFixed(1)} นาที_`);
}
const md = parts.join('\n\n---\n\n');
await mkdir(join(process.cwd(), 'scratch'), { recursive: true }).catch(() => {});
const mdPath = join(process.cwd(), 'scratch', `clip-before-after-${stamp}.md`);
await writeFile(mdPath, md, 'utf8');
await writeFile(mdPath.replace(/\.md$/, '.json'), JSON.stringify(results.map(r => ({
  url: r.c.url, platform: r.c.platform, before: r.c.insight, after: r.after || null, error: r.error || null,
})), null, 2), 'utf8');
log(`\n${'═'.repeat(60)}\n${md}\n${'═'.repeat(60)}`);
log(`\n💾 รายงานเต็ม: ${mdPath} (+ .json คู่กัน) — ส่งไฟล์นี้กลับมาให้วิเคราะห์ต่อได้เลย\n`);
