'use client';
// แท็บ "เขียนข่าว": วางเนื้อดิบ → สั่งเขียน → ดูความคืบหน้าจริงจากเซิร์ฟเวอร์ → อ่านผล 3 เวอร์ชัน
import { useEffect, useState } from 'react';
import RunView from './RunView';

export const STEP_ORDER = ['direction', 'teachers', 'writing'];
const STEP_NAME = { direction: 'กำหนดทิศทางข่าว', teachers: 'เลือกครู', writing: 'เขียนและตรวจ 3 เวอร์ชัน' };
const STEP_HINT = {
  direction: 'อ่านเนื้อดิบเทียบกับต้นแบบปก 33 ใบ แล้วเลือกประเด็นที่จะชู',
  teachers: 'คัดโพสต์ครูที่รูปเรื่องใกล้ข่าวนี้ และวิธีเปิดตรงกับสิ่งที่ชู',
  writing: 'เขียน ตรวจแบบแผน ตรวจข้อเท็จจริง ให้คนอ่านลองอ่าน แล้วแก้ถ้าไม่ผ่าน',
};

function Elapsed({ since, running }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!since) return null;
  return <span className="ns-num">{Math.max(0, Math.round((now - since) / 1000))} วินาที</span>;
}

export default function ComposeTab({ status, statusErr, onReloadStatus, me, form, setForm, job, onStart, onClear, onRunChanged }) {
  const rules = status?.rules;
  const min = rules?.minRawChars ?? 40;
  const max = rules?.maxRawChars ?? 20000;
  const chars = form.rawText.trim().length;
  const running = job.phase === 'running';
  const canWrite = !!me?.canWrite;
  const ready = !!status?.ready;
  const researchOn = !!status?.keys?.research;

  let blocked = '';
  if (status && !ready) blocked = 'ระบบยังไม่พร้อมเขียน ดูเหตุที่แท็บ "สถานะระบบ"';
  else if (me && !canWrite) blocked = 'บัญชีนี้ดูได้อย่างเดียว สั่งเขียนต้องเป็นบทบาท admin หรือ editor';
  else if (chars > 0 && chars < min) blocked = `เนื้อข่าวสั้นเกินไป ต้องมีอย่างน้อย ${min} ตัวอักษร`;
  else if (chars > max) blocked = `เนื้อข่าวยาวเกินไป รับได้ไม่เกิน ${max.toLocaleString('th-TH')} ตัวอักษร`;

  return (
    <div className="ns-stack">
      <div className="ns-card ns-card-pad ns-stack">
        <label className="ns-h2" htmlFor="ns-raw">เนื้อข่าวจากทีม</label>
        <textarea
          id="ns-raw"
          className="ns-textarea"
          placeholder="วางเนื้อข่าวที่มีประเด็นครบแล้ว ระบบจะเลือกประเด็นที่ชูจากต้นแบบปก แล้วเขียน 3 เวอร์ชันด้วยสำนวนของโพสต์ครู"
          value={form.rawText}
          disabled={running}
          onChange={(e) => setForm({ ...form, rawText: e.target.value })}
        />
        <div className="ns-line">
          <span className="ns-muted ns-num ns-grow">{chars.toLocaleString('th-TH')} ตัวอักษร</span>
          {form.rawText && !running && <button type="button" className="ns-btn ns-btn-quiet" onClick={() => setForm({ ...form, rawText: '' })}>ล้างช่อง</button>}
        </div>
        <label className="ns-check">
          <input type="checkbox" checked={form.useResearch && researchOn} disabled={running || !researchOn} onChange={(e) => setForm({ ...form, useResearch: e.target.checked })} />
          <span>
            ค้นข้อมูลเสริมจากเว็บ
            <span className="ns-muted"> {researchOn ? '· ใช้ได้ไม่เกิน 2 จุดต่อโพสต์ และช้าขึ้นราว 20–40 วินาที (ยังไม่เคยทดสอบกับข่าวจริงในระบบใหม่)' : '· ระบบนี้ยังไม่ได้ตั้งคีย์ตัวค้น จึงเปิดไม่ได้'}</span>
          </span>
        </label>
        {blocked && <div className="ns-note warn" role="status">{blocked}</div>}
        {!status && statusErr && (
          <div className="ns-note bad" role="alert">
            ตรวจสถานะระบบไม่สำเร็จ จึงยังสั่งเขียนไม่ได้: {statusErr}{' '}
            <button type="button" className="ns-btn ns-btn-quiet" onClick={onReloadStatus}>ลองใหม่</button>
          </div>
        )}
        {!status && !statusErr && <div className="ns-muted" role="status">กำลังตรวจสถานะระบบ…</div>}
        <div className="ns-line">
          <button type="button" className="ns-btn ns-btn-primary ns-btn-lg" disabled={running || !!blocked || chars === 0 || !status} onClick={onStart}>
            {running ? 'กำลังเขียน…' : 'เขียน 3 เวอร์ชัน'}
          </button>
          {!running && job.phase !== 'idle' && <button type="button" className="ns-btn ns-btn-quiet" onClick={onClear}>ปิดผลงานนี้</button>}
        </div>
      </div>

      {job.phase !== 'idle' && (
        <div className="ns-card ns-card-pad ns-stack">
          <div className="ns-line">
            {/* ประกาศเฉพาะตอนสถานะเปลี่ยน (เริ่ม/เสร็จ/ไม่สำเร็จ) — ตัวนับวินาทีอยู่นอกส่วนที่ประกาศ ไม่งั้นโปรแกรมอ่านจอจะอ่านทุกวินาที */}
            <span className="ns-h2 ns-grow" role="status" aria-live="polite">{running ? 'กำลังทำงาน' : job.phase === 'done' ? 'เขียนเสร็จแล้ว' : 'งานนี้ไม่สำเร็จ'}</span>
            <span className="ns-muted">{running ? <Elapsed since={job.startedAt} running /> : job.seconds != null ? <span className="ns-num">{job.seconds} วินาที</span> : null}</span>
          </div>
          <ol className="ns-steps">
            {STEP_ORDER.map((id) => {
              const st = job.steps[id] || { status: 'wait', detail: '' };
              const cls = st.status === 'start' ? 'run' : st.status === 'done' ? 'done' : st.status === 'failed' ? 'fail' : '';
              return (
                <li key={id} className={`ns-step ${cls}`}>
                  <span className="ns-step-name"><span className="ns-dot" aria-hidden="true" />{STEP_NAME[id]}</span>
                  <span className="ns-step-detail">{st.detail || (st.status === 'start' ? STEP_HINT[id] : st.status === 'failed' ? 'ไม่สำเร็จ ระบบเขียนต่อโดยไม่มีขั้นนี้' : STEP_HINT[id])}</span>
                </li>
              );
            })}
          </ol>
          {job.following && <div className="ns-note info">สายเชื่อมต่อหลุดกลางทาง งานยังเดินอยู่บนเซิร์ฟเวอร์ กำลังตามผลจากคลังประวัติ</div>}
          {job.notices.map((n, i) => <div key={i} className="ns-note warn">{n}</div>)}
          {job.phase === 'error' && <div className="ns-note bad" role="alert"><b>เขียนไม่สำเร็จ:</b> {job.error}{job.errorType ? ` (${job.errorType})` : ''}</div>}
        </div>
      )}

      {job.phase === 'done' && job.run && <RunView key={job.run.id} run={job.run} canWrite={canWrite} onChanged={onRunChanged} />}
    </div>
  );
}
