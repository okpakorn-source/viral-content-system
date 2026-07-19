'use client';

// ============================================================
// 🔎 หาข่าวตามรอย — มุมมองจัดกลุ่มลีด (เฟส 8, uiV2)
// ------------------------------------------------------------
// presentational ล้วน — จัดกลุ่ม "เรื่องเดียวกัน" (storyKey จากเฟส 5) ให้เป็นการ์ดเดียว
// กลุ่มหลักใช้ storyKey (เชื่อมั่น ≥0.5); ลีดที่ไม่มี storyKey → ใช้ lead.id (กลุ่มเดี่ยว = เท่ากริดเดิม)
// การ์ดตัวแทน (คะแนนสูงสุด) เรนเดอร์ผ่าน renderLead ที่ ResearchTab ส่งมา (คง callback/สถานะครบ)
// ลีดเดียวกันจากคนละรอบล่า/คนละแหล่งที่ backend ยังไม่ยุบ → โผล่เป็น "เรื่องเดียวกันอีก N ใบ" กางดูได้
// 🔴 ไม่เรียก API เอง · ไม่มี AI · ไม่มีภาพ — จัดกลุ่ม + เรนเดอร์เท่านั้น
// ============================================================

import { useState } from 'react';
import { UI, Btn } from './ui.js';

const GRID_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 };

// storyKey ที่เชื่อได้ต้องมี confidence ≥ 0.5 (ตรงเกณฑ์ researchLeads.js เฟส 5) — ไม่งั้นถือเป็นกลุ่มเดี่ยว
// idx = ลำดับในลิสต์ ใช้เป็น fallback key เสถียร (กัน key ซ้ำ/เปลี่ยนทุกเรนเดอร์ กรณีลีดไม่มี id — ไม่ควรเกิดจริง)
function groupKeyOf(lead, idx) {
  if (lead && lead.storyKey && (Number(lead.storyKeyConfidence) || 0) >= 0.5) return `sk:${lead.storyKey}`;
  return `id:${lead && lead.id != null ? lead.id : `x${idx}`}`;
}

// จัดกลุ่ม + เลือกตัวแทน (คะแนนสูงสุด) — deterministic ตามลำดับที่รับมา (ไม่พึ่งเวลา/สุ่มในการจัดกลุ่ม)
function groupLeads(leads) {
  const order = [];              // เก็บลำดับกลุ่มที่เจอครั้งแรก (เสถียร)
  const groups = new Map();      // key → member[]
  const list = Array.isArray(leads) ? leads : [];
  for (let i = 0; i < list.length; i++) {
    const lead = list[i];
    if (!lead) continue;
    const key = groupKeyOf(lead, i);
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(lead);
  }
  const out = order.map((key) => {
    const members = groups.get(key).slice().sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));
    return { key, primary: members[0], extras: members.slice(1) };
  });
  // เรียงกลุ่มตามคะแนนตัวแทน (มาก→น้อย) — เสมอ = คงลำดับที่เจอครั้งแรก (stable sort ของ V8)
  out.sort((a, b) => (Number(b.primary?.matchScore) || 0) - (Number(a.primary?.matchScore) || 0));
  return out;
}

function GroupCell({ group, renderLead }) {
  const [open, setOpen] = useState(false);
  const { primary, extras } = group;
  if (!primary) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {renderLead(primary)}
      {extras.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Btn
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            style={{ minHeight: 32, padding: '4px 10px', fontSize: 12, alignSelf: 'flex-start' }}
          >🧩 เรื่องเดียวกันอีก {extras.length} ใบ{open ? ' ▲' : ' ▼'}</Btn>
          {open && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8, borderLeft: `2px solid ${UI.line}` }}>
              {extras.map((ex) => renderLead(ex))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadGroupView({ leads, renderLead }) {
  const groups = groupLeads(leads);
  if (groups.length === 0) return null;
  return (
    <div style={GRID_STYLE}>
      {groups.map((g) => <GroupCell key={g.key} group={g} renderLead={renderLead} />)}
    </div>
  );
}
