// ============================================================
// [ระบบทำปกออโต้] POST /api/images/profile
// ------------------------------------------------------------
// ดึงรูปจากโปรไฟล์ Instagram / Facebook (ต้องรู้ username/profile_id)
// body: { caseId, network: 'instagram'|'facebook', profileId }
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { instagramProfile, facebookProfile } from '@/lib/imageSearch';
import { addImages } from '@/lib/imageStore';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    const network = (body.network || '').trim();
    let profileId = (body.profileId || '').trim();

    // รองรับวาง URL โปรไฟล์ → ดึง username
    const m = profileId.match(/(?:instagram|facebook)\.com\/([^/?#]+)/i);
    if (m) profileId = m[1];
    profileId = profileId.replace(/^@/, '');

    if (!['instagram', 'facebook'].includes(network) || !profileId) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ network (instagram/facebook) และ profileId/username', errorType: 'BAD_INPUT' },
        { status: 400 }
      );
    }

    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    }

    let found = [];
    try {
      found = network === 'instagram' ? await instagramProfile(profileId) : await facebookProfile(profileId);
    } catch (err) {
      const status = err.errorType === 'NO_SERPAPI_KEY' ? 400 : 502;
      return NextResponse.json({ success: false, error: err.message, errorType: err.errorType || 'PROVIDER_ERROR' }, { status });
    }

    if (found.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบรูปในโปรไฟล์ ${network}: ${profileId} (ตรวจ username หรือโปรไฟล์อาจเป็นส่วนตัว)`, errorType: 'NO_RESULTS' },
        { status: 200 }
      );
    }

    const records = found.map((im) => ({ ...im, platform: network, query: 'profile:' + profileId }));
    const saved = await addImages(caseId, records);
    return NextResponse.json({
      success: true,
      caseId,
      platform: network,
      profileId,
      found: found.length,
      added: saved.added,
      total: saved.total,
      byPlatform: saved.byPlatform,
      images: saved.images,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'เกิดข้อผิดพลาด', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
