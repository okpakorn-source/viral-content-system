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
import { llmCost } from '../../costRates.js';
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
 *   usageLogger    Optional logApiUsage replacement; CLIP_USAGE_LOG=0 disables persistence
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
  const topicsV2Enabled = process.env.CLIP_TOPIC_V2 === '1';
  const brain = {
    rev: PIPELINE_REV, verifyRev: VERIFY_REV, source: isYT ? 'link' : 'file',
    steps: [], costs: {}, degradations: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, cachedPct: 0, estUsd: 0 },
  };
  let durSec = Number(pick("durationSec")) || 0;

  // 📐 เลข "รวม" มี 2 ตัวโดยตั้งใจ (ผู้ตรวจไขว้ 6 ก.ย. 69):
  //   brain.usage.* และ steps[i].inputTokens|outputTokens|cachedTokens = รวม "ทุก attempt" ที่ Gemini คืน usage (= บิลจริง รวมรอบที่ retry)
  //   brain.totalTokens / spentTokens / steps[i].tokens / brain.costs = เฉพาะ "รอบสุดท้ายที่รับผล" (ของเดิม หน้าเว็บ BrainBox อ่านอยู่ ห้ามเปลี่ยน)
  //   estUsd = ประมาณการจาก costRates คิดโทเคนแคชราคาเต็ม → สูงกว่าบิลจริง (Gemini คิดแคชถูกกว่า) — ยังไม่ใส่ส่วนลดจนเจ้าของเคาะอัตรา
  const usageLogger = pick('usageLogger');
  const onUsage = async (usage) => {
    // Count every Gemini attempt, even failed responses and when persistence is disabled.
    const sum = brain.usage;
    sum.inputTokens += usage.inputTokens;
    sum.outputTokens += usage.outputTokens;
    sum.cachedTokens += usage.cachedTokens;
    sum.totalTokens += usage.totalTokens;
    sum.cachedPct = sum.inputTokens > 0 ? Math.round(Math.min(100, Math.max(0, sum.cachedTokens / sum.inputTokens * 100))) : 0; // จำนวนเต็ม 0-100 ตามสเปก
    // Estimate only: existing rates do not apply a cached-input discount.
    sum.estUsd += llmCost('gemini', usage.model, usage.inputTokens, usage.outputTokens);
    if (process.env.CLIP_USAGE_LOG === '0') return;
    try {
      const logger = typeof usageLogger === 'function'
        ? usageLogger
        : (await import('../../ai/usageLogger.js')).logApiUsage;
      await logger(usage);
    } catch { /* Missing DB/imports and logger failures must not fail the pipeline. */ }
  };

  const step = (name) => { brain.steps.push({ name, at: new Date().toISOString() }); log(name); };
  const spent = () => Object.values(brain.costs)
    .filter((v) => typeof v === 'number' && v > 100).reduce((a, b) => a + b, 0);
  const track = (label, r) => {
    const usage = (r.receipt?.attempts || []).reduce((sum, attempt) => ({
      inputTokens: sum.inputTokens + (attempt.usage?.promptTokenCount || 0),
      outputTokens: sum.outputTokens + (attempt.usage?.candidatesTokenCount || 0),
      cachedTokens: sum.cachedTokens + (attempt.usage?.cachedContentTokenCount || 0),
    }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
    brain.steps.push({
      name: label, model: r.receipt?.model, ok: r.ok, ms: r.receipt?.elapsedMs,
      attempts: r.receipt?.attempts?.length, tokens: r.receipt?.usage?.totalTokenCount || 0,
      finishReason: r.receipt?.finishReason, errorType: r.errorType,
      ...usage,
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
      feature: 'clipBrain-map', onUsage,
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
    let segmentResults = [];
    let syncTopicsV2FromLegacy;
    if (segments) {
      const results = await Promise.all(segments.map((s, i) =>
        callClipGeminiVideo({
          ...linkArgs, prompt: VIDEO_INSIGHT_PROMPT, videoRange: [s.startSec, s.endSec],
          maxTokens: 32000, ...(model ? { model } : {}),
          feature: 'clipBrain-segment', onUsage,
        }).then((r) => { track(`ถอดช่วง ${i + 1} (${mmss(s.startSec)}-${mmss(s.endSec)})`, r); return { seg: s, r }; })));
      const okRes = results.filter((x) => x.r.ok);
      segmentResults = okRes;
      if (!okRes.length) return fail('PIPE_EXTRACT_FAILED', 'ถอดไม่สำเร็จสักช่วง');
      if (okRes.length < results.length) {
        brain.degradations.push({ type: 'segment-incomplete', got: okRes.length, want: results.length, note: 'บางช่วงถอดไม่สำเร็จ เนื้ออาจขาด' });
        log(`⚠️ สำเร็จ ${okRes.length}/${results.length} ช่วง`);
      }
      insight = normalizeInsight(mergeSegments(okRes, map, durSec), 'clip-brain');
    } else {
      const r = await callClipGeminiVideo({ ...linkArgs, prompt: VIDEO_INSIGHT_PROMPT, maxTokens: 32000, ...(model ? { model } : {}), feature: 'clipBrain-segment', onUsage });
      track('ถอดทั้งคลิป', r);
      if (!r.ok) return fail(r.errorType || 'PIPE_EXTRACT_FAILED', r.error || 'ถอดไม่สำเร็จ');
      segmentResults = [{ seg: { no: 1, startSec: 0, endSec: durSec || null }, r }];
      insight = normalizeInsight({ ...r.data, clipDurationSec: durSec || r.data?.clipDurationSec }, 'clip-brain');
    }
    log(`⇒ เนื้อ ${String(insight.rawData || '').length} ตัว · ประเด็นย่อย ${(insight.subStories || []).length} · คำพูด ${(insight.quotes || []).length}`);

    // ── ④ ขอเฉลย ─────────────────────────────────────────────────────
    // 🔑 ตั้งแต่จุดนี้ไป "ล้มก็ยังส่งของได้" — เนื้อถอดเสร็จแล้ว การตรวจเป็นของแถมที่ดี
    //    ถ้าขอเฉลย/ตรวจ/ซ่อม ล้ม → คืนเนื้อพร้อมธงบอกว่าไม่ได้ตรวจ ดีกว่าทิ้งเงินที่จ่ายไปแล้ว
    step('ขอเฉลยจากคลิป');
    const truthRes = await callClipGeminiVideo({ ...linkArgs, prompt: TRUTH_PROMPT, maxTokens: 60000, ...(model ? { model } : {}), feature: 'clipBrain-truth', onUsage });
    track('เฉลย', truthRes);
    // เฉลยกลับมาเป็น JSON (transcription + onScreenText) → แปลงเป็นข้อความให้ตัวตรวจใช้
    const truthText = truthRes.ok
      ? (typeof truthRes.data === 'string' ? truthRes.data : JSON.stringify(truthRes.data))
      : '';
    if (!truthText || truthText.length < TRUTH_MIN_CHARS) {
      brain.degradations.push({ type: 'truth-unavailable', why: truthRes.errorType || 'เฉลยสั้นเกินไป' });
      if (topicsV2Enabled) brain.degradations.push({ type: 'topics-v2-skipped-no-truth' });
      brain.status = 'ไม่ได้ตรวจ';
      brain.check = { code: null, ai: null, repair: null };
      return done(insight, brain, t0, spent());
    }
    log(`เฉลย ${truthText.length} ตัวอักษร`);

    // Optional P3: keep the completed extraction when composition fails. The CLI
    // dependency stays injected, so disabled runs never import the composer.
    if (topicsV2Enabled) {
      step('เรียบเรียงประเด็น v2');
      const composeStarted = Date.now();
      try {
        const [{ buildEvidencePackFromPipeline }, { composeTopics }, schema] = await Promise.all([
          import('./topicEvidence.js'), import('./composeTopics.js'), import('./topicSchema.js'),
        ]);
        const evidencePack = buildEvidencePackFromPipeline({
          truth: truthRes.data, segmentResults, plannedSegments: segments, map, durSec,
          clipMeta: { url, title: caption, platform: isYT ? 'youtube' : 'file' },
        });
        const envText = (key) => String(process.env[key] || '').trim();
        const primary = { brain: 'codex', model: envText('CLIP_TOPIC_MODEL') || 'gpt-6-astra',
          effort: envText('CLIP_TOPIC_EFFORT') || 'ultra' };
        const fallback = { brain: 'claude', model: envText('CLIP_TOPIC_FALLBACK_MODEL') || 'claude-fable-5',
          effort: envText('CLIP_TOPIC_FALLBACK_EFFORT') || 'max' };
        const requestedTimeout = Number(envText('CLIP_TOPIC_TIMEOUT_MS'));
        const timeoutMs = Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0 && requestedTimeout <= 2147483647
          ? requestedTimeout : 1200000;
        // CLIP_TOPIC_FALLBACK_ON_TIMEOUT=1 = ให้ลองตัวสำรองแม้ตัวหลักหมดเวลา (ค่าเริ่มต้นข้าม ประหยัดเวลาคลิปยาว)
        const composed = await composeTopics({ evidencePack, runBrain, primary, fallback, timeoutMs, skipFallbackOnTimeout: envText('CLIP_TOPIC_FALLBACK_ON_TIMEOUT') !== '1' });
        const attempts = Array.isArray(composed.attempts) ? structuredClone(composed.attempts) : [];
        const composeUSD = attempts.reduce((sum, a) => sum + (Number.isFinite(a.costUSD) && a.costUSD >= 0 ? a.costUSD : 0), 0);
        if (composed.ok) {
          const attached = normalizeInsight(schema.toLegacyInsight(composed.doc, insight), 'clip-brain');
          const receipt = { ok: true, gate: composed.gate, summary: composed.metrics?.summary,
            stories: composed.doc.stories.length, attempts, elapsedMs: Date.now() - composeStarted };
          insight = attached;
          syncTopicsV2FromLegacy = schema.syncTopicsV2FromLegacy;
          brain.topicsV2 = receipt;
          brain.costs.composeUSD = composeUSD;
          log(`ประเด็น v2: ${receipt.stories} เรื่อง · ${attempts.length} attempts · $${composeUSD.toFixed(4)}`);
        } else {
          const reason = composed.errorType || composed.gate?.reasons?.join('; ') || 'COMPOSE_FAILED';
          brain.topicsV2 = { ok: false, attempts, reason };
          brain.costs.composeUSD = composeUSD;
          brain.degradations.push({ type: 'topics-v2-failed', why: reason });
          log(`ประเด็น v2 ไม่สำเร็จ (${reason}) → ใช้ผลถอดเดิม`);
        }
      } catch (error) {
        const why = String(error?.message || error).slice(0, 500);
        brain.topicsV2 = { ok: false, attempts: [], reason: why };
        brain.degradations.push({ type: 'topics-v2-crashed', why });
        log(`ประเด็น v2 ขัดข้อง (${why}) → ใช้ผลถอดเดิม`);
      }
    }

    // ── ⑤ ตรวจ 2 ชั้น ────────────────────────────────────────────────
    step('ตรวจเทียบเฉลย');
    const codeCheck = checkAgainstTruth(insight, truthText, { caption, plannedSegments: segments });
    log(`ชั้นโค้ด: ${codeCheck.verdict} · เจอ ${codeCheck.findings.length} จุด`);

    let aiCheck = null;
    const cr = await runBrain({
      brain: 'codex', label: 'ผู้ตรวจ', timeoutMs: 300000,
      prompt: buildReviewPrompt({ insight, truth: truthText, caption, codeFindings: codeCheck.findings }),
    });
    if (cr.ok && cr.json) {
      aiCheck = { ...cr.json, ...(Array.isArray(cr.json.findings)
        ? { findings: cr.json.findings.map((f) => ({ ...f, side: 'ความจริง' })) } : {}) };
      log(`ชั้นสมอง: ${aiCheck.verdict} · เจอ ${(aiCheck.findings || []).length} จุด`);
    } else {
      brain.degradations.push({ type: 'reviewer-unavailable', why: cr.errorType });
      log(`⚠ ผู้ตรวจล้ม (${cr.errorType}) — ข้ามชั้นสมอง ติดธงไว้`);
    }

    // ── ⑥ ซ่อมเฉพาะจุด ───────────────────────────────────────────────
    const aiFindings = Array.isArray(aiCheck?.findings) ? aiCheck.findings : [];
    const aiHigh = aiFindings.filter((f) => f?.severity === 'สูง');
    const high = [...codeCheck.findings, ...aiHigh].filter((f) => f.severity === 'สูง');
    let repair = null;
    if (high.length) {
      step(`ซ่อมเฉพาะจุด (${high.length} จุด)`);
      const toFix = high.slice(0, REPAIR_CAP);
      repair = { changed: [], unverifiedAi: aiHigh };
      if (high.length > REPAIR_CAP) brain.degradations.push({ type: 'repair-capped', got: REPAIR_CAP, want: high.length });
      const rr = await runBrain({
        brain: 'claude', label: 'ตัวซ่อม', timeoutMs: 600000,
        prompt: buildRepairPrompt({ insight, truth: truthText, findings: toFix }),
      });
      if (rr.ok && rr.json?.patch) {
        const applied = applyRepairPatch(insight, rr.json.patch, { findings: toFix, changed: rr.json.changed, unfixed: rr.json.unfixed });
        insight = applied.insight;
        const unverifiedAi = aiHigh.filter((f) => !applied.resolvedFindings.includes(toFix.indexOf(f) + 1));
        // คง note/unfixed เป็น array ข้อความสำหรับผู้ใช้ข้อมูลเดิม; เก็บ findings เดิมครบใน unverifiedAi
        const reportText = (items, key) => Array.isArray(items)
          ? items.map((item) => typeof item === 'string' ? item : `#${item?.fromFinding ?? '?'} ${String(item?.[key] || '')}`)
          : items;
        repair = { changed: applied.changed, note: reportText(rr.json.changed, 'summary'), unfixed: reportText(rr.json.unfixed, 'reason'),
          rejected: applied.rejected, costUSD: rr.costUSD, unverifiedAi, resolvedFindings: applied.resolvedFindings };
        brain.costs.repairUSD = rr.costUSD || 0;
        const re = checkAgainstTruth(insight, truthText, { caption, plannedSegments: segments });
        brain.recheck = { verdict: unverifiedAi.length ? 'ต้องตรวจ' : re.verdict, findings: re.findings.length,
          high: re.findings.filter((f) => f.severity === 'สูง').length, unverifiedAi: unverifiedAi.length };
        log(`ซ่อมแล้ว: ${(applied.changed || []).join(', ') || '(ไม่มีช่องผ่านด่าน)'} · ตรวจซ้ำ ${brain.recheck.verdict} · AI ยังไม่ยืนยัน ${unverifiedAi.length} จุด`);
      } else {
        brain.degradations.push({ type: 'repair-failed', why: rr.errorType });
        log(`⚠ ซ่อมไม่สำเร็จ (${rr.errorType}) — เก็บของเดิมพร้อมธง`);
      }
    }

    if (insight.topicsV2 && syncTopicsV2FromLegacy) {
      const synced = syncTopicsV2FromLegacy(insight);
      insight = synced.insight;
      brain.topicsV2.syncedAfterRepair = synced.changed;
    }

    brain.check = { code: codeCheck, ai: aiCheck, repair };
    if (insight.topicsV2?.schemaVersion === 2) {
      try {
        const { assessReadiness, quoteCoverage } = await import('./clipVerify.js');
        const readiness = await assessReadiness(insight, { truth: truthText });
        const qualityById = new Map(readiness.stories.map((s) => [s.id, { status: 'checked', issues: s.issues }]));
        for (const story of insight.topicsV2.stories || []) {
          story.quality = structuredClone(qualityById.get(story.id));
          for (const quote of story.quotes || []) {
            quote.verification = quoteCoverage(quote.text, truthText) >= 0.6 ? 'verified' : 'unverified';
          }
        }
        insight.topicsV2.mainStoryQuality = { status: 'checked', issues: readiness.mainStory.issues };
        for (const story of insight.subStories || []) {
          if (qualityById.has(story.storyId)) story.quality = structuredClone(qualityById.get(story.storyId));
        }
        const byCode = {};
        for (const issue of [...readiness.stories.flatMap((s) => s.issues), ...readiness.mainStory.issues]) {
          byCode[issue.code] = (byCode[issue.code] || 0) + 1;
        }
        brain.check.readiness = { findings: readiness.findings, counts: { stories: readiness.stories.length,
          withIssues: readiness.stories.filter((s) => s.issues.length).length, byCode } };
      } catch (e) {
        brain.degradations.push({ type: 'readiness-crashed', why: String(e?.message || e) });
      }
    }
    const highLeft = brain.recheck
      ? brain.recheck.high + brain.recheck.unverifiedAi
      : high.length;
    const truthFindings = [...codeCheck.findings, ...aiFindings];
    const lowCount = truthFindings.filter((f) => f?.severity === 'ต่ำ').length;
    if (lowCount) brain.check.lowCount = lowCount;
    const anyFinding = truthFindings.filter((f) => f?.severity === 'สูง' || f?.severity === 'กลาง').length;
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
