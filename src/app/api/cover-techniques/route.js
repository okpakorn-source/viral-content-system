// ============================================================
// 📚 GET /api/cover-techniques — อ่านคลังเทคนิคปกแสนไลค์ (19 ใบวิเคราะห์ + กติกาสังเคราะห์)
// อ่านสดจากดิสก์ทุกครั้ง (force-dynamic) — ไฟล์นี้แก้ด้วยมือ ไม่ผ่าน persistStore
// ============================================================

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const LIBRARY_PATH = path.join(process.cwd(), 'data', 'cover-technique-library.json');

export async function GET() {
  try {
    let raw;
    try {
      raw = await fs.readFile(LIBRARY_PATH, 'utf-8');
    } catch (readErr) {
      if (readErr.code === 'ENOENT') {
        return NextResponse.json({
          success: false,
          error: 'ไม่พบไฟล์คลังเทคนิคปก (data/cover-technique-library.json)',
          errorType: 'LIBRARY_NOT_FOUND',
        }, { status: 404 });
      }
      throw readErr;
    }

    const library = JSON.parse(raw);
    return NextResponse.json({ success: true, library });
  } catch (error) {
    console.error('[api/cover-techniques] error:', error.message);
    return NextResponse.json({
      success: false,
      error: 'อ่านคลังเทคนิคปกไม่สำเร็จ: ' + error.message,
      errorType: 'LIBRARY_READ_ERROR',
    }, { status: 500 });
  }
}
