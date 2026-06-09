'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useCoverCanvas } from '@/lib/cover/useCoverCanvas';
import { W, H } from '@/lib/cover/constants';
import CoverEditor from './CoverEditor';

// ═══════════════════════════════════════════════════════════
// BUILTIN TEMPLATE DEFINITIONS (copied from cover-tester)
// Canvas = 1200 x 1350 px
// ═══════════════════════════════════════════════════════════
const BUILTIN_TEMPLATES = [
  {
    id: 'template_1', name: 'ข่าวดราม่า 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight + ภาพรอง', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 750, h: 1350, fadeRight: 150,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 720,  fadeLeft: 190, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 580, w: 850, h: 770,  fadeLeft: 160, fadeTop: 160,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 370, y: 280, w: 560, h: 400,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'sub_left',  label: '🖼 ภาพรอง (ซ้ายล่าง)',      x: 15,  y: 610, w: 520, h: 430,  border: '#FFFFFF', borderWidth: 4, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_2', name: 'ข่าวสะอาด 4 ช่อง', desc: '4 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight กลาง', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 740,  fadeLeft: 180, fadeBottom: 150,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 380, y: 520, w: 820, h: 830,  fadeLeft: 170, fadeTop: 160,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเข้ม)',      x: 120, y: 580, w: 560, h: 360,  border: '#333333', borderWidth: 5, zIndex: 3, draggable: true },
    ],
  },
  {
    id: 'template_3', name: 'ข่าวดราม่า + วงกลม', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Emotion ขวาล่าง + Highlight + Circle', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 740, h: 1350, fadeRight: 150,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 720,  fadeLeft: 180, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 อารมณ์ล่าง-ขวา',         x: 380, y: 580, w: 820, h: 770,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเขียว)',     x: 340, y: 280, w: 630, h: 440,  border: '#CCFF00', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 25,  y: 680, shape: 'circle', diameter: 440, border: '#FFFFFF', borderWidth: 6, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_4', name: 'ข่าวสังคม + 2 วงกลม', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle ใหญ่ + Circle เล็กแดง',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 730, y: 680, fontSize: 48, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (เหลือง)', x: 730, y: 760, fontSize: 40, color: '#FFD700', fontWeight: 'bold', align: 'center', maxWidth: 520, stroke: '#000', strokeWidth: 3, bg: 'rgba(0,0,0,0.65)', bgPadY: 12, bgFullWidth: false, bgEditable: true, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 720, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 700,  fadeLeft: 170, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 550, w: 850, h: 800,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 25,  y: 680, shape: 'circle', diameter: 400, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง ขวาบน)',  x: 890, y: 15,  shape: 'circle', diameter: 200, border: '#FF0000', borderWidth: 4, zIndex: 5, draggable: true },
    ],
  },
  {
    id: 'template_5', name: 'ข่าวเหตุการณ์ 5 ช่อง', desc: '5 รูป — Hero ซ้ายเต็ม + Scene ขวาบน + Context ขวาล่าง + Highlight เหลือง + Circle ขาว', textSlots: [],
    slots: [
      { id: 'main',      label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 730, h: 1350, fadeRight: 170,                  zIndex: 2 },
      { id: 'bg_top',    label: '🖼 ฉากบน-ขวา',             x: 400, y: 0,   w: 800, h: 700,  fadeLeft: 180, fadeBottom: 140,  zIndex: 0 },
      { id: 'bg_bottom', label: '🖼 ฉากล่าง-ขวา',            x: 350, y: 560, w: 850, h: 790,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'highlight', label: '⭐ ไฮไลท์ (กรอบเหลือง)',    x: 420, y: 310, w: 580, h: 410,  border: '#FFD700', borderWidth: 5, zIndex: 3, draggable: true },
      { id: 'circle',    label: '⭕ วงกลม (ซ้ายล่าง)',       x: 15,  y: 630, shape: 'circle', diameter: 460, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
  {
    id: 'template_6', name: 'ข่าวสะเทือนใจ + ข้อความ', desc: '5 รูป + 2 ข้อความ — Hero + Scene + Context + Circle แดงกลาง + Circle ขาวล่าง',
    textSlots: [
      { id: 'line1', label: '📝 บรรทัด 1 (ขาว)', x: 620, y: 580, fontSize: 46, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 480, stroke: '#000', strokeWidth: 4, placeholder: 'พาดหัวหลัก...' },
      { id: 'line2', label: '📝 บรรทัด 2 (ขาว)', x: 620, y: 660, fontSize: 40, color: '#FFFFFF', fontWeight: 'bold', align: 'center', maxWidth: 500, stroke: '#000', strokeWidth: 3, placeholder: 'รายละเอียด...' },
    ],
    slots: [
      { id: 'main',         label: '★ ภาพหลัก (ซ้ายเต็ม)',     x: 0,   y: 0,   w: 700, h: 1350, fadeRight: 160,                  zIndex: 2 },
      { id: 'bg_top',       label: '🖼 ฉากบน-ขวา',             x: 380, y: 0,   w: 820, h: 650,  fadeLeft: 170, fadeBottom: 130,  zIndex: 0 },
      { id: 'bg_bottom',    label: '🖼 ฉากล่าง-ขวา',            x: 340, y: 520, w: 860, h: 830,  fadeLeft: 160, fadeTop: 150,    zIndex: 1 },
      { id: 'circle_small', label: '⭕ วงกลมเล็ก (แดง กลาง)',   x: 440, y: 180, shape: 'circle', diameter: 160, border: '#FF0000', borderWidth: 3, zIndex: 5, draggable: true },
      { id: 'circle',       label: '⭕ วงกลมใหญ่ (ซ้ายล่าง)',   x: 50,  y: 680, shape: 'circle', diameter: 360, border: '#FFFFFF', borderWidth: 5, zIndex: 4, draggable: true },
    ],
  },
];

// Role → slot mapping for gallery images
const ROLE_TO_SLOT = {
  HERO_FACE: 'main', HERO: 'main',
  CONTEXT_SCENE: 'bg_top',
  EMOTION: 'bg_bottom',
  RELATIONSHIP: 'circle', FAMILY_SUPPORT: 'circle',
  EVIDENCE: 'highlight',
  SUPPORT: null, // fill remaining
};

function TemplateThumbnail({ template, isActive, onClick }) {
  const sc = 72 / W, th = H * sc;
  return (
    <button onClick={onClick} style={{ padding: 0, border: isActive ? '2px solid #a3e635' : '2px solid #374151', borderRadius: 8, background: '#1a1a2e', cursor: 'pointer', width: 76, height: th + 4, overflow: 'hidden', transition: 'all .15s', boxShadow: isActive ? '0 0 12px rgba(163,230,53,0.3)' : 'none', flexShrink: 0 }}>
      <svg width={72} height={th} viewBox={`0 0 ${W} ${H}`}>
        <rect width={W} height={H} fill="#111" />
        {template.slots.map(sl => sl.shape === 'circle'
          ? <circle key={sl.id} cx={sl.x + sl.diameter / 2} cy={sl.y + sl.diameter / 2} r={sl.diameter / 2} fill="none" stroke={sl.border || '#4FC3F7'} strokeWidth={14} opacity={0.7} />
          : <rect key={sl.id} x={sl.x} y={sl.y} width={sl.w} height={sl.h} fill={sl.border || (sl.id === 'main' ? '#a3e635' : '#556')} opacity={sl.id === 'main' ? 0.4 : 0.25} stroke={sl.border || 'none'} strokeWidth={sl.border ? 12 : 0} />
        )}
      </svg>
    </button>
  );
}

export default function CoverLabPage() {
  // Auto Cover state
  const [newsTitle, setNewsTitle] = useState('');
  const [content, setContent] = useState('');
  const [templateId, setTemplateId] = useState('auto');
  const [coverResult, setCoverResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editTemplateId, setEditTemplateId] = useState('template_1');
  const [editImages, setEditImages] = useState({}); // { slotId: HTMLImageElement }
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [templates, setTemplates] = useState([]);

  // ★ Batch Mode state
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchCoverProgress, setBatchCoverProgress] = useState({ current: 0, total: 0 });
  const [batchResults, setBatchResults] = useState([]);
  const [expandedBatch, setExpandedBatch] = useState(null); // index of expanded result

  // Cover Library state
  const [uploadCategory, setUploadCategory] = useState('ทั่วไป');
  const [uploading, setUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, results: [] });
  const [library, setLibrary] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const fileRef = useRef(null);

  // โหลด template จริง 6 แบบจากหน้าปกข่าว
  useEffect(() => {
    fetch('/api/auto-cover/templates')
      .then(r => r.json())
      .then(data => {
        if (data.success) setTemplates(data.templates);
      })
      .catch(() => {
        // Fallback ถ้า API ยังไม่พร้อม
        setTemplates([
          { id: 'auto', name: '🤖 Auto', desc: 'AI เลือกให้' },
        ]);
      });
  }, []);

  // Generate auto cover
  async function handleGenerate(isRegenerate = false, isFresh = false) {
    if (!newsTitle && !content) return setError('ใส่หัวข้อหรือเนื้อหาข่าว');
    setLoading(true);
    setError('');
    if (!isRegenerate) setCoverResult(null);
    try {
      // ถ้า regenerate ให้สุ่ม template ใหม่
      let useTemplate = templateId;
      if (isRegenerate && templateId === 'auto') {
        const builtins = templates.filter(t => t.id !== 'auto');
        if (builtins.length > 0) {
          const prev = coverResult?.templateUsed || '';
          const others = builtins.filter(t => t.id !== prev);
          useTemplate = others.length > 0
            ? others[Math.floor(Math.random() * others.length)].id
            : builtins[0].id;
        }
      }

      const res = await fetch('/api/auto-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsTitle, content, templateId: useTemplate, regenerate: isRegenerate, clearCache: !!isRegenerate && isFresh }),
      });
      const data = await res.json();
      if (data.success) {
        setCoverResult(data);
      } else {
        setError(data.error || 'เกิดข้อผิดพลาด');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ★ Parse batch text into news items
  function parseBatchText(text) {
    if (!text.trim()) return [];
    return text.split('---').map(block => {
      const lines = block.trim().split('\n').filter(l => l.trim());
      let title = '', body = '';
      for (const line of lines) {
        const titleMatch = line.match(/^หัวข้อ[:：]\s*(.+)/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else if (!title && !body) {
          title = line.trim(); // first line = title if no prefix
        } else {
          const contentMatch = line.match(/^เนื้อหา[:：]\s*(.+)/i);
          body += (contentMatch ? contentMatch[1] : line).trim() + '\n';
        }
      }
      return { title: title || body.substring(0, 80), content: body.trim() };
    }).filter(item => item.title || item.content);
  }

  // ★ Batch generate covers
  async function handleBatchGenerate() {
    const items = parseBatchText(batchText);
    if (items.length === 0) return;
    
    setBatchLoading(true);
    setBatchResults([]);
    setBatchCoverProgress({ current: 0, total: items.length });
    const batchId = `BATCH-${Date.now()}`;
    const results = [];

    for (let i = 0; i < items.length; i++) {
      setBatchCoverProgress({ current: i + 1, total: items.length });
      try {
        const res = await fetch('/api/auto-cover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newsTitle: items[i].title,
            content: items[i].content,
            templateId: 'auto',
            batchId,
          }),
        });
        const data = await res.json();
        results.push({
          newsTitle: items[i].title,
          success: data.success,
          coverResult: data.success ? data : null,
          error: data.error || null,
        });
      } catch (e) {
        results.push({
          newsTitle: items[i].title,
          success: false,
          coverResult: null,
          error: e.message,
        });
      }
      setBatchResults([...results]);
    }

    setBatchLoading(false);
  }

  // Enter edit mode — load gallery images into canvas slots
  async function enterEditMode(result) {
    if (!result?.gallery?.length) return;
    setLoadingEdit(true);
    try {
      // Determine which builtin template was used
      const usedId = result.templateUsed || 'template_1';
      const tpl = BUILTIN_TEMPLATES.find(t => t.id === usedId) || BUILTIN_TEMPLATES[0];
      setEditTemplateId(tpl.id);

      // Load images and map by role
      const slotIds = tpl.slots.map(s => s.id);
      const usedSlots = new Set();
      const imgMap = {};
      const loadPromises = [];

      for (const gImg of result.gallery) {
        if (!gImg.url) continue;
        const role = gImg.role || 'SUPPORT';
        let targetSlot = ROLE_TO_SLOT[role];

        // If slot already taken or doesn't exist in template, find alternative
        if (!targetSlot || usedSlots.has(targetSlot) || !slotIds.includes(targetSlot)) {
          // Try secondary mappings
          if (role === 'RELATIONSHIP' || role === 'FAMILY_SUPPORT') {
            targetSlot = slotIds.includes('sub_left') && !usedSlots.has('sub_left') ? 'sub_left' : null;
          }
          if (role === 'EVIDENCE') {
            targetSlot = slotIds.includes('circle_small') && !usedSlots.has('circle_small') ? 'circle_small' : null;
          }
          // Fill remaining empty slot
          if (!targetSlot) {
            targetSlot = slotIds.find(sid => !usedSlots.has(sid)) || null;
          }
        }
        if (!targetSlot || usedSlots.has(targetSlot)) continue;
        usedSlots.add(targetSlot);

        const p = new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { imgMap[targetSlot] = img; resolve(); };
          img.onerror = () => resolve(); // skip failed
          img.src = gImg.url;
        });
        loadPromises.push(p);
      }
      await Promise.all(loadPromises);

      setEditImages(imgMap);
      setEditMode(true);
    } catch (e) {
      console.error('[CoverLab] Edit mode error:', e);
    } finally {
      setLoadingEdit(false);
    }
  }

  // Batch upload cover examples
  async function handleBatchUpload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const total = files.length;
    const results = [];
    setBatchProgress({ current: 0, total, results: [] });

    for (let i = 0; i < total; i++) {
      const file = files[i];
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
      
      try {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('title', file.name.replace(/\.[^.]+$/, ''));
        formData.append('category', uploadCategory);
        
        const res = await fetch('/api/cover-library', { method: 'POST', body: formData });
        const data = await res.json();
        results.push({ 
          name: file.name, 
          success: data.success, 
          layout: data.cover?.analysis?.layout_type || '',
          score: data.cover?.analysis?.quality_score || 0,
          error: data.error 
        });
      } catch (e) {
        results.push({ name: file.name, success: false, error: e.message });
      }
      
      setBatchProgress({ current: i + 1, total, results: [...results] });
    }

    setUploading(false);
    loadLibrary();
    if (fileRef.current) fileRef.current.value = '';
  }

  // Load library
  async function loadLibrary() {
    setLoadingLib(true);
    try {
      const res = await fetch('/api/cover-library?limit=20');
      const data = await res.json();
      if (data.success) setLibrary(data.covers || []);
    } catch {}
    setLoadingLib(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fbbf24', margin: 0 }}>
            🖼️ Cover Lab
          </h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href="/cover-archive" style={{ padding: '8px 16px', background: '#1e293b', color: '#94a3b8', border: '1px solid #374151', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              📁 คลังปก
            </a>
            <button
              onClick={() => { setBatchMode(!batchMode); setBatchResults([]); setExpandedBatch(null); }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: batchMode ? '2px solid #f59e0b' : '2px solid #374151',
                background: batchMode ? 'rgba(245,158,11,0.15)' : '#1e293b',
                color: batchMode ? '#fbbf24' : '#94a3b8',
              }}
            >
              {batchMode ? '📋 Batch Mode ✓' : '📋 Batch Mode'}
            </button>
          </div>
        </div>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>
          {batchMode ? '📊 ใส่หลายข่าว สร้างปกทีเดียว เปรียบเทียบผลลัพธ์' : 'ทดสอบ Auto Cover + คลังปกไวรัล'}
        </p>

        {/* ★ BATCH MODE UI */}
        {batchMode && (
          <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '2px solid #f59e0b33', marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#fbbf24' }}>
              📋 Batch Cover Generation
            </h2>
            
            <label style={labelStyle}>ใส่หลายข่าว คั่นด้วย --- (ขีด 3 ตัว)</label>
            <textarea
              value={batchText}
              onChange={e => setBatchText(e.target.value)}
              placeholder={`หัวข้อ: ก้อย รัชวิน มอบเงิน 5 แสน...\nเนื้อหา: ครั้งหนึ่ง "ก้อย รัชวิน" มอบเงิน...\n---\nหัวข้อ: ตัก บงกช โพสต์ความในใจ...\nเนื้อหา: หลังจากที่ตัก บงกช...\n---\nหัวข้อ: ลิซ่า BLACKPINK กลับไทย...\nเนื้อหา: ลิซ่า ลลิษา มโนบาล...`}
              rows={10}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
            />
            
            {/* Preview parsed items */}
            {batchText.trim() && (
              <div style={{ marginTop: 8, padding: 8, background: '#0f172a', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  📰 {parseBatchText(batchText).length} ข่าว:
                </span>
                {parseBatchText(batchText).map((item, i) => (
                  <span key={i} style={{ display: 'inline-block', margin: '4px 4px 0', padding: '2px 8px', background: '#1e293b', borderRadius: 4, fontSize: 11, color: '#e2e8f0' }}>
                    {i + 1}. {item.title.substring(0, 40)}{item.title.length > 40 ? '...' : ''}
                  </span>
                ))}
              </div>
            )}

            <button
              onClick={handleBatchGenerate}
              disabled={batchLoading || !batchText.trim()}
              style={{
                width: '100%', padding: '14px 24px', marginTop: 16,
                background: batchLoading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: batchLoading ? 'wait' : 'pointer',
              }}
            >
              {batchLoading
                ? `⏳ กำลังสร้าง ${batchCoverProgress.current}/${batchCoverProgress.total}...`
                : `🚀 สร้างปกทั้งหมด (${parseBatchText(batchText).length} ข่าว)`}
            </button>

            {/* Progress Bar */}
            {batchLoading && batchCoverProgress.total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background: '#1e293b', borderRadius: 8, height: 28, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(batchCoverProgress.current / batchCoverProgress.total) * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f59e0b, #22c55e)',
                    borderRadius: 8,
                    transition: 'width 0.5s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#000',
                  }}>
                    {batchCoverProgress.current}/{batchCoverProgress.total}
                  </div>
                </div>
              </div>
            )}

            {/* ★ Batch Results Summary */}
            {batchResults.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  {(() => {
                    const scores = batchResults.filter(r => r.success).map(r => r.coverResult?.score || 0);
                    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
                    const high = scores.filter(s => s >= 8).length;
                    const mid = scores.filter(s => s >= 5 && s < 8).length;
                    const low = scores.filter(s => s < 5).length;
                    return (
                      <>
                        <div style={{ padding: '10px 16px', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b', textAlign: 'center' }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24' }}>{avg}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>Avg Score</div>
                        </div>
                        <div style={{ padding: '10px 16px', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b', textAlign: 'center' }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{batchResults.filter(r => r.success).length}/{batchResults.length}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>สำเร็จ</div>
                        </div>
                        <div style={{ padding: '10px 16px', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 13 }}>🟢 {high}</span>
                          <span style={{ fontSize: 13 }}>🟡 {mid}</span>
                          <span style={{ fontSize: 13 }}>🔴 {low}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Results Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {batchResults.map((result, i) => (
                    <div
                      key={i}
                      onClick={() => setExpandedBatch(expandedBatch === i ? null : i)}
                      style={{
                        background: result.success ? '#0f172a' : '#7f1d1d22',
                        borderRadius: 10, padding: 12,
                        border: expandedBatch === i ? '2px solid #f59e0b' : '1px solid #1e293b',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
                        📰 {result.newsTitle?.substring(0, 50)}{result.newsTitle?.length > 50 ? '...' : ''}
                      </div>
                      {result.success && result.coverResult?.base64 && (
                        <img
                          src={result.coverResult.base64}
                          alt=""
                          style={{ width: '100%', borderRadius: 6, marginBottom: 8 }}
                        />
                      )}
                      {!result.success && (
                        <div style={{ padding: 16, textAlign: 'center', color: '#fca5a5', fontSize: 13 }}>
                          ❌ {result.error || 'เกิดข้อผิดพลาด'}
                        </div>
                      )}
                      {result.success && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ ...badgeStyle, background: (result.coverResult?.score || 0) >= 8 ? '#14532d' : (result.coverResult?.score || 0) >= 5 ? '#713f12' : '#7f1d1d', color: '#fff', fontSize: 11 }}>
                            ⭐ {result.coverResult?.score}/10
                          </span>
                          <span style={{ ...badgeStyle, fontSize: 11 }}>
                            🎨 {result.coverResult?.templateUsed}
                          </span>
                          <span style={{ ...badgeStyle, fontSize: 11 }}>
                            ⏱️ {result.coverResult?.elapsed}
                          </span>
                          {result.coverResult?.caseId && (
                            <span style={{ ...badgeStyle, fontSize: 11, background: '#1e3a5f', color: '#60a5fa' }}>
                              📁 {result.coverResult.caseId}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Expanded view */}
                {expandedBatch !== null && batchResults[expandedBatch]?.success && (
                  <div style={{ marginTop: 16, padding: 16, background: '#0f172a', borderRadius: 12, border: '2px solid #f59e0b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24', margin: 0 }}>
                        📰 {batchResults[expandedBatch].newsTitle?.substring(0, 60)}
                      </h3>
                      <button onClick={() => setExpandedBatch(null)} style={{ padding: '4px 12px', background: '#374151', color: '#94a3b8', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                    <img
                      src={batchResults[expandedBatch].coverResult.base64}
                      alt=""
                      style={{ width: '100%', maxWidth: 600, borderRadius: 8, border: '2px solid #374151' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <a
                        href={batchResults[expandedBatch].coverResult.base64}
                        download={`cover-batch-${expandedBatch + 1}.jpg`}
                        style={{ padding: '10px 20px', background: '#065f46', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
                      >
                        💾 ดาวน์โหลด
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: batchMode ? '1fr' : '1fr 1fr', gap: 24 }}>
          {/* Left: Auto Cover (hidden in batch mode) */}
          {!batchMode && (
          <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '1px solid #1e293b' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#60a5fa' }}>
              🚀 สร้างปกอัตโนมัติ
            </h2>

            <label style={labelStyle}>หัวข้อข่าว</label>
            <input
              value={newsTitle}
              onChange={e => setNewsTitle(e.target.value)}
              placeholder="เช่น: ตัก บงกช สร้างบ้าน 800 ไร่ให้ครอบครัว"
              style={inputStyle}
            />

            <label style={labelStyle}>เนื้อหาข่าว (optional)</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="วางเนื้อหาข่าวที่ต้องการทำปก..."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />

            <label style={labelStyle}>Template ปก ({templates.length} แบบ)</label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              style={inputStyle}
            >
              <option value="auto">🤖 Auto — AI เลือก template ที่เหมาะสม</option>
              <optgroup label="── ปกข่าว (6 แบบ) ──">
                {templates.filter(t => t.id !== 'auto').map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.desc}{t.imageSlots ? ` (${t.imageSlots} รูป)` : ''}
                  </option>
                ))}
              </optgroup>
            </select>

            <button
              onClick={() => handleGenerate(false)}
              disabled={loading}
              style={{
                width: '100%', padding: '14px 24px', marginTop: 16,
                background: loading ? '#374151' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? '⏳ กำลังสร้างปก... (30-60 วินาที)' : '🖼️ สร้างปกอัตโนมัติ'}
            </button>

            {error && (
              <div style={{ marginTop: 12, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#fca5a5' }}>
                ❌ {error}
              </div>
            )}

            {coverResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={badgeStyle}>📐 {coverResult.templateUsed}</span>
                  <span style={badgeStyle}>🖼️ {coverResult.imageCount} ภาพ</span>
                  <span style={badgeStyle}>⭐ {coverResult.score}/10</span>
                  <span style={badgeStyle}>⏱️ {coverResult.elapsed}</span>
                </div>
                {coverResult.identity && (
                  <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                    👤 {coverResult.identity.mainCharacter} | 💗 {coverResult.identity.emotion}
                  </p>
                )}
                {/* ★ ปกหลัก: ถ้า editMode → แสดง Editor แทน, ถ้าไม่ → แสดงภาพปกปกติ */}
                {editMode ? (
                  <CoverEditor
                    editImages={editImages}
                    editTemplateId={editTemplateId}
                    setEditTemplateId={setEditTemplateId}
                    onClose={() => setEditMode(false)}
                    coverBase64={coverResult?.base64}
                  />
                ) : (
                  <img
                    src={coverResult.base64}
                    alt="Auto generated cover"
                    style={{ width: '100%', borderRadius: 8, border: '2px solid #374151' }}
                  />
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleGenerate(true, false)}
                    disabled={loading}
                    style={{
                      flex: 1, padding: '12px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                      color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                      cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                    }}
                  >
                    {loading ? '⏳ กำลังสร้างใหม่...' : '🔄 สร้างปกใหม่ (สลับ template)'}
                  </button>
                  <button
                    onClick={() => handleGenerate(true, true)}
                    disabled={loading}
                    style={{
                      padding: '12px 16px', background: loading ? '#374151' : '#7f1d1d',
                      color: '#fff', border: '1px solid #ef4444', borderRadius: 8, fontSize: 13, fontWeight: 700,
                      cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
                    }}
                    title="ล้าง cache ภาพเก่า แล้วค้น Google ใหม่ทั้งหมด"
                  >
                    🗑️ ค้นภาพใหม่
                  </button>
                  <a
                    href={coverResult.base64}
                    download={`cover-${Date.now()}.jpg`}
                    style={{
                      padding: '12px 20px', background: '#065f46',
                      color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                      textDecoration: 'none', display: 'flex', alignItems: 'center',
                    }}
                  >
                    💾 ดาวน์โหลด
                  </a>
                </div>

                {/* ✏️ Edit Mode Toggle Button */}
                <button
                  onClick={() => editMode ? setEditMode(false) : enterEditMode(coverResult)}
                  disabled={loadingEdit}
                  style={{
                    width: '100%', padding: '12px', marginTop: 8,
                    background: loadingEdit ? '#374151' : editMode
                      ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                      : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
                    cursor: loadingEdit ? 'wait' : 'pointer', opacity: loadingEdit ? 0.6 : 1,
                  }}
                >
                  {loadingEdit ? '⏳ โหลดภาพ...' : editMode ? '❌ ปิด Edit Mode' : '✏️ แก้ไขปกนี้ (Edit Mode)'}
                </button>

                {/* Case ID + ข้อมูลคลัง */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {coverResult.caseId && (
                    <span style={{ ...badgeStyle, background: '#1e3a5f', color: '#60a5fa', fontSize: 11 }}>
                      📁 {coverResult.caseId}
                    </span>
                  )}
                  {coverResult.cachedImages > 0 && (
                    <span style={{ ...badgeStyle, fontSize: 11 }}>
                      📦 {coverResult.cachedImages} ภาพในคลัง
                    </span>
                  )}
                </div>

                {/* 🖼️ Gallery: ภาพที่ AI ค้นพบ */}
                {coverResult.gallery?.length > 0 && (
                  <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa', marginBottom: 10 }}>
                      🖼️ ภาพที่ AI ค้นพบ ({coverResult.gallery.length} ภาพ)
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {coverResult.gallery.map((img, i) => {
                        const roleBg = {
                          HERO_FACE: '#dc2626', HERO: '#ea580c', CONTEXT_SCENE: '#2563eb',
                          EVIDENCE: '#ca8a04', EMOTION: '#db2777', RELATIONSHIP: '#7c3aed', SUPPORT: '#475569'
                        }[img.role] || '#475569';
                        return (
                          <div key={i} style={{
                            position: 'relative', width: 80, height: 80,
                            borderRadius: 6, overflow: 'hidden', border: `2px solid ${roleBg}`,
                            background: '#1e293b',
                          }}>
                            {img.url && <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            <div style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0,
                              background: 'rgba(0,0,0,0.8)', padding: '2px 4px',
                              fontSize: 9, color: '#fff', textAlign: 'center',
                            }}>
                              <span style={{
                                display: 'inline-block', background: roleBg, borderRadius: 3,
                                padding: '1px 4px', fontSize: 8, fontWeight: 700,
                              }}>{img.role?.replace('_', ' ')}</span>
                              {img.hasFace && <span style={{ marginLeft: 3 }}>👤{img.faceCount}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>)}

          {/* Right: Cover Library */}
          <div style={{ background: '#111827', borderRadius: 12, padding: 24, border: '1px solid #1e293b' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#f59e0b' }}>
              📚 คลังปกไวรัล (AI เรียนรู้)
            </h2>

            <label style={labelStyle}>เลือกภาพปก (เลือกได้หลายภาพพร้อมกัน)</label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed #374151', borderRadius: 12, padding: '24px 16px',
                textAlign: 'center', cursor: 'pointer', background: '#0f172a',
                transition: 'border-color 0.2s',
              }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#f59e0b'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#374151'; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = '#374151';
                if (fileRef.current) {
                  fileRef.current.files = e.dataTransfer.files;
                  setBatchProgress(p => ({ ...p, total: e.dataTransfer.files.length }));
                }
              }}
            >
              <input
                type="file"
                ref={fileRef}
                accept="image/*"
                multiple
                onChange={e => setBatchProgress(p => ({ ...p, total: e.target.files?.length || 0 }))}
                style={{ display: 'none' }}
              />
              <p style={{ fontSize: 32, margin: 0 }}>📂</p>
              <p style={{ color: '#94a3b8', fontSize: 14, margin: '8px 0 0' }}>
                คลิกเลือก หรือลากไฟล์มาวาง
              </p>
              <p style={{ color: '#64748b', fontSize: 12 }}>
                รองรับ JPG, PNG — เลือกได้ 1-50 ภาพพร้อมกัน
              </p>
              {fileRef.current?.files?.length > 0 && !uploading && (
                <p style={{ color: '#fbbf24', fontSize: 14, fontWeight: 700, marginTop: 8 }}>
                  📎 เลือกแล้ว {fileRef.current.files.length} ภาพ
                </p>
              )}
            </div>

            <label style={labelStyle}>หมวดหมู่ (ใช้กับทุกภาพ)</label>
            <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} style={inputStyle}>
              {['ทั่วไป','ข่าวบันเทิง','ดราม่า','ข่าวเศร้า','การเมือง','สู้ชีวิต','อาชญากรรม','กีฬา'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <button
              onClick={handleBatchUpload}
              disabled={uploading}
              style={{
                width: '100%', padding: '14px 24px', marginTop: 16,
                background: uploading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
                color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
                cursor: uploading ? 'wait' : 'pointer',
              }}
            >
              {uploading 
                ? `⏳ AI วิเคราะห์ ${batchProgress.current}/${batchProgress.total}...` 
                : '📤 อัปโหลดทั้งหมด + AI วิเคราะห์'}
            </button>

            {/* Progress Bar */}
            {uploading && batchProgress.total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ background: '#1e293b', borderRadius: 8, height: 24, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f59e0b, #22c55e)',
                    borderRadius: 8,
                    transition: 'width 0.3s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: '#000',
                  }}>
                    {batchProgress.current}/{batchProgress.total}
                  </div>
                </div>
              </div>
            )}

            {/* Batch Results */}
            {batchProgress.results.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto' }}>
                {batchProgress.results.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6, marginBottom: 4, fontSize: 12,
                    background: r.success ? '#14532d' : '#7f1d1d',
                    color: r.success ? '#86efac' : '#fca5a5',
                  }}>
                    <span>{r.success ? '✅' : '❌'} {r.name?.substring(0, 30)}</span>
                    {r.success && <span style={{ color: '#94a3b8' }}>{r.layout} | ⭐{r.score}</span>}
                  </div>
                ))}
                <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
                  ✅ สำเร็จ: {batchProgress.results.filter(r => r.success).length} | 
                  ❌ ล้มเหลว: {batchProgress.results.filter(r => !r.success).length} | 
                  📚 รวมในคลัง: {library.length + batchProgress.results.filter(r => r.success).length}
                </p>
              </div>
            )}

            <div style={{ marginTop: 24, borderTop: '1px solid #1e293b', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>ปกในคลัง ({library.length})</h3>
                <button
                  onClick={loadLibrary}
                  disabled={loadingLib}
                  style={{
                    padding: '6px 16px', background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  {loadingLib ? '...' : '🔄 โหลด'}
                </button>
              </div>

              {library.length === 0 && (
                <p style={{ color: '#64748b', fontSize: 14 }}>ยังไม่มีปกในคลัง — อัปโหลดปกตัวอย่างด้านบน</p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {library.map(cover => (
                  <div key={cover.id} style={{
                    background: '#1e293b', borderRadius: 8, padding: 8, border: '1px solid #374151',
                  }}>
                    {cover.thumbnail && (
                      <img src={cover.thumbnail} alt={cover.title} style={{
                        width: '100%', borderRadius: 6, marginBottom: 6,
                      }} />
                    )}
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                      {cover.title?.substring(0, 40)}
                    </p>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <span style={{ ...badgeStyle, fontSize: 10, padding: '2px 6px' }}>{cover.category}</span>
                      <span style={{ ...badgeStyle, fontSize: 10, padding: '2px 6px' }}>⭐{cover.quality_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginTop: 12, marginBottom: 4 };
const inputStyle = {
  width: '100%', padding: '10px 12px', background: '#1e293b', color: '#e2e8f0',
  border: '1px solid #374151', borderRadius: 8, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};
const badgeStyle = {
  display: 'inline-block', padding: '4px 10px', background: '#1e293b',
  borderRadius: 6, fontSize: 12, color: '#94a3b8', border: '1px solid #374151',
};
