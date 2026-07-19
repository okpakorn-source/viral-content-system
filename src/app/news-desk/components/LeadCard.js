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

// 🆕 เฟส 8 (uiV2): "พบเมื่อ" — เวลาที่ระบบเจอลีดใบนี้ (savedAt) แบบสัมพัทธ์
//   🔴 นี่คือ "เวลาที่พบ" ไม่ใช่ "อายุข่าว" (ห้ามอ้างว่าเป็นความสดของตัวข่าว) — savedAt เป็น ISO string
function foundAgo(savedAt) {
  const t = Date.parse(savedAt || '');
  if (!Number.isFinite(t)) return '';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 0) return 'เมื่อครู่';
  if (diffMin < 1) return 'เมื่อครู่';
  if (diffMin < 60) return `${diffMin} นาทีก่อน`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr} ชม.ก่อน`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} วันก่อน`;
  return `${Math.floor(day / 30)} เดือนก่อน`;
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

// ── A1 (17 ก.ค. 69): ตรวจแบบเบาๆ ว่าลีดนี้เป็น "คลิป" หรือ "บทความ" — สะท้อน classifyExtractRoute ของ
//    researchExtract.js (service ฝั่งเซิร์ฟเวอร์ ห้าม import ตรงเข้า client component เพราะพ่วง openai.js) ใช้เพื่อเลือก
//    ป้าย/ปุ่มให้ตรงประเภทเท่านั้น — การตัดสินใจ route จริงยังทำที่ฝั่งเซิร์ฟเวอร์ใน extractAndSend เสมอ
// 🔒 P2.1 (17 ก.ค. 69): ต้องสะท้อน CLIP_URL_RE ใน researchExtract.js เป๊ะ — คลิป = ลิงก์วิดีโอจริงเท่านั้น
//   (YouTube/TikTok/FB reel·watch·videos/IG reel·tv) โพสต์/กลุ่ม/รูปเป็น "บทความ" เสมอ
const CLIP_URL_RE = /(youtu\.be\/|youtube\.com\/(watch|shorts\/|live\/)|tiktok\.com\/[^\s"']*\/video\/|(vm|vt)\.tiktok\.com\/|fb\.watch\/|facebook\.com\/(reel\/|reels\/|watch|share\/v\/|video\.php|[^/?#]+\/videos\/)|instagram\.com\/(reel\/|reels\/|tv\/))/i; // +video.php (audit R2 — sync researchExtract.js)
function isClipLead(l) {
  const url = String(l?.url || '').toLowerCase();
  return CLIP_URL_RE.test(url);
}

export default function LeadCard({ lead, onKeep, onDismiss, onExtract, onExtractAndSend, onSendText, busyAction, sendNote, extractNote, highlightConfirmOn = false, uiV2 = false }) {
  const [showTimeline, setShowTimeline] = useState(false); // ★ trace 17 ก.ค.: กางแผงประวัติในที่ (การ์ดไม่เรียก API เอง — ให้ LeadTimeline จัดการ)
  const [showContent, setShowContent] = useState(false); // 🆕 D1 17 ก.ค.: กางกล่อง "ดูเนื้อที่จะส่ง" ก่อนกด 🚀
  const [showAlt, setShowAlt] = useState(false); // 🆕 เฟส 8 (uiV2): กางรายชื่อแหล่งอื่นของเรื่องเดียวกัน (altSources)
  if (!lead) return null;
  const score = Math.round(Number(lead.matchScore) || 0);
  const isFull = lead.fetchability === 'full';
  const isClip = isClipLead(lead); // 🆕 A1: เลือกป้าย/ปุ่มสกัดให้ตรงประเภทแหล่ง
  const status = lead.status || 'new';
  const sm = STATUS_META[status];
  const dismissed = status === 'dismissed';
  const sent = status === 'sent' || sendNote?.kind === 'sent';
  // 🆕 A1 (17 ก.ค. 69): ใบที่ส่งด้วยออโต้หลังล่า — ตรวจจาก timeline event 'sent' ที่มี data.auto === true
  const sentViaAuto = Array.isArray(lead.timeline) && lead.timeline.some((e) => e?.type === 'sent' && e?.data?.auto === true);
  // ── R6: เนื้อสกัดแล้ว (🧲) — ใช้ full extract จากคลัง หรือ field เบา (extractTextLength/insightTopics) จากรอบนี้ ──
  const contentReady = !!lead.contentReady;
  const extractLen = lead.extract?.text?.length ?? lead.extractTextLength ?? 0;
  const insightLines = lead.extract?.insight
    ? [lead.extract.insight.headline, lead.extract.insight.overview, lead.extract.insight.category].filter(Boolean)
    : (Array.isArray(lead.insightTopics) ? lead.insightTopics.filter(Boolean) : []);
  // ── 🆕 D1 17 ก.ค.: สถานะการกลั่นเนื้อ — undefined = ยังไม่รู้ (เช่น ยังไม่รีเฟรชลิสต์เต็มจากคลัง) ──
  const distilled = lead.extract?.distilled; // true | false | undefined
  const rawLen = lead.extract?.raw?.length ?? null;
  const distillFacts = Array.isArray(lead.extract?.facts) ? lead.extract.facts.filter(Boolean) : [];
  const distillQuotes = Array.isArray(lead.extract?.keyQuotes) ? lead.extract.keyQuotes.filter(Boolean) : [];

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
        {sentViaAuto && <Chip color={UI.accent}>⚡ ออโต้</Chip>}
        {/* 🆕 เฟส 7: ป้ายไฮไลต์จาก transcript จริง — 🔒 sol audit: โชว์เฉพาะเมื่อ flag เปิด (highlight ที่ persist ค้างตอนปิด flag ต้องไม่โผล่) */}
        {highlightConfirmOn && lead.highlight && (
          <Chip color={lead.highlight.status === 'confirmed' ? UI.accent : UI.muted}>
            {lead.highlight.status === 'confirmed' ? '✅ ไฮไลต์จริง'
              : lead.highlight.status === 'estimated' ? '🎬 คาดว่ามีไฮไลต์'
                : lead.highlight.status === 'unavailable' ? '⏳ รอถอดคลิป'
                  : '— ไม่พบไฮไลต์'}
          </Chip>
        )}
        {/* 🆕 เฟส 8 (uiV2): ป้าย lane/แหล่ง/เวลาที่พบ — ปิด flag = ไม่มีป้ายกลุ่มนี้ (การ์ดเดิมเป๊ะ) */}
        {uiV2 && lead.lane === 'interview' && <Chip color={UI.accent}>🎤 สัมภาษณ์</Chip>}
        {uiV2 && (Number(lead.sourceCount) || 0) > 1 && <Chip color={UI.blue}>🔗 รวม {Number(lead.sourceCount)} แหล่ง</Chip>}
        {uiV2 && foundAgo(lead.savedAt) && <Chip color={UI.muted}>🕐 พบเมื่อ {foundAgo(lead.savedAt)}</Chip>}
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
        {/* ⛔ 18 ก.ค. 69 (audit #4): ใบที่ระบบพักจากรอบคัดอัตโนมัติ — เดิมหลุดจากรอบคัดเงียบๆ มองไม่เห็น
            เพดานต้องตรง editorBrain.js: MAX_LEAD_SEND_ATTEMPTS=3 · MAX_CLIP_PENDING_ROUNDS=8 (sync มือ — UI import server module ไม่ได้) */}
        {(Number(lead.sendAttempts) || 0) >= 3 && (
          <Chip color={UI.red}>⛔ พักอัตโนมัติ — ส่งพลาดครบ 3 ครั้ง (กด ⚡/🚀 ส่งเองได้)</Chip>
        )}
        {(Number(lead.clipPendingRounds) || 0) >= 8 && (Number(lead.sendAttempts) || 0) < 3 && (
          <Chip color={UI.red}>⛔ พักอัตโนมัติ — รอถอดคลิปนานครบ 8 รอบคัด (flush ยังเช็คให้ทุก 2 นาที)</Chip>
        )}
      </div>

      {/* ⛔ audit #4: เหตุผลพลาดล่าสุดของใบที่ถูกพัก — ให้เห็นว่าตายเพราะอะไร ไม่ใช่หายเงียบ */}
      {(Number(lead.sendAttempts) || 0) >= 3 && lead.lastSendError && (
        <div style={{ fontSize: 12, color: UI.red, lineHeight: 1.5 }}>⚠️ สาเหตุ: {String(lead.lastSendError).slice(0, 140)}</div>
      )}

      {/* เหตุผล 1 บรรทัด */}
      {lead.reason && (
        <div style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>💬 {lead.reason}</div>
      )}

      {/* 🆕 เฟส 8 (uiV2): แหล่งอื่นของเรื่องเดียวกัน (altSources จากเฟส 5) — กางดูลิงก์ได้ · ปิด flag = ไม่โผล่ */}
      {uiV2 && Array.isArray(lead.altSources) && lead.altSources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Btn
            variant="ghost"
            onClick={() => setShowAlt((v) => !v)}
            style={{ minHeight: 30, padding: '4px 10px', fontSize: 12, alignSelf: 'flex-start' }}
          >🔗 แหล่งอื่นของเรื่องนี้ {lead.altSources.length} ลิงก์{showAlt ? ' ▲' : ' ▼'}</Btn>
          {showAlt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
              {lead.altSources.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: UI.dim, textDecoration: 'none', wordBreak: 'break-word', lineHeight: 1.5 }}
                  title={a.title || a.url}
                >↗ <b style={{ color: UI.muted }}>{a.sourceHost || a.channel || 'แหล่ง'}</b> — {String(a.title || a.url).slice(0, 80)}</a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* R6 + 🆕 D1 (17 ก.ค.): เนื้อพร้อม/กลั่นแล้ว + ประเด็นย่อ + ปุ่มดูเนื้อก่อนส่ง — โผล่เฉพาะหลังกด "สกัดเนื้อ" สำเร็จ */}
      {contentReady && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {distilled === true ? (
              <Chip color={UI.green}>
                📄 เนื้อกลั่นแล้ว {extractLen.toLocaleString('th-TH')} ตัวอักษร{rawLen ? ` (จากดิบ ${rawLen.toLocaleString('th-TH')})` : ''}
              </Chip>
            ) : (
              <Chip color={UI.green}>📄 เนื้อพร้อม {extractLen.toLocaleString('th-TH')} ตัวอักษร</Chip>
            )}
            {distilled === false && <Chip color={UI.amber}>⚠️ กลั่นไม่สำเร็จ — จะส่งฉบับดิบ</Chip>}
            <Btn
              variant="ghost"
              onClick={() => setShowContent((v) => !v)}
              style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}
            >👁 ดูเนื้อที่จะส่ง{showContent ? ' ▲' : ' ▼'}</Btn>
          </div>
          {insightLines.slice(0, 3).map((line, i) => (
            <div key={i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>🔎 {String(line).slice(0, 160)}</div>
          ))}
          {/* 🆕 D1: กล่องอ่านเนื้อที่จะส่งจริง (clean + facts + keyQuotes) — scroll ได้ ให้ผู้ใช้เห็นก่อนกด 🚀 เสมอ */}
          {showContent && (
            <div style={{
              maxHeight: 300, overflowY: 'auto', background: UI.card, border: `1px solid ${UI.line}`,
              borderRadius: 10, padding: 10, fontSize: 12.5, color: UI.text, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {lead.extract?.text
                ? <div>{lead.extract.text}</div>
                : <div style={{ color: UI.dim }}>(ยังไม่มีเนื้อโหลดเต็ม — รีเฟรชหน้าถ้าไม่โผล่)</div>}
              {distillFacts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, color: UI.dim, fontSize: 11 }}>ข้อเท็จจริงแกน</div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {distillFacts.map((f, i) => <li key={i}>{String(f)}</li>)}
                  </ul>
                </div>
              )}
              {distillQuotes.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, color: UI.dim, fontSize: 11 }}>คำพูดสำคัญ</div>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {distillQuotes.map((q, i) => <li key={i}>&ldquo;{String(q)}&rdquo;</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
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

        {/* 🆕 A1 (17 ก.ค. 69): ยังไม่มีเนื้อ + เป็นบทความ (ไม่ใช่คลิป) → ปุ่มหลัก "ปุ่มเดียวจบ" (extract→distill→ส่ง รวดเดียว) */}
        {!contentReady && !isClip && (
          <Btn
            variant="primary"
            busy={busyAction === 'extractAndSend'}
            disabled={!!busyAction}
            onClick={() => onExtractAndSend?.(lead)}
            style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
            title="สกัดเนื้อ + กลั่น + ส่งเข้าคิวเขียนรวดเดียว (ไม่ต้องดูเนื้อก่อนก็ได้)"
          >⚡ สกัด+ส่งเลย</Btn>
        )}
        {/* ยังไม่มีเนื้อ → ปุ่มสกัดเนื้อ (ดูก่อนส่งได้) — ใบคลิปใช้ปุ่มนี้เป็นปุ่มเดียว (ต้องรอถอดคลิปก่อนเสมอ) */}
        {!contentReady && (
          <Btn
            variant={isClip ? 'primary' : 'subtle'}
            busy={busyAction === 'extract'}
            disabled={!!busyAction}
            onClick={() => onExtract?.(lead)}
            style={{ minHeight: 40, padding: '8px 14px', fontSize: 13, flex: '1 1 auto' }}
            title={isClip ? 'ส่งลิงก์คลิปเข้าคิวถอดข้อความ (เครื่องทีม) แล้วค่อยกดส่งเขียนเอง' : 'ดึงเนื้อดิบเต็มจากแหล่งข่าวมาแนบไว้ก่อนส่งเขียน (ดูเนื้อก่อนกดส่งได้)'}
          >{isClip ? '🧲 สกัด (ถอดคลิป)' : '🧲 สกัดเนื้อ (ดูก่อนส่ง)'}</Btn>
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

      {/* หมายเหตุการส่งคิว */}
      {sendNote && sendNote.kind === 'error' && (
        <div style={{ fontSize: 12, color: UI.red, lineHeight: 1.5 }}>⚠️ {sendNote.msg}</div>
      )}
      {sendNote && sendNote.kind === 'sent' && (
        <div style={{ fontSize: 12, color: UI.green, lineHeight: 1.5 }}>✓ {sendNote.msg}</div>
      )}
    </div>
  );
}
