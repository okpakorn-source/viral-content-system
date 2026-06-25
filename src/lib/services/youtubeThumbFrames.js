/**
 * YouTube Auto-Thumbnail Frames (25 มิ.ย. 69) — แหล่งภาพ "บริบทข่าว" เสริม สำหรับช่องเล็กของปก
 * ─────────────────────────────────────────────────────────────────────────────
 * แนวคิด: YouTube auto-สร้างเฟรม 3-4 จุดในคลิป (hq1/hq2/hq3.jpg = 480×360 เฟรมจริง ไม่มีตัวหนังสือ)
 *   ดึงผ่าน HTTPS ล้วน (i.ytimg.com) → ★ ไม่ใช้ yt-dlp/ffmpeg → ทำงานบน Vercel ได้ ไม่ crash
 * ใช้เป็น "ผู้สมัครภาพบริบท" (คน/เหตุการณ์/สถานที่ — อะไรก็ได้ที่อยู่ในคลิป) ส่งให้ judge คัดต่อ
 *
 * 🔴 เป็นแค่ "แหล่งภาพเพิ่ม" — ไม่แตะ crop/template/judge เกณฑ์/ระบบทำข่าว
 * 🔴 เฟรมพวกนี้ = context-only (กันเป็นฮีโร่ที่ฝั่ง route) · ฮีโร่ยังมาจากพอร์ตเทรตคมเหมือนเดิม
 */
import sharp from 'sharp';

const LOG = '[YTThumb]';

async function fetchBuf(url, timeoutMs = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 3000 ? b : null;
  } catch { clearTimeout(t); return null; }
}

/** ความคมของภาพ (stdev ของ Laplacian บนภาพย่อ) — สูง = คม/รู้เรื่อง · ต่ำ = เบลอ/กำกวม */
async function sharpnessScore(buf) {
  try {
    const st = await sharp(buf).resize(220, 220, { fit: 'inside' }).grayscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats();
    return st?.channels?.[0]?.stdev || 0;
  } catch { return 0; }
}

/**
 * ดึงเฟรม auto-thumbnail จากหลายคลิป → คืนเฉพาะเฟรม "คม รู้เรื่อง" (กรองเบลอ/กำกวมทิ้ง)
 * @param {string[]} videoIds
 * @param {{perVideo?:number, maxTotal?:number, minSharp?:number}} opts
 * @returns {Promise<Array<{buffer:Buffer, source:'youtube-thumb', videoId:string, sharpness:number}>>}
 */
export async function fetchYouTubeThumbFrames(videoIds = [], { perVideo = 3, maxTotal = 4, minSharp = 4 } = {}) {
  const names = ['hq1', 'hq2', 'hq3', 'hq4'].slice(0, Math.max(1, perVideo + 1));
  const out = [];
  let scanned = 0, blurDropped = 0;
  for (const id of videoIds) {
    if (out.length >= maxTotal) break;
    for (const n of names) {
      const buf = await fetchBuf(`https://i.ytimg.com/vi/${id}/${n}.jpg`);
      if (!buf) continue;
      scanned++;
      try {
        const meta = await sharp(buf).metadata();
        if ((meta.width || 0) < 320) continue; // 120×90 placeholder = ข้าม
        // ★ ตัดขอบดำ (เฟรม 16:9 อยู่กลางภาพ 4:3) — trim ขอบสีเดียว
        let frame = await sharp(buf).trim({ threshold: 18 }).toBuffer().catch(() => buf);
        let fm = await sharp(frame).metadata();
        if ((fm.width || 0) < 320 || (fm.height || 0) < 170) { frame = buf; } // trim มากไป → ใช้ภาพเต็ม
        // ★ กรองความชัด — ทิ้งเฟรมเบลอ/เคลื่อนไหว/กำกวม (ต้อง "รู้เรื่องว่าภาพนั้นคืออะไร")
        const sh = await sharpnessScore(frame);
        if (sh < minSharp) { blurDropped++; continue; }
        const proc = await sharp(frame).jpeg({ quality: 88 }).toBuffer();
        out.push({ buffer: proc, source: 'youtube-thumb', videoId: id, sharpness: +sh.toFixed(1) });
      } catch {}
      if (out.length >= maxTotal) break;
    }
  }
  out.sort((a, b) => b.sharpness - a.sharpness); // คมสุดก่อน
  console.log(`${LOG} สแกน ${scanned} เฟรม → คมพอ ${out.length} (เบลอทิ้ง ${blurDropped}) จาก ${videoIds.length} คลิป`);
  if (out.length === 0) return out;

  // ★ ด่านนับคน (25 มิ.ย. — ผู้ใช้: เลือกเฟรมที่คนไม่โดนตัดท่อนน่าเกลียด):
  //   executor ครอปช่องรอบ "หน้าใหญ่สุดคนเดียว" → เฟรมหลายคนพอๆ กันจะตัดคนอื่นแหว่ง
  //   → เก็บเฉพาะเฟรมที่ "มีคนเด่นชัดคนเดียว" (1 หน้า หรือหน้าใหญ่สุด ≥1.8x คนรอง = คนอื่นเป็นฉากหลัง)
  //   เฟรมที่มี 2+ คนขนาดพอๆ กัน (ครอปแล้วตัดคนน่าเกลียด) → ทิ้ง เลือกเฟรมคนน้อย/คนเด่นแทน
  try {
    const { batchDetectFaces } = await import('@/lib/services/faceDetector');
    const fdMap = await batchDetectFaces(out.map((f, i) => ({ id: 'yt' + i, buffer: f.buffer })));
    const kept = [];
    let crowdDropped = 0;
    for (let i = 0; i < out.length; i++) {
      const faces = (fdMap.get('yt' + i)?.faces) || [];
      const n = faces.length;
      if (n >= 2) {
        const areas = faces.map(f => (f.width || 0) * (f.height || 0)).sort((a, b) => b - a);
        const dominant = areas[0] >= (areas[1] || 0) * 1.8; // คนใหญ่สุดเด่นกว่าคนรองชัด → ครอปได้ คนอื่นเป็นฉากหลัง
        if (!dominant) { crowdDropped++; continue; }          // คนหลายคนพอๆ กัน → ตัดทิ้ง (เลือกคนน้อยแทน)
      }
      out[i].faceCount = n;
      kept.push(out[i]);
    }
    console.log(`${LOG} ด่านนับคน: เหลือ ${kept.length}/${out.length} (ตัดเฟรมคนเยอะ-ครอปแล้วแหว่ง ${crowdDropped})`);
    return (kept.length > 0 ? kept : out).slice(0, maxTotal);
  } catch (e) {
    console.log(`${LOG} ด่านนับคนข้าม: ${e.message?.slice(0, 40)}`);
    return out.slice(0, maxTotal);
  }
}
