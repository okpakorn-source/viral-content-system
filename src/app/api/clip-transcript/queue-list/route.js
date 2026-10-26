import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { readWorkerStatus, isHeartbeatRow, readWorkerHeartbeatRow } from '../workerHeartbeat';

/**
 * GET /api/clip-transcript/queue-list (26 มิ.ย.) — รายการ "คิวคลิป" ทั้งหมดให้ UI โชว์เป็นแผงรวม
 *   คืนงานที่ยัง active (pending/processing/retry_wait) เรียงเก่า→ใหม่ + งานเสร็จ/ล้มล่าสุดไม่กี่ชิ้น
 *   ผู้ใช้เห็นภาพรวมว่ามีกี่คลิปรออยู่ · ตัวไหนกำลังลองใหม่ (Gemini แน่น) · ตัวไหนเสร็จแล้ว
 *   🔴 อ่านอย่างเดียวจาก store 'clip-jobs' — ไม่แตะระบบทำข่าวอัตโนมัติ
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE = ['pending', 'processing', 'retry_wait'];
const FINISHED = ['done', 'error', 'cancelled'];
const RECENT_LIMIT = 6;
const LAST_LITE_MAX_AGE_MS = 5 * 60 * 1000;
let _lastLite = null; // ภาพคิวล่าสุดที่อ่านสำเร็จ (ต่อโปรเซส)

// ★ 25 ต.ค. 69 (P1): ฟิลด์ที่หน้าเว็บใช้จริงเท่านั้น — ไม่ดึง result (ผลถอดเต็ม ~90 KB/ใบ) ที่หน้านี้ไม่เคยส่งออก
//   เดิม getAll ทั้งคิว ~4.7 MB ทุก 10 วิต่อแท็บที่เปิดค้าง
const LITE_COLUMNS = [
  'id', 'url:data->>url', 'platform:data->>platform', 'kind:data->>kind', 'user:data->>user',
  'status:data->>status', 'attempts:data->attempts', 'nextRetryAt:data->>nextRetryAt',
  'statusNote:data->>statusNote', 'lastError:data->>lastError', 'createdAt:data->>createdAt',
  'startedAt:data->>startedAt', 'doneAt:data->>doneAt', 'cancelledAt:data->>cancelledAt', 'error:data->>error',
].join(',');

async function loadLiteFromSupabase() {
  const sb = getSupabase();
  const base = () => sb.from('store_items').select(LITE_COLUMNS).eq('store_name', 'clip-jobs');
  const [activeRes, recentRes, cancelledRes, heartbeat] = await Promise.all([
    base().filter('data->>status', 'in', `(${ACTIVE.join(',')})`),
    base().filter('data->>status', 'in', `(${FINISHED.join(',')})`).order('updated_at', { ascending: false, nullsFirst: false }).limit(RECENT_LIMIT * 2),
    sb.from('store_items').select('id', { count: 'exact', head: true }).eq('store_name', 'clip-jobs').filter('data->>status', 'eq', 'cancelled'),
    readWorkerHeartbeatRow(),
  ]);
  const failed = activeRes.error || recentRes.error || cancelledRes.error;
  if (failed) throw new Error(`อ่านคิวคลิปไม่สำเร็จ: ${failed.message}`);
  return {
    jobs: [...(activeRes.data || []), ...(recentRes.data || [])],
    cancelledCount: cancelledRes.count || 0,
    heartbeatRows: heartbeat ? [heartbeat] : [],
  };
}

export async function GET() {
  try {
    let all;
    let worker;
    let cancelledCount = null;
    // ★ ผู้ตรวจอิสระ 25 ต.ค. (กฎ "ห้ามลบ fallback"): อ่านแบบเบาพลาด → ใช้ภาพล่าสุดที่อ่านสำเร็จ (ไม่เกิน 5 นาที)
    //   ไม่มีภาพล่าสุด → ถอยไปทางเดิม (getAll ซึ่งถอยไปไฟล์ local ได้เอง) · กันยิงฐานแบบหนักซ้ำทุกแท็บตอนฐานสะดุด (รอบ 2)
    let lite = null;
    if (isSupabaseReady()) {
      try {
        lite = await loadLiteFromSupabase();
        _lastLite = { at: Date.now(), lite };
      } catch (e) {
        console.warn('[ClipQueueList] อ่านแบบเบาไม่สำเร็จ:', e.message);
        if (_lastLite && Date.now() - _lastLite.at < LAST_LITE_MAX_AGE_MS) lite = _lastLite.lite;
      }
    }
    if (lite) {
      worker = readWorkerStatus(lite.heartbeatRows);
      all = lite.jobs.filter((x) => !isHeartbeatRow(x));
      cancelledCount = lite.cancelledCount;
    } else {
      const store = createStore('clip-jobs');
      const raw = await store.getAll();
      // 💓 แถวชีพจรเครื่องทีมไม่ใช่ใบงาน — แยกออกก่อนนับ/แสดงผล
      worker = readWorkerStatus(raw);
      all = (raw || []).filter((x) => !isHeartbeatRow(x));
    }
    // ★ 26 ส.ค. 69: ส่ง statusNote/lastError/user/cancelledAt ติดไปด้วย (มีในใบงานอยู่แล้ว แต่ไม่เคยส่งออก)
    //   UI ต้องบอกได้ว่าใบไหนติดอะไร ใครส่ง ยกเลิกเมื่อไร — error เต็มไม่ตัด (พิมพ์เขียวข้อ 1)
    const slim = (j) => ({
      id: j.id,
      url: j.url,
      platform: j.platform,
      kind: j.kind || 'insight',
      user: j.user || '',
      status: j.status,
      attempts: j.attempts || 0,
      nextRetryAt: j.nextRetryAt || null,
      statusNote: j.statusNote || '',
      lastError: j.lastError || '',
      createdAt: j.createdAt,
      startedAt: j.startedAt || null,
      doneAt: j.doneAt || null,
      cancelledAt: j.cancelledAt || null,
      error: j.status === 'error' ? String(j.error || '') : '',
    });

    // active เรียงเก่า→ใหม่ (ตัวที่เข้าคิวก่อนอยู่บน)
    const active = all
      .filter((j) => ACTIVE.includes(j.status))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(slim);

    // เสร็จ/ล้ม/ยกเลิก ล่าสุด 6 ชิ้น (ใหม่→เก่า) — ให้เห็นว่าคิวเดินจริง
    //   ★ 26 ส.ค.: รวมใบ cancelled ด้วย (เดิม cancel ลบใบทิ้ง ประวัติหาย)
    const recent = all
      .filter((j) => FINISHED.includes(j.status))
      .sort((a, b) => new Date(b.doneAt || b.cancelledAt || b.createdAt) - new Date(a.doneAt || a.cancelledAt || a.createdAt))
      .slice(0, RECENT_LIMIT)
      .map(slim);

    const counts = {
      pending: active.filter((j) => j.status === 'pending').length,
      processing: active.filter((j) => j.status === 'processing').length,
      retry_wait: active.filter((j) => j.status === 'retry_wait').length,
      cancelled: cancelledCount ?? all.filter((j) => j.status === 'cancelled').length,
      active: active.length,
    };

    return NextResponse.json({ success: true, counts, active, recent, worker });
  } catch (error) {
    console.error('[ClipQueueList]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
