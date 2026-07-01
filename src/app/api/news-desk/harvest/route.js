/**
 * News Desk Harvest — สั่งเก็บ+คัดกรองข่าวรอบใหม่
 * POST { lanes?: ['trend','good'], judgeTop?: 24 }
 * GET  → เหมือน POST (รองรับ Vercel Cron ภายหลัง)
 */
import { NextResponse } from 'next/server';
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';
import { HARVEST_MODES } from '@/lib/services/newsDesk/taxonomy'; // ★ เฟส 5: โหมดหาข่าว

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // harvest + auto-research ตัวท็อป 3 ใบ

// ★ 26 มิ.ย. (เย็น) เปิดคืน: ปรับสมองคัด "ทำใหม่ได้ (remakeable)" บังคับทุกแหล่งแล้ว → หาข่าวที่ใช้ได้จริง
//   (คืน cron ใน vercel.json แล้ว) · 🔴 ไม่กระทบระบบทำข่าวอัตโนมัติ/ถอดประเด็น/ทำปก
const HARVEST_PAUSED = false;
const pausedResponse = () => NextResponse.json({
  success: false, paused: true,
  error: 'ระบบหาข่าวใหม่พักชั่วคราว (พัก API ระหว่างปรับปรุงคุณภาพข่าว) — ข่าวเดิมในโต๊ะยังใช้ได้ปกติ',
  errorType: 'HARVEST_PAUSED',
}, { status: 200 });

// กันเก็บซ้อนกัน — เครื่องหนึ่งเก็บทีละรอบ
let _harvestLock = Promise.resolve();

async function doHarvest(opts) {
  const prev = _harvestLock;
  let release;
  _harvestLock = new Promise((r) => (release = r));
  await prev;
  try {
    await pruneOldItems(12); // 19 มิ.ย. (เก็บกว้าง): ยืด 3→12 วัน ให้สอดคล้องเพดานเก็บข่าวใหม่
    const stats = await runHarvest(opts);
    return NextResponse.json({ success: true, ...stats });
  } finally {
    release();
  }
}

export async function POST(request) {
  if (HARVEST_PAUSED) return pausedResponse(); // ★ พักหาข่าวใหม่ชั่วคราว
  try {
    const body = await request.json().catch(() => ({}));
    // ★ เฟส 5 (29 มิ.ย.): โหมดหาข่าว — แต่ละโหมด = ชุดเลนคนละแบบ (ทุกรีเฟรชสำรวจพื้นที่ใหม่ ไม่วนเดิม)
    if (body.mode) {
      const m = HARVEST_MODES.find(x => x.key === body.mode);
      if (m) return await doHarvest({ lanes: m.lanes, judgeTop: Math.min(40, Number(body.judgeTop) || 24) });
    }
    // ★ 17 มิ.ย. (ทีมขอ): ค้นด้วย "คีย์เวิร์ดคน/เรื่อง" เอง (เผื่อปิ๊งไอเดีย) เช่น "ลิซ่า" / "ดารากตัญญู" / "หมูเด้ง"
    if (body.keyword && String(body.keyword).trim().length >= 2) {
      const kw = String(body.keyword).trim().slice(0, 60);
      const _searchedAt = new Date().toISOString();
      const qs = [
        { q: `${kw} ล่าสุด`, lane: 'trend', timeRange: 'qdr:w', endpoint: 'news' },          // สด
        { q: `${kw} ข่าว ประเด็น`, lane: 'celeb', timeRange: 'qdr:m', endpoint: 'search' },   // กว้าง
        { q: `${kw} ช่วยเหลือ ทำดี บริจาค กตัญญู`, lane: 'good', timeRange: 'qdr:y', endpoint: 'search' }, // น้ำดี/อมตะ
        { q: `${kw} สัมภาษณ์ เปิดใจ`, lane: 'celeb', timeRange: 'qdr:y', endpoint: 'search' }, // สัมภาษณ์
      ];
      return await doHarvest({
        lanes: [],
        extraQueries: qs.map(f => ({ ...f, tag: { focusTag: `🔎 ${kw}`, searchedAt: _searchedAt } })),
        judgeTop: Math.min(40, Number(body.judgeTop) || 20),
      });
    }
    // ★ สั่งหาเฉพาะแนว (15 มิ.ย.): focus → คำค้นเฉพาะแนวนั้น → harvest แค่แนวนั้น (judge ได้ลึกขึ้นเพราะคำน้อย)
    if (body.focus) {
      const { generateFocusQueries } = await import('@/lib/services/newsDesk/goodNewsScout');
      // ★ 20 มิ.ย. (ผู้ใช้สั่ง): ยิงลึก ~30 คีย์/คลิก (เดิม 8) → ข่าวเยอะ+ครอบคลุมแนว
      const fq = generateFocusQueries(body.focus, Number(body.count) || 30);
      if (!fq.length) {
        return NextResponse.json({ success: false, error: 'ไม่รู้จักแนวที่สั่ง', errorType: 'UNKNOWN_FOCUS' }, { status: 400 });
      }
      // ★ 16 มิ.ย.: ติดป้าย focusTag + searchedAt → ผลค้นไปรวมในแท็บ "🎯 ผลค้นหา" (กลับมาดูได้ ไม่หาย)
      const _searchedAt = new Date().toISOString();
      return await doHarvest({
        lanes: [],
        extraQueries: fq.map(f => ({ q: f.q, lane: f.lane, timeRange: f.timeRange, endpoint: f.endpoint, tag: { focusTag: body.focus, searchedAt: _searchedAt } })),
        judgeTop: Math.min(60, Number(body.judgeTop) || 36),
      });
    }
    return await doHarvest({
      lanes: Array.isArray(body.lanes) && body.lanes.length ? body.lanes : ['trend', 'good', 'broad', 'exa', 'clip'],
      judgeTop: Math.min(40, Number(body.judgeTop) || 24),
    });
  } catch (error) {
    console.error('[NewsDesk Harvest]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'HARVEST_ERROR' }, { status: 500 });
  }
}

export async function GET(request) {
  return POST(request);
}
