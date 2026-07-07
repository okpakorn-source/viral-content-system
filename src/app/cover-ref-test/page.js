'use client';

// ============================================================
// 🎯 Cover Ref Test — หน้าเทสปกเทียบ "ภาพแสนไลค์ reference" (vt_ref_5x4)
// ------------------------------------------------------------
// ผู้ใช้กดเทสเอง: ใส่เนื้อข่าวเต็ม (+ลิงก์ภาพถ้ามี) → เลือกโครง → สร้างปก
// → โชว์ปกที่ได้เทียบ reference ข้างกัน + คะแนน QC + เหตุผล Director
// เรียก /api/auto-cover-v3 ตรงๆ (ต้องรันบนเซิร์ฟเวอร์ที่มีโค้ดใหม่ = rebuild/dev)
// ============================================================

import { useState, useRef } from 'react';

export default function CoverRefTestPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mainChar, setMainChar] = useState('');
  const [links, setLinks] = useState('');
  const [sourceOnly, setSourceOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  const startTimer = () => {
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
  };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  async function generate() {
    if (content.trim().length < 100) { setError('ใส่เนื้อข่าวเต็มก่อน (อย่างน้อย ~100 ตัวอักษร — กฎ: ห้ามเนื้อสั้นตัดทอน)'); return; }
    setError(''); setResult(null); setLoading(true); startTimer();
    try {
      const body = {
        newsTitle: title.trim(),
        content: content.trim(),
      };

      const res = await fetch('/api/cover-ref-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        setError(`สร้างปกไม่สำเร็จ: ${j.error || res.status} ${j.errorType ? `(${j.errorType})` : ''}`);
      } else {
        setResult(j);
      }
    } catch (e) {
      setError('เรียก API ล้ม: ' + (e?.message || e));
    } finally {
      setLoading(false); stopTimer();
    }
  }

  const label = { display: 'block', fontSize: 13, fontWeight: 700, margin: '10px 0 4px', color: '#334155' };
  const input = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>🎯 Cover Ref Test — เทียบภาพแสนไลค์</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        ผ่านท่อ MEGA เต็มทุกขั้น: analyze → keywords → search 4 แหล่ง → triage → เลือก 5 ช่อง → ปก · สร้าง AC-xxxx จริง (ช้ากว่าเดิม ~3-6 นาที)
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* ── ฟอร์ม ── */}
        <div>
          <label style={label}>หัวข่าว</label>
          <input style={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="เช่น เบสท์ คำสิงห์ ซื้อรถให้แม่" />

          <label style={label}>เนื้อข่าวเต็ม *</label>
          <textarea style={{ ...input, minHeight: 200, resize: 'vertical', fontFamily: 'inherit' }} value={content} onChange={e => setContent(e.target.value)} placeholder="วางเนื้อข่าวเต็ม (ห้ามเนื้อสั้นตัดทอน)" />
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{content.trim().length} ตัวอักษร</div>

          <label style={label}>ชื่อตัวเอก (ช่วยให้ hero ถูกคน — ไม่บังคับ)</label>
          <input style={input} value={mainChar} onChange={e => setMainChar(e.target.value)} placeholder="เช่น เบสท์ คำสิงห์" />

          <label style={label}>ลิงก์ภาพ (ไม่บังคับ — บรรทัดละ 1 ลิงก์ · ข้ามการค้นหา = เร็ว/ถูกกว่า)</label>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} value={links} onChange={e => setLinks(e.target.value)} placeholder={"https://...jpg\nhttps://...jpg"} />
          <label style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input type="checkbox" checked={sourceOnly} onChange={e => setSourceOnly(e.target.checked)} />
            sourceOnly — ใช้เฉพาะลิงก์ที่ให้ ไม่ค้นเพิ่ม (มีผลเมื่อใส่ลิงก์)
          </label>

          <div style={{ marginTop: 10, padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
            🎯 โครงปก = ตามปกเป้าจาก <a href="/ref-covers" style={{ color: '#166534', fontWeight: 700 }}>คลัง reference</a> อัตโนมัติ (ระบบ match แนวข่าว → ใช้ template จาก DNA ปกนั้นจริง)
          </div>

          <button
            onClick={generate}
            disabled={loading}
            style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: loading ? '#94a3b8' : '#2563eb', color: '#fff', fontSize: 15, fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? `⏳ กำลังสร้างปก… ${elapsed}s` : '🎨 สร้างปก'}
          </button>
          {error && <div style={{ marginTop: 10, padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        </div>

        {/* ── reference (จากคลัง — match ตามข่าว) ── */}
        <div>
          <label style={label}>📌 reference เป้าหมาย {result?.matchedRef ? `— จากคลัง: ${result.matchedRef.styleName || 'ref'}` : '(จากคลัง)'}</label>
          <img src={result?.matchedRef?.imagePath || '/_ref/reference_5x4.jpg'} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
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
            <span style={{ padding: '4px 10px', background: result.score >= 9 ? '#dcfce7' : result.score >= 7 ? '#fef9c3' : '#fee2e2', borderRadius: 6 }}>QC: <b>{result.score}/10</b></span>
            <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เวลา: {result.elapsed}</span>
            {result.caseId && <span style={{ padding: '4px 10px', background: '#f1f5f9', borderRadius: 6 }}>เคส: {result.caseId}</span>}
          </div>
          {result.throughMega && (
            <div style={{ margin: '4px 0 10px', padding: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
              ✅ ผ่านท่อ MEGA จริง · AC: <b>{result.imageCaseId || '-'}</b> · คีย์เวิร์ด {result.keywordsCount ?? '-'} · พูล {result.poolSize ?? '-'} ใบ · รวม {result.elapsedTotal || '-'}
              {Array.isArray(result.trace) && (
                <div style={{ marginTop: 4, color: '#3f6212' }}>
                  {result.trace.map((t) => `${t.stage}${t.status === 'failed' ? '❌' : '✓'}`).join(' → ')}
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
              <img src={result.matchedRef?.imagePath || '/_ref/reference_5x4.jpg'} alt="reference" style={{ width: '100%', borderRadius: 10, border: '2px solid #e2e8f0' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
