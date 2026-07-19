#!/usr/bin/env node
// ============================================================
// 🔬 CLI: solver-shadow-report — สรุปสถิติ solver (คำนวณล้วน) เทียบ LLM (สมอง) จากปกจริงที่ทำไปแล้ว
// ------------------------------------------------------------
// ขั้น A ของแผนเปิด solver — read-only เต็มร้อย: ไม่แตะ/ไม่เปลี่ยนพฤติกรรมท่อ MEGA ใดๆ
// ไม่เปิดสวิตช์ solver ใดๆ ทั้งสิ้น แค่ "อ่าน" solverShadow ที่ท่อจริงบันทึกไว้แล้ว มาสรุปเป็นตัวเลข
//
// รัน: node scripts/solver-shadow-report.mjs
//
// หมายเหตุ loader: src/lib/megaCoverArchive.js import '@/lib/persistStore' ตรงๆ (alias ของ Next
// bundler) — สคริปต์เดี่ยวที่รันด้วย `node` ต้องแมป '@/' → 'src/' เอง ใช้แพทเทิร์นเดียวกับ
// scripts/test-slot-solver-live.mjs (data:URL module hook ผ่าน node:module#register — ไม่มีไฟล์ loader แยก)
// ============================================================
import { register } from 'node:module';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hookBody = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rest = specifier.slice(2);
    const hasExt = /\\.(m?js)$/.test(rest);
    const mapped = new URL(rest + (hasExt ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hookBody));

async function main() {
  let collectSolverShadowRecords;
  let aggregateSolverShadow;
  let formatSolverShadowReport;
  try {
    ({ collectSolverShadowRecords } = await import('../src/lib/solverShadowSource.js'));
    ({ aggregateSolverShadow, formatSolverShadowReport } = await import('../src/lib/solverShadowMetrics.js'));
  } catch (e) {
    console.error('[solver-shadow-report] โหลดโมดูลไม่สำเร็จ:', e?.message || e);
    process.exitCode = 1;
    return;
  }

  let records = [];
  try {
    records = await collectSolverShadowRecords();
  } catch (e) {
    console.warn('[solver-shadow-report] ดึงข้อมูลล้มทั้งชุด (ถือว่าไม่มีข้อมูล):', e?.message || e);
    records = [];
  }

  let summary;
  try {
    summary = aggregateSolverShadow(records);
  } catch (e) {
    // aggregateSolverShadow ถูกออกแบบให้ไม่ throw — แต่ครอบไว้กันเหนียวอีกชั้นสำหรับ CLI
    console.error('[solver-shadow-report] สรุปสถิติผิดพลาดไม่คาดคิด:', e?.message || e);
    process.exitCode = 1;
    return;
  }

  console.log(formatSolverShadowReport(summary));
}

main().catch((e) => {
  console.error('[solver-shadow-report] ผิดพลาดไม่คาดคิด:', e?.message || e);
  process.exitCode = 1;
});
