// ============================================================
// 📊 Solver Shadow Metrics — สถิติ "เงา" solver (deterministic) vs LLM (brain) — PURE, ไม่มี IO
// ------------------------------------------------------------
// ขั้น A ของแผนเปิด solver: รวบรวม solverShadow/solverShadowV2 จากปกจริงที่ทำไปแล้ว → สรุปว่า
// solver เลือกตรงกับ LLM กี่ % ต่างกันตรงช่องไหน เพราะอะไร — ใช้ประกอบการตัดสินใจว่าจะเปิด solver
// จริงหรือไม่เท่านั้น. ไฟล์นี้ "อ่านอย่างเดียว" ในเชิง data — ไม่มี side effect ใดๆ ไม่แตะพฤติกรรมท่อ MEGA.
//
// สคีมาจริงที่พบใน src/lib/megaAdapters.js (~บรรทัด 4457-4674, 5178-5179) ที่ merge เข้า
// job.dossier.pickImages ทุกรอบ tick (ผ่าน dossierPatch — ดู src/lib/megaJobStore.js updateJob):
//
//   solverShadow (v1) = { v: 1, agree: number, total: number,
//     perSlot: [{ slot: string, llm: string|null, solver: string|null, match: boolean, top3: string[] }] }
//
//   solverShadowV2 (v2) = { v: 2, mode?, inputHash?,
//     candidateUniverse: { llmCount, solverCount, commonCount, identical, llmHash, solverHash, ... },
//     coverage: { total, persons, storyFit, note, orientation, shortSide, sharpness, faceBoxHFrac, sourceScore, pHash64 },
//     rawLlm: { slots: {...} }, postGateLlm: { slots: {...} },
//     solver: { slots: {...}, diagnostics: { v:2, topK, perSlot: [{ slotId, topK:[{rank,id,total,...}],
//       comparisons: { rawLlm:{...}, postGateLlm:{ imageId, status, rank, total, ... } }, exclusions }] } },
//     legacySolver?: { slots }, refSlotContract?: {...} }
//
// ทั้งสองก้อนเป็น "best effort shadow" — เขียนขึ้นใน try/catch ฝั่งท่อจริง ล้มได้ ฟิลด์หายได้เสมอ
// (เวอร์ชันเก่ากว่าอาจไม่มี v2 เลย, บาง perSlot อาจขาด top3 ฯลฯ) → ฟังก์ชันในไฟล์นี้ต้อง "ไม่ throw
// ไม่ว่า input จะประหลาดแค่ไหน" (ข้าม record/field ที่ผิดรูปแบบเงียบๆ แทน).
// ============================================================

function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

// เหตุผลที่ solver ↔ LLM เลือกต่างกัน — จัดหมวดจากฟิลด์ที่มีจริงใน perSlot เท่านั้น (slot/llm/solver/top3)
export const DIFF_REASON_LABELS = {
  hero_mismatch: 'ช่อง hero เลือกคนละภาพ (ต้องตรวจก่อนเปิดจริง — เสี่ยงเลือกผิดคน)',
  solver_hole: 'solver หาภาพลงช่องไม่ได้ (ช่องว่าง) แต่ LLM เลือกได้',
  llm_empty_solver_filled: 'LLM ปล่อยช่องว่าง แต่ solver หาภาพลงได้',
  near_miss_top3: 'เลือกคนละภาพ แต่ภาพที่ LLM เลือกติด top3 ของ solver (ใกล้เคียงกัน)',
  different_pick: 'เลือกคนละภาพ และไม่ติด top3 ของ solver (ต่างจริง)',
};

/** จัดหมวดเหตุผลที่ต่าง จากค่า slot/llm/solver/top3 ของ perSlot 1 ช่อง (ต้องเรียกเฉพาะตอน match===false) */
export function classifyDiffReason(slotName, llmId, solverId, top3 = []) {
  if (slotName === 'hero') return 'hero_mismatch';
  if (solverId == null && llmId != null) return 'solver_hole';
  if (llmId == null && solverId != null) return 'llm_empty_solver_filled';
  if (Array.isArray(top3) && llmId != null && top3.includes(llmId)) return 'near_miss_top3';
  return 'different_pick';
}

/**
 * รวมสถิติจาก array ของ solverShadow records (ปกจริงที่ทำเสร็จแล้ว)
 * @param {Array<{jobId?: string, at?: string, solverShadow?: object|null, solverShadowV2?: object|null}>} records
 * @returns {object} สรุปสถิติ — pure, ไม่ throw ไม่ว่า input จะว่าง/พังแค่ไหน
 */
export function aggregateSolverShadow(records) {
  const list = Array.isArray(records) ? records : [];

  const slotTotals = new Map();   // slotName -> { total, agree }
  const reasonCounts = new Map(); // reason -> count
  const reasonSamples = new Map(); // reason -> sample rows (max 5 ต่อเหตุผล)
  let overallTotal = 0;
  let overallAgree = 0;
  let runsWithShadowV1 = 0;
  let runsWithShadowV2 = 0;

  let solverScoreSum = 0, solverScoreCount = 0;   // solver.diagnostics.perSlot[].topK[0].total (v2 เท่านั้น)
  let llmRankSum = 0, llmRankCount = 0;            // อันดับของภาพที่ LLM เลือก ในสายตา solver (v2 เท่านั้น)
  let uniLlmSum = 0, uniSolverSum = 0, uniCommonSum = 0, uniIdenticalCount = 0, uniSampleCount = 0;

  for (const rec of list) {
    if (!isObj(rec)) continue;
    const jobId = rec.jobId != null ? String(rec.jobId) : null;
    const v1 = rec.solverShadow;
    const v2 = rec.solverShadowV2;

    if (isObj(v1) && Array.isArray(v1.perSlot)) {
      runsWithShadowV1++;
      for (const slotRec of v1.perSlot) {
        if (!isObj(slotRec) || typeof slotRec.slot !== 'string' || !slotRec.slot) continue; // ข้ามช่องที่ผิดรูปแบบเงียบๆ
        const slotName = slotRec.slot;
        const llmId = slotRec.llm != null ? String(slotRec.llm) : null;
        const solverId = slotRec.solver != null ? String(slotRec.solver) : null;
        const match = typeof slotRec.match === 'boolean' ? slotRec.match : (llmId === solverId);

        overallTotal++;
        if (match) overallAgree++;

        const st = slotTotals.get(slotName) || { total: 0, agree: 0 };
        st.total++;
        if (match) st.agree++;
        slotTotals.set(slotName, st);

        if (!match) {
          const top3 = Array.isArray(slotRec.top3)
            ? slotRec.top3.map((x) => (x != null ? String(x) : null)).filter(Boolean)
            : [];
          const reason = classifyDiffReason(slotName, llmId, solverId, top3);
          reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
          const samples = reasonSamples.get(reason) || [];
          if (samples.length < 5) samples.push({ jobId, slot: slotName, llm: llmId, solver: solverId });
          reasonSamples.set(reason, samples);
        }
      }
    }

    if (isObj(v2)) {
      runsWithShadowV2++;
      const cu = v2.candidateUniverse;
      if (isObj(cu)) {
        if (isNum(cu.llmCount) && isNum(cu.solverCount)) {
          uniLlmSum += cu.llmCount;
          uniSolverSum += cu.solverCount;
          uniCommonSum += isNum(cu.commonCount) ? cu.commonCount : 0;
          if (cu.identical === true) uniIdenticalCount++;
          uniSampleCount++;
        }
      }
      const perSlotDiag = v2.solver && isObj(v2.solver) ? v2.solver.diagnostics?.perSlot : null;
      if (Array.isArray(perSlotDiag)) {
        for (const sd of perSlotDiag) {
          if (!isObj(sd)) continue;
          if (Array.isArray(sd.topK) && isObj(sd.topK[0]) && isNum(sd.topK[0].total)) {
            solverScoreSum += sd.topK[0].total;
            solverScoreCount++;
          }
          const cmp = isObj(sd.comparisons) ? sd.comparisons.postGateLlm : null;
          if (isObj(cmp) && cmp.status === 'ranked' && isNum(cmp.rank)) {
            llmRankSum += cmp.rank;
            llmRankCount++;
          }
        }
      }
    }
  }

  const perSlot = {};
  for (const [slot, st] of slotTotals) {
    perSlot[slot] = { total: st.total, agree: st.agree, pct: st.total ? round1((st.agree / st.total) * 100) : null };
  }

  const totalDiffs = [...reasonCounts.values()].reduce((a, b) => a + b, 0);
  const diffReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({
      reason,
      label: DIFF_REASON_LABELS[reason] || reason,
      count,
      pct: totalDiffs ? round1((count / totalDiffs) * 100) : null,
    }))
    .sort((a, b) => b.count - a.count);

  const diffSamples = {};
  for (const [reason, arr] of reasonSamples) diffSamples[reason] = arr;

  return {
    totalRecords: list.length,
    runsWithShadowV1,
    runsWithShadowV2,
    overall: {
      total: overallTotal,
      agree: overallAgree,
      pct: overallTotal ? round1((overallAgree / overallTotal) * 100) : null,
    },
    perSlot,
    diffReasons,
    diffSamples,
    solverTopScore: { avg: solverScoreCount ? round2(solverScoreSum / solverScoreCount) : null, count: solverScoreCount },
    llmRankInSolver: { avg: llmRankCount ? round2(llmRankSum / llmRankCount) : null, count: llmRankCount },
    candidateUniverse: {
      avgLlmCount: uniSampleCount ? round1(uniLlmSum / uniSampleCount) : null,
      avgSolverCount: uniSampleCount ? round1(uniSolverSum / uniSampleCount) : null,
      avgCommonCount: uniSampleCount ? round1(uniCommonSum / uniSampleCount) : null,
      identicalPct: uniSampleCount ? round1((uniIdenticalCount / uniSampleCount) * 100) : null,
      sampleCount: uniSampleCount,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** จัดรูป summary ให้เป็นรายงานภาษาไทยอ่านง่าย (ใช้ทั้ง CLI + API) — pure, คืน string เดียว */
export function formatSolverShadowReport(summary) {
  const s = isObj(summary) ? summary : {};
  if (!s.totalRecords) {
    return 'ยังไม่มี shadow — ทำปกก่อน (ต้องมีปกที่ผ่านขั้น S6 อย่างน้อย 1 ใบ ถึงจะมี solverShadow ให้อ่าน)';
  }

  const lines = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('📊 รายงาน Solver Shadow — solver (คำนวณล้วน) เทียบ LLM (สมอง)');
  lines.push('═══════════════════════════════════════════');
  lines.push(`จำนวนงานที่อ่านได้ทั้งหมด: ${s.totalRecords} รอบ`);
  lines.push(`มี shadow v1 (นับตรง/ต่างต่อช่อง): ${s.runsWithShadowV1} รอบ`);
  lines.push(`มี shadow v2 (diagnostics เพิ่มเติม): ${s.runsWithShadowV2} รอบ`);
  lines.push('');

  if (s.overall && s.overall.total) {
    lines.push(`✅ ตรงกันรวม: ${s.overall.pct}% (${s.overall.agree}/${s.overall.total} ช่อง จากทุกงาน/ทุกช่องรวมกัน)`);
  } else {
    lines.push('⚠️ มีงานที่มี shadow แต่ไม่มีข้อมูล perSlot ที่ใช้ได้เลย');
  }
  lines.push('');

  const slotNames = Object.keys(s.perSlot || {});
  if (slotNames.length) {
    lines.push('ตารางความตรงต่อช่อง:');
    const sorted = slotNames.slice().sort((a, b) => (s.perSlot[a].pct ?? 0) - (s.perSlot[b].pct ?? 0)); // ต่างสุดก่อน
    for (const name of sorted) {
      const p = s.perSlot[name];
      lines.push(`  · ${name.padEnd(10, ' ')} ตรง ${p.pct}% (${p.agree}/${p.total})`);
    }
    const worst = sorted[0];
    if (worst && s.perSlot[worst].total) {
      const diffPct = round1(100 - (s.perSlot[worst].pct ?? 100));
      lines.push(`  → ช่องต่างที่สุด: ${worst} (ต่าง ${diffPct}%)`);
    }
    lines.push('');
  }

  if (s.diffReasons && s.diffReasons.length) {
    lines.push('เหตุผลที่เลือกต่างกัน (เรียงจากบ่อยสุด):');
    for (const r of s.diffReasons.slice(0, 6)) {
      lines.push(`  · ${r.label}: ${r.count} ครั้ง (${r.pct}% ของที่ต่างทั้งหมด)`);
    }
    const heroMismatch = s.diffReasons.find((r) => r.reason === 'hero_mismatch');
    if (heroMismatch && heroMismatch.count > 0) {
      lines.push(`  ⚠️ พบ hero mismatch ${heroMismatch.count} ครั้ง — ต้องตรวจก่อนเปิด solver จริง (เสี่ยงเลือกผิดคน)`);
    }
    lines.push('');
  }

  if (s.solverTopScore && s.solverTopScore.count) {
    lines.push(`คะแนนเฉลี่ยของภาพอันดับ 1 ที่ solver เลือก: ${s.solverTopScore.avg} (จาก ${s.solverTopScore.count} ช่อง มีข้อมูล v2 diagnostics)`);
  } else {
    lines.push('คะแนนเฉลี่ยของ solver: ไม่มีข้อมูล (shadow ที่อ่านได้ไม่มี v2 diagnostics.perSlot ให้คำนวณ)');
  }
  if (s.llmRankInSolver && s.llmRankInSolver.count) {
    lines.push(`อันดับเฉลี่ยของภาพที่ LLM เลือก เมื่อมองผ่านสายตา solver: อันดับ ${s.llmRankInSolver.avg} (ยิ่งใกล้ 1 ยิ่งใกล้เคียงกัน)`);
  }
  lines.push('');

  if (s.candidateUniverse && s.candidateUniverse.sampleCount) {
    const cu = s.candidateUniverse;
    lines.push(`จักรวาลตัวเลือกที่ LLM เห็น vs solver เห็น: เฉลี่ย LLM ${cu.avgLlmCount} ใบ / solver ${cu.avgSolverCount} ใบ (ร่วมกันเฉลี่ย ${cu.avgCommonCount} ใบ) — เหมือนกันทุกใบ ${cu.identicalPct}% ของงาน`);
    lines.push('');
  }

  lines.push('───────────────────────────────────────────');
  if (s.overall && s.overall.total) {
    const worstName = slotNames.length
      ? slotNames.slice().sort((a, b) => (s.perSlot[a].pct ?? 0) - (s.perSlot[b].pct ?? 0))[0]
      : null;
    const worstDiffPct = worstName ? round1(100 - (s.perSlot[worstName].pct ?? 100)) : null;
    lines.push(
      `สรุป: solver ตรง LLM ${s.overall.pct}% จาก ${s.runsWithShadowV1} รอบที่มีข้อมูล`
      + (worstName ? ` — ช่อง ${worstName} ต่างสุด ${worstDiffPct}%` : '')
    );
  }
  lines.push('หมายเหตุ: นี่เป็นข้อมูล "เงา" อย่างเดียว — solver ยังไม่ได้ตัดสินใจจริงใดๆ ในปกที่ทำไปแล้ว');
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}
