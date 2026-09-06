'use client';
/**
 * BrainBox — กล่อง "🧠 ผลตรวจสอบหลังถอด" (พิมพ์เขียวข้อ 5)
 * รับ insight.brain ตรงๆ (null ได้ = ใบเก่าไม่มีสมองตรวจ → ไม่โชว์กล่อง)
 * ⚠️ ทุกชั้นต้อง null-safe: check / check.ai / check.repair / recheck / nameRepair หายได้หมด
 *    (ที่มา: survey-result-data-shape.md ข้อ 2 + PROBLEMS)
 */
import { getBrainMeta, fmtMs } from './statusMeta';
import { issueLabel } from './TopicCard';

const C = { text: '#e5e7eb', muted: '#9ca3af', line: '#374151', sub: '#111827' };

/** แปลง degradation → ประโยคไทย (type จริงจาก run-newpipe.mjs) */
function degradeText(d) {
  const t = d?.type || '';
  if (t === 'fps-compress') {
    const from = d?.from, to = d?.to;
    return (from != null && to != null) ? `บีบไฟล์ ${from}→${to} MB` : 'บีบไฟล์ก่อนถอด';
  }
  if (t === 'plan-fallback') return 'ใช้แผนผ่าสำรอง';
  if (t === 'segment-incomplete') return 'ถอดได้ไม่ครบท่อน';
  if (t === 'reviewer-unavailable') return 'ผู้ตรวจ AI ไม่พร้อม ใช้ชั้นโค้ดอย่างเดียว';
  if (t === 'repair-capped') return 'ซ่อมได้บางส่วน';
  if (t === 'repair-failed') return 'ซ่อมไม่สำเร็จ';
  if (t === 'answer-truncated') return 'คำตอบถูกตัด';
  if (t === 'model-fallback') return 'สลับรุ่นสำรอง';
  if (t === 'topics-v2-failed') return 'แยกประเด็น v2 ไม่สำเร็จ';
  if (t === 'topics-v2-crashed') return 'แยกประเด็น v2 สะดุด';
  if (t === 'topics-v2-skipped-no-truth') return 'ข้ามประเด็น v2 เพราะไม่มีบทถอดสำหรับตรวจ';
  if (t === 'readiness-crashed') return 'ตรวจความพร้อมไม่สำเร็จ';
  return t || 'มีข้อจำกัดระหว่างถอด';
}

/** นับ findings แยกความรุนแรงจากทั้งชั้นโค้ดและชั้นสมอง */
function countSeverity(brain) {
  const all = [
    ...(Array.isArray(brain?.check?.code?.findings) ? brain.check.code.findings : []),
    ...(Array.isArray(brain?.check?.ai?.findings) ? brain.check.ai.findings : []),
  ];
  const c = { สูง: 0, กลาง: 0, ต่ำ: 0, total: 0 };
  for (const f of all) {
    const s = f?.severity;
    if (f?.side === 'ความพร้อม' || s === 'ข้อสังเกต') continue;
    if (s === 'สูง' || s === 'กลาง' || s === 'ต่ำ') { c[s] += 1; c.total += 1; }
  }
  return c;
}

const Row = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.7 }}>
    <span style={{ color: C.muted, minWidth: 74, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, flex: 1, minWidth: 0 }}>{children}</span>
  </div>
);

export default function BrainBox({ brain }) {
  if (!brain) return null;

  const meta = getBrainMeta(brain.status);
  const sev = countSeverity(brain);
  const code = brain.check?.code || null;
  const ai = brain.check?.ai || null;
  const repair = brain.check?.repair || null;
  const recheck = brain.recheck || null;
  const nameRepair = Array.isArray(brain.nameRepair) ? brain.nameRepair : [];
  const degradations = Array.isArray(brain.degradations) ? brain.degradations : [];
  const costs = brain.costs || {};
  const coverage = code?.stats?.coverage;
  const tokens = Number(brain.totalTokens) || 0;
  const repairUSD = Number(costs.repairUSD) || 0;
  const planUSD = Number(costs.planUSD) || 0;
  const took = fmtMs(brain.elapsedMs);
  const truthFindings = [...(code?.findings || []), ...(ai?.findings || [])]
    .filter((f) => f?.side !== 'ความพร้อม' && ['สูง', 'กลาง', 'ต่ำ'].includes(f?.severity));
  const readiness = brain.check?.readiness;
  const topicsV2 = brain.topicsV2;
  const attempts = Array.isArray(topicsV2?.attempts) ? topicsV2.attempts : [];
  const topicCount = Array.isArray(topicsV2?.stories) ? topicsV2.stories.length : (readiness?.counts?.stories ?? 0);
  const topicCost = attempts.reduce((sum, attempt) => sum + (Number(attempt.costUSD) || 0), 0);
  const topicTime = topicsV2?.elapsedMs ?? attempts.reduce((sum, attempt) => sum + (Number(attempt.elapsedMs) || 0), 0);

  return (
    <div style={{ background: C.sub, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🧠 ผลตรวจสอบหลังถอด</span>
        {meta ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}55` }} title={meta.note}>
            {meta.emoji} {brain.status}
          </span>
        ) : (
          <span style={{ fontSize: 12.5, color: C.muted }}>ยังไม่มีผลตรวจ</span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {topicsV2 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          ประเด็น v2: {topicCount} เรื่อง · {topicsV2.gate?.pass === true ? 'ผ่านด่าน' : 'ไม่ผ่าน'}
          {' · สมอง '}{attempts.length ? attempts.map((a) => `${a.brain || a.model || 'ไม่ระบุ'}${a.brain && a.model ? ` / ${a.model}` : ''}${a.effort ? ` (${a.effort})` : ''}`).join(' → ') : 'ไม่มีข้อมูล'}
          {' · '}{fmtMs(topicTime) || '0 วิ'} · {attempts.some((a) => a.costUSD != null) ? `$${topicCost.toFixed(4)}` : 'ไม่มีข้อมูลค่าใช้จ่าย'}
          {topicsV2.reason && <div style={{ color: '#fbbf24' }}>{topicsV2.reason}</div>}
          {topicsV2.gate?.pass === false && topicsV2.gate.reasons?.length > 0 && <div style={{ color: '#fbbf24' }}>{topicsV2.gate.reasons.join(' · ')}</div>}
        </div>}
        <div style={{ fontWeight: 700, fontSize: 13 }}>ความจริง</div>
        <Row label="ใครตรวจ">
          <span>ชั้นโค้ด{code?.rev ? ` (${code.rev})` : ''}</span>
          <span style={{ color: C.muted }}> · </span>
          {ai ? <span>ชั้นสมอง{ai.verdict ? ` — ${ai.verdict}` : ''}</span> : <span style={{ color: '#fbbf24' }}>ข้ามชั้นสมอง</span>}
        </Row>

        {brain.check?.lowCount > 0 && <div style={{ fontSize: 11.5, color: C.muted }}>คำพูดสั้นตรวจไม่ได้ {brain.check.lowCount}</div>}
        {truthFindings.length > 0 && <details style={{ fontSize: 12, lineHeight: 1.7 }}>
          <summary style={{ cursor: 'pointer', color: C.muted }}>จุดตรวจความจริง {truthFindings.length}</summary>
          {truthFindings.map((f, i) => <div key={i} title={f.where}>• {f.severity}: {f.detail}{f.fix ? ` · ${f.fix}` : ''}</div>)}
        </details>}

        <Row label="เจอ">
          {sev.total === 0 ? <span style={{ color: code || ai ? '#22c55e' : C.muted }}>{code || ai ? 'ไม่พบจุดผิด' : 'ยังไม่ได้ตรวจความจริง'}</span> : (
            <span>
              รวม {sev.total} จุด
              {sev.สูง > 0 && <span style={{ color: '#f97316' }}> · สูง {sev.สูง}</span>}
              {sev.กลาง > 0 && <span style={{ color: '#fbbf24' }}> · กลาง {sev.กลาง}</span>}
              {sev.ต่ำ > 0 && <span style={{ color: C.muted }}> · ต่ำ {sev.ต่ำ}</span>}
            </span>
          )}
          {coverage != null && <span style={{ color: C.muted }}> · ดูครอบคลุม {coverage}%</span>}
        </Row>

        {ai?.note && <Row label="สรุป">{ai.note}</Row>}

        {(repair || nameRepair.length > 0) && (
          <Row label="การซ่อม">
            <div>
              {Array.isArray(repair?.note) && repair.note.length > 0 && (
                <div>{repair.note.map((n, i) => <div key={i}>• {n}</div>)}</div>
              )}
              {Array.isArray(repair?.changed) && repair.changed.length > 0 && (
                <div style={{ color: C.muted }}>ช่องที่แก้: {repair.changed.join(', ')}</div>
              )}
              {Array.isArray(repair?.unfixed) && repair.unfixed.length > 0 && (
                <div style={{ color: '#f97316' }}>{repair.unfixed.map((u, i) => <div key={i}>• แก้ไม่ได้: {typeof u === 'string' ? u : (u?.detail || u?.kind || JSON.stringify(u))}</div>)}</div>
              )}
              {nameRepair.length > 0 && (
                <div style={{ color: C.muted }}>{nameRepair.map((n, i) => <div key={i}>• ชื่อ: {typeof n === 'string' ? n : (n?.detail || JSON.stringify(n))}</div>)}</div>
              )}
            </div>
          </Row>
        )}

        {recheck && (
          <Row label="หลังซ่อม">
            {recheck.verdict || '—'}
            {recheck.findings != null && <span style={{ color: C.muted }}> · เหลือ {recheck.findings} จุด</span>}
          </Row>
        )}

        {readiness && <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8, marginTop: 4, fontSize: 12, lineHeight: 1.75 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>ความพร้อม</div>
          {readiness.note && <div style={{ color: '#fbbf24' }}>{readiness.note}</div>}
          <div style={{ color: C.muted }}>ตรวจ {readiness.counts?.stories ?? 0} เรื่อง · มีข้อสังเกต {readiness.counts?.withIssues ?? 0} เรื่อง</div>
          <div style={{ color: '#fbbf24' }}>{Object.entries(readiness.counts?.byCode || {}).map(([code, count]) => `${issueLabel(code)} ${count}`).join(' · ')}</div>
          {readiness.findings?.length > 0 ? <details>
            <summary style={{ cursor: 'pointer' }}>ข้อสังเกตความพร้อม {readiness.findings.length}</summary>
            {readiness.findings.map((f, i) => <div key={i} title={f.where}>• {f.detail}{f.fix ? ` · ${f.fix}` : ''}</div>)}
          </details> : <div style={{ color: '#22c55e' }}>ไม่พบข้อสังเกตความพร้อม</div>}
        </div>}

        {(tokens > 0 || repairUSD > 0 || planUSD > 0 || took) && (
          <Row label="ต้นทุน">
            {tokens > 0 && <span>{tokens.toLocaleString()} โทเคน</span>}
            {repairUSD > 0 && <span style={{ color: C.muted }}>{tokens > 0 ? ' · ' : ''}ซ่อม ${repairUSD.toFixed(4)}</span>}
            {planUSD > 0 && <span style={{ color: C.muted }}> · วางแผน ${planUSD.toFixed(4)}</span>}
            {took && <span style={{ color: C.muted }}> · ใช้เวลา {took}</span>}
          </Row>
        )}

        {degradations.length > 0 && (
          <Row label="ข้อจำกัด">
            <div>{degradations.map((d, i) => (
              <div key={i} style={{ color: '#fbbf24' }}>• {degradeText(d)}{(d?.note || d?.why || d?.reason) ? <span style={{ color: C.muted }}> — {d.note || d.why || d.reason}</span> : null}</div>
            ))}</div>
          </Row>
        )}
      </div>
    </div>
  );
}
