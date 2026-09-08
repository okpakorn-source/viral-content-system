'use client';
import { useState } from 'react';
import { countThaiWords } from '@/lib/services/clipBrain/topicMetrics';
import { buildClipTopicReadyText } from '@/lib/services/clipNewsReadyText';

const C = { sub: '#111827', line: '#374151', text: '#e5e7eb', muted: '#9ca3af', accent: '#38bdf8', ok: '#22c55e', warn: '#fbbf24', info: '#9ca3af' };
const btn = (active) => ({ padding: '5px 11px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${active ? C.ok : C.line}`, background: 'transparent', color: active ? C.ok : C.text });

const ISSUE_LABELS = {
  'length-short': 'สั้นเกินกรอบ', 'length-long': 'ยาวเกินกรอบ', 'no-highlight': 'ยังไม่มีไฮไลท์', 'style-soft': 'สำนวนควรปรับ',
  bureaucratic: 'มีคำราชการ', 'long-sentence': 'ประโยคยาว', overlap: 'ซ้ำกับเรื่องอื่น',
  'quote-unverified': 'คำพูดยังไม่ยืนยัน', 'quote-short': 'คำพูดสั้นตรวจไม่ได้',
  'no-facts': 'ยังไม่มีข้อเท็จจริง', missing: 'ยังไม่มีเนื้อเรื่อง', 'main-story-stale': 'เรื่องหลักต้องทบทวน',
};

export function issueLabel(code) { return ISSUE_LABELS[code] || 'ข้อสังเกตเพิ่มเติม'; }
// ★ 8 ก.ย. 69: ปลดเพดาน 170 (เจ้าของ) — เตือนเฉพาะสั้นกว่า 100 คำ
export function wordBand(n) { return Number.isFinite(n) && n >= 100 ? 'ok' : 'warn'; }

const OVERLAP_LABELS = { duplicate: 'ซ้ำกับ', shared_context: 'บริบทร่วมกับ', follow_up: 'ต่อเนื่องจาก' };

export function topicChips(story, siblings = []) {
  const quotes = Array.isArray(story?.quotes) ? story.quotes : [];
  const facts = (Array.isArray(story?.facts) ? story.facts : []).filter((f) => typeof f?.text === 'string' && f.text.trim());
  const words = countThaiWords(story?.story);
  const verified = quotes.filter((q) => q?.verification === 'verified').length;
  const chips = [{ label: `${words} คำ`, tone: wordBand(words), title: 'กรอบเนื้อพร้อมใช้ อย่างน้อย 100 คำ' }];
  if (story?.sharePct != null) chips.push({ label: `กินเวลา ${Number(story.sharePct.toFixed(1))}%`, tone: 'info', title: 'สัดส่วนเวลาในคลิปของเรื่องนี้' });
  chips.push({ label: `ข้อเท็จจริง ${facts.length}`, tone: 'info', title: 'จำนวนข้อเท็จจริงของเรื่องนี้' },
    { label: quotes.length ? `คำพูดยืนยัน ${verified}/${quotes.length}` : 'ไม่มีคำพูด', tone: !quotes.length ? 'info' : verified === quotes.length ? 'ok' : 'warn', title: 'ยืนยันข้อความตรงกับต้นทาง ไม่ใช่การยืนยันผู้พูดหรือข้อกล่าวอ้าง' });
  if (story?.quality?.status !== 'checked') chips.push({ label: 'ยังไม่ตรวจความพร้อม', tone: 'warn', title: 'ยังไม่มีผลตรวจความพร้อมของเรื่องนี้' });
  const issuesByCode = new Map();
  for (const issue of story?.quality?.issues || []) {
    if (issue.code === 'quote-unverified') continue;
    if (!issuesByCode.has(issue.code)) issuesByCode.set(issue.code, []);
    issuesByCode.get(issue.code).push(issue.detail || issueLabel(issue.code));
  }
  for (const [code, details] of issuesByCode) chips.push({
    label: code === 'quote-short' ? `คำพูดสั้น ${details.length}` : `${issueLabel(code)}${details.length > 1 ? ` ${details.length}` : ''}`,
    tone: 'warn', title: details.join('\n'),
  });
  if (story?.standalone === false) chips.push({ label: 'ต้องอ่านคู่เรื่องอื่น', tone: 'warn', title: 'เรื่องนี้ยังต้องอาศัยบริบทจากเรื่องอื่น' });
  for (const overlap of story?.overlaps || []) {
    const topic = siblings.find((s) => s.id === overlap.storyId)?.topic;
    const kind = OVERLAP_LABELS[overlap.kind] || 'เกี่ยวข้องกับ';
    const target = topic ? [...topic].slice(0, 24).join('') : overlap.storyId;
    chips.push({ label: `${kind} ${target}`, tone: 'info', title: `${kind} ${topic || overlap.storyId}` });
  }
  return chips;
}

export function TopicChip({ label, tone, title }) {
  return <span title={title} style={{ color: C[tone], background: `${C[tone]}11`, border: `1px solid ${C[tone]}44`, borderRadius: 999, padding: '2px 8px', fontSize: 11.5 }}>{label}</span>;
}

export default function TopicCard({ story, siblings = [], isMain = false, copy, copiedKey, copyKey }) {
  const [open, setOpen] = useState(false);
  const readyKey = `${copyKey}-ready`;
  const highlightKey = `${copyKey}-highlight`;
  return (
    <article data-topic-id={story.id} style={{ background: C.sub, border: `1px solid ${isMain ? C.accent : C.line}`, borderRadius: 10, padding: 13 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: 14, marginRight: 6 }}>{isMain ? '★ ' : ''}{story.topic || 'ยังไม่มีหัวเรื่อง'}</strong>
        {topicChips(story, siblings).map((chip, i) => <TopicChip key={i} {...chip} />)}
      </div>
      <div style={{ color: C.accent, fontSize: 15, fontWeight: 700, lineHeight: 1.65, margin: '9px 0' }}>{story.highlight || 'ยังไม่มีไฮไลท์'}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => copy(readyKey, buildClipTopicReadyText(story))} style={btn(copiedKey === readyKey)}>{copiedKey === readyKey ? '✓ คัดลอกแล้ว' : 'คัดลอกเนื้อพร้อมใช้'}</button>
        <button disabled={!story.highlight} onClick={() => copy(highlightKey, story.highlight)} style={btn(copiedKey === highlightKey)}>{copiedKey === highlightKey ? '✓ คัดลอกแล้ว' : 'คัดลอกไฮไลท์'}</button>
        <button aria-expanded={open} onClick={() => setOpen(!open)} style={btn(false)}>{open ? 'ปิดเนื้อ ▲' : 'อ่านเนื้อ ▼'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{story.story}</div>
          {story.quotes?.length > 0 && <div style={{ marginTop: 10 }}><b>คำพูด</b>{story.quotes.map((q, i) => <div key={i} style={{ color: q.verification === 'verified' ? C.ok : C.warn }}>
            {q.verification === 'verified' ? '✓ ยืนยันแล้ว' : '⚠ ยังไม่ยืนยัน'}{q.speaker ? ` (${q.speaker})` : ''}: &ldquo;{q.text}&rdquo;
          </div>)}</div>}
          {story.facts?.length > 0 && <div style={{ marginTop: 10 }}><b>ข้อเท็จจริง</b><ul style={{ margin: '4px 0', paddingLeft: 20 }}>{story.facts.map((f, i) => <li key={i}>{f.text}</li>)}</ul></div>}
        </div>
      )}
    </article>
  );
}
