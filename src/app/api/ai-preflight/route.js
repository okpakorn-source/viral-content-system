import { NextResponse } from 'next/server';
import { checkOpenAICredit } from '@/lib/aiCreditPreflight';

/**
 * =====================================================
 * AI Preflight — เช็ค "API หมดเครดิต/โควต้า" ก่อนกดสร้าง
 * =====================================================
 * ผู้ใช้สั่ง (19 มิ.ย.): ถ้า API หมด ให้ "ขึ้นแจ้งเตือนตอนกดสร้าง" — อย่าปล่อยให้
 * ระบบทำงานไปจนได้ "ปกกาๆ" (ปกขยะ/ไม่มีคุณภาพ) ออกมา
 *
 * ทำงาน: ยิง completion เล็กสุด (1 token) ไปที่ OpenAI เพื่อเช็คว่า "เครดิตหมดจริงไหม"
 *   - /v1/models เช็คได้แค่ key ถูกไหม (ไม่บอกว่าเครดิตหมด) → ต้องยิง completion จริง
 *   - ราคาต่อครั้ง ≈ ฟรี (1 token gpt-4o-mini) + cache กันยิงซ้ำถี่
 *
 * ★ logic เช็คอยู่ใน src/lib/aiCreditPreflight.js (raw fetch — แยกขาดจากเวิร์กโฟลว์ทำข่าว)
 *
 * GET /api/ai-preflight        → ใช้ cache ถ้ายังสด
 * GET /api/ai-preflight?fresh=1 → บังคับเช็คสด
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// cache ระดับโมดูล — กันยิง OpenAI ซ้ำทุกครั้งที่กดสร้าง
let _cache = { at: 0, result: null };
const OK_TTL = 60_000;   // ผ่านแล้ว cache 60s
const BAD_TTL = 20_000;  // ไม่ผ่าน cache สั้นกว่า → เติมเงินแล้วกลับมาใช้ได้ไว

export async function GET(request) {
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    const now = Date.now();
    const ttl = _cache.result?.ok ? OK_TTL : BAD_TTL;
    if (!fresh && _cache.result && (now - _cache.at) < ttl) {
      return NextResponse.json({ ..._cache.result, cached: true });
    }
    const result = await checkOpenAICredit();
    _cache = { at: now, result };
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    // ห้ามทำให้การกดสร้างพังเพราะ preflight เอง → fail-open
    return NextResponse.json({ ok: true, provider: 'openai', note: `preflight error: ${String(err.message || err).slice(0, 80)}` });
  }
}
