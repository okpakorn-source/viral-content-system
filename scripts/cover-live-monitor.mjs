/**
 * 🎨 Cover LIVE Monitor (28 มิ.ย. — ผู้ใช้สั่ง: log ทำปกแยกต่างหากจากถอดประเด็น เรียลไทม์ อ่านเข้าใจ)
 * ─────────────────────────────────────────────────────────────────────────────
 * รวม 3 แหล่ง: /api/queue/status (คิว) + _prodserver.log (ขั้นตอนสด) + cover-cases.json (เสร็จ+คะแนน)
 *   → เห็นว่า "ปกตัวไหนกำลังทำ ขั้นไหน · ตัวไหนเสร็จคะแนนเท่าไหร่ · ตัวไหนล้มเหลว"
 * 🔴 อ่านอย่างเดียว — ไม่แตะตรรกะระบบทำปก (แค่เฝ้าดู) · ปกทำบนเครื่องทีมเครื่องนี้เสมอ
 */
import fs from 'fs';
import path from 'path';
const ROOT = path.join(process.cwd());
const LOG = path.join(ROOT, '_prodserver.log');
const CASES = path.join(ROOT, 'data', 'cover-cases.json');
const BASE = process.env.COVER_MON_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jget(p) { try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return null; } }

// แปลงบรรทัด log ของปก → ขั้นตอนภาษาไทยอ่านง่าย
function stepThai(line) {
  if (/Story identity|identity:/.test(line)) return '① วิเคราะห์ว่าข่าวเกี่ยวกับใคร';
  if (/Multi-agent search|FBReels|Agent\d|MetaFrame|Tier REAL|แตกเฟรม/.test(line)) return '② ค้นหา/แตกเฟรมภาพหลายแหล่ง';
  if (/Judge|Selected \d|close-up gate|re-ranked/.test(line)) return '③ AI คัดเลือก+ให้คะแนนภาพ';
  if (/Director \(options|🎬 main|จัดวาง/.test(line)) return '④ จัดวางเลย์เอาต์ (Director)';
  if (/composed|QC/.test(line)) return '⑤ ประกอบปก + ตรวจสอบ';
  if (/🔁 retry|self-heal/.test(line)) return '⑥ ปรับปรุงคุณภาพ (ลองใหม่ให้ดีขึ้น)';
  return null;
}
function tailLog(n = 4000) { try { const b = fs.readFileSync(LOG); return b.slice(Math.max(0, b.length - n)).toString('utf8'); } catch { return ''; } }
function recentCases(k = 6) {
  try { const d = JSON.parse(fs.readFileSync(CASES, 'utf8')); const arr = Array.isArray(d) ? d : (d.cases || Object.values(d)); return arr.slice(-k).reverse(); } catch { return []; }
}
function scoreIcon(s) { return s >= 8 ? '🟢' : (s >= 5 ? '🟡' : '🔴'); }

async function tick() {
  console.clear();
  const t = new Date().toLocaleTimeString('th-TH');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  🎨  ทำปกอัตโนมัติ — เรียลไทม์ (เครื่องทีม)      (${t})`);
  console.log('══════════════════════════════════════════════════════════════');

  const qs = await jget('/api/queue/status');
  if (qs) {
    console.log(`  คิว:  ⏳ รอ ${qs.pending || 0}    🔄 กำลังทำ ${qs.processing || 0}    ${qs.busy ? '(กำลังประมวลผล · ~' + (qs.estimatedWaitMinutes || '?') + ' นาที)' : '(ว่าง)'}`);
  } else { console.log('  ⚠️ ต่อเซิร์ฟเวอร์ไม่ได้'); }
  console.log('──────────────────────────────────────────────────────────────');

  // ขั้นตอนสดของปกที่กำลังทำ (จาก log)
  const log = tailLog();
  const lines = log.split('\n').filter((l) => l.includes('[CoverV3]') || l.includes('MetaFrame') || l.includes('FBReels') || l.includes('[Judge]') || l.includes('CoverDirector'));
  const lastCover = lines.slice(-12);
  let curStep = null, curWho = null;
  for (let i = lastCover.length - 1; i >= 0; i--) { const s = stepThai(lastCover[i]); if (s && !curStep) curStep = s; const m = lastCover[i].match(/identity:\s*([^|]+)/); if (m && !curWho) curWho = m[1].trim().slice(0, 40); }
  const done = log.includes('✅ best') && log.lastIndexOf('✅ best') > log.lastIndexOf('[CoverV3] ①');
  if (qs && qs.processing > 0 && curStep) {
    console.log('  🔄 กำลังทำปก' + (curWho ? ' — ' + curWho : '') + ':');
    console.log('       ' + curStep);
  } else if (qs && qs.processing === 0) {
    console.log('  ✨ ไม่มีปกกำลังทำ — ว่าง พร้อมรับงาน');
  }

  // หาบรรทัดล้มเหลว/ผลล่าสุดใน log
  const errLine = lastCover.reverse().find((l) => /Pipeline error|❌|DIRECTOR_FAILED|ไม่พบภาพ|422|timeout/.test(l));
  if (errLine) console.log('  ⚠️ พบ error ล่าสุดใน log: ' + errLine.replace(/.*\]/, '').slice(0, 60));

  console.log('──────────────────────────────────────────────────────────────');
  console.log('  📋 ปกที่ทำเสร็จล่าสุด (คะแนนเต็ม 10):');
  const cases = recentCases();
  if (!cases.length) console.log('     (ยังไม่มี)');
  cases.forEach((c) => {
    console.log(`     ${scoreIcon(c.score)} ${c.caseId}  คะแนน ${c.score}/10  [${c.templateUsed || '?'}]  ${String(c.newsTitle || '').slice(0, 30)}`);
  });
  console.log('\n  🔄 อัปเดตทุก 4 วินาที  ·  ปิดหน้าต่างได้ ไม่กระทบการทำปก');
}

(async () => { console.log('กำลังเชื่อมต่อ...'); for (;;) { try { await tick(); } catch (e) { console.log('monitor error:', e.message); } await sleep(4000); } })();
