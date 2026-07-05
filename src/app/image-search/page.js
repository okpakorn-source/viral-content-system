'use client';
// ============================================================
// 🔎 /image-search — ค้นภาพจากหลายแหล่งพร้อมกัน → คลังให้เลือกภาพลงปกเอง
// ★ 4 ก.ค. 2026 พอร์ตส่วนรีเสิร์ชภาพจากโปรเจกต์ระบบทำปกออโต้ (ผู้ใช้สั่ง)
//   "แค่ค้นภาพจากทุกแหล่ง" — ผู้ใช้พิมพ์คำค้นเอง เลือกแหล่งเอง เลือกภาพเอง
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/layout/Header';

const PLATFORMS = [
  { id: 'google', label: '🌄 Google', def: true },
  { id: 'google_news', label: '📰 Google News', def: true },
  { id: 'yandex', label: '🌐 Yandex', def: false },
  { id: 'bing', label: '🔷 Bing', def: true },
  { id: 'bing_news', label: '📑 Bing News', def: false },
  { id: 'facebook', label: '📘 FB (เว็บ)', def: true },
  { id: 'tiktok', label: '🎵 TikTok', def: true },
  { id: 'youtube', label: '▶️ YouTube (ธัมบ์)', def: false },
];
const PLABEL = Object.fromEntries(PLATFORMS.map(p => [p.id, p.label]));
PLABEL.reverse = '🔍 ย้อนกลับ'; PLABEL.instagram = '📷 IG'; PLABEL.fb_profile = '📘 FB โปรไฟล์';

// ★ 5 ก.ค.: หมวดอารมณ์ภาพ (สมองแยกอารมณ์ พอร์ตจากระบบทำปกออโต้)
const EMOTION_LABEL = {
  happy: '😊 ยิ้ม', laugh: '😂 หัวเราะ', sad: '😢 เศร้า', serious: '😐 จริงจัง', angry: '😠 โกรธ',
  shock: '😱 ตกใจ', warm: '🤗 อบอุ่น', worried: '😟 กังวล', context: '🏞 ฉาก', document: '📄 เอกสาร', other: '❔ อื่นๆ',
};

// ★ 5 ก.ค. (ผู้ใช้: "อ่านยาก ขอสะอาดตา มินิมอล"): โทนเดียว — ฟ้า=ปุ่มหลัก/เลือก · เขียว=สำเร็จ · แดง=ลบ · ที่เหลือเทากลาง
const ACCENT = '#60a5fa';
const s = {
  card: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 14, marginBottom: 16, padding: 16 },
  btn: (active, color = ACCENT) => ({
    padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
    border: `1px solid ${active ? color + '55' : 'var(--border)'}`,
    background: active ? color + '14' : 'transparent',
    color: active ? color : 'var(--text-secondary)',
  }),
  input: { padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
};

export default function ImageSearchPage() {
  const [selected, setSelected] = useState(PLATFORMS.filter(p => p.def).map(p => p.id));
  const [queriesText, setQueriesText] = useState('');
  const [reverseUrl, setReverseUrl] = useState('');
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState('');            // ข้อความสถานะกำลังทำงาน
  const [notice, setNotice] = useState('');        // ผลล่าสุด
  const [cases, setCases] = useState([]);          // รายชื่อเคส
  const [cur, setCur] = useState(null);            // เคสปัจจุบัน (เต็ม)
  const [tab, setTab] = useState('all');           // แท็บแหล่งในคลัง
  const [picked, setPicked] = useState(new Set()); // ภาพที่เลือก (โหมดเลือก)
  const [pickMode, setPickMode] = useState(false);
  // ★ 5 ก.ค.: สมองครบชุด — เนื้อข่าวเต็ม → วิเคราะห์ → สกัดคีย์เวิร์ด → ค้นอัตโนมัติ
  const [newsText, setNewsText] = useState('');
  const [emoTab, setEmoTab] = useState('all');     // แท็บกรองอารมณ์ในคลัง

  const loadCases = useCallback(async () => {
    try {
      const r = await fetch('/api/image-search');
      const d = await r.json();
      if (d.success) setCases(d.cases || []);
    } catch { /* เงียบ */ }
  }, []);
  useEffect(() => { loadCases(); }, [loadCases]);

  const openCase = async (id) => {
    if (!id) { setCur(null); return; }
    try {
      const r = await fetch(`/api/image-search?caseId=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (d.success) { setCur(d.case); setTab('all'); setPicked(new Set()); }
    } catch { /* เงียบ */ }
  };

  const post = async (payload, busyText) => {
    setBusy(busyText); setNotice('');
    try {
      const r = await fetch('/api/image-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!d.success) { setNotice('❌ ' + (d.error || 'ไม่สำเร็จ')); return null; }
      if (d.case) { setCur(d.case); }
      loadCases();
      return d;
    } catch (e) {
      setNotice('❌ ' + e.message);
      return null;
    } finally { setBusy(''); }
  };

  const doSearch = async (platforms) => {
    const queries = queriesText.split('\n').map(q => q.trim()).filter(Boolean);
    if (!queries.length) { setNotice('⚠️ พิมพ์คำค้นก่อน (บรรทัดละ 1 คำค้น)'); return; }
    if (!platforms.length) { setNotice('⚠️ เลือกแหล่งอย่างน้อย 1 แหล่ง'); return; }
    const d = await post(
      { action: 'search', caseId: cur?.id || null, queries, platforms },
      `🔎 กำลังค้น ${platforms.length} แหล่ง × ${queries.length} คำค้น... (อาจใช้ ~10-40 วิ)`
    );
    if (d) {
      const parts = Object.entries(d.addedByPlatform || {}).map(([p, n]) => `${PLABEL[p] || p} +${n}`).join(' · ');
      setNotice(`✅ ได้ภาพใหม่ ${Object.values(d.addedByPlatform || {}).reduce((a, b) => a + b, 0)} ใบ (${parts}) · รวมในเคส ${d.total} ใบ${d.errors?.length ? ` · ⚠️ ล้ม ${d.errors.length} จุด` : ''}`);
    }
  };

  const doReverse = async () => {
    if (!/^https?:/.test(reverseUrl.trim())) { setNotice('⚠️ วางลิงก์ภาพ (http...) ก่อนค้นย้อนกลับ'); return; }
    const d = await post({ action: 'reverse', caseId: cur?.id || null, imageUrl: reverseUrl.trim() }, '🔍 Lens กำลังค้นย้อนกลับ...');
    if (d) setNotice(`✅ ย้อนกลับได้ ${d.added} ใบ · รวม ${d.total} ใบ`);
  };

  const doProfile = async (network) => {
    if (!profileName.trim()) { setNotice('⚠️ ใส่ username หรือลิงก์โปรไฟล์ก่อน'); return; }
    const d = await post({ action: 'profile', caseId: cur?.id || null, username: profileName.trim(), network }, `📥 กำลังดึงรูปโปรไฟล์ ${network === 'facebook' ? 'FB' : 'IG'}...`);
    if (d) setNotice(`✅ ได้ ${d.added} ใบจากโปรไฟล์ · รวม ${d.total} ใบ`);
  };

  // ★ 5 ก.ค.: สมองขั้น 1+2 — วิเคราะห์เนื้อข่าวเต็ม + สกัดคีย์เวิร์ด (สร้าง/อัปเดตเคส)
  const doAnalyze = async () => {
    if (newsText.trim().length < 40) { setNotice('⚠️ วางเนื้อข่าวเต็มก่อน (อย่างน้อย 40 ตัวอักษร)'); return; }
    const d = await post({ action: 'analyze', caseId: cur?.id || null, newsText: newsText.trim() },
      '🧠 AI กำลังอ่านข่าวทั้งหมด → วิเคราะห์ตัวละคร/แก่นเรื่อง → สกัดคีย์เวิร์ดค้นภาพ... (ข่าวสั้น ~1 นาที · ข่าวยาว/ตัวละครเยอะ ~2 นาที — อย่าเพิ่งปิดหน้า)');
    if (d) {
      setNotice(`✅ วิเคราะห์เสร็จ: "${(d.case?.analysis?.headline || '').slice(0, 60)}" · ตัวละคร ${(d.case?.keywords?.subjects || []).length} · คำค้นพร้อมยิง ${d.queriesPreview?.length || 0} คำ — กดค้นภาพ (ขั้น ②) ได้เลย`);
      setTimeout(() => { try { document.getElementById('analysis-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* เงียบ */ } }, 350);
    }
  };

  // ★ ค้นด้วยคีย์เวิร์ดที่สกัดจากข่าว (buildQueries: สมดุลต่อคน + การันตีหลักฐาน/สถานที่)
  const doSearchAuto = async (platforms) => {
    if (!cur?.keywords) { setNotice('⚠️ ต้องวิเคราะห์ข่าวก่อน (ขั้น ①) แล้วค่อยค้นภาพ'); return; }
    if (!platforms.length) { setNotice('⚠️ เลือกแหล่งอย่างน้อย 1 แหล่ง'); return; }
    const d = await post({ action: 'searchAuto', caseId: cur.id, platforms },
      `🔎 ค้นภาพด้วยคีย์เวิร์ดจากข่าว × ${platforms.length} แหล่ง... (~20-60 วิ)`);
    if (d) {
      const parts = Object.entries(d.addedByPlatform || {}).map(([p, n]) => `${PLABEL[p] || p} +${n}`).join(' · ');
      setNotice(`✅ ใช้ ${d.queriesUsed?.length || 0} คำค้น ได้ภาพใหม่ ${Object.values(d.addedByPlatform || {}).reduce((a, b) => a + b, 0)} ใบ (${parts})${d.blockedCatalog ? ` · 🚫 กันแคตตาล็อก ${d.blockedCatalog}` : ''} · รวม ${d.total} ใบ`);
    }
  };

  // ★ AI คัดขยะออก (แคตตาล็อกฟรี + Gemini ส่องทีละใบ)
  const doClean = async () => {
    if (!cur) return;
    const d = await post({ action: 'clean', caseId: cur.id }, '🧹 AI กำลังส่องทุกภาพ คัดขยะออก (ตัวหนังสือทับ/ลายน้ำ/ปกคลิป/วัตถุมั่ว/ไม่เกี่ยวข่าว)... (~1-3 นาที)');
    if (d) setNotice(`✅ คัดขยะออก ${d.removed} ใบ (แคตตาล็อก ${d.catalogRemoved} + AI ${d.aiRemoved}) · เหลือ ${d.total} ใบ`);
  };

  // ★ AI แยกอารมณ์ภาพ → กรองในคลังได้
  const doEmotions = async () => {
    if (!cur) return;
    const d = await post({ action: 'emotions', caseId: cur.id }, '🎭 AI กำลังส่องสีหน้า/อารมณ์ทุกภาพ แยกหมวด... (~1-3 นาที)');
    if (d) setNotice(`✅ แยกอารมณ์แล้ว ${d.classified} ใบ — กดชิปอารมณ์ในคลังเพื่อกรอง`);
  };

  const images = cur?.images || [];
  const byPlatform = {};
  const byEmotion = {};
  for (const im of images) {
    const p = im.platform || 'อื่นๆ'; byPlatform[p] = (byPlatform[p] || 0) + 1;
    if (im.emotion) byEmotion[im.emotion] = (byEmotion[im.emotion] || 0) + 1;
  }
  const shown = (tab === 'all' ? images : images.filter(im => (im.platform || 'อื่นๆ') === tab))
    .filter(im => emoTab === 'all' || im.emotion === emoTab);

  const togglePick = (id) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async (action) => {
    if (!cur || picked.size === 0) return;
    const d = await post({ action, caseId: cur.id, ids: [...picked] }, action === 'remove' ? '🗑 กำลังลบ...' : '💾 กำลังเก็บเฉพาะที่เลือก...');
    if (d) { setPicked(new Set()); setNotice(`✅ เหลือ ${d.total} ใบในเคส`); }
  };
  const downloadPicked = () => {
    const sel = images.filter(im => picked.has(im.id));
    sel.slice(0, 20).forEach((im, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/api/image-search/fetch?dl=1&url=${encodeURIComponent(im.imageUrl)}`;
        a.download = ''; a.click();
      }, i * 600);
    });
    setNotice(`📥 กำลังดาวน์โหลด ${Math.min(sel.length, 20)} ใบ (ทีละไฟล์)...`);
  };

  return (
    <>
      <Header title="🔎 ค้นภาพหลายแหล่ง" subtitle="ค้นภาพจากทุกแหล่งพร้อมกัน → คลังรูปเคส → เลือกภาพที่ดีที่สุดไปทำปกเอง" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 14px 60px' }}>

        {/* ── ① 🧠 วางเนื้อข่าวเต็ม → AI วิเคราะห์ + สกัดคีย์เวิร์ด (สมองจากระบบทำปกออโต้) ── */}
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>① 🧠 วางเนื้อข่าวเต็ม → AI สกัดคีย์เวิร์ดค้นภาพ</span>
            <a href="/cover-tester" style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
              🎨 ไปหน้าทำปก
            </a>
          </div>
          <textarea value={newsText} onChange={e => setNewsText(e.target.value)} rows={5}
            placeholder={'วางเนื้อข่าวเต็มตรงนี้ (ยิ่งเต็มยิ่งแม่น)\nAI จะอ่านทั้งหมด → ถอดตัวละคร/แก่นเรื่อง/โทนอารมณ์ → สกัดคำค้นภาพผูกชื่อบุคคลให้เอง'}
            style={{ ...s.input, width: '100%', resize: 'vertical', marginBottom: 10, minHeight: 110 }} />
          <button onClick={doAnalyze} disabled={!!busy}
            style={{ padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: 'none', background: '#2563eb', color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy && busy.startsWith('🧠') ? '⏳ กำลังวิเคราะห์... รอสักครู่' : '🧠 วิเคราะห์ + สกัดคีย์เวิร์ด'}
          </button>
          {/* ★ 5 ก.ค.: สถานะโชว์ใต้ปุ่มที่กดเลย (เดิมไปโผล่การ์ดล่าง ผู้ใช้ไม่เห็น = คิดว่าไม่มีผลลัพธ์) */}
          {(busy || notice) && (
            <div style={{ marginTop: 10, padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: busy ? 'rgba(96,165,250,0.08)' : 'rgba(74,222,128,0.07)', border: `1px solid ${busy ? 'rgba(96,165,250,0.25)' : 'rgba(74,222,128,0.2)'}`, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {busy || notice}
            </div>
          )}
          {cur?.analysis && (
            <div id="analysis-result" style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.18)', fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>📰 {cur.analysis.headline}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                โทน: {cur.analysis.context?.emotional_tone || '-'} · โมเมนต์สำคัญ: {(cur.analysis.context?.key_moment || '-').slice(0, 70)}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {(cur.keywords?.subjects || []).map((su, i) => (
                  <span key={i} style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: su.must_have ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: su.must_have ? ACCENT : 'var(--text-secondary)' }}>
                    {su.kind === 'object' ? '📦' : '👤'} {su.name}{su.role ? ` · ${String(su.role).slice(0, 18)}` : ''}
                  </span>
                ))}
              </div>
              {(cur.keywords?.queries_th?.length || 0) > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    ดูคำค้นที่สกัดได้ ({(cur.keywords.queries_th || []).length + (cur.keywords.queries_en || []).length + (cur.keywords.object_queries || []).length} คำ)
                  </summary>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                    {[...(cur.keywords.queries_th || []), ...(cur.keywords.object_queries || []), ...(cur.keywords.queries_en || [])].slice(0, 30).map((q, i) => (
                      <span key={i} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{q}</span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {/* ── ② เลือกแหล่ง + ค้นภาพ (หลัก = ใช้คีย์เวิร์ดจากข่าว · ขั้นสูง = พิมพ์เอง) ── */}
        <div style={s.card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>② 🔍 เลือกแหล่ง แล้วค้นภาพ</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
            {PLATFORMS.map(p => {
              const on = selected.includes(p.id);
              return (
                <button key={p.id} onClick={() => setSelected(prev => on ? prev.filter(x => x !== p.id) : [...prev, p.id])} style={s.btn(on, '#60a5fa')}>
                  {on ? '☑' : '☐'} {p.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => doSearchAuto(selected)} disabled={!!busy || !cur?.keywords}
              title={!cur?.keywords ? 'วิเคราะห์ข่าวก่อน (ขั้น ①)' : ''}
              style={{ padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: 'none', background: '#2563eb', color: '#fff', opacity: (busy || !cur?.keywords) ? 0.5 : 1 }}>
              🔍 ค้นด้วยคีย์เวิร์ดจากข่าว ({selected.length} แหล่ง)
            </button>
            <button onClick={() => setSelected(PLATFORMS.map(p => p.id))} style={s.btn(false)}>เลือกทั้งหมด</button>
            <button onClick={() => setSelected([])} style={s.btn(false)}>ล้าง</button>
          </div>
          {!cur?.keywords && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 7 }}>⬆️ วิเคราะห์ข่าวก่อน (ขั้น ①) แล้วปุ่มนี้จะกดได้ — ระบบจะค้นด้วยคำค้นที่ผูกชื่อบุคคลจากข่าวจริง</div>}
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>ขั้นสูง: พิมพ์คำค้นเอง (ไม่ผ่านสมองวิเคราะห์ — ระวังได้ภาพมั่ว)</summary>
            <textarea value={queriesText} onChange={e => setQueriesText(e.target.value)} rows={2}
              placeholder={'พิมพ์คำค้น บรรทัดละ 1 คำ (สูงสุด 5)'}
              style={{ ...s.input, width: '100%', resize: 'vertical', margin: '8px 0', minHeight: 58 }} />
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button onClick={() => doSearch(selected)} disabled={!!busy} style={s.btn(true)}>ค้นเอง ({selected.length} แหล่ง)</button>
              {PLATFORMS.map(p => (
                <button key={p.id} onClick={() => doSearch([p.id])} disabled={!!busy} style={{ ...s.btn(false), opacity: busy ? 0.6 : 1 }}>{p.label}</button>
              ))}
            </div>
          </details>

          {/* ค้นย้อนกลับ + โปรไฟล์ */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <input value={reverseUrl} onChange={e => setReverseUrl(e.target.value)} placeholder="วางลิงก์ภาพ → ค้นย้อนกลับ (Lens) เจอคนเดิมทุกเว็บ" style={{ ...s.input, flex: 1, minWidth: 220 }} />
            <button onClick={doReverse} disabled={!!busy} style={s.btn(true)}>🔍 ค้นย้อนกลับ (Lens)</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="username หรือลิงก์โปรไฟล์ IG/FB (เช่น bestrw)" style={{ ...s.input, flex: 1, minWidth: 220 }} />
            <button onClick={() => doProfile('instagram')} disabled={!!busy} style={s.btn(false)}>📷 IG</button>
            <button onClick={() => doProfile('facebook')} disabled={!!busy} style={s.btn(false)}>📘 FB โปรไฟล์</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.7 }}>
            ข่าวสด (Google/Bing News) ตรงประเด็น · Yandex เก่งหาคนไทย · 🔍 ค้นย้อนกลับจากภาพในคลัง = เจอคนเดิมเป๊ะ · IG/FB ต้องรู้ username
          </div>
          {(busy || notice) && (
            <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: busy ? 'rgba(96,165,250,0.08)' : 'rgba(74,222,128,0.07)', border: `1px solid ${busy ? 'rgba(96,165,250,0.25)' : 'rgba(74,222,128,0.2)'}`, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {busy || notice}
            </div>
          )}
        </div>

        {/* ── ② คลังรูปเคส ── */}
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>📁 คลังรูปเคส{cur ? ` · ${images.length} รูป` : ''}</span>
            <select value={cur?.id || ''} onChange={e => openCase(e.target.value)} style={{ ...s.input, padding: '8px 10px', fontSize: 12, maxWidth: 280 }}>
              <option value="">— เลือกเคสเก่า / ค้นใหม่=เคสใหม่อัตโนมัติ —</option>
              {cases.map(c => <option key={c.id} value={c.id}>{c.title} ({c.total})</option>)}
            </select>
            {cur && <button onClick={() => { setCur(null); setPicked(new Set()); setNotice('เริ่มเคสใหม่ — ค้นครั้งถัดไปจะสร้างเคสใหม่ให้'); }} style={s.btn(false)}>➕ เคสใหม่</button>}
            {cur && (
              <button onClick={() => { setPickMode(v => !v); setPicked(new Set()); }} style={s.btn(pickMode, '#60a5fa')}>
                {pickMode ? '☑ กำลังเลือก (แตะรูป)' : '☐ เลือกรูปเอง (ลบ/เก็บ/โหลด)'}
              </button>
            )}
          </div>

          {cur && pickMode && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', alignSelf: 'center' }}>เลือกแล้ว {picked.size} ใบ:</span>
              <button onClick={() => bulk('remove')} disabled={!picked.size} style={s.btn(true, '#f87171')}>🗑 ลบที่เลือก</button>
              <button onClick={() => bulk('keep')} disabled={!picked.size} style={s.btn(true, ACCENT)}>💾 เก็บเฉพาะที่เลือก</button>
              <button onClick={downloadPicked} disabled={!picked.size} style={s.btn(true)}>📥 ดาวน์โหลดที่เลือก (ไปทำปก)</button>
            </div>
          )}

          {cur ? (
            <>
              {/* ★ 5 ก.ค.: ปุ่มสมอง AI จัดคลัง (พอร์ตจากระบบทำปกออโต้) */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <button onClick={doClean} disabled={!!busy || !images.length} style={s.btn(true)}>🧹 AI คัดขยะออก</button>
                <button onClick={doEmotions} disabled={!!busy || !images.length} style={s.btn(true)}>🎭 AI แยกอารมณ์</button>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>คัดขยะ = ลบตัวหนังสือทับ/ลายน้ำ/ปกคลิป/วัตถุมั่ว/ไม่เกี่ยวข่าว · แยกอารมณ์ = ติดป้ายกรองได้</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <button onClick={() => setTab('all')} style={s.btn(tab === 'all', ACCENT)}>ทั้งหมด {images.length}</button>
                {Object.entries(byPlatform).map(([p, n]) => (
                  <button key={p} onClick={() => setTab(p)} style={s.btn(tab === p, ACCENT)}>{PLABEL[p] || p} {n}</button>
                ))}
              </div>
              {Object.keys(byEmotion).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button onClick={() => setEmoTab('all')} style={s.btn(emoTab === 'all', ACCENT)}>ทุกอารมณ์</button>
                  {Object.entries(byEmotion).sort((a, b) => b[1] - a[1]).map(([e, n]) => (
                    <button key={e} onClick={() => setEmoTab(emoTab === e ? 'all' : e)} style={s.btn(emoTab === e, ACCENT)}>{EMOTION_LABEL[e] || e} {n}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8 }}>
                {shown.map(im => {
                  const isPicked = picked.has(im.id);
                  return (
                    <div key={im.id}
                      onClick={() => pickMode ? togglePick(im.id) : window.open(im.sourceLink || im.imageUrl, '_blank')}
                      style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: isPicked ? '3px solid #60a5fa' : '1px solid var(--border)', background: '#111', aspectRatio: '3/4' }}>
                      {/* ใช้ thumbnail ก่อน (โหลดไว) — เต็มจริงอยู่ที่ imageUrl */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.thumbnailUrl || im.imageUrl} alt="" loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: isPicked ? 0.75 : 1 }}
                        onError={e => { e.currentTarget.style.opacity = 0.15; }} />
                      <span style={{ position: 'absolute', top: 5, left: 5, fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'rgba(0,0,0,0.72)', color: '#93c5fd' }}>
                        {(PLABEL[im.platform] || im.platform || '').replace(/^[^ ]+ /, '') || im.platform}
                      </span>
                      {isPicked && <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 15 }}>✅</span>}
                      {!isPicked && im.emotion && EMOTION_LABEL[im.emotion] && (
                        <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 11, padding: '1px 5px', borderRadius: 5, background: 'rgba(0,0,0,0.72)' }}>{EMOTION_LABEL[im.emotion].split(' ')[0]}</span>
                      )}
                      {im.source && (
                        <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 9, padding: '3px 6px', background: 'rgba(0,0,0,0.72)', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {im.source}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>ยังไม่มีรูปในแท็บนี้</div>}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.7 }}>
                💡 แตะรูป = เปิดหน้าต้นทาง · โหมดเลือก = แตะติ๊กหลายใบแล้ว ลบ/เก็บเฉพาะ/ดาวน์โหลด · ภาพที่โหลดมา → อัปโหลดเข้า <a href="/cover-tester" style={{ color: ACCENT }}>หน้าทำปก</a> ได้เลย
              </div>
            </>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              🔍 ค้นครั้งแรกจะสร้างเคสใหม่อัตโนมัติ — หรือเลือกเคสเก่าจากเมนูด้านบน
            </div>
          )}
        </div>
      </div>
    </>
  );
}
