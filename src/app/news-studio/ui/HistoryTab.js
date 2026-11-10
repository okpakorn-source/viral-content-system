'use client';
// แท็บ "ประวัติงาน": งานที่ระบบเขียนตัวใหม่ทำไว้ (รวมงานที่ล้มและงานที่ค้าง) → เปิดดูฉบับเต็ม + รีวิว
import { useCallback, useEffect, useState } from 'react';
import { getJson, formatWhen } from './api';
import RunView from './RunView';

const STATUS = {
  done: { cls: 'ok', text: 'เขียนเสร็จ' },
  running: { cls: 'info', text: 'กำลังเขียน' },
  failed: { cls: 'bad', text: 'ไม่สำเร็จ' },
  stale: { cls: 'bad', text: 'ระบบหยุดกลางทาง' },
};
const LIST_URL = '/api/news-studio/runs?limit=80';
const REVIEW = { good: { cls: 'ok', text: 'งานดี' }, bad: { cls: 'bad', text: 'งานไม่ดี' }, used: { cls: 'ok', text: 'นำไปใช้แล้ว' } };

export default function HistoryTab({ canWrite, openId, setOpenId, refreshKey, onReuseRaw }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState({ id: null, run: null, err: '' }); // ผลของงานที่เปิดล่าสุด (ผูกกับรหัสงาน)

  const applyList = useCallback((d) => {
    setBusy(false);
    if (d.success) { setList(d); setErr(''); } else setErr(d.error || 'โหลดประวัติงานไม่สำเร็จ');
  }, []);
  const loadList = useCallback(() => { setBusy(true); getJson(LIST_URL).then(applyList); }, [applyList]);

  useEffect(() => {
    let alive = true;
    getJson(LIST_URL).then((d) => { if (alive) applyList(d); });
    return () => { alive = false; };
  }, [applyList, refreshKey]);

  useEffect(() => {
    if (!openId) return undefined;
    let alive = true;
    getJson(`/api/news-studio/runs/${encodeURIComponent(openId)}`).then((d) => {
      if (!alive) return;
      setOpened(d.success ? { id: openId, run: d.run, err: '' } : { id: openId, run: null, err: d.error || 'เปิดงานนี้ไม่สำเร็จ' });
    });
    return () => { alive = false; };
  }, [openId]);

  // ผลที่ค้างจากงานก่อนหน้าไม่ถูกแสดงกับงานที่เพิ่งเปิด
  const run = opened.id === openId ? opened.run : null;
  const runErr = opened.id === openId ? opened.err : '';
  // ผลบันทึกของงานหนึ่งที่มาถึงช้า ต้องไม่ไปทับงานที่ผู้ใช้เปิดอยู่ตอนนี้ (ผูกกับรหัสของงานที่บันทึก ไม่ใช่งานที่เปิดล่าสุด)
  const setRun = (next) => setOpened((cur) => (cur.id === next.id ? { id: next.id, run: next, err: '' } : cur));

  if (openId) {
    return (
      <div className="ns-stack">
        <div className="ns-line">
          <button type="button" className="ns-btn" onClick={() => { setOpenId(null); loadList(); }}>กลับไปรายการ</button>
          {run?.rawText && canWrite && (
            <button type="button" className="ns-btn ns-btn-quiet" disabled={!onReuseRaw} onClick={() => onReuseRaw(run.rawText)}>นำเนื้อดิบนี้ไปเขียนใหม่</button>
          )}
        </div>
        {runErr && <div className="ns-note bad" role="alert">{runErr}</div>}
        {!run && !runErr && <div className="ns-empty">กำลังเปิดงาน…</div>}
        {run && run.status === 'done' && <RunView key={run.id} run={run} canWrite={canWrite} onChanged={setRun} />}
        {run && run.status !== 'done' && (
          <div className="ns-stack">
            <h2 className="ns-run-title">{run.title || 'ไม่มีหัวเรื่อง'}</h2>
            <div className="ns-line">
              <span className={`ns-pill ${STATUS[run.status]?.cls || ''}`}>{STATUS[run.status]?.text || run.status}</span>
              <span className="ns-muted">{formatWhen(run.createdAt)}{run.user?.displayName ? ` · ${run.user.displayName}` : ''}</span>
            </div>
            {run.status === 'failed' && <div className="ns-note bad"><b>เขียนไม่สำเร็จ:</b> {run.error}{run.errorType ? ` (${run.errorType})` : ''}</div>}
            {run.status === 'stale' && <div className="ns-note bad">งานนี้เริ่มแล้วแต่ไม่มีผลกลับมาเกิน 12 นาที ระบบน่าจะหยุดกลางทาง ให้ส่งเนื้อดิบเข้าใหม่</div>}
            {run.status === 'running' && <div className="ns-note info">งานนี้กำลังเขียนอยู่ กลับมาเปิดอีกครั้งในอีกราว 1 นาที</div>}
            <details className="ns-card ns-disclose" open>
              <summary>เนื้อดิบที่ส่งเข้า ({String(run.rawText || '').length.toLocaleString('th-TH')} ตัวอักษร)</summary>
              <p className="ns-post small">{run.rawText}</p>
            </details>
          </div>
        )}
      </div>
    );
  }

  const st = list?.stats;
  return (
    <div className="ns-stack">
      {st && (
        <div className="ns-tiles">
          <div className="ns-tile"><b>{st.total}</b><span>งานในคลังประวัติ</span></div>
          <div className="ns-tile"><b>{st.versions ? `${st.versionsPassed}/${st.versions}` : '0'}</b><span>เวอร์ชันที่ผ่านทุกด่าน</span></div>
          <div className="ns-tile"><b>{st.medianSeconds != null ? `${st.medianSeconds} วิ` : '–'}</b><span>เวลาต่องาน (ค่ากลาง)</span></div>
          <div className="ns-tile"><b>{st.failed + st.stale}</b><span>งานที่ไม่สำเร็จ</span></div>
        </div>
      )}
      <div className="ns-line">
        <span className="ns-muted ns-grow">{list ? `แสดง ${list.runs.length} จาก ${list.total} งาน ใหม่สุดก่อน` : ''}</span>
        <button type="button" className="ns-btn" disabled={busy} onClick={loadList}>{busy ? 'กำลังโหลด…' : 'โหลดใหม่'}</button>
      </div>
      {err && <div className="ns-note bad" role="alert">{err}</div>}
      {!list && !err && <div className="ns-empty">กำลังโหลดประวัติงาน…</div>}
      {list && list.runs.length === 0 && <div className="ns-card ns-empty">ยังไม่มีงานในคลังประวัติ ไปที่แท็บ “เขียนข่าว” เพื่อเริ่มงานแรก</div>}
      <div className="ns-list">
        {(list?.runs || []).map((r) => {
          const s = STATUS[r.status] || { cls: '', text: r.status };
          const rv = REVIEW[r.review?.status];
          return (
            <button key={r.id} type="button" className="ns-row" onClick={() => setOpenId(r.id)}>
              <span className="ns-row-title">{r.title || 'ไม่มีหัวเรื่อง'}</span>
              {r.coverLines?.length > 0 && <span className="ns-row-text">พาดปก: {r.coverLines.join(' / ')}</span>}
              {r.error && <span className="ns-row-text">{r.error}</span>}
              <span className="ns-line">
                <span className={`ns-pill ${s.cls}`}>{s.text}</span>
                {r.source === 'discord' && <span className="ns-pill info">จาก Discord{r.caseId ? ` · เคส ${r.caseId}` : ''}</span>}
                {r.summary && <span className={`ns-pill ${r.summary.passed === r.summary.requested ? 'ok' : 'warn'} ns-num`}>ผ่าน {r.summary.passed}/{r.summary.requested}</span>}
                {rv && <span className={`ns-pill ${rv.cls}`}>{rv.text}{r.review.pickedVersion ? ` (เวอร์ชัน ${r.review.pickedVersion})` : ''}</span>}
                {r.seconds != null && <span className="ns-muted ns-num">{r.seconds} วินาที</span>}
                <span className="ns-muted">{formatWhen(r.createdAt)}{r.user?.displayName ? ` · ${r.user.displayName}` : ''}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
