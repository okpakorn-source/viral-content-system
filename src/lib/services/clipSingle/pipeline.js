/**
 * 🎬 clipSingle/pipeline.js — เครื่องยนต์ "เนื้อข่าวช่องเดียว" (เจ้าของเคาะ 25 ต.ค. 69)
 * ------------------------------------------------------------------
 *   ① วางแผนช่วง (คลิป ≤8 นาที = ทั้งคลิป · ยาวกว่า = ช่วงละ ~6 นาที ต่อกันไม่มีช่องว่าง)
 *   ② ไฟล์ใหญ่/ยาว → ผ่าไฟล์ด้วย ffmpeg ให้ทุกช่วงแนบตรงได้ (≤19MB) · YouTube ใช้ลิงก์ + ช่วงเวลา
 *   ③ ดูทุกช่วงพร้อมกัน (Gemini ดูวิดีโอ) → บทถอดคำต่อคำ + จอ + ภาพ + ประเด็น
 *   ④ คนเขียนอ่านบทถอดทั้งคลิป → พาดหัว + เนื้อข่าวช่องเดียว
 *   ⑤ ตรวจด้วยโค้ด → แก้คำพูดที่ใกล้เคียงมาก + รายการ "จุดที่ควรเช็ค"
 * ★ 28 ต.ค. 69 ร้อยแก้วกระชับ (ค่าเริ่มต้น): คลิปที่ดูได้ในช่วงเดียว (≤8 นาที) ข้าม ③④ — Gemini 3.8 คิดสูง ดูวิดีโอแล้วเขียนเลย
 *   · คลิปยาวทำ ③ ตามเดิมแล้ว ④ เขียนร้อยแก้วกระชับจากบทถอด · CLIP_RAW_STYLE=full = กลับแบบ 25 ต.ค. ทุกคลิป
 * สัญญา: ไม่โยน error · ไม่เขียนคลัง · คืน spentTokens ให้ผู้เรียกตัดสินใจเรื่องลองใหม่ (กันจ่ายซ้ำ)
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { callClipGeminiVideo } from '../clipBrain/clipGeminiVideo.js';
import { cutSegments, hasFfmpeg, probeDurationSec } from '../clipBrain/clipSegmenter.js';
import {
  SINGLE_REV, CONCISE_REV, buildWatchPrompt, buildWriterPrompt, buildConcisePassPrompt, buildConciseWriterPrompt,
  CONCISE_WRITER_SYSTEM, formatTranscriptForWriter,
} from './prompts.js';
import { planSegments, normalizeWatch, parseClock, formatClock, SINGLE_PASS_MAX_SEC } from './segments.js';
import { writeSingleBody, resolveWriter, validateDraft } from './writer.js';
import { checkSingleBody } from './check.js';

export const INLINE_CAP = 19 * 1024 * 1024;
export const DEFAULT_CONCISE_MODEL = 'gemini-3.8-flash';
const envStr = (k) => String(process.env[k] || '').trim();

/**
 * ★ 28 ต.ค. 69 รูปแบบเนื้อดิบ — 'concise' = ร้อยแก้วกระชับ (ค่าเริ่มต้น · เจ้าของสั่งขึ้นระบบหลังห้องทดลอง)
 *   'full' = เนื้อข่าวช่องเดียวแบบ 25 ต.ค. (สวิตช์ถอย CLIP_RAW_STYLE=full แล้วรีสตาร์ตตัวทำงาน)
 */
export function resolveRawStyle(override = '') {
  return String(override || envStr('CLIP_RAW_STYLE')).toLowerCase() === 'full' ? 'full' : 'concise';
}
const TRANSCRIPT_STORE_CAP = 200_000;
const MAX_PROBE_SEC = 6 * 3600; // ความยาวที่ AI ตอบเกินนี้ถือว่าเพี้ยน (กันแบ่ง 24 ช่วง ช่วงละชั่วโมง)
const envInt = (k, d) => { const n = parseInt(process.env[k] || '', 10); return Number.isFinite(n) && n > 0 ? n : d; };
const log = (...a) => { try { console.log('[ClipSingle]', ...a); } catch { /* ไม่ให้ log ทำงานพัง */ } };

/** ความยาวไฟล์วิดีโอ (วินาที) ด้วย ffprobe · อ่านไม่ได้ = 0 */
async function probeBufferDurationSec(buffer) {
  let dir = '';
  try {
    dir = await mkdtemp(join(tmpdir(), 'clipsingle-'));
    const p = join(dir, 'probe.mp4');
    await writeFile(p, buffer);
    return await probeDurationSec(p);
  } catch { return 0; } finally {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      // eslint-disable-next-line no-await-in-loop -- จำกัดจำนวนช่วงที่ดูพร้อมกัน
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param {object} o
 *   url, type('youtube'|'tiktok'|'meta'), videoBuffer (ไม่ใช่ YouTube), caption, durationSec (0 = ไม่รู้)
 *   model (รุ่น Gemini ดูวิดีโอ — ไม่ส่ง = ค่าเริ่มต้นระบบ), writerModel (ไม่ส่ง = env/ค่าเริ่มต้น)
 *   onUsage (บันทึกค่าใช้จ่ายทุกครั้งที่ Gemini ตอบ), deps (ตัวแทนสำหรับข้อสอบ)
 */
export async function runClipSinglePipeline(o = {}) {
  const t0 = Date.now();
  const deps = o.deps || {};
  const callVideo = deps.callVideo || callClipGeminiVideo;
  const cut = deps.cutSegments || cutSegments;
  const ffmpegReady = deps.hasFfmpeg || hasFfmpeg;
  const probe = deps.probeBufferDurationSec || probeBufferDurationSec;
  const write = deps.writeSingleBody || writeSingleBody;
  const style = resolveRawStyle(o.style);
  const single = {
    rev: style === 'concise' ? CONCISE_REV : SINGLE_REV, style, steps: [], degradations: [], segments: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, writer: null,
  };
  const step = (name, extra = {}) => { single.steps.push({ name, ms: Date.now() - t0, ...extra }); log(name); };
  const onUsage = async (u) => {
    single.usage.inputTokens += u.inputTokens || 0;
    single.usage.outputTokens += u.outputTokens || 0;
    single.usage.totalTokens += u.totalTokens || 0;
    if (typeof o.onUsage === 'function') { try { await o.onUsage(u); } catch { /* มิเตอร์พลาดต้องไม่ล้มงาน */ } }
  };
  const fail = (errorType, error) => {
    single.elapsedMs = Date.now() - t0;
    log(`✗ ${errorType} — ${String(error).slice(0, 160)}`);
    return { ok: false, errorType, error: String(error).slice(0, 500), spentTokens: single.usage.totalTokens, single };
  };

  try {
    const url = String(o.url || '');
    const isYT = o.type === 'youtube';
    const caption = String(o.caption || '').trim().slice(0, 1500);
    let dur = Math.round(Number(o.durationSec) || 0);
    let parts;

    // ① + ② เตรียมช่วง
    if (isYT) {
      // ★ ผู้ตรวจอิสระ 25 ต.ค.: YouTube ไม่รู้ความยาว (Vercel/yt-dlp ติดด่านบอท) ห้ามถอดคำต่อคำทั้งคลิปรวดเดียว
      //   (คลิปยาวชนเพดานคำตอบ/บริบทแล้วล้มหลังจ่ายค่าอินพุต) → ถามความยาวแบบคำตอบสั้นก่อน แล้วค่อยแบ่งช่วง
      if (!dur) {
        // เพดานคำตอบ 2,000 (รุ่นที่คิดก่อนตอบ เพดานต่ำ = คำตอบถูกตัด · ผู้ตรวจอิสระรอบ 2) · รับ "1:02:03" ได้ · ค่าเพี้ยนเกิน 6 ชม. = ไม่เชื่อ
        const probeRes = await callVideo({
          prompt: 'ดูคลิปนี้แล้วตอบความยาวคลิปทั้งหมดเป็นวินาที ส่งกลับ JSON เท่านั้น: {"durationSec": ตัวเลข}',
          youtubeUrl: url, model: o.model || undefined, feature: 'clipSingle', onUsage, maxTokens: 2000, maxAttempts: 2,
        });
        const raw = probeRes?.ok ? probeRes.data?.durationSec : null;
        const sec = Math.round(Number(typeof raw === 'string' ? parseClock(raw) : raw) || 0);
        dur = sec > 0 && sec <= MAX_PROBE_SEC ? sec : 0;
        step('ถามความยาวคลิป', { ok: dur > 0, durationSec: dur });
        if (!dur) return fail('DURATION_UNKNOWN', `อ่านความยาวคลิป YouTube ไม่ได้ — ถอดคำต่อคำทั้งคลิปรวดเดียวเสี่ยงล้มกลางทาง (${probeRes?.errorType || 'ไม่มีความยาวในคำตอบ'})`);
      }
      const plan = planSegments(dur);
      parts = plan.length > 1
        ? plan.map((s) => ({ ...s, youtubeUrl: url, videoRange: [s.startSec, s.endSec], timeBase: 'clip', offsetSec: 0 }))
        : [{ no: 1, startSec: 0, endSec: dur, youtubeUrl: url, timeBase: 'clip', offsetSec: 0, whole: true }];
    } else {
      const buf = o.videoBuffer;
      if (!Buffer.isBuffer(buf) || buf.length < 10000) return fail('BAD_INPUT', 'ไม่มีไฟล์วิดีโอให้ถอด');
      if (!dur) dur = await probe(buf);
      let needCut = buf.length > INLINE_CAP || dur > SINGLE_PASS_MAX_SEC;
      // ★ ผู้ตรวจอิสระ 25 ต.ค.: เครื่องที่ไม่มี ffmpeg (ปุ่มสำรองบน Vercel) แต่ไฟล์แนบตรงได้ = ดูทั้งไฟล์รอบเดียวแบบลดเกรด แทนการล้ม
      if (needCut && buf.length <= INLINE_CAP && !(await ffmpegReady())) {
        needCut = false;
        single.degradations.push({ type: 'no-ffmpeg-whole-pass', note: `ไม่มี ffmpeg — ดูคลิป ${dur} วิ ทั้งไฟล์รอบเดียว` });
      }
      if (needCut) {
        if (!dur) return fail('DURATION_UNKNOWN', 'ไฟล์ใหญ่เกินแนบตรงและอ่านความยาวคลิปไม่ได้ (ไม่มี ffprobe) — ผ่าท่อนไม่ได้');
        if (!(await ffmpegReady())) return fail('NO_FFMPEG', 'เครื่องนี้ไม่มี ffmpeg และไฟล์ใหญ่เกินแนบตรง 19MB — ผ่าไฟล์ไม่ได้');
        const plan = planSegments(dur);
        const r = await cut(buf, plan);
        const gotNos = new Set((r.segments || []).map((s) => s.no));
        if (!r.segments?.length) return fail(r.errorType || 'SEG_FAILED', r.error || 'ผ่าไฟล์คลิปไม่สำเร็จ');
        if (r.warnings?.length) single.degradations.push({ type: 'segment-warnings', note: r.warnings.slice(0, 5) });
        parts = plan.map((s) => {
          const got = (r.segments || []).find((x) => x.no === s.no);
          return got
            ? { ...s, buffer: got.buffer, timeBase: 'file', offsetSec: s.startSec }
            : { ...s, cutFailed: true, timeBase: 'file', offsetSec: s.startSec };
        });
        step(`ผ่าไฟล์ ${gotNos.size}/${plan.length} ช่วง`);
      } else {
        parts = [{ no: 1, startSec: 0, endSec: dur, buffer: buf, timeBase: 'file', offsetSec: 0, whole: true }];
      }
    }

    // ★ 28 ต.ค. 69 ร้อยแก้วกระชับ: คลิปที่ดูจบได้ในรอบเดียว (≤8 นาที) = Gemini ดูวิดีโอแล้วเขียนเลย ตรงกับห้องทดลอง
    //   (เจ้าของเคาะ "สั้นดูรอบเดียว ยาวใช้บทถอด") · ไม่มีบทถอด → ตัวตรวจข้ามด่านที่ต้องเทียบบทถอด
    if (style === 'concise' && parts.length === 1 && !(dur > SINGLE_PASS_MAX_SEC)) {
      const p = parts[0];
      if (p.cutFailed) return fail('SEG_CUT_FAILED', 'ย่อไฟล์คลิปไม่สำเร็จ');
      // ★ ผู้ตรวจอิสระ 28 ต.ค.: ใบ "เทียบสองโมเดล" (o.model) ต้องใช้รุ่นที่ขอจริง — คลังบันทึก modelUsed ตามคำขอ
      const model = String(o.model || o.conciseModel || envStr('CLIP_CONCISE_MODEL') || DEFAULT_CONCISE_MODEL);
      const r = await callVideo({
        prompt: buildConcisePassPrompt({ platform: o.type, durationSec: dur, caption, wantDuration: !dur }),
        videoBuffer: p.buffer, youtubeUrl: p.youtubeUrl || '', videoRange: null,
        model, feature: 'clipSingle', onUsage, maxTokens: 24000, temperature: 0.3,
        thinkingLevel: envStr('CLIP_CONCISE_EFFORT') || 'high',
      });
      single.watchModel = r?.receipt?.model || model;
      single.segments = [{ no: 1, startSec: 0, endSec: dur, ok: !!r?.ok, errorType: r?.errorType, ms: r?.receipt?.elapsedMs, keyPoints: [] }];
      step('ดูคลิปแล้วเขียนรอบเดียว', { ok: !!r?.ok });
      if (!r?.ok) return fail(r?.errorType || 'WATCH_FAILED', r?.error || 'Gemini ดูคลิปไม่สำเร็จ');
      if (!dur) {
        const sec = Math.round(Number(parseClock(r.data?.durationSec)) || 0);
        dur = sec > 0 && sec <= MAX_PROBE_SEC ? sec : 0;
        single.segments[0].endSec = dur;
      }
      const v = validateDraft(r.data);
      if (!v.ok) return fail('WRITER_BAD_OUTPUT', `เขียนเนื้อข่าวไม่สำเร็จ: ${v.error}`);
      single.writer = { model: single.watchModel, kind: 'gemini-video', ms: r.receipt?.elapsedMs, costUSD: null, usage: r.receipt?.usage ?? null };
      const checked = checkSingleBody(v.draft, { segments: [], caption, noTranscript: true });
      // ★ ผู้ตรวจอิสระ 28 ต.ค.: อ่านความยาวก่อนดูไม่ได้ แล้วพบทีหลังว่าคลิปยาวเกิน 8 นาที = ดูรอบเดียวแบบที่อาจตกรายละเอียด
      if (dur > SINGLE_PASS_MAX_SEC) {
        single.degradations.push({ type: 'long-clip-single-pass', note: `อ่านความยาวก่อนดูไม่ได้ — คลิป ${dur} วิ ถูกดูแล้วเขียนรอบเดียว` });
        checked.checks.push({ level: 'check', kind: 'coverage', text: `คลิปยาว ${formatClock(dur)} นาที (เกิน 8 นาที) แต่ถูกดูแล้วเขียนรอบเดียว (อ่านความยาวก่อนดูไม่ได้) — อาจตกรายละเอียด ควรเช็คกับคลิปหรือกดถอดใหม่` });
      }
      single.stats = checked.stats;
      step('ตรวจด้วยโค้ด', { checks: checked.checks.length });
      single.transcriptChars = 0;
      single.elapsedMs = Date.now() - t0;
      return {
        ok: true,
        spentTokens: single.usage.totalTokens,
        transcriptText: '',
        insight: {
          engine: 'clip-single', schema: 'single-v1', promptRev: single.rev,
          headline: checked.headline, body: checked.body, rawData: checked.body,
          checks: checked.checks, clipDurationSec: dur, caption, single,
        },
      };
    }

    // ③ ดูทุกช่วงพร้อมกัน
    const total = parts.length;
    const watched = await mapLimit(parts, envInt('CLIP_SINGLE_WATCH_CONCURRENCY', 4), async (p) => {
      if (p.cutFailed) return { ...p, ok: false, errorType: 'SEG_CUT_FAILED' };
      const wantDuration = !!p.whole && !dur;
      const r = await callVideo({
        prompt: buildWatchPrompt({ segment: p, total, timeBase: p.timeBase, wantDuration, caption }),
        videoBuffer: p.buffer, youtubeUrl: p.youtubeUrl || '', videoRange: p.videoRange || null,
        model: o.model || undefined, feature: 'clipSingle', onUsage, maxTokens: 32000,
      });
      if (!r?.ok) return { ...p, ok: false, errorType: r?.errorType || 'WATCH_FAILED', error: r?.error, ms: r?.receipt?.elapsedMs, model: r?.receipt?.model };
      const w = normalizeWatch(r.data, { offsetSec: p.offsetSec });
      // ★ ผู้ตรวจอิสระ 25 ต.ค.: ช่วงหนึ่งของคลิปยาวที่ตอบกลับว่างเปล่าทั้งหมด = ดูไม่สำเร็จ (ไม่ใช่ "ช่วงนี้ไม่มีอะไร")
      if (total > 1 && !w.transcript.length && !w.visuals.length && !w.screen.length) {
        return { ...p, ok: false, errorType: 'WATCH_EMPTY', error: 'Gemini ตอบช่วงนี้ว่างเปล่า', ms: r.receipt?.elapsedMs, model: r.receipt?.model };
      }
      return { ...p, ok: true, ...w, ms: r.receipt?.elapsedMs, model: r.receipt?.model };
    });
    const segments = watched.map(({ buffer: _b, ...rest }) => rest); // ไม่เก็บไฟล์ในผล
    if (!dur) dur = segments.find((s) => s.ok && s.durationSec)?.durationSec || 0;
    for (const s of segments) if (s.whole && !s.endSec && dur) s.endSec = dur;
    single.segments = segments.map((s) => ({ no: s.no, startSec: s.startSec, endSec: s.endSec, ok: s.ok, errorType: s.errorType, ms: s.ms, keyPoints: s.keyPoints || [] }));
    single.watchModel = segments.find((s) => s.model)?.model || o.model || '';
    const okCount = segments.filter((s) => s.ok).length;
    step(`ดูคลิป ${okCount}/${total} ช่วง`);
    if (!okCount) {
      const firstErr = segments.find((s) => s.error)?.error || 'Gemini ดูคลิปไม่สำเร็จ';
      return fail(segments[0]?.errorType || 'WATCH_FAILED', firstErr);
    }
    const hasContent = segments.some((s) => s.ok && (s.transcript.length || s.visuals.length || s.screen.length));
    if (!hasContent) return fail('EMPTY_CLIP', 'คลิปนี้ไม่มีคำพูดหรือภาพที่ถอดเป็นเนื้อหาได้');

    // ④ เขียน
    const transcriptBlock = formatTranscriptForWriter(segments);
    const writer = resolveWriter(o.writerModel);
    // ★ 28 ต.ค. 69: คลิปยาว (หรือคลิปที่ต้องดูหลายช่วง) เขียนร้อยแก้วกระชับจากบทถอด · 'full' = คำสั่งเดิม 25 ต.ค.
    const w = style === 'concise'
      ? await write({ prompt: buildConciseWriterPrompt({ platform: o.type, durationSec: dur, caption, transcriptBlock }), writer, systemPrompt: CONCISE_WRITER_SYSTEM })
      : await write({ prompt: buildWriterPrompt({ platform: o.type, durationSec: dur, caption, transcriptBlock }), writer });
    single.writer = { model: w.model, kind: w.kind || writer.kind, ms: w.elapsedMs, costUSD: w.costUSD ?? null, usage: w.usage ?? null };
    if (w.tokensUsed) single.usage.totalTokens += w.tokensUsed;
    step('เขียนเนื้อข่าว', { ok: w.ok });
    if (!w.ok) return fail(w.errorType || 'WRITER_FAILED', `เขียนเนื้อข่าวไม่สำเร็จ: ${w.error || ''}`);

    // ⑤ ตรวจด้วยโค้ด
    const checked = checkSingleBody(w.draft, { segments, caption });
    single.stats = checked.stats;
    step('ตรวจด้วยโค้ด', { checks: checked.checks.length });
    // ★ ผู้ตรวจอิสระ 25 ต.ค.: ไม่เก็บบทถอดเต็มในผล (ผลไปอยู่ทั้งคลัง สำเนาถาวร และใบงานคิว — บวมจน getAll หนักกลับมา)
    //   เก็บแค่ความยาวไว้ดูย้อนหลัง · ส่งบทถอดคืนนอก insight ให้ผู้เรียกที่ต้องการ (สคริปต์ทดลอง) เท่านั้น
    single.transcriptChars = transcriptBlock.length;
    single.elapsedMs = Date.now() - t0;

    return {
      ok: true,
      spentTokens: single.usage.totalTokens,
      transcriptText: transcriptBlock.slice(0, TRANSCRIPT_STORE_CAP),
      insight: {
        engine: 'clip-single', schema: 'single-v1', promptRev: single.rev,
        headline: checked.headline, body: checked.body, rawData: checked.body,
        checks: checked.checks, clipDurationSec: dur, caption, single,
      },
    };
  } catch (e) {
    return fail('SINGLE_INTERNAL', e?.message || e);
  }
}
