/**
 * ============================================================
 * 🤖 /api/company/worker — ผู้ช่วยอัตโนมัติของคิวงานบริษัท
 * ============================================================
 * เรียกโดย: Vercel cron (ทุกนาที) + จอออฟฟิศ (ทุก ~25 วิ ตอนเปิดอยู่)
 * 🗑️ 8 ส.ค. 69 โต๊ะข่าวถูกยุบถาวร (route /api/company/newsdesk-run ถูกลบ):
 *   เหลือหน้าที่เดียว — เจองาน "หาข่าว" ค้างคิว → ปิดด้วยคำตอบ "โต๊ะข่าวถูกยุบ" ตรงๆ (กันงานล้มเงียบด้วย 404)
 *   งานบริษัทอื่น (ประชุม/ส่งข่าว/แก้โค้ด) ไม่แตะเหมือนเดิม (ปล่อยผู้จัดการ)
 *   ปิดทั้งหมดได้ด้วย ENV COMPANY_WORKER_ENABLED='0'
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STORE = 'company_tasks';
const HUNT_RE = /หาข่าว|ล่าข่าว|รันรอบ|ค้นข่าว|รีเฟรช|หารอบ|เริ่มล่า|รอบหาข่าว/;
const RUNNING_TTL = 6 * 60 * 1000; // running เกินนี้ = ถือว่าค้าง/ตาย → mark failed กันคิวตัน

async function updateTask(sb, id, data) {
  return sb.from('store_items').update({ data, updated_at: new Date().toISOString() }).eq('id', id);
}

async function handle(request) {
  const t0 = Date.now();
  try {
    if (process.env.COMPANY_WORKER_ENABLED === '0') {
      return NextResponse.json({ success: true, idle: true, reason: 'worker ปิดอยู่ (ENV)' });
    }
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ success: true, idle: true, reason: 'ไม่มี Supabase' });
    const now = Date.now();

    const q = await sb.from('store_items').select('id,data').eq('store_name', STORE)
      .order('created_at', { ascending: false }).limit(50);
    if (q.error) return NextResponse.json({ success: false, error: q.error.message, errorType: 'WORKER_READ' }, { status: 500 });
    const rows = (q.data || []).map((r) => ({ id: r.id, d: (r && r.data) || {} }));

    // มีงาน running สด → ข้าม (กันรันซ้อน) · running ค้าง (>TTL) → mark failed ปลดคิว
    let busy = false;
    for (const r of rows) {
      if (r.d.status === 'running') {
        if (now - (Number(r.d.claimedAt) || 0) < RUNNING_TTL) { busy = true; }
        else { await updateTask(sb, r.id, { ...r.d, status: 'failed', result: 'ค้างเกินเวลา (auto-timeout)', doneAt: now }); }
      }
    }
    if (busy) return NextResponse.json({ success: true, idle: true, reason: 'มีงานกำลังรันอยู่' });

    // หา task ที่รันอัตโนมัติได้: pending + scope newsdesk + คำสั่งหาข่าว (เก่าสุดก่อน)
    const pending = rows
      .filter((r) => r.d.status === 'pending' && r.d.scope === 'newsdesk' && HUNT_RE.test(String(r.d.command || '')))
      .sort((a, b) => (Number(a.d.ts) || 0) - (Number(b.d.ts) || 0));
    const task = pending[0];
    if (!task) return NextResponse.json({ success: true, idle: true, reason: 'ไม่มีคำสั่งหาข่าวรอรัน' });

    // 🗑️ 8 ส.ค. 69: ปลายทางถูกลบแล้ว — ปิดงานค้างด้วยคำตอบตรงๆ (ครั้งละ 1 งาน cron รอบถัดไปเก็บใบต่อไปเอง)
    await updateTask(sb, task.id, {
      ...task.d, status: 'failed',
      result: 'โต๊ะข่าวถูกยุบถาวรแล้ว (8 ส.ค. 69) — คำสั่งหาข่าวไม่ทำงานอีกต่อไป', doneAt: now,
    });
    return NextResponse.json({ success: true, ran: false, taskId: task.id, note: 'ปิดงานค้าง: โต๊ะข่าวถูกยุบถาวรแล้ว', tookMs: Date.now() - t0 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error && error.message ? error.message : 'worker ล้มเหลว', errorType: 'WORKER_ERROR' }, { status: 500 });
  }
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
