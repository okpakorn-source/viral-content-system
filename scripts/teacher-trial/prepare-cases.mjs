// ขั้น 1 ของชุดทดลอง: ดึง "เนื้อดิบจริงที่พนักงานส่ง" + ผลงานของระบบปัจจุบัน จากหน้าคลังผลงานของเว็บ (อ่านอย่างเดียว)
// รัน: node scripts/teacher-trial/prepare-cases.mjs [จำนวน=20]
// ผล: scratch/teacher-trial/cases.json
import { outPath, writeJson, mapLimit } from './common.mjs';

const BASE = (process.env.TEACHER_TRIAL_BASE_URL || 'https://viral-content-system.vercel.app').replace(/\/$/, '');
const WANT = Math.max(1, Math.min(60, parseInt(process.argv[2] || '20', 10) || 20));
const FIRST_CASE_AFTER_ROLLBACK = 7545; // เคสแรกหลังย้อนสมองเขียนข่าวกลับยุค มิ.ย. (8 พ.ย. 69)

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const list = await getJson(`${BASE}/api/generation-logs?limit=${Math.max(60, WANT * 2)}`);
const picked = (list.cases || [])
  .filter((c) => c.sourceType === 'plain_text' && Number(c.caseId) >= FIRST_CASE_AFTER_ROLLBACK)
  .slice(0, WANT);

const cases = (await mapLimit(picked, 4, async (c) => {
  const d = (await getJson(`${BASE}/api/generation-logs/${c.caseId}`)).case;
  if (!d || !String(d.sourceText || '').trim()) return null;
  return {
    caseId: d.caseId,
    createdAt: d.createdAt,
    newsTitle: d.newsTitle,
    rawText: String(d.sourceText).trim(),
    rawTruncated: Number(d.sourceTextLength) > String(d.sourceText).length, // คลังเก็บเนื้อดิบแค่ 5,000 ตัวอักษรแรก
    oldTotalTimeSec: d.pipelineInfo?.totalTime ?? c.totalTime ?? null,
    oldVersions: (d.versions || []).map((v) => ({ style: v.style, content: String(v.content || '') })),
  };
})).filter(Boolean);

writeJson(outPath('cases.json'), cases);
console.log(`เก็บ ${cases.length} เคส (#${cases[cases.length - 1]?.caseId}–#${cases[0]?.caseId}) → scratch/teacher-trial/cases.json`);
const cut = cases.filter((c) => c.rawTruncated).length;
if (cut) console.log(`⚠️ ${cut} เคสเนื้อดิบในคลังถูกตัดที่ 5,000 ตัวอักษร`);
