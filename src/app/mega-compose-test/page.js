'use client';

// ⚡ ทางลัดเทสประกอบปก — ใช้คลังเคสที่มีอยู่แล้ว (ไม่ค้นภาพ/ตาคัดใหม่) ประกอบปกใน ~20 วิ
//   ไว้จูนครอป/โครง/ตาเทียบ ref ให้นิ่งเร็ว โดยไม่ต้องรันทั้งท่อ
import { useState, useEffect } from 'react';

export default function MegaComposeTest() {
  const [cases, setCases] = useState([]);
  const [refs, setRefs] = useState([]);
  const [caseId, setCaseId] = useState('');
  const [refId, setRefId] = useState(''); // '' = auto-match
  const [heroHint, setHeroHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/mega/compose-test?list=1').then((r) => r.json()).then((d) => {
      if (d.success) { setCases(d.cases || []); setRefs(d.refs || []); if (d.cases?.[0]) setCaseId(d.cases[0].id); }
    }).catch(() => {});
  }, []);

  const run = async () => {
    if (!caseId) return;
    setBusy(true); setErr(''); setResult(null);
    const t = Date.now();
    try {
      const r = await fetch('/api/mega/compose-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, refId: refId || undefined, heroPersonHint: heroHint || undefined }),
      });
      const d = await r.json();
      if (!d.success) setErr(d.error || 'ประกอบล้ม'); else setResult(d);
    } catch (e) { setErr('เรียก API ล้ม: ' + e.message); }
    finally { setBusy(false); }
    console.log('compose-test', ((Date.now() - t) / 1000).toFixed(1) + 's');
  };

  const refUsed = result?.refUsed || refs.find((x) => x.id === refId);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'inherit', color: '#1e293b' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>⚡ ทางลัดเทสประกอบปก</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        ใช้คลังเคสที่ตาคัดแล้ว → ประกอบปกตรงๆ ~20 วิ (ไม่ค้นภาพ/ตาคัดใหม่) · ไว้จูนครอป/โครง/ตาเทียบ ref ให้นิ่งเร็ว
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <label style={{ fontSize: 13 }}>เคส (มีภาพตาคัดแล้ว)
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 8, border: '1px solid #cbd5e1' }}>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.id} · {(c.headline || '').slice(0, 40)} · เกี่ยว {c.relevant} (หน้าเดี่ยว {c.cleanFace})</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13 }}>ปก ref
          <select value={refId} onChange={(e) => setRefId(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 8, border: '1px solid #cbd5e1' }}>
            <option value="">— auto-match ตามอารมณ์ข่าว —</option>
            {refs.map((r) => <option key={r.id} value={r.id}>{(r.styleName || r.id).slice(0, 30)} · {r.layoutFamily} · {r.panelCount} ช่อง</option>)}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 13, display: 'block', marginTop: 10 }}>ชื่อ hero (ช่วยล็อกตัวเอก — ว่างได้)
        <input value={heroHint} onChange={(e) => setHeroHint(e.target.value)} placeholder="เช่น น้ำอิง สุทธิดา" style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 8, border: '1px solid #cbd5e1' }} />
      </label>

      <button onClick={run} disabled={busy || !caseId}
        style={{ marginTop: 14, width: '100%', padding: 12, borderRadius: 10, border: 'none', background: busy ? '#94a3b8' : '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? '⏳ กำลังประกอบ...' : '🏭 ประกอบปก (ทางลัด)'}
      </button>

      {err && <div style={{ marginTop: 14, padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 8 }}>
            <b>โครง:</b> {result.template} · <b>เหมือน ref:</b> {result.refSimilarity ?? '-'}% · <b>ตาแก้:</b> {result.eyeFixed || 0} จุด · <b>พูล:</b> {result.poolSize} · <b>เวลา:</b> {result.elapsed}
            {result.refDiffs?.length ? <div style={{ color: '#b45309', marginTop: 4 }}>จุดต่าง: {result.refDiffs.join(' · ')}</div> : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>ปกที่ประกอบ</span>
                {/* ⬇️ 9 ก.ค.: โหลดภาพจากผลตรงหน้านี้ + ป้ายยืนยันเข้าคลังออโต้ */}
                {result.base64 && (
                  <a href={result.base64} download={`${result.archivedId || result.caseId || 'mega-cover'}.jpg`}
                    style={{ padding: '3px 10px', borderRadius: 6, background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>⬇️ โหลดภาพ</a>
                )}
                {result.archivedId && <a href="/mega-covers" style={{ color: '#16a34a', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>🗂️ เข้าคลังแล้ว ({result.archivedId})</a>}
              </div>
              {result.base64 && <img src={result.base64} alt="cover" style={{ width: '100%', borderRadius: 10, border: '2px solid #4f46e5' }} />}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>ref เป้า — {refUsed?.styleName || '-'}</div>
              {refUsed?.imagePath && <img src={refUsed.imagePath} alt="ref" style={{ width: '100%', borderRadius: 10, border: '1px solid #cbd5e1' }} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
