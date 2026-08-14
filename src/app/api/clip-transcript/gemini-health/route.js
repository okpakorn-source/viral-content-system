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

export async function GET(request) {
  // ★ 14 ส.ค. 69 — โหมดตรวจรายชื่อรุ่น: ?list=3.7 → ถามรายชื่อโมเดลที่คีย์นี้ใช้ได้จริงจาก Google
  //   ที่มา: ตั้งชื่อรุ่นวิดีโอผิด (gemini-3.7-flash-high) แล้วถอดล้มทั้งระบบ — ต่อไปเช็คชื่อจริงได้เอง ไม่ต้องเดา
  //   ใช้คีย์ฝั่งเซิร์ฟเวอร์ตามปกติ ไม่คืนคีย์ · คืนเฉพาะชื่อรุ่น (metadata สาธารณะ) · ไม่แตะแคช/ไฟสถานะเดิม
  const _sp = new URL(request.url).searchParams;
  // ★ 14 ส.ค. 69 (รอบสอง) — โหมดยิงทดสอบรุ่นตรงตัว: ?probe=<ชื่อรุ่น> → generateContent จริง (config เดียวกับสายวิดีโอ:
  //   JSON mode) แล้วคืน error "เต็ม ไม่ตัด" — ที่มา: ถอดด้วย gemini-3.7-flash ล้มแต่ข้อความ error โดนตัด 120 ตัว
  //   จนไม่เห็นสาเหตุจริง (ชื่อรุ่นมีใน ListModels แต่เรียกไม่ผ่าน) · ใช้วินิจฉัยเท่านั้น ไม่แตะไฟสถานะ/แคชเดิม
  const probeQ = _sp.get('probe');
  if (probeQ) {
    try {
      const apiKey = process.env.GEMINI_VIDEO_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ success: false, error: 'ยังไม่ได้ตั้งค่าคีย์ Gemini', errorType: 'NO_API_KEY' }, { status: 503 });
      }
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      // &max=32000 → ทดสอบเพดาน output เท่าสายวิดีโอจริง (วินิจฉัยเคสรุ่นใหม่รับ maxOutputTokens ไม่เท่ารุ่นเก่า)
      const probeMax = Math.max(1, Math.min(65536, Number(_sp.get('max')) || 200));
      const probeModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: String(probeQ).slice(0, 60),
        generationConfig: { maxOutputTokens: probeMax, temperature: 0, responseMimeType: 'application/json' },
      });
      const t0 = Date.now();
      const res = await probeModel.generateContent(
        { contents: [{ role: 'user', parts: [{ text: 'ตอบ JSON เท่านั้น: {"ok":true}' }] }] },
        { requestOptions: { timeout: 20_000 } },
      );
      return NextResponse.json({ success: true, model: probeQ, ms: Date.now() - t0, text: String(res.response?.text() || '').slice(0, 120) });
    } catch (e) {
      return NextResponse.json({
        success: false, model: probeQ, status: Number(e?.status) || 0,
        error: String(e?.message || e).slice(0, 600), errorType: 'PROBE_FAILED',
      }, { status: 502 });
    }
  }

  const listQ = _sp.get('list');
  if (listQ !== null) {
    try {
      const apiKey = process.env.GEMINI_VIDEO_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ success: false, error: 'ยังไม่ได้ตั้งค่าคีย์ Gemini', errorType: 'NO_API_KEY' }, { status: 503 });
      }
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`, { signal: AbortSignal.timeout(15_000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return NextResponse.json({ success: false, error: `Google ตอบ ${r.status}: ${String(data?.error?.message || '').slice(0, 140)}`, errorType: 'LIST_FAILED' }, { status: 502 });
      }
      const q = String(listQ).toLowerCase();
      const models = (data.models || [])
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((n) => !q || n.toLowerCase().includes(q))
        .sort();
      return NextResponse.json({ success: true, filter: q, count: models.length, models });
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e?.message || e).slice(0, 140), errorType: 'LIST_ERROR' }, { status: 500 });
    }
  }

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
        // ★ 22 ก.ค. 69: probe โมเดลเดียวกับที่ถอดคลิปใช้จริง (VIDEO_MODEL ใน geminiClient) — อัปเกรดเป็น 3.6-flash
        // ★ 14 ส.ค. 69 (เจ้าของสั่ง): ตาม VIDEO_MODEL ไป gemini-3.7-flash (ชื่อจริงจาก ListModels — '-high' ไม่มีใน API)
        model: process.env.GEMINI_VIDEO_MODEL || 'gemini-3.7-flash',
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
