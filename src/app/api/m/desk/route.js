/**
 * /api/m/desk — ประตูโต๊ะข่าวกลาง (v1) สำหรับแอพมือถือ /m (27 ก.ค. 69 — ชุด B ชุบชีวิตโต๊ะข่าว, เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ต่อท่อเดียวกับ /news-desk (v1) แต่:
 *   - ด่านสิทธิ์ = ต้องล็อกอินยูสพนักงานจริง (session) + เฉพาะแอดมินเท่านั้น (พนักงานโดน 403)
 *   - จำกัด action ที่ยิงต่อได้เฉพาะ whitelist ข้างล่าง — ห้ามแอพยิงตรงเข้า /api/news-desk/* เปลือย
 *   - ผู้ใช้ = ดึงจาก session เสมอ (ปลอมไม่ได้จากฝั่ง client)
 * 🔴 ห้ามแตะ /api/news-desk/* — ไฟล์นี้เป็นแค่ประตูส่งต่อ ไม่มี business logic ใหม่
 * GET  ?view=feed&tab=all|trend|good      → forward GET /api/news-desk?tab=...&limit=30 (tab ผิด = 400)
 * POST {action:'harvest', mode}           → forward POST /api/news-desk/harvest {mode} (mode ต้องอยู่ใน HARVEST_MODE_KEYS เท่านั้น)
 * POST {action:'chief'}                   → forward POST /api/news-desk/chief
 * POST {action:'card', cardAction, id}    → forward POST /api/news-desk {action:cardAction, id, user}
 * ★ sol-review 27 ก.ค. 69: ตัด `lanes` ออกจาก gateway (UI ส่งแต่ mode — กันยิง mode มั่วแล้วปลายทางตกไปรันหนักทุกเลน)
 *   + ตัด editorRun ออกจาก whitelist (รอบนี้ไม่มีปุ่มใช้จริง — ลด surface, ค่อยคืนตอนมีปุ่ม)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150; // harvest/chief ฝั่งจริงใช้เวลานาน — ให้บัฟเฟอร์เกิน timeout ภายใน 120s

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { HARVEST_MODE_KEYS } from '@/lib/services/newsDesk/taxonomy'; // ★ sol-review: whitelist mode จากคีย์จริง (มี 'all' รวมอยู่แล้ว) ไม่ hardcode ซ้ำ

async function sess() {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    return token ? await getSession(token) : null;
  } catch { return null; }
}

const unauthorized = () => NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });
const forbidden = () => NextResponse.json({ success: false, error: 'เฉพาะแอดมิน', errorType: 'FORBIDDEN' }, { status: 403 });

// ── whitelist ทางเข้า — เพิ่มทีหลังได้ แต่ห้ามเปิดกว้างเป็น pass-through เปลือย ──
const FEED_TABS = new Set(['all', 'trend', 'good']);
const POST_ACTIONS = new Set(['harvest', 'chief', 'card']); // ★ sol-review 27 ก.ค. 69: ตัด editorRun ออก — ยังไม่มีปุ่มใช้จริงรอบนี้
// ★ ตัดสินใจ 27 ก.ค. 69: การ์ดในแอพมือถือมีแค่ 2 ปุ่ม (ส่งเขียน/ทิ้ง) — จำกัด cardAction เท่าที่ UI ใช้จริง
//   'sendWorkflow' (ไม่ใช่ 'sent') เพราะเป็นตัวที่ส่งเข้า /api/queue/add จริง (ดู src/app/api/news-desk/route.js action=sendWorkflow)
//   'sent' เดิมแค่ mark สถานะเฉยๆ ไม่ได้ส่งงานจริง — ใช้ sendWorkflow ตรงๆ กันเขียนตรรกะสร้าง input ซ้ำซ้อนฝั่งนี้
const CARD_ACTIONS = new Set(['dismiss', 'sendWorkflow']);

export async function GET(request) {
  try {
    const s = await sess();
    if (!s) return unauthorized();
    if (s.role !== 'admin') return forbidden();

    const view = request.nextUrl.searchParams.get('view') || 'feed';
    if (view !== 'feed') {
      return NextResponse.json({ success: false, error: `view ไม่รู้จัก: ${view}`, errorType: 'BAD_VIEW' }, { status: 400 });
    }
    const tab = request.nextUrl.searchParams.get('tab') || 'all';
    // ★ sol-review 27 ก.ค. 69: tab ผิด → ตอบ 400 ตรงๆ (เลิก fallback เงียบเป็น 'all')
    if (!FEED_TABS.has(tab)) {
      return NextResponse.json({ success: false, error: `tab ไม่รู้จัก: ${tab}`, errorType: 'BAD_TAB' }, { status: 400 });
    }

    const r = await fetch(`${request.nextUrl.origin}/api/news-desk?tab=${tab}&limit=30`, {
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_DESK_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const s = await sess();
    if (!s) return unauthorized();
    if (s.role !== 'admin') return forbidden();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!POST_ACTIONS.has(action)) {
      return NextResponse.json({ success: false, error: `action ไม่รู้จัก: ${action}`, errorType: 'BAD_ACTION' }, { status: 400 });
    }
    const user = s.displayName || s.username || 'ทีม';

    // ★ ล่าข่าวรอบใหม่ — โหมดต้องอยู่ใน HARVEST_MODE_KEYS เท่านั้น (fresh/viral/evergreen/celeb/followup/all)
    //   ★ sol-review 27 ก.ค. 69: ตัด `lanes` ออกจาก gateway ไปเลย (UI ส่งแต่ mode — กันยิง mode มั่วแล้วปลายทางตกไปรันหนักทุกเลน)
    if (action === 'harvest') {
      const mode = String(body.mode || '');
      if (!HARVEST_MODE_KEYS.includes(mode)) {
        return NextResponse.json({ success: false, error: `mode ไม่ถูกต้อง: ${mode}`, errorType: 'BAD_MODE' }, { status: 400 });
      }
      const r = await fetch(`${request.nextUrl.origin}/api/news-desk/harvest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(120000), // งานล่าใช้เวลานาน (ฝั่งจริง maxDuration 600s)
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ บก.ใหญ่ — วินิจฉัยภาพรวมโต๊ะ + สั่งลาดตระเวนเพิ่ม
    if (action === 'chief') {
      const r = await fetch(`${request.nextUrl.origin}/api/news-desk/chief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(120000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ แอ็กชันการ์ด — จำกัดเฉพาะ dismiss/sendWorkflow (ดูเหตุผลที่ CARD_ACTIONS ด้านบน)
    if (action === 'card') {
      const cardAction = String(body.cardAction || '');
      if (!CARD_ACTIONS.has(cardAction)) {
        return NextResponse.json({ success: false, error: `cardAction ไม่รู้จัก: ${cardAction}`, errorType: 'BAD_CARD_ACTION' }, { status: 400 });
      }
      const id = String(body.id || '').trim();
      if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'BAD_INPUT' }, { status: 400 });
      const r = await fetch(`${request.nextUrl.origin}/api/news-desk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: cardAction, id, user }),
        signal: AbortSignal.timeout(30000), // sendWorkflow เรียก /api/queue/add ต่อ + watchlist ข้างในตัวเอง มี race กันเองแล้ว
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_DESK_ERROR' }, { status: 500 });
  }
}
