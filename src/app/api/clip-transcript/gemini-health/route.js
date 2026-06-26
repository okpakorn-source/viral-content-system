import { NextResponse } from 'next/server';

/**
 * GET /api/clip-transcript/gemini-health (26 มิ.ย.) — เช็ก "สถานะ Gemini แบบเรียลไทม์"
 *   ยิงคำขอจิ๋ว ๆ ไป gemini-3.5-flash (โมเดลเดียวกับที่ถอดประเด็นใช้) → ดูว่าได้ 200 หรือ 503
 *   คืน { light: 'green'|'red'|'yellow', ok, code, ms, msg } ให้หน้าเว็บโชว์ไฟเขียว/แดง/เหลือง
 *   🔴 ไม่ retry (อยากได้สถานะดิบตอนนี้) + cache 30 วิ (กันยิงถี่เปลือง · ทุกคนเห็นผลเดียวกัน)
 *   แยกเฉพาะเครื่องมือถอดประเด็น — ไม่แตะระบบทำข่าว
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _cache = { at: 0, result: null };
const CACHE_MS = 30_000; // เช็กจริงทุก 30 วิ

export async function GET() {
  // ★ 26 มิ.ย.: บอกว่าใช้คีย์ตัวไหน (ไม่โชว์ค่า) — ยืนยันคีย์แยกถอดคลิปทำงานบน Vercel
  const keySource = process.env.GEMINI_VIDEO_API_KEY ? 'GEMINI_VIDEO_API_KEY (คีย์แยกถอดคลิป)' : 'GEMINI_API_KEY (fallback)';
  // ★ 26 มิ.ย.: สถานะ "endpoint วิดีโอ" จริง (ถอดประเด็นใช้ video ไม่ใช่ text — text/video โหลดคนละตัว!)
  //   อ่านจากผลถอดล่าสุดจริง (callGeminiVideo/VideoFile บันทึกไว้ใน global) — แม่นกว่า probe text
  //   ใช้ได้เฉพาะโปรเซสเดียวกับที่ถอด (โลคอลเครื่องทีม = เคส FB) · ถ้าไม่มีข้อมูลสด → ถอย probe text
  const vh = global.__geminiVideoHealth;
  if (vh && Date.now() - vh.at < 180_000) { // มีผลถอดวิดีโอจริงภายใน 3 นาที
    const ageS = Math.round((Date.now() - vh.at) / 1000);
    if (vh.ok) {
      return NextResponse.json({ light: 'green', ok: true, src: 'video', msg: `Gemini (วิดีโอ) ใช้งานได้จริง — กดถอดได้เลย (ล่าสุด ${ageS} วิ)` });
    }
    return NextResponse.json({ light: 'red', ok: false, code: vh.code, src: 'video', msg: `Gemini (วิดีโอ) แน่น ${vh.code || 503} — ถอดประเด็นยังไม่ผ่าน (ล่าสุด ${ageS} วิ) รอ/กดทิ้งไว้ให้ลองเอง` });
  }

  if (_cache.result && Date.now() - _cache.at < CACHE_MS) {
    return NextResponse.json({ ..._cache.result, cached: true, keySource });
  }

  let result;
  try {
    // ★ ใช้คีย์เดียวกับที่ถอดคลิป (GEMINI_VIDEO_API_KEY) → สถานะตรงกับงานจริง
    const apiKey = process.env.GEMINI_VIDEO_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      result = { light: 'yellow', ok: null, msg: 'ยังไม่ได้ตั้งค่าคีย์ Gemini' };
    } else {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash',
        generationConfig: { maxOutputTokens: 5, temperature: 0 },
      });
      const t0 = Date.now();
      // probe เล็กสุด — ขอ 1 คำ · hard cap 8 วิ (SDK timeout บางทีไม่บังคับ) → ตอบเร็วเสมอ
      //   เกิน 8 วิ = ถือว่า "ช้า/แน่น" (เหลือง) เพราะถ้า Gemini ปกติ 1 คำตอบใน 1-2 วิ
      const HARD_MS = 8000;
      const probe = model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'พิมพ์: ok' }] }] });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('probe-timeout')), HARD_MS));
      await Promise.race([probe, timeout]);
      const ms = Date.now() - t0;
      // หมายเหตุ: นี่คือ probe "ข้อความ" — endpoint วิดีโออาจโหลดต่างกัน (ถ้ามีผลวิดีโอสดจะใช้อันนั้นแทน)
      result = ms > 4000
        ? { light: 'yellow', ok: true, ms, src: 'text', msg: 'Gemini ตอบช้า (เริ่มแน่น) — ลองถอดได้ แต่อาจช้า/ติด' }
        : { light: 'yellow', ok: true, ms, src: 'text', msg: 'Gemini (ข้อความ) ปกติ — แต่ยังไม่มีผลถอดวิดีโอสด ลองกดดูได้' };
    }
  } catch (e) {
    const msg = String(e?.message || '');
    const status = Number(e?.status) || 0;
    if (status === 503 || /\b503\b|overload|unavailable|high demand|temporar/i.test(msg)) {
      result = { light: 'red', ok: false, code: 503, msg: 'Gemini แน่น/ล่มชั่วคราว (503)' };
    } else if (status === 429 || /\b429\b|quota|rate limit|resource exhausted/i.test(msg)) {
      result = { light: 'red', ok: false, code: 429, msg: 'โควต้า/rate limit เต็ม (429)' };
    } else if (/timeout|deadline|aborted|ETIMEDOUT/i.test(msg)) {
      result = { light: 'yellow', ok: false, msg: 'Gemini ตอบช้ามาก (timeout) — อาจเริ่มแน่น' };
    } else {
      result = { light: 'yellow', ok: false, msg: (msg.slice(0, 70) || 'เช็กไม่ได้ชั่วคราว') };
    }
  }

  _cache = { at: Date.now(), result };
  return NextResponse.json({ ...result, cached: false, keySource });
}
