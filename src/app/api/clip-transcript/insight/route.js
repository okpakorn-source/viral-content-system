export const maxDuration = 800; // เผื่อดาวน์โหลด/บีบ/อัปโหลดคลิปยาว แต่ inference ถอดคลิปถูกล็อกไว้หนึ่งครั้งต่อคำขอ
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
import { pickCasesToPurge, CLIP_CASE_KEEP, archiveRowId, CLIP_ARCHIVE_STORE } from '@/lib/services/clipArchive';
import { extractFirstUrl } from '@/lib/services/clipAgent/clipUrl'; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ดึงลิงก์แรก (ข้อ 4)
import { randomUUID } from 'crypto';

// โหลดไฟล์วิดีโอ TikTok (tikwm) — ใช้บนคลาวด์ได้
//   ★ 25 ต.ค. 69 (เครื่องยนต์ช่องเดียว): ส่ง meta มาด้วย = เก็บชื่อคลิปกับความยาวที่ tikwm ให้มาอยู่แล้ว (เดิมทิ้ง)
//     ชื่อคลิปเป็นหลักฐานชื่อคนให้ตัวตรวจ · ความยาวใช้วางแผนช่วงที่จะดู
async function downloadTiktokBuffer(url, meta = null) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { signal: AbortSignal.timeout(60_000) });
  const data = await res.json();
  const playUrl = data?.data?.hdplay || data?.data?.play;
  if (meta && data?.data) {
    meta.caption = String(data.data.title || '').trim();
    meta.durationSec = Math.round(Number(data.data.duration) || 0);
  }
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
  const vres = await fetch(playUrl, { signal: AbortSignal.timeout(300_000) });
  if (vres?.ok === false) throw new Error(`tikwm โหลดไฟล์วิดีโอไม่สำเร็จ (HTTP ${vres.status}) แน่นชั่วคราว ลองใหม่ได้`);
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
//   ถาวร/ชั่วคราวให้ข้อความตัดสินที่ worker เหมือนเดิม (retrySafe ยังติดที่ _loadClipForSingle — ยังไม่จ่ายค่าโมเดล)
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
//   ★ 25 ต.ค. 69 (เครื่องยนต์ช่องเดียว): ส่ง meta มาด้วย = ให้ yt-dlp เขียนข้อมูลคลิป (info.json) รอบเดียวกับที่โหลด
//     แล้วเก็บชื่อ/คำบรรยาย/ความยาวคลิปลง meta (ไม่ยิงเพิ่ม · อ่านไม่ได้ = ข้ามเงียบ ไม่ล้มงาน)
async function downloadMetaBuffer(url, fmt, meta = null) {
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
  if (meta) args.push('--write-info-json');
  if (existsSync(cookies)) args.push('--cookies', cookies);
  args.push(url);
  try {
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R3): ห่อความพลาดของ yt-dlp (ตัดบรรทัดคำสั่ง/พาธชั่วคราว · errorType = CLIP_DOWNLOAD_FAILED)
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M2): เพดานเวลาจาก env (ส่งต่อให้ข้อความ "timeout N วิ" ตรงกับค่าที่ใช้จริง)
    await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout: timeoutMs }).catch((e) => { throw _ytDlpFailure(e, timeoutMs); });
    if (!existsSync(out)) throw new Error('โหลดวิดีโอ Meta ไม่สำเร็จ');
    const buf = await readFile(out);
    if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
    if (meta) {
      try {
        const info = JSON.parse(await readFile(join(dir, 'video.info.json'), 'utf8'));
        meta.caption = [info.title, info.description].map((s) => String(s || '').trim()).filter(Boolean)
          .filter((s, i, a) => a.indexOf(s) === i).join('\n').slice(0, 1500);
        meta.durationSec = Math.round(Number(info.duration) || 0);
      } catch { /* ไม่มี info.json = ไม่มีแคปชั่น/ความยาว (ท่อหลักหาความยาวจากไฟล์เอง) */ }
    }
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

// ★ 24 มิ.ย.: หาความยาวคลิป (วินาที) ด้วย yt-dlp — เครื่องยนต์ช่องเดียวใช้วางแผนช่วงที่จะดู (YouTube)
//   คืน 0 ถ้าหาไม่ได้ (ไม่มี yt-dlp/cloud) → ไล่ทางอื่นต่อ (YouTube Data API → ถามความยาวจาก AI)
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
 * POST /api/clip-transcript/insight — ถอดคลิปเป็น "เนื้อข่าวช่องเดียว" (เครื่องยนต์ clipSingle · 25–26 ต.ค. 69)
 *  ดูคลิปครบทุกช่วงด้วย Gemini → เขียนเนื้อข่าวช่องเดียว → ตรวจด้วยโค้ด → เก็บคลัง
 * ★ แยกจากเวิร์กโฟลว์ข่าว 100%
 */
// ★ 25 ต.ค. 69 (P6): ตัดสินแพลตฟอร์มจาก hostname จริง — เดิมจับคำ "facebook.com" ตรงไหนของลิงก์ก็ได้
//   (http://192.168.1.1/?facebook.com ผ่านเป็น meta แล้ว yt-dlp ไปโหลดปลายทางในวงแลน) · กันซ้ำชั้นสองหลังหน้า submit
function detectClipType(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const on = (d) => host === d || host.endsWith(`.${d}`);
  if (on('youtube.com') || on('youtu.be')) return 'youtube';
  if (on('tiktok.com')) return 'tiktok';
  if (on('facebook.com') || on('fb.watch') || on('instagram.com')) return 'meta';
  return null;
}

// ★ 22 มิ.ย.: แปลง error ดิบให้คนเข้าใจ — กรณี Gemini แน่นชั่วคราว (503) บอกให้กดใหม่ ไม่ใช่ "parse ไม่ได้" งงๆ
// ★ 26 ต.ค. 69 (เฟส 4 · ผู้ตรวจ): ลบสาขา state=PROCESSING/FAILED + ตัวเลือก { retrySafe } — เป็นข้อความของ Files API ใน clipAI ที่ลบแล้ว
//   เครื่องยนต์ช่องเดียว (clipGeminiVideo) ไม่ผ่าน Files API จึงไม่มีทางเกิดข้อความนี้อีก
function humanizeErr(raw) {
  const m = String(raw || '');
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (M1): ข้อความจากตัวโหลดคลิป (yt-dlp · tikwm) ตัดสินถาวร/ชั่วคราวไว้แล้วที่ต้นทาง → คืนทั้งก้อน ห้ามแปลง
  //   เดิมสาขาข้างล่างเขียนทับ: "Unsupported URL" → "Gemini เปิดดูคลิปนี้ไม่ได้" (โทษผิดตัว) · "(… timeout …)" → ข้อความเก่า ~4.5 นาที
  //   · "Video unavailable"/"rate limit" → "Gemini มีคนใช้งานหนัก" (คำตัดสินหาย worker ตีกลับด้าน) — ต้องอยู่ก่อนทุกสาขา
  if (/^(?:yt-dlp โหลดวิดีโอไม่สำเร็จ|tikwm)/.test(m)) return m;
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
 * ★ 25 ต.ค. 69 (เครื่องยนต์ช่องเดียว · เจ้าของเคาะ "ตัดเปลี่ยนทันที"): โหลดคลิป + แคปชั่น + ความยาว "ครั้งเดียวต่อคำขอ"
 *   TikTok/FB/IG = ไฟล์ (ไม่บีบที่นี่ — ท่อหลักผ่าท่อนให้เองเมื่อยาว/ใหญ่) · YouTube = ใช้ลิงก์ (Gemini ดูลิงก์ + ช่วงเวลา)
 *   โหลดล้ม = ยังไม่ได้ยิง AI → ติดธง retrySafe เหมือนตัวโหลดเดิม
 */
async function _loadClipForSingle(url, type) {
  if (type === 'youtube') {
    const meta = { buffer: null, caption: '', durationSec: 0 };
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) meta.caption = String((await r.json())?.title || '').trim();
    } catch { /* ไม่มีชื่อคลิปก็ถอดได้ */ }
    // ★ ผู้ตรวจอิสระ 25 ต.ค. (รอบ 1–2): ความยาว YouTube ไล่จากถูก/เร็วไปแพง — หน้า watch → yt-dlp (เครื่องทีม) → YouTube Data API
    //   ยังไม่ได้อีก = เครื่องยนต์ถามความยาวจาก AI แบบคำตอบสั้นก่อนแบ่งช่วง (ไม่ถอดทั้งคลิปรวดเดียว)
    meta.durationSec = await _youtubeLengthFromPage(url);
    if (!meta.durationSec) meta.durationSec = await getClipDurationSec(url);
    if (!meta.durationSec) meta.durationSec = await _youtubeLengthFromApi(url);
    return meta;
  }
  try {
    const meta = { caption: '', durationSec: 0 };
    const buffer = type === 'tiktok' ? await downloadTiktokBuffer(url, meta) : await downloadMetaBuffer(url, undefined, meta);
    return { buffer, caption: meta.caption, durationSec: meta.durationSec };
  } catch (e) {
    throw _markRetrySafe(e);
  }
}

/** ความยาวคลิป YouTube จากหน้า watch ("lengthSeconds") · อ่านไม่ได้ = 0 */
async function _youtubeLengthFromPage(url) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'th,en;q=0.8' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return 0;
    const m = (await r.text()).match(/"lengthSeconds":"(\d+)"/);
    return m ? Math.round(Number(m[1]) || 0) : 0;
  } catch { return 0; }
}

/** ความยาวคลิป YouTube จาก YouTube Data API v3 (YOUTUBE_API_KEY ที่ระบบมีอยู่แล้ว · 1 หน่วยโควตา) · อ่านไม่ได้ = 0 */
async function _youtubeLengthFromApi(url) {
  try {
    const key = process.env.YOUTUBE_API_KEY;
    const id = String(url).match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
    if (!key || !id) return 0;
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${id}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return 0;
    const iso = String((await r.json())?.items?.[0]?.contentDetails?.duration || '');
    const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m) return 0;
    return ((Number(m[1]) || 0) * 86400) + ((Number(m[2]) || 0) * 3600) + ((Number(m[3]) || 0) * 60) + (Number(m[4]) || 0);
  } catch { return 0; }
}

// ล้มก่อนถึงผู้ให้บริการ AI = ยังไม่จ่ายเงิน — ใช้จดยอดลง acc เพื่อวินิจฉัยเท่านั้น
//   (ความผิดพลาดของเครื่องยนต์ไม่ติดธง retrySafe อยู่แล้ว · retrySafe มาจากตัวโหลดคลิปเท่านั้น)
const SINGLE_PRE_PROVIDER = new Set(['BAD_INPUT', 'DURATION_UNKNOWN', 'NO_FFMPEG', 'SEG_NO_INPUT', 'SEG_NO_PLAN', 'SEG_NO_FFMPEG', 'SEG_TOO_MANY', 'SEG_ALL_FAILED', 'SEG_ERROR', 'NO_KEY']);

async function _logClipUsage(usage) {
  if (process.env.CLIP_USAGE_LOG === '0') return;
  try { (await import('@/lib/ai/usageLogger')).logApiUsage(usage); } catch { /* มิเตอร์พลาดต้องไม่ล้มงาน */ }
}

/** 🚪 ประตูเดียวของการถอดคลิป (25 ต.ค. 69) — เครื่องยนต์ช่องเดียว · หนึ่งคำขอ = เริ่มงานที่นี่ครั้งเดียว · ไม่มีเครื่องยนต์สำรอง */
async function buildInsightSingle({ url, type, model = '', acc = null }) {
  const src = await _loadClipForSingle(url, type);
  const { runClipSinglePipeline } = await import('@/lib/services/clipSingle/pipeline');
  const r = await runClipSinglePipeline({
    url, type, videoBuffer: src.buffer, caption: src.caption, durationSec: src.durationSec, model, onUsage: _logClipUsage,
  });
  if (r.ok && r.insight) return r.insight;
  const spent = Number(r.spentTokens) || 0;
  if (acc) acc.brainSpentTokens = spent > 0 ? spent : (SINGLE_PRE_PROVIDER.has(String(r.errorType)) ? 0 : -1);
  const err = new Error(r.error || 'ถอดคลิปไม่สำเร็จ');
  err.code = r.errorType || 'SINGLE_FAILED';
  throw err;
}

// ★ 8 ก.ค.: ด่านตรวจคุณภาพก่อนเก็บคลัง — เช็คง่ายๆ ไม่เรียก AI (เคยมีเคส rawData ว่าง 0 ตัวอักษรหลุดเข้าคลัง
//   จาก JSON ถูกตัดท้ายแล้วซ่อมไม่ครบ) — คืน [] = ผ่าน, ไม่ผ่านคืนรายการปัญหา
const RAWDATA_MIN_CHARS = 300;
// ★ 25 ต.ค. 69: เนื้อข่าวช่องเดียว "ยาวตามเนื้อคลิป" — คลิปสั้นมาก/เนื้อน้อยได้เนื้อสั้นโดยชอบธรรม จึงใช้เกณฑ์ต่ำกว่า
const SINGLE_BODY_MIN_CHARS = 120;
const minRawChars = (insight) => (insight?.engine === 'clip-single' ? SINGLE_BODY_MIN_CHARS : RAWDATA_MIN_CHARS);
function insightQualityIssues(insight) {
  const issues = [];
  const raw = String(insight?.rawData || '');
  if (raw.length < minRawChars(insight)) issues.push(`เนื้อดิบสั้นผิดปกติ (${raw.length} ตัวอักษร)`);
  // ★ ผู้ตรวจอิสระ 25 ต.ค.: บางช่วงของคลิปดูไม่สำเร็จ = เนื้อข่าวไม่ครบ → ติดธง (คลังกันซ้ำจะไม่คืนใบนี้ให้ลิงก์เดิม)
  const missed = (Array.isArray(insight?.checks) ? insight.checks : []).filter((c) => c?.kind === 'segment').length;
  if (insight?.engine === 'clip-single' && missed) issues.push(`ดูคลิปไม่สำเร็จ ${missed} ช่วง เนื้อข่าวจึงไม่ครบ`);
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
        // ★ 25 ต.ค. 69 (P9): ไม่คืนผลจากเครื่องยนต์สำรองที่ไม่ผ่านด่านตรวจ (brainFallback) · ใบที่ปักหมุดขึ้นก่อน
        const hit = all
          .filter(c => c.url === url && !c.lowQuality && !c.insight?.brainFallback
            && String(c.insight?.rawData || '').length >= minRawChars(c.insight))
          .sort((a, b) => Number(!!b.chosen) - Number(!!a.chosen) || new Date(b.createdAt) - new Date(a.createdAt))[0];
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
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): สมุดจดของคำขอนี้ — เครื่องยนต์ใช้โทเคนไปเท่าไรก่อนล้ม (ใช้ตัดสิน retrySafe ด้านล่าง)
    const acc = { brainSpentTokens: 0 };
    try {
      // ★ 25 ต.ค. 69: ตัดเปลี่ยนเป็นเครื่องยนต์ "เนื้อข่าวช่องเดียว" (เจ้าของเคาะ) — ความยาวคลิปหาเองในตัวโหลด
      insight = await getClipVideoQueue().run(() => buildInsightSingle({ url, type, model: modelOverride, acc }), { label: `insight:${type}${modelOverride ? `@${modelOverride}` : ''}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): บอก worker ว่า "ล้มก่อนจ่ายค่าโมเดล" → ลองใหม่อัตโนมัติได้โดยไม่จ่ายซ้ำ
      //   ต้องครบสองข้อ: error ติดธงจากต้นทาง (โหลดคลิป/อัปโหลด/รอ Gemini ประมวลผล) + เครื่องยนต์ใหม่ยังไม่ใช้โทเคน
      //   เดิมไม่มี route ไหนตั้ง retrySafe → retry อัตโนมัติของ worker ไม่เคยเกิดจริง (log ตั้งแต่ 22 ส.ค. retry 0 ครั้ง)
      //   กรณีอื่นไม่ใส่ field นี้เลย (worker อ่านไม่เจอ = ไม่ลองซ้ำ)
      const retrySafe = e?.retrySafe === true && acc.brainSpentTokens === 0;
      return NextResponse.json({ success: false, error: humanizeErr(e.message), errorType: code, ...(retrySafe ? { retrySafe: true } : {}) }, { status: 422 });
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
