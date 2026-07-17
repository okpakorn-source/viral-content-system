'use client';

// ============================================================
// 🎩 แผง บก. AI (E2) — การ์ดใหม่ในแท็บ "🔎 หาข่าวตามรอย" ใต้ HuntSetup
// ------------------------------------------------------------
// contract ล็อกกับ backend ของเพื่อนทีม (E1 สร้างขนาน — ห้าม import ไฟล์เขาตรงๆ):
//   GET  /api/desk/editor
//     → { success, studied, studiedAt, exemplarCount, topDirections:[ชื่อ ≤5], lastPickAt,
//         lastPick?: { picks:[{id,title,score,reason,sentJobId?}], skipped:[{id,title,reason}], at, autoSend },
//         outbox:[{id,leadId,title,score,reason,addedAt,status,attempts,lastError?,sentJobId?}], outboxStats:{...} }
//   POST /api/desk/editor { action:'study', model? }
//     → { success, charter:{ topDirections:[{name,why}], ... }, exemplarCount, aiCalls, tookMs }   (งานยาว 1-3 นาที)
//   POST /api/desk/editor { action:'pick', limit?, autoSend?, sendMode?, model? }
//     → { success, picks:[...], skipped:[...], sent:[...], sendMode, outboxQueued, needStudy?:true, tookMs }
//   POST /api/desk/editor { action:'cancelOutbox', id }
//     → { success, cancelled:true } | { success, cancelled:false, reason }
//
// 🚪 P1 (17 ก.ค. 69) — มารยาทคิวของ บก.: sendMode:'polite' (default) = คัดแล้วเข้า "ห้องรอ" เท่านั้น
//   ไม่ยิงเข้าคิวเขียนจริงทันที — คนเฝ้าประตู GET /api/desk/editor/dispatch (cron ทุก 1 นาที) จะทยอยปล่อย
//   ทีละใบเฉพาะตอนคิวเขียนข่าวจริงว่างสนิท (หลีกทางงานพนักงาน/Discord) sendMode:'immediate' = พฤติกรรมเดิม
//
// route นี้อาจยังไม่ deploy ระหว่าง E1 ทำงานขนาน — apiFetch (ui.js) คืน {success:false} เองเมื่อ 404/เชื่อมต่อไม่ได้
// เรา "รับสุภาพ": ตกกลับไปโชว์กล่อง "ยังไม่มีความจำ" เหมือนสถานะปกติ ไม่ toast รบกวนตอนโหลดครั้งแรก
// ปุ่มส่งใบเดี่ยว (โหมด "แค่เสนอ" เท่านั้น) ใช้ contract เดิมที่มีอยู่แล้ว: POST /api/desk/research/extract {action:'extractAndSend', leadId}
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { UI, Btn, Card, Chip, Spinner, apiFetch } from './ui.js';

const EDITOR = '/api/desk/editor';
const EXTRACT = '/api/desk/research/extract';
const DISPATCH = '/api/desk/editor/dispatch';
const STUDY_CONFIRM_TIMEOUT_MS = 5000; // ปุ่มสองจังหวะ — ไม่กดซ้ำใน 5 วิ ให้กลับสถานะเดิม กันกดพลาดเสียเงินซ้ำ

// ป้ายสถานะ/สี รายการในห้องรอ
const OUTBOX_STATUS_LABEL = { waiting: '⏳ รอคิว', sending: '📤 กำลังส่ง', sent: '✅ ส่งแล้ว', error: '❌ ล้มเหลว' };
function outboxStatusColor(status) {
  if (status === 'sent') return UI.green;
  if (status === 'error') return UI.red;
  if (status === 'sending') return UI.blue;
  return UI.amber; // waiting
}

// รองรับทั้งรูปแบบ GET (topDirections = string[]) และ POST study (charter.topDirections = [{name,why}])
function normalizeDirections(list) {
  if (!Array.isArray(list)) return [];
  return list.map((d) => (typeof d === 'string' ? d : d?.name)).filter(Boolean).slice(0, 5);
}

function fmtTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

// สีป้ายคะแนนโอกาส: ≥85 เขียว · ≥70 เหลือง · ต่ำกว่านั้นแดงจาง (เข้มกว่าเกณฑ์ match ทั่วไปของคลังลีด — บก. คัดมาแล้วควรสูงกว่า)
function scoreColor(score) {
  const n = Number(score) || 0;
  if (n >= 85) return UI.green;
  if (n >= 70) return UI.amber;
  return UI.red;
}

export default function EditorPanel({ onToast, onAfterAction }) {
  const [loading, setLoading] = useState(true);
  const [studied, setStudied] = useState(false);
  const [studiedAt, setStudiedAt] = useState(null);
  const [exemplarCount, setExemplarCount] = useState(0);
  const [topDirections, setTopDirections] = useState([]);
  const [lastPick, setLastPick] = useState(null); // { picks, skipped, at, autoSend }

  const [studying, setStudying] = useState(false);
  const [studyConfirm, setStudyConfirm] = useState(false); // ปุ่มสองจังหวะ: กด 1 = ยืนยัน, กด 2 = ยิงจริง

  const [picking, setPicking] = useState(false);
  const [pickLimit, setPickLimit] = useState(5);
  // 🚪 P1 (17 ก.ค. 69): 'off' = แค่เสนอ (ผมกดส่งเอง) · 'polite' = คัด+เข้าห้องรอ (default ★แนะนำ) · 'immediate' = ส่งทันที
  const [sendMode, setSendMode] = useState('polite');
  const [pickModel, setPickModel] = useState('primary'); // 'primary' = gpt-5.5 ★ · 'fast' = mini

  const [skippedOpen, setSkippedOpen] = useState(false);
  const [busySendId, setBusySendId] = useState('');

  const [outbox, setOutbox] = useState([]);
  const [outboxStatsState, setOutboxStatsState] = useState(null);
  const [checkingNow, setCheckingNow] = useState(false);
  const [cancellingId, setCancellingId] = useState('');

  const busy = studying || picking;

  // ── โหลดสถานะตอนเปิดแท็บ — 404/เชื่อมต่อไม่ได้ (backend ยังไม่พร้อม) ตกกลับเป็น "ยังไม่ศึกษา" เงียบๆ ──
  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(EDITOR);
    setLoading(false);
    if (!res.success) {
      setStudied(false);
      setTopDirections([]);
      setLastPick(null);
      setOutbox([]);
      setOutboxStatsState(null);
      return;
    }
    // 🚑 17 ก.ค. 69 (Fable ตรวจรับ): E1 ตอบซ้อนใน res.status — อ่านได้ทั้งสองทรงกัน contract เพี้ยนอีก
    const st = res.status && typeof res.status === 'object' ? res.status : res;
    setStudied(!!st.studied);
    setStudiedAt(st.studiedAt || null);
    setExemplarCount(Number(st.exemplarCount) || 0);
    setTopDirections(normalizeDirections(st.topDirections));
    setLastPick(res.lastPick || st.lastPick || null);
    setOutbox(Array.isArray(res.outbox) ? res.outbox : []); // 🆕 P1 (17 ก.ค. 69): ห้องรอ
    setOutboxStatsState(res.outboxStats || null);
  }, []);

  useEffect(() => {
    // setTimeout กันเคส "เรียก setState ตรงๆ ในตัว effect" (react-hooks/set-state-in-effect) — แพทเทิร์นเดียวกับ ResearchTab.js
    const id = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(id);
  }, [load]);

  // ปุ่มยืนยันศึกษาคืนกลับเป็นสถานะเดิมถ้าไม่กดซ้ำภายในเวลาที่กำหนด (กันกดพลาด/กดข้ามวันแล้วลืม)
  useEffect(() => {
    if (!studyConfirm) return undefined;
    const t = setTimeout(() => setStudyConfirm(false), STUDY_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [studyConfirm]);

  async function doStudy() {
    if (!studyConfirm) { setStudyConfirm(true); return; }
    setStudyConfirm(false);
    setStudying(true);
    const res = await apiFetch(EDITOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'study' }),
    });
    setStudying(false);
    if (res.success) {
      setStudied(true);
      setStudiedAt(new Date().toISOString());
      setExemplarCount(Number(res.exemplarCount) || 0);
      setTopDirections(normalizeDirections(res.charter?.topDirections));
      onToast?.(`บก. ศึกษา DNA เสร็จแล้ว (${res.exemplarCount || 0} ใบ · ${Math.round((res.tookMs || 0) / 1000)} วิ)`, 'ok');
    } else {
      onToast?.(res.error || 'บก. ศึกษา DNA ไม่สำเร็จ', 'err');
    }
  }

  async function doPick() {
    const autoSend = sendMode !== 'off';
    setPicking(true);
    const res = await apiFetch(EDITOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pick', limit: pickLimit, autoSend, sendMode, model: pickModel }),
    });
    setPicking(false);
    if (res.needStudy) {
      setStudied(false);
      onToast?.('บก. ยังไม่มีความจำ — กด "ให้ บก. ศึกษา DNA" ก่อน', 'warn');
      return;
    }
    if (res.success) {
      const at = new Date().toISOString();
      const effectiveSendMode = res.sendMode || sendMode;
      setLastPick({ picks: res.picks || [], skipped: res.skipped || [], at, autoSend, sendMode: effectiveSendMode });
      const sentCount = (res.sent || []).length;
      const outboxQueued = Number(res.outboxQueued) || 0;
      let suffix = '';
      if (effectiveSendMode === 'immediate') suffix = ` · ส่งแล้ว ${sentCount}`;
      else if (autoSend) suffix = ` · เข้าห้องรอ ${outboxQueued} ใบ`;
      onToast?.(`บก. คัดได้ ${(res.picks || []).length} เรื่อง${suffix}`, 'ok');
      await onAfterAction?.();
      await load(); // รีเฟรชห้องรอ (เผื่อมีของใหม่เข้าห้องรอในโหมด polite)
    } else {
      onToast?.(res.error || 'สั่ง บก. คัดข่าวไม่สำเร็จ', 'err');
    }
  }

  // ยกเลิกรายการในห้องรอ (เฉพาะ status waiting — ปุ่มโชว์เฉพาะสถานะนี้)
  async function cancelOutboxItem(id) {
    setCancellingId(id);
    const res = await apiFetch(EDITOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancelOutbox', id }),
    });
    setCancellingId('');
    if (res.cancelled) {
      setOutbox((list) => list.filter((o) => o.id !== id));
      setOutboxStatsState((s) => (s ? { ...s, total: Math.max(0, s.total - 1), waiting: Math.max(0, s.waiting - 1) } : s));
      onToast?.('ยกเลิกรายการนี้จากห้องรอแล้ว', 'ok');
    } else {
      onToast?.(res.reason || res.error || 'ยกเลิกไม่สำเร็จ', 'err');
    }
  }

  // ปุ่ม "↻ เช็คตอนนี้" — ยิง dispatch route ตรง 1 ครั้ง (เหมือน cron ทำ แต่ไม่ต้องรอรอบถัดไป)
  async function checkDispatchNow() {
    setCheckingNow(true);
    const res = await apiFetch(DISPATCH);
    setCheckingNow(false);
    if (res.success) {
      if (res.sent) onToast?.('ปล่อยเข้าคิวเขียนแล้ว 1 ใบ', 'ok');
      else if (res.held) onToast?.(`คิวเขียนไม่ว่าง (รอ ${res.queueBusy?.pending || 0} · กำลังทำ ${res.queueBusy?.processing || 0}) — รอรอบหน้า`, 'warn');
      else if (res.pending) onToast?.('คลิปยังถอดไม่เสร็จ — รอรอบหน้า', 'warn');
      else if (res.error) onToast?.(`ปล่อยไม่สำเร็จ: ${res.error.message || 'ไม่ทราบสาเหตุ'}`, 'err');
      else onToast?.('เช็คแล้ว — ห้องรอว่าง ไม่มีอะไรต้องปล่อย', 'ok');
      await load();
    } else {
      onToast?.(res.error || 'เช็คตอนนี้ไม่สำเร็จ', 'err');
    }
  }

  // ส่งใบเดี่ยวจากผลคัด (โหมด "แค่เสนอ") — ใช้ contract extract/extractAndSend เดิม (มีอยู่แล้ว ไม่ใช่ของ E1)
  async function sendPick(pick) {
    if (!pick?.id) return;
    setBusySendId(pick.id);
    const res = await apiFetch(EXTRACT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'extractAndSend', leadId: pick.id }),
    });
    setBusySendId('');

    if (res.pending) {
      onToast?.('คลิปนี้ใช้เวลาถอดนาน — ระบบส่งเข้าคิวถอดแล้ว กลับมากดใหม่ภายหลัง', 'warn');
      return;
    }
    if (res.success && res.sent) {
      setLastPick((lp) => (lp
        ? { ...lp, picks: (lp.picks || []).map((p) => (p.id === pick.id ? { ...p, sentJobId: res.jobId || 'ok' } : p)) }
        : lp));
      onToast?.('ส่งใบนี้เข้าคิวเขียนแล้ว', 'ok');
      await onAfterAction?.();
    } else {
      const stepLabel = { extract: 'สกัดเนื้อ', distill: 'กลั่นเนื้อ/บันทึก', send: 'ส่งเข้าคิว' }[res.step] || '';
      onToast?.(`${stepLabel ? stepLabel + 'ล้มเหลว: ' : ''}${res.error || 'ส่งใบนี้ไม่สำเร็จ'}`, 'err');
    }
  }

  const picks = lastPick?.picks || [];
  const skipped = lastPick?.skipped || [];
  const lastAutoSend = !!lastPick?.autoSend;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: UI.text }}>🎩 บก. AI — ผู้ช่วยคัดข่าว</span>
        {loading && <Spinner size={14} />}
      </div>

      {/* ── ส่วน 1: สถานะสมอง บก. ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 16, color: UI.dim, fontSize: 13 }}><Spinner size={16} /> กำลังเช็คสถานะ บก. …</div>
      ) : !studied ? (
        <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: UI.dim, lineHeight: 1.6, marginBottom: 10 }}>
            🎩 บก. ยังไม่มีความจำ — กดให้ศึกษา DNA ทั้งคลังก่อน (ครั้งเดียว ~฿30-50, 1-3 นาที)
          </div>
          {studying ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: UI.dim, fontSize: 13 }}>
              <Spinner size={16} /> บก. กำลังอ่านคลัง… (~1-3 นาที)
            </div>
          ) : (
            <Btn variant="primary" onClick={doStudy} disabled={busy} style={{ minHeight: 44 }}>
              {studyConfirm ? 'ยืนยันศึกษา ~฿50 ▸' : '📖 ให้ บก. ศึกษา DNA'}
            </Btn>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <Chip color={UI.accent}>🧠 ความจำ: {exemplarCount.toLocaleString('th-TH')} ใบ · ศึกษาเมื่อ {fmtTime(studiedAt)}</Chip>
          {topDirections.map((name, i) => <Chip key={i} color={UI.blue}>{name}</Chip>)}
          {studying ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: UI.dim, fontSize: 12.5 }}>
              <Spinner size={13} /> บก. กำลังอ่านคลัง… (~1-3 นาที)
            </span>
          ) : (
            <Btn variant="subtle" onClick={doStudy} disabled={busy} style={{ minHeight: 36, padding: '6px 12px', fontSize: 12.5 }}>
              {studyConfirm ? 'ยืนยันศึกษา ~฿50 ▸' : '📖 ศึกษาใหม่'}
            </Btn>
          )}
        </div>
      )}

      {/* ── ส่วน 2: สั่งคัด ── */}
      <div style={{ background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 6 }}>จำนวนที่ให้คัด</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[3, 5, 8, 10].map((n) => (
                <button
                  key={n} type="button" onClick={() => setPickLimit(n)} disabled={busy}
                  style={{
                    minWidth: 44, minHeight: 44, borderRadius: 10, cursor: busy ? 'not-allowed' : 'pointer',
                    fontSize: 14, fontWeight: 800, fontFamily: 'inherit',
                    background: pickLimit === n ? `${UI.accent}22` : UI.card,
                    color: pickLimit === n ? UI.accent : UI.dim,
                    border: `1.5px solid ${pickLimit === n ? UI.accent : UI.line}`,
                  }}
                >{n}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 6 }}>โหมดส่ง</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button" onClick={() => setSendMode('off')} disabled={busy}
                style={{
                  minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                  background: sendMode === 'off' ? `${UI.blue}18` : UI.card,
                  color: sendMode === 'off' ? UI.blue : UI.dim,
                  border: `1.5px solid ${sendMode === 'off' ? UI.blue : UI.line}`,
                }}
              >🗳️ แค่เสนอ</button>
              <button
                type="button" onClick={() => setSendMode('polite')} disabled={busy}
                style={{
                  minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                  background: sendMode === 'polite' ? `${UI.accent}18` : UI.card,
                  color: sendMode === 'polite' ? UI.accent : UI.dim,
                  border: `1.5px solid ${sendMode === 'polite' ? UI.accent : UI.line}`,
                }}
              >🚪 คัด+เข้าห้องรอ (หลีกทางพนักงาน) ★แนะนำ</button>
              <button
                type="button" onClick={() => setSendMode('immediate')} disabled={busy}
                style={{
                  minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                  background: sendMode === 'immediate' ? `${UI.amber}18` : UI.card,
                  color: sendMode === 'immediate' ? UI.amber : UI.dim,
                  border: `1.5px solid ${sendMode === 'immediate' ? UI.amber : UI.line}`,
                }}
              >⚡ ส่งทันที</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 6 }}>สมอง</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ key: 'primary', name: 'gpt-5.5 ★' }, { key: 'fast', name: 'mini' }].map((m) => (
                <button
                  key={m.key} type="button" onClick={() => setPickModel(m.key)} disabled={busy}
                  style={{
                    minHeight: 44, padding: '8px 12px', borderRadius: 10, cursor: busy ? 'not-allowed' : 'pointer',
                    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                    background: pickModel === m.key ? `${UI.accent}22` : UI.card,
                    color: pickModel === m.key ? UI.accent : UI.dim,
                    border: `1.5px solid ${pickModel === m.key ? UI.accent : UI.line}`,
                  }}
                >{m.name}</button>
              ))}
            </div>
          </div>
        </div>

        <Btn variant="primary" busy={picking} disabled={!studied || busy || loading} onClick={doPick} style={{ width: '100%' }}>
          🎩 สั่ง บก. คัดข่าว
        </Btn>
      </div>

      {/* ── ส่วน 3: ผลการคัดล่าสุด ── */}
      {lastPick && (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 10 }}>
            📋 ผลการคัดล่าสุด{lastPick.at ? ` · ${fmtTime(lastPick.at)}` : ''}
          </div>

          {picks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 18, color: UI.muted, fontSize: 13 }}>รอบนี้ บก. ยังไม่เลือกอะไรเลย</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {picks.map((p, i) => (
                <div
                  key={p.id || i}
                  style={{
                    background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10,
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: UI.muted, fontWeight: 800 }}>#{i + 1}</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, padding: '3px 8px', borderRadius: 999, fontSize: 12.5, fontWeight: 900,
                      background: `${scoreColor(p.score)}22`, color: scoreColor(p.score), border: `1.5px solid ${scoreColor(p.score)}`,
                    }}>{Math.round(Number(p.score) || 0)}%</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: UI.text, flex: '1 1 200px' }}>
                      {String(p.title || '(ไม่มีหัวข้อ)').slice(0, 120)}
                    </span>
                    {p.sentJobId && <Chip color={UI.green}>🚀 ส่งแล้ว job{String(p.sentJobId).slice(0, 8)}</Chip>}
                  </div>
                  {p.reason && <div style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>💬 {p.reason}</div>}
                  {!p.sentJobId && !lastAutoSend && (
                    <Btn
                      variant="subtle"
                      busy={busySendId === p.id}
                      disabled={!!busySendId}
                      onClick={() => sendPick(p)}
                      style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5, alignSelf: 'flex-start' }}
                    >🚀 ส่งใบนี้</Btn>
                  )}
                </div>
              ))}
            </div>
          )}

          {skipped.length > 0 && (
            <div>
              <Btn variant="ghost" onClick={() => setSkippedOpen((v) => !v)} style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>
                {skippedOpen ? '▲ ซ่อน' : '▼ ดู'} ที่ บก. ข้าม ({skipped.length})
              </Btn>
              {skippedOpen && (
                <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                  {skipped.map((sItem, i) => (
                    <div key={sItem.id || i} style={{ fontSize: 12, color: UI.dim, lineHeight: 1.5 }}>
                      {String(sItem.title || '(ไม่มีหัวข้อ)').slice(0, 100)} — <span style={{ color: UI.muted }}>{sItem.reason || 'ไม่ระบุเหตุผล'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ส่วน 4: ห้องรอของ บก. (P1, 17 ก.ค. 69) — โชว์เมื่อมีของ ── */}
      {outboxStatsState && outboxStatsState.total > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${UI.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: UI.text }}>
              🚪 ห้องรอของ บก. ({outboxStatsState.total})
            </span>
            <Btn variant="subtle" busy={checkingNow} disabled={checkingNow} onClick={checkDispatchNow} style={{ minHeight: 32, padding: '5px 10px', fontSize: 12 }}>
              ↻ เช็คตอนนี้
            </Btn>
          </div>
          <div style={{ fontSize: 12, color: UI.dim, marginBottom: 10, lineHeight: 1.6 }}>
            รอคิวพนักงานว่าง — คนเฝ้าประตูเช็คทุก 1 นาที
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {outbox.map((o) => (
              <div
                key={o.id}
                style={{
                  background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 10, padding: 10,
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                }}
              >
                <Chip color={outboxStatusColor(o.status)}>{OUTBOX_STATUS_LABEL[o.status] || o.status}</Chip>
                <span style={{ fontSize: 13, color: UI.text, flex: '1 1 200px' }}>
                  {String(o.title || '(ไม่มีหัวข้อ)').slice(0, 100)}
                </span>
                {o.status === 'error' && o.lastError && (
                  <span style={{ fontSize: 11.5, color: UI.red }}>{String(o.lastError).slice(0, 90)}</span>
                )}
                {o.status === 'sent' && o.sentJobId && (
                  <span style={{ fontSize: 11.5, color: UI.dim }}>job{String(o.sentJobId).slice(0, 8)}</span>
                )}
                {o.status === 'waiting' && (
                  <Btn
                    variant="ghost"
                    busy={cancellingId === o.id}
                    disabled={!!cancellingId}
                    onClick={() => cancelOutboxItem(o.id)}
                    style={{ minHeight: 32, padding: '4px 10px', fontSize: 11.5 }}
                  >✕ ยกเลิก</Btn>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
