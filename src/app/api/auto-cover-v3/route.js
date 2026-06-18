import { NextResponse } from 'next/server';

/**
 * =====================================================
 * Auto Cover v3 — Vision Director Edition
 * =====================================================
 * สถาปัตยกรรม (11 มิ.ย. — ออกแบบร่วมกับผู้ใช้):
 *   ① สมองเดิมหาภาพ+คัด (storyIdentity → multiAgent scrape → judge)
 *   ② AI Vision เป็น "ผู้กำกับ" — เห็นภาพจริง → สั่งเป็นตัวเลข (ช่อง+กรอบครอป)
 *   ③ ตัวประกอบพิกเซลแท้ทำตามเป๊ะ (extract/resize เท่านั้น — รูปต้นฉบับ 100%)
 *   ④ AI ตรวจงานตัวเอง 1 รอบ → แก้กรอบ → ประกอบใหม่
 * ไม่มีสูตรครอป ไม่มี face-detection math ไม่มี fade — แยกจาก v1 ทั้งเส้น เทียบ A/B ได้
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

// ★ ล็อกเร็นเดอร์ทีละใบต่อเครื่อง (ผู้ใช้สั่ง 11 มิ.ย.: ปกหลายใบพร้อมกัน = แย่งทรัพยากร/เสี่ยงระบบพัง)
//   งานที่มาทีหลังต่อแถวรอใบก่อนเสร็จ — กันทั้งงานคิว+ยิงตรง API พร้อมกัน
let _renderLock = Promise.resolve();

export async function POST(request) {
  const prevLock = _renderLock;
  let releaseLock;
  _renderLock = new Promise((r) => (releaseLock = r));
  await prevLock;
  try {
    return await _renderCoverV3(request);
  } finally {
    releaseLock();
  }
}

async function _renderCoverV3(request) {
  const t0 = Date.now();
  let markQueueJob = async () => {};

  try {
    const body = await request.json();
    const { content, newsTitle = '', sourceUrl = '', _queueJobId = null, forceTemplateId = null } = body;

    if (!content && !newsTitle) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ content หรือ newsTitle', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    markQueueJob = async (status, extra = {}) => {
      if (!_queueJobId) return;
      try {
        const { updateJobStatus } = await import('@/lib/services/queueService');
        await updateJobStatus(_queueJobId, status, { ...extra, completedAt: new Date().toISOString() });
      } catch (e) { console.log('[CoverV3] markQueueJob failed:', e.message); }
    };

    // ★ REV MARKER — ยืนยันว่าเซิร์ฟเวอร์รันโค้ดเวอร์ชันไหน (เช็ค log ก่อนเทสทุกครั้ง — กัน staleness)
    const COVER_REV = 'rev-14x-2026-06-18 hero-single+dedup'; // + ค้นภาพอารมณ์/สัมภาษณ์ ให้ hero สื่ออารมณ์ทุกรอบ
    console.log(`[CoverV3] 🏷️ CODE ${COVER_REV} — รันโค้ดเวอร์ชันนี้`);

    // ── ① Identity + Scrape + Judge (สมองเดิม — พิสูจน์แล้ว) ──
    console.log('[CoverV3] ① Story identity...');
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');
    let identity = await analyzeStoryIdentity(
      newsTitle || (content || '').slice(0, 100),
      { core_story: content || newsTitle }
    );
    if (!identity) {
      // ★ ข่าวฉาก/ฝูงชนไม่มีบุคคลตัวหลัก (เช่น ประชาชนเรียงแถวถวายบังคม) — เดิม fail ทั้งงาน (IDENTITY_FAILED 422)
      //   → fallback โหมด "เหตุการณ์นำ": ใช้ใจความข่าวแทนตัวบุคคล ให้ pipeline เดินต่อได้
      const headline = (newsTitle || (content || '').slice(0, 80)).trim();
      identity = {
        mainCharacter: headline.slice(0, 60) || 'เหตุการณ์ในข่าว',
        storyType: 'event_scene',
        coreStory: { celebratedAction: (content || newsTitle || '').slice(0, 200) },
        mainVisualShouldBe: headline,
        _fallback: true,
      };
      console.log('[CoverV3] ⚠️ identity fallback: ข่าวไม่มีตัวหลัก → โหมดเหตุการณ์นำ');
    }
    console.log(`[CoverV3] identity: ${identity.mainCharacter} | ${identity.storyType}`);

    console.log('[CoverV3] ② Multi-agent search + judge...');
    const { runMultiAgentImageSearch } = await import('@/lib/services/multiAgentImageScraper');
    const selected = await runMultiAgentImageSearch(
      sourceUrl || '', sourceUrl ? 'url' : 'text',
      identity.characters || [],
      newsTitle || (content || '').slice(0, 100),
      identity
    );

    // ดาวน์โหลดภาพเป็น buffer (เฉพาะตัวท็อปที่ judge คัดแล้ว)
    const candidates = (selected || []).filter(img => img?.url).slice(0, 10);
    let imageBuffers = [];
    await Promise.all(candidates.map(async (img) => {
      try {
        if (img.buffer) { imageBuffers.push(img); return; }
        const isData = String(img.url).startsWith('data:');
        if (isData) {
          const b64 = String(img.url).split(',')[1];
          imageBuffers.push({ ...img, buffer: Buffer.from(b64, 'base64') });
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(img.url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timer);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5000) imageBuffers.push({ ...img, buffer: buf });
      } catch { /* ข้ามภาพโหลดไม่ได้ */ }
    }));
    console.log(`[CoverV3] downloaded ${imageBuffers.length}/${candidates.length} buffers`);

    // ── ตรวจจับตำแหน่งใบหน้า → ป้อนเป็น "ข้อมูลพิกัด" ให้ Director คำนวณกรอบแน่นแบบตัวเลข
    //    (rev.7 — feedback: ฮีโร่ไม่เด่น/วงกลมล้น เพราะ Director กะกรอบด้วยตาแล้วหลวม)
    let faceBoxes = [];
    try {
      const { batchDetectFaces } = await import('@/lib/services/faceDetector');
      const fdMap = await batchDetectFaces(imageBuffers.map((img, i) => ({ id: `v3_${i}`, buffer: img.buffer })));
      const sharpLib = (await import('sharp')).default;
      faceBoxes = await Promise.all(imageBuffers.map(async (img, i) => {
        const fd = fdMap?.get?.(`v3_${i}`);
        const hasText = !!fd?.hasBigText; // ★ สกรีนช็อต/กราฟิกข่าว — ต้องส่งธงต่อแม้ไม่มีหน้า
        const textRegion = fd?.textRegion || null; // ★ โซนข้อความ — ครอปคนหลบโซนนี้ = ใช้เฟรมรายการได้
        if (!fd?.hasFaces || !fd.faces?.length) return hasText ? { hasText, textRegion } : null;
        const meta = await sharpLib(img.buffer).metadata();
        const W = meta.width || 1, H = meta.height || 1;
        const largest = fd.faces.reduce((b, f) => (f.width * f.height > b.width * b.height ? f : b), fd.faces[0]);
        // rev.14d: กรอง "หน้าเล็กฉากหลัง" ทิ้งก่อนนับ (เล็กกว่า 35% ของหน้าใหญ่สุด = ฉากหลัง/คนผ่าน)
        //    แก้ CASE-082: ฉาก TV มีหน้าเล็กหลัง → count≥2 → ระบบคิดว่าภาพกลุ่ม → hero ไม่ครอปหน้าเดี่ยว
        const largestArea = largest.width * largest.height;
        const sig = fd.faces.filter(f => (f.width * f.height) >= 0.35 * largestArea);
        return {
          x1: +(largest.x / W).toFixed(2), y1: +(largest.y / H).toFixed(2),
          x2: +((largest.x + largest.width) / W).toFixed(2), y2: +((largest.y + largest.height) / H).toFixed(2),
          count: sig.length, // นับเฉพาะหน้าเด่น (เดี่ยว=1 จะครอปหน้าเต็มช่อง)
          // rev.14b: เก็บ "หน้าเด่นทุกใบ" (0-1) ให้ executor กระชับกลุ่มหน้า (ภาพคู่/ครอบครัว) ให้เต็มเฟรม
          allFaces: sig.map(f => ({
            x1: +(f.x / W).toFixed(3), y1: +(f.y / H).toFixed(3),
            x2: +((f.x + f.width) / W).toFixed(3), y2: +((f.y + f.height) / H).toFixed(3),
          })),
          ...(hasText ? { hasText, textRegion } : {}),
        };
      }));
      console.log(`[CoverV3] face boxes: ${faceBoxes.filter(b => b && b.x1 !== undefined).length}/${imageBuffers.length} images | มีตัวหนังสือฝัง: ${faceBoxes.filter(b => b?.hasText).length}`);
    } catch (e) { console.log('[CoverV3] face detect failed (non-fatal):', e.message?.slice(0, 50)); }

    // ── rev.13: จัดลำดับสระภาพตาม "ความแน่นของใบหน้า" ก่อนส่ง Director ──
    //    feedback (ตัวอย่างหนุ่ม กรรชัย): ทุกช่องหน้าเต็มกรอบคมชัด ไม่มีภาพกว้าง/หน้าเล็ก
    //    → ภาพหน้าใหญ่/โคลสอัพลอยขึ้นก่อน, ภาพกว้าง-คนเยอะ-สกรีนช็อตจมท้ายแถว
    //    (Director มี position bias—หยิบภาพต้นแถวเป็น hero; เรียงหน้าคมขึ้นบน = hero เด่นขึ้น)
    if (faceBoxes.length === imageBuffers.length && imageBuffers.length > 3) {
      try {
        const scored = imageBuffers.map((img, i) => {
          const fb = faceBoxes[i];
          let s;
          if (fb && fb.x2 > fb.x1) {
            s = (fb.x2 - fb.x1) * (fb.y2 - fb.y1); // สัดส่วนพื้นที่หน้า/ภาพ — ใหญ่=โคลสอัพ=ดี
            if (fb.count === 1) s += 0.06;          // จุดโฟกัสเดียว (หน้าเดี่ยวเด่น — มักเป็น hero)
            else if (fb.count === 2) s += 0.02;     // ภาพคู่
            else if (fb.count >= 4) s -= 0.05;      // rev.14t: ผ่อนโทษภาพหมู่ (ผู้ใช้ชอบภาพครอบครัว CASE-104) — โทษเฉพาะคนเยอะจริงๆ
            if (fb.hasText) s -= 0.08;              // ตัวหนังสือฝัง = เสี่ยงเข้าช่องคน
          } else if (fb && fb.hasText) {
            s = -0.2;                               // สกรีนช็อต/กราฟิก — ท้ายแถว
          } else {
            s = -0.1;                               // ฉากล้วน/ไม่มีหน้า — รองจากภาพคน
          }
          return { img, fb, s };
        });
        scored.sort((a, b) => b.s - a.s);
        imageBuffers = scored.map(o => o.img);
        faceBoxes = scored.map(o => o.fb);
        console.log(`[CoverV3] 🔝 re-ranked pool by face tightness: [${scored.map(o => o.s.toFixed(2)).join(', ')}]`);
      } catch (e) { console.log('[CoverV3] re-rank skipped (non-fatal):', e.message?.slice(0, 40)); }
    }

    // ── rev.14f: เก็บเฉพาะภาพ "ตรวจเจอหน้า" — กัน Director หยิบภาพเต็มตัว/ไกลที่ครอปหน้าไม่ได้ ──
    //    กฎเหล็กผู้ใช้: ทุกช่องต้องเห็นหน้าชัดรู้ว่าใคร (บทเรียน CASE-084 คู่เต็มตัวหน้าเล็ก)
    //    ทำเฉพาะเมื่อยังเหลือภาพมีหน้า ≥4 ใบ (พอจัดปกได้) — ไม่งั้นคงพูลเดิม
    try {
      // ★★★ rev.14p: ROOT-CAUSE FIX ความนิ่ง — "ด่านคุณภาพภาพเข้าพูล"
      //   variance หลัก = ค้นรูปได้ภาพต่างกันทุกรอบ (เต็มตัว/แคนดิด/พอร์ตเทรต) → คุมที่ด่านนี้
      //   ผ่านเฉพาะ "หน้าใหญ่พอ (โคลสอัพ)" + ไม่มีตัวหนังสือ → ครอปแล้วคม+เด่น → output นิ่งแม้ input แกว่ง
      const areaOf = (fb) => (fb && fb.x2 > fb.x1 && !fb.hasText) ? (fb.x2 - fb.x1) * (fb.y2 - fb.y1) : 0;
      const pick = (minArea) => imageBuffers.map((_, i) => areaOf(faceBoxes[i]) >= minArea);
      let mask = pick(0.045);                                    // เข้มสุด: หน้าโคลสอัพคม
      if (mask.filter(Boolean).length < 3) mask = pick(0.028);   // ผ่อน 1: ครึ่งตัว+
      if (mask.filter(Boolean).length < 3) mask = pick(0.012);   // ผ่อน 2: ขอแค่มีหน้าชัดพอ
      const kept = mask.filter(Boolean).length;
      if (kept >= 3 && kept < imageBuffers.length) {
        const ibNew = [], fbNew = [];
        imageBuffers.forEach((img, i) => { if (mask[i]) { ibNew.push(img); fbNew.push(faceBoxes[i]); } });
        console.log(`[CoverV3] 👤 close-up gate: เหลือ ${ibNew.length}/${imageBuffers.length} (เฉพาะหน้าใหญ่คม)`);
        imageBuffers = ibNew; faceBoxes = fbNew;
      }
    } catch (e) { console.log('[CoverV3] close-up gate skipped:', e.message?.slice(0, 40)); }

    // ── rev.14j: ตัดภาพ "เกือบซ้ำ" (เฟรม/ชุดเดียวกัน) ด้วย average-hash — กัน hero โผล่ซ้ำช่องอื่น ──
    //    บทเรียน CASE-090: hero เบนซ์ชุดน้ำเงิน + ขวาล่างเบนซ์ชุดน้ำเงิน = ซ้ำ. เก็บใบที่หน้าคมสุด(เรียงแล้ว)
    try {
      const sharpLib2 = (await import('sharp')).default;
      const hashes = await Promise.all(imageBuffers.map(async (img) => {
        try {
          const raw = await sharpLib2(img.buffer).grayscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
          let sum = 0; for (let k = 0; k < raw.length; k++) sum += raw[k];
          const avg = sum / raw.length;
          let bits = 0n;
          for (let k = 0; k < raw.length; k++) if (raw[k] > avg) bits |= (1n << BigInt(k));
          return bits;
        } catch { return null; }
      }));
      const keep = [], kept = [];
      imageBuffers.forEach((img, i) => {
        const h = hashes[i];
        if (h === null) { keep.push(i); return; }
        const dup = kept.some(kh => { let x = kh ^ h, d = 0; while (x) { d += Number(x & 1n); x >>= 1n; } return d <= 10; }); // rev.14x: เข้มขึ้น 6→10 จับภาพคล้าย (คู่ยืนชุดเดียวกัน)
        if (!dup) { keep.push(i); kept.push(h); }
      });
      if (keep.length >= 4 && keep.length < imageBuffers.length) {
        imageBuffers = keep.map(i => imageBuffers[i]);
        faceBoxes = keep.map(i => faceBoxes[i]);
        console.log(`[CoverV3] 🧬 dedup near-duplicate → ${imageBuffers.length} ใบ`);
      }
    } catch (e) { console.log('[CoverV3] dedup skipped:', e.message?.slice(0, 40)); }

    // ── Quality floor (หลักเดียวกับ v1) ──
    const { V3_TEMPLATES, adaptRegistryTemplate } = await import('@/lib/services/coverExecutorService');
    if (imageBuffers.length < 3) {
      const msg = `ภาพใช้ได้ ${imageBuffers.length} ใบ (ต้องการอย่างน้อย 3) — ข่าวนี้ภาพหายาก`;
      await markQueueJob('failed', { error: msg });
      return NextResponse.json({ success: false, error: msg, errorType: 'INSUFFICIENT_QUALITY_IMAGES' }, { status: 422 });
    }

    // ── rev.13: "งบช่อง" ตามจำนวนหน้าคมจริง — กันโครงช่องเยอะดูดภาพแย่มาเติม ──
    //    บทเรียน CASE-069: บังคับ 6 ช่องทั้งที่หน้าคมมี ~3-4 ใบ → 2 ช่องเป็นขยะ (ไหล่ไม่มีหัว + วงกลมรก)
    //    นับเฉพาะภาพที่มี "หน้าใหญ่พอ" (≥3% ของภาพ) คนไม่เกิน 3 ไม่มีตัวหนังสือ → เลือกโครงไม่เกินจำนวนนั้น+1
    const cleanFaceCount = faceBoxes.filter(fb =>
      fb && fb.x2 > fb.x1 && ((fb.x2 - fb.x1) * (fb.y2 - fb.y1)) >= 0.03 && (fb.count || 1) <= 3 && !fb.hasText
    ).length;
    // rev.14n: ตัด "+1" ทิ้ง — ทุกช่องต้องเป็น "หน้าคม" เท่านั้น (เสถียรทุกรอบ, ห้ามภาพไม่เจอหน้า/เต็มตัวหลุดเข้าช่อง)
    //   บทเรียน CASE-097: +1 เปิดช่องให้ภาพไม่เจอหน้า(เบนซ์เต็มตัว)เป็น hero → ครึ่งตัวหน้าเล็ก = พัง
    let slotBudget = Math.max(3, Math.min(imageBuffers.length, cleanFaceCount));
    // rev.14m: ข่าวคู่รัก/ครอบครัว — รูปเดี่ยวคมจำกัด → บังคับโครง 4 ช่อง (faces_circle) ที่สะอาดสุด
    //   บทเรียน CASE-094: 5-6 ช่องดูดภาพหมู่/กลุ่มมาเติม หน้าไม่เด่น; 4 ช่อง (hero+2+วงกลม) สะอาดกว่า
    const stRel = (identity?.storyType || '').toLowerCase();
    if (/warm|family|relationship|romance|couple|love/.test(stRel)) slotBudget = Math.min(slotBudget, 4);
    console.log(`[CoverV3] 🎯 หน้าคมใช้ได้ ${cleanFaceCount} ใบ → งบช่อง = ${slotBudget} (จากพูล ${imageBuffers.length})`);

    // ── ② AI Vision Director — เลือกโครงเองจากแม่บทที่แกะจากปกไวรัลจริง ──
    // ★ rev.12: บังคับลุคไวรัลในโค้ด — ภาพพอเมื่อไหร่ ให้เลือกได้เฉพาะโครงที่มี "วงกลม+กรอบไฮไลต์"
    //   (บทเรียน CASE-045/050: เตือนใน prompt แล้ว Director ยังหนีไปโครงเรียบ → "การนำเสนอห่วย")
    const viralFirst = [
      V3_TEMPLATES.vt_faces_circle, // 4 ภาพ — ★ โครงตัวอย่าง (hero เต็มซ้าย + ขวา 2 + วงกลมทับตัว) สะอาดสุด เลือกก่อน
      V3_TEMPLATES.vt_hero_stack,   // 5 ภาพ — hero เต็มซ้าย + ขวา 3 (วงกลม+คลิป)
      V3_TEMPLATES.vt_quad_circle,  // 5 ภาพ — สองฝ่าย ให้-รับ (วงกลมกลาง)
    ].filter(t => t.slots.length <= slotBudget);
    const plainFallbacks = [
      V3_TEMPLATES.vt_hero_br,      // 4 ภาพ — อารมณ์น้ำตาเป็นจุดขาย
      V3_TEMPLATES.vt_hero_wide,    // 4 ภาพ — คนเล่า/สัมภาษณ์ + คู่กรณี
      V3_TEMPLATES.v3_grid3,        // 3 ภาพ — fallback ตารางสะอาด
    ].filter(t => t.slots.length <= slotBudget);
    // forceTemplateId: บังคับโครงเจาะจง (ใช้ทดสอบ/Cover Lab เลือกเอง) — ข้าม viral-first logic
    const forced = forceTemplateId && V3_TEMPLATES[forceTemplateId] ? [V3_TEMPLATES[forceTemplateId]] : null;
    const templateOptions = forced || (viralFirst.length > 0 ? viralFirst : plainFallbacks);

    console.log(`[CoverV3] ③ Director (options: ${templateOptions.map(t => t.id).join(', ')} | pool=${imageBuffers.length})...`);
    const { directCover, reviewCover } = await import('@/lib/services/coverDirectorService');
    const direction = await directCover({ imageBuffers, identity, templateOptions, templateSpec: templateOptions[0], newsTitle, faceBoxes });
    if (!direction) {
      await markQueueJob('failed', { error: 'AI Director จัดวางไม่สำเร็จ' });
      return NextResponse.json({ success: false, error: 'AI Director จัดวางไม่สำเร็จ', errorType: 'DIRECTOR_FAILED' }, { status: 422 });
    }
    const templateSpec = direction.templateSpec; // โครงที่ Director เลือก

    // ── ③ Execute (พิกเซลแท้) ──
    const { executeCover, applyFixes } = await import('@/lib/services/coverExecutorService');
    let assignments = direction.assignments;
    let coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec, faceBoxes });
    console.log(`[CoverV3] ④ composed ${Math.round(coverBuffer.length / 1024)}KB`);

    // ── ④ Self-QC 1 รอบ (rev.8: สลับรูปได้ | rev.11: รู้เนื้อข่าว — จับภาพไม่เกี่ยวกับเรื่องได้) ──
    const qc = await reviewCover({ coverBuffer, templateSpec, assignments, imageBuffers, faceBoxes, identity, newsTitle });
    let qcApplied = false;
    if (!qc.ok && qc.fixes.length > 0) {
      assignments = applyFixes(assignments, qc.fixes);
      coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec, faceBoxes });
      qcApplied = true;
      console.log(`[CoverV3] ⑤ QC fixes applied (${qc.fixes.length}) → recomposed`);
    } else {
      console.log('[CoverV3] ⑤ QC passed first try');
    }

    // ── ให้คะแนนปกด้วย mini-judge (แก้ป้าย 0/10 ในคลัง) ──
    let score = 7;
    try {
      const { callAI } = await import('@/lib/ai/openai');
      const smallForScore = await (await import('sharp')).default(coverBuffer).resize(600, null, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      // งานจากคิวมักไม่มี newsTitle → ใช้ identity แทน และบังคับให้คะแนนจากภาพเสมอ (กัน "ข้อมูลไม่พอ" = 0/10)
      const judgeCtx = (newsTitle || identity?.mainCharacter || identity?.storyType || '').slice(0, 80);
      const judgeRes = await callAI({
        prompt: `ให้คะแนนปกข่าวนี้ 0-10 จากภาพที่แนบ (องค์ประกอบ, ความเด่นของบุคคล, การเล่าเรื่อง, ความสะอาด)${judgeCtx ? ` บริบท: "${judgeCtx}"` : ''}\nต้องประเมินจากภาพเสมอแม้ไม่มีบริบทข่าว ห้ามตอบว่าข้อมูลไม่เพียงพอ\nตอบ JSON: {"score": 0-10, "reason": "สั้นๆ"}`,
        imageContents: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${smallForScore.toString('base64')}`, detail: 'low' } }],
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 300,
      });
      const j = typeof judgeRes === 'object' ? judgeRes : JSON.parse(String(judgeRes).match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (Number.isFinite(Number(j?.score))) score = Math.max(0, Math.min(10, Number(j.score)));
      console.log(`[CoverV3] 🏆 Judge score: ${score}/10 — ${String(j?.reason || '').slice(0, 70)}`);
    } catch (e) { console.log('[CoverV3] judge failed (non-fatal):', e.message?.slice(0, 50)); }

    // ── Archive (reuse v1 case archive) ──
    let caseId = null;
    try {
      const { saveCase } = await import('@/lib/services/coverCaseArchive');
      const saved = await saveCase(coverBuffer, {
        newsTitle: newsTitle || (content || '').slice(0, 80),
        content: (content || '').slice(0, 500),
        score,
        templateUsed: templateSpec.id,
        elapsed: (Date.now() - t0) / 1000,
        imageCount: assignments.length,
        identity: { mainCharacter: identity.mainCharacter, storyType: identity.storyType, composer: 'v3-director' },
      });
      caseId = saved?.caseId || null;
      console.log(`[CoverV3] 📁 archived as ${caseId}`);
    } catch (e) { console.log('[CoverV3] archive failed (non-fatal):', e.message?.slice(0, 60)); }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[CoverV3] ✅ Done in ${elapsed}s`);

    const responsePayload = {
      success: true,
      composer: 'v3-director',
      base64: `data:image/jpeg;base64,${coverBuffer.toString('base64')}`,
      template: templateSpec.id,
      assignments: assignments.map(a => ({ slot: a.slotId, image: a.imageIndex, crop: a.crop, why: a.why })),
      directorReason: direction.reason,
      qcApplied,
      score,
      caseId,
      elapsed: `${elapsed}s`,
      identity: { mainCharacter: identity.mainCharacter, storyType: identity.storyType },
    };
    await markQueueJob('completed', { result: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[CoverV3] Pipeline error:', error.message);
    await markQueueJob('failed', { error: error.message });
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'PIPELINE_ERROR' },
      { status: 500 }
    );
  }
}
