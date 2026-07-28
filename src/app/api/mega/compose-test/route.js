// ============================================================
// ⚡ POST/GET /api/mega/compose-test — ทางลัดเทสประกอบปก (8 ก.ค. 2026)
// ------------------------------------------------------------
// ปัญหา: จูนปกให้นิ่งช้ามาก เพราะทุกครั้งต้องรันตั้งแต่ วางเนื้อ→ค้นภาพ→ตาคัด (~10 นาที)
// ทางลัด: ใช้ "คลังที่มีอยู่แล้ว" (AC-xxxx ที่ตาคัดเสร็จ) → สร้าง slotPlan จากพูลตรงๆ → composeAndVerify (~20 วิ)
//   GET  ?list=1        → รายชื่อเคสที่พร้อมเทส (มีภาพ triaged) + ref ในคลัง
//   POST {caseId, refId?, heroPersonHint?} → ประกอบปกจากพูลเคสนั้น + ref (auto-match ถ้าไม่ระบุ)
// ไม่ค้นภาพ/ตาคัดใหม่ = ไม่เสียค่า SerpApi/Gemini ซ้ำ · จ่ายแค่ตาหาหน้า+ตาเทียบ ~$0.05/ครั้ง
//   (ยกเว้น MEGA_QUICK_GAP เปิด + พูลสะอาดว่าง/บาง → ยิงค้นเสริม 1 รอบ ดูหมายเหตุเคส AC-0195 ด้านล่าง)
// ============================================================

import { NextResponse } from 'next/server';
import { readImages } from '@/lib/imageStore';
import { getCase, listRecent } from '@/lib/caseStore';
import { listRefCovers } from '@/lib/refCoverLibrary';
import { composeAndVerify } from '@/lib/services/megaComposerService';
import { evaluateCoverQc } from '@/lib/coverQcGate'; // ★ W2-A2: advisory เท่านั้น — ไม่บล็อกเครื่องมือเทส แค่แนบผลด่าน QC ให้เห็น
import { refPoolGateOpen } from '@/lib/refCoverGrade'; // ★ R3: ตัวกรอง ref ใต้สวิตช์ REF_TEMPLATE_GRADE_GATE (OFF = เดิมเป๊ะ)
import { isPromoImage } from '@/lib/promoImageGuard'; // ★ TIER2 สายงาน ข (เคส AC-0196): util กลางร่วมกับ megaAdapters.js s6_slots — ห้าม copy regex ซ้ำ

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
      // ★ R3 (16 ก.ค.): ตัวกรองย้ายไป refPoolGateOpen — OFF = เงื่อนไขเดิมเป๊ะ · GATE='1' = เกรด A/B ไม่ซ้ำ
      const refs = (await listRefCovers(500)).filter((r) => refPoolGateOpen(r))
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

    // ★ ตรวจ (28 ก.ค. 69, ผู้ตรวจ): โหมด slotPlan แช่แข็ง (ปุ่ม ② composeFrozen ใน /m) ต้อง "ข้าม compass+S6 (LLM)
    //   ทั้งหมด" ตามคอมเมนต์เดิมจริง — ก่อนหน้านี้ compassBrain + MEGA_QUICK_GAP ถูกย้ายมาไว้ก่อนด่านนี้ (เพื่อให้
    //   QUICK_GAP ใช้ compass.mainCharacters ได้) ทำให้โหมดแช่แข็งเสียเวลา compass (10-30s) + อาจยิง gap-search
    //   (เป็นนาที) ทั้งที่ไม่ใช้ผลเลย จนชน AbortSignal/maxDuration ของ /m → คำนวณธง frozen ไว้ก่อน แล้วครอบทั้ง
    //   compassBrain และ MEGA_QUICK_GAP ด้วย `if (!frozen)` ด้านล่าง (ยังคง pool-building + pool.length<3 gate
    //   ให้ทำงานก่อนด่าน frozen เหมือนเดิมเป๊ะ — ไม่เปลี่ยนพฤติกรรมจุดนั้น)
    const frozen = Array.isArray(body.slotPlan) && body.slotPlan.length >= 3;

    // ── A (8 ก.ค.): ใช้ S6 จริง แทน heuristic หยาบ — เครื่องเทสสะท้อน production เป๊ะ ──
    //   ★ ข้อ 3 (28 ก.ค. 69 เคส AC-0195): ย้าย compass มาไว้ "ก่อน" สร้างพูล (เดิมอยู่หลัง) เพราะ MEGA_QUICK_GAP
    //   ด้านล่างต้องใช้ compass.mainCharacters (ชื่อตัวละครจริง — ห้ามมโน) ตอนตัดสินใจยิงค้นเสริม — ไม่กระทบ
    //   ลำดับการทำงานเดิมจุดอื่นเลย (compass ไม่ถูกใช้ระหว่างสร้างพูล อยู่แล้ว) · frozen=true → ข้ามบล็อกนี้ทั้งก้อน
    //   สร้าง job dossier ขั้นต่ำ → เรียก s6_slots (มี S6a บก.ศิลป์ + hero-authority + clean-sort + typeMatched gate ครบ)
    const t0 = Date.now();
    let origin = null;
    let compass = null;
    let storyQueries = [];
    if (!frozen) {
      // ★ ข้อ 3 (28 ก.ค. 69): defensive — origin ถูกใช้ (ใหม่) ก่อนถึงด่าน frozen-plan ด้านล่างแล้ว (สำหรับ QUICK_GAP)
      //   ผิดกับเดิมที่คำนวณหลัง frozen-check เสมอ (req.url รับประกันมีจริงในโปรดักชัน) — เครื่องมือเทส/สคริปต์ที่ยิง
      //   POST มาแบบ req จำลอง (ไม่มี .url) ต้องไม่ทำทั้งด่าน 500 พัง → ล้ม = null (ปลอดภัย ผลกระทบแค่ origin-based
      //   gap-search ข้ามไปเงียบๆ ถ้าทำไม่ได้ — ดู catch ใน MEGA_QUICK_GAP ด้านล่างอยู่แล้ว)
      try { origin = new URL(req.url).origin; } catch { origin = null; }
      // ★ A rev.2 (8 ก.ค. ผู้ใช้ชี้ "สมองไม่อ่านเนื้อข่าว"): รัน compassBrain บน "เนื้อข่าวเต็ม" ที่เคสเก็บไว้
      //   → ได้ angle/อารมณ์/ตัวละคร/visualDreamShots จริง (เท่า production) → S6 เลือกภาพตามบริบทข่าวได้
      //   ล้ม/ไม่มีเนื้อ → compass บางจาก analysis (ไม่พังเทส)
      const fullText = [c.analysis?.headline, c.newsText || c.analysis?.content || c.analysis?.summary || c.newsSnippet].filter(Boolean).join('\n\n');
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
      storyQueries = ['relationship_archive', 'lifestyle_travel', 'family_album', 'landmark_context', 'scene_place']
        .flatMap((k) => (Array.isArray(_kw[k]) ? _kw[k] : [])).map((s) => String(s).trim()).filter(Boolean);
    }

    // ── สร้างพูล (relevant → ตัดโปรโมท → ตัดสกปรก) — ห่อเป็นฟังก์ชันเรียกซ้ำได้ (ต้องเรียกอีกรอบหลัง gap-search) ──
    // ★ 9 ก.ค. เฟส 5.1+5.2 (แผนคุณภาพคลังรูป): พูลเข้าโรงประกอบต้องสะอาด default —
    //   คลังจริงพิสูจน์: clean แค่ 33.6% (AC-0058, โลโก้/ลายน้ำ 126 + ตัวหนังสือทับ 101 จาก 375)
    //   เดิมกรองแค่ relevant!==false → ภาพ clean=false เข้าพูลได้ พอของสะอาดขาดระบบจำใจหยิบของสกปรก
    //   ธง junkHidden (เฟส 5.3 AI junk scan ตั้งแทนลบถาวร) ห้ามเข้าพูลเสมอ ไม่ผูกกับ kill-switch ด้านล่าง
    //   kill-switch พูลสะอาด: POOL_CLEAN_GATE=0 = พฤติกรรมเดิม (เฉพาะ relevant!==false)
    const POOL_CLEAN_GATE = process.env.POOL_CLEAN_GATE !== '0';
    const POOL_MIN_FLOOR = 6; // พูลสะอาดบางกว่านี้ → อนุญาตเติม clean=false ที่ดีที่สุดกลับ (กันงานล่ม)
    const notHidden = (x) => x.triage?.junkHidden !== true;
    // ★ TIER2 สายงาน ข (เคส AC-0196): mirror ตัวกรอง promo ban ของ s6_slots จริง (megaAdapters.js) — ให้เครื่องมือ
    //   เทสนี้เห็น poolSize/POOL_TOO_THIN ตรงกับท่อจริง (s6_slots เองก็มีด่านเดียวกันซ้ำอีกชั้นตอนอ่าน r.images)
    //   ใช้ util กลาง src/lib/promoImageGuard.js ตัวเดียวกัน — ห้าม copy regex ซ้ำ 2 ที่
    //   สวิตช์แม่ MEGA_TIER2_OFF=1 = ปิด TIER2 ทั้งชุด (ปิด promo ban ด้วย) · เฉพาะจุด: MEGA_PROMO_BAN=0 = ปิด (พฤติกรรมเดิมเป๊ะ)
    const PROMO_BAN_ON = process.env.MEGA_TIER2_OFF !== '1' && process.env.MEGA_PROMO_BAN !== '0';
    function buildPool(imgsList) {
      const relevantImgs = imgsList.filter((x) => x.triage && x.triage.relevant !== false);
      const _hiddenImgs = relevantImgs.filter(notHidden);
      const _promoBannedImgs = PROMO_BAN_ON ? _hiddenImgs.filter((x) => isPromoImage(x)) : [];
      let visibleImgs = _promoBannedImgs.length
        ? _hiddenImgs.filter((x) => !_promoBannedImgs.some((b) => String(b.id) === String(x.id)))
        : _hiddenImgs;
      const promoFallbackIds = new Set();
      // ★ พื้นกันพูลล่ม (เหมือน dirtyFallback ด้านล่าง): แบนแล้วพูล < POOL_MIN_FLOOR และมีของให้เติม → คืนใบคะแนนดีสุดกลับ
      if (_promoBannedImgs.length && visibleImgs.length < POOL_MIN_FLOOR) {
        const need = POOL_MIN_FLOOR - visibleImgs.length;
        const promoBest = _promoBannedImgs
          .slice()
          .sort((a, b) => (Number(b.triage?.faceCount) || 0) - (Number(a.triage?.faceCount) || 0) || (Number(b.triage?.quality) || 0) - (Number(a.triage?.quality) || 0))
          .slice(0, need);
        promoBest.forEach((x) => promoFallbackIds.add(String(x.id)));
        visibleImgs = [...visibleImgs, ...promoBest];
        console.log(`[compose-test] 🚫🧹 promo ban: พูลบางกว่าพื้น (${POOL_MIN_FLOOR}) → เติมภาพโปรโมทคะแนนดีสุดกลับ ${promoBest.length} ใบ (กันงานล่ม)`);
      }
      const promoBannedCount = _promoBannedImgs.length - promoFallbackIds.size;
      if (promoBannedCount) console.log(`[compose-test] 🚫 promo ban: ตัดภาพโปรโมท/ฉากหลังรก ${promoBannedCount} ใบ (regex ตาคัด note) — พูลใช้จริง ${visibleImgs.length}`);
      const dirtyFallbackIds = new Set(promoFallbackIds); // ★ TIER2: ภาพโปรโมทที่เติมกลับกันพูลล่ม ติดธง dirtyFallback แบบเดียวกับ clean=false เติมกลับ
      let pool = visibleImgs;
      let cleanCount = visibleImgs.length; // POOL_CLEAN_GATE=0 = ไม่กรองสะอาด → ทั้งพูลนับเป็น "สะอาด" (พฤติกรรมเดิม)
      if (POOL_CLEAN_GATE) {
        const cleanOnly = visibleImgs.filter((x) => x.triage.clean !== false);
        cleanCount = cleanOnly.length;
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
      return { pool, dirtyFallbackIds, promoBannedCount, cleanCount };
    }

    let imgs = await readImages(caseId);
    let poolResult = buildPool(imgs);

    // ★ ข้อ 3 (28 ก.ค. 69 เคส AC-0195 — ปกคลาวด์พังหนัก: คลังสกปรก 100% clean=0/30): พูลสะอาดว่าง/บางกว่าพื้น →
    //   ยิง gap-search หาภาพสะอาดเพิ่ม 1 รอบ ก่อนค่อยเลือกภาพ (ใช้กลไก MEGA_HERO_GAP_CLOSEUP เดิมทั้งหมด — ขยาย
    //   trigger ผ่าน _cleanPoolGapFor ที่เพิ่มใน megaAdapters.js: ไม่ใช่แค่ "ตัวเอกไม่มีโคลสอัพ" แต่รวมกรณี "พูล
    //   สะอาดว่าง/บาง" ด้วย — คำค้นสร้างจากชื่อตัวละคร compass จริงเท่านั้น ห้ามมโน) · ยิง s5_gapsearch ตรงๆ (job
    //   ที่นี่เป็น local throwaway object ไม่ persist ที่ไหน เรียกได้ปลอดภัย ไม่ต้องกังวล gapSearchDone ค้าง)
    //   ค้นแล้วยังว่าง → แนบข้อความเตือนให้ผู้ใช้เห็นผ่าน qcReasons (ดูด้านล่าง) · flag MEGA_QUICK_GAP default ON
    const QUICK_GAP_ON = process.env.MEGA_QUICK_GAP !== '0';
    let _cleanPoolWarning = null;
    // ★ ตรวจ (28 ก.ค. 69): frozen=true ต้องไม่ยิง gap-search เลย (compass เป็น null ในโหมดนี้ด้วย — ใช้ไม่ได้อยู่แล้ว)
    if (!frozen && QUICK_GAP_ON && poolResult.cleanCount < POOL_MIN_FLOOR) {
      try {
        const { s5_gapsearch } = await import('@/lib/megaAdapters');
        const gapJob = { dossier: { images: { caseId, storyQueries }, compass, desk: { title: compass.angle } } };
        const gapResult = await s5_gapsearch(gapJob, { origin });
        console.log(`[compose-test] 🔎 MEGA_QUICK_GAP: พูลสะอาด ${poolResult.cleanCount}/${POOL_MIN_FLOOR} ก่อนค้น — ${gapResult?.summary || '(ไม่มีสรุป)'}`);
        imgs = await readImages(caseId); // ★ re-fetch: gap-search เก็บภาพใหม่เข้าคลังเคสเดียวกันแล้ว (addImages)
        poolResult = buildPool(imgs);
        console.log(`[compose-test] 🔎 MEGA_QUICK_GAP: หลังค้น พูลสะอาด ${poolResult.cleanCount}/${POOL_MIN_FLOOR}`);
      } catch (e) {
        console.log('[compose-test] 🔎 MEGA_QUICK_GAP: ค้นเสริมล้ม — เดินต่อด้วยพูลเดิม:', String(e?.message || '').slice(0, 60));
      }
      if (poolResult.cleanCount === 0) {
        _cleanPoolWarning = 'คลังเคสนี้ไม่มีภาพสะอาด — ควรใช้โหมดให้ AI หา';
      }
    }
    const { pool, dirtyFallbackIds, promoBannedCount } = poolResult;
    void promoBannedCount; // เก็บไว้เผื่ออนาคต (เดิมมีแค่ log ใน buildPool แล้ว ไม่ได้ใช้ต่อนอกฟังก์ชัน)
    if (pool.length < 3) return NextResponse.json({ success: false, error: `พูลเคสนี้มีแค่ ${pool.length} ใบ (ต้อง ≥3) — ยังตาคัดไม่พอ`, errorType: 'POOL_TOO_THIN' }, { status: 422 });

    // ★ เฟส 0.2 (โหมดเทสนิ่ง): ส่ง slotPlan แช่แข็งมาเอง = ข้าม compass+S6 (LLM) ทั้งหมด
    //   ใช้วัดเฉพาะชั้นประกอบ/ครอปแบบ before-after ได้จริง (อินพุตเดิมเป๊ะทุกรอบ) + ไม่เสียค่า LLM เลือกภาพซ้ำ
    //   ★ ใช้ธง `frozen` เดียวกับด้านบน (คำนวณครั้งเดียว กันสองเงื่อนไขดริฟท์กัน)
    if (frozen) {
      const t0f = Date.now();
      // ★ R5b.1 (audit sweep): variant (_derived) โผล่ในช่อง explicit-id ได้เฉพาะประตูเกรดเปิด+เกรดถึง — OFF = ใบจริงชุดเดิมเป๊ะ
      const refsF = (await listRefCovers(500)).filter((r) => r.dna && r.dna._reproducible !== false && (!r.dna._derived || refPoolGateOpen(r)));
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
        // ★ AC-0107 truthful parity (advisory tool ≠ Production): QC here is ADVISORY — HTTP success follows out.success,
        //   NOT qcVerdict.pass — so a QC-FAILED cover is still success:true here. productionQcPass mirrors the Production
        //   HARD gate (/cover-ref-test): false = Production would 422 + ZERO-archive this exact output. Does not change the
        //   advisory semantics (frozen diagnostic mode intact) — it only stops success:true from misleading callers.
        productionQcPass: qcVerdictF?.pass !== false,
        refUsed: { id: refF.id, styleName: refF.styleName || refF.id, imagePath: refF.imagePath },
        elapsed: `${((Date.now() - t0f) / 1000).toFixed(1)}s`,
      }, { status: outF.success ? 200 : 422 });
    }

    // ── เลือก ref (ระบุเอง หรือ auto-match ตามอารมณ์ข่าว) — เฉพาะใบที่ทำตามได้จริง ──
    // ★ R5b.1 (audit sweep): กติกาเดียวกับ refsF — variant เข้าลิสต์เฉพาะประตูเปิด+เกรดถึง
    const refs = (await listRefCovers(500)).filter((r) => r.dna && r.dna._reproducible !== false && (!r.dna._derived || refPoolGateOpen(r)));
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
        // ★ ข้อ 1 (28 ก.ค. 69 เคส AC-0195, MEGA_SECOND_EYE): ต่อสาย _secondEyeFaceBox แบบเดียวกับ s7_cover จริง —
        //   ให้เครื่องมือเทสนี้ได้ผลตรวจตาสองที่ s6_slots ทำไว้แล้วไปถึงชั้นเรนเดอร์ด้วย (ไม่งั้นบั๊กเดิมที่วินิจฉัย
        //   จากเครื่องมือนี้จะไม่เห็นผลของด่านตาสองที่เพิ่งแก้เลย)
        ...(primary && slots[primary]?._secondEyeFaceBox ? { _secondEyeFaceBox: slots[primary]._secondEyeFaceBox } : {}),
        // ★ เคสไรเดอร์ (28 ก.ค. 69): ต่อสาย _secondEyeHeroFaceHidden แบบเดียวกับ _secondEyeFaceBox เป๊ะ
        ...(primary && slots[primary]?._secondEyeHeroFaceHidden ? { _secondEyeHeroFaceHidden: slots[primary]._secondEyeHeroFaceHidden } : {}),
        // ★ เคส AC-0201 รอบ 2 (28 ก.ค. 69): ต่อสาย _secondEyeSubSlotFlag แบบเดียวกับ _secondEyeHeroFaceHidden เป๊ะ
        ...(primary && slots[primary]?._secondEyeSubSlotFlag ? { _secondEyeSubSlotFlag: slots[primary]._secondEyeSubSlotFlag } : {}),
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

    // 🗂️ 9 ก.ค. (ผู้ใช้สั่ง "ทุกครั้งที่กดสร้างปกเข้าคลังออโต้"): ผลสำเร็จเด้งเข้าคลังงาน MEGA
    // ★ 27 ก.ค. 69 (เจ้าของเคาะนโยบายใหม่ "เก็บทุกใบ+ติดป้ายสถานะ" — แทนที่ AC-0107 ZERO-archive เดิม):
    //   เก็บเข้าคลังเสมอเมื่อ out.success && out.base64 (ไม่เช็ค QC pass อีกต่อไป) — ใบที่ QC ไม่ผ่านติดป้าย
    //   qcStatus:'manual_review' + qcReasons ให้คนดูรู้ว่าต้องตรวจก่อนใช้จริง (ดูป้ายที่ /m คลังปก)
    let archived = null;
    let archiveSkipReason = null; // ★ เลิกกลืน error เงียบ — ไม่เข้าคลัง = ต้องบอกเหตุผลเสมอ
    const qcStatus = qcVerdict?.pass === false || _cleanPoolWarning ? 'manual_review' : 'pass';
    // ★ ข้อ 3 (28 ก.ค. 69 เคส AC-0195): แนบคำเตือน "คลังเคสนี้ไม่มีภาพสะอาด" ต่อท้าย qcReasons ปกติ (ช่องทางเดิม
    //   ที่แอป /m แสดงผลอยู่แล้วเวลา manual_review — ไม่ต้องเปิดฟิลด์ใหม่)
    const qcReasons = [
      ...(Array.isArray(qcVerdict?.reasons) ? qcVerdict.reasons.slice(0, 6) : []),
      ...(_cleanPoolWarning ? [_cleanPoolWarning] : []),
    ];
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
          qcStatus, // 'pass' | 'manual_review'
          qcReasons, // เหตุผลสั้นๆ เวลา manual_review
        });
      } catch (e) {
        console.warn('[compose archive]', e.message);
        archiveSkipReason = 'archive_error:' + e.message;
      }
    } else {
      archiveSkipReason = !out.success ? 'compose_failed' : 'no_base64';
    }

    // ★ 17 ก.ค. (ทางเข้า editor): แนบสูตรเอดิเตอร์ให้ผลทุกใบ (ผ่าน/ไม่ผ่าน QC) — เปิดแก้ต่อใน /cover-tester ได้ทันที
    //   fail-open: สร้างสูตรไม่ได้ = null เฉยๆ ไม่กระทบผลประกอบ
    let editorRecipe = null;
    try {
      const { buildEditorRecipe } = await import('@/lib/editorRecipe');
      const _rcJob = {
        id: `CT-${caseId}`,
        // ★ 17 ก.ค. (บั๊กปก≠ผัง editor): แนบ manifest ของผลประกอบจริง — editorRecipe ยึดผังสุดท้ายหลังทุกการสลับ
        dossier: { ...job.dossier, pickImages: { ...(job.dossier.pickImages || {}), slots }, cover: { qcVerdict, manifest: out.manifest || null } },
      };
      editorRecipe = buildEditorRecipe({ job: _rcJob, caseImages: imgs }) || null;
    } catch { editorRecipe = null; }

    return NextResponse.json({
      ...out,
      caseId,
      qcVerdict,
      editorRecipe, // ★ 17 ก.ค.: สูตรสำหรับปุ่ม "แก้ต่อในเอดิเตอร์" (null = สร้างไม่ได้)
      // ★ 27 ก.ค. 69: HTTP success:true still follows out.success (advisory) — so a QC-FAILED cover is still
      //   success:true here. productionQcPass mirrors the Production HARD gate (/cover-ref-test) for diagnostics only:
      //   false = Production strict lane would 422 + ZERO-archive there — ไม่ผูกกับการเข้าคลังของเครื่องมือนี้แล้ว
      //   (นโยบายใหม่ "เก็บทุกใบ+ติดป้ายสถานะ" — ดู qcStatus/archiveSkipReason ด้านล่าง)
      productionQcPass: qcVerdict?.pass !== false,
      refUsed: ref ? { id: ref.id, styleName: ref.styleName || ref.id, imagePath: ref.imagePath } : null,
      archivedId: archived?.id || null, // เข้าคลัง /mega-covers แล้ว (โหลดภาพ: /api/mega-covers/img?id=..&dl=1)
      qcStatus, // 'pass' | 'manual_review' — ป้ายสถานะใบที่เข้าคลัง (badge ฝั่ง /m)
      archiveSkipReason, // null = เข้าคลังสำเร็จ · ไม่ null = เหตุผลที่ไม่เข้าคลัง (เช่น 'compose_failed' / 'archive_error:...')
      poolSize: pool.length,
      poolDirtyFallback: dirtyFallbackIds.size, // ★ เฟส 5.1: จำนวนใบ clean=false ที่เติมเข้าพูลเพราะสะอาดบางเกินไป (debug)
      slotPlanUsed: slotPlan, // เฟส 0.2: ให้เครื่องเทสเก็บไปแช่แข็ง (โหมด slotPlan ด้านบน)
      elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    }, { status: out.success ? 200 : 422 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
