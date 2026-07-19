'use client';

// ============================================================
// 🔎 หาข่าวตามรอย — ส่วน 1: ตั้งค่าการล่า (เลือกคลัสเตอร์/ช่องทาง/คีย์/สมอง + ประเมินราคา)
// ------------------------------------------------------------
// presentational — รับ state + callback จาก ResearchTab ทั้งหมด, คำนวณราคาประเมินในตัว (pure)
// ราคา: Serper ~฿0.11/call · AI ตัดสิน mini ~฿0.15/ใบ, gpt-5.5 ~฿1/ใบ (ต่อ 16 ใบ/คลัสเตอร์สูงสุด)
// ============================================================

import { UI, Btn, Card, Chip, Spinner, fmtNum, fmtBaht } from './ui.js';

const SERPER_COST_PER_CALL = 0.11;   // ตรงกับ researchHunt.js
const JUDGE_MAX_PER_CLUSTER = 16;    // เพดานใบที่ส่งตัดสินต่อคลัสเตอร์ (ตรงกับ ResearchTab)
const JUDGE_UNIT = { fast: 0.15, primary: 1 }; // ฿/ใบ

export const CHANNELS = [
  { key: 'videos', label: '🎬 วิดีโอ', hint: 'Google Videos' },
  { key: 'facebook', label: '📘 Facebook', hint: 'โพสต์เพจ/กลุ่ม — ค้นผ่าน Serper' },
  { key: 'reels', label: '🎞️ FB Reels', hint: 'คลิปสั้น FB — ข่าวปัง/ไฮไลท์เด็ดเยอะ (เจาะ /reel ตรงๆ)' }, // ★ 17 ก.ค.: ผู้ใช้สั่งเพิ่ม
  { key: 'tiktok', label: '🎵 TikTok', hint: 'ค้นผ่าน Serper' },
  { key: 'youtube', label: '▶️ YouTube', hint: 'YouTube API (ฟรี)' },
  { key: 'google', label: '🌐 Google', hint: 'ลิงก์ข่าวสำนักต่างๆ — ข่าวเก่าน้ำดีทำใหม่ได้ (ดึงเนื้อเต็มได้)' }, // ★ 16 ก.ค.: ผู้ใช้สั่งเพิ่ม
];

// 🆕 A1 (17 ก.ค. 69): เกณฑ์ default ของ "ออโต้หลังล่า" (ผู้ใช้เคาะ) — default ปิดเสมอ
export const AUTO_CFG_DEFAULT = { enabled: false, minScore: 85, maxPerRound: 3 };

export default function HuntSetup({
  clusters, clustersLoading, onReloadClusters,
  clusterQuery, onClusterQuery,
  selectedIds, selectedSet, onToggle, onPickTop5, onPickRandom, onClearSelection,
  channels, onToggleChannel,
  queriesPerCluster, onQueries,
  model, onModel,
  autoCfg, onAutoCfgChange, // 🆕 A1: {enabled,minScore,maxPerRound} + setter (patch)
  presets, activePreset, onPreset, // 🆕 เฟส 8: 5 ปุ่ม preset (null/ว่าง = ไม่โชว์ = พฤติกรรมเดิม)
  onStart, hunting,
}) {
  const clusterById = new Map((clusters || []).map((c) => [c.clusterId, c]));

  // ชิปคลัสเตอร์ที่จะแสดง: ค้นหา → กรองทั้งลิสต์ (≤30) · ไม่ค้น → top 20 ตาม count
  const q = String(clusterQuery || '').trim().toLowerCase();
  const baseList = q
    ? (clusters || []).filter((c) => String(c.archetype || '').toLowerCase().includes(q)).slice(0, 30)
    : (clusters || []).slice(0, 20);
  // เติมคลัสเตอร์ที่เลือกไว้แต่ไม่อยู่ในลิสต์ (เช่นจากปุ่มสุ่มนอกกระแส) ให้เห็น+ปลดได้เสมอ
  const shownIds = new Set(baseList.map((c) => c.clusterId));
  const extras = (selectedIds || []).filter((id) => !shownIds.has(id)).map((id) => clusterById.get(id)).filter(Boolean);
  const chipList = [...baseList, ...extras];

  const nChannels = CHANNELS.filter((c) => channels[c.key]).length;
  const nNonYoutube = CHANNELS.filter((c) => channels[c.key] && c.key !== 'youtube').length;
  const nClusters = (selectedIds || []).length;

  // ── ประเมินราคา (upper bound) ──
  const serperCalls = nClusters * queriesPerCluster * nNonYoutube;
  const serperCost = serperCalls * SERPER_COST_PER_CALL;
  const youtubeCalls = nClusters * queriesPerCluster * (channels.youtube ? 1 : 0);
  const judgeMax = nClusters * JUDGE_MAX_PER_CLUSTER;
  const judgeCost = judgeMax * (JUDGE_UNIT[model] ?? JUDGE_UNIT.fast);
  const totalCost = serperCost + judgeCost;

  const canStart = !hunting && nClusters >= 1 && nChannels >= 1;

  return (
    <Card>
      <div style={{ fontSize: 16, fontWeight: 800, color: UI.text, marginBottom: 4 }}>🎯 ตั้งค่าการล่า</div>
      <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 14, lineHeight: 1.6 }}>
        เลือก &quot;คลัสเตอร์ครู&quot; (กลุ่มข่าวที่เคยปัง) เป็นเข็มทิศ แล้วระบบจะยิงค้นข่าวใหม่ที่ &quot;ตามรอย&quot; แนวเดียวกันจากหลายแพลตฟอร์ม
      </div>

      {/* 🆕 เฟส 8: แนวข่าวที่อยากได้ (preset) — เอนคำค้นไปทางหมวดนั้น · โชว์เฉพาะเมื่อ researchUiV2 เปิด (presets ไม่ว่าง) */}
      {Array.isArray(presets) && presets.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>🎯 แนวข่าวที่อยากได้ <span style={{ fontSize: 11.5, fontWeight: 600, color: UI.muted }}>(เลือกก็ได้ไม่เลือกก็ได้ — เอนคำค้นไปทางนั้น)</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {presets.map((p) => {
              const on = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPreset?.(on ? '' : p.id)}
                  disabled={hunting}
                  title={p.experimental ? 'ทดลอง — ยังไม่การันตีผล' : `เอนไปหมวด ${p.categoryKey || p.label}`}
                  style={{
                    minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: hunting ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    background: on ? `${UI.accent}22` : UI.card2,
                    color: on ? UI.accent : UI.dim,
                    border: `1.5px solid ${on ? UI.accent : UI.line}`,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {on ? '✓ ' : ''}{p.label}{p.primary ? ' ⭐' : ''}{p.experimental ? ' 🧪' : ''}
                </button>
              );
            })}
            {activePreset && (
              <Btn variant="ghost" onClick={() => onPreset?.('')} disabled={hunting} style={{ minHeight: 40, padding: '6px 12px', fontSize: 12.5 }}>ล้างแนว</Btn>
            )}
          </div>
        </div>
      )}

      {/* เลือกคลัสเตอร์ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: UI.text }}>🧭 คลัสเตอร์ครู</span>
          <Chip color={UI.accent}>เลือกแล้ว {fmtNum(nClusters)}</Chip>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Btn variant="subtle" onClick={onPickTop5} disabled={hunting} style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>⭐ ท็อป 5</Btn>
            <Btn variant="subtle" onClick={onPickRandom} disabled={hunting} style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5 }} title="สุ่ม 5 คลัสเตอร์จากช่วงกลางตาราง — หาแนวที่ยังไม่ค่อยมีคนจับ">🎲 สุ่มนอกกระแส</Btn>
            {nClusters > 0 && <Btn variant="ghost" onClick={onClearSelection} disabled={hunting} style={{ minHeight: 38, padding: '6px 12px', fontSize: 12.5 }}>ล้าง</Btn>}
          </div>
        </div>

        <input
          value={clusterQuery}
          onChange={(e) => onClusterQuery(e.target.value)}
          placeholder="ค้นหาคลัสเตอร์ (พิมพ์คำใน archetype)…"
          style={{ width: '100%', minHeight: 40, padding: '6px 12px', borderRadius: 10, background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }}
        />

        {clustersLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: UI.dim }}><Spinner size={16} /> กำลังโหลดคลัสเตอร์…</div>
        ) : chipList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 18, color: UI.muted, fontSize: 13 }}>
            {q ? 'ไม่พบคลัสเตอร์ที่ตรงคำค้น' : 'ยังไม่มีคลัสเตอร์ในคลัง'}
            <div style={{ marginTop: 8 }}><Btn variant="subtle" onClick={onReloadClusters} style={{ minHeight: 38 }}>↻ โหลดใหม่</Btn></div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 220, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 2 }}>
            {chipList.map((c) => {
              const sel = selectedSet.has(c.clusterId);
              return (
                <button
                  key={c.clusterId}
                  type="button"
                  onClick={() => onToggle(c.clusterId)}
                  disabled={hunting}
                  title={c.archetype || ''}
                  style={{
                    minHeight: 40, maxWidth: 320, padding: '6px 12px', borderRadius: 999, cursor: hunting ? 'not-allowed' : 'pointer',
                    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', textAlign: 'left',
                    background: sel ? `${UI.accent}22` : UI.card2,
                    color: sel ? UI.accent : UI.dim,
                    border: `1.5px solid ${sel ? UI.accent : UI.line}`,
                    display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sel ? '✓ ' : ''}{String(c.archetype || '(ไม่มีชื่อ)').slice(0, 46)}
                  </span>
                  <span style={{ color: UI.muted, fontWeight: 800, flexShrink: 0 }}>·{fmtNum(c.count)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ช่องทาง */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>📡 ช่องทางที่จะยิงค้น</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CHANNELS.map((c) => {
            const on = !!channels[c.key];
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onToggleChannel(c.key)}
                disabled={hunting}
                title={c.hint}
                style={{
                  minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: hunting ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                  background: on ? `${UI.blue}18` : 'transparent',
                  color: on ? UI.blue : UI.dim,
                  border: `1.5px solid ${on ? UI.blue : UI.line}`,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <span>{on ? '☑' : '☐'}</span> {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* คีย์/คลัสเตอร์ + สมอง */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>🔑 คีย์ค้นต่อคลัสเตอร์</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onQueries(n)}
                disabled={hunting}
                style={{
                  minWidth: 44, minHeight: 44, borderRadius: 10, cursor: hunting ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 800, fontFamily: 'inherit',
                  background: queriesPerCluster === n ? `${UI.accent}22` : UI.card2,
                  color: queriesPerCluster === n ? UI.accent : UI.dim,
                  border: `1.5px solid ${queriesPerCluster === n ? UI.accent : UI.line}`,
                }}
              >{n}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: '1 1 240px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>🧠 สมองตัดสิน</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'fast', name: 'mini', tag: '★ แนะนำ', color: UI.blue },
              { key: 'primary', name: 'gpt-5.5', tag: 'ลึกสุด', color: UI.accent },
            ].map((m) => {
              const sel = model === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onModel(m.key)}
                  disabled={hunting}
                  style={{
                    minHeight: 44, padding: '8px 14px', borderRadius: 12, cursor: hunting ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    background: sel ? `${m.color}18` : UI.card2,
                    color: sel ? m.color : UI.dim,
                    border: `1.5px solid ${sel ? m.color : UI.line}`,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {sel ? '✓' : ''} {m.name} <span style={{ color: UI.muted, fontWeight: 600, fontSize: 11 }}>{m.tag}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 🆕 A1 (17 ก.ค. 69): ออโต้หลังล่า — toggle default ปิด + เกณฑ์ match ขั้นต่ำ + เพดานใบ/รอบ */}
      <div style={{ marginBottom: 16, background: UI.card2, border: `1px solid ${UI.line}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onAutoCfgChange?.({ enabled: !autoCfg.enabled })}
            disabled={hunting}
            style={{
              minHeight: 40, padding: '8px 14px', borderRadius: 999, cursor: hunting ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
              background: autoCfg.enabled ? `${UI.accent}22` : UI.card,
              color: autoCfg.enabled ? UI.accent : UI.dim,
              border: `1.5px solid ${autoCfg.enabled ? UI.accent : UI.line}`,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>{autoCfg.enabled ? '☑' : '☐'}</span> 🤖 ออโต้หลังล่า
          </button>
          <span style={{ fontSize: 12.5, color: UI.dim }}>จบรอบล่า → สกัด+ส่งเขียนอัตโนมัติให้ลีดที่เข้าเกณฑ์ (ไม่ต้องกดทีละใบ)</span>
        </div>

        {autoCfg.enabled && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 6 }}>เกณฑ์ match ขั้นต่ำ (%)</div>
                <input
                  type="number" min={60} max={100}
                  value={autoCfg.minScore}
                  onChange={(e) => onAutoCfgChange?.({ minScore: Math.min(100, Math.max(60, Number(e.target.value) || 60)) })}
                  disabled={hunting}
                  style={{ width: 90, minHeight: 40, padding: '6px 12px', borderRadius: 10, background: UI.card, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 6 }}>เพดานใบ/รอบ</div>
                <input
                  type="number" min={1} max={10}
                  value={autoCfg.maxPerRound}
                  onChange={(e) => onAutoCfgChange?.({ maxPerRound: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                  disabled={hunting}
                  style={{ width: 90, minHeight: 40, padding: '6px 12px', borderRadius: 10, background: UI.card, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 13, fontFamily: 'inherit' }}
                />
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: UI.muted, lineHeight: 1.7 }}>
              🎯 เฉพาะลีดลิงก์ข่าว (🟢 พร้อมทำ) — คลิปจะสั่งถอดให้แต่ไม่ส่งเอง (รอกดส่งเองหลังถอดเสร็จ)<br />
              ⚠️ มีค่าเขียนตามระบบเดิมต่อใบ (ค่ากลั่นเนื้อ + ค่าเขียนข่าว) — เปิดไว้แล้วลืมปิดจะเจนงานเขียนอัตโนมัติทุกรอบล่า
            </div>
          </>
        )}
      </div>

      {/* ประเมินราคา + เริ่ม */}
      <div style={{ background: `${UI.green}0d`, border: `1px solid ${UI.green}55`, borderRadius: 12, padding: 14 }}>
        {nClusters === 0 ? (
          <div style={{ fontSize: 13, color: UI.amber }}>⚠️ ยังไม่ได้เลือกคลัสเตอร์ — เลือกอย่างน้อย 1 อัน (กด &quot;ท็อป 5&quot; ได้เลย)</div>
        ) : (
          <div style={{ fontSize: 13, color: UI.dim, lineHeight: 1.8 }}>
            จะยิงค้น <b style={{ color: UI.text }}>~{fmtNum(serperCalls)}</b> call ≈ <b style={{ color: UI.green }}>{fmtBaht(serperCost)}</b>
            {youtubeCalls > 0 && <span style={{ color: UI.muted }}> (+YouTube {fmtNum(youtubeCalls)} call ฟรี)</span>}
            {' + '}AI ตัดสินสูงสุด <b style={{ color: UI.text }}>~{fmtNum(judgeMax)}</b> ใบ ≈ <b style={{ color: UI.green }}>{fmtBaht(judgeCost)}</b>
            {' — '}รวม <b style={{ color: UI.green, fontSize: 15 }}>~{fmtBaht(totalCost)}</b>
            <div style={{ fontSize: 11.5, color: UI.muted, marginTop: 2 }}>* เป็นเพดานสูงสุด — จริงมักถูกกว่านี้ (ค้นเจอไม่ครบ/โดนกรองก่อนตัดสิน)</div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Btn
            variant="green"
            busy={hunting}
            disabled={!canStart}
            onClick={onStart}
            style={{ width: '100%' }}
          >
            {hunting ? 'กำลังล่า…' : nChannels === 0 ? 'เลือกช่องทางอย่างน้อย 1 ช่อง' : `🔎 เริ่มล่า (~${fmtBaht(totalCost)})`}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
