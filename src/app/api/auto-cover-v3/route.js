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
    const { content, newsTitle = '', sourceUrl = '', _queueJobId = null, forceTemplateId = null, mainCharacterName = '' } = body;
    // ★ 25 มิ.ย.: แหล่งรูปที่พนักงานระบุเอง (ไม่บังคับ) — ลิงก์ YouTube/ข่าว/TikTok/IG ที่มีภาพบุคคลนั้นเยอะ
    //   รับได้หลายลิงก์ (array หรือ string คั่นบรรทัด) → ระบบดึงรูปจากตรงนี้ก่อน บูสต์ขึ้นหน้า (ยังผ่าน judge)
    const sourceLinks = Array.isArray(body.sourceLinks)
      ? body.sourceLinks
      : String(body.sourceLinks || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    // ★ 26 มิ.ย.: โหมด "เฉพาะภาพในคลิป/แหล่งที่ระบุ" — ใช้ภาพจากลิงก์ล้วน ไม่รีเสิร์ชเพิ่ม
    //   (มีผลเฉพาะเมื่อมี sourceLinks · ถ้าดึงไม่ได้เลย route จะถอยไปรีเสิร์ชปกติเอง)
    const sourceOnly = !!body.sourceOnly && sourceLinks.length > 0;

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
    const COVER_REV = 'rev-20k-2026-06-21 เฟรมคลิป: นับหน้า+ตัดตึก+ครอปหน้าตัดคำบรรยาย';
    console.log(`[CoverV3] 🏷️ CODE ${COVER_REV} — รันโค้ดเวอร์ชันนี้`);

    // ★ ตาข่ายชั้นท้าย (19 มิ.ย. — ผู้ใช้สั่ง): เช็ค "API หมดเครดิต/โควต้า" ก่อนเริ่ม
    //   ฝั่ง UI เช็คตอนกดสร้างแล้ว — ชั้นนี้กันงานที่ลัดผ่าน UI (Discord/cron) + เครดิตหมดเพิ่งเกิด
    //   ถ้าหมดเครดิต Director/Judge จะพังทั้งหมด → คืน error ชัด ไม่เสียเวลาทำจนได้ "ปกกาๆ"
    try {
      const { checkOpenAICredit } = await import('@/lib/aiCreditPreflight');
      const credit = await checkOpenAICredit();
      if (!credit.ok) {
        console.warn(`[CoverV3] 🛑 preflight block: ${credit.errorType} — ${credit.error}`);
        await markQueueJob('failed', { error: credit.error });
        // 200 + success:false → worker เก็บข้อความสะอาดให้ UI โชว์ตรงๆ (ไม่ถูกห่อเป็น "HTTP 5xx — {json}")
        return NextResponse.json({ success: false, error: credit.error, errorType: credit.errorType }, { status: 200 });
      }
    } catch (e) { console.log('[CoverV3] credit preflight skipped (non-fatal):', e.message?.slice(0, 50)); }

    // ── ① Identity + Scrape + Judge (สมองเดิม — พิสูจน์แล้ว) ──
    console.log('[CoverV3] ① Story identity...');
    const { analyzeStoryIdentity } = await import('@/lib/services/storyIdentityService');
    let identity = await analyzeStoryIdentity(
      newsTitle || (content || '').slice(0, 100),
      { core_story: content || newsTitle },
      { overrideMainCharacter: mainCharacterName }
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
    if (sourceLinks.length) console.log(`[CoverV3] 🔗 แหล่งรูปพนักงาน ${sourceLinks.length} ลิงก์ — ${sourceOnly ? 'โหมดเฉพาะแหล่ง (ไม่รีเสิร์ชเพิ่ม)' : 'ดึงก่อน บูสต์ขึ้นหน้า + รีเสิร์ชเสริม'}`);
    const selected = await runMultiAgentImageSearch(
      sourceUrl || '', sourceUrl ? 'url' : 'text',
      identity.characters || [],
      newsTitle || (content || '').slice(0, 100),
      identity,
      sourceLinks,
      { sourceOnly }
    );

    // ★ 26 มิ.ย.: โหมดเฉพาะแหล่ง แต่ดึงรูปจากลิงก์ไม่ได้เลย → แจ้งชัดเจน ไม่วิ่ง pipeline ต่อ (กันค้าง/ปกว่าง)
    //   มักเกิดกับลิงก์ FB วิดีโอ (ดึงเฟรมไม่ได้บนเซิร์ฟเวอร์เบา) — บอกผู้ใช้ให้ลองลิงก์อื่น/โหมดผสม
    if (sourceOnly && (!selected || selected.length === 0)) {
      const msg = 'ดึงรูปจากลิงก์แหล่งรูปไม่ได้เลย (โหมด "เฉพาะภาพในลิงก์") — ลิงก์คลิป Facebook มักดึงเฟรมไม่ได้จากเซิร์ฟเวอร์ ลองวางลิงก์ YouTube/TikTok/ข่าวที่มีภาพ หรือสลับเป็นโหมด "ผสม"';
      console.warn('[CoverV3] 🛑 sourceOnly แต่ไม่ได้ภาพจากลิงก์เลย → แจ้งผู้ใช้');
      await markQueueJob('failed', { error: msg });
      return NextResponse.json({ success: false, error: msg, errorType: 'SOURCE_ONLY_NO_IMAGES' }, { status: 200 });
    }

    // ดาวน์โหลดภาพเป็น buffer (เฉพาะตัวท็อปที่ judge คัดแล้ว)
    // rev.20: ดาวน์โหลด 14 (เดิม 10) — เผื่อ dedup/quality ตัดแล้วยังเหลือภาพดี-ต่างกัน ≥5 ใบ (โครง 3 ขวา + วงกลม)
    // rev.20g: ★ ให้ความสำคัญ "ภาพถ่ายจริง" (Google/บทความ/Tavily = http url) ก่อน "เฟรมวิดีโอ" (data: URI จาก YouTube/Reels)
    //   บทเรียน CASE-156/158: เฟรมวิดีโอหันหลัง/เบลอ หลุดมาเป็นฮีโร่/วงกลม → ดันภาพถ่ายขึ้นก่อน เฟรมวิดีโอเป็นตัวเสริมท้าย (ใช้เฉพาะเมื่อภาพถ่ายไม่พอ)
    const _ranked = (selected || []).filter(img => img?.url);
    // ★ 25 มิ.ย.: ภาพจาก "แหล่งรูปพนักงาน" (userSource) บูสต์ขึ้นก่อนในแต่ละกลุ่ม
    //   คงกฎ "ภาพถ่ายก่อนเฟรม" สำหรับฮีโร่ — เฟรมพนักงานบูสต์ในกลุ่มเฟรม (เป็นบริบท) ไม่ดันเป็นฮีโร่เบลอ
    const _isData = (img) => String(img.url).startsWith('data:');
    const _photos = [..._ranked.filter(i => i.userSource && !_isData(i)), ..._ranked.filter(i => !i.userSource && !_isData(i))];
    const _frames = [..._ranked.filter(i => i.userSource && _isData(i)), ..._ranked.filter(i => !i.userSource && _isData(i))];
    // ★ rev.20j (ผู้ใช้ 21 มิ.ย.): ข่าว "คนธรรมดา/เด็ก ออกรายการทีวี" → ภาพคนตัวจริงมีแค่ในเฟรมคลิป
    //   (เว็บคืนวิว/สถานที่/คนผิด เพราะไม่ใช่คนดัง) → กลับด้านให้ "เฟรมคลิปมาก่อน"; ข่าวคนดังยังภาพเว็บก่อนเหมือนเดิม
    const _clipBlob = `${newsTitle} ${(content || '').slice(0, 1500)}`;
    const _isShowClip = /รายการ|ปัญญาปันสุข|โหนกระแส|ตีท้ายครัว|เรื่องจริงผ่านจอ|คุยแซ่บ|ทุบโต๊ะ|ออกรายการ/.test(_clipBlob);
    const _isOrdinary = /เด็ก|ชาวบ้าน|ยากจน|ป่วย|สู้ชีวิต|พิการ|กตัญญู|ยาย|ลุง|ป้า|แม่ค้า|ลำบาก|หาเช้ากินค่ำ|รถเข็น|วอนช่วย/.test(_clipBlob);
    const _preferFrames = _isShowClip && _isOrdinary;
    const candidates = (_preferFrames ? [..._frames, ..._photos] : [..._photos, ..._frames]).slice(0, 14);
    if (_preferFrames) console.log('[CoverV3] 🎬 ข่าวคนธรรมดาจากรายการ → ใช้เฟรมคลิปก่อนภาพเว็บ (กันได้วิว/คนผิด)');
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
      // rev.15i: ผู้ใช้ติ rev.15h — ภาพฉากเปล่า (น้ำท่วม/เวทีคนตัวจิ๋ว) = "มองไม่รู้เรื่อง ไม่เน้นคน"
      //   → เลิกเก็บภาพไร้หน้า ใช้เฉพาะภาพที่ "เห็นคนชัด" บริบทมาจากภาพที่มีคนอยู่ในเหตุการณ์ (ไม่ใช่ฉากเปล่า)
      const finalMask = mask;
      const kept = finalMask.filter(Boolean).length;
      if (kept >= 3 && kept < imageBuffers.length) {
        const ibNew = [], fbNew = [];
        imageBuffers.forEach((img, i) => { if (finalMask[i]) { ibNew.push(img); fbNew.push(faceBoxes[i]); } });
        console.log(`[CoverV3] 👤 close-up gate: เหลือ ${ibNew.length}/${imageBuffers.length} (หน้าคมเท่านั้น — เน้นคน)`);
        imageBuffers = ibNew; faceBoxes = fbNew;
      }
    } catch (e) { console.log('[CoverV3] close-up gate skipped:', e.message?.slice(0, 40)); }

    // ── rev.16 (รื้อ holistic — ด่าน A): คุณภาพ + กันคนซ้ำ ──
    //    เดิม dedup จับแค่ "เฟรมเหมือนเป๊ะ" → คนเดิมคนละรูปหลุดผ่าน = ซ้ำ 3 ช่อง; ไม่เช็คคม/ละเอียด = เกรนปนคม
    //    ใหม่: คะแนนคุณภาพ (ความละเอียด+ความคม) → คลัสเตอร์ภาพคล้าย เก็บใบ "คมสุด" ต่อคลัสเตอร์ + ตัดภาพเกรน/เบลอ
    try {
      const sharpLib2 = (await import('sharp')).default;
      const sigs = await Promise.all(imageBuffers.map(async (img) => {
        try {
          // ลายเซ็นโครงสร้าง (average-hash 8x8)
          const gray = await sharpLib2(img.buffer).grayscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
          let sum = 0; for (let k = 0; k < gray.length; k++) sum += gray[k];
          const avg = sum / gray.length;
          let bits = 0n;
          for (let k = 0; k < gray.length; k++) if (gray[k] > avg) bits |= (1n << BigInt(k));
          // ลายเซ็นสี (4x4 RGB) — จับ "ชุด/ฉากเดียวกัน" ที่ hash อาจไม่จับ
          const rgb = await sharpLib2(img.buffer).removeAlpha().resize(4, 4, { fit: 'fill' }).raw().toBuffer();
          const colorSig = Array.from(rgb);
          // ความละเอียด + ความคม (stdev ของ Laplacian บนภาพย่อ — สูง=คม)
          const meta = await sharpLib2(img.buffer).metadata();
          const minDim = Math.min(meta.width || 1, meta.height || 1);
          const lap = await sharpLib2(img.buffer).resize(220, 220, { fit: 'inside' }).grayscale()
            .convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] }).stats();
          const sharpness = lap?.channels?.[0]?.stdev || 0;
          return { bits, colorSig, minDim, sharpness };
        } catch { return null; }
      }));
      const maxSharp = Math.max(1, ...sigs.map(s => s?.sharpness || 0));
      const quals = sigs.map(s => {
        if (!s) return 0.4;
        const resN = Math.min(1, s.minDim / 720);        // ≥720px = เต็ม
        const shN = Math.min(1, s.sharpness / maxSharp);  // เทียบในชุด (กันสเกลต่างกัน)
        return +(0.42 * resN + 0.58 * shN).toFixed(3);
      });
      const hamming = (a, b) => { let x = a ^ b, d = 0; while (x) { d += Number(x & 1n); x >>= 1n; } return d; };
      // คลัสเตอร์ภาพคล้าย → เก็บ "ใบคุณภาพสูงสุด" ต่อคลัสเตอร์ (กันคนเดิม/เฟรมเดิมซ้ำ)
      const clusters = [];
      imageBuffers.forEach((img, i) => {
        const s = sigs[i];
        let hit = null;
        if (s) for (const c of clusters) {
          const cs = sigs[c.repIdx];
          // rev.16b: คลัสเตอร์เฉพาะ "เฟรมเกือบเหมือนเป๊ะ" (โครงสร้าง hamming≤8) เท่านั้น
          //   เลิกรวมด้วยสีล้วน — เผลอรวมภาพคนละช็อตของตัวหลัก (พื้นหลังสีเดียวกัน) → เหลือตัวหลักใบเดียว เติมช่องด้วยฉากเบลอ
          if (cs && hamming(cs.bits, s.bits) <= 8) { hit = c; break; }
        }
        if (hit) { if (quals[i] > quals[hit.repIdx]) hit.repIdx = i; }
        else clusters.push({ repIdx: i });
      });
      let keep = clusters.map(c => c.repIdx);
      // ตัดภาพคุณภาพต่ำชัดเจน (<55% ของใบดีสุด) — rev.20: ตัดต่อเมื่อยังเหลือ ≥5 ใบ
      //   (กันพูลหดต่ำกว่า 5 จนโครง "3 ขวา + วงกลม" ขึ้นไม่ได้ — ผู้ใช้ต้องการ 3 ขวาเสมอสำหรับคนดังภาพเยอะ)
      const maxQ = Math.max(...keep.map(i => quals[i]), 0.01);
      const filtered = keep.filter(i => quals[i] >= maxQ * 0.55);
      if (filtered.length >= 5) keep = filtered;
      // ต้องมีอย่างน้อย min(3,pool) ช่อง — distinct ไม่พอ เติมด้วยใบคุณภาพรองที่เหลือ
      const need = Math.min(3, imageBuffers.length);
      if (keep.length < need) {
        const extra = imageBuffers.map((_, i) => i).filter(i => !keep.includes(i)).sort((a, b) => quals[b] - quals[a]);
        while (keep.length < need && extra.length) keep.push(extra.shift());
      }
      keep.sort((a, b) => a - b);
      if (keep.length < imageBuffers.length) {
        console.log(`[CoverV3] 🧬 ด่านคุณภาพ+กันซ้ำ: ${clusters.length} คลัสเตอร์ → เหลือ ${keep.length}/${imageBuffers.length} ใบ (ตัดเกรน/เบลอ/ซ้ำ)`);
      }
      imageBuffers = keep.map(i => imageBuffers[i]);
      faceBoxes = keep.map(i => faceBoxes[i] ? { ...faceBoxes[i], quality: quals[i] } : faceBoxes[i]);
    } catch (e) { console.log('[CoverV3] quality+dedup skipped:', e.message?.slice(0, 50)); }

    // ★ rev.20k: ข่าวคลิปรายการ (คนธรรมดา) — ตัด "ภาพไม่มีหน้าคน" (ตึก/โรงเรียน/ฉากเปล่า) ออกจากพูล
    //   บทเรียน CASE-165: ตึกโรงเรียน/บ้านหลุดมาเติมช่องปกข่าวเด็ก — ปกข่าวคนต้องเป็น "คน" ทุกช่อง
    if (_preferFrames && imageBuffers.length > 3) {
      const withFace = imageBuffers
        .map((img, i) => ({ img, fb: faceBoxes[i], i }))
        .filter(o => o.fb && o.fb.x2 > o.fb.x1 && ((o.fb.x2 - o.fb.x1) * (o.fb.y2 - o.fb.y1)) >= 0.02);
      if (withFace.length >= 3) {
        const dropped = imageBuffers.length - withFace.length;
        imageBuffers = withFace.map(o => o.img);
        faceBoxes = withFace.map(o => o.fb);
        if (dropped > 0) console.log(`[CoverV3] 🧹 ข่าวคลิปคน → ตัดภาพไม่มีหน้า (ตึก/ฉาก) ${dropped} ใบ เหลือ ${imageBuffers.length}`);
      }
    }

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
    // rev.16 (ด่าน B): นับ "ภาพดี-ต่างกันจริง" — หน้าคมพอ + ไม่มีตัวหนังสือ + คุณภาพผ่านเกณฑ์
    //   (พูลนี้ผ่านด่าน A กันซ้ำมาแล้ว = แต่ละใบต่างกันจริง → งบช่องสะท้อนจำนวนภาพดีที่ไม่ซ้ำ)
    const cleanFaceCount = faceBoxes.filter(fb =>
      fb && fb.x2 > fb.x1 && ((fb.x2 - fb.x1) * (fb.y2 - fb.y1)) >= 0.03 && (fb.count || 1) <= 3
      // rev.20k: ข่าวคลิปรายการ — เฟรมมีคำบรรยายเบิร์นทุกเฟรม ถ้าตัด text-frame ทิ้งหมด งบช่อง=0 ได้กริดเรียบ
      //   → ยอมนับเฟรมที่ "มีหน้าจริง" แม้ติดตัวหนังสือ (เดี๋ยว faceTightenAll ครอปหน้าตัด caption ออกให้)
      && (!fb.hasText || _preferFrames)
    ).length; // rev.16b: พูลผ่านด่าน A กรองคุณภาพมาแล้ว ไม่ต้องเกณฑ์คุณภาพสัมพัทธ์ซ้ำ (เดิมทำ count=0)
    let slotBudget = Math.max(3, Math.min(imageBuffers.length, cleanFaceCount));
    // rev.16: โครง 5 ช่องต่อเมื่อมีภาพดี-ต่างกันจริง ≥5 เท่านั้น — น้อยกว่านั้น cap 4 (กันเติมช่องด้วยภาพซ้ำ/แย่)
    //   บทเรียน 136/138/141: ดันเต็มช่องทั้งที่ภาพดีไม่พอ → หน้าซ้ำ 3 ช่อง = เหมือนคอนแทคชีต
    if (cleanFaceCount < 5) slotBudget = Math.min(slotBudget, 4);
    // ★ rev.20i (ผู้ใช้ยืนยันจากปกตัวอย่าง 21 มิ.ย.): ข่าวครอบครัว/คู่รักที่ "ภาพดี ≥5" ก็ใช้โครง 3 ขวาได้
    //   เดิม cap ครอบครัวไว้ 4 เสมอ → เจมส์มีภาพดี 8 ใบยังได้แค่ 2 ขวา. ตอนนี้ปล่อยตามจำนวนภาพจริง
    //   (ภาพ <5 ยังถูก cap เป็น 4 ที่บรรทัดบนอยู่แล้ว = กันคอนแทคชีตเหมือนเดิม)
    console.log(`[CoverV3] 🎯 ภาพดี-ต่างกัน ${cleanFaceCount} ใบ → งบช่อง = ${slotBudget} (จากพูล ${imageBuffers.length})`);

    // ── ★ 25 มิ.ย. — ด่านเลือก "ฮีโร่แบบ CASE-199" (ผู้ใช้สั่งแก้เฉพาะฮีโร่): ──
    //   ปัญหา: re-rank เดิมเลือก "หน้าใหญ่สุด" อย่างเดียว → ได้หน้าชิดขอบ (ครอปแล้วตัด=CASE-198)
    //          หรือหน้าเล็ก/เห็นลำตัว (=CASE-200). 199 ดีเพราะหน้าใหญ่+เดี่ยว+อยู่กลาง+ไม่ชิดขอบ
    //   → เลือกฮีโร่ที่ดีสุด (ใหญ่+เดี่ยว+ไม่ชิดขอบ) ย้ายขึ้นหน้าสุดเท่านั้น — ★ ไม่แตะลำดับช่องอื่น/ครอป/โครง
    if (faceBoxes.length === imageBuffers.length && imageBuffers.length >= 2) {
      const heroFit = (fb) => {
        if (!fb || !(fb.x2 > fb.x1) || fb.hasText) return -1;       // ไม่มีหน้า/มีตัวหนังสือ = ไม่เหมาะเป็นฮีโร่
        const area = (fb.x2 - fb.x1) * (fb.y2 - fb.y1);            // หน้าใหญ่=โคลสอัพ (กัน 200 หน้าเล็ก/ลำตัว)
        const cx = (fb.x1 + fb.x2) / 2;
        const edgeNear = Math.min(fb.x1, 1 - fb.x2);              // ระยะหน้าถึงขอบซ้าย/ขวา
        let s = area;
        if ((fb.count || 1) === 1) s += 0.04;                     // หน้าเดี่ยวเด่น (ฮีโร่ที่ดี)
        if (edgeNear < 0.05) s -= 0.15;                           // หน้าแทบติดขอบ → ครอปแล้วตัด (กัน 198) หักแรง
        else s -= Math.abs(cx - 0.5) * 0.10;                      // เยื้องกลาง = หักเบาๆ (ชอบหน้ากลางเฟรม)
        return s;
      };
      let bestIdx = 0, bestFit = heroFit(faceBoxes[0]);
      for (let i = 1; i < imageBuffers.length; i++) {
        const f = heroFit(faceBoxes[i]);
        if (f > bestFit) { bestFit = f; bestIdx = i; }
      }
      if (bestIdx > 0 && bestFit > 0) {
        const [bImg] = imageBuffers.splice(bestIdx, 1); imageBuffers.unshift(bImg);
        const [bFb] = faceBoxes.splice(bestIdx, 1); faceBoxes.unshift(bFb);
        console.log(`[CoverV3] 🦸 เลือกฮีโร่แบบ 199: ย้าย idx ${bestIdx} ขึ้นหน้า (fit ${bestFit.toFixed(3)} — ใหญ่+เดี่ยว+ไม่ชิดขอบ)`);
      }
    }

    // ── ② AI Vision Director — เลือกโครงเองจากแม่บทที่แกะจากปกไวรัลจริง ──
    // ★ 27 มิ.ย. (ผู้ใช้สั่ง): เลิก "ล็อกโครงเดียว (vt_ref_tri)" — ให้ Director "สลับหลายเทมเพลต" ตามเรื่อง/สไตล์/จำนวนภาพ
    //   + บล็อกโครง 3 ภาพ (v3_grid3): ปกต้อง "อย่างน้อย 4-5 ภาพ" มีวงกลม/กรอบไฮไลต์ ตามสไตล์
    //   ปรับตามภาพเยอะ/น้อยอัตโนมัติผ่าน slotBudget: ≥5 หน้าคม → โครง 5 ภาพ · 4 → โครง 4 ภาพ
    //   v3_grid3 (3 ภาพ) เหลือเป็น "ทางเลือกสุดท้าย" เฉพาะตอนภาพ <4 ใบจริงๆ (เติม 4 ช่องไม่ได้)
    //   🔴 เดิม (rev.20f) ล็อก vt_ref_tri ตัวเดียวเมื่อภาพ ≥5 → ทุกปกหน้าตาเหมือนกันหมด = ที่ผู้ใช้ติว่า "ล็อก"
    const richTemplates = [
      V3_TEMPLATES.vt_ref_tri,      // 5 ภาพ — hero + ขวา 3 สะอาด + วงกลมทอง
      V3_TEMPLATES.vt_hero_stack,   // 5 ภาพ — hero เต็มซ้าย + ขวา 3 + กรอบคลิปเขียว
      V3_TEMPLATES.vt_quad_circle,  // 5 ภาพ — สองฝ่าย ให้-รับ (วงกลมกลาง)
      V3_TEMPLATES.vt_faces_circle, // 4 ภาพ — hero + ขวา 2 + วงกลม
      V3_TEMPLATES.vt_hero_br,      // 4 ภาพ — อารมณ์น้ำตา (กรอบเหลือง)
      V3_TEMPLATES.vt_hero_wide,    // 4 ภาพ — คนเล่า/สัมภาษณ์ + คู่กรณี (กรอบขาว)
    ].filter(t => t.slots.length <= slotBudget);
    // forceTemplateId: บังคับโครงเจาะจง (Cover Lab เลือกเอง) — ข้าม logic อัตโนมัติ
    const forced = forceTemplateId && V3_TEMPLATES[forceTemplateId] ? [V3_TEMPLATES[forceTemplateId]] : null;
    // โครง 3 ภาพ = ทางเลือกสุดท้ายตอนภาพน้อยจริงๆ (เติมโครง 4-5 ไม่ได้)
    const lastResort = [V3_TEMPLATES.v3_grid3].filter(t => t.slots.length <= slotBudget);
    const templateOptions = forced
      || (richTemplates.length > 0 ? richTemplates : lastResort);

    console.log(`[CoverV3] ③ Director (options: ${templateOptions.map(t => t.id).join(', ')} | pool=${imageBuffers.length})...`);
    const { directCover, reviewCover, tightenMomentCrops, faceTightenAll } = await import('@/lib/services/coverDirectorService');
    const direction = await directCover({ imageBuffers, identity, templateOptions, templateSpec: templateOptions[0], newsTitle, faceBoxes });
    if (!direction) {
      await markQueueJob('failed', { error: 'AI Director จัดวางไม่สำเร็จ' });
      return NextResponse.json({ success: false, error: 'AI Director จัดวางไม่สำเร็จ', errorType: 'DIRECTOR_FAILED' }, { status: 422 });
    }
    let templateSpec = direction.templateSpec; // โครงที่ Director เลือก (let — ลูป self-heal สลับเทมเพลตได้)

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
      tightenMomentCrops(assignments, faceBoxes); // rev.20: กัน QC คลายครอปช่องโมเมนต์กลับ (โฟกัสหน้าเสมอ)
      coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec, faceBoxes });
      qcApplied = true;
      console.log(`[CoverV3] ⑤ QC fixes applied (${qc.fixes.length}) → recomposed`);
    } else {
      console.log('[CoverV3] ⑤ QC passed first try');
    }

    // ★ rev.20k: ข่าวคลิปรายการ — บังคับครอปทุกช่อง (รวมฮีโร่) ที่ "ใบหน้า" ตัดแถบคำบรรยายเบิร์นออก แล้วประกอบใหม่
    if (_preferFrames) {
      faceTightenAll(assignments, faceBoxes, 2.2);
      coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec, faceBoxes });
      console.log('[CoverV3] ⑤.5 ข่าวคลิป → ครอปหน้าตัดคำบรรยายทุกช่อง → ประกอบใหม่');
    }

    // ── ④★ Judge เข้ม + Self-heal loop (rev.21, 23 มิ.ย.): เจนซ้ำเปลี่ยนกลยุทธ์จนได้ ≥9 ──
    //   เกณฑ์ 4 แกน: บุคคลเด่นชัด / ภาพตรงเรื่อง / องค์ประกอบสวย / สะอาด — แกนบังคับไม่ผ่าน = กดคะแนนลง
    //   ★ เฉพาะระบบปก ไม่แตะระบบทำข่าวอัตโนมัติ
    const { callAI: _callAIJ } = await import('@/lib/ai/openai');
    const _sharpJ = (await import('sharp')).default;
    const _judgeCtx = ((newsTitle || content || identity?.mainCharacter || identity?.storyType || '')
      + (identity?.coverEmotion ? ` | อารมณ์ข่าว: ${identity.coverEmotion}` : '')).slice(0, 170);
    async function _judgeRigorous(buf) {
      try {
        const small = await _sharpJ(buf).resize(760, null, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
        const res = await _callAIJ({
          prompt: `คุณเป็นบรรณาธิการภาพอาวุโสของเพจข่าวไวรัล ให้คะแนน "ปกข่าว" นี้แบบเข้มงวดสุด (เต็ม 10)
บริบทข่าว: "${_judgeCtx}"
ประเมิน 4 แกน (ให้เต็มยากมาก — ปกใช้งานจริงต้อง ≥9 ทุกแกน):
① บุคคลเด่นชัด — หน้าคน คมชัด ไม่ถูกตัดครึ่ง/เบลอ/เล็กจนหาไม่เจอ
② ภาพ/โทนตรงกับเรื่อง — ไม่หลุดธีม ไม่มีภาพมั่วที่ไม่เกี่ยว
③ องค์ประกอบ-เลย์เอาต์ — สวยระดับปกเพจดัง จัดวางลงตัว
④ สะอาด — ไม่มีคำบรรยาย/ลายน้ำค้าง ไม่มีช่องว่าง/ภาพซ้ำ/ขอบแหว่ง/หน้าโดนตัด
ถ้ามีตำหนิชัด (หน้าโดนตัด/ช่องว่าง/ภาพไม่เกี่ยว/รก/ลายน้ำ) ห้ามให้เกิน 7
ตอบ JSON: {"score":0-10,"personClear":true,"onTopic":true,"clean":true,"issues":["ปัญหาเด่นถ้ามี"],"reason":"สั้นๆ"}`,
          imageContents: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'high' } }],
          model: 'gpt-4o', temperature: 0.15, maxTokens: 450,
        });
        const j = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
        const sc = Math.max(0, Math.min(10, Number(j?.score) || 0));
        return { score: sc, personClear: j?.personClear !== false, onTopic: j?.onTopic !== false, clean: j?.clean !== false, issues: Array.isArray(j?.issues) ? j.issues.slice(0, 4) : [], reason: String(j?.reason || '').slice(0, 110) };
      } catch (e) { console.log('[CoverV3] judge fail (non-fatal):', e.message?.slice(0, 40)); return { score: 7, personClear: true, onTopic: true, clean: true, issues: [], reason: 'judge error' }; }
    }
    // แกนบังคับ (บุคคล/ตรงเรื่อง/สะอาด) ไม่ผ่าน → กดคะแนนเพดาน 6.5 (ห้ามชนะแม้สวย)
    const _eff = (jr) => (jr.personClear && jr.onTopic && jr.clean) ? jr.score : Math.min(jr.score, 6.5);

    // attempt 1 = ผลที่ประกอบไว้แล้วข้างบน
    const _jr0 = await _judgeRigorous(coverBuffer);
    let _best = { buffer: coverBuffer, assignments, templateSpec, jr: _jr0, eff: _eff(_jr0), reason: direction.reason, qcApplied };
    console.log(`[CoverV3] 🏆 attempt 1 (${templateSpec.id}) → ${_jr0.score}/10 eff=${_best.eff} — ${_jr0.reason}`);

    // rev.21b: คุมเวลา (เคยชน 727s/800s) — 2 retries + เผื่อเวลาเหลือพอเท่านั้น (กัน timeout ปกพัง)
    const TARGET_SCORE = 9, MAX_RETRY = 2, _timeBudgetMs = 560000; // หยุดลูปถ้าใช้ไปเกิน ~9.3 นาที
    // ★ rev.21c (ผู้ใช้: "ให้ใช้เทมเพลตที่กำหนด 5 รูป ห้ามยุบเป็น 3"):
    //   ลูป retry ต้อง "ไม่ยุบต่ำกว่าจำนวนช่องของเทมเพลตที่กำหนด" (vt_ref_tri 5) → คงโครง 5 รูปเสมอ
    //   แก้ภาพหลุดเรื่องด้วยการ "ให้ Director เลือกภาพใหม่ในโครงเดิม" ไม่ใช่ตัดช่องทิ้ง
    const _minSlots = templateSpec.slots.length; // จำนวนช่องที่กำหนด (attempt 1)
    const _retryT = [...new Set([...templateOptions, ...richTemplates])]
      .filter(t => t && t.slots.length <= imageBuffers.length && t.slots.length >= _minSlots);
    for (let k = 0; k < MAX_RETRY && _best.eff < TARGET_SCORE && (Date.now() - t0) < _timeBudgetMs; k++) {
      try {
        // เปลี่ยนกลยุทธ์ทุกรอบ: หมุนเทมเพลต "ขนาดเท่าหรือใหญ่กว่าที่กำหนด" → Director เลือกภาพ/ครอปใหม่ในโครงเดิม
        const lead = _retryT[(k + 1) % Math.max(1, _retryT.length)] || templateSpec;
        const opts = [...new Set([lead, ..._retryT])].slice(0, 3);
        const dir2 = await directCover({ imageBuffers, identity, templateOptions: opts, templateSpec: opts[0], newsTitle, faceBoxes });
        if (!dir2) continue;
        const tS = dir2.templateSpec; let asg2 = dir2.assignments;
        let buf2 = await executeCover({ assignments: asg2, imageBuffers, templateSpec: tS, faceBoxes });
        const qc2 = await reviewCover({ coverBuffer: buf2, templateSpec: tS, assignments: asg2, imageBuffers, faceBoxes, identity, newsTitle });
        let qa2 = false;
        if (!qc2.ok && qc2.fixes?.length > 0) { asg2 = applyFixes(asg2, qc2.fixes); tightenMomentCrops(asg2, faceBoxes); buf2 = await executeCover({ assignments: asg2, imageBuffers, templateSpec: tS, faceBoxes }); qa2 = true; }
        if (_preferFrames) { faceTightenAll(asg2, faceBoxes, 2.2); buf2 = await executeCover({ assignments: asg2, imageBuffers, templateSpec: tS, faceBoxes }); }
        const jr2 = await _judgeRigorous(buf2); const eff2 = _eff(jr2);
        console.log(`[CoverV3] 🔁 retry ${k + 1}/${MAX_RETRY} (${tS.id}) → ${jr2.score}/10 eff=${eff2} — ${jr2.reason}`);
        if (eff2 > _best.eff) _best = { buffer: buf2, assignments: asg2, templateSpec: tS, jr: jr2, eff: eff2, reason: dir2.reason, qcApplied: qa2 };
      } catch (e) { console.log(`[CoverV3] retry ${k + 1} err:`, e.message?.slice(0, 45)); }
    }
    coverBuffer = _best.buffer; assignments = _best.assignments; templateSpec = _best.templateSpec; qcApplied = _best.qcApplied;
    const score = Math.round(_best.jr.score * 10) / 10;
    console.log(`[CoverV3] ✅ best ${score}/10 (${templateSpec.id}) | แกนบังคับ person=${_best.jr.personClear} topic=${_best.jr.onTopic} clean=${_best.jr.clean} | issues: ${_best.jr.issues.join(', ') || 'none'}`);

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
    // ★ เครดิต/โควต้าหมดกลางทาง → แจ้งชัด (อย่าโยน error ดิบงงๆ ที่ดูเหมือน "ปกพัง")
    const msg = String(error.message || '');
    if (/insufficient_quota|exceeded your current quota|billing/i.test(msg)) {
      const qmsg = '⚠️ ระบบ AI (OpenAI) หมดเครดิต/โควต้าระหว่างสร้างปก — กรุณาเติมเงินแล้วลองใหม่';
      await markQueueJob('failed', { error: qmsg });
      return NextResponse.json({ success: false, error: qmsg, errorType: 'API_QUOTA_EXCEEDED' }, { status: 200 });
    }
    await markQueueJob('failed', { error: error.message });
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'PIPELINE_ERROR' },
      { status: 500 }
    );
  }
}
