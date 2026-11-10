'use client';
// ผลงาน 1 งาน: เนื้อดิบ · ทิศทางข่าว · 3 เวอร์ชัน · ผลตรวจทุกด่าน · รีวิวของคน — ใช้ทั้งแท็บ "เขียนข่าว" และ "ประวัติงาน"
import { useEffect, useRef, useState } from 'react';
import { getJson, sendJson, copyText, formatViews, formatWhen, OPENING_LABEL, FAIL_LABEL } from './api';

const REVIEW_LABEL = { unreviewed: 'ยังไม่รีวิว', good: 'งานดี', bad: 'งานไม่ดี', used: 'นำไปใช้แล้ว' };

function factPill(v) {
  if (!v.factChecked) return { cls: 'warn', text: 'ยังไม่ได้ตรวจข้อเท็จจริง' };
  const major = v.factIssues.filter((i) => i.severity === 'major').length;
  if (major) return { cls: 'bad', text: `ข้อเท็จจริง: จุดร้ายแรง ${major}` };
  if (v.factIssues.length) return { cls: 'info', text: `ข้อเท็จจริง: จุดเล็กน้อย ${v.factIssues.length}` };
  return { cls: 'ok', text: 'ข้อเท็จจริง: ไม่พบจุดผิด' };
}

function readerPill(v) {
  if (!v.readChecked) return { cls: 'warn', text: 'ยังไม่ได้ตรวจการอ่าน' };
  if (v.readClear) return { cls: 'ok', text: 'อ่านรอบเดียวเข้าใจ' };
  if (v.readOpening && v.readOpening !== 'บอกเรื่อง') return { cls: 'bad', text: `ย่อหน้าแรกยัง${v.readOpening}` };
  return { cls: 'bad', text: 'มีจุดที่คนอ่านตามไม่ได้' };
}

function TeacherBox({ teacher }) {
  const [post, setPost] = useState(null); // null = ยังไม่โหลด
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setErr('');
    const d = await getJson(`/api/news-studio/library?kind=teacher&id=${encodeURIComponent(teacher.id)}`);
    setBusy(false);
    if (d.success) setPost(d.teacher.post); else setErr(d.error || 'โหลดโพสต์ครูไม่สำเร็จ');
  };
  return (
    <details className="ns-disclose" onToggle={(e) => { if (e.currentTarget.open && post === null && !busy) load(); }}>
      <summary>ครูที่เวอร์ชันนี้เลียนสำนวน</summary>
      <div className="ns-disclose-body">
        <div><b>{teacher.name}</b></div>
        <div className="ns-line">
          {teacher.category && <span className="ns-pill plain">{teacher.category}</span>}
          {teacher.openingType && <span className="ns-pill plain">{OPENING_LABEL[teacher.openingType] || teacher.openingType}</span>}
          {formatViews(teacher.views) && <span className="ns-pill plain ns-num">{formatViews(teacher.views)}</span>}
        </div>
        {teacher.reason && <div>เหตุผลที่เลือก: {teacher.reason}</div>}
        {teacher.url && <a href={teacher.url} target="_blank" rel="noreferrer">เปิดโพสต์จริงบน Facebook</a>}
        {busy && <div className="ns-muted">กำลังโหลดโพสต์ครู…</div>}
        {err && <div className="ns-note bad">{err}</div>}
      </div>
      {post && <p className="ns-post small">{post}</p>}
    </details>
  );
}

function VersionCard({ v, picked, canWrite, onPick, saving }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!v.content) {
    return (
      <div className="ns-card">
        <div className="ns-card-pad ns-stack">
          <div className="ns-note bad"><b>เวอร์ชัน {v.index} เขียนไม่สำเร็จ:</b> {v.error || 'ไม่ทราบสาเหตุ'}</div>
        </div>
        {v.teacher?.id && <TeacherBox teacher={v.teacher} />}
      </div>
    );
  }
  const fact = factPill(v);
  const reader = readerPill(v);
  const rewrites = (v.trail || []).slice(0, -1);
  const doCopy = async () => {
    const ok = await copyText(v.content);
    setCopied(ok ? 'ok' : 'no');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2200);
  };
  return (
    <div className="ns-card">
      {v.angle && (
        <div className="ns-angle">
          <span className="ns-angle-k">ทิศทางข่าว (จากต้นแบบปก{v.angle.exemplarIds?.length ? ` ${v.angle.exemplarIds.join(', ')}` : ''})</span>
          <span className="ns-angle-cover">{(v.angle.coverLines || []).join('\n')}</span>
          {v.angle.focus && <span className="ns-angle-focus">ประเด็นที่ชู: {v.angle.focus}</span>}
        </div>
      )}
      {!v.angle && <div className="ns-angle"><span className="ns-angle-k">เวอร์ชันนี้เขียนโดยไม่มีทิศทางจากต้นแบบปก</span></div>}
      <p className="ns-post">{v.content}</p>
      <div className="ns-meta">
        {v.metrics && <span className="ns-num">{v.metrics.words} คำ</span>}
        {v.metrics?.paragraphChars?.length === 3 && <span className="ns-num">ย่อหน้า {v.metrics.paragraphChars.join(' / ')} ตัวอักษร</span>}
        <span className="ns-num">เขียน {v.attempts} รอบ</span>
        {v.metrics && <span className="ns-num">ถ้อยคำตรงเนื้อดิบ {v.metrics.rawCopyPct}%</span>}
      </div>
      <div className="ns-actions">
        <button type="button" className="ns-btn ns-btn-primary" onClick={doCopy}>{copied === 'ok' ? 'คัดลอกแล้ว' : copied === 'no' ? 'คัดลอกไม่ได้ ลองเลือกข้อความเอง' : 'คัดลอกเนื้อข่าว'}</button>
        {canWrite && (
          <button type="button" className="ns-btn ns-btn-good" aria-pressed={picked} disabled={saving} onClick={onPick}>
            {picked ? 'บันทึกแล้วว่าใช้เวอร์ชันนี้' : 'บันทึกว่าใช้เวอร์ชันนี้'}
          </button>
        )}
      </div>
      <div className="ns-checks">
        <span className={`ns-pill ${v.formOk ? 'ok' : 'bad'}`}>{v.formOk ? 'ผ่านแบบแผนครู' : 'ยังไม่ผ่านแบบแผนครู'}</span>
        <span className={`ns-pill ${fact.cls}`}>{fact.text}</span>
        <span className={`ns-pill ${reader.cls}`}>{reader.text}</span>
      </div>
      {(v.stopped || v.fails.length > 0 || v.factIssues.length > 0 || v.readHardParts.length > 0 || v.warns.length > 0 || v.factError || v.readError || v.readGist) && (
        <ul className="ns-issues">
          {v.stopped && <li className="warn"><span className="ns-tag">หยุดแก้ก่อนครบรอบ</span>{v.stopped}</li>}
          {v.fails.map((f, i) => <li key={`f${i}`} className="bad"><span className="ns-tag">{FAIL_LABEL[f.code] || f.code}</span>{f.message}</li>)}
          {v.factError && <li className="warn"><span className="ns-tag">ผู้ตรวจข้อเท็จจริงล้ม</span>{v.factError}</li>}
          {v.factIssues.map((i, k) => (
            <li key={`c${k}`} className={i.severity === 'major' ? 'bad' : ''}>
              <span className="ns-tag">ผู้ตรวจข้อเท็จจริง ({i.severity === 'major' ? 'ร้ายแรง' : 'เล็กน้อย'})</span>“{i.quote}” {i.problem}{i.fix ? ` → ${i.fix}` : ''}
            </li>
          ))}
          {v.readError && <li className="warn"><span className="ns-tag">ผู้อ่านจับใจความล้ม</span>{v.readError}</li>}
          {v.readGist && <li><span className="ns-tag">คนอ่านที่เห็นแค่โพสต์ เข้าใจจากย่อหน้าแรกว่า</span>{v.readGist}</li>}
          {v.readHardParts.map((h, k) => <li key={`r${k}`} className="warn"><span className="ns-tag">คนอ่านตามไม่ได้ ({h.kind})</span>“{h.quote}” {h.why}</li>)}
          {v.warns.map((w, i) => <li key={`w${i}`}><span className="ns-tag">ให้คนตรวจ</span>{w.message}</li>)}
        </ul>
      )}
      {rewrites.length > 0 && (
        <details className="ns-disclose">
          <summary>ระบบแก้เองไปแล้ว {rewrites.length} รอบ ดูเหตุ</summary>
          <div className="ns-disclose-body">
            {rewrites.map((t) => {
              const why = [...t.fails.map((c) => FAIL_LABEL[c] || c), ...(t.factMajor ? [`ข้อเท็จจริงร้ายแรง ${t.factMajor} จุด`] : []), ...(t.readerClear === false ? ['คนอ่านยังตามไม่ได้'] : [])];
              return <div key={t.attempt}>รอบ {t.attempt}: {why.length ? why.join(' · ') : 'ผู้ตรวจล้ม'}</div>;
            })}
          </div>
        </details>
      )}
      {v.teacher?.id && <TeacherBox teacher={v.teacher} />}
    </div>
  );
}

export default function RunView({ run, canWrite, onChanged }) {
  const versions = run.versions || [];
  const firstUsable = Math.max(0, versions.findIndex((v) => v.content));
  const [sel, setSel] = useState(firstUsable);
  const [review, setReview] = useState(run.review || { status: 'unreviewed', note: '', pickedVersion: null });
  const [note, setNote] = useState(run.review?.note || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // {bad, text}

  // เปลี่ยนงาน = ผู้เรียกใส่ key={run.id} ให้คอมโพเนนต์นี้เริ่มสถานะหน้าจอใหม่เอง (ไม่ต้องรีเซ็ตใน effect)

  // ส่งเฉพาะช่องที่ผู้ใช้เปลี่ยนในครั้งนี้ — เซิร์ฟเวอร์รวมกับผลรีวิวล่าสุดเอง (จอที่ค้างค่าเก่าจึงไม่ทับสิ่งที่คนอื่นเพิ่งบันทึก)
  const save = async (patch) => {
    setSaving(true); setMsg(null);
    const d = await sendJson(`/api/news-studio/runs/${encodeURIComponent(run.id)}`, 'PATCH', patch);
    setSaving(false);
    if (!d.success) { setMsg({ bad: true, text: d.error || 'บันทึกไม่สำเร็จ' }); return; }
    setReview(d.review);
    // ช่องหมายเหตุบนจอถูกแทนเฉพาะเมื่อครั้งนี้บันทึกหมายเหตุ — ข้อความที่กำลังพิมพ์ระหว่างรอผลไม่หาย
    if ('note' in patch) setNote(d.review.note || '');
    setMsg({ bad: false, text: 'บันทึกแล้ว' });
    onChanged?.({ ...run, review: d.review });
  };

  const v = versions[sel] || versions[0];
  const s = run.summary;
  // "ผ่านทุกด่าน" = ผ่าน และทุกด่านได้ตรวจจริง · ด่านที่ไม่ได้ตรวจ (ไม่ได้ต่อ/ล่ม) ไม่นับเป็นผ่าน
  const fully = (x) => !!x.ok && !!x.factChecked && !!x.readChecked;
  const fullCount = versions.filter(fully).length;
  const partialCount = versions.filter((x) => x.ok && !fully(x)).length;
  const notSaved = (run.warnings || []).some((w) => w.code === 'RUN_NOT_SAVED');

  return (
    <div className="ns-stack">
      <div className="ns-stack">
        <h2 className="ns-run-title">{run.title || 'ไม่มีหัวเรื่อง'}</h2>
        <div className="ns-line">
          {s && <span className={`ns-pill ${fullCount === s.requested ? 'ok' : fullCount > 0 ? 'warn' : 'bad'}`}>ผ่านทุกด่าน {fullCount}/{s.requested} เวอร์ชัน</span>}
          {partialCount > 0 && <span className="ns-pill warn">ผ่านแต่ตรวจไม่ครบด่าน {partialCount}</span>}
          {run.timings?.total ? <span className="ns-pill plain ns-num">ใช้เวลา {Math.round(run.timings.total / 1000)} วินาที</span> : null}
          {run.analysis?.primaryCategory && <span className="ns-pill plain">{run.analysis.primaryCategory}</span>}
          {review.status !== 'unreviewed' && <span className={`ns-pill ${review.status === 'bad' ? 'bad' : 'ok'}`}>{REVIEW_LABEL[review.status]}{review.pickedVersion ? ` (เวอร์ชัน ${review.pickedVersion})` : ''}</span>}
          <span className="ns-muted">{formatWhen(run.createdAt)}{run.user?.displayName ? ` · ${run.user.displayName}` : ''}</span>
        </div>
      </div>

      {(run.warnings || []).length > 0 && (
        <div className="ns-note warn">
          {(run.warnings || []).map((w, i) => <div key={i}>{w.message}</div>)}
        </div>
      )}

      <details className="ns-card ns-disclose ns-raw">
        <summary>เนื้อดิบที่ส่งเข้า ({String(run.rawText || '').length.toLocaleString('th-TH')} ตัวอักษร)</summary>
        <p className="ns-post small">{run.rawText}</p>
        {(run.researchFacts || []).length > 0 && (
          <div className="ns-disclose-body">
            <b>ข้อมูลเสริมจากการค้นเว็บ</b>
            {run.researchFacts.map((f, i) => <div key={i}>{i + 1}. {f}</div>)}
          </div>
        )}
      </details>

      {versions.length > 0 && (
        <>
          <div className="ns-seg" role="tablist" aria-label="เวอร์ชันที่เขียน">
            {versions.map((x, i) => (
              <button key={x.index} type="button" role="tab" aria-selected={i === sel} onClick={() => setSel(i)}>
                <span className="ns-seg-top"><span className={`ns-mark ${!x.content ? 'err' : fully(x) ? '' : 'no'}`} aria-hidden="true" />เวอร์ชัน {x.index}</span>
                <span className="ns-seg-note">{!x.content ? 'ล้ม' : fully(x) ? 'ผ่าน' : x.ok ? 'ตรวจไม่ครบ' : 'มีจุดต้องดู'}</span>
              </button>
            ))}
          </div>
          {v && (
            <VersionCard
              key={`${run.id}-${v.index}`}
              v={v}
              canWrite={canWrite && !notSaved}
              saving={saving}
              picked={review.status === 'used' && review.pickedVersion === v.index}
              onPick={() => save({ status: 'used', pickedVersion: v.index })}
            />
          )}
        </>
      )}

      {canWrite && !notSaved && (
        <div className="ns-card ns-review">
          <div className="ns-h2">รีวิวงานนี้</div>
          <div className="ns-line">
            <button type="button" className="ns-btn ns-btn-good" aria-pressed={review.status === 'good'} disabled={saving} onClick={() => save({ status: 'good' })}>งานดี</button>
            <button type="button" className="ns-btn ns-btn-bad" aria-pressed={review.status === 'bad'} disabled={saving} onClick={() => save({ status: 'bad' })}>งานไม่ดี</button>
            {review.status !== 'unreviewed' && <button type="button" className="ns-btn ns-btn-quiet" disabled={saving} onClick={() => save({ status: 'unreviewed', pickedVersion: null })}>ล้างผลรีวิว</button>}
          </div>
          <label className="ns-sub" htmlFor={`note-${run.id}`}>หมายเหตุ (เช่น จุดที่ต้องแก้ก่อนโพสต์ หรือเหตุที่งานไม่ดี)</label>
          <div className="ns-line">
            <input id={`note-${run.id}`} className="ns-input ns-grow" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="ns-btn" disabled={saving || note === (review.note || '')} onClick={() => save({ note })}>บันทึกหมายเหตุ</button>
          </div>
          {msg && <div className={`ns-note ${msg.bad ? 'bad' : 'info'}`} role="status">{msg.text}</div>}
        </div>
      )}
    </div>
  );
}
