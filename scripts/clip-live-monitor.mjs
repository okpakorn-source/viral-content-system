/**
 * 🎙️ Clip-Insight LIVE Monitor (28 มิ.ย. — ผู้ใช้สั่ง: หน้าต่าง log ถอดประเด็นเรียลไทม์ อ่านรู้เรื่อง)
 * ─────────────────────────────────────────────────────────────────────────────
 * เฝ้าคิว "ถอดประเด็นจากคลิป" แบบเรียลไทม์ — แสดงสถานะแต่ละคลิป (รอ/กำลังถอด/รอลองใหม่/เสร็จ/ล้ม)
 *   poll endpoint เดียวกับหน้าเว็บ (/queue-list + /gemini-health) → ตรงสถานะจริง
 * 🔴 อ่านอย่างเดียว — ไม่แตะโค้ด/ตรรกะระบบถอดประเด็น (แค่เฝ้าดู)
 */
const BASE = process.env.CLIP_MON_BASE || 'http://localhost:3000';
const TH = { processing: '🔄 กำลังถอด ', pending: '⏳ รอคิว    ', retry_wait: '🔁 รอลองใหม่', done: '✅ เสร็จ    ', error: '❌ ล้มเหลว  ' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ageMin = (ts) => { if (!ts) return '?'; const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m + ' นาที'; };
const short = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 50);
async function jget(p) { try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return null; } }

async function tick() {
  console.clear();
  const t = new Date().toLocaleTimeString('th-TH');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  🎙️  ถอดประเด็นจากคลิป — เรียลไทม์      (${t})`);
  console.log('══════════════════════════════════════════════════════════════');

  const gh = await jget('/api/clip-transcript/gemini-health');
  if (gh) {
    const txt = JSON.stringify(gh);
    const dot = gh.ok || /ok|ปกติ|healthy/i.test(txt) ? '🟢 ปกติ' : (/slow|timeout|busy|แน่น|503|overload|ช้า/i.test(txt) ? '🟡 ช้า/แน่น (ตัวนอก)' : '🔴 มีปัญหา');
    console.log(`  สถานะ Gemini (AI ถอด): ${dot}   ${String(gh.message || gh.note || gh.reason || '').slice(0, 40)}`);
  }

  const q = await jget('/api/clip-transcript/queue-list');
  if (!q) { console.log('\n  ⚠️ ต่อเซิร์ฟเวอร์ไม่ได้ — เปิด npm start ไว้ไหม?'); console.log('\n  (ลองใหม่ใน 4 วิ)'); return; }
  const c = q.counts || {};
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  คิว:   ⏳ รอ ${c.pending || 0}    🔄 กำลังถอด ${c.processing || 0}    🔁 รอลองใหม่ ${c.retry_wait || 0}`);
  console.log('──────────────────────────────────────────────────────────────');

  const act = q.active || [];
  if (!act.length) console.log('  ✨ ไม่มีงานในคิว — ว่าง พร้อมรับคลิปใหม่');
  act.forEach((j) => {
    console.log(`  ${TH[j.status] || j.status}  [${j.platform || '?'}]  ถอดครั้งที่ ${j.attempts || 0}  ·  อยู่ในคิวมา ${ageMin(j.createdAt)}`);
    console.log(`        ${short(j.url)}`);
    if (j.error) console.log(`        ❌ เหตุผล: ${String(j.error).slice(0, 60)}`);
    if (j.status === 'processing' && (j.attempts || 0) === 0 && Number(ageMin(j.createdAt).split(' ')[0]) > 8) {
      console.log('        ⏳ ถอดนานเกิน 8 นาที = Gemini แน่น (เดี๋ยว worker timeout 16 นาทีแล้วลองใหม่เอง)');
    }
  });

  const rec = (q.recent || []).slice(0, 6);
  if (rec.length) {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  📋 เสร็จ/ล้ม ล่าสุด:');
    rec.forEach((j) => console.log(`     ${TH[j.status] || j.status}  ${short(j.url)}${j.error ? '  ❌ ' + String(j.error).slice(0, 36) : ''}`));
  }
  console.log('\n  🔄 อัปเดตทุก 4 วินาที  ·  ปิดหน้าต่างนี้ได้ ไม่กระทบการถอด');
}

(async () => {
  console.log('กำลังเชื่อมต่อ...');
  for (;;) { try { await tick(); } catch (e) { console.log('monitor error:', e.message); } await sleep(4000); }
})();
