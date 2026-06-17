/**
 * ★ คลังแปลงมุม (17 มิ.ย. 69) — เก็บผลทุกครั้งที่ "แปลงมุมข่าว" ทั้งแบบทดสอบ(test)และทำจริง(manual/auto)
 *  GET                      → รายการเคสทั้งหมด (ใหม่สุดก่อน) + สถิติสรุป
 *  POST { action:'runTest' }→ รันชุดทดสอบข่าวดราม่า → แปลงมุม+ประเมินความใกล้ไวรัล → เก็บคลัง → คืนสถิติ
 *  ★ แยกจากระบบทำข่าวอัตโนมัติ 100% — แค่คลังเก็บผล/รันเทส ไม่แตะ pipeline เจน
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'all'; // all | test | real
    const store = createStore('reframe-cases');
    let cases = await store.getAll();
    cases.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    // สถิติสรุป (คิดจากทั้งหมด ก่อนกรอง)
    const tests = cases.filter(c => c.mode === 'test');
    const reals = cases.filter(c => c.mode !== 'test');
    const scored = tests.filter(c => typeof c.evalScore === 'number');
    const avgTest = scored.length ? Math.round((scored.reduce((s, c) => s + c.evalScore, 0) / scored.length) * 10) / 10 : null;
    const best = scored.slice().sort((a, b) => b.evalScore - a.evalScore)[0] || null;
    const stats = {
      total: cases.length,
      tests: tests.length,
      reals: reals.length,
      avgTestScore: avgTest,
      bestScore: best ? best.evalScore : null,
      lastRunAt: tests[0]?.at || null,
    };

    if (mode === 'test') cases = tests;
    else if (mode === 'real') cases = reals;

    return NextResponse.json({ success: true, cases: cases.slice(0, 200), stats });
  } catch (error) {
    console.error('[ReframeCases GET]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'REFRAME_CASES_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'runTest') {
      const { runReframeTest } = await import('@/lib/services/newsDesk/reframeEngine');
      const stats = await runReframeTest();
      return NextResponse.json({ success: true, stats });
    }
    if (body.action === 'clear') {
      const store = createStore('reframe-cases');
      const all = await store.getAll();
      for (const c of all) await store.remove(c.id).catch(() => {});
      return NextResponse.json({ success: true, cleared: all.length });
    }
    // ★ 17 มิ.ย.: หาข้อมูลเสริม (เฉพาะคนดัง) ตามแกนมุมของเคสนี้ — กดเอง คุมค่า Serper/OpenAI
    if (body.action === 'enrich') {
      const store = createStore('reframe-cases');
      const all = await store.getAll();
      const c = all.find(x => x.id === body.id);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคสนี้', errorType: 'NOT_FOUND' }, { status: 404 });
      const angle = (c.angles || [])[Number(body.angleIndex) || 0] || (c.angles || [])[0];
      if (!angle) return NextResponse.json({ success: false, error: 'เคสนี้ไม่มีมุมให้เสริม', errorType: 'NO_ANGLE' }, { status: 422 });
      const { enrichCelebAngle } = await import('@/lib/services/newsDesk/angleEnrich');
      const e = await enrichCelebAngle({ sourceTitle: c.sourceTitle, sourceSnippet: c.sourceSnippet, angleType: angle.type, angleFocus: angle.focus });
      if (!e.ok) return NextResponse.json({ success: false, error: e.reason, errorType: 'ENRICH_NONE' }, { status: 422 });
      await store.update(c.id, (ex) => ({ ...ex, enrichment: e }));
      return NextResponse.json({ success: true, enrichment: e });
    }
    return NextResponse.json({ success: false, error: 'action ไม่รู้จัก', errorType: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (error) {
    console.error('[ReframeCases POST]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'REFRAME_TEST_ERROR' }, { status: 500 });
  }
}
