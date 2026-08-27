/**
 * 🧠🎬 clipBrainPipeline — เครื่องยนต์ถอดคลิปตัวใหม่ (ตัวจริง ไม่ใช่สคริปต์ทดลอง)
 * ────────────────────────────────────────────────────────────────────────────
 * เจ้าของสั่ง 27 ส.ค. 69: "เสียบโค้ดใหม่ให้รันได้เลย แต่เอาเครื่องยนต์เดิมเป็นตัวสำรอง
 *                          เวลามีปัญหา เช่น โควตาหมด/เซิร์ฟเวอร์ล่ม ให้กลับไปเหมือนเดิมก่อน"
 *
 * ท่อทำงาน (ยกมาจาก scratch/newpipe/run-newpipe.mjs ที่พิสูจน์แล้ว 4 คลิปจริง):
 *   ① ดูทั้งคลิป → แผนที่ประเด็น   ② สมองวางแผนผ่าท่อน (คลิปยาว)   ③ ถอดทีละท่อนขนาน
 *   ④ ขอ "เฉลย" คำต่อคำ            ⑤ ตรวจ 2 ชั้น (โค้ด + สมอง)      ⑥ ซ่อมเฉพาะจุด → ตรวจซ้ำ
 *
 * 🔴 สัญญาที่ห้ามผิด:
 *   1. **ไม่โยน error เด็ดขาด** — ทุกทางล้มคืน { ok:false, errorType, error, brain }
 *      ผู้เรียกจะได้ถอยไปเครื่องยนต์เดิมได้ (นี่คือหัวใจของ "ตัวสำรอง")
 *   2. ไม่เขียนไฟล์ ไม่ process.exit ไม่แตะคลัง — ผู้เรียกจัดการเอง
 *   3. ล้มตั้งแต่ต้น (ยังไม่เปลืองมาก) กับล้มตอนท้าย (จ่ายไปเยอะแล้ว) ต้องแยกให้ผู้เรียกรู้
 *      ผ่าน field `spentTokens` — ผู้เรียกตัดสินใจได้ว่าจะถอยหรือใช้ของที่ได้มา
 */
import { callClipGeminiVideo } from './clipGeminiVideo.js';
import { buildPlanPrompt, validatePlan, fallbackPlan } from './segmentPlan.js';
import { runBrain } from './brainRunner.js';
import {
  TRUTH_PROMPT, checkAgainstTruth, buildReviewPrompt, buildRepairPrompt,
  applyRepairPatch, VERIFY_REV,
} from './clipVerify.js';
// ⚠️ ต้องมี .js — Next แปลชื่อย่อได้ แต่ node --test (ที่ข้อสอบใช้) ไม่รู้จัก (บทเรียนบั๊ก #1)
import { VIDEO_INSIGHT_PROMPT, normalizeInsight } from '../clipInsightService.js';

export const PIPELINE_REV = 'clip-brain-pipeline-v1-0827';

const SEGMENT_MIN_SEC = 480;      // สั้นกว่านี้ไม่ต้องผ่าท่อน (ถอดรอบเดียวพอ)
const REPAIR_CAP = 12;            // ซ่อมได้สูงสุดกี่จุดต่อรอบ (บทเรียน: ส่งเยอะเกิน = ตัวซ่อมหมดเวลา)
const TRUTH_MIN_CHARS = 200;      // เฉลยสั้นกว่านี้ = ตรวจชั้นสมองไม่มีประโยชน์

const mmss = (n) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
const log = (...a) => { try { console.log('[ClipBrainPipeline]', ...a); } catch {} };

/**
 * @param {object} opts
 *   url            ลิงก์คลิป (ใช้เป็น youtubeUrl เมื่อ isYouTube)
 *   isYouTube      true = ให้ Gemini ดูลิงก์เอง · false = ส่งไฟล์
 *   videoBuffer    ไฟล์คลิป (เมื่อ !isYouTube) — ผู้เรียกต้องบีบให้ ≤19MB มาแล้ว
 *   durationSec    ความยาวคลิป (0 = ไม่รู้ ให้ AI บอกเอง)
 *   caption        แคปชั่น/ชื่อคลิป (ใช้เป็นหลักฐานตอนตรวจชื่อ)
 *   model          รุ่น Gemini (ไม่ส่ง = ค่าเริ่มต้นของระบบ)
 * @returns {Promise<{ok:boolean, insight?:object, brain:object, errorType?:string, error?:string, spentTokens:number}>}
 */
export async function runClipBrainPipeline(rawOpts) {
  const t0 = Date.now();
  // 🔴 สัญญา "ไม่โยน" ต้องเริ่มตั้งแต่บรรทัดแรก — บทเรียน CB-09 ที่ผู้ตรวจอิสระเคยจับใน brainRunner
  //    (ค่า null/ตัวเลข/สตริง ที่ไม่ใช่ object ต้องกลายเป็น ok:false ไม่ใช่ TypeError หลุดออกไป
  //     ไม่งั้นตัวสำรองไม่ทำงาน = งานล้มทั้งใบ) · เทสจับได้จริงตอนเขียนรอบแรก
  const opts = (rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts)) ? rawOpts : {};
  const pick = (k) => { try { return opts[k]; } catch { return undefined; } };
  const url = String(pick('url') == null ? '' : pick('url'));
  const isYT = !!pick('isYouTube');
  const caption = String(pick('caption') == null ? '' : pick('caption'));
  const model = typeof pick('model') === 'string' ? pick('model') : '';
  const brain = {
    rev: PIPELINE_REV, verifyRev: VERIFY_REV, source: isYT ? 'link' : 'file',
    steps: [], costs: {}, degradations: [],
  };
  let durSec = Number(pick("durationSec")) || 0;

  const step = (name) => { brain.steps.push({ name, at: new Date().toISOString() }); log(name); };
  const spent = () => Object.values(brain.costs)
    .filter((v) => typeof v === 'number' && v > 100).reduce((a, b) => a + b, 0);
  const track = (label, r) => {
    brain.steps.push({
      name: label, model: r.receipt?.model, ok: r.ok, ms: r.receipt?.elapsedMs,
      attempts: r.receipt?.attempts?.length, tokens: r.receipt?.usage?.totalTokenCount || 0,
      finishReason: r.receipt?.finishReason, errorType: r.errorType,
    });
    brain.costs[label] = r.receipt?.usage?.totalTokenCount || 0;
    if (r.receipt?.degradations?.length) {
      brain.degradations.push(...r.receipt.degradations.map((d) => ({ ...d, at: label })));
    }
  };
  const fail = (errorType, error) => {
    brain.elapsedMs = Date.now() - t0;
    brain.totalTokens = spent();
    brain.failedAt = errorType;
    log(`✗ ${errorType} — ${String(error).slice(0, 140)} (ใช้ไป ${brain.totalTokens} token)`);
    return { ok: false, errorType, error: String(error).slice(0, 500), brain, spentTokens: brain.totalTokens };
  };

  try {
    if (!url && !pick("videoBuffer")) return fail('PIPE_NO_SOURCE', 'ไม่มีทั้งลิงก์และไฟล์คลิป');
    const linkArgs = isYT ? { youtubeUrl: url } : { videoBuffer: pick("videoBuffer") };

    // ── ① แผนที่ประเด็น ──────────────────────────────────────────────
    step('แผนที่ประเด็น');
    const mapRes = await callClipGeminiVideo({
      ...linkArgs, maxTokens: 8000, ...(model ? { model } : {}),
      prompt: 'ดูคลิปนี้ทั้งคลิปแล้วทำ "แผนที่ประเด็น" — คลิปพูดเรื่องอะไรบ้าง แต่ละเรื่องอยู่ช่วงเวลาไหน\nตอบ JSON บรรทัดเดียว: {"timeline":[{"time":"0:00-1:30","topic":"ชื่อประเด็น"}],"headline":"พาดหัวสั้นๆ","clipDurationSec":ความยาวคลิปเป็นวินาที}',
    });
    track('แผนที่ประเด็น', mapRes);
    if (!mapRes.ok) return fail(mapRes.errorType || 'PIPE_MAP_FAILED', mapRes.error || 'ทำแผนที่ประเด็นไม่สำเร็จ');
    const map = mapRes.data || {};
    if (!durSec) durSec = Number(map.clipDurationSec) || 0;
    log(`ตาเห็น ${(map.timeline || []).length} ประเด็น · ยาว ${durSec ? mmss(durSec) : '?'}`);

    // ── ② สมองวางแผนผ่าท่อน (เฉพาะคลิปยาว) ───────────────────────────
    let segments = null;
    if (durSec >= SEGMENT_MIN_SEC) {
      step('สมองวางแผนผ่า');
      const br = await runBrain({
        brain: 'claude', label: 'วางแผนผ่า', timeoutMs: 240000,
        prompt: buildPlanPrompt({ durationSec: durSec, timeline: map.timeline || [], headline: map.headline || '', caption }),
      });
      if (br.ok) {
        const v = validatePlan(br.json?.segments, durSec);
        if (v.ok) {
          segments = v.segments;
          brain.costs.planUSD = br.costUSD || 0;
          log(`สมองวางแผน ${segments.length} ท่อน · $${(br.costUSD || 0).toFixed(4)}`);
        } else {
          segments = fallbackPlan(durSec);
          brain.degradations.push({ type: 'plan-fallback', why: v.reason });
          log(`แผนสมองใช้ไม่ได้ (${v.reason}) → แผนสำรอง ${segments.length} ท่อน`);
        }
      } else {
        // 🔑 สมองล้ม (โควตาหมด/ไม่มี CLI) ไม่ใช่เหตุให้ทิ้งงาน — ใช้แผนสำรองที่โค้ดคิดเองได้
        segments = fallbackPlan(durSec);
        brain.degradations.push({ type: 'plan-brain-unavailable', why: br.errorType });
        log(`สมองวางแผนไม่ได้ (${br.errorType}) → แผนสำรอง ${segments.length} ท่อน`);
      }
      if (!segments || !segments.length) segments = null;
    }

    // ── ③ ถอดเนื้อ ───────────────────────────────────────────────────
    step('ถอดเนื้อ');
    let insight;
    if (segments) {
      const results = await Promise.all(segments.map((s, i) =>
        callClipGeminiVideo({
          ...linkArgs, prompt: VIDEO_INSIGHT_PROMPT, videoRange: [s.startSec, s.endSec],
          maxTokens: 32000, ...(model ? { model } : {}),
        }).then((r) => { track(`ถอดช่วง ${i + 1} (${mmss(s.startSec)}-${mmss(s.endSec)})`, r); return { seg: s, r }; })));
      const okRes = results.filter((x) => x.r.ok);
      if (!okRes.length) return fail('PIPE_EXTRACT_FAILED', 'ถอดไม่สำเร็จสักช่วง');
      if (okRes.length < results.length) {
        brain.degradations.push({ type: 'segment-incomplete', got: okRes.length, want: results.length, note: 'บางช่วงถอดไม่สำเร็จ เนื้ออาจขาด' });
        log(`⚠️ สำเร็จ ${okRes.length}/${results.length} ช่วง`);
      }
      insight = normalizeInsight(mergeSegments(okRes, map, durSec), 'clip-brain');
    } else {
      const r = await callClipGeminiVideo({ ...linkArgs, prompt: VIDEO_INSIGHT_PROMPT, maxTokens: 32000, ...(model ? { model } : {}) });
      track('ถอดทั้งคลิป', r);
      if (!r.ok) return fail(r.errorType || 'PIPE_EXTRACT_FAILED', r.error || 'ถอดไม่สำเร็จ');
      insight = normalizeInsight({ ...r.data, clipDurationSec: durSec || r.data?.clipDurationSec }, 'clip-brain');
    }
    log(`⇒ เนื้อ ${String(insight.rawData || '').length} ตัว · ประเด็นย่อย ${(insight.subStories || []).length} · คำพูด ${(insight.quotes || []).length}`);

    // ── ④ ขอเฉลย ─────────────────────────────────────────────────────
    // 🔑 ตั้งแต่จุดนี้ไป "ล้มก็ยังส่งของได้" — เนื้อถอดเสร็จแล้ว การตรวจเป็นของแถมที่ดี
    //    ถ้าขอเฉลย/ตรวจ/ซ่อม ล้ม → คืนเนื้อพร้อมธงบอกว่าไม่ได้ตรวจ ดีกว่าทิ้งเงินที่จ่ายไปแล้ว
    step('ขอเฉลยจากคลิป');
    const truthRes = await callClipGeminiVideo({ ...linkArgs, prompt: TRUTH_PROMPT, maxTokens: 60000, ...(model ? { model } : {}) });
    track('เฉลย', truthRes);
    // เฉลยกลับมาเป็น JSON (transcription + onScreenText) → แปลงเป็นข้อความให้ตัวตรวจใช้
    const truthText = truthRes.ok
      ? (typeof truthRes.data === 'string' ? truthRes.data : JSON.stringify(truthRes.data))
      : '';
    if (!truthText || truthText.length < TRUTH_MIN_CHARS) {
      brain.degradations.push({ type: 'truth-unavailable', why: truthRes.errorType || 'เฉลยสั้นเกินไป' });
      brain.status = 'ไม่ได้ตรวจ';
      brain.check = { code: null, ai: null, repair: null };
      return done(insight, brain, t0, spent());
    }
    log(`เฉลย ${truthText.length} ตัวอักษร`);

    // ── ⑤ ตรวจ 2 ชั้น ────────────────────────────────────────────────
    step('ตรวจเทียบเฉลย');
    const codeCheck = checkAgainstTruth(insight, truthText, { caption: caption || map.headline || '', plannedSegments: segments });
    log(`ชั้นโค้ด: ${codeCheck.verdict} · เจอ ${codeCheck.findings.length} จุด`);

    let aiCheck = null;
    const cr = await runBrain({
      brain: 'codex', label: 'ผู้ตรวจ', timeoutMs: 300000,
      prompt: buildReviewPrompt({ insight, truth: truthText, caption: caption || map.headline || '', codeFindings: codeCheck.findings }),
    });
    if (cr.ok && cr.json) {
      aiCheck = cr.json;
      log(`ชั้นสมอง: ${aiCheck.verdict} · เจอ ${(aiCheck.findings || []).length} จุด`);
    } else {
      brain.degradations.push({ type: 'reviewer-unavailable', why: cr.errorType });
      log(`⚠ ผู้ตรวจล้ม (${cr.errorType}) — ข้ามชั้นสมอง ติดธงไว้`);
    }

    // ── ⑥ ซ่อมเฉพาะจุด ───────────────────────────────────────────────
    const high = [...codeCheck.findings, ...((aiCheck?.findings) || [])].filter((f) => f.severity === 'สูง');
    let repair = null;
    if (high.length) {
      step(`ซ่อมเฉพาะจุด (${high.length} จุด)`);
      const toFix = high.slice(0, REPAIR_CAP);
      if (high.length > REPAIR_CAP) brain.degradations.push({ type: 'repair-capped', got: REPAIR_CAP, want: high.length });
      const rr = await runBrain({
        brain: 'claude', label: 'ตัวซ่อม', timeoutMs: 600000,
        prompt: buildRepairPrompt({ insight, truth: truthText, findings: toFix }),
      });
      if (rr.ok && rr.json?.patch) {
        const applied = applyRepairPatch(insight, rr.json.patch, { findings: toFix });
        insight = applied.insight;
        repair = { changed: applied.changed, note: rr.json.changed, unfixed: rr.json.unfixed, rejected: applied.rejected, costUSD: rr.costUSD };
        brain.costs.repairUSD = rr.costUSD || 0;
        const re = checkAgainstTruth(insight, truthText, { caption: caption || map.headline || '', plannedSegments: segments });
        brain.recheck = { verdict: re.verdict, findings: re.findings.length, high: re.findings.filter((f) => f.severity === 'สูง').length };
        log(`ซ่อมแล้ว: ${(applied.changed || []).join(', ') || '(ไม่มีช่องผ่านด่าน)'} · ตรวจซ้ำ ${re.verdict}`);
      } else {
        brain.degradations.push({ type: 'repair-failed', why: rr.errorType });
        log(`⚠ ซ่อมไม่สำเร็จ (${rr.errorType}) — เก็บของเดิมพร้อมธง`);
      }
    }

    brain.check = { code: codeCheck, ai: aiCheck, repair };
    const highLeft = brain.recheck
      ? brain.recheck.high
      : [...codeCheck.findings, ...((aiCheck?.findings) || [])].filter((f) => f.severity === 'สูง').length;
    const anyFinding = codeCheck.findings.length + ((aiCheck?.findings) || []).length;
    brain.status = repair
      ? (highLeft ? 'ต้องตรวจ' : 'ซ่อมแล้ว')
      : (highLeft ? 'ต้องตรวจ' : (anyFinding ? 'มีข้อสังเกต' : 'สะอาด'));
    return done(insight, brain, t0, spent());
  } catch (e) {
    // 🔴 กันพลาดชั้นสุดท้าย — ต้องไม่โยนออกไป ไม่งั้นตัวสำรองไม่ทำงาน
    return fail('PIPE_INTERNAL', (e && e.message) || e);
  }
}

function done(insight, brain, t0, tokens) {
  brain.elapsedMs = Date.now() - t0;
  brain.totalTokens = tokens;
  insight.brain = brain;
  log(`✓ เสร็จ · สถานะ ${brain.status} · ${Math.round(brain.elapsedMs / 1000)} วิ · ${tokens.toLocaleString()} token`);
  return { ok: true, insight, brain, spentTokens: tokens };
}

/** รวมผลถอดหลายท่อนเป็นใบเดียว (ยกจากสคริปต์ที่พิสูจน์แล้ว) */
function mergeSegments(okRes, map, durSec) {
  const first = okRes[0].r.data || {};
  return {
    clipType: first.clipType, category: first.category,
    clipDurationSec: durSec,
    headline: map.headline || first.headline,
    overview: okRes.map((x) => String(x.r.data?.overview || '')).filter(Boolean).join(' '),
    speakers: [...new Set(okRes.flatMap((x) => x.r.data?.speakers || []).map(String))],
    directLead: first.directLead,
    rawData: okRes.map((x) => String(x.r.data?.rawData || '')).filter(Boolean).join('\n\n'),
    quotes: [...new Set(okRes.flatMap((x) => x.r.data?.quotes || []).map(String))],
    timeline: map.timeline || [],
    keyPoints: okRes.flatMap((x) => x.r.data?.keyPoints || []),
    subStories: okRes.flatMap((x, i) => {
      const seg = x.seg;
      const subs = x.r.data?.subStories || [];
      const range = `${mmss(seg.startSec)}-${mmss(seg.endSec)}`;
      if (subs.length) return subs.map((s) => ({ ...s, timeRange: s.timeRange || range }));
      // ท่อนที่ AI ไม่ซอยประเด็นย่อยมาให้ → ทำเป็นก้อนเดียวของท่อนนั้น ไม่ให้เนื้อหาย
      return [{
        topic: (seg.topics || [])[0] || `ช่วงที่ ${i + 1}`, timeRange: range,
        rawData: String(x.r.data?.rawData || ''), quotes: x.r.data?.quotes || [], keyPoints: [],
      }];
    }),
  };
}
