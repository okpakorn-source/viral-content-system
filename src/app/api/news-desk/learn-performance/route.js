/**
 * 📚 Learn Performance — อ่านผลโพสต์จริงรายเดือน (Meta Business Suite CSV) → อัพเดตสมองคัดอัตโนมัติ (3 ก.ค. 69)
 * ─────────────────────────────────────────────────────────────────────
 * เดิม: GOLD_EXAMPLES/FIT_WEIGHTS มาจากวิเคราะห์มือครั้งเดียว (มิ.ย. 69) — เดือนถัดไปรสนิยมคนเปลี่ยน ระบบไม่รู้
 * ใหม่: ทีม export CSV จาก Meta ทุกเดือน → POST เข้า endpoint นี้ → ระบบวิเคราะห์เอง:
 *   คลังทอง 12 ใบ (โพสต์ปังจริงล่าสุด) + ตัวอย่างแป้ก + boost น้ำหนักหมวดจาก median จริง
 *   → เก็บ store 'desk-learning' (id 'latest') → deskBrain (judge few-shot + fitScore) อ่านอัตโนมัติ
 * วิธีใช้: POST {"path":"C:\\Users\\User\\Downloads\\Jun-01...csv"}   (เครื่องทีม — สะดวกสุด)
 *          หรือ POST {"csv":"<เนื้อไฟล์ csv>"}                        (ทุกเครื่อง)
 * GET → ดูผลเรียนรู้ล่าสุด
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง — ไม่แตะระบบเขียนข่าว/ทำปก
 */
import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { createStore } from '@/lib/persistStore';
import { keywordCategorize } from '@/lib/services/newsDesk/deskBrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── CSV parser (รองรับ field มี comma/ขึ้นบรรทัดใน quotes — แบบเดียวกับที่ใช้วิเคราะห์ มิ.ย.) ──
function parseCSV(s) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    let raw = body.csv || '';
    if (!raw && body.path) {
      // อ่านไฟล์จากเครื่อง (เครื่องทีม) — จำกัดเฉพาะ .csv กันอ่านไฟล์อื่น
      if (!/\.csv$/i.test(String(body.path))) {
        return NextResponse.json({ success: false, error: 'path ต้องเป็นไฟล์ .csv', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      raw = await readFile(String(body.path), 'utf8');
    }
    if (!raw || raw.length < 500) {
      return NextResponse.json({ success: false, error: 'ต้องส่ง csv (เนื้อไฟล์) หรือ path ไฟล์ Meta export', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    const rows = parseCSV(raw);
    const header = rows[0] || [];
    // หา index คอลัมน์จากชื่อหัว (Meta export ภาษาไทย) — ทนต่อการสลับลำดับคอลัมน์
    // ★ exact ก่อน contains — "ชื่อ" ต้องไม่จับ "ชื่อเพจ" (บั๊กที่เจอตอนเทสจริง: ได้ชื่อเพจแทนหัวโพสต์ทุกแถว)
    const idx = (names) => {
      const exact = header.findIndex(h => names.some(n => String(h).trim() === n));
      if (exact >= 0) return exact;
      return header.findIndex(h => names.some(n => String(h).includes(n)));
    };
    const iTitle = idx(['ชื่อ']);
    const iReact = idx(['ความรู้สึก']);
    const iTime = idx(['เวลาที่เผยแพร่']);
    if (iTitle < 0 || iReact < 0) {
      return NextResponse.json({ success: false, error: `ไม่พบคอลัมน์ "ชื่อ"/"ความรู้สึก" — ต้องเป็นไฟล์ export จาก Meta Business Suite`, errorType: 'BAD_CSV' }, { status: 400 });
    }
    // "ความรู้สึก ความคิดเห็น และการแชร์" ก็มีคำว่า ความรู้สึก — เอาคอลัมน์ที่ชื่อสั้นตรงเป๊ะก่อน
    const iReactExact = header.findIndex(h => String(h).trim() === 'ความรู้สึก');
    const reactCol = iReactExact >= 0 ? iReactExact : iReact;

    const posts = rows.slice(1)
      .filter(r => r.length > Math.max(iTitle, reactCol))
      .map(r => ({
        title: String(r[iTitle] || '').replace(/\s+/g, ' ').trim(),
        react: Number(r[reactCol]) || 0,
        time: iTime >= 0 ? String(r[iTime] || '') : '',
      }))
      .filter(p => p.title.length >= 10);
    if (posts.length < 30) {
      return NextResponse.json({ success: false, error: `โพสต์น้อยเกิน (${posts.length}) — ต้องเป็น export ทั้งเดือน`, errorType: 'TOO_FEW_POSTS' }, { status: 400 });
    }

    const med = median(posts.map(p => p.react));

    // ── น้ำหนักหมวดจาก median จริง (จัดหมวดด้วย keywordCategorize เดียวกับโต๊ะ → เทียบกับ DESK_CATEGORIES ตรงๆ) ──
    const byCat = {};
    for (const p of posts) {
      const c = keywordCategorize({ title: p.title });
      (byCat[c] = byCat[c] || []).push(p.react);
    }
    const catBoost = {}; const catStats = {};
    for (const [cat, arr] of Object.entries(byCat)) {
      if (arr.length < 8) continue; // หมวดตัวอย่างน้อย = ไม่ฟันธง
      const m = median(arr);
      catStats[cat] = { n: arr.length, median: m };
      catBoost[cat] = Math.max(-6, Math.min(8, Math.round(((m / Math.max(1, med)) - 1) * 6)));
    }

    // ── คลังทองใหม่: ท็อป 12 (กันเรื่องซ้ำด้วย 18 ตัวอักษรแรก) + ตัวอย่างแป้ก (ล่าง <500 ที่หมวดดูดีแต่เงียบ) ──
    const sorted = [...posts].sort((a, b) => b.react - a.react);
    const seen = new Set(); const gold = [];
    for (const p of sorted) {
      const key = p.title.replace(/\s/g, '').slice(0, 18);
      if (seen.has(key)) continue;
      seen.add(key);
      gold.push(`${p.title.slice(0, 110)} (${p.react.toLocaleString()}) [${keywordCategorize({ title: p.title })}]`);
      if (gold.length >= 12) break;
    }
    const flops = sorted.filter(p => p.react < Math.min(500, med / 10)).slice(-40)
      .filter(p => keywordCategorize({ title: p.title }) !== 'อื่นๆ').slice(0, 5)
      .map(p => `${p.title.slice(0, 100)} (${p.react}) — หมวดดูใช่แต่แป้กจริง`);

    // ── ตัวทำนายเชิงโครง (ยืนยันซ้ำทุกเดือน): หักมุม / ตัวเลข ──
    const wContrast = posts.filter(p => /แม้|ทั้งๆ?ที่|แต่กลับ|กลับ(เลือก|ไม่)/.test(p.title));
    const wNumber = posts.filter(p => /\d/.test(p.title));
    const predictors = {
      contrast: { with: median(wContrast.map(p => p.react)), without: median(posts.filter(p => !wContrast.includes(p)).map(p => p.react)) },
      numbers: { with: median(wNumber.map(p => p.react)), without: median(posts.filter(p => !wNumber.includes(p)).map(p => p.react)) },
    };

    // Meta ใช้ MM/DD/YYYY HH:mm → เดือนมาตรฐาน YYYY-MM (บั๊กเดิม slice ได้ '06/28/2')
    const _t = posts.find(p => p.time)?.time || '';
    const _m = _t.match(/(\d{2})\/\d{2}\/(\d{4})/);
    const month = _m ? `${_m[2]}-${_m[1]}` : new Date().toISOString().slice(0, 7);
    const learning = {
      id: 'latest', analyzedAt: new Date().toISOString(), month,
      posts: posts.length, medianReactions: med,
      catStats, catBoost, goldExamples: gold, flopExamples: flops, predictors,
    };
    const store = createStore('desk-learning');
    const all = await store.getAll();
    // ล้าง row ประวัติที่ id เพี้ยน (จากบั๊กเดือนก่อนแก้) — เก็บเฉพาะ month_YYYY-MM
    for (const x of all) {
      if (x.id !== 'latest' && !/^month_\d{4}-\d{2}$/.test(x.id)) await store.remove(x.id).catch(() => {});
    }
    if (all.find(x => x.id === 'latest')) await store.update('latest', () => learning);
    else await store.add(learning);
    // เก็บประวัติรายเดือนไว้ด้วย (ดูย้อนได้ว่ารสนิยมเปลี่ยนยังไง)
    const histId = 'month_' + month;
    if (!all.find(x => x.id === histId)) await store.add({ ...learning, id: histId }).catch(() => {});

    console.log(`[LearnPerf] 📚 เรียนจาก ${posts.length} โพสต์ (${month}) median ${med} | boost ${JSON.stringify(catBoost).slice(0, 120)}`);
    return NextResponse.json({
      success: true, month, posts: posts.length, medianReactions: med,
      catBoost, catStats, goldSample: gold.slice(0, 3), flopSample: flops.slice(0, 2), predictors,
      note: 'บก.AI จะใช้คลังทอง/น้ำหนักชุดนี้อัตโนมัติภายใน 10 นาที (cache)',
    });
  } catch (error) {
    console.error('[LearnPerf]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'LEARN_ERROR' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const all = await createStore('desk-learning').getAll();
    const latest = all.find(x => x.id === 'latest') || null;
    return NextResponse.json({ success: true, latest, months: all.filter(x => x.id !== 'latest').map(x => x.id) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'LEARN_GET_ERROR' }, { status: 500 });
  }
}
