'use client';

// 🧬 DNA Lab — รายงานสังเคราะห์หลังวิจัยครบ (จาก POST /api/desk/dna/synthesize)
// ⚠️ endpoint นี้เพื่อนร่วมทีมกำลังสร้าง — ถ้ายังไม่มี (404) page.js จะไม่ render ตัวนี้ (ข้ามสุภาพ)
// render แบบยืดหยุ่น: รับได้ทั้ง string / array / object

import { UI, Card, Chip, fmtNum } from './ui.js';

function asLines(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
  if (typeof v === 'object') return Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  return [String(v)];
}

function Section({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: UI.text, marginBottom: 8 }}>{icon} {title}</div>
      {children}
    </div>
  );
}

function Bullets({ items, color }) {
  if (!items.length) return <div style={{ fontSize: 12.5, color: UI.muted }}>—</div>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.map((t, i) => (
        <div key={i} style={{
          fontSize: 13, color: UI.text, lineHeight: 1.6, padding: '8px 12px',
          background: UI.card2, borderRadius: 10, borderLeft: `3px solid ${color || UI.accent}`,
        }}>
          {t}
        </div>
      ))}
    </div>
  );
}

export default function SynthesisReport({ synthesis }) {
  if (!synthesis) return null;
  const { mainFindings, sVsA, archetypeRanking, cautions } = synthesis;

  return (
    <Card style={{ borderColor: UI.accent, background: `${UI.accent}0a` }}>
      <div style={{ fontSize: 17, fontWeight: 900, color: UI.text, marginBottom: 4 }}>🧠 รายงานสังเคราะห์ DNA</div>
      <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 16 }}>
        ภาพรวมที่ AI สรุปจากต้นแบบทั้งชุด — ใช้เป็นทิศทางหาข่าว/คลิปคล้ายในรอบถัดไป
      </div>

      <Section icon="⭐" title="ประเด็นเด่นสุด">
        <Bullets items={asLines(mainFindings)} color={UI.gold} />
      </Section>

      <Section icon="⚖️" title="S เทียบ A ต่างกันตรงไหน">
        <Bullets items={asLines(sVsA)} color={UI.silver} />
      </Section>

      <Section icon="🏆" title="อันดับ archetype ที่ปังสุด">
        {Array.isArray(archetypeRanking) && archetypeRanking.length && typeof archetypeRanking[0] === 'object' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {archetypeRanking.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: UI.card2, borderRadius: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: UI.accent, minWidth: 24 }}>#{i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: UI.text, flex: 1 }}>{a.archetype || a.name || JSON.stringify(a)}</span>
                {a.count != null && <Chip color={UI.accent}>{fmtNum(a.count)} ใบ</Chip>}
                {a.avgReach != null && <Chip color={UI.gold}>เฉลี่ย {fmtNum(a.avgReach)}</Chip>}
              </div>
            ))}
          </div>
        ) : (
          <Bullets items={asLines(archetypeRanking)} color={UI.accent} />
        )}
      </Section>

      <Section icon="⚠️" title="ข้อควรระวัง">
        <Bullets items={asLines(cautions)} color={UI.amber} />
      </Section>
    </Card>
  );
}
