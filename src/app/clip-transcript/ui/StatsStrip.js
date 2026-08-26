'use client';
/**
 * StatsStrip — แถบสถิติจริง (พิมพ์เขียวข้อ 4: "ตัวเลขจริงเท่านั้น ห้ามมโน")
 * รับ props ตรงจากของจริงที่มีอยู่แล้ว ไม่คำนวณอะไรที่ไม่มีแหล่งข้อมูล:
 *   - counts      → GET queue-list.counts (pending/processing/retry_wait/cancelled/active — queue-list/route.js:54-60)
 *   - casesTotal  → GET cases.total (cases/route.js:25 — จำนวนใบทั้งคลัง ไม่ใช่แค่หน้าที่โหลด)
 *   - cases       → array ใบล่าสุดที่โหลดมา (≤40 ใบ จาก cases?limit=40) — ทุกตัวเลขในข้อ 3 คำนวณจากอาเรย์นี้เท่านั้น
 *     และ "ต้องระบุจำนวนใบกำกับเสมอ" กันเข้าใจผิดว่าเป็นสถิติทั้งคลัง
 * ค่าที่คำนวณไม่ได้ (เช่น cases ว่าง / ไม่มีใบไหนมี elapsedMs) → ซ่อนชิปนั้นไปเลย ไม่โชว์ 0 มั่ว
 */
import { platformIcon, getBrainMeta, fmtDurSec } from './statusMeta';

const C = { text: '#e5e7eb', line: '#374151', bg: '#111827' };

function Chip({ children, title }) {
  return (
    <span
      title={title || ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
        fontSize: 12.5, fontWeight: 600, color: C.text,
        background: C.bg, border: `1px solid ${C.line}`,
      }}
    >
      {children}
    </span>
  );
}

/** มัธยฐานของ elapsedMs ที่ >0 เท่านั้น (0/undefined = ใบที่ไม่มีค่าเวลาบันทึกไว้ ไม่ใช่ "เร็ว 0 วิ") */
function medianElapsedMs(list) {
  const vals = list.map((c) => Number(c?.elapsedMs) || 0).filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export default function StatsStrip({ counts, casesTotal, cases }) {
  const list = Array.isArray(cases) ? cases : [];
  const n = list.length;

  // ── ชิปกลุ่ม 1: คิวตอนนี้ (จาก counts ตรงๆ ไม่คำนวณเอง) ──
  const queueChips = [];
  if (counts) {
    if (counts.pending > 0) queueChips.push(<Chip key="q-pending">⏳ รอคิว {counts.pending}</Chip>);
    if (counts.processing > 0) queueChips.push(<Chip key="q-processing">🔧 กำลังถอด {counts.processing}</Chip>);
    if (counts.retry_wait > 0) queueChips.push(<Chip key="q-retry">🟡 รอลองใหม่ {counts.retry_wait}</Chip>);
    if (counts.cancelled > 0) queueChips.push(<Chip key="q-cancelled">🚫 ยกเลิก {counts.cancelled}</Chip>);
  }

  // ── ชิปกลุ่ม 2: คลังทั้งหมด (จาก cases.total) ──
  const totalChip = Number.isFinite(casesTotal) && casesTotal > 0
    ? <Chip key="total">📦 คลังทั้งหมด {casesTotal} ใบ</Chip>
    : null;

  // ── ชิปกลุ่ม 3: คำนวณจากใบล่าสุด N ใบที่โหลดมา
  //    ★ ต้องเขียนกำกับ "จาก N ใบล่าสุด" เสมอ (พิมพ์เขียวข้อ 4) กันเข้าใจผิดว่าเป็นสถิติทั้งคลัง
  //    → ใส่เป็นชิปหัวกลุ่มเสมอเมื่อ n>0 แทนการเขียนซ้ำทุกชิปย่อย
  const recentStatChips = [];
  if (n > 0) {
    const medMs = medianElapsedMs(list);
    if (medMs > 0) {
      recentStatChips.push(
        <Chip key="r-median" title={`คำนวณเฉพาะใบที่มีเวลาถอดบันทึกไว้ ใน ${n} ใบล่าสุด`}>
          ⏱️ ถอดมัธยฐาน {fmtDurSec(medMs / 1000)}
        </Chip>
      );
    }

    const byPlatform = {};
    for (const c of list) {
      const p = c?.platform;
      if (!p) continue;
      byPlatform[p] = (byPlatform[p] || 0) + 1;
    }
    const platformKeys = Object.keys(byPlatform);
    if (platformKeys.length) {
      const parts = platformKeys.map((p) => `${platformIcon(p)}${byPlatform[p]}`).join(' ');
      recentStatChips.push(
        <Chip key="r-platform" title={`แยก platform จาก ${n} ใบล่าสุด`}>
          {parts}
        </Chip>
      );
    }

    const lowQCount = list.filter((c) => c?.lowQuality).length;
    if (lowQCount > 0) {
      recentStatChips.push(
        <Chip key="r-lowq" title={`จาก ${n} ใบล่าสุด`}>
          ⚠️ คุณภาพต่ำ {lowQCount}
        </Chip>
      );
    }

    // แยกผลตรวจสมอง: นับ brain.status แต่ละค่า — ใบไม่มี brain ไม่นับ (ระบบใหม่เท่านั้นที่มีสมองตรวจ)
    const brainCounts = {};
    let brainTotal = 0;
    for (const c of list) {
      const status = c?.insight?.brain?.status;
      if (!status) continue;
      brainTotal += 1;
      brainCounts[status] = (brainCounts[status] || 0) + 1;
    }
    if (brainTotal > 0) {
      const parts = Object.keys(brainCounts)
        .map((status) => `${getBrainMeta(status)?.emoji || '•'}${brainCounts[status]}`)
        .join(' ');
      recentStatChips.push(
        <Chip key="r-brain" title={`นับเฉพาะใบที่มีผลตรวจสมอง จาก ${n} ใบล่าสุด`}>
          🧠 ตรวจแล้ว {brainTotal}: {parts}
        </Chip>
      );
    }
  }

  // ชิปหัวกลุ่ม "จาก N ใบล่าสุด" โผล่เฉพาะเมื่อมีสถิติกลุ่ม 3 อย่างน้อย 1 ชิ้นจริง (กันโชว์ป้ายลอยไม่มีเนื้อหา)
  const recentChips = recentStatChips.length
    ? [<Chip key="r-label" title="ตัวเลขกลุ่มนี้คำนวณจากใบล่าสุดที่โหลดมาแสดง ไม่ใช่ทั้งคลัง">📋 จาก {n} ใบล่าสุด</Chip>, ...recentStatChips]
    : [];

  const allChips = [...queueChips, totalChip, ...recentChips].filter(Boolean);
  if (!allChips.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {allChips}
    </div>
  );
}
