// ============================================================
// POST /api/mega-covers/save — บันทึกปกที่คน "แก้เองในเอดิเตอร์" เข้าคลัง MEGA
// ------------------------------------------------------------
// body: { base64 (data URL image), title, refJobId }
//   → addMegaCover({ source:'editor', humanEdited:true, throughMega:false, ... })
//   คืน { success, id, coverPath }
// ★ นโยบายภาพ: ปกนี้ export จาก canvas ที่คนจัดเอง (ภาพต้นฉบับ crop/resize ธรรมดา) —
//   ไม่มี AI enhance/generate ในเส้นนี้ (ปุ่ม enhance ในเอดิเตอร์เป็นคนกดเองแยกต่างหาก)
// ============================================================

import { NextResponse } from 'next/server';
import { addMegaCover } from '@/lib/megaCoverArchive';

export const runtime = 'nodejs';

// ★ 17 ก.ค.: กันช่องโหว่ที่ผู้ตรวจสั่งแก้
//   REF_JOB_ID_RE — refJobId ถูกนำไปตั้งชื่อไฟล์ MCV-<refJobId>-rN.jpg (megaCoverArchive.js)
//     path.join จะ resolve '..' → เขียนไฟล์นอกโฟลเดอร์ได้ (path traversal / arbitrary write)
//     → รับเฉพาะอักขระปลอดภัย [A-Za-z0-9_-] ยาว 1-40 เท่านั้น ไม่ผ่าน = ตัดทิ้ง (fallback MCV-random)
//   MAX_BASE64_LEN — กัน base64 ยักษ์ไหลเข้า Buffer/ดิสก์/Supabase (ราว 10MB decode ≈ 13.3MB data URL)
const REF_JOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BASE64_LEN = 14 * 1024 * 1024; // ~14MB data URL (ภาพ decode จริง ~10.5MB) — เผื่อปกใบใหญ่สุดสมเหตุผล

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const base64 = typeof body.base64 === 'string' ? body.base64 : '';
    const title = typeof body.title === 'string' ? body.title.slice(0, 300) : '';
    // ★ validate รูปแบบ refJobId ก่อนใช้ตั้งชื่อไฟล์ — ไม่ผ่าน = ตัดทิ้ง (กัน path traversal)
    const refJobIdRaw = typeof body.refJobId === 'string' ? body.refJobId.trim() : '';
    const refJobId = REF_JOB_ID_RE.test(refJobIdRaw) ? refJobIdRaw : '';

    if (!/^data:image\/(png|jpe?g);base64,/.test(base64)) {
      return NextResponse.json(
        { success: false, error: 'ต้องส่ง base64 เป็น data URL รูป (png/jpg)', errorType: 'INVALID_IMAGE' },
        { status: 400 },
      );
    }

    // ★ เพดานขนาด base64 — กันเปลือง memory/ดิสก์/egress จากภาพยักษ์
    if (base64.length > MAX_BASE64_LEN) {
      return NextResponse.json(
        { success: false, error: 'ภาพใหญ่เกินกำหนด', errorType: 'IMAGE_TOO_LARGE' },
        { status: 400 },
      );
    }

    const entry = await addMegaCover({
      // ★ ผูกเป็น revision ของงานต้นทาง (MCV-<jobId>-rN) เมื่อมี refJobId — ไม่มีก็ MCV-random
      id: refJobId || undefined,
      title: title || (refJobId ? `แก้ต่อ ${refJobId}` : 'ปกแก้เอง'),
      source: 'editor',
      base64,
      humanEdited: true,
      throughMega: false,
    });

    return NextResponse.json({ success: true, id: entry.id, coverPath: entry.coverPath || null });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'บันทึกปกไม่สำเร็จ', errorType: 'COVER_SAVE_FAILED' },
      { status: 500 },
    );
  }
}
