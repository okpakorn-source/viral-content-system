// ============================================================
// ⚡ POST/GET /api/mega/compose-test — ทางลัดเทสประกอบปก (8 ก.ค. 2026)
// ------------------------------------------------------------
// ปัญหา: จูนปกให้นิ่งช้ามาก เพราะทุกครั้งต้องรันตั้งแต่ วางเนื้อ→ค้นภาพ→ตาคัด (~10 นาที)
// ทางลัด: ใช้ "คลังที่มีอยู่แล้ว" (AC-xxxx ที่ตาคัดเสร็จ) → สร้าง slotPlan จากพูลตรงๆ → composeAndVerify (~20 วิ)
//   GET  ?list=1        → รายชื่อเคสที่พร้อมเทส (มีภาพ triaged) + ref ในคลัง
//   POST {caseId, refId?, heroPersonHint?} → ประกอบปกจากพูลเคสนั้น + ref (auto-match ถ้าไม่ระบุ)
// ไม่ค้นภาพ/ตาคัดใหม่ = ไม่เสียค่า SerpApi/Gemini ซ้ำ · จ่ายแค่ตาหาหน้า+ตาเทียบ ~$0.05/ครั้ง
// ============================================================

import { NextResponse } from 'next/server';
import { readImages } from '@/lib/imageStore';
import { getCase, listRecent } from '@/lib/caseStore';
import { listRefCovers } from '@/lib/refCoverLibrary';
import { composeAndVerify } from '@/lib/services/megaComposerService';
import { evaluateCoverQc } from '@/lib/coverQcGate'; // ★ W2-A2: advisory เท่านั้น — ไม่บล็อกเครื่องมือเทส แค่แนบผลด่าน QC ให้เห็น

export const runtime = 'nodejs';
export const maxDuration = 300; // audit 9 ก.ค.: ท่อเต็มมี LLM ≥4 จุด เวลาจริง 60-90s — 120 ตึงเกิน (ชน timeout = เสียค่า LLM ฟรี)

const SLOT_ORDER = ['hero', 'reaction', 'action', 'context', 'circle'];
const isDirect = (u) => /\.(jpe?g|png|webp|gif)([?#]|$)/i.test(String(u || ''));

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('list')) {
      const cases = await listRecent(30);
      // เติมจำนวนภาพ triaged ต่อเคส (ให้เลือกเฉพาะเคสที่พร้อม)
      const withCounts = await Promise.all(cases.map(async (c) => {
        const imgs = await readImages(c.id).catch(() => []);
        const rel = imgs.filter((x) => x.triage && x.triage.relevant !== false);
        const cleanFace = rel.filter((x) => x.triage.clean !== false && Number(x.triage.faceCount) === 1);
        return { id: c.id, headline: c.headline, tone: c.tone, total: imgs.length, relevant: rel.length, cleanFace: cleanFace.length };
      }));
      // ★ 9 ก.ค.: โชว์เฉพาะ ref ที่ทำตามได้จริง (_reproducible≠false — เครื่องวัดตะเข็บคัดแล้ว)
      const refs = (await listRefCovers(500)).filter((r) => r.dna && r.imagePath && r.dna._reproducible !== false)
        .map((r) => ({ id: r.id, styleName: r.styleName || r.id, layoutFamily: r.dna.layoutFamily, panelCount: r.dna.panelCount, imagePath: r.imagePath }));
      return NextResponse.json({ success: true, cases: withCounts.filter((c) => c.relevant >= 3), refs });
    }
    return NextResponse.json({ success: false, error: 'ใช้ ?list=1 หรือ POST', errorType: 'BAD_INPUT' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    if (!caseId) return NextResponse.json({ success: false, error: 'ต้องระบุ caseId', errorType: 'BAD_INPUT' }, { status: 400 });

    const c = await getCase(caseId);
    if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    const imgs = await readImages(caseId);
    const relevantImgs = imgs.filter((x) => x.triage && x.triage.relevant !== false);
    // ★ 9 ก.ค. เฟส 5.1+5.2 (แผนคุณภาพคลังรูป): พูลเข้าโรงประกอบต้องสะอาด default —
    //   คลังจริงพิสูจน์: clean แค่ 33.6% (AC-0058, โลโก้/ลายน้ำ 126 + ตัวหนังสือทับ 101 จาก 375)
    //   เดิมกรองแค่ relevant!==false → ภาพ clean=false เข้าพูลได้ พอของสะอาดขาดระบบจำใจหยิบของสกปรก
    //   ธง junkHidden (เฟส 5.3 AI junk scan ตั้งแทนลบถาวร) ห้ามเข้าพูลเสมอ ไม่ผูกกับ kill-switch ด้านล่าง
    //   kill-switch พูลสะอาด: POOL_CLEAN_GATE=0 = พฤติกรรมเดิม (เฉพาะ relevant!==false)
    const POOL_CLEAN_GATE = process.env.POOL_CLEAN_GATE !== '0';
    const POOL_MIN_FLOOR = 6; // พูลสะอาดบางกว่านี้ → อนุญาตเติม clean=false ที่ดีที่สุดกลับ (กันงานล่ม)
    const notHidden = (x) => x.triage?.junkHidden !== true;
    const visibleImgs = relevantImgs.filter(notHidden);
    const dirtyFallbackIds = new Set();
    let pool = visibleImgs;
    if (POOL_CLEAN_GATE) {
      const cleanOnly = visibleImgs.filter((x) => x.triage.clean !== false);
      if (cleanOnly.length < POOL_MIN_FLOOR && cleanOnly.length < visibleImgs.length) {
        const need = POOL_MIN_FLOOR - cleanOnly.length;
        const dirtyBest = visibleImgs
          .filter((x) => x.triage.clean === false)
          .sort((a, b) => (Number(b.triage?.faceCount) || 0) - (Number(a.triage?.faceCount) || 0) || (Number(b.triage?.quality) || 0) - (Number(a.triage?.quality) || 0))
          .slice(0, need);
        dirtyBest.forEach((x) => dirtyFallbackIds.add(String(x.id)));
        pool = [...cleanOnly, ...dirtyBest];
        console.log(`[compose-test] 🧹 เฟส 5.1: พูลสะอาดบาง (${cleanOnly.length}/${POOL_MIN_FLOOR}) → เติม clean=false ที่ดีที่สุด ${dirtyBest.length} ใบ (dirtyFallback)`);
      } else {
        pool = cleanOnly;
      }
    }
    if (pool.length < 3) return NextResponse.json({ success: false, error: `พูลเคสนี้มีแค่ ${pool.length} ใบ (ต้อง ≥3) — ยังตาคัดไม่พอ`, errorType: 'POOL_TOO_THIN' }, { status: 422 });

    // ★ เฟส 0.2 (โหมดเทสนิ่ง): ส่ง slotPlan แช่แข็งมาเอง = ข้าม compass+S6 (LLM) ทั้งหมด
    //   ใช้วัดเฉพาะชั้นประกอบ/ครอปแบบ before-after ได้จริง (อินพุตเดิมเป๊ะทุกรอบ) + ไม่เสียค่า LLM เลือกภาพซ้ำ
    if (Array.isArray(body.slotPlan) && body.slotPlan.length >= 3) {
      const t0f = Date.now();
      const refsF = (await listRefCovers(500)).filter((r) => r.dna && r.imagePath && r.dna._reproducible !== false);
      const refF = body.refId ? refsF.find((r) => r.id === body.refId) : null;
      if (!refF) return NextResponse.json({ success: false, error: 'โหมด slotPlan แช่แข็งต้องระบุ refId ที่มีจริง', errorType: 'BAD_INPUT' }, { status: 400 });
      const outF = await composeAndVerify({
        newsTitle: c.analysis?.headline || c.newsSnippet || caseId,
        slotPlan: body.slotPlan,
        refDNA: refF.dna,
        refImagePath: refF.imagePath,
        // ★ 10 ก.ค. Wave1: default ตาม env เดียวกับ production (เดิม default ปิด — 3 ช่องทางพฤติกรรมไม่ตรงกัน) · body ส่ง boolean มา = override ได้
        stableOrder: typeof body.stableOrder === 'boolean' ? body.stableOrder : process.env.MEGA_STABLE_ORDER !== '0',
      });
      if (outF.success && outF.refSimilarity != null) outF.score = `เหมือน ref ${outF.refSimilarity}%`;
      // ★ W2-A2: แนบผลด่าน QC (advisory) — ไม่แตะ success/สถานะใดๆ เครื่องมือเทสต้องเห็นผลเสมอ
      const qcVerdictF = evaluateCoverQc({ qcFlags: outF.qcFlags, refSimilarity: outF.refSimilarity, manifest: outF.manifest });
      return NextResponse.json({
        ...outF, caseId, frozenPlan: true, qcVerdict: qcVerdictF,
        refUsed: { id: refF.id, styleName: refF.styleName || refF.id, imagePath: refF.imagePath },
        elapsed: `${((Date.now() - t0f) / 1000).toFixed(1)}s`,
      }, { status: outF.success ? 200 : 422 });
    }

    // ── เลือก ref (ระบุเอง หรือ auto-match ตามอารมณ์ข่าว) — เฉพาะใบที่ทำตามได้จริง ──
    const refs = (await listRefCovers(500)).filter((r) => r.dna && r.imagePath && r.dna._reproducible !== false);
    let ref = body.refId ? refs.find((r) => r.id === body.refId) : null;
    if (!ref && refs.length) {
      const { pickBestRef } = await import('@/lib/refCoverMatch');
      const m = await pickBestRef({
        emotion: c.analysis?.context?.emotional_tone || '',
        text: [c.analysis?.headline, c.newsSnippet].filter(Boolean).join(' '),
        charCount: (c.analysis?.characters || []).length,
      }).catch(() => null);
      ref = m?.ref || refs[0];
    }

    // ── A (8 ก.ค.): ใช้ S6 จริง แทน heuristic หยาบ — เครื่องเทสสะท้อน production เป๊ะ ──
    //   สร้าง job dossier ขั้นต่ำ → เรียก s6_slots (มี S6a บก.ศิลป์ + hero-authority + clean-sort + typeMatched gate ครบ)
    const t0 = Date.now();
    const origin = new URL(req.url).origin;
    // ★ A rev.2 (8 ก.ค. ผู้ใช้ชี้ "สมองไม่อ่านเนื้อข่าว"): รัน compassBrain บน "เนื้อข่าวเต็ม" ที่เคสเก็บไว้
    //   → ได้ angle/อารมณ์/ตัวละคร/visualDreamShots จริง (เท่า production) → S6 เลือกภาพตามบริบทข่าวได้
    //   ล้ม/ไม่มีเนื้อ → compass บางจาก analysis (ไม่พังเทส)
    const fullText = [c.analysis?.headline, c.newsText || c.analysis?.content || c.analysis?.summary || c.newsSnippet].filter(Boolean).join('\n\n');
    let compass;
    try {
      const { compassBrain } = await import('@/lib/megaBrains');
      compass = await compassBrain({ card: { title: c.analysis?.headline || '', lane: '', category: '' }, extractText: fullText });
    } catch (e) {
      compass = {
        angle: c.analysis?.headline || c.newsSnippet || '',
        primaryEmotion: c.analysis?.context?.emotional_tone || '',
        secondaryEmotions: [],
        mainCharacters: (c.analysis?.characters || []).map((ch) => ({ name: typeof ch === 'string' ? ch : ch.name, role: 'hero' })).filter((x) => x.name),
        visualDreamShots: [],
      };
    }
    // hero hint → ดันตัวละครที่ระบุขึ้นหัว mainCharacters (ให้ s6 hero-authority ล็อกถูกคน)
    const heroName = (body.heroPersonHint || '').trim();
    if (heroName) compass.mainCharacters = [{ name: heroName, role: 'hero' }, ...(compass.mainCharacters || []).filter((x) => !String(x.name || '').includes(heroName))];

    // ★ 10 ก.ค. เฟส 6A: แนบ storyQueries จาก keywords ที่เคสเก็บไว้ (เหมือน s5_keywords ทำในท่อ /mega)
    //   — ไม่มี = story-fit ปิดเอง (พฤติกรรมเดิม) ทำให้เครื่องเทสนี้สะท้อน production ครบทุกเกต
    const _kw = c.keywords || {};
    const storyQueries = ['relationship_archive', 'lifestyle_travel', 'family_album', 'landmark_context', 'scene_place']
      .flatMap((k) => (Array.isArray(_kw[k]) ? _kw[k] : [])).map((s) => String(s).trim()).filter(Boolean);
    const job = { dossier: { images: { caseId, storyQueries }, compass, desk: { title: compass.angle } } };
    if (ref) job.dossier.refMatch = { dna: ref.dna, styleName: ref.styleName || ref.id, imagePath: ref.imagePath, reason: 'เลือกในหน้าเทส', typeMatched: true };

    const { s6_slots } = await import('@/lib/megaAdapters');
    const s6 = await s6_slots(job, { origin });
    if (s6.status === 'failed') {
      return NextResponse.json({ success: false, error: 'S6 เลือกภาพล้ม: ' + s6.summary, errorType: 'S6_FAILED', elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s` }, { status: 422 });
    }
    const slots = job.dossier.pickImages?.slots || s6.dossierPatch?.pickImages?.slots || {};

    // สร้าง slotPlan จากผล S6 (หลัก + สำรอง + thumbnail) — เหมือน s7_cover เป๊ะ
    // ★ เฟส 1.3 (slotPlan v2): พกป้ายตาคัดครบ (กล่อง = hint เท่านั้น — audit 9 ก.ค.)
    const urlTriage = new Map(imgs.map((x) => [String(x.imageUrl), {
      clean: x.triage?.clean !== false, newsScene: x.triage?.newsScene !== false,
      faces: Number(x.triage?.faceCount) || 0, thumbnailUrl: x.thumbnailUrl || '',
      person: x.triage?.person || null, category: x.triage?.category || null, emotion: x.triage?.emotion || null,
      note: String(x.triage?.note || '').replace(/\s+/g, ' ').trim().slice(0, 64) || null,
      faceBox: x.triage?.faceBox || null, peopleBox: x.triage?.peopleBox || null,
    }]));
    const byId = new Map(imgs.map((x) => [String(x.id), x.imageUrl]));
    const primaryLinks = SLOT_ORDER.map((s) => slots[s]?.imageUrl).filter(Boolean);
    // ★ 9 ก.ค. ค่ำ (อุดรอย "ภาพคนอื่นหล่น"): backups วงกลมอยู่ท้าย flatMap → โดนเพดาน 10 ลิงก์ตัด
    //   ทำให้กติกา "วงกลมคนละคนกับ hero" ไม่มีของให้หยิบ (log ⭕⚠️ ทั้งที่ S6 ดันเข้าแผนแล้ว)
    //   → เรียง "คนละคนกับ hero" ขึ้นก่อน + การันตีอย่างน้อย 1 ใบรอดเข้า allLinks
    const heroPersonPlan = String(slots.hero?.person || urlTriage.get(String(slots.hero?.imageUrl))?.person || '');
    const _diffP = (u) => { const p = String(urlTriage.get(String(u))?.person || ''); return !!(heroPersonPlan && p && p !== heroPersonPlan); };
    const backupUrls = SLOT_ORDER.flatMap((s) => slots[s]?.backups || []).map((b) => byId.get(String(b))).filter(Boolean)
      .sort((a, b) => ((_diffP(b) ? 2 : 0) + (isDirect(b) ? 1 : 0)) - ((_diffP(a) ? 2 : 0) + (isDirect(a) ? 1 : 0)));
    const _seen = new Set();
    const allLinks = [...primaryLinks, ...backupUrls].filter((u) => { const k = String(u); if (_seen.has(k)) return false; _seen.add(k); return true; }).slice(0, 10);
    if (heroPersonPlan && !allLinks.some(_diffP)) {
      const cand = backupUrls.find((u) => _diffP(u) && !allLinks.includes(u));
      if (cand && allLinks.length >= 4) { allLinks[allLinks.length - 1] = cand; console.log('[compose-test] 👥 การันตีภาพคนอื่นรอดเพดาน 10 ลิงก์ (แทนลิงก์ท้าย)'); }
    }
    if (allLinks.length < 3) {
      return NextResponse.json({ success: false, error: `S6 คัดได้ ${allLinks.length} ภาพ (ต้อง ≥3)`, errorType: 'INSUFFICIENT_PICKED', elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s` }, { status: 422 });
    }
    const heroUrl = slots.hero?.imageUrl || null;
    const slotPlan = allLinks.map((u) => {
      const primary = SLOT_ORDER.find((s) => slots[s]?.imageUrl === u);
      const tt = urlTriage.get(String(u)) || {};
      return {
        url: u, thumbnailUrl: tt.thumbnailUrl || '', slot: primary || null,
        clean: tt.clean !== false, newsScene: tt.newsScene !== false, faces: tt.faces || 0, isHero: u === heroUrl,
        dirtyFallback: !!(primary && slots[primary]?.dirtyFallback), // ★ เฟส 5.1: ติดธงถ้าเป็นของเติมพูลบาง (clean=false)
        person: tt.person || null, category: tt.category || null, emotion: tt.emotion || null,
        note: tt.note || null, faceBox: tt.faceBox || null, peopleBox: tt.peopleBox || null, // เฟส 1.3
      };
    });
    const out = await composeAndVerify({
      newsTitle: c.analysis?.headline || c.newsSnippet || caseId,
      slotPlan,
      refDNA: ref?.dna || null,
      refImagePath: ref?.imagePath || null,
      stableOrder: typeof body.stableOrder === 'boolean' ? body.stableOrder : process.env.MEGA_STABLE_ORDER !== '0', // ★ 10 ก.ค. Wave1: default ตาม env เดียวกับ production (เดิมปิด)
    });
    if (out.success && out.refSimilarity != null) out.score = `เหมือน ref ${out.refSimilarity}%`;
    // ★ W2-A2: แนบผลด่าน QC (advisory) — ไม่แตะ success/สถานะใดๆ เครื่องมือเทสต้องเห็นผลเสมอ
    const qcVerdict = evaluateCoverQc({ qcFlags: out.qcFlags, refSimilarity: out.refSimilarity, manifest: out.manifest });

    // 🗂️ 9 ก.ค. (ผู้ใช้สั่ง "ทุกครั้งที่กดสร้างปกเข้าคลังออโต้"): ผลสำเร็จเด้งเข้าคลังงาน MEGA เสมอ
    let archived = null;
    if (out.success && out.base64) {
      try {
        const { addMegaCover } = await import('@/lib/megaCoverArchive');
        archived = await addMegaCover({
          title: c.analysis?.headline || c.newsSnippet || caseId,
          source: 'compose-test',
          imageCaseId: caseId,
          refId: ref?.id || null,
          refSimilarity: out.refSimilarity ?? null,
          template: out.template || '',
          score: out.score || null,
          base64: out.base64,
          qcFlags: out.qcFlags || [], // เฟส 4.3
        });
      } catch { /* คลังล้มไม่กระทบผลเทส */ }
    }

    return NextResponse.json({
      ...out,
      caseId,
      qcVerdict,
      refUsed: ref ? { id: ref.id, styleName: ref.styleName || ref.id, imagePath: ref.imagePath } : null,
      archivedId: archived?.id || null, // เข้าคลัง /mega-covers แล้ว (โหลดภาพ: /api/mega-covers/img?id=..&dl=1)
      poolSize: pool.length,
      poolDirtyFallback: dirtyFallbackIds.size, // ★ เฟส 5.1: จำนวนใบ clean=false ที่เติมเข้าพูลเพราะสะอาดบางเกินไป (debug)
      slotPlanUsed: slotPlan, // เฟส 0.2: ให้เครื่องเทสเก็บไปแช่แข็ง (โหมด slotPlan ด้านบน)
      elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    }, { status: out.success ? 200 : 422 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
