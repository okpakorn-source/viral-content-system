// ============================================================
// [ระบบทำปกออโต้] POST /api/images/emotions
// ------------------------------------------------------------
// แยก "อารมณ์ภาพ" ในคลังเป็นหมวดหมู่ด้วย Gemini → เซ็ต emotion ต่อรูป
// body: { caseId, jobId? }
// ============================================================

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getCase } from '@/lib/caseStore';
import { readImages, setEmotions, countByEmotion, countByPlatform } from '@/lib/imageStore';
import { loadImageBuffer } from '@/lib/imageBuffer';
import { geminiEmotionScan } from '@/lib/gemini';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CAP = parseInt(process.env.EMOTION_CAP || '250', 10);
const BATCH = 8;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const caseId = (body.caseId || '').trim();
    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    }
    const subjects = c.keywords?.subjects || [];
    const all = await readImages(caseId);
    const targets = all.slice(0, CAP);
    P('เตรียมรูป', `โหลด+ย่อรูป ${targets.length} ใบ`, { pct: 8 });

    const withB64 = [];
    for (const im of targets) {
      const buf = await loadImageBuffer({ imageUrl: im.thumbnailUrl || im.imageUrl, thumbnailUrl: im.imageUrl });
      if (!buf) continue;
      try {
        const small = await sharp(buf, { failOn: 'none' }).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        withB64.push({ im, base64: small.toString('base64') });
      } catch {
        /* รูปเสีย ข้าม */
      }
    }

    const emotionMap = {};
    const totalBatches = Math.ceil(withB64.length / BATCH);
    for (let i = 0; i < withB64.length; i += BATCH) {
      const bi = Math.floor(i / BATCH) + 1;
      P('แยกอารมณ์ด้วย AI', `Gemini แยกอารมณ์ แบตช์ ${bi}/${totalBatches}`, { pct: 10 + Math.round((bi / totalBatches) * 85) });
      const batch = withB64.slice(i, i + BATCH);
      const frames = batch.map((b, k) => ({ index: i + k, base64: b.base64 }));
      let res;
      try {
        res = await geminiEmotionScan({ frames, subjects, onRetry: P.onRetry, caseId });
      } catch (err) {
        if (err.errorType === 'NO_GEMINI_KEY') {
          failProgress(jobId, err.message);
          return NextResponse.json({ success: false, error: err.message, errorType: 'NO_GEMINI_KEY' }, { status: 400 });
        }
        continue;
      }
      for (const r of res) {
        const src = withB64[r.index];
        if (src) emotionMap[src.im.id] = r.emotion;
      }
    }

    const images = await setEmotions(caseId, emotionMap);
    doneProgress(jobId, { step: 'เสร็จ', detail: `แยกอารมณ์แล้ว ${Object.keys(emotionMap).length} รูป` });
    return NextResponse.json({
      success: true,
      caseId,
      classified: Object.keys(emotionMap).length,
      total: images.length,
      byPlatform: countByPlatform(images),
      byEmotion: countByEmotion(images),
      images,
    });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json({ success: false, error: err.message || 'แยกอารมณ์ไม่สำเร็จ', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
