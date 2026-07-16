'use client';

// 🧬 DNA Lab — ขั้น 3: สรุปผลสแกน + เช็คซ้ำกับคลัง + ประเมินราคา + เลือกสมองวิจัย + ปุ่มเริ่ม

import { UI, Btn, Card, Chip, Spinner, fmtNum, fmtBaht, fmtDuration } from './ui.js';

const UNIT = { primary: 1.1, fast: 0.12 };
const SYNTH_COST = 15;
const SECS_PER_CHUNK = 8; // ~8 วิ/ก้อน 5 ใบ

export default function ScanSummary({
  summary, metricLabel,
  dupChecked, dupCount, checking, onCheckDup,
  model, onModel,
  onStart, onBack, starting,
}) {
  const research = summary.research || 0;
  const net = Math.max(0, research - (dupCount || 0));
  const unit = UNIT[model] ?? UNIT.primary;
  const baht = net > 0 ? net * unit + SYNTH_COST : 0;
  const chunks = Math.ceil(net / 5);
  const secs = chunks * SECS_PER_CHUNK;

  const stat = (icon, label, value, color) => (
    <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 900, color: color || UI.text, lineHeight: 1.2 }}>{fmtNum(value)}</div>
      <div style={{ fontSize: 12, color: UI.dim }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: UI.text }}>🔍 ผลสแกน</span>
          <Chip color={UI.accent}>แบ่งกลุ่มตาม: {metricLabel}</Chip>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {stat('🥇', 'กลุ่ม S', summary.S, UI.gold)}
          {stat('🥈', 'กลุ่ม A', summary.A, UI.silver)}
          {stat('⚪', 'กลุ่มควบคุม', summary.control, UI.muted)}
          {stat('🚫', 'แถวเสีย/หัวข้อสั้น', summary.bad, UI.red)}
        </div>
        <div style={{ fontSize: 12.5, color: UI.dim, marginTop: 10 }}>
          จะส่งวิจัยเฉพาะกลุ่ม <b style={{ color: UI.gold }}>S</b> + <b style={{ color: UI.silver }}>A</b> รวม{' '}
          <b style={{ color: UI.text }}>{fmtNum(research)}</b> ใบ (กลุ่มควบคุมใช้แค่ทำสถิติ ไม่เสียเงิน)
        </div>
      </Card>

      {/* เช็คซ้ำกับคลัง */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: UI.text }}>♻️ เช็คซ้ำกับคลัง</div>
            <div style={{ fontSize: 12.5, color: UI.dim, marginTop: 2 }}>
              {dupChecked
                ? <>ในคลังมีอยู่แล้ว <b style={{ color: UI.amber }}>{fmtNum(dupCount)}</b> ใบ — จะข้ามอัตโนมัติ (ไม่จ่ายซ้ำ)</>
                : 'กดเพื่อเทียบกับคลังก่อน (เทียบด้วย ID โพสต์)'}
            </div>
          </div>
          <Btn variant="subtle" busy={checking} onClick={onCheckDup}>
            {dupChecked ? '↻ เช็คใหม่' : '🔎 เช็คซ้ำ'}
          </Btn>
        </div>
      </Card>

      {/* เลือกสมองวิจัย */}
      <Card>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: UI.text, marginBottom: 10 }}>🧠 เลือกสมองวิจัย</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {[
            { key: 'primary', name: 'gpt-5.5', tag: '★ แนะนำ', desc: 'คุณภาพสูงสุด วิเคราะห์ลึก', color: UI.accent, price: '฿1.1/ใบ' },
            { key: 'fast', name: 'gpt-5.4-mini', tag: 'ประหยัด', desc: 'เร็ว-ถูก คุณภาพลดลงบ้าง', color: UI.blue, price: '฿0.12/ใบ' },
          ].map((m) => {
            const sel = model === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onModel(m.key)}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: 14, borderRadius: 12,
                  background: sel ? `${m.color}18` : UI.card2,
                  border: `2px solid ${sel ? m.color : UI.line}`, fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>{m.name}</span>
                  <Chip color={m.color} style={{ fontSize: 11 }}>{m.tag}</Chip>
                  {sel && <span style={{ marginLeft: 'auto', color: m.color, fontWeight: 800 }}>✓</span>}
                </div>
                <div style={{ fontSize: 12.5, color: UI.dim }}>{m.desc}</div>
                <div style={{ fontSize: 12.5, color: m.color, fontWeight: 700, marginTop: 4 }}>{m.price}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ประเมินราคา + เริ่ม */}
      <Card style={{ borderColor: UI.green, background: `${UI.green}0d` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: UI.dim }}>จะวิจัยจริง (หักซ้ำ)</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: UI.text }}>{fmtNum(net)} <span style={{ fontSize: 13, fontWeight: 600, color: UI.dim }}>ใบ</span></div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: UI.dim }}>ราคาโดยประมาณ</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: UI.green }}>{fmtBaht(baht)}</div>
            <div style={{ fontSize: 11, color: UI.muted }}>วิจัย {fmtBaht(net * unit)} + สังเคราะห์ ~{fmtBaht(SYNTH_COST)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: UI.dim }}>เวลาโดยประมาณ</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: UI.text }}>{fmtDuration(secs * 1000)}</div>
            <div style={{ fontSize: 11, color: UI.muted }}>~{fmtNum(chunks)} ก้อน (ก้อนละ 5 ใบ)</div>
          </div>
        </div>
        {net > 200 && (
          <div style={{ fontSize: 12, color: UI.amber, marginBottom: 12 }}>
            ⏳ งานยาว ({fmtNum(net)} ใบ) — ระบบเก็บผลทุกก้อนทันที ปิดแท็บกลางคันแล้วเปิดใหม่ทำต่อได้ (เลือกไฟล์เดิม)
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="ghost" onClick={onBack}>← กลับไปแมป</Btn>
          <Btn
            variant="green"
            busy={starting}
            disabled={net < 1}
            onClick={onStart}
            style={{ flex: '1 1 260px' }}
          >
            {net < 1 ? 'ไม่มีข่าวที่ต้องวิจัย (ซ้ำ/ไม่เข้าเกณฑ์หมด)' : `🧬 เริ่มวิจัย ${fmtNum(net)} ข่าว (~${fmtBaht(baht)})`}
          </Btn>
        </div>
        {!dupChecked && net > 0 && (
          <div style={{ fontSize: 12, color: UI.muted, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            {checking && <Spinner size={12} />} ยังไม่ได้เช็คซ้ำ — เริ่มได้เลย ระบบกันจ่ายซ้ำที่เซิร์ฟเวอร์อยู่แล้ว
          </div>
        )}
      </Card>
    </div>
  );
}
