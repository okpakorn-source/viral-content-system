/**
 * 🧬 Extract DNA API — สกัดดีเอ็นเอแนวข่าวจาก CSV เพจ (4 ก.ค. 69)
 * POST { path }  → อ่าน CSV จากเครื่อง (เครื่องทีม) แล้วสกัด DNA
 * POST { csv }   → ส่งเนื้อไฟล์ CSV มาตรง
 * GET            → ดู DNA ล่าสุดที่สกัดไว้
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */
import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { extractDna, getDna } from '@/lib/services/newsDesk/dnaExtractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  try {
    const dna = await getDna();
    return NextResponse.json({ success: true, dna });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, errorType: 'DNA_GET_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    let raw = body.csv || '';
    if (!raw && body.path) {
      if (!/\.csv$/i.test(String(body.path))) {
        return NextResponse.json({ success: false, error: 'path ต้องเป็นไฟล์ .csv', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      raw = await readFile(String(body.path), 'utf8');
    }
    if (!raw || raw.length < 500) {
      return NextResponse.json({ success: false, error: 'ต้องส่ง csv (เนื้อไฟล์) หรือ path ไฟล์ Meta export', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: 'ขาด OPENAI_API_KEY', errorType: 'MISSING_KEY' }, { status: 500 });
    }
    const logs = [];
    const record = await extractDna(raw, { topN: Number(body.topN) || 250, onLog: (m) => { logs.push(m); console.log('[ExtractDNA]', m); } });
    return NextResponse.json({
      success: true,
      posts: record.posts, themeCount: record.themeCount,
      totalNewsQueries: record.totalNewsQueries, totalClipQueries: record.totalClipQueries,
      themes: record.themes.map(t => ({ name: t.name, category: t.category, weight: t.weight, dna: t.dna, newsQueries: t.newsQueries.slice(0, 3), clipQueries: t.clipQueries.slice(0, 3) })),
      logs,
      note: 'ทุกเลนใน harvester จะดึงคำค้นจากคลัง DNA นี้อัตโนมัติภายใน 10 นาที (cache)',
    });
  } catch (error) {
    console.error('[ExtractDNA API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DNA_EXTRACT_ERROR' }, { status: 500 });
  }
}
