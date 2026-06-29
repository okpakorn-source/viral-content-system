/**
 * News Desk Metrics API (เฟส 6 — 29 มิ.ย.) — GET → สรุปตัวชี้วัดโต๊ะข่าวจากงานจริง
 * 🔴 อ่านอย่างเดียว · เฉพาะโต๊ะข่าวกลาง ไม่แตะระบบทำข่าว/ถอดประเด็น
 */
import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { enrichDeskItem } from '@/lib/services/newsDesk/taxonomy';
import { computeDeskMetrics } from '@/lib/services/newsDesk/deskMetrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJson(rel) {
  try { const raw = await readFile(path.join(process.cwd(), rel), 'utf8'); return JSON.parse(raw); } catch { return null; }
}

export async function GET() {
  try {
    const d = await readJson('data/news-desk.json');
    const fbd = await readJson('data/news-desk-feedback.json');
    const items = Array.isArray(d) ? d : (d?.items || (d ? Object.values(d) : []));
    const feedback = Array.isArray(fbd) ? fbd : (fbd?.items || fbd?.rejects || (fbd ? Object.values(fbd) : []));
    // enrich (ให้มี editorial/reliability) แบบเบาๆ — ตัด fullText กันหน่วง
    const enriched = (items || []).slice(0, 2000).map((it) => {
      try { const { fullText, ...rest } = it || {}; return enrichDeskItem(rest); } catch { return it; }
    });
    const metrics = computeDeskMetrics(enriched, feedback || []);
    return NextResponse.json({ success: true, metrics, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, errorType: 'METRICS_ERROR' }, { status: 500 });
  }
}
