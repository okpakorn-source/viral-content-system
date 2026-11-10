/**
 * News Studio — แกนของทางเข้าท่อ Discord (10 พ.ย. 69) · ฟังก์ชันล้วน รับของจริงทุกตัวผ่าน deps (เทสพฤติกรรมได้โดยไม่ยิง API ไม่แตะฐานข้อมูล)
 * ตัวต่อของจริงอยู่ที่ discordFlow.js
 *
 * สัญญา = แบบเดียวกับ processAutoFlowText: สำเร็จคืน { success:true, data } · ล้ม "โยน" Error ที่มี failedStep + errorType
 *   (ห้ามคืน success:false — /api/auto/process จะตกไปใช้ท่อสำรองเก่าแบบเงียบๆ)
 */
import { toLegacyData, toGenerationLog } from './legacyResult.js';

/** งบเวลาของงานจากบอท: คิวให้เวลางานข่าวมากกว่าหน้าเว็บ (เส้นตายของ worker 770 วินาที) — ให้รอบแก้ทำงานได้ครบก่อนตัดงาน */
export const DISCORD_BUDGET = Object.freeze({ retryDeadlineMs: 240000, hardMs: 420000 });

function fail(message, failedStep, errorType) {
  const err = new Error(message);
  err.failedStep = failedStep;
  err.errorType = errorType || 'NEWS_STUDIO_FAILED';
  return err;
}

/**
 * @param {object} p        { text, user:{userId,userName}, workflowId, deskMeta }
 * @param {object} deps     { runStudioJob, logGeneration, attachCaseId, logPipeline?, useResearch?, now? }
 * @returns {Promise<{success:true, data:object}>}
 */
export async function runDiscordStudioJob({ text, user, workflowId, deskMeta = null }, deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const logPipeline = typeof deps.logPipeline === 'function' ? (e) => { try { const p = deps.logPipeline(e); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* บันทึกขั้นตอนพัง ไม่ทำให้งานพัง */ } } : () => {};
  const rawText = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const userId = String(user?.userId || 'discord-bot');
  const started = now();
  let run;
  try {
    run = await deps.runStudioJob({
      rawText,
      useResearch: !!deps.useResearch,
      user: { username: userId, displayName: String(user?.userName || userId) },
      source: 'discord',
      budget: DISCORD_BUDGET,
    });
  } catch (e) {
    // runStudioJob โยนเฉพาะตอนงานยังไม่เริ่ม — ส่งต่อเป็นงานล้มที่บอกขั้น
    throw fail(`ระบบเขียนข่าวเริ่มงานไม่ได้: ${String(e?.message || e).slice(0, 200)}`, 'news_studio_start', e?.errorType);
  }
  if (!run || run.status !== 'done') {
    logPipeline({ workflowId, step: 'news-studio', status: 'failed', duration: now() - started, error: run?.error, metadata: { runId: run?.id, errorType: run?.errorType }, userId });
    throw fail(run?.error || 'ระบบเขียนข่าวไม่สำเร็จ', 'news_studio_write', run?.errorType);
  }

  // บันทึกลงคลัง "ผลงานที่เขียนแล้ว" (ลิงก์ที่บอทส่งให้พนักงานชี้ไปที่เคสนี้) — บันทึกไม่ได้ = ไม่มีลิงก์ แต่ข่าวยังถูกส่ง
  let caseId = null;
  try {
    const logged = await deps.logGeneration(toGenerationLog(run, { userId, deskMeta }));
    if (logged?.success && logged.caseId) caseId = String(logged.caseId);
  } catch { /* ตัวบันทึกไม่โยนตามสัญญา — กันไว้อีกชั้น */ }
  // รอให้ผูกเลขเคสเสร็จก่อนคืนผล: บนโฮสต์แบบฟังก์ชัน งานที่ยิงทิ้งไว้หลังตอบกลับมักไม่ถูกทำต่อ (ล้มได้ ไม่กระทบข่าว)
  if (caseId) { try { await deps.attachCaseId(run.id, caseId); } catch { /* ไม่มีเลขเคสในประวัติของสตูดิโอ แต่ข่าวและลิงก์ยังครบ */ } }

  const data = toLegacyData(run, { caseId });
  if (!caseId) data.analysisResult.qualityWarnings.push('บันทึกเคสลงคลังผลงานไม่สำเร็จ — งานนี้ไม่มีลิงก์ดูย้อนหลัง');
  logPipeline({
    workflowId, step: 'news-studio', status: 'success', duration: now() - started, userId,
    metadata: { runId: run.id, caseId, versions: data.analysisResult.versions.length, passed: run.summary?.passed ?? null, warnings: (run.warnings || []).map((w) => w.code) },
  });
  return { success: true, data };
}

/**
 * ข้อความเตือนเมื่อระบบเขียนตัวใหม่ล้มแล้วงานถูกส่งต่อให้นักเขียนชุดเดิม — พนักงานต้องรู้ว่าข่าวที่ได้มาจากระบบไหน (ห้ามถอยเงียบ)
 */
export function fallbackWarning(err) {
  const why = String(err?.message || err || 'ไม่ทราบสาเหตุ').replace(/\s+/g, ' ').slice(0, 160);
  return `ให้พนักงานตรวจบริบทก่อนโพสต์: ข่าวนี้เขียนด้วยระบบเดิม เพราะระบบเขียนตัวใหม่ล้ม (${why})`;
}
