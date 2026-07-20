import { NextResponse } from 'next/server';
import fs from 'fs';

/**
 * GET /api/model-log — อ่าน log การเรียกโมเดล AI (Claude/Codex/agy/Kimi) จากไฟล์ JSONL
 * ไฟล์นี้เขียนโดยสคริปต์นอกระบบ (run-task.ps1 / arm-run.ps1) — repo นี้แค่ "อ่านอย่างเดียว"
 * ห้ามพึ่งพาไฟล์นี้ว่ามีอยู่เสมอ — บน Vercel/เครื่องอื่นจะไม่มีไฟล์ ต้อง fallback เงียบ
 *
 * Query params:
 *   ?limit=N — จำนวนบรรทัดล่าสุด (default 300, max 2000)
 */
export const dynamic = 'force-dynamic';

const DEFAULT_LOG_PATH = 'C:\\Users\\User\\claude-accounts\\model-call-log.jsonl';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    let limit = parseInt(searchParams.get('limit') || '300', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 300;
    if (limit > 2000) limit = 2000;

    const logPath = process.env.MODEL_CALL_LOG_PATH || DEFAULT_LOG_PATH;

    let raw = null;
    try {
      if (fs.existsSync(logPath)) {
        raw = fs.readFileSync(logPath, 'utf8');
      }
    } catch (readErr) {
      // ไฟล์อ่านไม่ได้ (permission / ไม่มี disk นี้ เช่นบน Vercel) — ถือเป็นเคส "ไม่มีไฟล์"
      raw = null;
    }

    if (raw == null) {
      return NextResponse.json({
        success: true,
        calls: [],
        note: 'log file not found (team machine only)',
      });
    }

    // strip BOM (U+FEFF) — PS 5.1 Add-Content -Encoding UTF8 เขียน BOM หัวไฟล์ → JSON.parse throw ทำ record แรกหายเงียบ (audit Finding #1)
    const allLines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
    const lastLines = allLines.slice(-limit);

    const calls = [];
    let skipped = 0;
    for (const line of lastLines) {
      try {
        const parsed = JSON.parse(line);
        calls.push(parsed);
      } catch (parseErr) {
        skipped += 1;
      }
    }

    return NextResponse.json({
      success: true,
      calls,
      skipped,
      totalLinesInFile: allLines.length,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || 'อ่าน model call log ไม่สำเร็จ',
      errorType: 'MODEL_LOG_READ_ERROR',
    }, { status: 500 });
  }
}
