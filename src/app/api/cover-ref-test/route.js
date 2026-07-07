// ============================================================
// 🎯 POST /api/cover-ref-test — เทสปก "ผ่านท่อ MEGA จริงทุกขั้น"
// ------------------------------------------------------------
// ไม่แก้ระบบใดๆ — แค่ orchestrate เรียกฟังก์ชัน/API เดิมตามลำดับ MEGA S2.5→S7:
//   compassBrain (เข็มทิศ) → s5_case (/api/analyze, AC-xxxx) → s5_keywords (/api/keywords, buildQueries+MOMENT_SLOTS)
//   → s5_search (4 แหล่ง) → s5_triage (ตาคัด) → s6_slots (slotDirectorBrain เลือก 5)
//   → auto-cover-v3 (sourceLinks + sourceOnly) เหมือน s7_cover
// = พูลมาจากระบบ keyword (AC) จริง ไม่ใช่ self-scrape ของ auto-cover-v3
// ============================================================

import { NextResponse } from 'next/server';
import { compassBrain } from '@/lib/megaBrains';
import { s5_case, s5_keywords, s5_search, s5_triage, s6_slots } from '@/lib/megaAdapters';

export const runtime = 'nodejs';
export const maxDuration = 1800; // ★ 7 ก.ค.: ท่อ MEGA เต็มใช้ ~12-18 นาที (search+cover) — 10 นาทีไม่พอ

const SLOT_ORDER = ['hero', 'reaction', 'action', 'context', 'circle'];

export async function POST(req) {
  const trace = [];
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const content = String(body.content || '').trim();
    const newsTitle = String(body.newsTitle || '').trim();
    const forceTemplateId = body.forceTemplateId || null;
    if (content.length < 100) {
      return NextResponse.json({ success: false, error: 'ต้องมีเนื้อข่าวเต็ม (≥100 ตัวอักษร)', errorType: 'NO_CONTENT' }, { status: 400 });
    }
    const origin = req.nextUrl.origin;

    // ── in-memory dossier (จำลองว่า S4 จบแล้ว มีเนื้อข่าว) — ขับ adapter เดิมเหมือน conductor ──
    const job = {
      id: `REFTEST-${Date.now().toString(36)}`,
      dossier: {
        desk: { title: newsTitle, lane: '', category: '' },
        extract: { text: content, chars: content.length },
        generate: { newsData: { newsTitle, newsBody: content } },
      },
    };
    const merge = (r) => { if (r?.dossierPatch) Object.assign(job.dossier, r.dossierPatch); return r; };
    const step = (name, r) => { trace.push({ stage: name, status: r?.status, summary: (r?.summary || '').slice(0, 160) }); return r; };
    const failed = (name, r) => (r?.status === 'failed');

    // ── S2.5 เข็มทิศ (จำเป็นต่อ s6 slotDirector: mainCharacters + visualDreamShots) ──
    try {
      job.dossier.compass = await compassBrain({ card: { title: newsTitle, lane: '', category: '' }, extractText: content });
      trace.push({ stage: 's2.5_compass', status: 'done', summary: `${job.dossier.compass?.angle || ''} · ${job.dossier.compass?.primaryEmotion || ''}`.slice(0, 160) });
    } catch (e) {
      job.dossier.compass = { mainCharacters: [], visualDreamShots: [] };
      trace.push({ stage: 's2.5_compass', status: 'failed', summary: 'compass ล้ม (ใช้ค่าว่าง): ' + e.message?.slice(0, 80) });
    }

    // 🎯 Phase 2: match ปก reference จากคลังตามแนวข่าว (ใช้เป็นเป้า + แนบ DNA ให้งานทำปก) — ล้มไม่ critical
    let matchedRef = null;
    try {
      const { pickBestRef } = await import('@/lib/refCoverMatch');
      const c = job.dossier.compass || {};
      matchedRef = await pickBestRef({
        emotion: c.primaryEmotion || '',
        text: [c.angle, ...(c.secondaryEmotions || [])].filter(Boolean).join(' '),
        charCount: (c.mainCharacters || []).length,
        dreamShots: (c.visualDreamShots || []).map((v) => v.slot || v.description || ''),
      });
      if (matchedRef?.ref) {
        // 🎯 ref-first: เก็บลงแฟ้ม → s6_slots ใช้ DNA นี้ "เลือกภาพ" + s7 ใช้ตัวเดียวกัน (เป้าเดียวทั้งท่อ)
        job.dossier.refMatch = { dna: matchedRef.ref.dna, styleName: matchedRef.ref.styleName || matchedRef.ref.id, imagePath: matchedRef.ref.imagePath, reason: matchedRef.reason };
        trace.push({ stage: 'ref_match', status: 'done', summary: `เป้า: ${matchedRef.ref.styleName || matchedRef.ref.id} (${matchedRef.reason})`.slice(0, 160) });
      }
    } catch { /* คลัง ref ว่าง/ล้ม → ไม่มีเป้าจากคลัง (ใช้ jpg เดิม) */ }

    // ── S5a เปิดเคสภาพ (AC-xxxx) ──
    let r = merge(step('s5_case', await s5_case(job, { origin })));
    if (failed('s5_case', r)) return NextResponse.json({ success: false, error: r.summary, errorType: 'S5_CASE_FAILED', trace }, { status: 502 });

    // ── S5b สกัดคีย์เวิร์ด (buildQueries + MOMENT_SLOTS) ──
    r = merge(step('s5_keywords', await s5_keywords(job, { origin })));
    if (failed('s5_keywords', r)) return NextResponse.json({ success: false, error: r.summary, errorType: 'S5_KEYWORDS_FAILED', trace }, { status: 502 });

    // ── S5c ค้นภาพ — STAGED อยู่ใน s5_search เองแล้ว (2 แหล่งก่อน เก็บพอ ≥MIN → หยุด ข้าม fb/tiktok · ไม่พอ→ค้นต่อ)
    //   orchestrator แค่วนจน s5_search คืน done (มันตัดสินใจ "พอ/ค้นต่อ" ให้เอง) — ที่เดียวคุมทั้ง production+เทส
    for (let i = 0; i < 8; i++) {
      r = merge(step('s5_search', await s5_search(job, { origin })));
      if (failed('s5_search', r)) return NextResponse.json({ success: false, error: r.summary, errorType: 'S5_SEARCH_FAILED', trace }, { status: 502 });
      if (r.nextAction !== 'wait') break;
    }
    // ── S5d ตาคัดคลัง (วนจน done) ──
    for (let i = 0; i < 10; i++) {
      r = merge(step('s5_triage', await s5_triage(job, { origin })));
      if (failed('s5_triage', r)) return NextResponse.json({ success: false, error: r.summary, errorType: 'S5_TRIAGE_FAILED', trace }, { status: 502 });
      if (r.nextAction !== 'wait') break;
    }

    // ── S6 เลือกภาพลงช่อง (slotDirectorBrain + ด่านโค้ด) ──
    r = merge(step('s6_slots', await s6_slots(job, { origin })));
    if (failed('s6_slots', r)) return NextResponse.json({ success: false, error: r.summary, errorType: 'S6_SLOTS_FAILED', trace, pickImages: job.dossier.pickImages }, { status: 502 });

    const slots = job.dossier.pickImages?.slots || {};
    const primaryLinks = SLOT_ORDER.map((s) => slots[s]?.imageUrl).filter(Boolean);
    if (primaryLinks.length < 3) {
      return NextResponse.json({ success: false, error: `ภาพจาก S6 ไม่พอ (${primaryLinks.length}) — พูลข่าวนี้บาง`, errorType: 'INSUFFICIENT_PICKED', trace }, { status: 422 });
    }
    // ★ 7 ก.ค. FIX "คลัง 126 ใบแต่ปกบอกภาพไม่พอ": เดิมส่งแค่ 5 ลิงก์เป๊ะ ไม่มีบัฟเฟอร์ —
    //   ลิงก์พัง 2 (หน้าเว็บ/วิดีโอโดน 403) = ต่ำกว่า 4 ล้มทั้งปก ทั้งที่ s6 มี backups (id) แต่ถูกทิ้ง
    //   → แปลง backup id → URL จากคลังเคส ต่อท้ายลิงก์หลัก (เรียงไฟล์รูปตรงก่อน — ดึงผ่านเสมอ) เพดาน 10
    let backupUrls = [];
    try {
      const backupIds = SLOT_ORDER.flatMap((s) => slots[s]?.backups || []);
      if (backupIds.length) {
        const lib = await fetch(`${origin}/api/images/${encodeURIComponent(job.dossier.images?.caseId || '')}`, { signal: AbortSignal.timeout(30000) }).then((x) => x.json()).catch(() => null);
        const byId = new Map((lib?.images || []).map((x) => [String(x.id), x.imageUrl]));
        const isDirect = (u) => /\.(jpe?g|png|webp|gif)([?#]|$)/i.test(String(u || ''));
        backupUrls = backupIds.map((b) => byId.get(String(b))).filter(Boolean)
          .sort((a, b) => (isDirect(b) ? 1 : 0) - (isDirect(a) ? 1 : 0));
      }
    } catch { /* สำรองไม่ critical */ }
    const _seenL = new Set();
    const sourceLinks = [...primaryLinks, ...backupUrls]
      .filter((u) => { const k = String(u); if (_seenL.has(k)) return false; _seenL.add(k); return true; })
      .slice(0, 10);
    trace.push({ stage: 's6_links', status: 'done', summary: `หลัก ${primaryLinks.length} + สำรอง ${sourceLinks.length - primaryLinks.length} = ส่ง ${sourceLinks.length} ลิงก์` });

    // ── S7 ทำปก: ส่งภาพที่คัดแล้วเข้า auto-cover-v3 (sourceOnly) เหมือน s7_cover ──
    const mainCharacterName = (job.dossier.compass?.mainCharacters || [])[0]?.name || '';
    const coverPayload = {
      newsTitle,
      content: content.slice(0, 8000),
      mainCharacterName,
      sourceLinks, // ★ 7 ก.ค.: ส่งครบหลัก+สำรอง (เพดาน 10 — extractFromUserSources รองรับแล้ว)
      sourceOnly: true,
    };
    if (forceTemplateId) coverPayload.forceTemplateId = forceTemplateId;
    if (matchedRef?.ref?.dna) coverPayload.refDNA = matchedRef.ref.dna; // 🎯 แนบ DNA ปกเป้าให้งานทำปก (Director ใช้ได้ในอนาคต)

    // ★ 7 ก.ค. FIX "fetch failed ทั้งที่ปกเสร็จ": auto-cover-v3 render ~5-10 นาที > undici headersTimeout default 300s (5 นาที)
    //   → fetch ตัดก่อน orchestrator รับผล = throw + ไม่ถึงโค้ดเซฟคลัง · ใส่ dispatcher ขยาย timeout ให้ยาวพอ (AbortSignal คุมเพดานจริง)
    let _dispatcher;
    try { const { Agent } = await import('undici'); _dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 }); } catch { /* ไม่มี undici → ใช้ default */ }
    const cv = await fetch(`${origin}/api/auto-cover-v3`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(coverPayload),
      signal: AbortSignal.timeout(1500000), // 25 นาที — cover render + retry + enhance กว้างพอ (undici ปิด timeout ในตัวแล้ว)
      ...(_dispatcher ? { dispatcher: _dispatcher } : {}),
    });
    const cover = await cv.json().catch(() => ({}));
    trace.push({ stage: 's7_cover', status: cover?.success ? 'done' : 'failed', summary: `template ${cover?.template || '-'} · QC ${cover?.score ?? '-'}` });

    if (!cover?.success) {
      return NextResponse.json({ success: false, error: cover?.error || 'auto-cover-v3 ล้ม', errorType: cover?.errorType || 'COVER_FAILED', trace, sourceLinks }, { status: 502 });
    }

    // ── เซฟไฟล์ปก + ส่งเข้าคลังงาน MEGA อัตโนมัติ (ล้มไม่ critical ต่อผลปก) ──
    let coverPath = null;
    try {
      const m = /^data:image\/(\w+);base64,(.+)$/.exec(cover.base64 || '');
      if (m) {
        const { promises: fsp } = await import('fs');
        const pathMod = await import('path');
        const dir = pathMod.join(process.cwd(), 'public', 'mega-covers');
        await fsp.mkdir(dir, { recursive: true });
        const fname = `reftest-${Date.now().toString(36)}.${m[1] === 'png' ? 'png' : 'jpg'}`;
        await fsp.writeFile(pathMod.join(dir, fname), Buffer.from(m[2], 'base64'));
        coverPath = `/mega-covers/${fname}`;
        const { addMegaCover } = await import('@/lib/megaCoverArchive');
        await addMegaCover({
          title: newsTitle || content.slice(0, 60),
          source: 'cover-ref-test',
          imageCaseId: job.dossier.images?.caseId || null,
          coverCaseId: cover.caseId || null,
          coverPath, template: cover.template, score: cover.score, throughMega: true, trace,
        });
      }
    } catch { /* เซฟไฟล์/คลังล้ม ไม่ให้กระทบผลปก */ }

    return NextResponse.json({
      ...cover,          // base64, template, score, directorReason, assignments, caseId...
      coverPath,         // /mega-covers/xxx.jpg (เก็บเข้าคลังแล้ว)
      matchedRef: matchedRef?.ref ? { imagePath: matchedRef.ref.imagePath, styleName: matchedRef.ref.styleName, dna: matchedRef.ref.dna, score: matchedRef.score, reason: matchedRef.reason } : null, // 🎯 ปกเป้าจากคลัง
      throughMega: true, // ★ ยืนยันว่าผ่านท่อ MEGA (keyword system) จริง
      imageCaseId: job.dossier.images?.caseId || null, // AC-xxxx (เห็นใน /image-search)
      keywordsCount: job.dossier.images?.keywordsCount ?? null,
      poolSize: job.dossier.pickImages?.poolSize ?? null,
      pickedSlots: Object.fromEntries(SLOT_ORDER.map((s) => [s, slots[s] ? { person: slots[s].person, category: slots[s].category, reason: (slots[s].reason || '').slice(0, 80) } : null])),
      sourceLinks,
      elapsedTotal: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
      trace,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'ผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED', trace }, { status: 500 });
  }
}
