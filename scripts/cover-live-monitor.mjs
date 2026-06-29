/**
 * 🎨 Cover LIVE Monitor — เวอร์ชันละเอียด (29 มิ.ย. — ผู้ใช้สั่ง: ดู API ตัวไหน สำเร็จ/ล้ม เวลา ขั้นไหน ภาษาไทยชัด)
 * ─────────────────────────────────────────────────────────────────────────────
 * รวม: /api/queue/status (คิว) + _prodserver.log (API + ขั้นตอนสด) + cover-cases.json (เสร็จ+คะแนน)
 *   → เห็น "ปกตัวไหนทำอยู่ · ขั้นไหน · เรียก API อะไรบ้าง สำเร็จ/ล้ม · ใช้เวลาเท่าไหร่ · ค่าใช้จ่าย · เสร็จคะแนนเท่าไหร่"
 * 🔴 อ่านอย่างเดียว — ไม่แตะตรรกะระบบทำปก · ปกทำบนเครื่องทีมนี้เสมอ · รันผ่าน cover-live.cmd (chcp 65001 = ไทยไม่เพี้ยน)
 */
import fs from 'fs';
import path from 'path';
const ROOT = process.cwd();
const LOG = path.join(ROOT, '_prodserver.log');
const CASES = path.join(ROOT, 'data', 'cover-cases.json');
const BASE = process.env.COVER_MON_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jget(p) { try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return null; } }
function tailLog(n = 14000) { try { const b = fs.readFileSync(LOG); return b.slice(Math.max(0, b.length - n)).toString('utf8'); } catch { return ''; } }
function lines(s) { return s.split('\n'); }

// provider/model → ชื่อไทยอ่านง่าย + บทบาท
function apiThai(raw) {
  const r = raw.toLowerCase();
  if (r.includes('gemini_vision')) return '🖼️  Gemini วิเคราะห์ภาพ (Judge คัดภาพ)';
  if (r.includes('gemini_video')) return '🎬 Gemini ถอดวิดีโอ (แตกเนื้อหา)';
  if (r.includes('gemini')) return '🖼️  Gemini';
  if (r.includes('gpt-5.5')) return '🎬 GPT-5.5 (ผู้กำกับ/ตัดสินภาพ)';
  if (r.includes('gpt-4o-mini')) return '🤖 GPT-4o-mini';
  if (r.includes('gpt-4o')) return '🤖 GPT-4o';
  if (r.includes('openai')) return '🤖 OpenAI';
  if (r.includes('claude') || r.includes('anthropic')) return '✍️  Claude';
  if (r.includes('serper')) return '🔍 Serper (ค้นภาพ)';
  return '• ' + raw;
}

// แปลง log → สถานะปกล่าสุด (ขั้นตอน + API + เวลา + ผล)
function parseCover(log) {
  const ls = lines(log);
  const out = {
    who: null, apis: [], fails: [], searchTotal: 0, searchQueries: 0,
    fbFrames: null, fbDurations: [], judge: null, director: null, downloaded: null,
    heroPick: null, slotBudget: null, composed: false, lastErr: null,
  };
  // เก็บเฉพาะช่วงหลังสุดที่เป็นงานปก (หา marker เริ่มงานล่าสุด)
  let start = 0;
  for (let i = ls.length - 1; i >= 0; i--) {
    if (/Starting cover job|\[CoverV3\].*(downloaded|identity|Story)|StoryIdentity/.test(ls[i])) { start = i; break; }
  }
  const seg = ls.slice(Math.max(0, start - 2));

  for (const l of seg) {
    // ใคร
    let m = l.match(/identity:\s*([^|]+)/) || l.match(/mainCharacter["']?\s*[:=]\s*["']?([^"',|}]+)/) || l.match(/StoryIdentity[^:]*:\s*([^|]+)/);
    if (m && m[1] && m[1].trim().length > 1 && m[1].length < 40) out.who = m[1].trim();
    // API สำเร็จ (มี cost = เรียกจบ)
    m = l.match(/\[API Usage\] Saved:\s*(\S+)\s*-\s*Cost:\s*\$([0-9.]+)/);
    if (m) out.apis.push({ name: apiThai(m[1]), raw: m[1], cost: parseFloat(m[2]) });
    // API/ขั้นล้ม
    if (/❌|503|429|insufficient_quota|exceeded your current quota|Forbidden|แตกเฟรมล้ม|Fallback|disabled|unparseable|parse ไม่ได้|aborted/i.test(l)) {
      let f = null;
      if (/403|Forbidden|แตกเฟรมล้ม/i.test(l)) f = '❌ แตกเฟรมคลิป (yt-dlp 403/ล้ม)';
      else if (/503|overload|แน่น/i.test(l)) f = '❌ Gemini แน่น (503) — ลองใหม่อัตโนมัติ';
      else if (/429|rate.?limit/i.test(l)) f = '⚠️ โดนจำกัดความเร็ว (429)';
      else if (/insufficient_quota|exceeded your current quota|billing/i.test(l)) f = '🔴 API เครดิต/quota หมด!';
      else if (/Fallback|unparseable|parse ไม่ได้/i.test(l)) f = '↩️ Judge สลับโมเดลสำรอง (Claude)';
      else if (/disabled/i.test(l)) f = '⏭️ โมเดลปิดใช้ (ข้าม)';
      else if (/aborted/i.test(l)) f = '⏱️ บางคำขอ timeout';
      if (f && !out.fails.includes(f)) out.fails.push(f);
    }
    // ค้นภาพ (Serper)
    m = l.match(/got (\d+) clean images/); if (m) { out.searchTotal += parseInt(m[1]); out.searchQueries++; }
    // แตกเฟรม FB
    m = l.match(/\[MetaFrame\] ① duration (\d+)s/); if (m) out.fbDurations.push(parseInt(m[1]));
    m = l.match(/FB\/IG คลิป → (\d+) เฟรม/); if (m) out.fbFrames = parseInt(m[1]);
    // Judge
    m = l.match(/Downloading (\d+)\/(\d+) candidates/); if (m) out.judge = { ...(out.judge || {}), dl: +m[1], total: +m[2] };
    m = l.match(/Selected (\d+)/); if (m) out.judge = { ...(out.judge || {}), selected: +m[1] };
    // Director
    if (/\[CoverDirector\] 🎬/.test(l)) out.director = 'จัดวางเลย์เอาต์';
    if (/hero SWAP|🦸 เลือกฮีโร่/.test(l)) out.heroPick = true;
    // ดาวน์โหลด buffers
    m = l.match(/downloaded (\d+)\/(\d+) buffers/); if (m) out.downloaded = +m[1];
    m = l.match(/งบช่อง = (\d+)/); if (m) out.slotBudget = +m[1];
    // ประกอบ
    if (/composed|✅ best|ประกอบปก|QC/.test(l)) out.composed = true;
    // error เด่น
    if (/Pipeline error|DIRECTOR_FAILED|INSUFFICIENT_QUALITY|422/.test(l)) out.lastErr = l.replace(/.*\]\s*/, '').slice(0, 70);
  }
  return out;
}

function recentCases(k = 5) {
  try { const d = JSON.parse(fs.readFileSync(CASES, 'utf8')); const arr = Array.isArray(d) ? d : (d.cases || Object.values(d)); return arr.slice(-k).reverse(); } catch { return []; }
}
const scoreIcon = (s) => s >= 8 ? '🟢' : (s >= 5 ? '🟡' : '🔴');
const pad = (s, n) => String(s).padEnd(n);

async function tick() {
  console.clear();
  const t = new Date().toLocaleTimeString('th-TH');
  const qs = await jget('/api/queue/status');
  const log = tailLog();
  const c = parseCover(log);
  const busy = qs && (qs.processing > 0);

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  🎨  ทำปกอัตโนมัติ — เรียลไทม์ละเอียด (เครื่องทีม)   ${t}`);
  console.log('══════════════════════════════════════════════════════════════');
  if (qs) console.log(`  คิว:   ⏳ รอ ${qs.pending || 0}     🔄 กำลังทำ ${qs.processing || 0}     ${busy ? '🟢 กำลังประมวลผล' : '⚪ ว่าง พร้อมรับงาน'}`);
  else console.log('  ⚠️  ต่อเซิร์ฟเวอร์ไม่ได้ (server อาจกำลังรีสตาร์ท)');
  console.log('──────────────────────────────────────────────────────────────');

  // ── ปกที่กำลังทำ + ขั้นตอน ──
  if (busy) {
    console.log(`  🔄 ปกที่กำลังทำ:  ${c.who ? c.who : '(กำลังหาว่าเกี่ยวกับใคร...)'}`);
    console.log('');
    const steps = [
      ['①', 'รู้ว่าข่าวเกี่ยวกับใคร', c.who ? 'done' : 'run'],
      ['②', 'ค้นภาพ + แตกเฟรมคลิป', (c.searchTotal > 0 || c.fbFrames != null) ? 'done' : (c.who ? 'run' : 'wait')],
      ['③', 'AI คัดเลือก+ให้คะแนนภาพ', c.judge ? (c.judge.selected != null ? 'done' : 'run') : (c.downloaded ? 'run' : 'wait')],
      ['④', 'จัดวางเลย์เอาต์ (Director)', c.director ? 'done' : (c.judge && c.judge.selected != null ? 'run' : 'wait')],
      ['⑤', 'ประกอบปก + ตรวจสอบ', c.composed ? 'done' : (c.director ? 'run' : 'wait')],
    ];
    for (const [n, name, st] of steps) {
      const icon = st === 'done' ? '✅' : st === 'run' ? '🔄' : '⏳';
      let extra = '';
      if (n === '②' && (c.searchTotal || c.fbFrames != null)) extra = `(ได้ ${c.searchTotal} ภาพ${c.fbFrames != null ? ` · FB ${c.fbFrames} เฟรม` : ''})`;
      if (n === '③' && c.judge) extra = `(${c.judge.selected != null ? 'คัดได้ ' + c.judge.selected + ' ภาพ' : 'วิเคราะห์ ' + (c.judge.dl || '?') + ' ภาพ'})`;
      console.log(`     ${icon} ${n} ${pad(name, 28)}${st === 'run' ? '◀ กำลังทำ ' : ''}${extra}`);
    }
  } else {
    console.log('  ✨ ไม่มีปกกำลังทำ — ว่าง');
  }
  console.log('──────────────────────────────────────────────────────────────');

  // ── API ที่เรียก (สำเร็จ/ล้ม + ค่าใช้จ่าย) ──
  console.log('  📡 API ที่เรียกล่าสุด (ปกตัวนี้):');
  if (c.searchQueries > 0) console.log(`     ✅ 🔍 Serper ค้นภาพ              สำเร็จ  (${c.searchQueries} คำค้น · ได้ ${c.searchTotal} ภาพ)`);
  if (c.fbDurations.length) {
    const okFb = c.fbFrames != null;
    console.log(`     ${okFb ? '✅' : '⚠️'} 🎞️  แตกเฟรมคลิป FB            ${okFb ? 'สำเร็จ' : 'บางตัวล้ม'}  (${c.fbDurations.length} ครั้ง · รวม ${c.fbDurations.reduce((a, b) => a + b, 0)} วิ)`);
  }
  const byApi = {};
  for (const a of c.apis) { byApi[a.name] = byApi[a.name] || { n: 0, cost: 0 }; byApi[a.name].n++; byApi[a.name].cost += a.cost; }
  for (const [name, v] of Object.entries(byApi)) console.log(`     ✅ ${pad(name, 36)} สำเร็จ  (${v.n} ครั้ง · $${v.cost.toFixed(3)})`);
  if (c.apis.length === 0 && c.searchQueries === 0 && !c.fbDurations.length) console.log('     (ยังไม่มีการเรียก API ในรอบนี้)');
  const totalCost = c.apis.reduce((a, b) => a + b.cost, 0);
  if (totalCost > 0) console.log(`     💰 ค่าใช้จ่าย AI ปกตัวนี้ (รวมที่เห็น): $${totalCost.toFixed(3)}`);

  // ── ปัญหา/ล้ม ──
  if (c.fails.length) {
    console.log('');
    console.log('  ⚠️ จุดที่สะดุด/ล้ม (ระบบจัดการต่อเอง):');
    c.fails.forEach((f) => console.log('     ' + f));
  }
  if (c.lastErr) console.log('  🔴 error: ' + c.lastErr);
  console.log('──────────────────────────────────────────────────────────────');

  // ── ปกเสร็จล่าสุด ──
  console.log('  📋 ปกที่ทำเสร็จล่าสุด (คะแนนเต็ม 10 · เวลาที่ใช้):');
  const cases = recentCases();
  if (!cases.length) console.log('     (ยังไม่มี)');
  cases.forEach((x) => {
    const sec = Math.round(x.elapsed || 0);
    const mm = sec >= 60 ? `${Math.floor(sec / 60)}น ${sec % 60}ว` : `${sec}ว`;
    console.log(`     ${scoreIcon(x.score)} ${pad(x.caseId, 9)} ${x.score}/10  ⏱️ ${pad(mm, 7)} [${pad(x.templateUsed || '?', 11)}] ${String(x.newsTitle || '').slice(0, 26)}`);
  });
  console.log('');
  console.log('  🔄 อัปเดตทุก 3 วินาที  ·  ปิดหน้าต่างได้ ไม่กระทบการทำปก');
}

(async () => { console.log('กำลังเชื่อมต่อ...'); for (;;) { try { await tick(); } catch (e) { console.log('monitor error:', e.message); } await sleep(3000); } })();
