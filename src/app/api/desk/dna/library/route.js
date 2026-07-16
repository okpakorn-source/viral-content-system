/**
 * 🧬 DNA Library API — คลังข่าวต้นแบบ (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 *  GET  ?tier&category&month&clusterId&q&limit → รายการต้นแบบ (กรอง+เรียง reach มาก→น้อย)
 *  GET  ?view=clusters                          → สรุปกลุ่มตาม archetype
 *  GET  ?view=export                             → ทุก record (สำหรับ export/backup)
 *  POST { action:'saveBatch', records }          → เซฟล็อตใหม่ (validate + conflict policy)
 *  POST { action:'delete', postKey }             → ลบต้นแบบ 1 ใบ
 */
import { NextResponse } from 'next/server';
import { listExemplars, clusterSummary, exportAll, saveBatch, deleteExemplar } from '@/lib/services/deskV2/dnaLibrary.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || '';

    if (view === 'clusters') {
      const clusters = await clusterSummary();
      return NextResponse.json({ success: true, clusters });
    }

    if (view === 'export') {
      const records = await exportAll();
      return NextResponse.json({ success: true, records });
    }

    const tier = searchParams.get('tier') || undefined;
    const category = searchParams.get('category') || undefined;
    const month = searchParams.get('month') || undefined;
    const clusterId = searchParams.get('clusterId') || undefined;
    const q = searchParams.get('q') || undefined;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const exemplars = await listExemplars({ tier, category, month, clusterId, q, limit });
    return NextResponse.json({ success: true, exemplars });
  } catch (error) {
    console.error('[DnaLibrary GET]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DNA_LIBRARY_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.action === 'saveBatch') {
      if (!Array.isArray(body.records) || body.records.length === 0) {
        return NextResponse.json({ success: false, error: 'records ต้องเป็น array ที่ไม่ว่าง', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await saveBatch(body.records);
      return NextResponse.json({ success: true, ...result });
    }

    if (body.action === 'delete') {
      if (!body.postKey) {
        return NextResponse.json({ success: false, error: 'ต้องระบุ postKey', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await deleteExemplar(body.postKey);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ success: false, error: 'action ไม่รู้จัก', errorType: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (error) {
    console.error('[DnaLibrary POST]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DNA_LIBRARY_ERROR' }, { status: 500 });
  }
}
