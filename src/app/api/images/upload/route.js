// ============================================================
// [ระบบทำปกออโต้] POST /api/images/upload
// อัปโหลดรูปเข้าคลังเคส (กรณีค้นไม่ตรง/ข่าวใหม่ ใส่รูปเดี่ยวเอง)
// body: { caseId, images: [dataURL, ...] }  (dataURL = data:image/...;base64,)
// ============================================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getCase } from '@/lib/caseStore';
import { addImages } from '@/lib/imageStore';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req) {
  try {
    const { caseId, images } = await req.json().catch(() => ({}));
    if (!caseId || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ success: false, error: 'ต้องมี caseId และ images (dataURL)', errorType: 'BAD_INPUT' }, { status: 400 });
    }
    const c = await getCase(caseId);
    if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });

    const outDir = path.join(process.cwd(), 'public', 'case-uploads', caseId);
    await fs.mkdir(outDir, { recursive: true });

    const records = [];
    let n = 0;
    for (const dataUrl of images) {
      const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
      if (!m) continue;
      let buf = Buffer.from(m[1], 'base64');
      try {
        // normalize เป็น jpg + จำกัดขนาด (กันไฟล์ใหญ่/ฟอร์แมตแปลก)
        buf = await sharp(buf, { failOn: 'none' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      } catch {
        continue; // ไม่ใช่รูปที่อ่านได้
      }
      n++;
      const name = `up_${Date.now()}_${n}.jpg`;
      await fs.writeFile(path.join(outDir, name), buf);
      const url = `/case-uploads/${caseId}/${name}`;
      records.push({ imageUrl: url, thumbnailUrl: url, title: 'อัปโหลด', source: 'อัปโหลดเอง', sourceLink: '', width: null, height: null });
    }

    if (records.length === 0) {
      return NextResponse.json({ success: false, error: 'ไม่มีรูปที่อ่านได้', errorType: 'NO_IMAGES' }, { status: 400 });
    }

    const withPlatform = records.map((r) => ({ ...r, platform: 'upload', query: 'upload' }));
    const saved = await addImages(caseId, withPlatform);
    return NextResponse.json({
      success: true,
      caseId,
      added: saved.added,
      total: saved.total,
      byPlatform: saved.byPlatform,
      images: saved.images,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'อัปโหลดไม่สำเร็จ', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
