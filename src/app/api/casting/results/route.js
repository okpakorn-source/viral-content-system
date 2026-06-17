export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

// GET /api/casting/results → รายชื่อผู้ทำ + คะแนน (เรียงล่าสุดก่อน) สำหรับแอดมิน
export async function GET() {
  try {
    const all = await createStore('casting-results').getAll();
    all.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    // light: ไม่ต้องส่ง detail เต็มทุกคนในลิสต์ (ส่ง summary)
    const results = all.slice(0, 300).map(r => ({
      id: r.id, name: r.name, total: r.total, maxScore: r.maxScore, percent: r.percent,
      answered: r.answered, completedAt: r.completedAt, detail: r.detail,
    }));
    return NextResponse.json({ success: true, results, total: all.length });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, results: [] }, { status: 500 });
  }
}
