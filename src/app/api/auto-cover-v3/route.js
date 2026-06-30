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
      const { batchDetectFaces, detectFaces } = await import('@/lib/services/faceDetector');
      const fdMap = await batchDetectFaces(imageBuffers.map((img, i) => ({ id: `v3_${i}`, buffer: img.buffer })));
      const sharpLib = (await import('sharp')).default;
      faceBoxes = await Promise.all(imageBuffers.map(async (img, i) => {
        let fd = fdMap?.get?.(`v3_${i}`);
        // ★ 30 มิ.ย.: รอบแรกไม่เจอหน้า → ลองซ้ำ "คมชัดสูง" (กันหน้าเล็ก/เบลอจากเฟรมวิดีโอตรวจไม่เจอ → ครอป fallback ตัดหน้า)
        if ((!fd?.hasFaces || !fd.faces?.length) && img.buffer) {
          try { const hi = await detectFaces(img.buffer, { maxDim: 1280, detail: 'high' }); if (hi && ((hi.hasFaces && hi.faces?.length) || !fd)) fd = hi; } catch {}
        }
        const hasText = !!fd?.hasBigText; // ★ สกรีนช็อต/กราฟิกข่าว — ต้องส่งธงต่อแม้ไม่มีหน้า
        const textRegion = fd?.textRegion || null; // ★ โซนข้อความ — ครอปคนหลบโซนนี้ = ใช้เฟรมรายการได้
        if (!fd?.hasFaces || !fd.faces?.length) {
          // ★ 30 มิ.ย.: ยังไม่เจอหน้า แต่ AI ชี้ "บริเวณคน/ซับเจกต์หลัก" → ส่ง subject ให้ executor ครอปรอบคน (กฎกันตัดหน้าใช้ตอน fallback ด้วย)
          const s = fd?.mainSubject, fW = fd?.imageWidth || 1, fH = fd?.imageHeight || 1;
          const subject = (s && s.width > 0 && s.height > 0) ? {
            x1: +(s.x / fW).toFixed(3), y1: +(s.y / fH).toFixed(3),
            x2: +((s.x + s.width) / fW).toFixed(3), y2: +((s.y + s.height) / fH).toFixed(3),
          } : null;
          return (hasText || subject) ? { ...(hasText ? { hasText, textRegion } : {}), ...(subject ? { subject } : {}) } : null;
        }
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
            // ★ 1 ก.ค. (CASE-246): 2 หน้าซ้อนกันหนัก = ภาพจูบ/กอด หน้าเบือนไม่ชัด → กดจมพูล (เลี่ยงเข้าช่องโชว์หน้า)
            //   หน้าคู่ปกติ (ยืนข้างกัน) ไม่ซ้อน = ไม่โดนโทษ · ต่างกับ "ซ้อน" ที่หน้าทับกันจริง
            if (Array.isArray(fb.allFaces) && fb.allFaces.length >= 2) {
              const ff = [...fb.allFaces].sort((a, b) => ((b.x2 - b.x1) * (b.y2 - b.y1)) - ((a.x2 - a.x1) * (a.y2 - a.y1)));
              const [f1, f2] = ff;
              const ix = Math.max(0, Math.min(f1.x2, f2.x2) - Math.max(f1.x1, f2.x1));
              const iy = Math.max(0, Math.min(f1.y2, f2.y2) - Math.max(f1.y1, f2.y1));
              const minA = Math.min((f1.x2 - f1.x1) * (f1.y2 - f1.y1), (f2.x2 - f2.x1) * (f2.y2 - f2.y1));
              if (minA > 0 && (ix * iy) / minA > 0.20) s -= 0.14; // ซ้อน >20% ของหน้าที่เล็กกว่า = จูบ/กอด
            }
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
      // ★ 27 มิ.ย. (ผู้ใช้สั่ง — ปก 4+1 เสมอ): เล็งเก็บ "≥5 ใบ" เพื่อเลี้ยงโครง 4+1 (5 ช่อง)
      //   ภาพหน้ากลาง/ไกล ที่เก็บเพิ่มจะถูกครอปแน่นที่หน้าในช่องขวา (เกือบสี่เหลี่ยม) → ออกมาเป็นหน้าชัด ไม่ใช่ลำตัว
      let mask = pick(0.045);                                    // เข้มสุด: หน้าโคลสอัพคม
      if (mask.filter(Boolean).length < 5) mask = pick(0.028);   // ผ่อน 1: ครึ่งตัว+
      if (mask.filter(Boolean).length < 5) mask = pick(0.012);   // ผ่อน 2: ขอแค่มีหน้าชัดพอ
      // rev.15i: ผู้ใช้ติ rev.15h — ภาพฉากเปล่า (น้ำท่วม/เวทีคนตัวจิ๋ว) = "มองไม่รู้เรื่อง ไม่เน้นคน"
      //   → เลิกเก็บภาพไร้หน้า ใช้เฉพาะภาพที่ "เห็นคนชัด" บริบทมาจากภาพที่มีคนอยู่ในเหตุการณ์ (ไม่ใช่ฉากเปล่า)
      // ★ 29 มิ.ย. (CASE-242): กันด่านหน้าคมตัด "ภาพเหตุการณ์/ตัวรอง" (EVIDENCE/RELATIONSHIP/CONTEXT) ทิ้งหมด
      //   ปัญหา: ภาพทักษิณ/เหตุการณ์(matichon/thaipost) ไม่ใช่หน้าคมโคลสอัพ → โดนตัด → reserve-context ไม่มีภาพใช้
      //   → สำรองภาพเหตุการณ์คะแนนสูงสุด 1 ใบ ให้พ้นด่าน (ผู้ใช้ย้ำ: ต้องมีทักษิณ/ภาพเหตุการณ์ในปก)
      const finalMask = [...mask];
      try {
        const _ctxRe = /EVIDENCE|RELATIONSHIP|CONTEXT_SCENE/i;
        const _secRe = /secondary|couple|pair/i; // queryLabel = ภาพมาจากค้นตัวรอง(ทักษิณ)/คู่
        let _bc = -1, _bcKey = -1;
        imageBuffers.forEach((img, i) => {
          if (finalMask[i]) return;
          if (faceBoxes[i]?.hasText) return;          // ★ 29 มิ.ย. (CASE-245): กันสกรีนช็อต/ตัวหนังสือฝัง (รายการทีวี/กราฟิกข่าว)
          if ((Number(img.score) || 0) < 5) return;   // ★ เอาเฉพาะคุณภาพพอใช้ — ไม่ฝืนดันภาพแย่เข้าปก
          const isSec = _secRe.test(String(img?.queryLabel || ''));
          const isCtx = _ctxRe.test(img?.role || '');
          if (!isSec && !isCtx) return;
          const key = (isSec ? 1000 : 0) + (Number(img.score) || 0); // ★ ภาพตัวรองมาก่อนภาพเหตุการณ์ทั่วไป
          if (key > _bcKey) { _bcKey = key; _bc = i; }
        });
        if (_bc >= 0) { finalMask[_bc] = true; const _sn = String(identity?.secondaryCharacter || 'ตัวรอง').slice(0, 20); console.log(`[CoverV3] 📎 สำรอง${_secRe.test(String(imageBuffers[_bc].queryLabel || '')) ? `ภาพตัวรอง(${_sn})` : 'ภาพเหตุการณ์'}พ้นด่านหน้าคม: #${_bc} (${imageBuffers[_bc].role}/${imageBuffers[_bc].queryLabel || '?'} score ${imageBuffers[_bc].score})`); }
      } catch { /* non-fatal */ }
      const kept = finalMask.filter(Boolean).length;
      // ★ 29 มิ.ย. (แก้บั๊กปกล้ม INSUFFICIENT_QUALITY_IMAGES): ยกพื้นจาก 3→4 ให้ตรงกับ minimum (ปกต้อง 4+1)
      //   เดิม kept>=3 → ตัดเหลือ 3 ใบ แล้วไปล้มด่าน "ต้อง ≥4" · โดยเฉพาะข่าว 2 ตัวละคร (co-story รับภาพเหตุการณ์ไม่มีหน้ามากขึ้น)
      //   ถ้าตัดหน้าคมแล้วเหลือ <4 → คงพูลเต็มไว้ (รวมภาพเหตุการณ์) ดีกว่าล้มทั้งปก · Director/ครอปจัดการภาพไม่มีหน้าเองได้
      if (kept >= 4 && kept < imageBuffers.length) {
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
      // rev.23 (CASE-235: เด็กพนมมือซ้ำ 3 ใบคนละครอป — hamming>8 รอด): ระยะสี (avg |Δ| ต่อช่อง 0-255) จาก colorSig 4x4
      const colorDist = (a, b) => { if (!a || !b) return 1e9; let d = 0, n = Math.min(a.length, b.length); for (let k = 0; k < n; k++) d += Math.abs(a[k] - b[k]); return d / Math.max(1, n); };
      // คลัสเตอร์ภาพคล้าย → เก็บ "ใบคุณภาพสูงสุด" ต่อคลัสเตอร์ (กันคนเดิม/เฟรมเดิมซ้ำ)
      const clusters = [];
      imageBuffers.forEach((img, i) => {
        const s = sigs[i];
        let hit = null;
        if (s) for (const c of clusters) {
          const cs = sigs[c.repIdx];
          // rev.16b: คลัสเตอร์เฉพาะ "เฟรมเกือบเหมือนเป๊ะ" (โครงสร้าง hamming≤8) เท่านั้น
          //   เลิกรวมด้วยสีล้วน — เผลอรวมภาพคนละช็อตของตัวหลัก (พื้นหลังสีเดียวกัน) → เหลือตัวหลักใบเดียว เติมช่องด้วยฉากเบลอ
          // rev.23 (CASE-235): เพิ่มจับ "ฉากเดียวกันคนละครอป/คนละเฟรมใกล้กัน" = โครงสร้างใกล้ (hamming≤18) + สีเกือบเหมือน (colorDist≤16)
          //   ★ ต้องเข้าทั้ง 2 เงื่อนไขพร้อมกัน — สีต่าง(คนละช็อตตัวหลัก)จะไม่ถูกรวม (คงบทเรียน rev.16b) · จับเด็กพนมมือ 3 ใบซ้ำได้
          if (cs && (hamming(cs.bits, s.bits) <= 8 || (hamming(cs.bits, s.bits) <= 18 && colorDist(cs.colorSig, s.colorSig) <= 16))) { hit = c; break; }
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
    // ★ 27 มิ.ย. (ผู้ใช้สั่ง): ปกขั้นต่ำ "4 ช่องขึ้นไป" เท่านั้น — เลิกโครง 3 ภาพ (v3_grid3) ถาวร
    //   ภาพใช้ได้ <4 → ไม่ทำปก (แจ้ง error) แทนที่จะหล่นไปโครง 3 รูปที่ผู้ใช้ไม่เอา
    if (imageBuffers.length < 4) {
      const msg = `ภาพใช้ได้ ${imageBuffers.length} ใบ (ต้องการอย่างน้อย 4 — ปกต้อง 4+1) — ข่าวนี้ภาพหายาก ลองใส่ลิงก์แหล่งรูป/คลิป`;
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
    // ★ 27 มิ.ย. (ผู้ใช้สั่ง): ปก "ต้อง 4+1 เสมอ" — งบช่อง = 5 ถ้าพูล ≥5 ใบ · ไม่งั้น 4 · (3 เฉพาะพูลน้อยจริงๆ)
    //   เดิม cap ที่ 4 เมื่อ "หน้าต่างกัน <5" → ได้โครง 3-4 บ่อย (ผู้ใช้ติว่าไม่สวย: ปกต้อง 4+1 ลงรายละเอียดเยอะ)
    //   ภาพคนเดียวกันคนละช็อต/อารมณ์ = เติมช่องได้ (ปกไวรัลจริงก็โชว์คนเดิมหลายมุม) · dedup กันเฟรมซ้ำเป๊ะมาแล้ว
    let slotBudget = Math.min(5, imageBuffers.length);
    console.log(`[CoverV3] 🎯 ภาพดี-ต่างกัน ${cleanFaceCount} ใบ → งบช่อง = ${slotBudget} (จากพูล ${imageBuffers.length}) [บังคับ 4+1]`);

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
        // ★ 28 มิ.ย. (CASE-234 "พี่ก้อง ห้วยไร่"): ฮีโร่ต้อง "ใหญ่ + คม" — เดิมคิดแค่ขนาด+ตำแหน่ง+เดี่ยว
        //   → เฟรมเบลอ(motion blur ตอนร้องเพลง)หน้าใหญ่/กลาง ชนะเฟรมคมหน้าเล็กกว่า = ฮีโร่เบลอ
        //   fb.quality = 0.42×ความละเอียด + 0.58×ความคม(Laplacian stdev) จากด่าน A (~บรรทัด 282)
        //   undefined/null = 0.7 (เป็นกลาง คูณเท่ากันทุกใบ = ไม่เปลี่ยนลำดับ → เข้ากันได้ย้อนหลัง)
        const _q = (fb.quality === undefined || fb.quality === null) ? 0.7 : fb.quality;
        let s = area * (0.35 + 0.65 * _q);                        // ★ คะแนนฐาน = ขนาด × ความคม (เบลอ → พื้นที่ถูกลดทอนตามจริง)
        if ((fb.count || 1) === 1) s += 0.04;                     // หน้าเดี่ยวเด่น (ฮีโร่ที่ดี)
        if (edgeNear < 0.05) s -= 0.15;                           // หน้าแทบติดขอบ → ครอปแล้วตัด (กัน 198) หักแรง
        else s -= Math.abs(cx - 0.5) * 0.10;                      // เยื้องกลาง = หักเบาๆ (ชอบหน้ากลางเฟรม)
        if (_q < 0.5) s -= (0.5 - _q) * 0.30;                     // ★ QUALITY FIRST: เฟรมเบลอชัด (q<0.5) หักหนักเพิ่ม — กันฮีโร่เบลอเด็ดขาด (CASE-228/234)
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

    // ── ② AI Vision Director — จัดวาง slot ตาม "โครงเดียวที่ล็อก" ──
    // 🔒🔒 27 มิ.ย. (เย็น — ผู้ใช้สั่งล็อกเป็นกฎ จากภาพตัวอย่างที่ส่งมา):
    //   "ลบเทมเพลตอื่นทั้งหมด — ระบบปกอัตโนมัติทำเทมเพลตนี้เท่านั้น จัดเรียงรูปตามนี้ ออกมาเหมือนภาพตัวอย่างที่สุด"
    //   → โครงที่ล็อก = vt_ref_tri: ฮีโร่เต็มซ้าย + ขวา 3 ภาพซ้อน (หน้าชัด สะอาด) + วงกลมล่าง (หลักฐาน/โมเมนต์)
    //   ★ ล็อกทุกเส้นทาง: Director เลือกจาก array นี้ (coverDirectorService:70) + retry loop ดึง _retryT จาก array นี้ (บรรทัด ~500)
    //     → ไม่มีทางหลุดไปเทมเพลตอื่นเลย ไม่ว่าได้ภาพข่าวแบบไหนมา
    //   ★ ภาพครบ ≥5 → vt_ref_tri (ขวา 3 ภาพ) เป๊ะตัวอย่าง · ได้แค่ 4 → vt_faces_circle (ทรงเดียวกัน ขวา 2 ภาพ) = ใกล้สุด
    //   (vt_quad_circle / vt_hero_br / vt_hero_wide / vt_hero_stack ยังอยู่ในไฟล์ executor เผื่ออนาคต แต่ "ไม่ถูกเลือก" ในออโต้)
    const fivePlusTemplates = [
      V3_TEMPLATES.vt_ref_tri,      // 🔒 โครงเดียวที่ล็อก: hero เต็มซ้าย + ขวา 3 ภาพสะอาด + วงกลมล่าง (= ภาพตัวอย่างผู้ใช้)
    ];
    const fourTemplates = [         // ภาพได้แค่ 4 → ทรงเดียวกัน (hero + ขวา 2 + วงกลม) = ใกล้ตัวอย่างสุด
      V3_TEMPLATES.vt_faces_circle,
    ];
    const richTemplates = (slotBudget >= 5 ? fivePlusTemplates : (slotBudget === 4 ? fourTemplates : []))
      .filter(t => t.slots.length <= imageBuffers.length);
    // forceTemplateId: บังคับโครงเจาะจง (Cover Lab เลือกเอง) — ข้าม logic อัตโนมัติ
    const forced = forceTemplateId && V3_TEMPLATES[forceTemplateId] ? [V3_TEMPLATES[forceTemplateId]] : null;
    // ★ 27 มิ.ย. (ผู้ใช้สั่ง): ลบโครง 3 ภาพ (v3_grid3) ถาวร — ทางเลือกสุดท้าย = โครง 4 ช่อง (มีวงกลม) เท่านั้น
    //   (พูลผ่านด่าน ≥4 มาแล้ว → vt_faces_circle 4 ช่องลงได้เสมอ · ไม่มีทางหล่นไป 3 ภาพอีก)
    const lastResort = [V3_TEMPLATES.vt_faces_circle].filter(t => t.slots.length <= imageBuffers.length);
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

    // ★ 29 มิ.ย. (CASE-238/240/241 ผู้ใช้สั่ง — DETERMINISTIC จองช่องบริบท · เฉพาะระบบปก ไม่แตะระบบข่าว/ถอดประเด็น):
    //   ปัญหา: Judge รับภาพเหตุการณ์/ตัวรองแล้ว (co-story) แต่ AI Director มักไม่หยิบ → ปกข่าว 2 ตัวละครเหลือแต่ตัวหลัก
    //   แก้แบบ "บังคับด้วยโค้ด ไม่พึ่ง AI": ปกที่มี "ตัวรอง" ต้องมีช่อง role บริบท/เหตุการณ์ ≥1 ช่อง
    //   ใช้ role ที่ติดมากับ imageBuffers (จาก Judge) · เลือก EVIDENCE>CONTEXT_SCENE>RELATIONSHIP (ภาพข่าวเหตุการณ์/คู่ = น่าจะมีตัวรอง)
    //   สลับเฉพาะ "ช่องรองที่อ่อนสุด" (คะแนนภาพต่ำสุด) · ⛔ ไม่แตะ main/hero และ circle (วงต้องหน้าเดี่ยว)
    try {
      const hasSecondary = !!String(identity?.secondaryCharacter || '').trim();
      // ★ "มีช่องเหตุการณ์แล้ว" = นับเฉพาะ EVIDENCE/RELATIONSHIP ในช่องสี่เหลี่ยม (ไม่นับ circle + ไม่นับ CONTEXT_SCENE ที่อาจเป็นแค่คอนเสิร์ต)
      const eventRe = /EVIDENCE|RELATIONSHIP/i;
      const secRe = /secondary|couple|pair/i; // ★ queryLabel = ภาพมาจากค้นตัวรอง(ทักษิณ)/คู่
      const isSecImg = (img) => secRe.test(String(img?.queryLabel || ''));
      const rolePrio = (r) => /EVIDENCE/i.test(r) ? 3 : (/RELATIONSHIP/i.test(r) ? 2 : (/CONTEXT_SCENE/i.test(r) ? 1 : 0));
      if (hasSecondary && Array.isArray(assignments) && assignments.length) {
        const usedIdx = new Set(assignments.map(a => a.imageIndex));
        // "มีช่องตัวรอง/เหตุการณ์แล้ว" = ช่องสี่เหลี่ยมมีภาพตัวรอง(ทักษิณ) หรือ role เหตุการณ์ (EVIDENCE/RELATIONSHIP)
        const alreadyHasEvent = assignments.some(a => a.slotId !== 'circle' && (isSecImg(imageBuffers[a.imageIndex]) || eventRe.test(imageBuffers[a.imageIndex]?.role || '')));
        if (!alreadyHasEvent) {
          let best = -1, bestKey = -1;
          imageBuffers.forEach((img, i) => {
            if (usedIdx.has(i)) return;
            if (faceBoxes[i]?.hasText) return;          // ★ 29 มิ.ย. (CASE-245): กันสกรีนช็อต/ตัวหนังสือฝัง
            if ((Number(img.score) || 0) < 5) return;   // ★ ฝืนเฉพาะภาพคุณภาพพอใช้ — ไม่มีภาพสะอาด=ไม่ฝืน (ปกสะอาดดีกว่าเละ)
            const isSec = isSecImg(img);
            const p = rolePrio(img?.role || '');
            if (!isSec && p === 0) return;
            const key = (isSec ? 1000 : 0) + p * 100 + (Number(img.score) || 0); // ★ ภาพตัวรองมาก่อนเสมอ
            if (key > bestKey) { bestKey = key; best = i; }
          });
          if (best >= 0) {
            const swappable = assignments.filter(a => !/main|hero/i.test(a.slotId) && a.slotId !== 'circle');
            swappable.sort((a, b) => (Number(imageBuffers[a.imageIndex]?.score) || 0) - (Number(imageBuffers[b.imageIndex]?.score) || 0));
            const target = swappable[0] || assignments.find(a => !/main|hero/i.test(a.slotId));
            if (target && target.imageIndex !== best) {
              const fb = faceBoxes[best];
              target.imageIndex = best;
              target.crop = (fb && fb.x2 > fb.x1)
                ? { x: Math.max(0, fb.x1 - (fb.x2 - fb.x1) * 0.5), y: Math.max(0, fb.y1 - (fb.y2 - fb.y1) * 0.4), w: Math.min(1, (fb.x2 - fb.x1) * 2.0), h: Math.min(1, (fb.y2 - fb.y1) * 2.0) }
                : { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
              const _isSec = isSecImg(imageBuffers[best]);
              const _sn2 = String(identity?.secondaryCharacter || 'ตัวรอง').slice(0, 20);
              target.why = _isSec ? `จองช่องภาพตัวรอง(${_sn2}) (deterministic — เล่าครบ 2 ตัวละคร)` : 'จองช่องภาพเหตุการณ์ข่าว (deterministic)';
              console.log(`[CoverV3] 📌 reserve-${_isSec ? `ตัวรอง(${_sn2})` : 'เหตุการณ์'}: ${target.slotId} ← #${best} (role=${imageBuffers[best].role}/${imageBuffers[best].queryLabel || '?'} score=${imageBuffers[best].score})`);
              coverBuffer = await executeCover({ assignments, imageBuffers, templateSpec, faceBoxes });
            }
          } else {
            console.log('[CoverV3] 📌 reserve-context: ข่าว 2 ตัวละคร แต่ไม่มีภาพบริบทเหลือในพูล (คงเดิม)');
          }
        }
      }
    } catch (e) { console.log('[CoverV3] reserve-context skipped (non-fatal):', e.message?.slice(0, 50)); }

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
