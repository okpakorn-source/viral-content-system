import { NextResponse } from 'next/server';

// POST /api/cover-preflight
// วิเคราะห์ข่าว "เบาๆ" ก่อนสร้างปก — รัน storyIdentity เดี่ยวๆ ไม่รัน scraper/Director/Executor
// body:   { content, newsTitle }
// return: { identity, warnings, missing }  (timedOut/error → ปุ่มสร้างปกเดิมยังใช้ได้ = graceful)
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { content = '', newsTitle = '' } = body || {};
    if (!content && !newsTitle) {
      return NextResponse.json({
        success: false,
        error: 'ต้องใส่เนื้อข่าว',
        errorType: 'EMPTY_INPUT',
      }, { status: 400 });
    }

    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');

    // ★ timeout — skipCanonicalResolve ตัด Google search (1-2 นาที) ออก เหลือแค่ gpt extraction (~40-60 วิ)
    //   ตัวโมเดล identity เป็น reasoning (ช้าเอง) → เผื่อ 90 วิ · ถ้าเกิน = คืน timedOut ให้ UI สร้างปกตรงๆ ได้
    const TIMEOUT_MS = 90_000;
    const identity = await Promise.race([
      analyzeStoryIdentity(
        newsTitle || content.slice(0, 100),
        { core_story: content || newsTitle },
        { skipCanonicalResolve: true }
      ),
      new Promise((resolve) => setTimeout(() => resolve('__PREFLIGHT_TIMEOUT__'), TIMEOUT_MS)),
    ]);

    if (identity === '__PREFLIGHT_TIMEOUT__') {
      return NextResponse.json({
        success: true,
        identity: null,
        warnings: [],
        missing: [],
        timedOut: true,
      });
    }

    // ตรวจ fields ที่ขาด/กำกวม → warning/missing
    const warnings = [];
    const missing = [];

    // ★ ตรวจว่า mainCharacter เป็น "ชื่อจริง" หรือแค่ "คำบอกบทบาท" (ลูกชาย/แม่/หนุ่ม...) — role = ยังไม่มีชื่อจริง
    const _mc = String(identity?.mainCharacter || '').trim();
    const ROLE_ONLY = /^(ลูกชาย|ลูกสาว|ลูก|คุณแม่|คุณพ่อ|แม่|พ่อ|หนุ่ม|สาว|ชายคนหนึ่ง|หญิงคนหนึ่ง|ชาย|หญิง|เด็ก|ผู้ป่วย|ผู้บริจาค|ผู้ใจบุญ|ผู้โพสต์|ผู้|ชาวบ้าน|พลเมืองดี|ครอบครัว|เจ้าตัว|เจ้าของ)/;
    const _isRoleOnly = _mc && ROLE_ONLY.test(_mc);

    if (!_mc || _mc === 'ไม่ระบุ' || identity?._fallback || identity?._eventLed || _isRoleOnly) {
      missing.push({
        field: 'mainCharacter',
        label: 'ชื่อตัวละครหลัก',
        reason: _isRoleOnly
          ? `ข่าวไม่เอ่ยชื่อบุคคลชัดเจน (พบแค่ "${_mc}") → Google อาจหาภาพผิดคน กรุณากรอกชื่อจริง`
          : 'ไม่พบชื่อบุคคลชัดเจนในข่าว → Google อาจหาภาพผิดคน',
        severity: 'error',        // ❌ ต้องกรอกก่อนสร้างปก
      });
    }

    if (!identity?.coverEmotion || identity.coverEmotion === 'neutral') {
      warnings.push({
        field: 'coverEmotion',
        label: 'อารมณ์ข่าว',
        reason: 'ระบบตรวจไม่พบอารมณ์ชัด → อาจได้ภาพผิดโทน',
        severity: 'warning',      // ⚠️ แนะนำให้กรอก
      });
    }

    if (!identity?.coreStory?.celebratedAction) {
      warnings.push({
        field: 'celebratedAction',
        label: 'ข่าวนี้เล่าเรื่องอะไร',
        reason: 'Judge จะเลือกภาพได้ไม่ตรงเนื้อหา',
        severity: 'warning',
      });
    }

    return NextResponse.json({ success: true, identity, warnings, missing });
  } catch (err) {
    // graceful: preflight ไม่บังคับ 100% — ถ้า fail ปุ่มสร้างปกเดิมยังใช้ได้
    console.error('[cover-preflight] error:', err?.message);
    return NextResponse.json({
      success: false,
      error: err?.message || 'preflight ล้มเหลว',
      errorType: 'PREFLIGHT_FAILED',
      identity: null,
      warnings: [],
      missing: [],
    }, { status: 200 });
  }
}
