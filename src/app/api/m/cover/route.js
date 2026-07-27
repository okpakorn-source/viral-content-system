/**
 * /api/m/cover — ประตูทำปกสำหรับแอพมือถือ /m (26 ก.ค. 69 — เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ต่อท่อเดียวกับ /quick-cover (/api/quick-test kind='ref' เต็มท่อ MEGA) แต่:
 *   - ด่านสิทธิ์ = ต้องล็อกอินยูสพนักงานจริง (session) — คนนอกไม่มี session โดน 401
 *   - ฝั่งเซิร์ฟเวอร์แนบคีย์ทีม (COVER_TEST_KEY) ให้เอง — คีย์ไม่เคยหลุดไปหน้าจอ
 *   - ด่าน middleware ของ /api/quick-test เดิมยังคุมการยิงตรงจากภายนอกเหมือนเดิมทุกประการ
 * GET  → รายการงานปก (สะท้อนจาก quick-test kinds=compose,ref เท่านั้น — คิวโต๊ะข่าวแยกคนละคลาส ไม่ปนกัน)
 * GET  ?view=archive&limit=24 → คลังปกล่าสุด — import listMegaCovers ตรง (แบบเดียวกับ /api/m/cover-editor) ไม่ hop HTTP
 * POST {newsTitle, content} → สร้างงานเต็มท่อ · POST {action:'delete', jobId} → ลบงาน (scope:'active' จำกัดคลาส compose/ref เท่านั้น)
 * ไฟล์ใหม่ล้วน ไม่แตะระบบข่าว/ระบบปกเดิม
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { listMegaCovers } from '@/lib/megaCoverArchive'; // ★ 27 ก.ค. 69 (sol-review ข้อ 6): เลิก hop HTTP ไป /api/mega-covers
import { readImages } from '@/lib/imageStore'; // ★ "ช่องเคส" (27 ก.ค. 69) — view=caseImages ใช้คลังรูปเดิมเป๊ะ (ตัวเดียวกับ /api/images/[id] + compose-test) ไม่สร้างที่เก็บใหม่

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
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): ล็อกโหมด 🤖 ให้ AI หา / ⚡ ทางลัด เฉพาะแอดมิน — ปิดหลังบ้านซ้ำกันยิงตรง (UI ซ่อนไปแล้ว)
    if (s.role !== 'admin') return NextResponse.json({ success: false, error: 'เฉพาะแอดมิน', errorType: 'FORBIDDEN' }, { status: 403 });

    // ⚡ ทางลัดประกอบ — รายการเคสจากคลัง (มีรูปพร้อมอยู่แล้ว ไม่ค้นรูปใหม่)
    if (request.nextUrl.searchParams.get('view') === 'cases') {
      const r = await fetch(`${request.nextUrl.origin}/api/mega/compose-test?list=1`, {
        headers: keyHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ 27 ก.ค. 69 (sol-review ข้อ 6): คลังปกล่าสุด (แท็บทำปกในแอพ) — import lib ตรง ไม่ hop HTTP ผ่าน /api/mega-covers
    //   แบบเดียวกับ src/app/api/m/cover-editor/route.js:50-57 (ไฟล์นั้นไม่แตะ — แค่ทำตามแพทเทิร์นเดียวกัน)
    if (request.nextUrl.searchParams.get('view') === 'archive') {
      const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '24', 10) || 24, 60);
      const all = await listMegaCovers(200);
      const items = (all || []).slice(0, limit).map((it) => ({ id: it.id, title: it.title || '', createdAt: it.at || null, source: it.source || '', qcStatus: it.qcStatus || null })); // ★ 27 ก.ค. 69: ป้าย 'manual_review' ให้จอ /m ขึ้นป้าย "รอตรวจ"
      return NextResponse.json({ success: true, items });
    }

    // ★ "ช่องเคส" (27 ก.ค. 69, เจ้าของขอ) — รายการภาพดิบของเคส AC-#### ให้เปิดดู/โหลดจากการ์ดในโหมด ⚡ ทางลัด
    //   ใช้คลังรูปเดิม (readImages) ตัวเดียวกับ GET /api/images/[id] และ /api/mega/compose-test — ไม่สร้างที่เก็บใหม่
    //   ล้มเงียบเฉพาะฝั่งอ่านคลัง (readImages พัง/ไม่มีข้อมูล) → คืนลิสต์ว่าง ไม่ throw ให้จอฝั่ง /m พัง
    if (request.nextUrl.searchParams.get('view') === 'caseImages') {
      const caseId = String(request.nextUrl.searchParams.get('caseId') || '').trim();
      if (!/^AC-\d+$/.test(caseId)) {
        return NextResponse.json({ success: false, error: 'caseId ไม่ถูกรูปแบบ (ต้องเป็น AC-#### )', errorType: 'BAD_INPUT' }, { status: 400 });
      }
      const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '60', 10);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 60, 1), 60);
      const imgs = await readImages(caseId).catch(() => []);
      const items = (Array.isArray(imgs) ? imgs : [])
        .filter((x) => x && typeof x.imageUrl === 'string' && x.imageUrl)
        .slice(0, limit)
        .map((x) => ({
          id: x.id || undefined,
          url: x.imageUrl,
          w: Number(x.realWidth) > 0 ? Number(x.realWidth) : undefined,
          h: Number(x.realHeight) > 0 ? Number(x.realHeight) : undefined,
          clean: x.triage && typeof x.triage.clean === 'boolean' ? x.triage.clean : undefined,
          person: x.triage && x.triage.person ? String(x.triage.person).slice(0, 60) : undefined,
        }));
      return NextResponse.json({ success: true, caseId, total: items.length, items });
    }

    // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): kinds=compose,ref — คิวนี้เป็นของงานปกเท่านั้น กันงานโต๊ะข่าว (desk_*) หลุดมาโผล่จอปก
    const r = await fetch(`${request.nextUrl.origin}/api/quick-test?limit=30&kinds=compose,ref`, {
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
    // ★ 27 ก.ค. 69 (เจ้าของสั่ง): ล็อกโหมด 🤖 ให้ AI หา / ⚡ ทางลัด เฉพาะแอดมิน — ปิดหลังบ้านซ้ำกันยิงตรง (UI ซ่อนไปแล้ว)
    if (s.role !== 'admin') return NextResponse.json({ success: false, error: 'เฉพาะแอดมิน', errorType: 'FORBIDDEN' }, { status: 403 });
    const body = await request.json().catch(() => ({}));

    // ลบงาน — ส่งต่อตรงๆ (เฉพาะ action ที่อนุญาต)
    // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): scope:'active' แนบ kinds:['compose','ref'] เสมอ — กันปุ่ม "ล้างคิวค้าง"
    //   ฝั่งทำปกไปลบงานโต๊ะข่าว (desk_*) ที่ค้างอยู่ด้วยโดยไม่ตั้งใจ (ประตูนี้มีแค่ปก แต่คิวจริงที่ /api/quick-test ใช้ร่วมกัน)
    if (body.action === 'delete') {
      const fwd = body.scope === 'active' ? { action: 'delete', scope: 'active', kinds: ['compose', 'ref'] } : { action: 'delete', jobId: String(body.jobId || '') };
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
