/**
 * ============================================================
 * 🤖 /api/company/worker — ผู้ช่วยอัตโนมัติ ดึงคำสั่งจากคิวมารันเอง (แก้ "สั่งแล้วไม่ไปทำ")
 * ============================================================
 * เรียกโดย: Vercel cron (ทุกนาที) + จอออฟฟิศ (ทุก ~25 วิ ตอนเปิดอยู่)
 * ทำ: อ่าน company_tasks → เจอคำสั่ง "หาข่าว/รันรอบ" ที่ยัง pending → รัน /api/company/newsdesk-run จริง → อัปเดตสถานะ done/failed
 *
 * 🔴 กันเงินรั่ว (สำคัญมาก):
 *   - เคลม task เป็น 'running' ก่อนรันเสมอ (ถ้ารันล้มก็เป็น failed ไม่ใช่ pending) → cron ไม่รันซ้ำ = ไม่เผาเงินซ้ำ
 *   - รันได้ทีละ 1 งาน/ครั้ง + ถ้ามีงาน running อยู่ (ไม่เกิน 6 นาที) ข้าม
 *   - เฉพาะคำสั่ง "หาข่าว" เท่านั้น (งานถูก ~฿0.44) — ประชุม/ส่งข่าว/แก้โค้ด ไม่แตะ (ปล่อยผู้จัดการ)
 *   - ปิดทั้งหมดได้ด้วย ENV COMPANY_WORKER_ENABLED='0'
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { writeFeed } from '@/lib/company/companyFeed';

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
    const base = new URL(request.url).origin;
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

    // เคลม (optimistic): running + token แล้วอ่านซ้ำยืนยันเป็นของเรา
    const token = 'w_' + now + '_' + Math.random().toString(36).slice(2, 8);
    const claimed = { ...task.d, status: 'running', claimedAt: now, worker: token };
    const up = await updateTask(sb, task.id, claimed);
    if (up.error) return NextResponse.json({ success: true, idle: true, reason: 'เคลมงานไม่สำเร็จ' });
    const rc = await sb.from('store_items').select('data').eq('id', task.id).single();
    if (!rc.data || !rc.data.data || rc.data.data.worker !== token) {
      return NextResponse.json({ success: true, idle: true, reason: 'งานถูกเคลมโดยตัวอื่น' });
    }

    // รันรอบหาข่าวจริง
    await writeFeed({ scope: 'newsdesk', kind: 'worklog', agent: 'mod',
      text: '🤖 ผู้ช่วยอัตโนมัติรับคำสั่ง: "' + String(task.d.command || '').slice(0, 60) + '" → เริ่มรันรอบหาข่าว' });

    let ok = false, resultText = '';
    try {
      const rr = await fetch(base + '/api/company/newsdesk-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topClusters: 2, queriesPerCluster: 3 }),
      });
      const result = await rr.json().catch(() => ({}));
      ok = !!(result && result.success);
      resultText = ok
        ? ('เก็บ ' + (result.saved || 0) + ' ลีด · ฿' + (Number(result.costTHB) || 0).toFixed(2) + ' · เจอ ' + (result.found || 0))
        : ('ติดปัญหา: ' + (result.error || 'ไม่ทราบสาเหตุ'));
    } catch (e) {
      resultText = 'ติดปัญหา: ' + (e && e.message ? e.message : 'เชื่อมต่อล้มเหลว');
    }

    await updateTask(sb, task.id, { ...claimed, status: ok ? 'done' : 'failed', result: resultText, doneAt: Date.now() });

    return NextResponse.json({ success: true, ran: true, taskId: task.id, ok, result: resultText, tookMs: Date.now() - t0 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error && error.message ? error.message : 'worker ล้มเหลว', errorType: 'WORKER_ERROR' }, { status: 500 });
  }
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
