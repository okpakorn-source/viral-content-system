// ============================================================
// 🔒 src/middleware.js — ด่านตรวจสิทธิ์ endpoint ท่อหนัก (แบตช์ 5, 15 ก.ค. 69 · rev sol-critical)
// ------------------------------------------------------------
// ป้องกัน POST /api/cover-ref-test และ /api/quick-test (เต็มท่อ MEGA ~3-18 นาที/คำขอ — ต้นทุน AI จริง)
// จากการยิงตรงจากอินเทอร์เน็ตโดยไม่มีสิทธิ์
//
// ⚠️ ทำไมไม่ใช้ host allow-list (ดีไซน์เดิมถูก Codex sol ตีตก CRITICAL):
//   next@16.2.6 รันแบบ `next start` โดยไม่ระบุ -H → Next สร้าง URL ของ middleware ด้วย
//   hostname='localhost' เสมอ (next-server.js: this.fetchHostname || 'localhost') แม้ request
//   มาจากอินเทอร์เน็ตจริงบน Railway/self-host → req.nextUrl.hostname เป็น 'localhost' ทุกครั้ง
//   = allow-list แบบ host เปิดประตูให้คนนอกทั้งหมด. NextURL ยัง canonicalize 127/8 → localhost อีก.
//   → เลิกพึ่ง hostname โดยสิ้นเชิง ใช้ "ธงเปิด local ที่ตั้งใจตั้งเอง" แทน (fail-closed แท้):
//
//   (ก) COVER_TEST_LOCAL_OPEN==='1' (ตั้งเฉพาะเครื่องทีมใน .env.local — cloud/Railway/Vercel ไม่ตั้ง)
//       → ผ่าน (เครื่องทีมทำงานสะดวก ไม่ต้องพกคีย์)
//   (ข) ไม่งั้น → ต้องมี header `x-cover-test-key` ตรงกับ env COVER_TEST_KEY เป๊ะ (เทียบ constant-time)
//       env ไม่ตั้ง/ว่าง = ปัดตกเสมอ (fail-closed) แม้ header เป็นอะไรก็ตาม
//   (ค) error ระหว่างตัดสิน → ปัดตก (fail-closed) ไม่ปล่อยผ่าน
//
// matcher: /api/cover-ref-test (ประตูหลัก) + /api/quick-test (deputy — kind:'ref' + _forceDispatch:'cloud'
//   ทำให้ server แนบ COVER_TEST_KEY แล้วเรียกท่อหนักแทนคนนอกได้ ถ้าไม่ guard = ช่องอ้อมเปิดโล่ง) —
//   /api/analyze, /api/keywords อยู่นอกด่านโดยเจตนา (megaAdapters เรียกภายใน + /image-search ใช้)
//
// เครื่องทีม: ตั้ง COVER_TEST_LOCAL_OPEN=1 ใน .env.local → ทั้งสอง endpoint ผ่านฟรี
// cloud: ตั้ง COVER_TEST_KEY (ไม่ตั้ง LOCAL_OPEN) → บังคับคีย์ทั้งสอง endpoint
// ============================================================

import { NextResponse } from 'next/server';

// เทียบคีย์แบบ constant-time (ลด timing side-channel — คีย์ภายในความเสี่ยงต่ำ แต่ทำให้ถูกไว้)
//   ต่างความยาว = false ทันที (ยอมรับ length leak เล็กน้อยสำหรับคีย์ภายใน) · Edge runtime ไม่มี
//   node:crypto.timingSafeEqual จึงวน XOR เอง
function _timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ── pure decision function ──
// แยกจาก NextRequest/NextResponse เพื่อเทส logic ตรงๆ ได้ · ไม่รับ hostname อีกต่อไป (เชื่อไม่ได้)
export function _coverTestGuardDecision({ localOpen, headerKey, envKey }) {
  if (localOpen === '1') {
    return { allow: true, reason: 'local_open_flag' };
  }
  const env = typeof envKey === 'string' ? envKey.trim() : '';
  if (!env) {
    // env ไม่ตั้ง/ว่าง = fail-closed เสมอ ไม่ว่า headerKey จะเป็นอะไร (ครอบ cloud ที่ลืมตั้งคีย์)
    return { allow: false, reason: 'env_key_missing' };
  }
  if (!_timingSafeEqual(typeof headerKey === 'string' ? headerKey : '', env)) {
    return { allow: false, reason: 'header_key_mismatch' };
  }
  return { allow: true, reason: 'header_key_match' };
}

function guardFailResponse() {
  return NextResponse.json(
    {
      success: false,
      error: 'ต้องมีคีย์ทีม (x-cover-test-key) สำหรับเรียกท่อหนักบนโฮสต์',
      errorType: 'COVER_TEST_KEY_REQUIRED',
    },
    { status: 401 }
  );
}

function guardErrorResponse() {
  return NextResponse.json(
    {
      success: false,
      error: 'ด่านตรวจสิทธิ์ทำงานผิดพลาด — ปัดตกไว้ก่อนเพื่อความปลอดภัย',
      errorType: 'COVER_TEST_GUARD_ERROR',
    },
    { status: 401 }
  );
}

// thin wrapper — ดึงค่าจริงจาก request/env แล้วส่งให้ pure function ตัดสิน
export function middleware(req) {
  try {
    const headerKey = req.headers.get('x-cover-test-key');
    const decision = _coverTestGuardDecision({
      localOpen: process.env.COVER_TEST_LOCAL_OPEN,
      headerKey,
      envKey: process.env.COVER_TEST_KEY,
    });
    if (!decision.allow) return guardFailResponse();
    return NextResponse.next();
  } catch (_err) {
    // fail-closed: error ระหว่างตัดสิน ต้องปัดตก ห้ามปล่อยผ่าน
    return guardErrorResponse();
  }
}

export const config = {
  matcher: ['/api/cover-ref-test', '/api/quick-test'],
};
