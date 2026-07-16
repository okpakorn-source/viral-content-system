'use client';

// 🧬 DNA Lab — ขั้น 1: อัปโหลดไฟล์ CSV (Meta Business Suite export)
// อ่านด้วย FileReader ฝั่ง browser เท่านั้น · รองรับหลายไฟล์ (ประมวลทีละไฟล์แล้วรวม posts)

import { useRef, useState } from 'react';
import { UI, Btn, Card } from './ui.js';
import { parseCsv } from '../../../lib/services/deskV2/csvClient.js';

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ: ' + file.name));
    reader.readAsText(file, 'utf-8');
  });
}

export default function UploadZone({ onLoaded, onToast }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.csv$/i.test(f.name));
    if (!files.length) {
      onToast?.('เลือกเฉพาะไฟล์ .csv เท่านั้น', 'warn');
      return;
    }
    setBusy(true);
    try {
      const sources = [];
      let mergedRows = null; // rows แรก = มีหัว, ไฟล์ถัดไปตัดหัวมาต่อ
      let header = null;
      for (const file of files) {
        const text = await readFileText(file);
        const rows = parseCsv(text);
        if (!rows.length || (rows[0] || []).length < 5) {
          onToast?.(`ไฟล์ "${file.name}" ไม่ใช่ CSV ที่อ่านได้ — ข้าม`, 'warn');
          continue;
        }
        if (!header) {
          header = rows[0];
          mergedRows = rows.slice(); // รวมหัว
        } else {
          // ไฟล์ถัดไป — ต่อเฉพาะแถวข้อมูล (สมมติหัวเดียวกันเพราะ Meta export ฟอร์แมตเดียว)
          mergedRows.push(...rows.slice(1));
        }
        sources.push({ name: file.name, rows: rows.length - 1, size: file.size });
      }
      if (!header || !mergedRows) {
        onToast?.('ไม่พบข้อมูลในไฟล์ที่เลือก', 'err');
        return;
      }
      onLoaded?.({ header, rows: mergedRows, sources });
      onToast?.(`โหลด ${sources.length} ไฟล์ · ${mergedRows.length - 1} แถวข้อมูล`, 'ok');
    } catch (e) {
      onToast?.(e?.message || 'อ่านไฟล์ล้มเหลว', 'err');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          padding: 'clamp(24px, 6vw, 48px) 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? `${UI.accent}18` : 'transparent',
          border: `2px dashed ${dragOver ? UI.accent : UI.line2}`,
          borderRadius: 16,
          transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: 'clamp(38px, 10vw, 56px)', lineHeight: 1 }}>📄</div>
        <div style={{ fontSize: 'clamp(15px, 3.6vw, 18px)', fontWeight: 800, color: UI.text, marginTop: 12 }}>
          ลากไฟล์ CSV มาวาง หรือแตะเพื่อเลือก
        </div>
        <div style={{ fontSize: 13, color: UI.dim, marginTop: 6, lineHeight: 1.6 }}>
          ไฟล์ที่ export จาก <b>Meta Business Suite</b> (เลือกหลายไฟล์พร้อมกันได้ — ระบบจะรวมให้)
        </div>
        <div style={{ marginTop: 16 }}>
          <Btn busy={busy} onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            {busy ? 'กำลังอ่านไฟล์…' : '📂 เลือกไฟล์ CSV'}
          </Btn>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>
      <div style={{ padding: '12px 18px', fontSize: 12, color: UI.muted, background: UI.card2, borderTop: `1px solid ${UI.line}` }}>
        💡 ไฟล์อ่านในเบราว์เซอร์เท่านั้น ไม่อัปโหลดขึ้นเซิร์ฟเวอร์ — จะส่งเฉพาะ &quot;หัวข้อ + ยอด&quot; ของโพสต์กลุ่ม S/A ไปวิจัยเท่านั้น
      </div>
    </Card>
  );
}
