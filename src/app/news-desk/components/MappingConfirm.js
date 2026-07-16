'use client';

// 🧬 DNA Lab — ขั้น 2: ยืนยันการแมปคอลัมน์ + เลือกเมตริกแบ่งกลุ่ม + ปรับเกณฑ์
// auto-detect มาแล้ว ผู้ใช้แก้ได้ทุกช่อง · เมตริกต้องกดยืนยันชัดเจน (ไม่ default เงียบ)

import { UI, Btn, Card, Chip } from './ui.js';
import { FIELD_LABELS_TH, normalizePostType, toIsoDate } from '../../../lib/services/deskV2/csvClient.js';

const REQUIRED = ['title', 'reach']; // ขั้นต่ำที่ขาดไม่ได้
const FIELD_ORDER = ['title', 'reach', 'views', 'reactions', 'time', 'postId', 'permalink', 'postType', 'desc'];

export default function MappingConfirm({
  header, rows, mapping, onMapChange,
  metricKey, onMetricChange,
  thresholds, onThresholdChange,
  onConfirm, onBack,
}) {
  const preview = (rows || []).slice(1, 4); // 3 แถวแรก
  const missingRequired = REQUIRED.filter((f) => !(mapping[f] >= 0));
  const metricLabel = metricKey === 'views' ? 'ยอดดู' : 'การเข้าถึง';

  const cell = (r, idx, kind) => {
    if (idx == null || idx < 0) return <span style={{ color: UI.muted }}>—</span>;
    let v = r[idx] ?? '';
    if (kind === 'time') v = toIsoDate(v) || v;
    if (kind === 'postType') v = normalizePostType(v);
    v = String(v).replace(/\s+/g, ' ').trim();
    return <span title={v}>{v.length > 42 ? v.slice(0, 42) + '…' : v || <span style={{ color: UI.muted }}>(ว่าง)</span>}</span>;
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: UI.text }}>🔗 ยืนยันการแมปคอลัมน์</span>
          <Chip color={UI.green}>ตรวจจับอัตโนมัติแล้ว</Chip>
        </div>
        <div style={{ fontSize: 13, color: UI.dim, marginBottom: 14 }}>
          ระบบเดาคอลัมน์ให้แล้ว — ตรวจว่าตรงไหม ถ้าไม่ตรงเลือกใหม่จากเมนู (แต่ละช่องคือคอลัมน์ในไฟล์ที่จะนำไปใช้)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {FIELD_ORDER.map((f) => {
            const isReq = REQUIRED.includes(f);
            const ok = mapping[f] >= 0;
            return (
              <div key={f} style={{ background: UI.card2, border: `1px solid ${ok ? UI.line : UI.red}`, borderRadius: 12, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: UI.text }}>
                    {FIELD_LABELS_TH[f]}{isReq && <span style={{ color: UI.red }}> *</span>}
                  </span>
                  {ok
                    ? <span style={{ fontSize: 11, color: UI.green }}>✓</span>
                    : <span style={{ fontSize: 11, color: UI.red }}>ไม่พบ</span>}
                </div>
                <select
                  value={mapping[f]}
                  onChange={(e) => onMapChange(f, Number(e.target.value))}
                  style={{
                    width: '100%', minHeight: 40, padding: '8px 6px', borderRadius: 8,
                    background: UI.card, color: UI.text, border: `1px solid ${UI.line2}`,
                    fontSize: 12.5, fontFamily: 'inherit',
                  }}
                >
                  <option value={-1}>— ไม่ใช้ —</option>
                  {(header || []).map((h, i) => (
                    <option key={i} value={i}>{i}. {String(h).slice(0, 40)}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </Card>

      {/* เมตริกแบ่งกลุ่ม + เกณฑ์ */}
      <Card style={{ borderColor: UI.accent, background: `${UI.accent}0d` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: UI.text, marginBottom: 4 }}>⚖️ เกณฑ์แบ่งกลุ่มต้นแบบ</div>
        <div style={{ fontSize: 12.5, color: UI.dim, marginBottom: 14 }}>
          เลือกว่าจะใช้ยอดตัวไหนเป็นตัววัด &quot;ความปัง&quot; เพื่อแบ่งกลุ่ม S / A / ควบคุม
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: UI.text, minWidth: 120 }}>เมตริกแบ่งกลุ่ม</span>
            <select
              value={metricKey}
              onChange={(e) => onMetricChange(e.target.value)}
              style={{
                minHeight: 44, padding: '8px 12px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                background: UI.card, color: UI.text, border: `2px solid ${UI.accent}`, fontFamily: 'inherit',
              }}
            >
              <option value="reach">การเข้าถึง (แนะนำ)</option>
              <option value="views">ยอดดู</option>
            </select>
            <Chip color={UI.accent}>กำลังใช้: {metricLabel}</Chip>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div style={{ background: UI.card, border: `1px solid ${UI.gold}55`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: UI.gold, marginBottom: 6 }}>🥇 กลุ่ม S ตั้งแต่</div>
              <input
                type="number" inputMode="numeric" value={thresholds.S}
                onChange={(e) => onThresholdChange('S', e.target.value)}
                style={{ width: '100%', minHeight: 40, padding: '6px 10px', borderRadius: 8, background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 14, fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ background: UI.card, border: `1px solid ${UI.silver}55`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: UI.silver, marginBottom: 6 }}>🥈 กลุ่ม A ตั้งแต่</div>
              <input
                type="number" inputMode="numeric" value={thresholds.A}
                onChange={(e) => onThresholdChange('A', e.target.value)}
                style={{ width: '100%', minHeight: 40, padding: '6px 10px', borderRadius: 8, background: UI.card2, color: UI.text, border: `1px solid ${UI.line2}`, fontSize: 14, fontFamily: 'inherit' }}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: UI.muted }}>
            ต่ำกว่ากลุ่ม A = &quot;กลุ่มควบคุม&quot; (เก็บสถิติเชิงกล ไม่ส่งวิจัย DNA จึงไม่มีค่าใช้จ่าย)
          </div>
        </div>
      </Card>

      {/* preview 3 แถวแรก */}
      <Card>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: UI.text, marginBottom: 10 }}>👀 ตัวอย่าง 3 แถวแรก (ตามการแมปปัจจุบัน)</div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: UI.dim, textAlign: 'left' }}>
                {['หัวข้อ', 'การเข้าถึง', 'ยอดดู', 'ความรู้สึก', 'เวลา (ISO)', 'ประเภท'].map((h) => (
                  <th key={h} style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} style={{ color: UI.text }}>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, minWidth: 260 }}>{cell(r, mapping.title)}</td>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{cell(r, mapping.reach)}</td>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{cell(r, mapping.views)}</td>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{cell(r, mapping.reactions)}</td>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{cell(r, mapping.time, 'time')}</td>
                  <td style={{ padding: '6px 10px', borderBottom: `1px solid ${UI.line}`, whiteSpace: 'nowrap' }}>{cell(r, mapping.postType, 'postType')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {missingRequired.length > 0 && (
        <div style={{ fontSize: 13, color: UI.red, fontWeight: 700 }}>
          ⚠️ ยังขาดคอลัมน์จำเป็น: {missingRequired.map((f) => FIELD_LABELS_TH[f]).join(', ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={onBack}>← เปลี่ยนไฟล์</Btn>
        <Btn
          variant="primary"
          disabled={missingRequired.length > 0}
          onClick={onConfirm}
          style={{ flex: '1 1 240px' }}
        >
          ✅ ยืนยันการแมป &amp; ใช้เมตริก &quot;{metricLabel}&quot; → สแกน
        </Btn>
      </div>
    </div>
  );
}
