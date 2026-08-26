/**
 * ✂️ clipBrain/clipSegmenter.js — ผ่าไฟล์วิดีโอเป็นท่อนตามแผน (B2 · 25 ส.ค. 69)
 * ------------------------------------------------------------------
 * ใช้ ffmpeg แปลงไฟล์ธรรมดา (crop เวลา + ย่อขนาด) — **ไม่ใช่ generative**
 * ไม่ขัดกฎเหล็ก "ห้าม AI เจน/วาดพิกเซล" ของโปรเจกต์ (AGENTS.md ข้อ 6) เหมือน _fitForInline ที่ใช้อยู่เดิม
 *
 * 🎁 ผลพลอยได้สำคัญ: เดิมคลิป 1 ชั่วโมงถูกบีบทั้งเรื่องให้เหลือ 19MB (ภาพแตก อ่านป้ายชื่อไม่ออก)
 *    พอผ่าเป็นท่อน แต่ละท่อนได้โควตา 19MB ของตัวเอง → บิตเรตต่อนาทีสูงขึ้นหลายเท่า = ตาเห็นชัดขึ้นจริง
 *
 * สัญญา: ไม่โยน error (คืน {ok:false,...}) · ลบไฟล์ชั่วคราวเสมอแม้ล้มกลางคัน · มีเพดานเวลาทุกคำสั่ง
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, readFile, unlink, mkdtemp, rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export const SEG_DEFAULTS = {
  maxBytes: 19 * 1024 * 1024, // เพดาน inline ของ Gemini (เท่าเดิมที่ระบบใช้อยู่)
  height: 480,                // ท่อนสั้นลง → ยกจาก 360p เดิมได้ ภาพชัดขึ้นโดยไม่เกินเพดาน
  audioK: 64,
  minBytes: 10000,
  cutTimeoutMs: 600000,
};

const MAX_SEGMENTS = 32; // เพดานจำนวนท่อนต่อคำขอ — กัน DoS จากแผนที่ยาวผิดปกติ (CB-13)

/**
 * ชื่อไฟล์ segment — มาจาก index ที่วนลูปภายในเท่านั้น (seg1, seg2, ...)
 * ห้ามใช้ s.no (มาจากแผนภายนอก) ตั้งชื่อไฟล์เด็ดขาด เพราะเป็นช่อง path traversal (CB-08)
 * ฟังก์ชันบริสุทธิ์ ไม่มี side effect เพื่อให้เทสเรียกตรงได้
 */
export function segFileName(index) {
  const i = Math.floor(Number(index));
  return `seg${Number.isFinite(i) && i > 0 ? i : 1}.mp4`;
}

/** normalize s.no ให้เป็น positive integer สำหรับใช้เป็น metadata แสดงผลเท่านั้น — ไม่ใช้ตั้งชื่อไฟล์ (CB-08) */
function normalizeSegNo(no, fallback) {
  const n = Math.floor(Number(no));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ยืนยันว่า path ที่จะใช้งานยังอยู่ใต้ dir ชั่วคราวจริง ไม่หลุดออกไปนอก (CB-08) */
function isInsideDir(dir, p) {
  const rel = relative(dir, p);
  return !!rel && rel !== '..' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * clamp option ทุกตัวให้อยู่ในช่วงปลอดภัยเสมอ ก่อนใช้งานจริง (CB-13)
 * - cutTimeoutMs=0/ติดลบ/ผิดรูป จะปิด timeout ของ execFile ได้ → บังคับขั้นต่ำ 10 วิ เพดาน 30 นาที
 * - height/maxBytes/audioK/minBytes ที่ผิดรูปหรือหลุดช่วงสมเหตุสมผล → ใช้ default/clamp เข้าเพดาน
 * ฟังก์ชันบริสุทธิ์ ไม่มี side effect เพื่อให้เทสเรียกตรงได้
 */
export function clampSegOpts(opt) {
  const src = opt && typeof opt === 'object' && !Array.isArray(opt) ? opt : {};
  const o = { ...SEG_DEFAULTS, ...src };

  const timeout = Number(src.cutTimeoutMs);
  o.cutTimeoutMs = Number.isFinite(timeout)
    ? Math.min(30 * 60 * 1000, Math.max(10 * 1000, timeout))
    : SEG_DEFAULTS.cutTimeoutMs;

  const height = Number(src.height);
  o.height = Number.isFinite(height)
    ? Math.min(1080, Math.max(144, Math.round(height)))
    : SEG_DEFAULTS.height;

  const maxBytes = Number(src.maxBytes);
  o.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.min(100 * 1024 * 1024, Math.max(1024 * 1024, maxBytes))
    : SEG_DEFAULTS.maxBytes;

  const audioK = Number(src.audioK);
  o.audioK = Number.isFinite(audioK) && audioK > 0
    ? Math.min(320, Math.max(32, Math.round(audioK)))
    : SEG_DEFAULTS.audioK;

  // minBytes ต้องมีเพดานบนด้วย เหมือน maxBytes/height/audioK — ห้ามปล่อยให้ค่าเวอร์เกิน
  // (เช่น 999999999999999) ผ่านตรงๆ เพราะจะทำให้ทุกท่อนถูกตัดทิ้งเป็น "ไฟล์เล็กผิดปกติ" หมด (CB-13)
  const minBytes = Number(src.minBytes);
  o.minBytes = Number.isFinite(minBytes) && minBytes >= 0
    ? Math.min(minBytes, o.maxBytes)
    : SEG_DEFAULTS.minBytes;

  return o;
}

let _ffmpegOk = null; // แคชผลเช็ค (ไม่ต้องยิงทุกท่อน)

export async function hasFfmpeg() {
  if (_ffmpegOk !== null) return _ffmpegOk;
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10000 });
    _ffmpegOk = true;
  } catch { _ffmpegOk = false; }
  return _ffmpegOk;
}

/** ความยาวคลิปจากตัวไฟล์ (วินาที) — ไม่ต้องพึ่ง yt-dlp/เน็ต · คืน 0 ถ้าอ่านไม่ได้ */
export async function probeDurationSec(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath,
    ], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const sec = Math.round(Number(String(stdout).trim()));
    return Number.isFinite(sec) && sec > 0 ? sec : 0;
  } catch { return 0; }
}

function bitrateFor(seconds, o) {
  // งบบิตเรตของท่อนนี้ (kbps) — เผื่อ overhead 7%
  const budget = Math.floor(((o.maxBytes * 8 * 0.93) / 1000) / Math.max(1, seconds)) - o.audioK;
  return Math.min(2500, Math.max(120, budget));
}

/**
 * ผ่าไฟล์วิดีโอเป็นท่อนตามแผน
 * @param {Buffer} videoBuffer
 * @param {Array<{no,startSec,endSec,topics?}>} segments
 * @returns {Promise<{ok:boolean, segments?:Array<{no,startSec,endSec,topics,buffer,bytes,durationSec}>, errorType?:string, error?:string, warnings:string[]}>}
 */
export async function cutSegments(videoBuffer, segments, opt = {}) {
  const o = clampSegOpts(opt); // clamp option ทุกตัวก่อนใช้เสมอ (CB-13)
  const warnings = [];
  if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
    return { ok: false, errorType: 'SEG_NO_INPUT', error: 'ไม่มีไฟล์วิดีโอให้ผ่า', warnings };
  }
  if (!Array.isArray(segments) || !segments.length) {
    return { ok: false, errorType: 'SEG_NO_PLAN', error: 'ไม่มีแผนผ่า', warnings };
  }
  if (!(await hasFfmpeg())) {
    return { ok: false, errorType: 'SEG_NO_FFMPEG', error: 'เครื่องนี้ไม่มี ffmpeg', warnings };
  }

  // เพดานจำนวนท่อน — กัน DoS จากแผนยาวผิดปกติ (CB-13)
  // ห้ามตัดเงียบด้วย slice() แล้วรายงานว่าผ่าครบ (out.length < segList.length จะเทียบกับ list ที่ถูกตัดไปแล้ว
  // ไม่ใช่จำนวนต้นฉบับ — ผู้เรียกจะเข้าใจผิดว่าได้ครบทั้งที่ท่อนท้ายหายไปเงียบๆ) จึง reject ตรงๆ ก่อนเริ่มผ่า
  if (segments.length > MAX_SEGMENTS) {
    return {
      ok: false, errorType: 'SEG_TOO_MANY',
      error: `แผนมี ${segments.length} ท่อน เกินเพดาน ${MAX_SEGMENTS} ท่อนต่อคำขอ`,
      warnings,
    };
  }
  const segList = segments;

  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'clipseg-'));
    const inP = join(dir, 'in.mp4');
    if (!isInsideDir(dir, inP)) {
      return { ok: false, errorType: 'SEG_ERROR', error: 'internal path error', warnings };
    }
    await writeFile(inP, videoBuffer);
    const out = [];
    let idx = 0;
    for (const s of segList) {
      idx += 1;
      const no = normalizeSegNo(s && s.no, idx); // s.no เป็นแค่ metadata แสดงผล ไม่ใช้ตั้งชื่อไฟล์ (CB-08)
      const start = Math.max(0, Math.round(Number(s && s.startSec) || 0));
      const end = Math.round(Number(s && s.endSec) || 0);
      const len = end - start;
      if (!(len > 0)) { warnings.push(`ท่อน ${no}: ช่วงเวลาไม่ถูกต้อง ข้าม`); continue; }
      // ชื่อไฟล์มาจาก index วนลูปภายในเสมอ — ไม่ใช่ s.no ที่มาจากแผนภายนอก (CB-08)
      const outP = join(dir, segFileName(idx));
      if (!isInsideDir(dir, outP)) { warnings.push(`ท่อน ${no}: path ผิดปกติ ข้าม`); continue; }
      const vK = bitrateFor(len, o);
      try {
        await execFileAsync('ffmpeg', [
          '-y', '-ss', String(start), '-t', String(len), '-i', inP,
          '-vf', `scale=-2:${o.height}`, '-c:v', 'libx264', '-preset', 'veryfast',
          '-b:v', `${vK}k`, '-maxrate', `${vK}k`, '-bufsize', `${vK * 2}k`,
          '-c:a', 'aac', '-b:a', `${o.audioK}k`, '-ac', '1',
          '-movflags', '+faststart', outP,
        ], { timeout: o.cutTimeoutMs, maxBuffer: 1024 * 1024 * 20 });
        const buf = await readFile(outP);
        if (buf.length < o.minBytes) { warnings.push(`ท่อน ${no}: ไฟล์เล็กผิดปกติ ข้าม`); continue; }
        if (buf.length > o.maxBytes) { warnings.push(`ท่อน ${no}: เกินเพดาน ${(buf.length / 1e6).toFixed(1)}MB ข้าม`); continue; }
        out.push({
          no, startSec: start, endSec: end, durationSec: len,
          topics: Array.isArray(s && s.topics) ? s.topics : [],
          buffer: buf, bytes: buf.length,
        });
      } catch (e) {
        warnings.push(`ท่อน ${no}: ผ่าไม่สำเร็จ (${String((e && e.message) || e).slice(0, 80)})`);
      } finally { await unlink(outP).catch(() => {}); }
    }
    if (!out.length) return { ok: false, errorType: 'SEG_ALL_FAILED', error: 'ผ่าไม่สำเร็จสักท่อน', warnings };
    // ผ่าได้ไม่ครบ = ยอมให้ไปต่อไม่ได้ (เนื้อจะหายเงียบ) — ผู้เรียกถอยลงท่อเดิมทั้งใบ
    if (out.length < segList.length) {
      return {
        ok: false, errorType: 'SEG_INCOMPLETE',
        error: `ผ่าได้ ${out.length}/${segList.length} ท่อน — ไม่ครบ เสี่ยงเนื้อหาย`,
        warnings, segments: out,
      };
    }
    const totalMB = out.reduce((n, x) => n + x.bytes, 0) / 1e6;
    try { console.log(`[ClipBrain] ✂️ ผ่า ${out.length} ท่อน รวม ${totalMB.toFixed(1)}MB (${o.height}p)`); } catch {}
    return { ok: true, segments: out, warnings };
  } catch (e) {
    return { ok: false, errorType: 'SEG_ERROR', error: String((e && e.message) || e).slice(0, 300), warnings };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ล้างแคชผลเช็ค ffmpeg (ใช้ในข้อสอบ) */
export function _resetFfmpegCache() { _ffmpegOk = null; }
