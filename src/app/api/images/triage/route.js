// ============================================================
// [ระบบทำปกออโต้] POST /api/images/triage
// ------------------------------------------------------------
// คัดกรอง "คลังทั้งใบ" ด้วยตา (Gemini) → ติดป้ายถาวรต่อรูป
//   (relevant/person/category/quality/emotion/clean/faceBox)
// body: { caseId, jobId?, force?, limit? }
//   force=true → ตรวจซ้ำทุกใบ (ปกติข้ามใบที่ติดป้ายแล้ว = ถูก+เร็ว)
//   limit=N   → ตรวจแค่ N ใบแรกที่ยังไม่ติดป้าย (ไว้เทส)
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { readImages, setTriage, triageSummary, countByCategory, countByPerson } from '@/lib/imageStore';
import { triageLibrary } from '@/lib/libraryTriage';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 600;

// จำกัดจำนวนต่อ 1 request (กัน timeout) — คลังใหญ่ให้ UI วนเรียกซ้ำจนครบ (endpoint ข้ามใบที่ติดป้ายแล้ว)
const MAX_PER_CALL = parseInt(process.env.TRIAGE_MAX_PER_CALL || '150', 10);

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const caseId = (body.caseId || '').trim();
    const force = !!body.force;
    const limit = Number.isFinite(body.limit) ? Math.max(1, body.limit) : null;

    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    }

    // เติมเพศจาก analysis.characters เข้า subjects → ช่วยแยกตัวละครในภาพครอบครัว/คู่ (เหมือน build)
    const chars = c.analysis?.characters || [];
    const genderOf = (name) => {
      const n = (name || '').trim();
      const hit = chars.find((ch) => ch.name === n || (ch.name && (n.includes(ch.name) || ch.name.includes(n))));
      return hit?.gender || '';
    };
    const subjects = (c.keywords?.subjects || []).map((s) => ({ ...s, gender: s.gender || genderOf(s.name) }));
    // ★ N1 (18 ก.ค. — จุดตกค้าง): ตาเห็นเนื้อข่าวเต็ม (c.newsText 1800 ตัว) เหมือน search route/megaAdapters
    //   kill-switch เดียวกัน: VET_GIST_FULL=0 = พฤติกรรมเดิม (summary 600) · VET_GIST_CHARS ปรับเพดาน
    const _gistFull = process.env.VET_GIST_FULL !== '0';
    const _gistChars = Math.max(200, parseInt(process.env.VET_GIST_CHARS || (_gistFull ? '1800' : '600'), 10));
    const newsGist = String(
      _gistFull
        ? (c.newsText || c.analysis?.content || c.analysis?.summary || c.newsSnippet || '')
        : (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '')
    ).slice(0, _gistChars);

    const all = await readImages(caseId);
    if (all.length === 0) {
      return NextResponse.json({ success: false, error: 'คลังเคสนี้ยังไม่มีรูป', errorType: 'NO_IMAGES' }, { status: 400 });
    }

    // เลือกเป้าหมาย: force = ทุกใบ / ปกติ = เฉพาะที่ยังไม่ติดป้าย
    const pending = force ? all : all.filter((im) => !im.triage);
    const perCall = Math.min(limit || MAX_PER_CALL, MAX_PER_CALL);
    const targets = pending.slice(0, perCall);

    if (targets.length === 0) {
      const summary = triageSummary(all);
      doneProgress(jobId, { step: 'เสร็จ', detail: 'คลังติดป้ายครบแล้ว' });
      return NextResponse.json({ success: true, caseId, tagged: 0, remaining: 0, done: true, alreadyTagged: true, summary, byCategory: countByCategory(all), byPerson: countByPerson(all) });
    }

    P('เริ่มคัดกรองคลัง', `ตาจะดู ${targets.length} รูป`, { pct: 3 });

    let result;
    try {
      result = await triageLibrary({
        images: targets,
        subjects,
        newsGist,
        caseId,
        onRetry: P.onRetry,
        onProgress: ({ done, total, pct, tagged }) =>
          P('ตาคัดกรองคลัง', `ดูแล้ว ${done}/${total} รูป · ติดป้าย ${tagged}`, { pct: 5 + Math.round(pct * 0.9) }),
      });
    } catch (err) {
      failProgress(jobId, err.message);
      const status = err.errorType === 'NO_GEMINI_KEY' ? 400 : 502;
      return NextResponse.json({ success: false, error: err.message, errorType: err.errorType || 'TRIAGE_FAILED' }, { status });
    }

    await setTriage(caseId, result.map);
    const after = await readImages(caseId);
    const summary = triageSummary(after);
    const remaining = summary.untagged; // ยังเหลือให้ตรวจอีกกี่ใบ (UI วนต่อจนเป็น 0)
    doneProgress(jobId, { step: 'เสร็จ', detail: `ติดป้าย ${result.tagged} รูป · เหลือ ${remaining}` });

    return NextResponse.json({
      success: true,
      caseId,
      tagged: result.tagged,
      failed: result.failed,
      remaining,
      done: remaining === 0,
      summary, // { total, untagged, relevant, junk }
      byCategory: countByCategory(after),
      byPerson: countByPerson(after),
    });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json({ success: false, error: err.message || 'เกิดข้อผิดพลาด', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
