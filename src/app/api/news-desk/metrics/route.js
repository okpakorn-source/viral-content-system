/**
 * News Desk Metrics API (เฟส 6 — 29 มิ.ย.) — GET → สรุปตัวชี้วัดโต๊ะข่าวจากงานจริง
 * 🔴 อ่านอย่างเดียว · เฉพาะโต๊ะข่าวกลาง ไม่แตะระบบทำข่าว/ถอดประเด็น
 */
import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { enrichDeskItem } from '@/lib/services/newsDesk/taxonomy';
import { computeDeskMetrics, computeQueryYield } from '@/lib/services/newsDesk/deskMetrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJson(rel) {
  try { const raw = await readFile(path.join(process.cwd(), rel), 'utf8'); return JSON.parse(raw); } catch { return null; }
}

export async function GET(request) {
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
    // ★ 2 ก.ค.: รายงานผลผลิตรายคีย์ค้น — ?days=7 ปรับหน้าต่างได้ (คีย์รุ่ง/คีย์ตาย/สรุปต่อเลน)
    const days = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
    const queryYield = computeQueryYield(items || [], days);
    // ★ 2 ก.ค.: 👁️ Living Watchlist — ทีมเห็นว่าระบบกำลังเกาะใครอยู่ (โตจากปุ่ม 🔥/ส่งทำ)
    let watchlist = [];
    try {
      const { getWatchlist } = await import('@/lib/services/newsDesk/watchlistService');
      watchlist = (await getWatchlist()).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 40)
        .map(w => ({ name: w.name, count: w.count, from: w.from, lastSeenAt: w.lastSeenAt }));
    } catch { /* watchlist อ่านไม่ได้ = ส่งว่าง */ }
    return NextResponse.json({ success: true, metrics, queryYield, watchlist, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, errorType: 'METRICS_ERROR' }, { status: 500 });
  }
}
