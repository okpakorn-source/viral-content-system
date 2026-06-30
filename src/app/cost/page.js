'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 💰 ต้นทุน API เรียลไทม์ — สรุปยอดเงิน/โทเคนทุกโมเดล (1/7/30 วัน)
 * 🔴 อ่านอย่างเดียวจาก /api/usage-cost (ตาราง api_usage_logs) — ไม่แตะระบบทำข่าว/ปก/คลิป
 */

const RANGES = [
  { days: 1, label: 'ย้อนหลัง 1 วัน' },
  { days: 7, label: '7 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
];

const fmtUsd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtThb = (n) => '฿' + Math.round(Number(n) || 0).toLocaleString('th-TH');
const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-US');
const fmtTok = (n) => { const v = Number(n) || 0; return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v); };

const PROVIDER_ICON = { anthropic: '🟣', openai: '🟢', gemini: '🔵', gemini_video: '🎬', gemini_vision: '👁️', gemini_video_file: '🎬' };

export default function CostDashboard() {
  const [days, setDays] = useState(30);
  const [rate, setRate] = useState(36.5);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await fetch(`/api/usage-cost?days=${days}&rate=${rate}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'load failed');
      setData(j);
      setUpdatedAt(new Date());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [days, rate]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (auto) timer.current = setInterval(load, 60000); // เรียลไทม์ ~ทุก 60 วิ (ตรงกับ cache ฝั่ง API)
    return () => timer.current && clearInterval(timer.current);
  }, [auto, load]);

  const t = data?.totals;
  const maxDayUsd = Math.max(1, ...(data?.byDay || []).map((d) => d.usd));

  const card = { background: 'var(--surface, #1b1d24)', border: '1px solid var(--border, #2c2f3a)', borderRadius: 14, padding: '16px 18px' };
  const muted = { color: 'var(--text-muted, #8a8f9c)' };
  const barRow = (rkey, label, val, max, color, sub) => (
    <div key={rkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <div style={{ width: 200, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
      <div style={{ flex: 1, background: 'var(--surface-2, #14161c)', borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, (val / max) * 100)}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .4s' }} />
      </div>
      <div style={{ width: 130, textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmtThb(val * rate)}<span style={{ ...muted, fontWeight: 400, fontSize: 11 }}> · {fmtUsd(val)}</span></div>
      {sub != null && <div style={{ width: 70, textAlign: 'right', fontSize: 11, ...muted }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 18px 60px', color: 'var(--text, #e8eaf0)', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>💰 ต้นทุน API เรียลไทม์</h1>
          <div style={{ ...muted, fontSize: 13, marginTop: 4 }}>
            อัปเดต {updatedAt ? updatedAt.toLocaleTimeString('th-TH') : '—'}
            {auto && <span style={{ color: 'var(--desk-green, #34d399)' }}> · 🟢 เรียลไทม์ (ทุก 60 วิ)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, ...muted, display: 'flex', alignItems: 'center', gap: 5 }}>
            อัตรา ฿/$
            <input type="number" value={rate} step="0.1" onChange={(e) => setRate(parseFloat(e.target.value) || 36.5)}
              style={{ width: 64, padding: '5px 7px', borderRadius: 7, border: '1px solid var(--border,#2c2f3a)', background: 'var(--surface-2,#14161c)', color: 'inherit' }} />
          </label>
          <button onClick={() => setAuto((a) => !a)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border,#2c2f3a)', background: auto ? 'var(--desk-green,#34d399)' : 'transparent', color: auto ? '#062018' : 'inherit', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{auto ? '🟢 เรียลไทม์' : '⏸️ หยุด'}</button>
          <button onClick={() => { setLoading(true); load(); }} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border,#2c2f3a)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}>🔄 รีเฟรช</button>
        </div>
      </div>

      {/* Range tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <button key={r.days} onClick={() => setDays(r.days)}
            style={{ padding: '8px 16px', borderRadius: 9, border: '1px solid var(--border,#2c2f3a)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: days === r.days ? 'var(--accent,#6366f1)' : 'transparent', color: days === r.days ? '#fff' : 'inherit' }}>{r.label}</button>
        ))}
      </div>

      {err && <div style={{ ...card, borderColor: 'var(--desk-red,#ef4444)', color: 'var(--desk-red,#ef4444)', marginBottom: 16 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ ...card, textAlign: 'center', ...muted }}>กำลังโหลด…</div>}

      {t && (
        <>
          {/* Total cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ ...card, gridColumn: 'span 1', background: 'linear-gradient(135deg, var(--accent,#6366f1)22, transparent)' }}>
              <div style={{ ...muted, fontSize: 12 }}>รวมทั้งหมด ({days} วัน)</div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginTop: 4 }}>{fmtThb(t.thb)}</div>
              <div style={{ ...muted, fontSize: 14 }}>{fmtUsd(t.usd)}</div>
            </div>
            <div style={card}>
              <div style={{ ...muted, fontSize: 12 }}>เรียก API</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{fmtNum(t.calls)}</div>
              <div style={{ ...muted, fontSize: 12 }}>ครั้ง</div>
            </div>
            <div style={card}>
              <div style={{ ...muted, fontSize: 12 }}>โทเคนรวม</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{fmtTok(t.totalTokens)}</div>
              <div style={{ ...muted, fontSize: 12 }}>เข้า {fmtTok(t.inputTokens)} · ออก {fmtTok(t.outputTokens)}</div>
            </div>
            <div style={card}>
              <div style={{ ...muted, fontSize: 12 }}>เฉลี่ย/วัน</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{fmtThb(t.thb / days)}</div>
              <div style={{ ...muted, fontSize: 12 }}>{fmtUsd(t.usd / days)}</div>
            </div>
          </div>

          {/* Daily chart */}
          {data.byDay?.length > 1 && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📈 ต้นทุนรายวัน</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                {data.byDay.map((d) => (
                  <div key={d.day} title={`${d.day}: ${fmtThb(d.thb)} (${d.calls} calls)`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ width: '100%', maxWidth: 26, height: `${Math.max(3, (d.usd / maxDayUsd) * 100)}%`, background: 'var(--accent,#6366f1)', borderRadius: '4px 4px 0 0' }} />
                    <div style={{ ...muted, fontSize: 9, marginTop: 4, transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{d.day.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By provider */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🏢 ตามผู้ให้บริการ</div>
            {data.byProvider.map((p) => barRow(p.key, `${PROVIDER_ICON[p.key] || '•'} ${p.key}`, p.usd, data.byProvider[0].usd, 'var(--accent,#6366f1)', `${fmtNum(p.calls)} ครั้ง`))}
          </div>

          {/* By model */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🧠 ตามโมเดล</div>
            {data.byModel.slice(0, 12).map((m) => barRow(m.key, m.key, m.usd, data.byModel[0].usd, 'var(--desk-purple,#a78bfa)', `${fmtTok(m.inTok + m.outTok)} tok`))}
          </div>

          {/* By feature */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>⚙️ ตามฟังก์ชัน AI</div>
            {data.byFeature.map((f) => barRow(f.key, f.key, f.usd, data.byFeature[0].usd, 'var(--desk-green,#34d399)', `${fmtNum(f.calls)} ครั้ง`))}
          </div>

          {/* Note */}
          <div style={{ ...card, ...muted, fontSize: 12, lineHeight: 1.6 }}>
            ⚠️ <b>นับเฉพาะ LLM</b> (OpenAI/Anthropic/Gemini) ที่บันทึกใน <code>api_usage_logs</code><br />
            ยังไม่รวม: Serper (ค้นหา) · Firecrawl (สกัด) · Replicate (เพิ่มความชัด) · Ideogram/FAL (ภาพปก) · TwelveLabs (วิดีโอ) — ต้องเพิ่มการบันทึก (Phase 2) จึงจะโชว์รวมในนี้<br />
            ราคาอ้างอิงจาก pricing ที่ตั้งไว้ใน <code>usageLogger.js</code> · ยอดจริงที่ถูกเรียกเก็บดูที่หน้า billing ของแต่ละเจ้า
          </div>
        </>
      )}
    </div>
  );
}
