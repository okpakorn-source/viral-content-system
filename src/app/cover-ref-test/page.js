'use client';

// ============================================================
// 🎯 Cover Ref Test — หน้าเทสปกเทียบ "ภาพแสนไลค์ reference" (vt_ref_5x4)
// ------------------------------------------------------------
// ผู้ใช้กดเทสเอง: ใส่เนื้อข่าวเต็ม (+ลิงก์ภาพถ้ามี) → เลือกโครง → สร้างปก
// → โชว์ปกที่ได้เทียบ reference ข้างกัน + คะแนน QC + เหตุผล Director
// เรียก /api/auto-cover-v3 ตรงๆ (ต้องรันบนเซิร์ฟเวอร์ที่มีโค้ดใหม่ = rebuild/dev)
// ============================================================

import { useState, useRef, useEffect } from 'react';

// ★ Preview MVP item 5 — client error formatter ที่ปลอดภัยกับค่าทุกชนิด (string/Error/plain-object/unknown)
//   ไม่มีทาง [object Object] เด็ดขาด · ไม่ JSON.stringify ค่าดิบ (กันหลุด secret/provider body ยาว) · bounded length
function formatClientError(value) {
  if (typeof value === 'string') return value.slice(0, 500) || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
  if (value instanceof Error) return String(value.message || value.name || 'เกิดข้อผิดพลาด').slice(0, 500);
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string' && value.message) return value.message.slice(0, 500);
    if (typeof value.error === 'string' && value.error) return value.error.slice(0, 500);
    return 'เกิดข้อผิดพลาด (รูปแบบไม่คาดคิด)';
  }
  if (value == null) return 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
  return String(value).slice(0, 500);
}

export default function CoverRefTestPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // ★ 15 ก.ค. 69 บัค #5: ถอดช่องฟอร์มที่ไม่ได้ต่อสายจริงออกจากหน้า (เดิมเก็บค่าแต่ไม่เคยส่งเข้า body) — จะใส่กลับเมื่อ wire จริง
  const [refLock, setRefLock] = useState('');
  // ★ 15 ก.ค. 69 แบตช์ 5: คีย์ทีมสำหรับด่านตรวจสิทธิ์ src/middleware.js (เรียกผ่านโฮสต์/cloud) — เก็บใน localStorage เครื่องผู้ใช้เอง ไม่ hardcode
  const [teamKey, setTeamKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [failInfo, setFailInfo] = useState(null);
  const [cancelled, setCancelled] = useState(false);
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  const startTimer = () => {
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
  };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  // ★ audit แบตช์ 3 (terra): ออกจากหน้า = abort fetch ค้าง + หยุด timer (กัน interval รั่ว/setState หลัง unmount)
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  // ★ 15 ก.ค. 69 แบตช์ 5: โหลดคีย์ทีมจาก localStorage ครั้งแรก (เครื่องทีมปล่อยว่างได้ — ด่านผ่าน localhost อยู่แล้ว)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('coverTestKey');
      if (saved) setTeamKey(saved);
    } catch { /* localStorage ไม่พร้อม (private mode ฯลฯ) — ปล่อยว่างไว้ */ }
  }, []);
  // ★ 15 ก.ค. 69 แบตช์ 5: เซฟคีย์ทีมกลับ localStorage ทุกครั้งที่เปลี่ยน
  useEffect(() => {
    try { window.localStorage.setItem('coverTestKey', teamKey); } catch { /* ignore */ }
  }, [teamKey]);

  // ★ 15 ก.ค. 69 บัค #j: gate สองชั้นเหมือนฝั่ง server — content ≥100 ตัว และ (title+content ตาม filter(Boolean)) รวม ≥200 ตัว
  function gateMessage() {
    const c = content.trim();
    const t = title.trim();
    if (c.length < 100) return `ใส่เนื้อข่าวเต็มก่อน (อย่างน้อย 100 ตัวอักษร — ตอนนี้มี ${c.length} ตัวอักษร — กฎ: ห้ามเนื้อสั้นตัดทอน)`;
    const combinedLen = [t, c].filter(Boolean).join('\n\n').length;
    if (combinedLen < 200) return `เนื้อหารวม (หัวข่าว+เนื้อข่าว) ต้องอย่างน้อย 200 ตัวอักษร — ตอนนี้มี ${combinedLen} ตัวอักษร`;
    return '';
  }

  async function generate() {
    const gateMsg = gateMessage();
    if (gateMsg) { setError(gateMsg); return; }
    setError(''); setResult(null); setFailInfo(null); setCancelled(false); setLoading(true); startTimer();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const body = {
        newsTitle: title.trim(),
        content: content.trim(),
      };
      if (refLock.trim()) body.forceTemplateId = refLock.trim();

      // ★ 15 ก.ค. 69 แบตช์ 5: แนบคีย์ทีมเมื่อกรอกไว้ (localhost/เครื่องทีมไม่ต้องมีก็ผ่านด่านได้)
      const headers = { 'content-type': 'application/json' };
      if (teamKey.trim()) headers['x-cover-test-key'] = teamKey.trim();

      const res = await fetch('/api/cover-ref-test', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      // ★ audit แบตช์ 3 (terra): abort ระหว่างอ่าน body ต้องไปเส้นยกเลิก ไม่ใช่โดนกลืนเป็น {} แล้วป้าย error มั่ว
      const j = await res.json().catch((err) => { if (err?.name === 'AbortError') throw err; return {}; });
      if (!res.ok || !j.success) {
        // ★ 15 ก.ค. 69 แบตช์ 5: 401 จากด่านตรวจสิทธิ์ (middleware) → ชี้ให้กรอกคีย์ทีมในช่องนี้แทนข้อความ error ทั่วไป
        if (res.status === 401 && j.errorType === 'COVER_TEST_KEY_REQUIRED') {
          setError('เรียกผ่านโฮสต์นี้ต้องมีคีย์ทีม — กรอกคีย์ทีมในช่อง "คีย์ทีม" ด้านล่างฟอร์มแล้วลองใหม่');
        } else {
          const errText = j.error ? formatClientError(j.error) : String(res.status);
          setError(`สร้างปกไม่สำเร็จ: ${errText} ${j.errorType ? `(${j.errorType})` : ''}`);
        }
        setFailInfo(j);
      } else {
        setResult(j);
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        setCancelled(true);
        setError('ยกเลิกฝั่งหน้าจอแล้ว (งานฝั่งเซิร์ฟเวอร์จะวิ่งจนจบเอง)');
      } else {
        setError('เรียก API ล้ม: ' + formatClientError(e));
      }
    } finally {
      setLoading(false); stopTimer(); abortRef.current = null;
    }
  }

  // ★ 15 ก.ค. 69 บัค #14: ปุ่มยกเลิก — abort fetch เท่านั้น (งานฝั่งเซิร์ฟเวอร์วิ่งต่อจนจบเอง)
  function cancelGenerate() {
    if (abortRef.current) abortRef.current.abort();
  }

  const label = { display: 'block', fontSize: 13, fontWeight: 700, margin: '10px 0 4px', color: '#334155' };
  const input = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>🎯 Cover Ref Test — เทียบภาพแสนไลค์</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        ผ่านท่อ MEGA เต็มทุกขั้น: analyze → keywords → search 4 แหล่ง → triage → เลือก 5 ช่อง → ปก · สร้าง AC-xxxx จริง (ช้ากว่าเดิม ~8-11 นาที)
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* ── ฟอร์ม ── */}
        <div>
          <label style={label}>หัวข่าว</label>
          <input style={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น เบสท์ คำสิงห์ ซื้อรถให้แม่" />

          <label style={label}>เนื้อข่าวเต็ม *</label>
          <textarea style={{ ...input, minHeight: 200, resize: 'vertical', fontFamily: 'inherit' }} value={content} onChange={e => setContent(e.target.value)} placeholder="วางเนื้อข่าวเต็ม (ห้ามเนื้อสั้นตัดทอน)" />
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{content.trim().length} ตัวอักษร</div>

          <label style={label}>ล็อก ref ID (ทางเลือก — ปล่อยว่าง = match อัตโนมัติ)</label>
          <input style={input} value={refLock} onChange={e => setRefLock(e.target.value)} placeholder="เช่น vt_ref_5x4 (ปล่อยว่างถ้าไม่ต้องล็อก)" />

          {/* ★ 15 ก.ค. 69 แบตช์ 5: คีย์ทีม — ด่านตรวจสิทธิ์ (middleware) ต้องใช้เมื่อเรียกผ่านโฮสต์ cloud เท่านั้น */}
          <label style={label}>คีย์ทีม (ใช้เมื่อเรียกผ่านโฮสต์ — เครื่องทีมปล่อยว่างได้)</label>
          <input type="password" style={input} value={teamKey} onChange={e => setTeamKey(e.target.value)} placeholder="กรอกเฉพาะตอนเรียกผ่านโฮสต์ (cloud) — เครื่องทีม/localhost ไม่ต้องกรอก" />

          <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
            🎯 โครงปก = ตามปกเป้าจาก <a href="/ref-covers" style={{ color: '#166534', fontWeight: 700 }}>คลัง reference</a> อัตโนมัติ (ระบบ match แนวข่าว → ใช้ template จาก DNA ปกนั้นจริง)
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={generate}
              disabled={loading}
              style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: loading ? '#94a3b8' : '#2563eb', color: '#fff', fontSize: 15, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? `⏳ กำลังสร้างปก… ${elapsed}s` : '🎨 สร้างปก'}
            </button>
            {loading && (
              <button
                type="button"
                onClick={cancelGenerate}
                style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                ✋ ยกเลิก
              </button>
            )}
          </div>
          {error && (
            <div style={{ marginTop: 10, padding: 10, background: cancelled ? '#f1f5f9' : '#fef2f2', border: `1px solid ${cancelled ? '#cbd5e1' : '#fecaca'}`, borderRadius: 8, color: cancelled ? '#475569' : '#b91c1c', fontSize: 13 }}>{error}</div>
          )}
          {failInfo && (
            <div style={{ marginTop: 10, padding: 10, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 12, color: '#7c2d12' }}>
              <div><b>errorType:</b> {failInfo.errorType || '-'}</div>
              {failInfo.holdReason && <div style={{ marginTop: 4 }}><b>holdReason:</b> {failInfo.holdReason}</div>}
              {Array.isArray(failInfo.qcVerdict?.reasons) && failInfo.qcVerdict.reasons.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>QC reasons:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {failInfo.qcVerdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {Array.isArray(failInfo.trace) && failInfo.trace.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>trace:</b>
                  <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, background: '#fff', border: '1px solid #fed7aa', borderRadius: 6, padding: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {failInfo.trace.filter(Boolean).map((t, i) => (
                      <div key={i}>{t.stage || '?'} · {t.status || '?'}{t.summary ? ` · ${t.summary}` : ''}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── reference (จากคลัง — match ตามข่าว) ── */}
        <div>
          <label style={label}>📌 reference เป้าหมาย {result?.matchedRef ? `— จากคลัง: ${result.matchedRef.styleName || 'ref'}` : '(จากคลัง)'}</label>
          {/* ★ 9 ก.ค.: เลิก fallback /_ref/reference_5x4.jpg — เทมเพลตนั้นถูกผู้ใช้สั่งลบ (ห้ามโผล่ให้เข้าใจผิดว่ายังใช้) */}
          {result?.matchedRef?.imagePath ? (
            <img src={result.matchedRef.imagePath} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
          ) : (
            <div style={{ width: '100%', padding: '48px 16px', borderRadius: 10, border: '2px dashed #cbd5e1', color: '#94a3b8', fontSize: 13, textAlign: 'center', boxSizing: 'border-box' }}>ยังไม่ได้เลือก ref — ระบบจะ match จากคลังตอนกดสร้าง</div>
          )}
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            {result?.matchedRef
              ? `🎯 match: ${result.matchedRef.reason}${result.matchedRef.dna?.layoutType ? ' · โครง: ' + result.matchedRef.dna.layoutType : ''}`
              : <>ระบบจะเลือกปกเป้าจาก <a href="/ref-covers" style={{ color: '#2563eb' }}>คลัง reference</a> ที่แนวตรงข่าว ตอนกดสร้าง (คลังว่าง = ใช้รูปตั้งต้น)</>}
          </div>
        </div>
      </div>

      {/* ── ผลลัพธ์ ── */}
      {result && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>ผลลัพธ์</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ padding: '4px 10px', background: '#eff6ff', borderRadius: 6 }}>โครง: <b>{result.template}</b></span>
            {/* ★ 15 ก.ค. 69 บัค #4: ขับด้วย qcVerdict.pass (result.score เป็นสตริง "เหมือน ref X%" เทียบตัวเลขไม่ได้) */}
            <span style={{ padding: '4px 10px', background: result.qcVerdict?.pass == null ? '#f1f5f9' : result.qcVerdict.pass ? '#dcfce7' : '#fee2e2', borderRadius: 6 }}>
              QC: <b>{result.qcVerdict?.pass == null ? 'ไม่มีผล QC' : result.qcVerdict.pass ? 'ผ่าน' : 'ไม่ผ่าน'}</b>
              {typeof result.refSimilarity === 'number' ? ` · เหมือน ref ${result.refSimilarity}%` : ''}
            </span>
            {/* ★ 15 ก.ค. 69 บัค #12: result.elapsed ไม่มีจริง — ใช้ elapsedTotal */}
            <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เวลา: {result.elapsedTotal || '-'}</span>
            {result.caseId && <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เคส: {result.caseId}</span>}
            {/* ★ Preview MVP item 5: โหมดต้องเห็นชัดเสมอ — ไม่มี mode selector, เป็นแค่การแสดงผลความจริง */}
            <span style={{ padding: '4px 10px', background: result.effectiveMode === 'strict' ? '#ede9fe' : '#fef9c3', borderRadius: 6 }}>
              โหมด: <b>{result.effectiveMode === 'strict' ? 'Strict (Production parity)' : 'Preview / Advisory'}</b>
            </span>
            {result.outputId && <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>outputId: {result.outputId}</span>}
          </div>
          {result.effectiveMode !== 'strict' && (
            <div style={{ marginBottom: 10, padding: 10, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
              ℹ️ โหมด Preview/Advisory — ผลนี้เป็นตัวอย่างให้ดูเท่านั้น ไม่ใช่ผลที่ผ่านมาตรฐาน Strict Production
              (ปกจริงบน Production ต้องผ่าน strict carrier + identity + QC ครบทุกด่านเท่านั้นถึงจะออก)
            </div>
          )}
          {result.productionQcPass === false && (
            <div style={{ marginBottom: 10, padding: 10, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, fontSize: 12, color: '#9a3412' }}>
              ⚠️ QC ไม่ผ่าน (ผล advisory เท่านั้น) — Production จริงจะปฏิเสธปกนี้ (422 QC_REJECTED) และจะไม่บันทึกเข้าคลัง
              ผลที่แสดงด้านล่างมีไว้ดูตัวอย่างเท่านั้น
            </div>
          )}
          {/* ★ 15 ก.ค. 69 บัค #11: โชว์ qcVerdict.reasons เต็มในเคสสำเร็จ */}
          {Array.isArray(result.qcVerdict?.reasons) && result.qcVerdict.reasons.length > 0 && (
            <div style={{ marginBottom: 10, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#334155' }}>
              <b>QC reasons:</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {result.qcVerdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {result.throughMega && (
            <div style={{ margin: '4px 0 10px', padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
              ✅ ผ่านท่อ MEGA จริง · AC: <b>{result.imageCaseId || '-'}</b> · คีย์เวิร์ด {result.keywordsCount ?? '-'} · พูล {result.poolSize ?? '-'} ใบ · รวม {result.elapsedTotal || '-'}
              {Array.isArray(result.trace) && (
                <div style={{ marginTop: 4, color: '#3f6212' }}>
                  {result.trace.filter(Boolean).map((t) => `${t.stage}${t.status === 'failed' ? '❌' : '✓'}`).join(' → ')}
                </div>
              )}
              {result.pickedSlots && (
                <div style={{ marginTop: 4, color: '#3f6212' }}>
                  ช่อง: {Object.entries(result.pickedSlots).filter(([, v]) => v).map(([k, v]) => `${k}=${v.person || v.category || '?'}`).join(' · ')}
                </div>
              )}
            </div>
          )}
          {result.directorReason && <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 12px' }}>🎬 {result.directorReason}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>ปกที่ระบบสร้าง</div>
              <img src={result.base64} alt="cover" style={{ width: '100%', borderRadius: 10, border: '2px solid #2563eb' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>reference (เป้า){result.matchedRef?.styleName ? ` — ${result.matchedRef.styleName}` : ''}</div>
              {result.matchedRef?.imagePath ? (
                <img src={result.matchedRef.imagePath} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
              ) : (
                <div style={{ width: '100%', padding: '48px 16px', borderRadius: 10, border: '2px dashed #cbd5e1', color: '#94a3b8', fontSize: 13, textAlign: 'center', boxSizing: 'border-box' }}>รอบนี้ไม่ได้ใช้ ref จากคลัง</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
