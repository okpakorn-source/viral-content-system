/**
 * News Desk — ศูนย์คำสั่งภาษาคน (ใช้ร่วมกัน เว็บ + Discord bot)
 * POST { text, user? } — สั่งด้วยภาษาไทยธรรมดา ระบบ route ให้เอง + ตอบกลับทาง Discord webhook เสมอ
 *
 * คำสั่งที่เข้าใจ:
 *   "สถานะ" / "คิว"              → สรุปสถานะโต๊ะ+คิว
 *   "หาข่าว" / "เก็บข่าว"          → เก็บข่าวรอบใหม่ทุกเลน
 *   "บก.น้ำดี ทำเลย" (มีคำว่า น้ำดี)  → บก.น้ำดีสแกน+ส่งเจน
 *   มีคำว่า ดราม่า/กระแส           → บก.ดราม่าสแกน+ส่งเจน
 *   มีคำว่า สัมภาษณ์/คลิป           → บก.สัมภาษณ์สแกน+ส่งเจน
 *   อื่นๆ ทั้งหมด                  → ส่งเป็นคำสั่งให้ บก.ใหญ่ (วิเคราะห์+จัดการ)
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { runHarvest, runEditorNow, notifyDiscord } from '@/lib/services/newsDesk/harvester';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

async function buildStatus() {
  const desk = createStore('news-desk');
  const queue = createStore('job_queue');
  const [items, jobs] = await Promise.all([desk.getAll(), queue.getAll()]);
  const today = new Date().toISOString().slice(0, 10);

  const fresh = items.filter(i => i.status === 'new' && Date.now() - new Date(i.harvestedAt || 0).getTime() < 36 * 3600e3);
  const sentToday = items.filter(i => i.status === 'sent' && String(i.sentAt || '').startsWith(today));
  const ready = items.filter(i => i.status === 'sent' && !i.used);
  const byEditor = {};
  for (const s of sentToday) {
    const who = s.pickedBy || (s.claimedBy ? `ทีม (${s.claimedBy})` : 'ทีม');
    byEditor[who] = (byEditor[who] || 0) + 1;
  }
  const pending = jobs.filter(j => j.status === 'pending').length;
  const processing = jobs.filter(j => j.status === 'processing').length;

  return [
    `## 📊 สถานะโต๊ะข่าว — ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} น.`,
    `🗃️ คลังพร้อมเลือก: **${fresh.length}** ใบ · ✅ พร้อมหยิบใช้: **${ready.length}** ใบ`,
    `✍️ คิวกำลังเขียน: **${processing}** · รอคิว: **${pending}**`,
    `📤 วันนี้ส่งทำ ${sentToday.length} ข่าว: ${Object.entries(byEditor).map(([k, v]) => `${k} ×${v}`).join(' · ') || '-'}`,
  ].join('\n');
}

export async function POST(request) {
  try {
    const { text = '', user = 'Discord' } = await request.json();
    const t = String(text).trim();
    if (!t) return NextResponse.json({ success: false, error: 'ต้องมีข้อความคำสั่ง', errorType: 'VALIDATION_ERROR' }, { status: 400 });

    // ① สถานะ
    if (/สถานะ|คิว|status/i.test(t) && t.length < 25) {
      const status = await buildStatus();
      await notifyDiscord(status);
      return NextResponse.json({ success: true, did: 'status', reply: status });
    }

    // ② เก็บข่าวรอบใหม่
    if (/^(หาข่าว|เก็บข่าว|harvest)/i.test(t)) {
      await notifyDiscord(`🔄 ${user} สั่งเก็บข่าวรอบใหม่ — กำลังทำ (~3-6 นาที)...`);
      const stats = await runHarvest({});
      const reply = `✅ เก็บเสร็จ: มา ${stats.harvested} · ผ่านคัด ${stats.added} · บก.ส่งเจนเอง ${stats.autoPicked || 0} ข่าว`;
      await notifyDiscord(reply);
      return NextResponse.json({ success: true, did: 'harvest', reply, stats });
    }

    // ③ สั่ง บก.รายฝ่าย
    const editorKey = /น้ำดี/.test(t) ? 'good' : /ดราม่า|กระแส/.test(t) ? 'drama' : /สัมภาษณ์|คลิป/.test(t) ? 'interview' : null;
    if (editorKey && /ทำเลย|สแกน|ลุย|เช็ค|ตรวจ/.test(t)) {
      const r = await runEditorNow(editorKey); // แจ้ง Discord ในตัวแล้ว
      return NextResponse.json({ success: true, did: 'editor-run', ...r });
    }

    // ④ ที่เหลือ = คำสั่งถึง บก.ใหญ่
    await notifyDiscord(`🧠 ${user} สั่ง บก.ใหญ่: "${t.slice(0, 120)}" — กำลังวิเคราะห์...`);
    const chiefRes = await fetch(`${request.nextUrl.origin}/api/news-desk/chief`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: t }),
    });
    const chief = await chiefRes.json();
    return NextResponse.json({ success: chief.success !== false, did: 'chief', orders: chief.orders, reply: (chief.orders || []).join(' · ') });
  } catch (error) {
    console.error('[DeskCommand]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'COMMAND_ERROR' }, { status: 500 });
  }
}
