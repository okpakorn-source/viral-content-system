// แชทบริษัท Fable & Co. — ออนไลน์ (isolated) เรียก AI เดิม ใช้ ENV เดิม
// 🔴 ปลอดภัยโดยปริยาย: ปิดอยู่จนกว่าตั้ง ENV COMPANY_CHAT_SECRET (ไม่ตั้ง = 503 เผาเงินไม่ได้)
// ห้ามแก้ไฟล์ AI ล็อก — import เรียกเท่านั้น (ตามแบบ route อื่น)
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claudeClient';
import { getSupabase } from '@/lib/supabase';

// persona พนักงาน (3 กลุ่ม) — ตอบตามบทบาท
const ROSTER = {
  // สำนักงานใหญ่
  phupha: { name: 'ภูผา', role: 'CEO ประสานงาน จ่ายงาน ตรวจรับ (ตอบภาพรวมบริษัท)' },
  oat: { name: 'โอ๊ต', role: 'รอง CEO วางแผน แตกงาน ตรวจรับ รวมรายงาน' },
  sun: { name: 'ซัน', role: 'วิศวกรหลัก เขียนโค้ด/ฟีเจอร์/UI/บั๊ก' },
  hai: { name: 'ฮาย', role: 'ผู้ช่วย ค้นข้อมูล สรุป แปลง format งานด่วน' },
  // แผนกโต๊ะข่าว
  ton: { name: 'ต้น', role: 'ผอ.ข่าว วางธีมล่า สั่งทีมหาข่าว ตัดสินทิศทาง' },
  mod: { name: 'มด', role: 'โอเปอเรเตอร์ รีเฟรช/ยิงค้นข่าว มอนิเตอร์รอบล่า' },
  ken: { name: 'เคน', role: 'หัวหน้าโต๊ะข่าว/บก.ใหญ่ เปิดประชุม เคาะข่าว' },
  nin: { name: 'นิน', role: 'นักคัดข่าว ดูข่าวไหนน่าส่ง ดี/ไม่ดี ไวรัลไหม' },
  meen: { name: 'มีน', role: 'เช็คเนื้อข่าว จับข่าวเนื้อน้อย/ผอม' },
  fah: { name: 'ฟ้า', role: 'ดูโทน/สมดุลข่าว จับแง่ลบเกิน ดันมุมบวก' },
  jo: { name: 'โจ', role: 'ตรวจข้อเท็จจริงอิสระ ขี้สงสัย ขอหลักฐาน' },
  rin: { name: 'ริน', role: 'ผู้ตรวจการ/เก็บคลัง ตามผลงานจริงในระบบ ลงคลังงาน พบปัญหารายงานทีมวิศวะ' },
  // ทีมวิศวกรรม
  arch: { name: 'อาร์ค', role: 'หัวหน้าวิศวกร/สถาปนิก วินิจฉัยรากปัญหา วางแผนแก้' },
  beck: { name: 'เบค', role: 'วิศวกร Backend API/workflow/server' },
  fon: { name: 'ฝน', role: 'วิศวกร Frontend จอ/UI/แชท' },
  qa: { name: 'คิว', role: 'QA/เทสเตอร์ รันเทส ยืนยันผลจริง' },
  rev: { name: 'เรฟ', role: 'ผู้ตรวจโค้ดอิสระ หา regression' },
  zip: { name: 'ซิป', role: 'ช่างแก้ด่วน จุดเล็ก แก้เร็ว' },
};

// สมองคนละตัว — โมเดลระบบบริหาร (Claude) ตามตำแหน่ง | Codex/Kimi รันได้เฉพาะใน workflow (CLI) ออนไลน์ใช้ Claude ตามระดับแทน
const CLAUDE_MODEL = { opus: 'claude-opus-4-8', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5-20251001' };
const AGENT_TIER = {
  phupha: 'opus', oat: 'opus', arch: 'opus',
  ton: 'sonnet', ken: 'sonnet', nin: 'sonnet', sun: 'sonnet', beck: 'sonnet', fon: 'sonnet',
  mod: 'haiku', meen: 'haiku', fah: 'haiku', rin: 'haiku', hai: 'haiku', qa: 'haiku',
  jo: 'sonnet', rev: 'sonnet', sol: 'sonnet', terra: 'sonnet', luna: 'haiku', zip: 'haiku',
};
function modelFor(h) { return CLAUDE_MODEL[AGENT_TIER[h] || 'haiku']; }
// หน้าที่จริงในระบบ /news-desk (แต่ละคนรู้งานตัวเอง)
const SYS = {
  ton: 'วางธีมล่า/คลัสเตอร์+คีย์เวิร์ดให้ทีมค้น (คู่ /api/desk/research/hunt)',
  mod: 'ยิงค้นข่าวหลายช่องทาง + ส่งลีดเข้าคิวเขียนจริง (/api/desk/research/hunt, /extract)',
  ken: 'เปิดประชุมคัด เคาะข่าวว่าส่ง/ตก/แก้ (ชั้น editor)',
  nin: 'ให้คะแนนน่าส่ง/ไวรัล (คู่ /api/desk/research/judge)',
  meen: 'เช็คเนื้อพอเขียนไหม จับข่าวผอม',
  fah: 'เช็คโทน กันข่าวลบล้วน ดันมุมบวก',
  jo: 'ตรวจข้อเท็จจริงก่อนเคาะ',
  rin: 'ตามสถานะงานจริง (/api/queue/status, leads?status=sent) ลงคลังงาน',
};

// คลังคำสอนเจ้าของ — self-fetch จาก public (cache 5 นาที) ทุกคนอ่านก่อนตอบเสมอ
let LESSONS_CACHE = { t: 0, text: '' };
async function getLessons(origin) {
  if (Date.now() - LESSONS_CACHE.t < 300000 && LESSONS_CACHE.text) return LESSONS_CACHE.text;
  try {
    const r = await fetch(origin + '/company/knowledge/lessons.md', { cache: 'no-store' });
    if (r.ok) LESSONS_CACHE = { t: Date.now(), text: (await r.text()).slice(0, 4000) };
  } catch (e) { /* ใช้ cache เดิม/ว่าง */ }
  return LESSONS_CACHE.text;
}
// ความจำบทสนทนา — จอส่งประวัติล่าสุดแนบมา (สูงสุด 8 รายการ)
function historyBlock(body) {
  const hist = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!hist.length) return '';
  const lines = hist.map(x => String(x && x.who || '?').slice(0, 30) + ': ' + String(x && x.text || '').slice(0, 250));
  return '\nบทสนทนาก่อนหน้า (จำไว้และตอบต่อเนื่อง):\n' + lines.join('\n');
}
const HUMAN = 'คุณเป็น "คนทำงานจริง" ไม่ใช่หุ่นยนต์: มีความเห็นของตัวเอง ตอบตรงไปตรงมา ไม่รู้ให้บอกว่าไม่รู้ เห็นต่างให้แย้งสุภาพพร้อมเหตุผล ห้ามประจบ ห้ามตอบกลาง ๆ. ';

// ข้อมูลจริงในระบบ — ให้เอเจนต์ตอบด้วยของจริง (คลังงาน/มติ/สมุดงาน + คิวงานจริง, cache 2 นาที)
let LIVE_CACHE = {};
async function fetchMd(u) { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? (await r.text()) : ''; } catch (e) { return ''; } }
// คิวงาน/บั๊กจริงจาก Supabase — ทีมต้องเห็นตรงกัน (แก้ปัญหาสื่อสารไม่ครบ 21 ก.ค.)
async function getTasksBlock(scope) {
  try {
    const sb = getSupabase(); if (!sb) return '';
    const q = await sb.from('store_items').select('data').eq('store_name', 'company_tasks').order('created_at', { ascending: false }).limit(25);
    const ts = (q.data || []).map(r => r.data).filter(t => t && t.scope === (scope || 'main') && (t.status === 'pending' || t.status === 'running'));
    if (!ts.length) return '\n[คิวงานทีมนี้: ว่าง — ไม่มีงาน/บั๊กค้างในคิวตอนนี้]';
    return '\n[คิวงาน/บั๊กที่รอทีมนี้จริง ๆ ตอนนี้ (' + ts.length + ' งาน — นี่คือของจริง อ้างอิงตามนี้เท่านั้น)]\n' + ts.map(t => '- (' + t.status + ') ' + String(t.command).slice(0, 140)).join('\n');
  } catch (e) { return ''; }
}
async function getLive(scope, origin) {
  const key = scope || 'main';
  if (LIVE_CACHE[key] && Date.now() - LIVE_CACHE[key].t < 120000) return LIVE_CACHE[key].text;
  let text = '';
  if (scope === 'newsdesk') {
    const jobs = await fetchMd(origin + '/company/departments/newsdesk/archive/jobs.md');
    const minutes = await fetchMd(origin + '/company/departments/newsdesk/meeting/minutes.md');
    text = (jobs ? '[คลังงาน/เคสข่าวล่าสุด — ของจริงในระบบ]\n' + jobs.slice(-1600) : '') + (minutes ? '\n[มติที่ประชุมล่าสุด]\n' + minutes.slice(-900) : '');
  } else if (scope === 'engineering') {
    const wl = await fetchMd(origin + '/company/departments/engineering/worklog.md');
    const cl = await fetchMd(origin + '/company/departments/engineering/comm-log.md');
    text = (wl ? '[สมุดงานทีมวิศวะ]\n' + wl.slice(-1100) : '') + (cl ? '\n[ปัญหาที่รับแจ้ง]\n' + cl.slice(-900) : '');
  } else {
    const log = await fetchMd(origin + '/company/office/log.md');
    text = log ? '[บันทึกงานบริษัทล่าสุด]\n' + log.slice(-1100) : '';
  }
  text += await getTasksBlock(key);
  LIVE_CACHE[key] = { t: Date.now(), text };
  return text;
}
// rate limit หยาบ กันเผาเงิน (per-instance) — เปิดสาธารณะไม่มีรหัสแล้ว
const RL = { t: 0, n: 0 };
function rateOk() { const now = Date.now(); if (now - RL.t > 60000) { RL.t = now; RL.n = 0; } RL.n++; return RL.n <= 40; }

export async function POST(request) {
  try {
    if (!rateOk()) return NextResponse.json({ success: false, error: 'คุยถี่เกินไป รอสักครู่', errorType: 'RATE_LIMIT' }, { status: 429 });
    const body = await request.json().catch(() => ({}));
    const { to, text } = body;
    const origin = new URL(request.url).origin;
    const msg = String(text || '').trim();
    // action=tasks (ดึงสถานะงาน) ไม่ต้องมี text — ยกเว้นด่านนี้
    if (!msg && body.action !== 'tasks') return NextResponse.json({ success: false, error: 'ข้อความว่าง', errorType: 'EMPTY' }, { status: 400 });
    if (msg.length > 800) return NextResponse.json({ success: false, error: 'ข้อความยาวเกิน 800 ตัว', errorType: 'TOO_LONG' }, { status: 400 });

    let h = String(to || '').replace('@', '').trim();
    const scope = String(body.scope || '').trim();

    // ---- โหมดประชุมออนไลน์: ทั้งวงออกความเห็นใน call เดียว (คุมต้นทุน) ----
    if (body.action === 'meeting') {
      const panel = scope === 'newsdesk' ? ['ton', 'ken', 'nin', 'meen', 'fah']
        : scope === 'engineering' ? ['arch', 'beck', 'qa']
        : ['oat', 'sun', 'hai'];
      const panelDesc = panel.map(p => ROSTER[p].name + '(@' + p + ' ' + ROSTER[p].role + ')').join(', ');
      const lessonsM = await getLessons(origin);
      const liveM = await getLive(scope, origin);
      const meetPrompt = 'เจ้าของบริษัทเรียกประชุมหัวข้อ: "' + msg + '"\nผู้เข้าประชุม: ' + panelDesc +
        '\nจำลองที่ประชุมจริง: แต่ละคนพูดสั้น 1-2 ประโยคตามบทบาทตัวเอง ตอบตรงหัวข้อ อ้างอิงข้อมูลจริงในระบบได้ มีความเห็นจริง (เห็นด้วย/แย้ง/เสนอ) ไม่ใช่คำตอบกลาง ๆ' +
        historyBlock(body) +
        '\nตอบ JSON เท่านั้น: {"meeting":[{"handle":"<handle>","say":"<คำพูด>"}]} เรียงตามลำดับผู้เข้าประชุม';
      const mout = await callClaude({ prompt: meetPrompt, systemPrompt: 'คุณคือระบบจำลองที่ประชุมบริษัท Fable & Co. ผู้เรียกประชุมคือเจ้าของบริษัท/ผู้บัญชาการสูงสุด ทุกคนให้เกียรติและตอบตรงประเด็น. ' + HUMAN + (lessonsM ? '\nคำสอนจากเจ้าของ:\n' + lessonsM : '') + (liveM ? '\nข้อมูลจริงในระบบตอนนี้ (อ้างอิงได้):\n' + liveM : '') + '\nตอบ JSON ตามรูปแบบที่สั่งเท่านั้น', model: CLAUDE_MODEL.sonnet, maxTokens: 3000, temperature: 0.8 }).catch(function () { return null; });
      const rows = (mout && Array.isArray(mout.meeting) ? mout.meeting : [])
        .filter(r => r && ROSTER[String(r.handle || '').replace('@', '')])
        .map(r => { const k = String(r.handle).replace('@', ''); return { handle: k, name: ROSTER[k].name, say: String(r.say || '') }; });
      if (!rows.length) return NextResponse.json({ success: false, error: 'ที่ประชุมไม่ตอบ ลองใหม่', errorType: 'MEETING_EMPTY' }, { status: 502 });
      return NextResponse.json({ success: true, meeting: rows, topic: msg });
    }
    // ---- โหมดสั่งงานจริง: เข้าคิว Supabase ให้ผู้จัดการ (Claude Code) รันจริง แล้วผลกลับมาที่แชท ----
    if (body.action === 'task') {
      const sb = getSupabase();
      if (!sb) return NextResponse.json({ success: false, error: 'คิวงานยังไม่พร้อม (Supabase)', errorType: 'NO_DB' }, { status: 503 });
      const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const rec = { id, scope: scope || 'main', assignee: (h || 'all'), command: msg, status: 'pending', from: 'owner', ts: Date.now(), result: '' };
      const ins = await sb.from('store_items').insert({ id, store_name: 'company_tasks', data: rec, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (ins.error) return NextResponse.json({ success: false, error: 'บันทึกงานไม่สำเร็จ: ' + ins.error.message, errorType: 'TASK_FAIL' }, { status: 500 });
      return NextResponse.json({ success: true, taskId: id, note: 'รับงานเข้าคิวแล้ว — ทีมจะลงมือเมื่อผู้จัดการประมวลคิว ผลจะกลับมาที่แชท' });
    }
    // ---- ดึงสถานะงานที่สั่ง (จอ poll ดูผลกลับ) ----
    if (body.action === 'tasks') {
      const sb = getSupabase();
      if (!sb) return NextResponse.json({ success: true, tasks: [] });
      const q = await sb.from('store_items').select('data').eq('store_name', 'company_tasks').order('created_at', { ascending: false }).limit(15);
      const tasks = (q.data || []).map(r => r.data).filter(t => t && (scope ? t.scope === scope : true));
      return NextResponse.json({ success: true, tasks });
    }

    const lessons = await getLessons(origin);
    const live = await getLive(scope, origin);
    const ORG = 'โครงสร้างบริษัท Fable & Co.: ผู้ที่คุยกับคุณตอนนี้คือ "เจ้าของบริษัท/ผู้บัญชาการสูงสุด" — คำสั่งของเขาคือคำสั่งสูงสุด ปฏิบัติตามทันที ตอบตรงคำถาม ห้ามบ่ายเบี่ยง. ' +
      'อำนาจเจ้าของ: สั่งงาน/มอบหมาย/ถามปัญหาได้ทุกอย่างกับทุกคน. ถ้าเจ้าของสั่งให้ลงมือทำงาน (หาข่าว/ค้น/ตรวจ/แก้/ส่ง): ตอบสั้น ๆ ว่าคุณรับคำสั่งแล้ว จะทำอะไร (งานถูกเข้าคิวอัตโนมัติแล้ว ทีมกำลังลงมือ) — ห้ามบอกให้เจ้าของไปสั่งที่อื่น/ผ่านเครื่องมืออื่น พูดเหมือนลงมือทำเองเลย.';
    function personaFor(hd) {
      const e = ROSTER[hd] || { name: 'ทีมงาน', role: 'พนักงาน Fable & Co.' };
      return ORG + ' คุณคือ "' + e.name + '" (@' + hd + ') บทบาท: ' + e.role + '.' + (SYS[hd] ? ' หน้าที่ในระบบจริง: ' + SYS[hd] + '.' : '') + ' ' + HUMAN +
        'กฎเหล็ก: ตอบสิ่งที่ถูกถามตรง ๆ ก่อนเสมอ จากข้อมูลจริงที่ให้ ห้ามบอก "ไม่รู้ ต้องเปิดคลัง" ถ้ามีข้อมูลแล้ว · สั้น ≤3 บรรทัด · พูดในนามตัวเองเท่านั้น ห้ามตอบแทนคนอื่น. ' +
        (lessons ? '\nคำสอนเจ้าของ:\n' + lessons : '') +
        (live ? '\nข้อมูลจริงในระบบ (อ้างอิงได้ ห้ามบอกไม่รู้):\n' + live : '') +
        '\nตอบ JSON {"reply":"<คำตอบ>"} เท่านั้น';
    }
    async function replyAs(hd) {
      const o = await callClaude({ prompt: 'คำถาม/คำสั่งจากเจ้าของ: "' + msg + '"' + historyBlock(body), systemPrompt: personaFor(hd), model: modelFor(hd), maxTokens: 900, temperature: 0.7 }).catch(function () { return null; });
      const r = (o && (o.reply || o.text || o.message)) || (typeof o === 'string' ? o : '');
      return { handle: hd, name: (ROSTER[hd] || {}).name || hd, reply: String(r || 'ตอบไม่ได้ตอนนี้') };
    }
    // ---- แจ้งบั๊กข้ามแผนก: @arch (ทีมวิศวะ) รับเรื่อง + เข้าคิวงานวิศวะให้แก้ ----
    if (body.action === 'bug') {
      const sbb = getSupabase();
      let bugTaskId = '';
      if (sbb) {
        const bid = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const brec = { id: bid, scope: 'engineering', assignee: 'arch', command: '[🐛 บั๊กจากห้อง ' + (scope || 'main') + '] ' + msg, status: 'pending', from: 'owner', ts: Date.now(), result: '', type: 'bug' };
        let bi = null;
        try { bi = await sbb.from('store_items').insert({ id: bid, store_name: 'company_tasks', data: brec, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); } catch (e) { bi = { error: e }; }
        if (bi && !bi.error) bugTaskId = bid;
      }
      const archAck = await replyAs('arch');
      return NextResponse.json({ success: true, from: 'arch', name: 'อาร์ค', reply: archAck.reply, bugTaskId: bugTaskId, note: 'ส่งบั๊กให้ทีมวิศวะแล้ว — เข้าคิวงานวิศวะ ผู้จัดการจะให้ทีมแก้' });
    }

    // @all → เราเตอร์เลือกเฉพาะคนที่เกี่ยวข้องจริง (กันทุกคนตอบจนรก/เปลือง)
    if (!h || h === 'all') {
      const rosterAll = scope === 'newsdesk' ? ['ton', 'ken', 'mod', 'nin', 'meen', 'fah', 'jo', 'rin']
        : scope === 'engineering' ? ['arch', 'beck', 'fon', 'qa', 'rev', 'zip']
        : ['oat', 'sun', 'hai'];
      const head = scope === 'newsdesk' ? 'ken' : scope === 'engineering' ? 'arch' : 'oat';
      const desc = rosterAll.map(function (hd) { return '@' + hd + '=' + ((ROSTER[hd] || {}).role || ''); }).join(' | ');
      let picked = [head];
      const rr = await callClaude({
        prompt: 'คำถาม/คำสั่งจากเจ้าของ: "' + msg + '"\nทีมในห้องนี้: ' + desc +
          '\n1. เลือกคนที่ "เกี่ยวข้องโดยตรง" มาตอบ (1-4 คน; ถ้าถามทีมอื่นเลือกแค่หัวหน้า @' + head + ').\n' +
          '2. นี่เป็น "คำสั่งให้ลงมือทำงานจริง" ไหม? (หาข่าว/เริ่มล่า/ตรวจงาน/ส่งข่าว/รันงาน/แก้ = true; ถาม/คุย/รายงานตัว/สรุป = false)\n' +
          'ตอบ JSON {"handles":["<handle>"], "isCommand": true/false} เท่านั้น',
        systemPrompt: 'คุณคือตัวจัดสรรว่าใครควรตอบในห้องแชทบริษัท เลือกให้น้อยและตรงประเด็นที่สุด ตอบ JSON ตามรูปแบบเท่านั้น',
        model: CLAUDE_MODEL.haiku, maxTokens: 200, temperature: 0.2
      }).catch(function () { return null; });
      const hs = (rr && Array.isArray(rr.handles)) ? rr.handles : [];
      const filtered = hs.map(function (x) { return String(x).replace('@', '').trim(); }).filter(function (hd) { return rosterAll.indexOf(hd) > -1; });
      if (filtered.length) picked = filtered.slice(0, 4);
      // คำสั่งให้ลงมือ → เข้าคิวงานอัตโนมัติ (ไม่ต้องกดปุ่มแยก) ผู้จัดการจะรันให้
      const isCmd = !!(rr && rr.isCommand);
      let queued = false;
      if (isCmd) {
        const sbq = getSupabase();
        if (sbq) {
          const tid = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const trec = { id: tid, scope: scope || 'main', assignee: 'all', command: msg, status: 'pending', from: 'owner', ts: Date.now(), result: '' };
          try { await sbq.from('store_items').insert({ id: tid, store_name: 'company_tasks', data: trec, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); queued = true; } catch (e) { /* ต่อคิวไม่ได้ = แค่ตอบ */ }
        }
      }
      const results = await Promise.all(picked.map(replyAs));
      return NextResponse.json({ success: true, roundtable: results.filter(x => x && x.reply), queued: queued, queuedNote: queued ? 'รับคำสั่งเข้าคิวแล้ว ✅ ผู้จัดการกำลังรันงานให้ — ดูผลที่ ＋ → 📋 งานที่สั่ง' : '' });
    }
    // เจาะจงคน → คนนั้นตอบด้วยสมองตัวเอง
    const one = await replyAs(h);
    return NextResponse.json({ success: true, from: h, name: one.name, reply: one.reply });
  } catch (error) {
    return NextResponse.json({ success: false, error: error && error.message || 'error', errorType: 'CHAT_ERROR' }, { status: 500 });
  }
}
