/**
 * /api/m/cover — ประตูทำปกสำหรับแอพมือถือ /m (26 ก.ค. 69 — เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ต่อท่อเดียวกับ /quick-cover (/api/quick-test kind='ref' เต็มท่อ MEGA) แต่:
 *   - ด่านสิทธิ์ = ต้องล็อกอินยูสพนักงานจริง (session) — คนนอกไม่มี session โดน 401
 *   - ฝั่งเซิร์ฟเวอร์แนบคีย์ทีม (COVER_TEST_KEY) ให้เอง — คีย์ไม่เคยหลุดไปหน้าจอ
 *   - ด่าน middleware ของ /api/quick-test เดิมยังคุมการยิงตรงจากภายนอกเหมือนเดิมทุกประการ
 * GET  → รายการงานปก (สะท้อนจาก quick-test) · POST {newsTitle, content} → สร้างงานเต็มท่อ
 * POST {action:'delete', jobId} → ลบงาน — ไฟล์ใหม่ล้วน ไม่แตะระบบข่าว/ระบบปกเดิม
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';

async function sess() {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    return token ? await getSession(token) : null;
  } catch { return null; }
}

const keyHeaders = () => ({
  'Content-Type': 'application/json',
  ...(process.env.COVER_TEST_KEY ? { 'x-cover-test-key': process.env.COVER_TEST_KEY } : {}),
});

// ★ ชุด① sol-review 26 ก.ค. 69: ตรวจลิงก์คลิปเข้มขึ้น — ต้อง parse ผ่าน URL จริง + http(s) + hostname ไม่ว่าง (กัน "https://" เปล่า) + ยาว ≤500
const CLIP_URL_MAX_LEN = 500;
function isValidClipUrl(u) {
  const s = String(u || '').trim();
  if (!s || s.length > CLIP_URL_MAX_LEN) return false;
  try {
    const p = new URL(s);
    return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
  } catch { return false; }
}

export async function GET(request) {
  try {
    const s = await sess();
    if (!s) return NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });

    // ⚡ ทางลัดประกอบ — รายการเคสจากคลัง (มีรูปพร้อมอยู่แล้ว ไม่ค้นรูปใหม่)
    if (request.nextUrl.searchParams.get('view') === 'cases') {
      const r = await fetch(`${request.nextUrl.origin}/api/mega/compose-test?list=1`, {
        headers: keyHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    const r = await fetch(`${request.nextUrl.origin}/api/quick-test?limit=30`, {
      headers: keyHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_COVER_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const s = await sess();
    if (!s) return NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });
    const body = await request.json().catch(() => ({}));

    // ลบงาน — ส่งต่อตรงๆ (เฉพาะ action ที่อนุญาต)
    if (body.action === 'delete') {
      const fwd = body.scope === 'active' ? { action: 'delete', scope: 'active' } : { action: 'delete', jobId: String(body.jobId || '') };
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(), body: JSON.stringify(fwd), signal: AbortSignal.timeout(20000),
      });
      return NextResponse.json(await r.json(), { status: r.status });
    }

    // ⚡ ทางลัดประกอบ (kind='compose') — ประกอบปกจากคลังเคสเดิม ไม่ค้นรูปใหม่ เร็วกว่าเต็มท่อมาก
    if (body.kind === 'compose') {
      const caseId = String(body.caseId || '').trim();
      if (!caseId) {
        return NextResponse.json({ success: false, error: 'เลือกเคสก่อนกดประกอบปก', errorType: 'BAD_INPUT' }, { status: 400 });
      }
      const heroPersonHint = String(body.heroPersonHint || '').slice(0, 100) || undefined;
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ kind: 'compose', caseId, heroPersonHint }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // สร้างงานเต็มท่อ (kind='ref' เท่านั้น) — เกณฑ์ความยาวเดียวกับหน้า /quick-cover
    const newsTitle = String(body.newsTitle || '').slice(0, 200);
    const content = String(body.content || '');
    if (content.trim().length < 100) {
      return NextResponse.json({ success: false, error: `วางเนื้อข่าวเต็มก่อน (≥100 ตัวอักษร — ตอนนี้ ${content.trim().length})`, errorType: 'CONTENT_TOO_SHORT' }, { status: 400 });
    }
    const combined = [newsTitle.trim(), content.trim()].filter(Boolean).join('\n\n').length;
    if (combined < 200) {
      return NextResponse.json({ success: false, error: `เนื้อรวม (หัวข่าว+เนื้อ) ต้อง ≥200 ตัวอักษร — ตอนนี้ ${combined}`, errorType: 'CONTENT_TOO_SHORT' }, { status: 400 });
    }
    // ★ ชุด① 26 ก.ค. 69: ลิงก์คลิปต้นทาง 1-3 + สวิตช์ไม่ค้นเพิ่ม — validate แล้วส่งต่อ /api/quick-test
    //   sol-review: คงรูป payload เดิมเมื่อไม่ใช้ฟีเจอร์ — แนบ field เฉพาะมีค่าจริง (ไม่งั้น omit ไปเลย ห้าม [] / false)
    const clipUrls = (Array.isArray(body.clipUrls) ? body.clipUrls : [])
      .map((u) => String(u || '').trim()).filter(isValidClipUrl).slice(0, 3);
    const sourceOnly = body.sourceOnly === true;
    const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
      method: 'POST', headers: keyHeaders(),
      body: JSON.stringify({ kind: 'ref', newsTitle, content, ...(clipUrls.length ? { clipUrls } : {}), ...(sourceOnly ? { sourceOnly: true } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json();
    return NextResponse.json(d, { status: r.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'M_COVER_ERROR' }, { status: 500 });
  }
}
