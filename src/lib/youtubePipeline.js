// ============================================================
// [ระบบทำปกออโต้] ขั้นที่ 4 — Pipeline แคปเฟรมจาก YouTube
// ------------------------------------------------------------
// คีย์เวิร์ด → ค้นคลิป (SerpApi) → เลือก 1-5 คลิป (เรียงยอดวิว,
// มีคลิปสำรอง) → yt-dlp โหลด ≤720p → ffmpeg ไล่แคปเฟรม →
// Gemini คัดเฟรมที่เห็นบุคคลชัด → เซฟ 20-30 เฟรมเข้า public
// (เครื่องทีมเท่านั้น: ต้องมี yt-dlp + ffmpeg ใน PATH)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { searchYouTubeClips } from './imageSearch.js';
import { geminiSelectFrames } from './gemini.js';

const exec = promisify(execFile);

const MAX_CLIPS = int(process.env.YT_MAX_CLIPS, 5);
const TARGET_FRAMES = int(process.env.YT_TARGET_FRAMES, 25);
const HARD_CAP = int(process.env.YT_HARD_CAP, 30);
const MAX_CAND_PER_CLIP = int(process.env.YT_CANDIDATES_PER_CLIP, 40);
const FRAME_EVERY_SEC = num(process.env.YT_FRAME_EVERY_SEC, 3);
const MAX_CLIP_SECONDS = int(process.env.YT_MAX_CLIP_SECONDS, 1200);
const MIN_CLIP_SECONDS = int(process.env.YT_MIN_CLIP_SECONDS, 20);
const GEMINI_BATCH = int(process.env.YT_GEMINI_BATCH, 10);

function int(v, d) {
  const n = parseInt(v, 10);
  return isNaN(n) ? d : n;
}
function num(v, d) {
  const n = parseFloat(v);
  return isNaN(n) ? d : n;
}

export async function runYouTubePipeline({ caseId, keywords, progress, clipUrls, newsGist }) {
  const P = progress || (() => {});
  const subjects = keywords.subjects || [];
  const log = [];
  // ★ 9 ก.ค. (เฟส 1): สถิติรายคลิปให้ย้อนสืบได้ — ค้นเจอกี่ตัว / เพดานเวลาตัดทิ้งกี่ตัว(ตัวไหน) / ใช้กี่ตัว
  const stats = { found: 0, droppedByDuration: [], afterFilter: 0, used: [] };
  // โหมดเจาะจงคลิป = คุณภาพสูง (1080p) + แคปถี่ (เก็บโมเมนต์ครบ) — ผู้ใช้ชี้คลิปเองแปลว่าคลิปนี้สำคัญ
  const pinpoint = Array.isArray(clipUrls) && clipUrls.length > 0;

  let clips = [];
  const seen = new Set();

  // ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง): โหมด "เจาะจงคลิป" — ผู้ใช้วางลิงก์ FB/YouTube/TikTok/IG มาเอง
  //   yt-dlp โหลดได้ทุกเจ้า → ข้ามการค้น/คัดคลิป ไปแคปเฟรมคลิปนั้นตรงๆ แล้วให้ตาเลือกเฟรมตามบริบทข่าว
  if (Array.isArray(clipUrls) && clipUrls.length) {
    clips = clipUrls.filter(Boolean).map((u, i) => ({ link: String(u).trim(), title: `คลิปที่ผู้ใช้ระบุ ${i + 1}` }));
    P('ใช้คลิปที่ผู้ใช้ระบุ', `${clips.length} คลิป — ข้ามการค้นหา`, { pct: 10 });
  } else {

  P('ค้นคลิป YouTube', 'ค้นจากคีย์เวิร์ด', { pct: 8 });

  // 1) ค้นคลิปจากชื่อบุคคลหลัก + คำค้นไทยบางส่วน
  const queries = [
    ...subjects.map((s) => s.name),
    ...(keywords.queries_th || []),
  ].filter(Boolean);
  for (const q of queries) {
    if (clips.length >= MAX_CLIPS * 3) break;
    try {
      const found = await searchYouTubeClips(q);
      for (const c of found) {
        if (!c.link || seen.has(c.link)) continue;
        seen.add(c.link);
        clips.push(c);
      }
    } catch (e) {
      if (e.errorType === 'NO_SERPAPI_KEY') throw e;
      log.push(`ค้นคลิป "${q}" ล้มเหลว: ${e.message}`);
    }
  }

  stats.found = clips.length;
  log.push(`ค้นเจอคลิป ${clips.length} ตัวจาก ${queries.length} คีย์เวิร์ด`);

  // กรองความยาวเหมาะสม — ★ 9 ก.ค. (เฟส 1): บันทึกคลิปที่โดนเพดานเวลาตัดทิ้ง (สืบ "คลิปรายการจริงยาวเกินโดนเขี่ย")
  clips = clips.filter((c) => {
    if (!c.lengthSeconds) return true;
    const ok = c.lengthSeconds <= MAX_CLIP_SECONDS && c.lengthSeconds >= MIN_CLIP_SECONDS;
    if (!ok) stats.droppedByDuration.push({ title: (c.title || '').slice(0, 60), length: c.lengthText || `${c.lengthSeconds}s` });
    return ok;
  });
  if (stats.droppedByDuration.length) {
    log.push(`เพดานเวลา (${MIN_CLIP_SECONDS}-${MAX_CLIP_SECONDS} วิ) ตัดทิ้ง ${stats.droppedByDuration.length} คลิป: ${stats.droppedByDuration.map((d) => `"${d.title}" (${d.length})`).join(' · ').slice(0, 300)}`);
  }
  stats.afterFilter = clips.length;

  // เรียงตาม "ความตรงประเด็นข่าว" ก่อน แล้วค่อยยอดวิว
  // (คลิปที่ตรงรายการต้นทาง/ชื่อบุคคล ดีกว่าคลิปวิวเยอะแต่หลุดประเด็น)
  const showTerms = (keywords.source_show || []).map((s) => String(s).toLowerCase());
  const nameTerms = subjects.map((s) => String(s.name || '').toLowerCase()).filter(Boolean);
  const relevance = (clip) => {
    const t = (clip.title || '').toLowerCase();
    let score = 0;
    for (const s of showTerms) if (s && t.includes(s)) score += 5; // ตรงรายการต้นทาง = ดีสุด
    for (const n of nameTerms) if (n && t.includes(n)) score += 3;
    return score;
  };
  clips.sort((a, b) => relevance(b) - relevance(a) || (b.views || 0) - (a.views || 0));
  clips = clips.slice(0, MAX_CLIPS);

  } // จบโหมดค้นอัตโนมัติ (else ของโหมดเจาะจงคลิป)

  if (clips.length === 0) {
    const e = new Error('ไม่พบคลิป YouTube ที่เหมาะสมจากคีย์เวิร์ด');
    e.errorType = 'NO_CLIPS';
    throw e;
  }

  const outDir = path.join(process.cwd(), 'public', 'case-frames', caseId);
  await fs.mkdir(outDir, { recursive: true });

  const collected = [];
  const clipsUsed = [];
  let clipIdx = 0;

  // 2) ไล่คลิปทีละตัว จนได้เฟรมพอ (คลิปหลังเป็นสำรอง)
  for (const clip of clips) {
    if (collected.length >= TARGET_FRAMES) break;
    clipIdx++;
    const tmp = path.join(os.tmpdir(), 'autocover-yt', caseId, `clip${clipIdx}`);
    await fs.mkdir(tmp, { recursive: true });

    try {
      P('โหลดคลิป', `คลิป ${clipIdx}/${clips.length}: ${clip.title.slice(0, 40)}`, { pct: 15 + clipIdx * 12 });
      const videoFile = await downloadClip(clip.link, tmp, pinpoint);
      P('แคปเฟรม', `คลิป ${clipIdx} — ffmpeg ตัดเฟรม${pinpoint ? ' (ละเอียด 1080p)' : ''}`, { pct: 18 + clipIdx * 12 });
      const cand = await extractFrames(videoFile, tmp, pinpoint);
      if (cand.length === 0) {
        log.push(`คลิป ${clipIdx} แคปเฟรมไม่ได้`);
        continue;
      }

      P('Gemini คัดเฟรม', `คลิป ${clipIdx} — คัดจาก ${cand.length} เฟรม (ได้ ${collected.length} แล้ว)`, { pct: 22 + clipIdx * 12 });
      let selected = await selectWithGemini(cand, subjects, P.onRetry, caseId, newsGist, pinpoint);
      log.push(`คลิป ${clipIdx} "${clip.title.slice(0, 40)}": เฟรมดิบ ${cand.length} → Gemini เลือก ${selected.length}`);

      // ★ 6 ก.ค. (ผู้ใช้สั่ง "ต้องได้ 10+ ภาพ"): โหมดเจาะจงคลิป — ตาคัดน้อยไป (คลิปถ่ายมือ/สั่น
      //   โดนเกณฑ์ความคมตัดเกือบหมด) → เติมเฟรมกระจายทั่วช่วงเวลาให้ถึงขั้นต่ำ ผู้ใช้ไปคัดเองต่อได้
      const PINPOINT_MIN = int(process.env.YT_PINPOINT_MIN, 12);
      if (pinpoint && selected.length < PINPOINT_MIN && cand.length > selected.length) {
        const have = new Set(selected);
        const rest = cand.filter((c) => !have.has(c.index));
        const need = Math.min(PINPOINT_MIN - selected.length, rest.length);
        const step = rest.length / need;
        for (let k = 0; k < need; k++) selected.push(rest[Math.floor(k * step)].index);
        log.push(`โหมดเจาะจง: ตาเลือก ${have.size} < ขั้นต่ำ ${PINPOINT_MIN} → เติมเฟรมกระจายเวลาเป็น ${selected.length}`);
        P('เติมเฟรมขั้นต่ำ', `ตาคัด ${have.size} → เติมเป็น ${selected.length} (กระจายทั่วคลิป)`);
      }

      let frameNo = 0;
      for (const ci of selected) {
        if (collected.length >= HARD_CAP) break;
        const src = cand.find((c) => c.index === ci);
        if (!src) continue;
        frameNo++;
        const destName = `yt_${clipIdx}_${String(frameNo).padStart(3, '0')}.jpg`;
        await fs.copyFile(src.file, path.join(outDir, destName));
        collected.push({
          imageUrl: `/case-frames/${caseId}/${destName}`,
          thumbnailUrl: `/case-frames/${caseId}/${destName}`,
          title: clip.title,
          source: clip.channel || 'YouTube',
          sourceLink: clip.link,
          width: null,
          height: null,
          meta: { clipTitle: clip.title, atSecond: src.time },
        });
      }
      clipsUsed.push({
        title: clip.title,
        link: clip.link,
        channel: clip.channel,
        length: clip.lengthText,
        picked: frameNo,
      });
      stats.used.push({ title: (clip.title || '').slice(0, 60), channel: clip.channel || '', picked: frameNo });
    } catch (e) {
      if (e.errorType === 'NO_GEMINI_KEY') throw e;
      log.push(`คลิป ${clipIdx} ล้มเหลว: ${e.message}`);
    } finally {
      try {
        await fs.rm(tmp, { recursive: true, force: true });
      } catch {
        /* ไม่เป็นไร */
      }
    }
  }

  if (collected.length === 0) {
    const e = new Error('ดึงเฟรมที่ใช้ได้จากคลิปไม่สำเร็จ (ดูรายละเอียดใน log)');
    e.errorType = 'NO_FRAMES';
    e.log = log;
    e.stats = stats;
    throw e;
  }

  return { frames: collected, clipsUsed, log, stats };
}

// ---- yt-dlp: โหลดวิดีโอ ≤720p (เอาเฉพาะภาพ ไม่เอาเสียง เร็วกว่า) ----
async function downloadClip(url, dir, hq = false) {
  const out = path.join(dir, 'clip.%(ext)s');
  // ★ 6 ก.ค.: โหมดเจาะจงคลิป (hq) — คลิปเดียว เอาชัดสุด ≤1080p (โหมดค้นอัตโนมัติคง 720p เพื่อความเร็ว)
  const fmt = hq ? 'bv*[height<=1080]/b[height<=1080]/b' : 'bv*[height<=720]/b[height<=720]/b';
  await exec(
    'yt-dlp',
    [
      '-f',
      fmt,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      // ลดโอกาสโดน 403: สลับ player client
      '--extractor-args',
      'youtube:player_client=android,web',
      '-o',
      out,
      url,
    ],
    { maxBuffer: 1024 * 1024 * 64, timeout: 300000 }
  );

  const files = await fs.readdir(dir);
  const vid = files.find((f) => /^clip\./.test(f));
  if (!vid) throw new Error('yt-dlp ไม่ได้ไฟล์วิดีโอ');
  return path.join(dir, vid);
}

// อ่านความยาวคลิป (วินาที) ด้วย ffprobe
async function probeDuration(videoFile) {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoFile],
      { timeout: 30000 }
    );
    const d = parseFloat(String(stdout).trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

// ---- ffmpeg: ไล่แคปเฟรม "กระจายทั้งคลิป" (ไม่ใช่แค่ช่วงต้น) ----
async function extractFrames(videoFile, dir, dense = false) {
  const pattern = path.join(dir, 'f_%04d.jpg');
  const duration = await probeDuration(videoFile);

  // กระจาย MAX_CAND เฟรมให้ทั่วทั้งคลิป: fps = จำนวนเฟรม / ความยาว
  // ★ 6 ก.ค.: โหมดเจาะจงคลิป (dense) — แคปถี่ขึ้น (สูงสุด 2 เฟรม/วิ, เป้า 60 เฟรม) เก็บโมเมนต์ครบกว่า
  const candTarget = dense ? Math.max(60, MAX_CAND_PER_CLIP) : MAX_CAND_PER_CLIP;
  const fpsMax = dense ? 2 : 1;
  let fps;
  if (duration && duration > 0) {
    fps = candTarget / duration;
    fps = Math.min(Math.max(fps, 0.02), fpsMax);
  } else {
    fps = 1 / FRAME_EVERY_SEC;
  }
  const step = 1 / fps;

  // ★ 6 ก.ค. (ผู้ใช้สั่ง "คุณภาพสูงสุด"): โหมดเจาะจงคลิป — ไม่ย่อทิ้งพิกเซล (เพดาน 1920) + JPEG เกรดสูงสุด (q:v 2)
  //   เดิม scale 1280 + q:v 3 ทำคลิป 1080p แนวนอนเสียพิกเซล ~44% ก่อนถึงคลังด้วยซ้ำ
  const scaleCap = dense ? 1920 : 1280;
  const jpegQ = dense ? '2' : '3';
  await exec(
    'ffmpeg',
    [
      '-i',
      videoFile,
      '-vf',
      `fps=${fps},scale='min(${scaleCap},iw)':-2`,
      '-q:v',
      jpegQ,
      '-frames:v',
      String((dense ? Math.max(60, MAX_CAND_PER_CLIP) : MAX_CAND_PER_CLIP) + 5),
      pattern,
    ],
    { timeout: 300000 }
  );

  const files = (await fs.readdir(dir)).filter((f) => /^f_\d+\.jpg$/.test(f)).sort();
  return files.map((f, i) => ({
    file: path.join(dir, f),
    index: i,
    time: Math.round(i * step),
  }));
}

// ---- Gemini: คัดเฟรมเป็นแบตช์ คืน index ที่เลือก ----
async function selectWithGemini(cand, subjects, onRetry, caseId, newsGist, pinpoint) {
  const keep = [];
  for (let i = 0; i < cand.length; i += GEMINI_BATCH) {
    const batch = cand.slice(i, i + GEMINI_BATCH);
    const frames = [];
    for (const c of batch) {
      const buf = await fs.readFile(c.file);
      frames.push({ index: c.index, base64: buf.toString('base64') });
    }
    const sel = await geminiSelectFrames({ frames, subjects, onRetry, caseId, newsGist, pinpoint });
    for (const s of sel) keep.push(s.index);
  }
  return [...new Set(keep)];
}
