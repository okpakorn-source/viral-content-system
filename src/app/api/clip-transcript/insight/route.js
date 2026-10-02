export const maxDuration = 800; // เผื่อดาวน์โหลด/บีบ/อัปโหลดคลิปยาว แต่ inference ถอดคลิปถูกล็อกไว้หนึ่งครั้งต่อคำขอ
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
import { pickCasesToPurge, CLIP_CASE_KEEP, archiveRowId, CLIP_ARCHIVE_STORE } from '@/lib/services/clipArchive';
import { extractFirstUrl } from '@/lib/services/clipAgent/clipUrl'; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ดึงลิงก์แรก (ข้อ 4)
import { randomUUID } from 'crypto';

// โหลดไฟล์วิดีโอ TikTok (tikwm) — ใช้บนคลาวด์ได้
async function downloadTiktokBuffer(url) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`);
  const data = await res.json();
  const playUrl = data?.data?.hdplay || data?.data?.play;
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R3): ข้อความ "ถาวร" ต้องบอกชัดที่ต้นทาง — worker (isTransient) ถือข้อความที่ไม่รู้จักเป็นชั่วคราว
  //   เดิม 'tikwm: ไม่พบลิงก์วิดีโอ' / 'วิดีโอใหญ่เกิน 150MB' หลุดเป็นชั่วคราว → ลองซ้ำ 80 รอบ (~4 ชม.) ทั้งที่คลิปถูกลบ/เป็นโพสต์รูป/ใหญ่เกิน
  //   (ใหญ่เกิน = โหลด 150MB+ ซ้ำทุกรอบ) · fetch ล้มจากเน็ตปล่อยข้อความเดิม (fetch failed = ชั่วคราว ถูกแล้ว)
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L2): tikwm ติดเพดานความถี่ก็ตอบ "ไม่มีลิงก์วิดีโอ" เหมือนกัน (เช่น {code:-1, msg:'Free Api Limit: 1 request/second.'})
  //   แต่เป็นอาการชั่วคราว รอแป๊บเดียวก็ผ่าน — รอบ 2 รวบเป็น "ไม่พบวิดีโอ — กดใหม่ไม่ช่วย" ทำให้ worker ไม่ลองใหม่เลย
  //   msg เข้าข่ายจำกัดความถี่/ไม่ว่าง → ข้อความมีคำ "แน่น" (worker isTransient = ชั่วคราว) · กรณีอื่นคงข้อความถาวรของรอบ 2
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F3): regex รอบ 3 กว้างไป — "rate" เปล่าจับ generate/moderated/accurate
  //   และ "limit" เปล่าจับ "limited in your region" → ข้อความถาวร ("Failed to generate play address" · "under moderated review"
  //   · "limited in your region") กลายเป็น "แน่นชั่วคราว" → วนลองซ้ำ 80 รอบ · ตอนนี้จับเฉพาะวลีจำกัดความถี่จริง
  //   (rate limit/rate_limit/ratelimit · "Api Limit" · คำ limit เดี่ยวที่ไม่ตามด้วย " in" · too many · busy · try again)
  if (!playUrl) {
    const msg = String(data?.msg ?? '');
    if (/rate[\s_-]?limit|\bapi limit\b|\blimit\b(?! in)|too many|busy|try again/i.test(msg)) throw new Error(`tikwm แน่นชั่วคราว (rate limit: ${msg.slice(0, 80)})`);
    throw new Error(`tikwm: ไม่พบวิดีโอ (ลิงก์เสีย/โพสต์รูป/ถูกลบ${data?.msg ? ': ' + String(data.msg).slice(0, 80) : ''}) — กดใหม่ไม่ช่วย`);
  }
  const vres = await fetch(playUrl);
  const buf = Buffer.from(await vres.arrayBuffer());
  if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
  if (buf.length > 150 * 1e6) throw new Error('วิดีโอใหญ่เกิน 150MB — กดใหม่ไม่ช่วย');
  return buf;
}

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R3): ห่อความพลาดของ yt-dlp ใหม่ก่อนส่งต่อ
//   ข้อความเดิมของ execFile = "Command failed: <บรรทัดคำสั่งทั้งหมด>" มีพาธไฟล์ชั่วคราว meta_<เวลา>.mp4 + ลิงก์/รหัสวิดีโอเลขยาว
//   → เลข 503/429 โผล่โดยบังเอิญ worker (isTransient) ตีเป็นชั่วคราว วนลองซ้ำ · errorType หลุดเป็นเลข exit code
//   ใหม่: หมดเวลา 180 วิ (ถูก kill) = บอก timeout (ชั่วคราว) · อื่นๆ = บรรทัดสุดท้ายของ stderr (ข้อความ ERROR ของ yt-dlp)
//   ตัดลิงก์/พาธ/เลขยาวทิ้ง (เลขสถานะ HTTP 3 หลัก เช่น "HTTP Error 429" คงไว้ = ชั่วคราวถูกต้อง) · code = CLIP_DOWNLOAD_FAILED
//   ถาวร/ชั่วคราวให้ข้อความตัดสินที่ worker เหมือนเดิม (retrySafe ยังติดที่ _loadClipBuffer — ยังไม่จ่ายค่าโมเดล)
// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M1): ตัดสิน "ถาวร/ชั่วคราว" ที่นี่เอง — ห้ามส่งบรรทัด stderr ดิบให้ worker เดาจากคำ
//   รอบ 2 ส่งบรรทัด ERROR ของ yt-dlp ตรงๆ → error ถาวรที่บังเอิญมีคำ parse/unavailable ("Cannot parse data; please report this issue…"
//   · "Failed to parse JSON" · "Video unavailable") ถูก isTransient (ล็อก) ตีเป็นชั่วคราว → วนลองซ้ำ 80 รอบ
//   ชั่วคราว "เฉพาะ": บรรทัดเข้า YTDLP_TRANSIENT (เน็ต/เว็บปลายทางล่ม) · ถูกฆ่า (หมดเวลา) · spawn EACCES/EBUSY (ไฟล์ถูกล็อกชั่วครู่ เช่นแอนตี้ไวรัส)
//     → "yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: …) — ลองใหม่ได้ เดี๋ยวก็ผ่าน"
//     ต่อท้าย "เดี๋ยวก็ผ่าน" เสมอ = คำชั่วคราวที่ worker รู้จัก — คำว่า "ชั่วคราว" เฉยๆ worker ไม่รู้จัก และบรรทัดอย่าง "HTTP Error 502"
//     · "Connection reset" · "getaddrinfo" · "EAI_AGAIN" · "EACCES" ไม่มีคำที่ worker รู้จัก → จะตกด่านถาวร "โหลดวิดีโอ…ไม่สำเร็จ" ของ worker
//   อื่นๆ ทั้งหมด → "yt-dlp โหลดวิดีโอไม่สำเร็จ: … — กดใหม่ไม่ช่วย" (ด่านถาวรชั้นแรกของ worker ชนะคำ parse/unavailable/503 ที่ปนมา)
//   เลือกบรรทัด: บรรทัด "ERROR:" ตัวสุดท้ายก่อน · ไม่มีใช้บรรทัดสุดท้ายที่ไม่ว่าง · stderr ว่าง = "<code> <message>" บรรทัดแรก (ตัดบรรทัดคำสั่ง)
//   ตัดสินจากข้อความที่ตัดลิงก์/พาธ/เลขยาวแล้ว (ชื่อเพจในลิงก์ เช่น …/networknews/… ต้องไม่ทำให้กลายเป็นชั่วคราว)
//   ต่อท้ายหลังตัดความยาว 200 ตัวอักษร = คำตัดสินไม่มีวันถูกตัดหาย · humanizeErr คืนข้อความนี้ทั้งก้อน (ไม่แปลงทับ)
// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F4): คำตัดสินของ route ต้องไม่สวนกับ worker + อาการเน็ตของ Windows/SSL ต้องเป็นชั่วคราว
//   (ก) ตัดหัวบรรทัด "ERROR: [ตัวดึง] <รหัส/ชื่อคลิป>: " ก่อนทดสอบคำชั่วคราว — ชื่อคลิป/เพจ เช่น "timeoutclips" เคยหลอกให้เป็นชั่วคราว
//   (ข) ชั่วคราว "เฉพาะเมื่อ" คำชั่วคราวตรง "และ" ไม่มีคำถาวรที่ worker เช็คก่อนด่านชั่วคราว (YTDLP_PERMANENT) — มี = ถาวร "กดใหม่ไม่ช่วย"
//       (เดิม "HTTP Error 502 … fragment not found" ได้ข้อความ "ลองใหม่ได้" แต่ worker เห็น not found ตัดสินถาวร = ข้อความสวนผล)
//       ตรวจคำถาวรทั้งบรรทัดที่แสดง (รวมหัวบรรทัด) = ชุดคำเดียวกับที่ worker เห็น — คำในหัวบรรทัดดันได้ทางเดียวคือ "ถาวร" (ฝั่งไม่ลองซ้ำ)
//       ใช้ "video unavailable" ตามคำของ worker — ห้าม unavailable เปล่า: "HTTP Error 503: Service Unavailable" = เว็บล่มชั่วคราว (ต้องลองใหม่)
//   (ค) อาการเน็ตที่หลุด whitelist เดิม: WinError 10050–10061 (เน็ตหลุด/ต่อไม่ติด/หมดเวลา) · forcibly closed · connection attempt failed
//       · UNEXPECTED_EOF / EOF occurred (SSL ถูกตัดกลางทาง) · RemoteDisconnected · IncompleteRead — ห้ามใส่ unavailable เป็นชั่วคราว
const YTDLP_TRANSIENT = /HTTP Error (429|5\d\d)|timed? ?out|temporar|connection (reset|refused|aborted)|network|getaddrinfo|ECONNRESET|EAI_AGAIN|Read timed out|WinError 100(5\d|6[01])|forcibly closed|connection attempt failed|UNEXPECTED_EOF|EOF occurred|RemoteDisconnected|IncompleteRead/i;
const YTDLP_PERMANENT = /unsupported|private|not\s?found|404|removed|deleted|video\s?unavailable|age.?restrict/i;
function _ytDlpFailure(e, timeoutMs = 180_000) {
  let err;
  if (e?.killed || e?.signal) {
    err = new Error(`yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: timeout ${Math.round(timeoutMs / 1000)} วิ) — ลองใหม่ได้ เดี๋ยวก็ผ่าน`);
  } else {
    const lines = String(e?.stderr ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const picked = lines.length
      ? (lines.filter((line) => /^ERROR:/.test(line)).pop() || lines[lines.length - 1])
      : `${e?.code ?? ''} ${e?.message ?? ''}`.trim().split(/\r?\n/)[0];
    const detail = String(picked || '')
      .replace(/Command failed:.*$/i, 'Command failed') // บรรทัดคำสั่งของ execFile (กรณี stderr ว่าง) — มีพาธ/อาร์กิวเมนต์/ลิงก์ทั้งหมด
      .replace(/https?:\/\/\S+/gi, '')   // ลิงก์ (มีรหัสวิดีโอเลขยาว)
      .replace(/[A-Za-z]:[\\/]\S*/g, '')  // พาธ Windows (ไฟล์ชั่วคราว · ตัว yt-dlp.exe)
      .replace(/(?<!WinError )\d{5,}/g, '…') // เลขยาว (รหัสวิดีโอ/เวลา) — กันเลข 503/429 โผล่บังเอิญ · ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F4-ค): เว้นรหัส WinError (100xx = อาการเน็ต)
      .replace(/\s+/g, ' ').trim();
    const shown = detail.slice(0, 200) || 'ไม่มีข้อความจาก yt-dlp';
    const spawnLocked = !lines.length && /spawn\b.*\b(EACCES|EBUSY)\b/i.test(String(picked || ''));
    const reason = detail.replace(/^ERROR: \[[^\]]+\] [^:]+: /, ''); // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F4-ก): ตัดหัวบรรทัด (ตัวดึง + รหัส/ชื่อคลิป) ก่อนทดสอบคำชั่วคราว
    err = spawnLocked || (YTDLP_TRANSIENT.test(reason) && !YTDLP_PERMANENT.test(detail)) // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F4-ข): มีคำถาวรของ worker = ถาวร
      ? new Error(`yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: ${shown}) — ลองใหม่ได้ เดี๋ยวก็ผ่าน`)
      : new Error(`yt-dlp โหลดวิดีโอไม่สำเร็จ: ${shown} — กดใหม่ไม่ช่วย`);
  }
  err.code = 'CLIP_DOWNLOAD_FAILED';
  return err;
}

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): เวลาที่ให้ yt-dlp โหลด 1 ครั้ง — env CLIP_YTDLP_TIMEOUT_MS
//   ค่าเริ่มต้น 180000 (3 นาที = เท่าเดิม) · กรอบ 30 วิ–30 นาที · ว่าง/ไม่ใช่ตัวเลข/≤0 = ค่าเริ่มต้น · อ่านใหม่ทุกครั้งที่โหลด
function _ytDlpTimeoutMs(env = process.env) {
  const n = Number(String(env?.CLIP_YTDLP_TIMEOUT_MS ?? '').trim() || NaN);
  if (!Number.isFinite(n) || n <= 0) return 180_000;
  return Math.min(1_800_000, Math.max(30_000, Math.round(n)));
}

// โหลดไฟล์วิดีโอ Facebook/IG/YouTube (yt-dlp) — เครื่องทีม Windows เท่านั้น
//   ★ 26 มิ.ย.: รับ fmt ได้ (YouTube ใช้ ≤480p กันไฟล์ใหญ่/อัปนาน · FB/IG ใช้ค่าเดิม)
async function downloadMetaBuffer(url, fmt) {
  if (process.platform !== 'win32') throw new Error('Facebook/IG/YouTube โหลดวิดีโอได้เฉพาะเครื่องทีม (Windows)');
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { readFile, mkdtemp, rm } = await import('fs/promises'); // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): โฟลเดอร์ชั่วคราวต่อการโหลด
  const { existsSync } = await import('fs');
  const execFileAsync = promisify(execFile);
  const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
  if (!existsSync(exe)) throw new Error('ไม่พบ bin/yt-dlp.exe — กดใหม่ไม่ช่วย'); // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R3): เครื่องไม่มีตัวโหลด = ถาวร
  const cookies = join(process.cwd(), 'bin', 'cookies.txt');
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): โฟลเดอร์ชั่วคราว "ต่อการโหลด 1 ครั้ง" แล้วลบทั้งโฟลเดอร์ใน finally เสมอ
  //   เดิมเขียน %TEMP%/meta_<เวลา>.mp4 แล้วลบแค่ไฟล์นั้น — yt-dlp ถูกฆ่าตอนหมดเวลาทิ้ง video.mp4.part / .f<รหัส>.* (DASH) / .ytdl ค้าง
  //   (คลิปยาวค้างครั้งละหลายร้อย MB และ retry แต่ละรอบเริ่มโหลดใหม่ตั้งแต่ต้นแล้วทิ้งเพิ่ม) · ตอนนี้ทุกไฟล์ของรอบนั้นอยู่ในโฟลเดอร์เดียว ลบทั้งก้อน
  const timeoutMs = _ytDlpTimeoutMs();
  const dir = await mkdtemp(join(tmpdir(), 'clipdl-'));
  const out = join(dir, 'video.mp4');
  // ★ 25 ส.ค. 69 (ยังไม่ push): --merge-output-format mp4 — จำเป็นเมื่อสูตรเป็น DASH (ภาพ+เสียงคนละสตรีม)
  //   ไม่กระทบกรณีไฟล์รวมอยู่แล้ว (yt-dlp ข้ามขั้นรวมเอง)
  const args = ['-f', fmt || 'mp4/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', out, '--no-warnings', '--no-playlist'];
  if (existsSync(cookies)) args.push('--cookies', cookies);
  args.push(url);
  try {
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R3): ห่อความพลาดของ yt-dlp (ตัดบรรทัดคำสั่ง/พาธชั่วคราว · errorType = CLIP_DOWNLOAD_FAILED)
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): เพดานเวลาจาก env (ส่งต่อให้ข้อความ "timeout N วิ" ตรงกับค่าที่ใช้จริง)
    await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout: timeoutMs }).catch((e) => { throw _ytDlpFailure(e, timeoutMs); });
    if (!existsSync(out)) throw new Error('โหลดวิดีโอ Meta ไม่สำเร็จ');
    const buf = await readFile(out);
    if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
    return buf;
  } finally {
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): ลบทั้งโฟลเดอร์ (.part/DASH/.ytdl)
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F1): บน Windows ตอนฆ่า yt-dlp เพราะหมดเวลา ตัว Python ลูกยังถือ video.mp4.part อีก 2–3 วิ
    //   → rm โดน EBUSY ทันที แล้ว .catch(() => {}) กลบเงียบ = โฟลเดอร์ clipdl-* ค้าง (ผู้ตรวจพิสูจน์บนเครื่องจริง 2/2)
    //   ให้ Node ลองลบซ้ำเอง (maxRetries 10 · รอเพิ่มทีละ 200ms ต่อรอบ = รวมสูงสุด ~11 วิ) · ลบไม่ได้จริงให้ log เตือน ไม่โยน
    //   (ความพลาดหลักของคำขอต้องไปถึงผู้ใช้ตามเดิม) · ยังไม่ฆ่าทั้งต้นไม้โปรเซส (taskkill) — งานต่อยอด
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      .catch((e) => console.warn('[clip-insight] ลบโฟลเดอร์ชั่วคราวไม่ได้:', e?.code || e?.message));
  }
}

// ★ 14 ส.ค. 69: Google ตัดสิทธิ์เส้น Files API (generateContent อ้างไฟล์ = 403 ทุกคีย์) เหลือแนบ inline ≤19MB —
//   คลิปใหญ่กว่านั้น (เจอจริง: FB 85MB) บีบอัดด้วย ffmpeg (แปลงไฟล์ธรรมดา ไม่ใช่ generative — ไม่ขัดกฎห้ามเจนภาพ)
//   ให้พอดีเพดานก่อนส่ง: 360p + บิตเรตคำนวณจากความยาวคลิป · ไม่มี ffmpeg/บีบแล้วยังเกิน → คืนไฟล์เดิม (เส้น Files API เดิม)
const INLINE_MAX_BYTES = 19 * 1024 * 1024;
async function _fitForInline(buf, url) {
  if (buf.length <= INLINE_MAX_BYTES) return buf;
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { writeFile, readFile, unlink } = await import('fs/promises');
    const execFileAsync = promisify(execFile);
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 }); // เช็คว่าเครื่องมี ffmpeg (PATH)
    const durSec = (await getClipDurationSec(url)) || 900; // หาความยาวไม่ได้ = เผื่อ 15 นาที
    const audioK = 48;
    const videoK = Math.max(60, Math.floor(((INLINE_MAX_BYTES * 8 * 0.93) / 1000) / durSec) - audioK);
    const inP = join(tmpdir(), `fit_in_${Date.now()}.mp4`);
    const outP = join(tmpdir(), `fit_out_${Date.now()}.mp4`);
    await writeFile(inP, buf);
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', inP, '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', `${videoK}k`, '-maxrate', `${videoK}k`, '-bufsize', `${videoK * 2}k`,
        '-c:a', 'aac', '-b:a', `${audioK}k`, '-ac', '1', '-movflags', '+faststart', outP],
        { timeout: 600_000, maxBuffer: 1024 * 1024 * 20 });
      const out = await readFile(outP);
      if (out.length >= 10000 && out.length <= INLINE_MAX_BYTES) {
        console.log(`[ClipInsight] 🗜️ บีบอัดคลิปใหญ่ ${(buf.length / 1e6).toFixed(1)}MB → ${(out.length / 1e6).toFixed(1)}MB (${videoK}k/360p ยาว ~${Math.round(durSec / 60)} นาที)`);
        return out;
      }
      console.warn(`[ClipInsight] 🗜️ บีบแล้วยังเกินเพดาน (${(out.length / 1e6).toFixed(1)}MB) → ใช้ไฟล์เดิม`);
      return buf;
    } finally { await unlink(inP).catch(() => {}); await unlink(outP).catch(() => {}); }
  } catch (e) {
    console.warn(`[ClipInsight] 🗜️ บีบอัดไม่ได้ (${String(e.message).slice(0, 60)}) → ใช้ไฟล์เดิม`);
    return buf;
  }
}

// ★ 24 มิ.ย.: หาความยาวคลิป (วินาที) ด้วย yt-dlp — ใช้ตัดสินใจ "คลิปยาว→แยกทุกประเด็น"
//   คืน 0 ถ้าหาไม่ได้ (ไม่มี yt-dlp/cloud) → ระบบจะใช้โหมด single (คลิปสั้น) เป็นค่าปลอดภัย ไม่ทำของเดิมพัง
async function getClipDurationSec(url) {
  try {
    if (process.platform !== 'win32') return 0;
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const execFileAsync = promisify(execFile);
    const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (!existsSync(exe)) return 0;
    const cookies = join(process.cwd(), 'bin', 'cookies.txt');
    const args = ['--no-warnings', '--no-playlist', '--get-duration'];
    if (existsSync(cookies)) args.push('--cookies', cookies);
    args.push(url);
    const { stdout } = await execFileAsync(exe, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const line = String(stdout).trim().split('\n').filter(Boolean).pop() || '';
    const parts = line.trim().split(':').map(n => parseInt(n, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    let sec = 0; for (const n of parts) sec = sec * 60 + (n || 0);
    return sec;
  } catch { return 0; }
}

/**
 * POST /api/clip-transcript/insight (16 มิ.ย. 69) — ถอดประเด็นข่าวจากคลิป → "ข้อมูลดิบ"
 *  • YouTube → Gemini ดูคลิปจริง (ภาพ+เสียง) | ล้ม → fallback ถอดเสียง + LLM
 *  • TikTok/FB → ถอดเสียง + LLM
 * ★ แยกจากเวิร์กโฟลว์ข่าว 100% — เรียกตัววิเคราะห์ตรงๆ ไม่แตะคิว/worker/ไลน์เขียน
 */
function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

// ★ 22 มิ.ย.: แปลง error ดิบให้คนเข้าใจ — กรณี Gemini แน่นชั่วคราว (503) บอกให้กดใหม่ ไม่ใช่ "parse ไม่ได้" งงๆ
// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F2): รับตัวเลือก { retrySafe } = ค่าที่ POST คำนวณแล้วว่าจะส่งให้ worker หรือไม่
//   ไม่ส่งตัวเลือก = ข้อความเดิมทุกตัวอักษร · ส่ง retrySafe:false = ข้อความที่ไม่สัญญาว่าระบบจะลองใหม่เอง (ตอนนี้ใช้ในสาขา state=PROCESSING)
function humanizeErr(raw, { retrySafe } = {}) {
  const m = String(raw || '');
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M1): ข้อความจากตัวโหลดคลิป (yt-dlp · tikwm) ตัดสินถาวร/ชั่วคราวไว้แล้วที่ต้นทาง → คืนทั้งก้อน ห้ามแปลง
  //   เดิมสาขาข้างล่างเขียนทับ: "Unsupported URL" → "Gemini เปิดดูคลิปนี้ไม่ได้" (โทษผิดตัว) · "(… timeout …)" → ข้อความเก่า ~4.5 นาที
  //   · "Video unavailable"/"rate limit" → "Gemini มีคนใช้งานหนัก" (คำตัดสินหาย worker ตีกลับด้าน) — ต้องอยู่ก่อนทุกสาขา
  if (/^(?:yt-dlp โหลดวิดีโอไม่สำเร็จ|tikwm)/.test(m)) return m;
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R5): ข้อความจากเส้น Files API (clipAI/geminiClient รอไฟล์ ACTIVE) ต้องมาก่อนสาขา timeout ทั่วไป
  //   เดิมถูกแปลงเป็นข้อความเก่า "ระบบขยายเวลาเป็น ~4.5 นาทีแล้ว" (ผิด) และคำว่า timeout หายไป — worker (isTransient) เลยพึ่งแค่ค่าเริ่มต้น
  //   ตอนนี้คงคำว่า timeout ให้ worker จับตรงๆ = ชั่วคราว (ล้มก่อนยิงโมเดล → route ติด retrySafe → ลองใหม่อัตโนมัติ)
  //   FAILED = ไฟล์บน Gemini เสีย ลองใหม่กี่ครั้งก็ไม่ผ่าน → คง "กดใหม่ไม่ช่วย" (worker นับเป็นถาวร)
  if (/state=PROCESSING/.test(m)) {
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L4): ถ้อยคำเป็นกลาง — รอบ 2 สัญญา "ระบบจะลองใหม่อัตโนมัติ" ทุกกรณี
    //   แต่ถอดตรง (ไม่ผ่านคิว) หรือเครื่องยนต์ใหม่จ่ายไปแล้ว (ไม่มี retrySafe) ระบบจะไม่ลองใหม่เอง · คงคำ timeout ให้ worker จับเป็นชั่วคราว
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F2): คำขอนี้ไม่ส่ง retrySafe (เครื่องยนต์ใหม่จ่ายแล้ว/ไม่รู้ยอด) → worker จะไม่ลองซ้ำแน่นอน
    //   ข้อความรอบ 3 ยังพูดว่า "ระบบจะลองใหม่ให้เอง" = สัญญาเกินจริง → บอกตรงๆ ว่าไม่ลองซ้ำเอง (กันจ่ายซ้ำ) ให้กดส่งใหม่เอง · คงคำ timeout
    if (retrySafe === false) return 'Gemini ใช้เวลาประมวลผลไฟล์วิดีโอนานเกินที่รอ (timeout) — ระบบไม่ลองซ้ำเอง (กันจ่ายซ้ำ) กดส่งใหม่เองได้';
    return 'Gemini ใช้เวลาประมวลผลไฟล์วิดีโอนานเกินที่รอ (timeout) — ถ้าส่งผ่านคิวเครื่องทีม ระบบจะลองใหม่ให้เอง · ถ้าถอดตรงให้กดส่งเข้าคิว';
  }
  if (/state=FAILED/.test(m)) {
    return 'Gemini ประมวลผลไฟล์วิดีโอไม่สำเร็จ (ไฟล์บน Gemini เสีย) — กดใหม่ไม่ช่วย ต้องโหลดคลิปใหม่หรือใช้คลิปอื่น';
  }
  // ★ 25 มิ.ย.: แยก 2 กรณีให้ผู้ใช้รู้ — (ก) ระบบเรา timeout เอง (คลิปยาว/ช้า)  (ข) Gemini แน่นจริง
  // (ก) timeout/deadline = คลิปยาวเกินเวลาที่ตั้ง (ไม่ใช่ Gemini ล่ม) → บอกตรงๆ + ทางออก
  if (/deadline|timed out|timeout|ETIMEDOUT|aborted|\b504\b/i.test(m)) {
    return 'คลิปนี้ยาว/ประมวลผลนานเกินเวลาที่ตั้งไว้ (ระบบขยายเวลาเป็น ~4.5 นาทีแล้ว) — ลองกด "ถอดประเด็นข่าว" อีกครั้ง · ถ้าคลิปยาวมาก (เกิน ~15 นาที) แนะนำกด "ส่งเข้าคิว (เครื่องทีม)" ที่ให้เวลานานกว่า';
  }
  // (ข2) Gemini เปิดดูคลิปไม่ได้จริง (ส่วนตัว/จำกัดอายุ/ลิงก์เสีย) — กดใหม่ไม่ช่วย
  if (/ดูคลิปไม่ได้|ส่วนตัว|private|age.?restrict|จำกัดอายุ|unsupported|ไม่ส่งข้อมูล/i.test(m)) {
    return 'Gemini เปิดดูคลิปนี้ไม่ได้ (อาจเป็นคลิปส่วนตัว/จำกัดอายุ/ลิงก์มีปัญหา) — ลองเช็คว่าคลิปเปิดสาธารณะ หรือใช้คลิปอื่น';
  }
  // (ข) Gemini แน่น/ล่มชั่วคราว (503/429/overload) → รอแล้วกดใหม่ (ระบบใช้ Gemini ดูคลิปจริงเท่านั้น เพื่อคุณภาพสูงสุด)
  //   ★ 26 มิ.ย. (ผู้ใช้สั่ง): ไม่ถอย fallback OpenAI — รอ Gemini ดูคลิปจริงดีกว่า (ข้อมูลดิบดีกว่ามาก)
  if (/503|429|high demand|overload|unavailable|temporar|rate limit|parse ไม่ได้/i.test(m)) {
    return 'ตอนนี้ Gemini มีคนใช้งานหนัก (แน่นชั่วคราว) — กดปุ่ม "ถอดประเด็นข่าว" อีกครั้งได้เลย เดี๋ยวก็ผ่าน (ระบบรอ Gemini ดูคลิปจริงเพื่อข้อมูลดิบคุณภาพสูงสุด ไม่ถอยไปสรุปจากเสียงล้วน)';
  }
  return m.slice(0, 300) || 'ถอดประเด็นล้มเหลว'; // ★ 14 ส.ค. 69: 120→300 — error สั้นเกินจนวินิจฉัยเคสโมเดลใหม่ไม่ได้
}

// ★ 21 มิ.ย. (บั๊ก: URL ติด &fbclid=... ยาว → Gemini ดูคลิปไม่ได้): ล้าง URL ให้สะอาด
//   YouTube → ดึง video ID สร้าง watch URL ใหม่ (กันพารามิเตอร์เฟซบุ๊ก/ติดตามทำพัง) · อื่นๆ → ตัด tracking params
export function cleanClipUrl(raw) {
  const u = String(raw || '').trim();
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R7): รหัส 11 ตัว "พอดี" เหมือน clipAgent/clipUrl.js ทุกตัวอักษร (สำเนา 3 ที่ต้องตรงกัน)
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;
  try {
    const url = new URL(u);
    ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'app_id', '_aem', 'mibextid'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u.split('#')[0]; }
}

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ติดธง "ยังไม่ได้ยิง AI" ให้ความพลาดช่วงโหลดคลิป (ยังไม่จ่ายค่าโมเดลเลย)
//   POST ส่ง retrySafe ต่อให้ worker ลองใหม่อัตโนมัติได้โดยไม่จ่ายซ้ำ (ควรลองไหมยังตัดสินที่ isTransient ของ worker เหมือนเดิม)
function _markRetrySafe(e) {
  const err = e instanceof Error ? e : new Error(String(e?.message || e || 'โหลดคลิปไม่สำเร็จ'));
  try { err.retrySafe = true; } catch { /* error แช่แข็ง — ไม่ติดธง = ไม่ลองซ้ำอัตโนมัติ (ฝั่งปลอดภัย) */ }
  return err;
}

/**
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89): โหลดคลิป TikTok/FB/IG + บีบให้พอดีแนบตรง "ครั้งเดียวต่อคำขอ"
 *   เดิมประตูถอดไม่เคยส่งไฟล์ให้เครื่องยนต์ใหม่ (videoBuffer = undefined → BAD_INPUT 0 token)
 *   → คลิป FB/IG/TikTok ตกเครื่องยนต์เดิม 100% (528/528 ใบ) · ตอนนี้โหลดที่นี่ที่เดียว แล้วส่งไฟล์เดียวกันให้ทั้งสองเครื่องยนต์
 *   โหลด (yt-dlp/tikwm) หรือบีบล้ม = ยังไม่ได้ยิง AI → ติดธง retrySafe ที่นี่ (ประตูถอดห้ามมีตัวจับ error — ด่านเทสกันยิงซ้ำ)
 *   🔴 วางไว้ก่อนตัวโหลด YouTube ตั้งใจ: ช่วงตัวโหลด YouTube → ประตูถอด มีด่านเทสห้ามยิง Gemini และต้องคืน null
 */
async function _loadClipBuffer(url, type) {
  try {
    const raw = type === 'tiktok' ? await downloadTiktokBuffer(url) : await downloadMetaBuffer(url);
    return await _fitForInline(raw, url); // >19MB บีบก่อน · บีบไม่ลง = คืนไฟล์เดิม (เดินเส้น Files API)
  } catch (e) {
    throw _markRetrySafe(e);
  }
}

async function transcribeFor(url, type) {
  if (type === 'youtube') {
    const { transcribeYoutube } = await import('@/lib/services/youtubeService');
    const r = await transcribeYoutube({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'tiktok') {
    const { transcribeTiktok } = await import('@/lib/services/tiktokService');
    const r = await transcribeTiktok({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'meta') {
    const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
    const r = await transcribeMetaReel({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  return '';
}

/**
 * ★ 27 ส.ค. 69: โหลดคลิป YouTube บนเครื่องทีม — สำเร็จคืนไฟล์ · ล้มคืน null (ไม่โยน)
 *
 * เจอสดตอนตรวจระบบ: YouTube ขึ้นด่านกันบอท ("Sign in to confirm you're not a bot")
 * yt-dlp โหลดไม่ได้เลยทุกลิงก์ ทั้งที่ 3 ชม.ก่อนยังปกติ → งานคลิป YouTube ล้มหมด
 * แต่เส้น "ให้ Gemini ดูลิงก์เอง" ยังทำงานได้ (ทดสอบยิงจริงผ่าน) → ใช้เป็นเส้นสำรอง
 *
 * 🔴 ทำไมต้องแยกออกมาเป็นฟังก์ชันนี้: buildInsight ห้ามมี try/catch (ด่านของผู้ตรวจกันยิง Gemini
 *    ซ้ำสองรอบในคำขอเดียว = จ่ายเงินซ้ำ) · ตัวนี้จับเฉพาะ "ความพลาดตอนโหลดไฟล์" ซึ่งยังไม่ได้ยิง
 *    Gemini เลยแม้แต่ครั้งเดียว จึงไม่ขัดกฎนั้น
 */
async function _tryDownloadYouTube(url, fmt) {
  try {
    return await _fitForInline(await downloadMetaBuffer(url, fmt), url);
  } catch (dlErr) {
    console.warn('[clip-insight] โหลด YouTube บนเครื่องทีมไม่สำเร็จ → ถอยไปให้ Gemini ดูลิงก์เอง:',
      String(dlErr?.message || dlErr).slice(0, 160));
    return null;
  }
}

// ★ 22 มิ.ย.: รวมตรรกะสกัด "ข้อมูลดิบ" ไว้ในฟังก์ชันเดียว (ดูคลิป→fallback ถอดเสียง) — โยน error ที่มี .code
//   เพื่อให้ห่อด้วยคิวได้สะอาด (ไม่ปน NextResponse กับงานหนัก)
// ★ 14 ส.ค. 69 (เจ้าของสั่งเทียบสองโมเดล): model (optional) — ไม่ส่ง = VIDEO_MODEL ตามเดิมเป๊ะ
/**
 * 🚪 ประตูเดียวของการถอดคลิป — เครื่องยนต์ใหม่ก่อน ล้มแล้วถอยไปเครื่องยนต์เดิม
 *   (เจ้าของสั่ง 27 ส.ค. 69) · หนึ่งคำขอ = เริ่มงานที่นี่ครั้งเดียวเท่านั้น
 */
async function buildInsightWithBrain({ url, type, model = '', durationSec = 0, acc = null }) {
  const brainOn = _brainPipelineEnabled(durationSec);
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): TikTok/FB/IG โหลด+บีบ "ครั้งเดียว" แล้วส่งไฟล์เดียวกันให้ทั้งสองเครื่องยนต์ (ห้ามโหลดซ้ำ)
  //   ล้มตอนโหลด = error ติดธง retrySafe มาจากตัวโหลดเอง (ที่นี่ห้ามมีตัวจับ error) · YouTube คงเดิม (เครื่องยนต์ใหม่ใช้ลิงก์)
  const videoBuffer = type === 'youtube' ? undefined : await _loadClipBuffer(url, type);
  if (brainOn) {
    if (videoBuffer && videoBuffer.length > INLINE_MAX_BYTES) {
      // เครื่องยนต์ใหม่รับไฟล์แนบตรง ≤19MB เท่านั้น — คลิปยาวที่บีบไม่ลง ต้องไปเครื่องยนต์เดิมที่เดินเส้น Files API ได้
      console.warn(`[clip-insight] ข้ามเครื่องยนต์ใหม่: ไฟล์ >19MB (${(videoBuffer.length / 1e6).toFixed(1)}MB) ต้องเดิน Files API → ใช้เครื่องยนต์เดิม`);
    } else {
      const fromBrain = await _tryBrainPipeline({ url, type, model, durationSec, videoBuffer, acc });
      if (fromBrain) return fromBrain;                       // ✅ เครื่องยนต์ใหม่สำเร็จ
    }
  }
  const legacy = await buildInsight({ url, type, model, videoBuffer }); // 🔁 ตัวสำรอง = เครื่องยนต์เดิม (ไฟล์เดียวกัน)
  if (legacy && typeof legacy === 'object' && brainOn) {
    legacy.brainFallback = true;   // ติดธงให้รู้ว่ารอบนี้ไม่ได้ผ่านการตรวจสอบ
  }
  return legacy;
}

async function buildInsight({ url, type, model = '', videoBuffer = null }) { // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): รับไฟล์ที่ผู้เรียกโหลดแล้ว (ข้อ 1)
  // ★ 25 มิ.ย.: ใช้ insight เดียว (enhanced) เสมอ — Gemini "ตัดสินเอง" (content-aware) ว่าคลิปมีหลายประเด็นไหม
  //   มีหลายประเด็น → ใส่ subStories (เนื้อดิบแยกประเด็น) เพิ่มจาก rawData รวม · เรื่องเดียว → subStories ว่าง
  //   เลิกพึ่ง getClipDurationSec (ยึด yt-dlp = พังบนคลาวด์ → เคยได้ single เสมอ) — ตอนนี้ทำงานทั้ง cloud+โลคัล
  // ★ 26 มิ.ย. (ผู้ใช้สั่ง): ใช้ "Gemini ดูคลิปจริง" เท่านั้น — ปิด fallback ถอดเสียง+OpenAI
  //   เหตุผล: Gemini ดูคลิป (เห็นภาพ+ตัวหนังสือบนจอ+ฟังเสียง) ถอดข้อมูลดิบมีประสิทธิภาพกว่ามาก
  //   ถ้า Gemini แน่น → โยน error ให้ผู้ใช้ "รอ/กดใหม่" ดีกว่าได้ผลด้อยจาก transcript ล้วน
  //   (ฟังก์ชัน transcript ยังอยู่ในโค้ด เผื่อเปิดใช้ภายหลัง — แค่ไม่เรียกในเส้นทาง insight)
  if (type === 'youtube') {
    // หนึ่งคำขอเลือกทางเดียวเท่านั้น เพื่อไม่ให้ URL inference และ file inference ซ้อนกัน:
    //   - Windows ทีมงาน: โหลดคลิปแล้วส่งไฟล์ให้ Gemini หนึ่งครั้ง
    //   - cloud: ส่ง URL ให้ Gemini หนึ่งครั้ง
    // ★ 25 ส.ค. 69 (ยังไม่ push): YouTube เลิกให้ไฟล์รวมภาพ+เสียงในไฟล์เดียว (เหลือ 360p ที่ตอนนี้ 403)
    //   สูตรเดิม (best[...] ล้วน) จึงตายด้วย "Requested format is not available" — ยิงจริงตาย 15/15 ลิงก์
    //   → เติมท่า DASH (bv*+ba = โหลดภาพกับเสียงแยกแล้วรวมด้วย ffmpeg) ไว้หน้าสุด
    //   ⚠️ ต้องใช้คู่กับ yt-dlp ≥ 2026.08 (เครื่องทีม runtime-r133 อัปแล้ว 25 ส.ค. · สำรอง .bak-2026aug25)
    const YT_FMT = 'bv*[height<=480]+ba/b[height<=480]/bv*+ba/b';
    const urlPassthrough = () => extractClipInsight({ url, platform: 'youtube', ...(model ? { model } : {}) });
    // ★ 27 ส.ค. 69 (เจอสดตอนตรวจระบบ): YouTube ขึ้นด่านกันบอท — yt-dlp บนเครื่องทีมโหลดไม่ได้เลย
    //   ("Sign in to confirm you're not a bot") ทั้งที่ก่อนหน้า 3 ชม. ยังโหลดได้ปกติ
    //   แต่เส้น URL passthrough (ให้ Gemini ดูลิงก์เอง) **ยังทำงานได้** — ทดสอบยิงจริงผ่าน
    //   → เครื่องทีมโหลดพลาดเมื่อไหร่ ให้ถอยไปใช้ URL passthrough แทน ห้ามล้มทั้งงาน
    //   (YouTube เป็นแพลตฟอร์มเดียวที่มีเส้นสำรองแบบนี้ · FB/IG/TikTok ไม่มี)
    if (process.platform === 'win32') {
      // 🔴 กฎเดิมที่ห้ามผิด: หนึ่งคำขอ = ยิง Gemini ครั้งเดียว (ห้ามยิงไฟล์แล้วยิง URL ซ้ำ = จ่ายสองรอบ)
      //    ตัวจับความพลาดของ "การโหลดไฟล์" อยู่ใน _tryDownloadYouTube (นอกฟังก์ชันนี้) เพื่อไม่ให้มี
      //    try/catch ในเส้นตัดสินใจนี้เลย — ด่านของผู้ตรวจที่ห้าม catch จึงยังทำงานเหมือนเดิมทุกประการ
      const buf = await _tryDownloadYouTube(url, YT_FMT);
      if (buf) return await extractInsightFromVideoBuffer(buf, 'video/mp4', model); // ยิง Gemini ครั้งเดียว
      const out = await urlPassthrough();                                           // โหลดพลาด = ยังไม่เคยยิง → ยิงครั้งเดียวเช่นกัน
      if (out && typeof out === 'object') out.degradedTo = 'url-passthrough';        // ให้ใบงานรู้ว่าใช้เส้นสำรอง
      return out;
    }
    return await urlPassthrough(); // cloud: URL passthrough เท่านั้น
  }
  // TikTok/FB/IG → โหลดไฟล์ให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) — ไม่มี fallback ถอดเสียง
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ใช้ไฟล์ที่ผู้เรียกโหลด+บีบมาแล้ว (ห้ามโหลดซ้ำ) · ไม่ส่งมา = โหลดเองเหมือนเดิม
  //   (★ 14 ส.ค.: >19MB บีบก่อนแนบ inline — ขั้นบีบอยู่ใน _loadClipBuffer)
  const buf = videoBuffer || await _loadClipBuffer(url, type);
  return await extractInsightFromVideoBuffer(buf, 'video/mp4', model);
}

/**
 * 🧠 เครื่องยนต์ใหม่เป็นตัวหลัก · เครื่องยนต์เดิมเป็นตัวสำรองอัตโนมัติ (เจ้าของสั่ง 27 ส.ค. 69)
 *   "เสียบโค้ดใหม่ให้รันได้เลย แต่เอาเครื่องยนต์เดิมเป็นตัวสำรอง เวลามีปัญหาให้กลับไปเหมือนเดิมก่อน"
 *
 * สวิตช์ (ตั้งใน .env.local):
 *   CLIP_BRAIN_PIPELINE=0        ปิดเครื่องยนต์ใหม่ทั้งหมด → กลับไปใช้ของเดิม 100% (ถอยฉุกเฉิน)
 *   CLIP_BRAIN_MIN_SEC=600       ใช้เครื่องยนต์ใหม่เฉพาะคลิปยาวเกินกี่วินาที (ค่าเริ่มต้น 0 = ทุกคลิป)
 *
 * 🔴 ตัวสำรองทำงานเมื่อ: เครื่องยนต์ใหม่คืน ok:false ทุกกรณี (โควตาหมด · เซิร์ฟเวอร์ล่ม · โหลดคลิปพลาด ฯลฯ)
 *    ผลจากเครื่องยนต์เดิมจะติดธง brainFallback ไว้ให้รู้ว่ารอบนี้ไม่ได้ผ่านการตรวจสอบ
 */
function _brainPipelineEnabled(durationSec) {
  if (process.env.CLIP_BRAIN_PIPELINE === '0') return false;
  const min = parseInt(process.env.CLIP_BRAIN_MIN_SEC || '0', 10);
  if (Number.isFinite(min) && min > 0) {
    const d = Number(durationSec) || 0;
    if (d > 0 && d < min) return false;   // คลิปสั้นกว่าเกณฑ์ → ใช้ของเดิม (ประหยัด)
  }
  return true;
}

/** เรียกเครื่องยนต์ใหม่แบบไม่โยน — สำเร็จคืน insight · ล้มคืน null (ให้ผู้เรียกถอยไปของเดิม) */
// ★ 30 ก.ย. 69 (เคสล่ม pepedog89): จดโทเคนที่เครื่องยนต์ใหม่ใช้ไปก่อนล้มลง acc.brainSpentTokens
//   POST ใช้ตัดสิน retrySafe — ใช้ไป > 0 = อาจจ่ายค่าโมเดลแล้ว ห้ามให้ worker ลองซ้ำอัตโนมัติ
//   ยอดเพี้ยน/พังผิดคาด (ไม่รู้ยอด) = จด -1 ถือว่าอาจจ่ายแล้ว (ฝั่งปลอดภัย)
// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R2): ยอดที่ใช้ตัดสิน = บิลจริง ไม่ใช่ spentTokens อย่างเดียว
//   spentTokens (= brain.costs) นับเฉพาะรอบที่ "รับผล" และ >100 token → รอบที่ถูกบิลแต่ล้ม (MAX_TOKENS/BAD_JSON/หมดเวลาฝั่งเรา) นับ 0
//   brain.usage.totalTokens รวม "ทุก attempt" ที่ Gemini คืน usage (= บิลจริงรวม retry — clipBrainPipeline.js onUsage)
//   ยอดบิล 0 จะนับว่า "ยังไม่จ่าย" (จด 0) เฉพาะล้มก่อนถึงผู้ให้บริการ (ไม่มีคีย์/ไฟล์เสีย/ใหญ่เกิน/ไม่มีต้นทาง)
//   ล้มแบบอื่นโดยไม่มี usage (เน็ตหลุด/หมดเวลาระหว่างรอคำตอบ) = อาจถูกบิลแล้ว → จด -1 ห้าม retrySafe
async function _tryBrainPipeline({ url, type, model, durationSec, videoBuffer, acc = null }) {
  try {
    const { runClipBrainPipeline } = await import('@/lib/services/clipBrain/clipBrainPipeline');
    const r = await runClipBrainPipeline({
      url, isYouTube: type === 'youtube', videoBuffer, durationSec, model, caption: '',
    });
    if (r.ok && r.insight) return r.insight;
    const billed = Math.max(Number(r.spentTokens) || 0, Number(r.brain?.usage?.totalTokens) || 0);
    const PRE_PROVIDER = new Set(['BAD_INPUT', 'TOO_LARGE', 'NO_KEY', 'PIPE_NO_SOURCE']);
    if (acc) acc.brainSpentTokens = billed > 0 ? billed : (PRE_PROVIDER.has(String(r.errorType)) ? 0 : -1);
    console.warn(`[clip-insight] เครื่องยนต์ใหม่ล้ม (${r.errorType}) ใช้ไป ${billed} token (บิลรวมทุกรอบ) → ถอยไปเครื่องยนต์เดิม:`,
      String(r.error || '').slice(0, 160));
    return null;
  } catch (e) {
    if (acc) acc.brainSpentTokens = -1; // ไม่รู้ว่าใช้ไปเท่าไร → ถือว่าอาจจ่ายแล้ว
    console.warn('[clip-insight] เครื่องยนต์ใหม่พังผิดคาด → ถอยไปเครื่องยนต์เดิม:', String(e?.message || e).slice(0, 160));
    return null;
  }
}

// ★ (เลิกใช้ชั่วคราว 26 มิ.ย. — เก็บไว้เผื่อเปิด fallback ถอดเสียงภายหลัง)
async function _buildInsightTranscriptFallback({ url, type }) {
  const rawText = await transcribeFor(url, type);
  if (!rawText || rawText.length < 40) {
    const e = new Error('ดูคลิป/ถอดเสียงไม่สำเร็จ — คลิปอาจไม่มีเสียง หรือ Facebook/IG ทำได้เฉพาะเครื่องทีม'); e.code = 'CLIP_FAILED'; throw e;
  }
  return await extractClipInsight({ url, platform: 'transcript', rawText });
}

// ★ 8 ก.ค.: ด่านตรวจคุณภาพก่อนเก็บคลัง — เช็คง่ายๆ ไม่เรียก AI (เคยมีเคส rawData ว่าง 0 ตัวอักษรหลุดเข้าคลัง
//   จาก JSON ถูกตัดท้ายแล้วซ่อมไม่ครบ) — คืน [] = ผ่าน, ไม่ผ่านคืนรายการปัญหา
const RAWDATA_MIN_CHARS = 300;
function insightQualityIssues(insight) {
  const issues = [];
  const raw = String(insight?.rawData || '');
  if (raw.length < RAWDATA_MIN_CHARS) issues.push(`เนื้อดิบสั้นผิดปกติ (${raw.length} ตัวอักษร)`);
  if (!String(insight?.headline || '').trim()) issues.push('ไม่มีหัวข้อข่าว');
  return issues;
}

export async function POST(request) {
  try {
    // ★ 8 ก.ค.: รับเพิ่ม force (ถอดใหม่ ไม่เอาผลจากคลัง) + user (ใครส่ง — เก็บเป็น metadata คลัง)
    // ★ 14 ส.ค. 69 (เจ้าของสั่งเทียบสองโมเดล): model (optional) — ใช้คู่ force เสมอ (คลังกันซ้ำไม่แยกตามโมเดล)
    //   จำกัด allowlist เพราะ endpoint เปิดรับจากภายนอก · ค่านอกรายการ = เพิกเฉย ใช้โมเดลหลักตามเดิม ไม่ล้มคำขอ
    const { url: _rawUrl, force = false, user = '', model: _reqModel = '' } = await request.json();
    const MODEL_ALLOWED = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'];
    const modelOverride = MODEL_ALLOWED.includes(String(_reqModel)) ? String(_reqModel) : '';
    if (_reqModel && !modelOverride) console.warn(`[ClipInsight] ⚠️ model นอกรายการ "${String(_reqModel).slice(0, 30)}" → ใช้โมเดลหลักตามเดิม`);
    if (!_rawUrl || typeof _rawUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ดึงลิงก์แรกลิงก์เดียวก่อนล้าง (ลิงก์ซ้อน 2 รอบ/มีข้อความปน)
    //   ไม่เจอ http(s):// = ใช้ข้อความเดิม (ลิงก์ YouTube ที่วางโดยไม่มี https ยังล้างได้เหมือนเดิม)
    const url = cleanClipUrl(extractFirstUrl(_rawUrl) || _rawUrl); // ★ ล้าง fbclid/tracking ก่อน (กัน Gemini ดูคลิปพัง)
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    // ★ 8 ก.ค.: dedup ข้ามเวลา — คลิปนี้เคยถอดสำเร็จแล้ว (คุณภาพผ่านเกณฑ์) → คืนผลเดิมทันที ฟรี+เร็ว
    //   (เดิมกันซ้ำแค่งานที่ยังรันอยู่ 3 ชม. — กดซ้ำ/ส่งซ้ำคนละวัน = จ่ายค่า Gemini ดูคลิปเดิมเต็มราคา)
    //   force=true (ปุ่ม "ถอดใหม่" ใน UI) → ข้ามคลัง ถอดสดเสมอ
    if (!force) {
      try {
        const store = createStore('clip-insights');
        const all = await store.getAll();
        const hit = all
          .filter(c => c.url === url && !c.lowQuality && String(c.insight?.rawData || '').length >= RAWDATA_MIN_CHARS)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        if (hit) {
          console.log(`[ClipInsight] ⚡ ผลจากคลัง (เคยถอดแล้ว ${hit.createdAt}): ${url.slice(0, 60)}`);
          return NextResponse.json({ success: true, data: { id: hit.id, platform: hit.platform, ...hit.insight, cached: true, cachedAt: hit.createdAt } });
        }
      } catch (e) { console.warn('[ClipInsight] เช็คคลัง dedup ล้ม (ถอดสดตามปกติ):', e.message?.slice(0, 50)); }
    }

    console.log(`[ClipInsight] ${type}: ${url.slice(0, 80)}`);

    // ★ 22 มิ.ย.: ผ่าน "คิวงานหนัก" — กันยิง Gemini/Whisper ซ้อนกัน + เว้นช่วงอัตโนมัติเมื่อ API แน่น
    const startedAt = Date.now();
    let insight;
    const attempts = 1;
    // ความยาวคลิป — ใช้เฉพาะตอนตั้งเกณฑ์ CLIP_BRAIN_MIN_SEC เท่านั้น (ไม่ตั้ง = ไม่ต้องเสียเวลาถาม yt-dlp)
    //   รู้ไม่ได้ = 0 → ปล่อยผ่านเข้าเครื่องยนต์ใหม่ (มันถามความยาวจาก AI เองอยู่แล้ว)
    let durationSec = 0;
    if (parseInt(process.env.CLIP_BRAIN_MIN_SEC || '0', 10) > 0) {
      durationSec = await getClipDurationSec(url).catch(() => 0);
    }
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): สมุดจดของคำขอนี้ — เครื่องยนต์ใหม่ใช้โทเคนไปเท่าไรก่อนล้ม (ใช้ตัดสิน retrySafe ด้านล่าง)
    const acc = { brainSpentTokens: 0 };
    try {
      insight = await getClipVideoQueue().run(() => buildInsightWithBrain({ url, type, model: modelOverride, durationSec, acc }), { label: `insight:${type}${modelOverride ? `@${modelOverride}` : ''}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): บอก worker ว่า "ล้มก่อนจ่ายค่าโมเดล" → ลองใหม่อัตโนมัติได้โดยไม่จ่ายซ้ำ
      //   ต้องครบสองข้อ: error ติดธงจากต้นทาง (โหลดคลิป/อัปโหลด/รอ Gemini ประมวลผล) + เครื่องยนต์ใหม่ยังไม่ใช้โทเคน
      //   เดิมไม่มี route ไหนตั้ง retrySafe → retry อัตโนมัติของ worker ไม่เคยเกิดจริง (log ตั้งแต่ 22 ส.ค. retry 0 ครั้ง)
      //   กรณีอื่นไม่ใส่ field นี้เลย (worker อ่านไม่เจอ = ไม่ลองซ้ำ)
      const retrySafe = e?.retrySafe === true && acc.brainSpentTokens === 0;
      // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F2): ข้อความเลือกจาก retrySafe ที่คำนวณแล้ว (ไม่ส่ง = ไม่สัญญาว่าระบบจะลองใหม่ให้เอง)
      return NextResponse.json({ success: false, error: humanizeErr(e.message, { retrySafe }), errorType: code, ...(retrySafe ? { retrySafe: true } : {}) }, { status: 422 });
    }

    // ด่านตรวจคุณภาพแบบไม่เสียรอบเพิ่ม: ผลไม่ครบให้ติดธงไว้ พนักงานเป็นผู้ตัดสินใจกดถอดใหม่เอง
    // ห้ามเริ่ม Gemini รอบสองอัตโนมัติ เพราะงานรอบแรกอาจจ่ายค่า inference ไปแล้ว
    let lowQuality = false, qualityNote = '';
    const issues = insightQualityIssues(insight);
    if (issues.length) {
      lowQuality = true;
      qualityNote = `ผลอาจไม่สมบูรณ์: ${issues.join(' · ')} — กรุณาตรวจหรือกดถอดใหม่เอง`;
      console.warn(`[ClipInsight] ⚠️ เก็บแบบติดธง lowQuality: ${qualityNote}`);
    }

    // เก็บเข้าคลังประเด็น (fire-and-forget) — ★ 8 ก.ค.: ขยาย 60→400 เคส (เดิมคลังหมุนทิ้งทุก ~2 วัน
    //   ประวัติเคสข่าวปังหายหมด) + เก็บ metadata (หมวด/ความยาวคลิป/ผู้ส่ง/เวลาถอด) + สำเนาถาวร NDJSON
    const caseId = randomUUID();
    const elapsedMs = Date.now() - startedAt;
    const record = {
      id: caseId, url, platform: type,
      // ★ 25 ส.ค. 69: 80→300 (เจ้าของสั่งปลดข้อจำกัดความยาวข้อความ) — พาดหัวยาวถูกตัดกลางคำในหน้าคลัง
      title: (insight.headline || insight.overview || url).slice(0, 300),
      insight,
      category: insight.category || '', clipDurationSec: insight.clipDurationSec || 0,
      user: String(user || '').slice(0, 40), elapsedMs, attempts,
      ...(modelOverride ? { modelUsed: modelOverride } : {}), // ★ 14 ส.ค.: ใบเทสโมเดลระบุรุ่นที่ใช้จริง (ไม่ส่ง = โมเดลหลัก)
      ...(lowQuality ? { lowQuality: true, qualityNote } : {}),
      createdAt: new Date().toISOString(),
    };
    (async () => {
      try {
        const store = createStore('clip-insights');
        await store.add(record);
        const all = await store.getAll();
        // ★ 15 ส.ค. 69 (เจ้าของสั่ง "เก็บทุกบทความที่พนักงานถอด"): ใบที่พนักงานปักหมุด "ใช้ใบนี้" ห้ามลบ
        //   กติกาอยู่ที่ clipArchive.pickCasesToPurge (มีเทสคุม กันหลุดซ้ำแบบตอนย้อนยุคนิ่ง 14 ส.ค.)
        for (const o of pickCasesToPurge(all, CLIP_CASE_KEEP)) await store.remove(o.id).catch(() => {});
      } catch (e) { console.warn('[ClipInsight] เก็บคลังล้ม:', e.message?.slice(0, 50)); }
      // ★ สำเนาถาวร append-only (ไม่ถูกลบตาม retention — ไว้วิเคราะห์ย้อนหลัง/ลูปเรียนรู้ในอนาคต)
      //   เขียนได้เฉพาะเครื่องที่มีดิสก์จริง (เครื่องทีม ~82% ของงาน) — บน Vercel จะเงียบๆ ข้ามไป ไม่กระทบงานหลัก
      try {
        const { appendFile } = await import('fs/promises');
        const { join } = await import('path');
        await appendFile(join(process.cwd(), 'data', 'clip-insights-archive.ndjson'), JSON.stringify(record) + '\n', 'utf8');
      } catch { /* Vercel filesystem อ่านอย่างเดียว — ข้าม */ }
      // ★ 15 ส.ค. 69 (เจ้าของสั่ง) — สำเนาถาวรบนคลาวด์ ให้ "ถอดผ่านเว็บ" ก็ไม่หายเหมือนกัน
      //   ที่มา: สำเนา NDJSON ข้างบนเขียนได้เฉพาะเครื่องที่มีดิสก์จริง → งานที่ถอดผ่าน Vercel ไม่มีสำเนาเลย
      //   วัดจริง 15 ส.ค.: คลังหลัก 400 ใบ แต่ NDJSON มีแค่ 125 ใบ = ส่วนต่างคืองานที่ถอดผ่านเว็บแล้วหลุดคลังไป
      //   เขียนตรงเข้าตารางกลาง ไม่ผ่าน createStore ตั้งใจ — createStore.add() จะ sync ไฟล์แคชทั้งก้อนทุกครั้ง
      //   (คลังโตขึ้นเรื่อยๆ = เขียนไฟล์ใหญ่ขึ้นทุกใบ) และไม่มีการ getAll() ที่นี่เลย → ค่า egress คงที่ต่อใบ
      //   ล้มยังไงก็ไม่กระทบผลถอด (fire-and-forget + try/catch) · ปิดได้ด้วย CLIP_ARCHIVE_CLOUD=0
      if (process.env.CLIP_ARCHIVE_CLOUD !== '0') {
        try {
          const { getSupabase, isSupabaseReady } = await import('@/lib/supabase');
          if (isSupabaseReady()) {
            // 🔴 id ต้องไม่ซ้ำใบจริง — กติกา + เหตุผลอยู่ที่ clipArchive.archiveRowId (มีเทสคุม)
            const { error } = await getSupabase().from('store_items').insert({
              id: archiveRowId(caseId), store_name: CLIP_ARCHIVE_STORE, data: record,
              created_at: record.createdAt, updated_at: record.createdAt,
            });
            if (error) console.warn('[ClipInsight] สำเนาถาวรคลาวด์ล้ม:', error.message?.slice(0, 60));
          }
        } catch (e) { console.warn('[ClipInsight] สำเนาถาวรคลาวด์ล้ม:', e.message?.slice(0, 60)); }
      }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, ...insight, ...(modelOverride ? { modelUsed: modelOverride } : {}), ...(lowQuality ? { lowQuality: true, qualityNote } : {}) } });
  } catch (error) {
    console.error('[ClipInsight]', error.message);
    return NextResponse.json({ success: false, error: humanizeErr(error.message), errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
