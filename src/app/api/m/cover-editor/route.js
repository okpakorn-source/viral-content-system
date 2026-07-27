/**
 * /api/m/cover-editor — ประตูเดียวของ "แต่งปกแมนวล" ในแอพ /m (26 ก.ค. 69 — เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ทุกเส้นต้องล็อกอินยูสพนักงานจริงก่อน (endpoint ปลายทางบางตัวเปลือย — ห้ามให้แอพยิงตรง)
 *   GET ?view=templates        → เทมเพลตทั้งหมด (builtin + จาก /api/templates) normalize แล้ว
 *   GET ?view=archive&limit=   → ปกที่แต่งจากแอพ (source='m-editor')
 *   POST {action:'save', base64, title, draftId, templateId} → บันทึกลงคลังปก
 * ไฟล์ใหม่ล้วน — ไม่แตะระบบข่าว/ระบบปกเดิม
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { addMegaCover, listMegaCovers } from '@/lib/megaCoverArchive';
import { BUILTIN_TEMPLATES, normalizeTemplateToCanvas } from '@/lib/cover-editor/draw';

async function sess() {
  try {
    const c = await cookies();
    const t = c.get('auth_token')?.value;
    return t ? await getSession(t) : null;
  } catch { return null; }
}
const UNAUTH = () => NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });

export async function GET(request) {
  try {
    const s = await sess();
    if (!s) return UNAUTH();
    const view = request.nextUrl.searchParams.get('view') || 'templates';

    if (view === 'templates') {
      let extra = [];
      try {
        const r = await fetch(`${request.nextUrl.origin}/api/templates`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.templates || d.items || []);
        extra = arr.filter(t => t && Array.isArray(t.slots) && t.slots.length);
      } catch { /* ดึงไม่ได้ = ใช้ builtin อย่างเดียว ไม่ล้ม */ }
      const seen = new Set();
      const all = [...BUILTIN_TEMPLATES, ...extra]
        .filter(t => { if (!t?.id || seen.has(t.id)) return false; seen.add(t.id); return true; })
        .map(normalizeTemplateToCanvas);
      return NextResponse.json({ success: true, templates: all });
    }

    if (view === 'archive') {
      const limit = Math.min(60, Number(request.nextUrl.searchParams.get('limit')) || 24);
      const all = await listMegaCovers(200);
      const items = (all || [])
        .filter(x => x && x.source === 'm-editor')
        .slice(0, limit)
        .map(x => ({ id: x.id, title: x.title || '', createdAt: x.createdAt || x.at || null, by: x.by || '', template: x.template || '', qcStatus: x.qcStatus || null })); // ★ 27 ก.ค. 69: ป้าย 'manual_review' ให้จอขึ้นป้าย "รอตรวจ"
      return NextResponse.json({ success: true, items });
    }

    return NextResponse.json({ success: false, error: 'view ไม่รู้จัก' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'COVER_EDITOR_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const s = await sess();
    if (!s) return UNAUTH();
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'save') {
      return NextResponse.json({ success: false, error: 'action ไม่รู้จัก' }, { status: 400 });
    }
    const base64 = String(body.base64 || '');
    if (!/^data:image\/(png|jpe?g);base64,/.test(base64)) {
      return NextResponse.json({ success: false, error: 'ภาพไม่ถูกต้อง', errorType: 'INVALID_IMAGE' }, { status: 400 });
    }
    if (base64.length > 4_000_000) {
      return NextResponse.json({ success: false, error: 'ไฟล์ใหญ่เกิน — ลองลดจำนวนช่องหรือบันทึกใหม่', errorType: 'IMAGE_TOO_LARGE' }, { status: 413 });
    }
    const draftId = /^[A-Za-z0-9_-]{1,40}$/.test(String(body.draftId || '')) ? String(body.draftId) : null;
    const who = s.displayName || s.username;

    const saved = await addMegaCover({
      id: draftId,
      base64,
      title: String(body.title || '').slice(0, 300) || `ปกแต่งเอง ${who}`,
      source: 'm-editor',
      template: String(body.templateId || ''),
      by: who,
      throughMega: false,
    });

    // ยืนยันว่าเข้าคลังจริง (addMegaCover เขียนเมตาล้มแบบเงียบได้)
    let confirmed = true;
    try {
      const all = await listMegaCovers(50);
      confirmed = !!(all || []).find(x => x?.id === saved?.id);
    } catch { confirmed = false; }

    return NextResponse.json({
      success: true,
      id: saved?.id || null,
      confirmed,
      imgUrl: saved?.id ? `/api/mega-covers/img?id=${saved.id}` : null,
      note: confirmed ? undefined : 'บันทึกภาพแล้ว แต่ยังไม่ยืนยันว่าขึ้นในรายการคลัง',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'COVER_SAVE_ERROR' }, { status: 500 });
  }
}
