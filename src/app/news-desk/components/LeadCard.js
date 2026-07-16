'use client';

// ============================================================
// 🔎 หาข่าวตามรอย — การ์ดลีดข่าว (ใช้ร่วมทั้ง "ผลการล่ารอบนี้" และ "คลังลีดสะสม")
// ------------------------------------------------------------
// presentational ล้วน — รับ lead + callback + สถานะ busy/หมายเหตุการส่งคิวจาก parent
// ทุก field มาจาก API /api/desk/research/leads (มี id, matchScore, channel, sourceHost,
// fetchability, warnMaybeDone, reason, status) — การ์ดนี้ไม่เรียก API เอง
// ============================================================

import { useState } from 'react';
import { UI, Btn, Chip } from './ui.js';
import LeadTimeline from './LeadTimeline.js';

// สีป้าย match% ตามเกณฑ์: ≥80 เขียว · ≥60 เหลือง · ต่ำกว่านั้นแดงจาง
function scoreColor(score) {
  const s = Number(score) || 0;
  if (s >= 80) return UI.green;
  if (s >= 60) return UI.amber;
  return UI.red;
}

// ป้ายช่องทาง (ไอคอน + ชื่อไทยสั้น)
const CHANNEL_LABEL = {
  videos: '🎬 วิดีโอ',
  facebook: '📘 Facebook',
  tiktok: '🎵 TikTok',
  youtube: '▶️ YouTube',
};

// ป้ายสถานะลีด
const STATUS_META = {
  kept: { label: '⭐ เก็บแล้ว', color: UI.accent },
  sent: { label: '🚀 ส่งคิวแล้ว', color: UI.green },
  dismissed: { label: '🗑 ทิ้งแล้ว', color: UI.muted },
};

export default function LeadCard({ lead, onKeep, onDismiss, onSend, onExtract, onSendText, busyAction, sendNote, extractNote }) {
  const [showTimeline, setShowTimeline] = useState(false); // ★ trace 17 ก.ค.: กางแผงประวัติในที่ (การ์ดไม่เรียก API เอง — ให้ LeadTimeline จัดการ)
  if (!lead) return null;
  const score = Math.round(Number(lead.matchScore) || 0);
  const isFull = lead.fetchability === 'full';
  const status = lead.status || 'new';
  const sm = STATUS_META[status];
  const dismissed = status === 'dismissed';
  const sent = status === 'sent' || sendNote?.kind === 'sent';
  // ── R6: เนื้อสกัดแล้ว (🧲) — ใช้ full extract จากคลัง หรือ field เบา (extractTextLength/insightTopics) จากรอบนี้ ──
  const contentReady = !!lead.contentReady;
  const extractLen = lead.extract?.text?.length ?? lead.extractTextLength ?? 0;
  const insightLines = lead.extract?.insight
    ? [lead.extract.insight.headline, lead.extract.insight.overview, lead.extract.insight.category].filter(Boolean)
    : (Array.isArray(lead.insightTopics) ? lead.insightTopics.filter(Boolean) : []);

  return (
    <div style={{
      background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 12,
      opacity: dismissed ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* แถวป้าย — เลื่อนแนวนอนได้บนจอแคบ */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 46, padding: '3px 8px', borderRadius: 999, fontSize: 13, fontWeight: 900,
          background: `${scoreColor(score)}22`, color: scoreColor(score), border: `1.5px solid ${scoreColor(score)}`,
        }}>{score}%</span>
        <Chip color={UI.blue}>{CHANNEL_LABEL[lead.channel] || lead.channel || '—'}</Chip>
        {lead.sourceHost && <Chip color={UI.muted}>{lead.sourceHost}</Chip>}
        {sm && <Chip color={sm.color}>{sm.label}</Chip>}
      </div>

      {/* หัวข้อ (ลิงก์เปิดแท็บใหม่) */}
      <a
        href={lead.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 13.5, fontWeight: 700, color: UI.text, lineHeight: 1.5, textDecoration: 'none', wordBreak: 'break-word' }}
        title={lead.title}
      >
        {String(lead.title || '(ไม่มีหัวข้อ)').slice(0, 140)}{(lead.title || '').length > 140 ? '…' : ''} ↗
      </a>

      {/* สถานะความพร้อม + ธงอาจเคยทำ */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip color={isFull ? UI.green : UI.amber}>
          {isFull ? '🟢 พร้อมทำ (ถอดเนื้อได้เต็ม)' : '🟡 ลีด — ต้องหาแหล่งข่าวต่อ'}
        </Chip>
        {lead.warnMaybeDone && <Chip color={UI.red}>⚠️ อาจเคยทำแล้ว</Chip>}
      </div>

      {/* เหตุผล 1 บรรทัด */}
      {lead.reason && (
        <div style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>💬 {lead.reason}</div>
      )}

      {/* R6: เนื้อพร้อม + ประเด็นย่อ (≤3 บรรทัด) — โผล่เฉพาะหลังกด "สกัดเนื้อ" สำเร็จ */}
      {contentReady && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Chip color={UI.green}>📄 เนื้อพร้อม {extractLen.toLocaleString('th-TH')} ตัวอักษร</Chip>
          {insightLines.slice(0, 3).map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>🔎 {String(line).slice(0, 160)}</div>
          ))}
        </div>
      )}

      {/* ปุ่มจัดการ */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <Btn
          variant={status === 'kept' ? 'solid' : 'subtle'}
          busy={busyAction === 'keep'}
          disabled={!!busyAction || status === 'kept'}
          onClick={() => onKeep?.(lead)}
          style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
        >⭐ เก็บ</Btn>
        <Btn
          variant="danger"
          busy={busyAction === 'dismiss'}
          disabled={!!busyAction || dismissed}
          onClick={() => onDismiss?.(lead)}
          style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
        >🗑 ทิ้ง</Btn>

        {/* ยังไม่มีเนื้อ → ปุ่มสกัดเนื้อ (คู่กับปุ่มส่งคิว URL เดิม — เดิมโดน TEXT_ONLY บล็อกตามปกติ) */}
        {!contentReady && (
          <Btn
            variant="subtle"
            busy={busyAction === 'extract'}
            disabled={!!busyAction}
            onClick={() => onExtract?.(lead)}
            style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
            title="ดึงเนื้อดิบเต็มจากแหล่งข่าว (บทความ/คลิป) มาแนบไว้ก่อนส่งเขียน"
          >🧲 สกัดเนื้อ</Btn>
        )}
        {!contentReady && (
          <Btn
            variant={sent ? 'green' : 'primary'}
            busy={busyAction === 'send'}
            disabled={!!busyAction || sent}
            onClick={() => onSend?.(lead)}
            style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
            title={sent ? 'ส่งเข้าคิวเขียนแล้ว' : 'ส่งลิงก์นี้เข้าคิวเขียนข่าว (สาย URL — ปกติโดน TEXT_ONLY บล็อก)'}
          >{sent ? '🚀 ส่งแล้ว' : '🚀 ส่งเข้าคิวเขียน'}</Btn>
        )}

        {/* มีเนื้อแล้ว → แทนที่ปุ่มส่งคิว URL เดิมด้วยปุ่มส่งแบบข้อความ (สายที่ระบบเปิดไว้) */}
        {contentReady && (
          <Btn
            variant={sent ? 'green' : 'primary'}
            busy={busyAction === 'sendText'}
            disabled={!!busyAction || sent}
            onClick={() => onSendText?.(lead)}
            style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
            title={sent ? 'ส่งเข้าคิวเขียนแล้ว' : 'ส่งเนื้อที่สกัดแล้วเข้าคิวเขียนข่าวแบบข้อความ'}
          >{sent ? '🚀 ส่งแล้ว' : '🚀 ส่งเขียน (แบบข้อความ)'}</Btn>
        )}

        {/* ★ trace 17 ก.ค.: ปุ่มกางประวัติย้อนหลังของลีดใบนี้ */}
        <Btn
          variant="ghost"
          onClick={() => setShowTimeline((v) => !v)}
          style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
        >🧾 ประวัติ{showTimeline ? ' ▲' : ' ▼'}</Btn>
      </div>

      {/* ★ trace 17 ก.ค.: แผงประวัติย้อนหลัง — กางในที่ */}
      {showTimeline && <LeadTimeline lead={lead} />}

      {/* หมายเหตุการสกัดเนื้อ */}
      {extractNote && extractNote.kind === 'pending' && (
        <Chip color={UI.amber}>⏳ กำลังถอดคลิป (เครื่องทีม)</Chip>
      )}
      {extractNote && extractNote.kind === 'error' && (
        <div style={{ fontSize: 12, color: UI.red, lineHeight: 1.5 }}>⚠️ {extractNote.msg}</div>
      )}

      {/* หมายเหตุการส่งคิว (โดยเฉพาะกรณีสาย URL ปิด — ไม่ใช่ error แดง) */}
      {sendNote && sendNote.kind === 'blocked' && (
        <div style={{ fontSize: 12, color: UI.amber, background: `${UI.amber}14`, border: `1px solid ${UI.amber}55`, borderRadius: 10, padding: '8px 10px', lineHeight: 1.5 }}>
          🔒 {sendNote.msg}
        </div>
      )}
      {sendNote && sendNote.kind === 'error' && (
        <div style={{ fontSize: 12, color: UI.red, lineHeight: 1.5 }}>⚠️ {sendNote.msg}</div>
      )}
      {sendNote && sendNote.kind === 'sent' && (
        <div style={{ fontSize: 12, color: UI.green, lineHeight: 1.5 }}>✓ {sendNote.msg}</div>
      )}
    </div>
  );
}
