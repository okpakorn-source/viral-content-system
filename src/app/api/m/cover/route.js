/**
 * /api/m/cover — ประตูทำปกสำหรับแอพมือถือ /m (26 ก.ค. 69 — เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * ต่อท่อเดียวกับ /quick-cover (/api/quick-test kind='ref' เต็มท่อ MEGA) แต่:
 *   - ด่านสิทธิ์ = ต้องล็อกอินยูสพนักงานจริง (session) — คนนอกไม่มี session โดน 401
 *   - ฝั่งเซิร์ฟเวอร์แนบคีย์ทีม (COVER_TEST_KEY) ให้เอง — คีย์ไม่เคยหลุดไปหน้าจอ
 *   - ด่าน middleware ของ /api/quick-test เดิมยังคุมการยิงตรงจากภายนอกเหมือนเดิมทุกประการ
 * GET  → รายการงานปก (สะท้อนจาก quick-test kinds=compose,ref เท่านั้น — คิวโต๊ะข่าวแยกคนละคลาส ไม่ปนกัน)
 * GET  ?view=archive&limit=24 → คลังปกล่าสุด — import listMegaCovers ตรง (แบบเดียวกับ /api/m/cover-editor) ไม่ hop HTTP
 * GET  ?view=refs → ★ 27 ก.ค. ค่ำ (ปุ่ม "เปลี่ยนต้นแบบ"): 20 ต้นแบบ "เพจจริง" จากคลัง /api/ref-covers (ชื่อ+ยอดไลค์แกะจากชื่อไฟล์)
 * GET  ?view=rev → ★ 28 ก.ค. 69 (รอบ 2 — global ทั้งแอพ): {mRev} เฉยๆ ไม่ต้องล็อกอิน (ก่อนด่าน session ตั้งใจ) — เช็ครุ่นแอพได้แม้ session หลุด
 * POST {newsTitle, content} → สร้างงานเต็มท่อ · POST {action:'delete', jobId} → ลบงาน (scope:'active' จำกัดคลาส compose/ref เท่านั้น)
 * POST {kind:'compose', caseId, heroPersonHint?, refId?} → ★ 27 ก.ค. ค่ำ: เติม refId ให้ปุ่ม "เปลี่ยนต้นแบบ" ยิงต่อ (ของเดิมส่งแค่ caseId/heroPersonHint)
 * POST {kind:'composeFrozen', caseId, refId, slotPlan} → ★ ใหม่ 27 ก.ค. ค่ำ (ปุ่ม "เปลี่ยนภาพรายช่อง"): ยิงตรง /api/mega/compose-test โหมด slotPlan แช่แข็ง
 *   (ไม่ผ่านคิว quick-test — compose-test โหมดนี้ไม่รองรับผ่าน callOnce ปัจจุบัน ห้ามแก้ compose-test) รันสั้น (~20-30 วิ ข้าม S6/compass) จึงตอบ sync ในคำขอเดียว
 * ไฟล์ใหม่ล้วน ไม่แตะระบบข่าว/ระบบปกเดิม
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ★ 29 ก.ค. 69 (lane2 audit-queue-stability #3): 120→300 — kind='compose' ยิงต่อ /api/quick-test ซึ่งบน cloud
//   dispatch รัน callOnce แบบ synchronous ได้ถึง maxDuration=300 ของตัวมันเอง (quick-test/route.js:22) เดิม 120
//   ของไฟล์นี้จะโดน Vercel ตัด function ก่อนที่ quick-test จะตอบกลับเสร็จเสมอ ไม่ว่าจะแก้ AbortSignal ด้านล่างแค่ไหน
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { listMegaCovers } from '@/lib/megaCoverArchive'; // ★ 27 ก.ค. 69 (sol-review ข้อ 6): เลิก hop HTTP ไป /api/mega-covers
import { readImages } from '@/lib/imageStore'; // ★ "ช่องเคส" (27 ก.ค. 69) — view=caseImages ใช้คลังรูปเดิมเป๊ะ (ตัวเดียวกับ /api/images/[id] + compose-test) ไม่สร้างที่เก็บใหม่
import { M_APP_REV } from '@/lib/mAppRev'; // ★ 28 ก.ค. 69 (แก้บั๊ก "มือถือค้างบันเดิลรุ่นเก่า"): แนบรุ่นแอพให้ /m เทียบ+เตือนรีโหลดเอง

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
    // ★ 28 ก.ค. 69 (รอบ 2 — ยกเช็ครุ่นเป็น global ทั้งแอพ): ?view=rev ไม่ต้องล็อกอิน — วางไว้ "ก่อน" ด่าน session/แอดมินตั้งใจ
    //   ไม่มีข้อมูลลับ มีแค่เลขรุ่น (M_APP_REV) ให้เช็คได้แม้ session หลุด/คุกกี้หมดอายุ (จอตายเงียบเพราะ 401 ก่อนไม่เห็น mRev)
    if (request.nextUrl.searchParams.get('view') === 'rev') {
      return NextResponse.json({ success: true, mRev: M_APP_REV });
    }

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
      // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 3 — "งานเก่ากดปุ่มไม่มีอะไรเกิด"): เจาะดูใบเดียวด้วย id= — งานปกที่สร้างก่อนอัปเดตนี้
      //   ไม่มี r.caseId/r.imageCaseId ติดมากับผลงาน (quick-test เพิ่งเริ่มเก็บให้) แต่มี archivedId/archiveId ชี้เข้าคลังนี้ได้
      //   → หยิบ imageCaseId ของใบนั้นจากคลังมาใช้แทนได้ ไม่ต้องดึงทั้งลิสต์ 200 ใบ
      const idParam = request.nextUrl.searchParams.get('id');
      if (idParam) {
        const all = await listMegaCovers(500);
        const hit = (all || []).find((it) => it.id === idParam);
        if (!hit) return NextResponse.json({ success: false, error: 'ไม่พบปกนี้ในคลัง', errorType: 'NOT_FOUND' }, { status: 404 });
        return NextResponse.json({ success: true, item: { id: hit.id, title: hit.title || '', createdAt: hit.at || null, source: hit.source || '', qcStatus: hit.qcStatus || null, imageCaseId: hit.imageCaseId || null } });
      }
      const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '24', 10) || 24, 60);
      const all = await listMegaCovers(200);
      // ★ เติม imageCaseId ต่อใบ (มีอยู่แล้วในเรคคอร์ด — แค่ของเดิมไม่ส่งออกมาให้จอ) ให้ฝั่งแอพหาย้อนจาก state คลังที่โหลดไว้แล้วได้เลยโดยไม่ต้องยิงซ้ำ
      const items = (all || []).slice(0, limit).map((it) => ({ id: it.id, title: it.title || '', createdAt: it.at || null, source: it.source || '', qcStatus: it.qcStatus || null, imageCaseId: it.imageCaseId || null })); // ★ 27 ก.ค. 69: ป้าย 'manual_review' ให้จอ /m ขึ้นป้าย "รอตรวจ"
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

    // ★ 27 ก.ค. ค่ำ (ปุ่ม "เปลี่ยนต้นแบบ"): 20 ต้นแบบ "เพจจริง" จากคลัง ref-covers — ผ่านประตูนี้ (session/แอดมิน) แทนยิง /api/ref-covers ตรง
    //   (endpoint นั้นเปิดไม่มีด่านสิทธิ์เอง — ไม่อยากให้จอ /m เปิดช่องยิงตรงข้ามด่านที่มี) ชื่อไฟล์แพทเทิร์น "เพจจริง-<ยอดไลค์>k-<หัวข้อ>"
    if (request.nextUrl.searchParams.get('view') === 'refs') {
      const r = await fetch(`${request.nextUrl.origin}/api/ref-covers`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const items = (Array.isArray(d.items) ? d.items : [])
        .filter((it) => /^เพจจริง/i.test(String(it?.styleName || '')))
        .slice(0, 20)
        .map((it) => {
          const m = /^เพจจริง-([^-]+)-(.*)$/i.exec(String(it.styleName || ''));
          return { id: it.id, styleName: it.styleName, likes: m ? m[1] : null, title: (m ? m[2] : it.styleName || '').slice(0, 60) };
        });
      return NextResponse.json({ success: true, items });
    }

    // ★ 27 ก.ค. 69 (sol-review วิกฤต 2): kinds=compose,ref — คิวนี้เป็นของงานปกเท่านั้น กันงานโต๊ะข่าว (desk_*) หลุดมาโผล่จอปก
    const r = await fetch(`${request.nextUrl.origin}/api/quick-test?limit=30&kinds=compose,ref`, {
      headers: keyHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    // ★ 28 ก.ค. 69: แนบรุ่นแอพปัจจุบันติด payload งานปก — /m เทียบกับ M_APP_REV ของตัวเอง ต่างกัน = บันเดิลมือถือค้างรุ่นเก่า
    return NextResponse.json({ ...d, mRev: M_APP_REV }, { status: r.status });
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
    // ★ 27 ก.ค. ค่ำ: เติม refId (ไม่บังคับ) — ให้ปุ่ม "ประกอบใหม่ทั้งปก"/"เปลี่ยนตัวเอก"/"เปลี่ยนต้นแบบ" ใช้ทางเดียวกันนี้ได้
    //   (quick-test เดิมรับ+ส่งต่อ refId ให้ compose-test อยู่แล้ว — แค่ประตูนี้ไม่เคยส่งต่อ ไม่แตะ quick-test)
    if (body.kind === 'compose') {
      const caseId = String(body.caseId || '').trim();
      if (!caseId) {
        return NextResponse.json({ success: false, error: 'เลือกเคสก่อนกดประกอบปก', errorType: 'BAD_INPUT' }, { status: 400 });
      }
      const heroPersonHint = String(body.heroPersonHint || '').slice(0, 100) || undefined;
      const refId = String(body.refId || '').trim() || undefined;
      // ★ 29 ก.ค. 69 (lane2 audit-queue-stability #3 — ปุ่ม "⚡ ทางลัด" ล้มหลอก): เดิม 30000ms ตายตัว ไม่ตรงพฤติกรรม
      //   จริงของ /api/quick-test ที่มันเรียก — บน cloud dispatch (effective='cloud' เสมอบน Vercel ที่ /m ใช้งานจริง)
      //   quick-test await runJob() แบบ sync ก่อนตอบ ซึ่ง callOnce ของ compose มี timeout ภายในสูงถึง 5 นาที
      //   (quick-test/route.js:84) และคอมเมนต์หัวไฟล์ก็บอกปกติ ~20-80 วิ — ทั้งสองค่านี้เกิน 30 วิเดิมได้ง่ายๆ
      //   ผลเดิม: fetch ฝั่งนี้ถูก abort ก่อน แต่งานจริงฝั่ง quick-test ยังรันต่อจนจบ (ไม่ได้ถูกยกเลิกจริง) →
      //   ผู้ใช้เห็น error หลอกทั้งที่งานสำเร็จ แล้วมักกดซ้ำ = ยิง AI/ประกอบภาพซ้ำโดยไม่จำเป็น (เสียเงินซ้ำ)
      //   ยกเป็น 300000ms ให้ ≥ เพดานจริงของ quick-test (5 นาที) เสมอ — คู่กับ maxDuration ของไฟล์นี้ (120→300 ด้านบน)
      const r = await fetch(`${request.nextUrl.origin}/api/quick-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ kind: 'compose', caseId, heroPersonHint, refId }),
        signal: AbortSignal.timeout(300000),
      });
      const d = await r.json();
      return NextResponse.json(d, { status: r.status });
    }

    // ★ ใหม่ 27 ก.ค. ค่ำ (ปุ่ม "เปลี่ยนภาพรายช่อง"): ประกอบใหม่แบบ "แผนแช่แข็ง" — คงตำแหน่งภาพเดิมทุกช่อง ยกเว้นช่องที่เลือกแทน
    //   ยิงตรง /api/mega/compose-test (ห้ามแก้ไฟล์นั้น) ไม่ผ่านคิว quick-test เพราะ callOnce ปัจจุบันไม่ส่ง slotPlan ต่อ (ห้ามแก้ตรงนั้นด้วย)
    //   รันสั้น (ข้าม S6/compass) จึงตอบ sync ในคำขอเดียว — ฝั่งแอพเอาไปสร้างเป็น "งานจำลอง" โชว์ในแถบงานเอง
    if (body.kind === 'composeFrozen') {
      const caseId = String(body.caseId || '').trim();
      const refId = String(body.refId || '').trim();
      // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): บังคับ isValidClipUrl ต่อ entry ก่อนส่งเข้า compose-test — กัน path "/..." อ่านไฟล์นอก public,
      //   SSRF (ยิง URL ภายในเน็ตเวิร์ก), และ data: URL ยักษ์หลุดเข้ามาปนแล้วทำ payload บวม (คลังภาพจริงเป็น https ทั้งหมดอยู่แล้ว ไม่กระทบ flow ปกติ)
      const slotPlan = (Array.isArray(body.slotPlan) ? body.slotPlan : [])
        .filter((e) => e && typeof e.url === 'string' && isValidClipUrl(e.url))
        .slice(0, 8)
        .map((e) => ({ url: String(e.url), slot: e.slot ? String(e.slot).slice(0, 20) : null, isHero: !!e.isHero }));
      if (!caseId) return NextResponse.json({ success: false, error: 'ต้องระบุ caseId', errorType: 'BAD_INPUT' }, { status: 400 });
      if (!refId) return NextResponse.json({ success: false, error: 'ปกนี้ไม่มีข้อมูลต้นแบบเดิม (refId) — ลองกดประกอบใหม่ก่อน', errorType: 'BAD_INPUT' }, { status: 400 });
      if (slotPlan.length < 3) return NextResponse.json({ success: false, error: 'ต้องมีอย่างน้อย 3 ช่องภาพ', errorType: 'BAD_INPUT' }, { status: 400 });
      const r = await fetch(`${request.nextUrl.origin}/api/mega/compose-test`, {
        method: 'POST', headers: keyHeaders(),
        body: JSON.stringify({ caseId, refId, slotPlan }),
        signal: AbortSignal.timeout(100000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        return NextResponse.json({ success: false, error: d.error || `HTTP ${r.status}`, errorType: d.errorType || 'COMPOSE_FROZEN_FAILED' }, { status: r.status || 500 });
      }
      // ★ frozen mode ของ compose-test ไม่เข้าคลัง /mega-covers (ข้ามขั้นตอน archive เอง ดูโค้ด compose-test บรรทัด ~130-139)
      //   → ไม่มี archivedId ให้ทำ /api/mega-covers/img?id=.. เหมือนสายปกติ ใช้ data URL จาก base64 แสดง/โหลดตรงแทน
      // ★ แก้บั๊ก (รีวิว 27 ก.ค. ค่ำ รอบ 2): composeAndVerify คืน d.base64 เป็น data URL "data:image/jpeg;base64,..." อยู่แล้ว
      //   ของเดิมใส่ prefix ซ้ำชั้นสอง → ภาพไม่ขึ้นเลย (ไม่ใช่ data URL ที่ถูกต้องอีกต่อไป)
      return NextResponse.json({
        success: true,
        result: {
          template: d.template || null,
          refSimilarity: d.refSimilarity ?? null,
          coverImgUrl: d.base64 || null,
          caseId: d.caseId || caseId,
          refUsed: d.refUsed?.id ? { id: d.refUsed.id, styleName: d.refUsed.styleName || null } : null,
          slotPlanUsed: Array.isArray(d.slotPlanUsed)
            ? d.slotPlanUsed.filter((e) => e && e.slot).map((e) => ({ url: e.url, slot: e.slot, isHero: !!e.isHero }))
            : slotPlan,
        },
      });
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
