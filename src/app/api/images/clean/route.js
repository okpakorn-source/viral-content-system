// ============================================================
// [ระบบทำปกออโต้] POST /api/images/clean
// ------------------------------------------------------------
// คัด "ภาพขยะ" ออกจากคลังด้วย Gemini (ตกไตเติล/ปกคลิป/UI/เบลอ/
// ไม่เกี่ยวข่าว/ไม่ใช่บุคคลเป้าหมาย) → ★ เฟส 5.3 (9 ก.ค.): ตั้งธงซ่อน (junkHidden, ย้อนกลับได้)
// เดิมลบ record ถาวรผ่าน removeByIds — ตาดูภาพเล็กตัดสินพลาดแล้วกู้คืนไม่ได้ (kill-switch JUNK_SOFT_HIDE=0 กลับพฤติกรรมเดิม)
// body: { caseId }
// ============================================================

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getCase } from '@/lib/caseStore';
import { readImages, removeByIds, setTriage, countByPlatform } from '@/lib/imageStore';
import { loadImageBuffer } from '@/lib/imageBuffer';
import { geminiJunkScan } from '@/lib/gemini';
import { isCatalogSource } from '@/lib/junkSources';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CAP = parseInt(process.env.CLEAN_CAP || '200', 10);
const BATCH = 8;
// ★ เฟส 5.3: default ซ่อนด้วยธง (ย้อนกลับได้) แทนลบถาวร — ปิดกลับพฤติกรรมเดิม: JUNK_SOFT_HIDE=0
const JUNK_SOFT_HIDE = process.env.JUNK_SOFT_HIDE !== '0';
// ★ เฟส 5.3: ภาพที่ AI ดูตัดสิน junk ต้องใหญ่พอ (เดิม 400px ตัดสินพลาดได้ง่าย) — ยกเป็น ≥800px เมื่อมีไฟล์จริงใหญ่พอ
const JUNK_VIEW_PX = 800;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const { caseId } = body;
    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    }
    const subjects = c.keywords?.subjects || [];
    // แก่นข่าว → ให้ AI รู้ว่า "ข่าวเกี่ยวกับอะไร" เพื่อคัดวัตถุมั่ว (บ้าน/รถที่ไม่ใช่ของคนในข่าว)
    const newsGist = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);

    const all = await readImages(caseId);
    // ★ เฟส 5.3: ของที่ซ่อนไว้แล้วจากรอบก่อน (junkHidden) ไม่ต้องสแกนซ้ำ — กันเปลืองโควตา Gemini
    //   (เดิมลบ record ถาวร = ไม่มีทางเจอซ้ำอยู่แล้ว; พอเปลี่ยนเป็นซ่อนต้องกันเองตรงนี้)
    const scanBase = all.filter((im) => im.triage?.junkHidden !== true);

    // 🚫 ชั้น 1 (ฟรี ไม่ใช้ AI): ลบ "บ้านแคตตาล็อก/อสังหา/รับสร้างบ้าน/วัสดุก่อสร้าง" ทุกใบ (ไม่ติด CAP)
    //    (แหล่งพวกนี้ไม่มีทางเป็นบ้านของคนในข่าว) — ที่เหลือให้ Gemini คัดต่อ (จำกัด CAP)
    const catalogIds = scanBase.filter((im) => isCatalogSource(im)).map((im) => im.id);
    const toScan = scanBase.filter((im) => !isCatalogSource(im)).slice(0, CAP);
    P('เตรียมรูป', `กันแหล่งแคตตาล็อก ${catalogIds.length} ใบ → โหลด+ย่อรูปที่เหลือ ${toScan.length} ใบ`, { pct: 8 });

    // โหลด + ย่อ เป็น base64 (ใช้ thumbnail เพื่อความเร็ว) — ตัวที่โหลดไม่ได้ = เก็บไว้ก่อน
    const withB64 = [];
    for (const im of toScan) {
      const buf = await loadImageBuffer({ imageUrl: im.thumbnailUrl || im.imageUrl, thumbnailUrl: im.imageUrl });
      if (!buf) continue;
      try {
        const small = await sharp(buf, { failOn: 'none' }).resize(JUNK_VIEW_PX, JUNK_VIEW_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        withB64.push({ im, base64: small.toString('base64') });
      } catch {
        /* รูปเสีย = ปล่อยให้ผู้ใช้เคลียร์เอง */
      }
    }

    const junkIds = [...catalogIds]; // เริ่มด้วยแคตตาล็อกที่กันไว้แล้ว
    let scanned = 0;
    const totalBatches = Math.ceil(withB64.length / BATCH);
    for (let i = 0; i < withB64.length; i += BATCH) {
      const bi = Math.floor(i / BATCH) + 1;
      P('สแกนขยะด้วย AI', `Gemini สแกน แบตช์ ${bi}/${totalBatches} (พบขยะ ${junkIds.length})`, { pct: 10 + Math.round((bi / totalBatches) * 85) });
      const batch = withB64.slice(i, i + BATCH);
      const frames = batch.map((b, k) => ({ index: i + k, base64: b.base64, source: b.im.source, title: b.im.title }));
      let res;
      try {
        res = await geminiJunkScan({ frames, subjects, newsGist, onRetry: P.onRetry, caseId });
      } catch (err) {
        if (err.errorType === 'NO_GEMINI_KEY') {
          failProgress(jobId, err.message);
          return NextResponse.json({ success: false, error: err.message, errorType: 'NO_GEMINI_KEY' }, { status: 400 });
        }
        continue; // แบตช์นี้พลาด ข้ามไป
      }
      scanned += batch.length;
      for (const r of res) {
        if (r.junk && withB64[r.index]) junkIds.push(withB64[r.index].im.id);
      }
    }

    // ★ เฟส 5.3: ภาพที่เคยถูกซ่อนไว้จากรอบก่อน (junkHidden) ยังอยู่ในคลัง (ย้อนกลับได้) — ไม่โชว์ในผลลัพธ์เหมือนกัน
    const visibleAll = all.filter((im) => im.triage?.junkHidden !== true);
    if (junkIds.length === 0) {
      doneProgress(jobId, { step: 'เสร็จ', detail: 'ไม่พบภาพขยะ' });
      return NextResponse.json({ success: true, caseId, scanned, removed: 0, total: visibleAll.length, byPlatform: countByPlatform(visibleAll), images: visibleAll });
    }

    // ★ 9 ก.ค. เฟส 5.3 (แผนคุณภาพคลังรูป): junk = "ซ่อน" (ตั้งธง ย้อนกลับได้) ไม่ใช่ "ลบถาวร"
    //   เดิม removeByIds ลบ record จริง — ตาดูภาพเล็กตัดสินพลาดแล้วกู้คืนไม่ได้ (ของดีหายถาวร)
    //   kill-switch: JUNK_SOFT_HIDE=0 = พฤติกรรมเดิม (ลบถาวรผ่าน removeByIds — ยังคงไว้เป็น fallback)
    let out;
    if (JUNK_SOFT_HIDE) {
      const junkSet = new Set(junkIds);
      const map = {};
      for (const id of junkIds) {
        const im = all.find((x) => x.id === id);
        map[id] = { ...(im?.triage || {}), junkHidden: true };
      }
      await setTriage(caseId, map);
      const visible = visibleAll.filter((im) => !junkSet.has(im.id));
      out = { removed: junkIds.length, total: visible.length, byPlatform: countByPlatform(visible), images: visible };
      console.log(`[images/clean] 🙈 เฟส 5.3: ซ่อนขยะ (junkHidden) ${junkIds.length} ใบ — ย้อนกลับได้ (ไม่ลบ record)`);
    } else {
      out = await removeByIds(caseId, junkIds);
    }
    doneProgress(jobId, { step: 'เสร็จ', detail: `คัดขยะออก ${out.removed} รูป (แคตตาล็อก ${catalogIds.length} + AI ${out.removed - catalogIds.length})` });
    return NextResponse.json({ success: true, caseId, scanned, removed: out.removed, catalogRemoved: catalogIds.length, aiRemoved: out.removed - catalogIds.length, total: out.total, byPlatform: out.byPlatform, images: out.images, softHidden: JUNK_SOFT_HIDE });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json({ success: false, error: err.message || 'คัดขยะไม่สำเร็จ', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
