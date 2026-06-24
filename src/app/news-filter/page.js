'use client';

import { useState, useCallback, useEffect } from 'react';
import AuthGuard from '@/components/AuthGuard';
import ClientLayout from '@/components/ClientLayout';

// ===== Constants =====
// ★ 19 มิ.ย. (ผู้ใช้): ตัดเหลือโหมดเดียว "เก็บครบ 🟢" (เดิมมี สมดุล/เข้มงวด — ทีมไม่ใช้)
const FILTER_MODES = [
  { key: 'soft', label: 'เก็บเนื้อครบ 🟢', color: '#22c55e', desc: 'ตัดเฉพาะคำเฟ้อ/อารมณ์/เกริ่นที่ชัดเจน เก็บข้อเท็จจริง+รายละเอียดครบ' },
];

const LABEL_COLORS = {
  FACT: '#22c55e',
  QUOTE: '#3b82f6',
  CONTEXT: '#64748b',
  FILLER: '#eab308',
  INTERPRETATION: '#f97316',
  EMOTIONAL_WRITING: '#ec4899',
  UNSUPPORTED: '#ef4444',
};

const LABEL_NAMES = {
  FACT: 'ข้อเท็จจริง',
  QUOTE: 'คำพูดโดยตรง',
  CONTEXT: 'บริบท',
  FILLER: 'คำเฟ้อ',
  INTERPRETATION: 'ตีความ',
  EMOTIONAL_WRITING: 'แต่งอารมณ์',
  UNSUPPORTED: 'ไม่มีที่มา',
};

const ACTION_CONFIG = {
  KEEP: { icon: '✅', color: '#22c55e', label: 'KEEP' },
  REMOVE: { icon: '❌', color: '#ef4444', label: 'REMOVE' },
  TRIM: { icon: '✂️', color: '#eab308', label: 'TRIM' },
};

const SAMPLE_TEXT = `มีนักแสดงไม่น้อยที่พอผลงานเบาลง ก็เลือกรอ รอโทรศัพท์ รอโอกาส รอให้วงการหันกลับมามอง แต่ แอมป์ พีรวัศ ไม่ได้ทำแบบนั้น

แอมป์ พีรวัศ อดีตพระเอกช่อง 7 เปิดเผยว่า หลังจากงานแสดงเบาลง ตัดสินใจไปขับ Grab เพื่อหารายได้เสริม โดยเริ่มขับตั้งแต่ช่วงโควิด

แอมป์เผยว่า "ผมไม่ได้อายนะครับ ขับ Grab มันก็คืองานสุจริต ได้เงินเลี้ยงครอบครัว"

ในรถคันนั้น เขาไม่ใช่พระเอก เขาแค่เป็นคนธรรมดาที่กำลังใช้ชีวิต

แอมป์เผยว่า หยุดขับ Grab แล้ว แต่ยังมีแอบไปขับอย่างอื่นบ้าง หลังไปส่งลูกที่โรงเรียน

เรื่องนี้สะท้อนให้เห็นว่า ความสำเร็จในวงการบันเทิงไม่ได้การันตีอนาคต

ปัจจุบัน แอมป์ พีรวัศ อายุ 45 ปี มีลูก 2 คน อาศัยอยู่กับครอบครัวที่กรุงเทพฯ

ชีวิตจริงไม่ได้รอใคร และบางทีความกล้าที่จะเริ่มต้นใหม่ก็คือเวอร์ชันที่ดีที่สุดของตัวเอง`;

// ===== Main Page Component =====
export default function NewsFilterPage() {
  return (
    <AuthGuard requireRole={['admin']}>
      <ClientLayout>
        <NewsFilterContent />
      </ClientLayout>
    </AuthGuard>
  );
}

// ===== Page Content =====
function NewsFilterContent() {
  // State
  const [inputText, setInputText] = useState('');
  const [outputData, setOutputData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // ★ คลังเคสสกัด (13 มิ.ย.) — ตรวจย้อนว่าตัดใจความสำคัญไปไหม
  const [casesOpen, setCasesOpen] = useState(false);
  const [cases, setCases] = useState([]);
  const [caseExpanded, setCaseExpanded] = useState(null);
  const loadCases = async () => {
    try { const r = await fetch('/api/news-filter/cases?limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setCases(d.cases || []); } catch {}
  };
  const toggleCases = () => { const n = !casesOpen; setCasesOpen(n); if (n) loadCases(); };
  const deleteCase = async (id) => { try { await fetch('/api/news-filter/cases?id=' + id, { method: 'DELETE' }); loadCases(); } catch {} };
  // ★ 19 มิ.ย. (ผู้ใช้): คลังประวัติ "แยกประเด็น" — บางข่าวทำได้หลายหัวข้อ ทีมกลับมาหยิบใช้
  const [splitsOpen, setSplitsOpen] = useState(false);
  const [splits, setSplits] = useState([]);
  const [splitExpanded, setSplitExpanded] = useState(null);
  const loadSplits = async () => {
    try { const r = await fetch('/api/news-filter/cases?type=splits&limit=40', { cache: 'no-store' }); const d = await r.json(); if (d.success) setSplits(d.cases || []); } catch {}
  };
  const toggleSplits = () => { const n = !splitsOpen; setSplitsOpen(n); if (n) loadSplits(); };
  // ★ 19 มิ.ย. (ผู้ใช้): สถานะคิวเรียลไทม์ — พนักงานหลายคนใช้ เห็นว่ากำลังทำกี่/รอกี่
  const [queue, setQueue] = useState({ processing: 0, queued: 0 });
  useEffect(() => {
    let on = true;
    const tick = async () => {
      try { const r = await fetch('/api/news-filter/queue', { cache: 'no-store' }); const d = await r.json(); if (on && d.success) setQueue({ processing: d.processing || 0, queued: d.queued || 0 }); } catch {}
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { on = false; clearInterval(iv); };
  }, []);
  // ★ 19 มิ.ย. (ผู้ใช้): ชื่อผู้ใช้ (ไม่มีรหัสผ่าน) — กำกับว่าใครส่งเจน เพื่อตรวจงานถูก (ใช้ key เดียวกับโต๊ะข่าว)
  const [me, setMe] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false); // ★ อ่าน localStorage เสร็จยัง (กันแฟลชประตูชื่อ)
  const [nameInput, setNameInput] = useState('');      // ★ ช่องกรอกชื่อในประตู
  useEffect(() => { setMe(localStorage.getItem('desk_username') || ''); setNameLoaded(true); }, []);
  const submitName = () => {
    const n = (nameInput || '').trim();
    if (n.length < 2) { alert('กรุณาใส่ชื่ออย่างน้อย 2 ตัวอักษร'); return; }
    localStorage.setItem('desk_username', n); setMe(n);
  };
  const ensureName = () => {
    let name = localStorage.getItem('desk_username');
    if (!name) {
      name = (prompt('ใส่ชื่อของคุณ (ใช้กำกับว่าใครส่งเจนข่าว — ไม่ต้องมีรหัสผ่าน):') || '').trim();
      if (name) { localStorage.setItem('desk_username', name); setMe(name); }
    }
    return name;
  };
  const changeName = () => {
    const name = (prompt('เปลี่ยนชื่อผู้ใช้:', me) || '').trim();
    if (name) { localStorage.setItem('desk_username', name); setMe(name); }
  };
  const [mode, setMode] = useState('soft'); // ★ 19 มิ.ย. เหลือโหมดเดียว เก็บครบ
  const [options, setOptions] = useState({
    keepQuotes: true,
    keepContext: true,
    removeEmotional: true,
    removeUnsupported: true,
    useAI: true, // ★ 13 มิ.ย.: ค่าเริ่มต้น = AI สกัดข้อเท็จจริงดิบ (เขียนใหม่เหลือแก่น) — ตรงเป้าทีม
  });
  const [expandedRows, setExpandedRows] = useState({});
  const [copySuccess, setCopySuccess] = useState(false);
  // ★ 16 มิ.ย.: แยกประเด็นย่อย — ข่าว/สัมภาษณ์ที่ยัดหลายเรื่องรวมกัน
  const [splitData, setSplitData] = useState(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const [copiedTopic, setCopiedTopic] = useState(null);
  const [sendingTopic, setSendingTopic] = useState(null);
  // URL scraping state
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeStep, setScrapeStep] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [autoFilter, setAutoFilter] = useState(true); // auto-filter after scrape
  const [showGuide, setShowGuide] = useState(false); // usage guide toggle
  // ★ 19 มิ.ย. (ผู้ใช้สั่งแก้มือถือ): responsive — จอแคบ <768px สลับเป็นคอลัมน์เดียว กันเฟรมขวาลน
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Word count helper
  const countWords = useCallback((text) => {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, []);

  const inputWordCount = countWords(inputText);

  // Toggle option
  const toggleOption = (key) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Toggle expanded row
  const toggleRow = (index) => {
    setExpandedRows(prev => ({ ...prev, [index]: !prev[index] }));
  };

  // Load sample text
  const loadSample = () => {
    setInputText(SAMPLE_TEXT);
    setOutputData(null);
    setError(null);
    setSourceUrl('');
  };

  // Clear all
  const handleClear = () => {
    setInputText('');
    setOutputData(null);
    setError(null);
    setExpandedRows({});
    setSourceUrl('');
    setScrapeStep('');
    setSplitData(null);
  };

  // ★ 16 มิ.ย.: แยกเนื้อแก่นออกเป็นประเด็นย่อย (เรียก /api/news-filter/split)
  const handleSplitTopics = async () => {
    if (!outputData?.cleanText || splitLoading) return;
    setSplitLoading(true);
    setSplitData(null);
    setError(null);
    try {
      const res = await fetch('/api/news-filter/split', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: outputData.cleanText }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || 'แยกประเด็นไม่สำเร็จ');
      setSplitData(d.data);
    } catch (e) { setError('❌ แยกประเด็นไม่สำเร็จ: ' + e.message); }
    setSplitLoading(false);
  };

  // คัดลอกท่อนเนื้อดิบของประเด็นเดียว
  const copyTopic = async (t) => {
    try { await navigator.clipboard.writeText(t.content); setCopiedTopic(t.id); setTimeout(() => setCopiedTopic(null), 2000); }
    catch { const ta = document.createElement('textarea'); ta.value = t.content; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); setCopiedTopic(t.id); setTimeout(() => setCopiedTopic(null), 2000); }
  };

  // ส่งประเด็นเดียวเข้าคิวเขียน (เหมือนปุ่มส่งแก่น แต่ส่งเฉพาะประเด็นนี้)
  const sendTopicToWorkflow = async (t) => {
    if (sendingTopic) return;
    const name = ensureName();
    if (!name) { alert('กรุณาใส่ชื่อก่อนส่งเจน (กำกับว่าใครเป็นคนส่ง)'); return; }
    setSendingTopic(t.id);
    try {
      // ★ แก้รูปให้แบน (เดิมห่อ payload → queue/add อ่านไม่เจอ input) + ติดชื่อผู้ส่ง
      const res = await fetch('/api/queue/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: t.content, contentLength: 'short', userId: `news-filter-${name}`, deskMeta: { editor: name, editorIcon: '👤', source: 'แยกประเด็น', category: '', lane: 'news-filter' } }),
      });
      const d = await res.json();
      if (d.success) alert(`✅ ส่งประเด็น "${t.title}" เข้าคิวเขียนแล้ว (โดย ${name}) — ดูผลที่ Generation Log / แท็บพร้อมใช้`);
      else alert('❌ ส่งไม่สำเร็จ: ' + (d.error || 'ไม่ทราบสาเหตุ'));
    } catch (e) { alert('❌ ' + e.message); }
    setSendingTopic(null);
  };

  // URL Detection
  const detectedUrl = inputText.trim().match(/^https?:\/\/\S+$/)?.[0] || '';
  const hasUrlInInput = /https?:\/\/\S+/.test(inputText.trim());
  // ★ 24 มิ.ย. (ผู้ใช้): ปิดสกัดจากลิงก์ชั่วคราว — รับเฉพาะข้อความคุณภาพที่ก๊อปมาวาง (ลิงก์ต้นทางคุณภาพไม่แน่นอน สกัดไม่ได้)
  const URL_SCRAPE_DISABLED = true;
  const isUrlOnly = URL_SCRAPE_DISABLED ? false : !!detectedUrl;

  // === URL Scrape Handler ===
  const handleScrapeUrl = async (urlToScrape) => {
    const targetUrl = urlToScrape || detectedUrl;
    if (!targetUrl) return;

    setScrapeLoading(true);
    setScrapeStep('🔍 กำลังเชื่อมต่อ...');
    setError(null);
    setOutputData(null);
    setSourceUrl(targetUrl);

    try {
      // Step 1: Scrape raw content
      // ★ 21 มิ.ย.: ใช้ /api/news-filter/scrape (Firecrawl onlyMainContent ดึงเฉพาะเนื้อบทความ ตัดเมนู/โฆษณา)
      //   แยกเดี่ยวจาก /api/extract (เวิร์กโฟลว์ทำข่าว 🔴 ห้ามแตะ) — แก้เคส amarintv ที่ได้แต่เมนู+พาดหัว
      setScrapeStep('📡 กำลังดึงเนื้อหาจากเว็บ...');
      const scrapeRes = await fetch('/api/news-filter/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const scrapeData = await scrapeRes.json();

      if (!scrapeData.success && !scrapeData.data?.text) {
        throw new Error(scrapeData.error || 'ไม่สามารถดึงเนื้อหาจาก URL ได้');
      }

      // Step 2: Extract & deep-clean news content
      // Extract API returns { data: { text, title, ... } }
      setScrapeStep('⚙️ กำลังแยกเนื้อหาข่าว...');
      const rawContent = scrapeData.data?.text || scrapeData.text || scrapeData.data?.content || '';
      const rawTitle = scrapeData.data?.title || scrapeData.title || '';

      // === DEEP CLEANING: กำจัดขยะจากเว็บข่าวไทย ===
      
      // Phase 0: Cut everything after "ข่าวที่เกี่ยวข้อง" section
      // (ข่าวแนะนำ, cookie consent, footer ทั้งหมดอยู่หลังนี้)
      let cleaned = rawContent;
      const relatedCutPatterns = [
        /ข่าวที่เกี่ยวข้อง/i,
        /ข่าวที่เกียวข้อง/i,  // typo variant
        /บทความที่เกี่ยวข้อง/i,
        /เรื่องที่น่าสนใจ/i,
        /ข่าวแนะนำ/i,
        /อ่านข่าวเพิ่มเติม/i,
        /คุณอาจสนใจ/i,
      ];
      for (const pattern of relatedCutPatterns) {
        const match = cleaned.match(pattern);
        if (match) {
          cleaned = cleaned.slice(0, match.index);
          break;
        }
      }

      // Phase 1: Strip markdown formatting
      cleaned = cleaned
        .replace(/!\[.*?\]\(.*?\)/g, '')      // remove images
        .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // keep link text only
        .replace(/#{1,6}\s*/g, '')             // remove markdown headers
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // remove bold/italic but keep text
        .replace(/`([^`]+)`/g, '$1')           // remove inline code
        .replace(/```[\s\S]*?```/g, '')        // remove code blocks
        .replace(/\|.*\|/g, '')                // remove tables
        .replace(/^---+$/gm, '')               // remove horizontal rules
        .replace(/https?:\/\/\S+/g, '')        // remove URLs
        .replace(/^>\s*/gm, '')                // remove blockquotes
        .replace(/\S+@\S+\.\S+/g, '')         // remove email addresses

      // Phase 2: Split into lines and filter junk
      const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
      
      // Thai news site navigation/junk patterns
      const JUNK_PATTERNS = [
        // Navigation menus
        /^(หน้าแรก|หน้าหลัก|Home|Menu|เมนู)$/i,
        /^(ข่าว|บันเทิง|กีฬา|เศรษฐกิจ|การเมือง|ต่างประเทศ|เทคโนโลยี|ไลฟ์สไตล์|อาชญากรรม|ภูมิภาค)$/,
        /^(ดูดวง|ละคร|ซีรีส์|คลิป|วิดีโอ|กระทู้|ฟอรัม|เกม|ผลบอล|ตารางบอล)$/,
        // Honkrasae / channel navigation
        /^โหน/,  // โหนทุกข่าว, โหนบันเทิง, โหนร้องทุกข์, โหนไบบู
        /^(ข่าวกำลังโหน|ข่าวโซเชียล|ข่าวฮิต|ข่าวเด่น|ข่าวด่วน|ข่าวล่าสุด)$/,
        // Show promos — "มาร่วมตีแผ่กระแส", "รายการโหนกระแส"
        /มาร่วมตีแผ่กระแส/,
        /รายการโหนกระแส/,
        /กับรายการ/,
        // Contact / channel / footer
        /^ติดต่อ(เรา|โฆษณา|ลงโฆษณา)/,
        /^ติดตาม(เรา|ได้ที่)/,
        /^เกี่ยวกับเรา/,
        /^ช่อง\s*\d+\s*(กด)?\s*\d*/,
        /^\(\s*\(*\s*\)*\s*\)$/, // ((((
        /^[\(\)]+$/,
        // Social & sharing
        /^(Share|Tweet|Pin|Line|ส่งต่อ|แชร์|กดแชร์|กดไลค์|Like|Follow|Subscribe)/i,
        /^(Facebook|Instagram|Twitter|TikTok|YouTube|LINE|Blockdit|Pantip)$/i,
        /^(Copy link|คัดลอกลิงก์|พิมพ์|Print|อ่านเพิ่มเติม|Read more)/i,
        // Tags / categories
        /^(แท็ก|Tags?|หมวดหมู่|Category|ป้ายกำกับ|Label)s?\s*:?\s*/i,
        /^(ข่าวที่เกี่ยวข้อง|ข่าวที่เกียวข้อง|Related|บทความที่เกี่ยวข้อง)/i,
        /^(แนะนำ|Recommended|Popular|ยอดนิยม|อ่านมากสุด|ข่าวยอดฮิต)/i,
        // Ads
        /^(Advertisement|โฆษณา|Sponsored|Ad|Ads|ป้ายโฆษณา|PR\s*News)/i,
        /^(สนับสนุนโดย|Presented by|Powered by)/i,
        // Cookie consent
        /คุกกี้/,
        /^ยอมรับทั้งหมด/,
        /cookie/i,
        // Copyright / legal
        /^(Copyright|©|สงวนลิขสิทธิ์|ลิขสิทธิ์|All rights? reserved)/i,
        /^(เงื่อนไข|นโยบาย|Privacy|Terms|Disclaimer|ข้อกำหนด)/i,
        /เกี่ยวกับเราข้อกำหนด/,
        // Company address
        /^เลขที่\s*\d+/,
        /อาคาร.*ทาวเวอร์/,
        /แขวง.*เขต/,
        /กรุงเทพ(ฯ|มหานคร)?.*\d{5}/,
        // Schedule
        /^วัน(จันทร์|อังคาร|อาทิตย์|เสาร์).*เวลา/,
        /^วันจันทร์\s*(ถึง|-).*วันศุกร์/,
        // App download prompts
        /^(ดาวน์โหลด|Download|โหลดแอป|App Store|Google Play|อ่านต่อบน)/i,
        // Timestamps / dates alone (abbreviated)
        /^\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{2,4}$/,
        // Timestamps / dates alone (full month name)
        /^\d{1,2}\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}\d*$/,
        /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
        // Reporter/source credits alone
        /^(ขอบคุณ|ที่มา|แหล่งที่มา|Source|Credit|ภาพจาก|ภาพ:)(\s|:)/i,
        // Misc junk
        /^(Loading|กำลังโหลด|\.{3,}|…{2,})$/i,
        /^(\d+\s*(views?|ครั้ง|shares?|likes?|comments?|ความคิดเห็น))$/i,
      ];

      // Filter lines
      const cleanLines = lines.filter(line => {
        // Skip empty or very short lines (< 12 chars = likely nav items)
        if (line.length < 12) return false;
        
        // Skip lines matching junk patterns
        if (JUNK_PATTERNS.some(p => p.test(line))) return false;
        
        // Skip lines that are just numbers
        if (/^\d+$/.test(line)) return false;
        
        // Skip lines that are just punctuation/symbols
        if (/^[\s\-_=.,:;!?()[\]{}|\/\\@#$%^&*~`'"<>]+$/.test(line)) return false;
        
        // Skip lines that look like menu items (short + no verb/content)
        if (line.length < 25 && !/[ก-๙]{4,}/.test(line)) return false;

        // Skip tags: mixed Thai+English concatenated without spaces (e.g. "ทองใหม่Theshockเดอะช็อค")
        if (/[ก-๙][A-Za-z]/.test(line) && /[A-Za-z][ก-๙]/.test(line) && line.length < 80 && !/\s/.test(line.slice(0, 40))) return false;

        // Skip email-only lines
        if (/^\S+@\S+\.\S+$/.test(line)) return false;
        
        return true;
      });

      // Phase 3: Remove duplicate lines (keep first occurrence)
      const seen = new Set();
      const uniqueLines = cleanLines.filter(line => {
        const normalized = line.replace(/\s+/g, ' ').trim();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });

      // Phase 4: Remove title from body if duplicated
      const bodyLines = rawTitle
        ? uniqueLines.filter(line => {
            const similarity = line.length > 20 && rawTitle.includes(line.slice(0, 30));
            return !similarity;
          })
        : uniqueLines;

      const cleanedContent = bodyLines.join('\n\n');

      // Add title at top if available
      const finalText = rawTitle 
        ? `${rawTitle}\n\n${cleanedContent}`
        : cleanedContent;

      if (finalText.length < 30) {
        throw new Error('เนื้อหาที่ดึงได้สั้นเกินไป ลองวาง URL อื่น');
      }

      setScrapeStep('✅ ดึงเนื้อหาสำเร็จ!');
      setInputText(finalText);

      // Step 3: Auto-filter if enabled
      if (autoFilter) {
        setScrapeStep('🔬 กำลังกรองเนื้อหาอัตโนมัติ...');
        // Small delay to show the text first
        await new Promise(r => setTimeout(r, 300));
        setScrapeLoading(false);
        // Trigger analysis
        await handleAnalyzeWithText(finalText);
      } else {
        setScrapeLoading(false);
      }

    } catch (err) {
      setError(`❌ ${err.message}`);
      setScrapeLoading(false);
      setScrapeStep('');
    }
  };

  // Analyze — calls POST /api/news-filter
  const doAnalyze = async (textToAnalyze) => {
    const text = textToAnalyze || inputText;
    if (!text.trim()) return;
    // ★ 24 มิ.ย.: ปิดสกัดจากลิงก์ — ถ้าวางเป็น URL ล้วน ให้แจ้งเตือนให้ก๊อปเนื้อข่าวมาวางแทน
    if (URL_SCRAPE_DISABLED && /^https?:\/\/\S+$/.test(text.trim())) {
      setError('🔗 ปิดการสกัดจากลิงก์ชั่วคราว — กรุณาก๊อป "เนื้อข่าว" มาวางเป็นข้อความแทน (ลิงก์ต้นทางคุณภาพไม่แน่นอน สกัดไม่ครบ)');
      return;
    }
    setLoading(true);
    setError(null);
    setOutputData(null);
    setExpandedRows({});
    setSplitData(null); // ★ ล้างผลแยกประเด็นเก่าเมื่อวิเคราะห์ใหม่

    try {
      const res = await fetch('/api/news-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode,
          useAI: options.useAI, // ★ ต้องอยู่ระดับบนสุด — API อ่าน useAI จาก body.useAI (เดิมส่งใน options API เลยได้ false เสมอ → ตกไป regex)
          options: {
            keepQuotes: options.keepQuotes,
            keepContext: options.keepContext,
            removeEmotional: options.removeEmotional,
            removeUnsupported: options.removeUnsupported,
            removeInterpretation: options.removeUnsupported, // map ชื่อให้ตรงกับที่ service ใช้
          },
        }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error(res.status >= 500 ? 'ระบบประมวลผลไม่ทัน/ขัดข้องชั่วคราว — กด "วิเคราะห์" ใหม่อีกครั้งได้เลย' : 'ตอบกลับผิดรูปแบบ — ลองใหม่อีกครั้ง'); }
      if (!data.success) {
        throw new Error(data.error || 'เกิดข้อผิดพลาดในการวิเคราะห์');
      }
      // API returns { success, data: { cleanText, sentenceAnalysis, ... } }
      // UI reads outputData.cleanText, outputData.analysis
      const result = data.data || data;
      setOutputData({
        cleanText: result.cleanText || '',
        analysis: result.sentenceAnalysis || result.analysis || [],
        removedPatterns: result.removedPatterns || [],
        originalWordCount: result.originalWordCount || 0,
        cleanWordCount: result.cleanWordCount || 0,
        removedPercent: result.removedPercent || 0,
        mode: result.mode,
      });
    } catch (err) {
      setError(err.message || 'ไม่สามารถเชื่อมต่อ API ได้');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = () => doAnalyze(inputText);
  const handleAnalyzeWithText = (text) => doAnalyze(text);

  // Copy clean text
  const handleCopy = async () => {
    if (!outputData?.cleanText) return;
    try {
      await navigator.clipboard.writeText(outputData.cleanText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = outputData.cleanText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // ★ ส่งแก่นข้อเท็จจริงเข้าไลน์เจน (13 มิ.ย.) — ผ่านคิวเดียวกับ Discord (same-origin ไม่ต้อง auth)
  const [sendingWf, setSendingWf] = useState(false);
  const handleSendToWorkflow = async () => {
    if (!outputData?.cleanText || sendingWf) return;
    const name = ensureName();
    if (!name) { alert('กรุณาใส่ชื่อก่อนส่งเจน (กำกับว่าใครเป็นคนส่ง)'); return; }
    setSendingWf(true);
    try {
      // ★ แก้รูปให้แบน + ติดชื่อผู้ส่ง (deskMeta.editor → โชว์ใน Generation Log)
      const res = await fetch('/api/queue/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: outputData.cleanText, contentLength: 'short', userId: `news-filter-${name}`, deskMeta: { editor: name, editorIcon: '👤', source: 'สกัดข่าว', category: '', lane: 'news-filter' } }),
      });
      const d = await res.json();
      if (d.success) { setCopySuccess(true); setTimeout(() => setCopySuccess(false), 4000); alert(`✅ ส่งแก่นข่าวเข้าคิวเขียนแล้ว (โดย ${name}) — ไปดูผลที่ Generation Log / แท็บพร้อมใช้`); }
      else alert('❌ ส่งไม่สำเร็จ: ' + (d.error || 'ไม่ทราบสาเหตุ'));
    } catch (e) { alert('❌ ' + e.message); }
    setSendingWf(false);
  };

  // Export TXT
  const handleExport = () => {
    if (!outputData?.cleanText) return;
    const blob = new Blob([outputData.cleanText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `news-filtered-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Computed stats
  const cleanWordCount = outputData ? countWords(outputData.cleanText) : 0;
  const removedPercent = inputWordCount > 0 && outputData
    ? Math.round(((inputWordCount - cleanWordCount) / inputWordCount) * 100)
    : 0;
  const mostRemovedPattern = outputData?.analysis
    ? (() => {
        const counts = {};
        outputData.analysis.forEach(s => {
          if (s.action === 'REMOVE' || s.action === 'TRIM') {
            counts[s.label] = (counts[s.label] || 0) + 1;
          }
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return sorted.length > 0 ? LABEL_NAMES[sorted[0][0]] || sorted[0][0] : '-';
      })()
    : '-';

  // ★ ประตูกรอกชื่อ (ผู้ใช้สั่ง 21 มิ.ย.: บังคับใส่ชื่อก่อนใช้งาน) — ไม่มีชื่อ = ใช้ไม่ได้
  if (!nameLoaded) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary, #0d0d1a)' }}>
        <div style={{ color: '#888', fontSize: 13 }}>⚡ กำลังโหลด...</div>
      </div>
    );
  }
  if (!me) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 420, padding: 40, borderRadius: 20,
          background: 'rgba(26,26,46,0.85)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>✍️</div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 8px', color: '#fff' }}>ใส่ชื่อของคุณก่อนเริ่มใช้งาน</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 22px' }}>
            ใช้กำกับว่าใครเป็นคนส่งเจนข่าว (ไม่ต้องมีรหัสผ่าน)
          </p>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitName(); }}
            placeholder="เช่น สมชาย, น้องเอ, ทีมข่าว A"
            autoFocus
            style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 15, fontFamily: 'inherit', marginBottom: 16, outline: 'none', boxSizing: 'border-box' }}
          />
          <button onClick={submitName}
            style={{ width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #f91880, #7c3aed)', color: '#fff', fontSize: 15, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 25px rgba(249,24,128,0.3)' }}>
            🚀 เริ่มใช้งาน
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>

      {/* ===== HEADER ===== */}
      <div style={{
        padding: '28px 32px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.04), rgba(59,130,246,0.04))',
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{
              margin: 0, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              🔬 กรองแก่นข่าว (สกัดเนื้อข่าว)
            </h1>
            <button
              onClick={() => setShowGuide(!showGuide)}
              style={{
                padding: '8px 16px', borderRadius: 10,
                border: `1px solid ${showGuide ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                background: showGuide
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))'
                  : 'rgba(255,255,255,0.04)',
                color: showGuide ? '#818cf8' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.3s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => {
                if (!showGuide) {
                  e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                  e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                  e.currentTarget.style.color = '#818cf8';
                }
              }}
              onMouseLeave={e => {
                if (!showGuide) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {showGuide ? '✕ ปิดคู่มือ' : '❓ วิธีใช้งาน'}
            </button>
          </div>
          <p style={{
            margin: '6px 0 0', fontSize: 13,
            color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            ✍️ สรุปใจความข่าวมาก่อน แล้ววางเป็นข้อความ → ระบบกรองให้เหลือเฉพาะ &quot;แก่นข้อเท็จจริง&quot; ตัดคำเฟ้อ คำตีความ คำแต่งอารมณ์ออก (ห้ามก๊อปเนื้อเต็มจากเว็บ · ปิดสกัดลิงก์ชั่วคราว)
          </p>
        </div>
      </div>

      {/* ===== USAGE GUIDE PANEL ===== */}
      {showGuide && (
        <div style={{
          maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 14px' : '0 32px',
          animation: 'fadeUp 0.3s ease-out both',
        }}>
          <div style={{
            marginTop: 20, padding: 28, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05))',
            border: '1px solid rgba(99,102,241,0.15)',
          }}>
            {/* Guide Title */}
            <div style={{
              fontSize: 18, fontWeight: 800, color: 'var(--text-primary)',
              marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              📖 วิธีใช้งาน (How-to ทีละขั้น) — กรองแก่นข่าว → แยกประเด็น → ส่งเจน
            </div>

            {/* Two usage modes */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 24 }}>
              {/* Mode 1: URL */}
              <div style={{
                padding: 20, borderRadius: 14,
                background: 'rgba(59,130,246,0.06)',
                border: '1px solid rgba(59,130,246,0.15)',
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#3b82f6', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  🌐 แบบที่ 1: วาง URL ข่าว
                </div>
                {[
                  { step: '1', text: 'วาง URL ข่าวลงในช่องข้อความ', icon: '📋' },
                  { step: '2', text: 'ระบบตรวจพบ URL อัตโนมัติ → แสดงแถบสีน้ำเงิน', icon: '🌐' },
                  { step: '3', text: 'กดปุ่ม "📡 ดึงเนื้อหา + กรอง"', icon: '🔘' },
                  { step: '4', text: 'ระบบดึงเนื้อข่าว → ลบขยะ (ads, nav, footer)', icon: '🧹' },
                  { step: '5', text: 'กรองอัตโนมัติ → แสดงผลลัพธ์ฝั่งขวา', icon: '✨' },
                ].map(s => (
                  <div key={s.step} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 0', borderBottom: '1px solid rgba(59,130,246,0.08)',
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: 'rgba(59,130,246,0.15)', color: '#3b82f6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, flexShrink: 0,
                    }}>{s.step}</div>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {s.icon} {s.text}
                    </span>
                  </div>
                ))}
                <div style={{
                  marginTop: 12, padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(59,130,246,0.08)', fontSize: 11, color: '#60a5fa',
                }}>
                  💡 รองรับ: Thairath, Khaosod, Matichon, Sanook, ThaiPBS และเว็บข่าวทั่วไป
                </div>
              </div>

              {/* Mode 2: Text */}
              <div style={{
                padding: 20, borderRadius: 14,
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.15)',
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#22c55e', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  📝 แบบที่ 2: วางข้อความข่าว
                </div>
                {[
                  { step: '1', text: 'Copy เนื้อข่าวจากเว็บไซต์ มาวางในช่องซ้าย', icon: '📋' },
                  { step: '2', text: 'กดปุ่ม "🔬 วิเคราะห์" (โหมดเก็บเนื้อครบ 🟢 ตั้งไว้แล้ว ไม่ต้องเลือก)', icon: '🔘' },
                  { step: '3', text: 'ได้ "แก่นข่าว" ฝั่งขวา — ตัดคำเฟ้อ/อารมณ์ เหลือข้อเท็จจริงครบ', icon: '✨' },
                  { step: '4', text: 'Copy / Export TXT / หรือกด 🧩 แยกประเด็นต่อได้', icon: '➡️' },
                ].map(s => (
                  <div key={s.step} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 0', borderBottom: '1px solid rgba(34,197,94,0.08)',
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, flexShrink: 0,
                    }}>{s.step}</div>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {s.icon} {s.text}
                    </span>
                  </div>
                ))}
                <div style={{
                  marginTop: 12, padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(34,197,94,0.08)', fontSize: 11, color: '#4ade80',
                }}>
                  💡 กดปุ่ม "📰 ตัวอย่าง" เพื่อลองใช้งานกับข่าวตัวอย่าง
                </div>
              </div>
            </div>

            {/* Filter modes explanation */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 14, fontWeight: 800, color: 'var(--text-primary)',
                marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                🎛️ อธิบายโหมดกรอง
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                {[
                  { mode: 'เก็บเนื้อครบ 🟢', color: '#22c55e', desc: 'ตัดเฉพาะคำเฟ้อ/อารมณ์/เกริ่นที่ชัดเจน (เช่น "สร้างความฮือฮา" "กลายเป็นกระแส" "สุดสะเทือนใจ") เก็บข้อเท็จจริง+ชื่อ+ตัวเลข+รายละเอียดครบ พร้อมเอาไปแยกประเด็น/ส่งเจนต่อ' },
                ].map(m => (
                  <div key={m.mode} style={{
                    padding: 14, borderRadius: 12,
                    background: `${m.color}08`, border: `1px solid ${m.color}20`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: m.color, marginBottom: 6 }}>{m.mode}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ★ 19 มิ.ย.: ขั้นต่อไป — แยกประเด็น + จุดตัดสินใจสำคัญ */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                🧩 ขั้นที่ 3: แยกประเด็น (ทำเมื่อข่าวเล่าได้หลายมุม)
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.85, marginBottom: 14 }}>
                ได้ "แก่นข่าว" ฝั่งขวาแล้ว ถ้าข่าวนั้นพูดหลายเรื่องในชิ้นเดียว (เช่น ความรัก + การเงิน + ครอบครัว) ให้กดปุ่ม
                <span style={{ display: 'inline-block', margin: '0 5px', padding: '4px 11px', borderRadius: 8, background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', fontWeight: 800, fontSize: 12 }}>🧩 แยกประเด็นให้หน่อย</span>
                — ระบบจะจัดเป็น "มุมขาย" ที่เล่าจบในตัว (แต่ละมุม = ทำได้ 1 โพสต์ มีที่มาที่ไปครบ)
              </div>
              {/* กล่องตัดสินใจ — สำคัญสุด */}
              <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginBottom: 8 }}>⚠️ จุดสำคัญ — แยกเสร็จแล้วทำต่อยังไง:</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e', marginBottom: 6 }}>🟢 ถ้าแยกแล้ว "ไม่มีประเด็นย่อย"</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.75 }}>(ระบบบอกว่าเป็นเรื่องเดียวจบในตัว) → <strong style={{ color: '#22c55e' }}>เอา "แก่นข่าว" ที่สกัดได้ ส่งเจนได้เลย</strong> ไม่ต้องเลือกมุม — กด 📤 ส่งเข้า Workflow ที่กล่องแก่นข่าวฝั่งขวา</div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.35)' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#3b82f6', marginBottom: 6 }}>🔵 ถ้าแยกแล้ว "ได้หลายมุม"</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.75 }}>→ <strong style={{ color: '#3b82f6' }}>เลือกมุมที่อยากทำ</strong> แล้วกด 📤 ส่งเข้า Workflow "เฉพาะมุมนั้น" (ข่าวเดียวแยกได้หลายโพสต์ ทำทีละมุม)</div>
                </div>
              </div>
            </div>

            {/* ★ 19 มิ.ย.: ขั้นที่ 4 — ส่งเจน + ใส่ชื่อ + ตรวจงาน */}
            <div style={{ marginTop: 18, padding: '16px 18px', borderRadius: 12, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#f59e0b', marginBottom: 10 }}>📤 ขั้นที่ 4: ส่งเจน + ตรวจงานถูกคน</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 2 }}>
                <strong style={{ color: 'var(--text-primary)' }}>1.</strong> ครั้งแรกกด <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700, fontSize: 11.5 }}>👤 ใส่ชื่อผู้ใช้</span> (มุมขวาบนของแถบสถานะ) ใส่ชื่อตัวเอง — <strong>ไม่ต้องมีรหัสผ่าน</strong> ใช้กำกับว่าใครเจน<br />
                <strong style={{ color: 'var(--text-primary)' }}>2.</strong> กด <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 700, fontSize: 11.5 }}>📤 ส่งเข้า Workflow</span> (แก่นข่าว หรือ มุมที่เลือก) → เข้าคิวให้ AI เขียนข่าว<br />
                <strong style={{ color: 'var(--text-primary)' }}>3.</strong> ไปดูผลที่ <strong style={{ color: '#a855f7' }}>Generation Log</strong> หรือโต๊ะข่าวแท็บ <strong style={{ color: '#22c55e' }}>✅ พร้อมใช้</strong> — จะขึ้น <strong style={{ color: '#f59e0b' }}>"👤 ชื่อคุณ"</strong> กำกับว่าใครเจน → หัวหน้าตรวจงานถูกคน<br />
                <strong style={{ color: 'var(--text-primary)' }}>4.</strong> มุมที่เคยแยกไว้ หยิบกลับมาใช้ซ้ำได้ที่ <strong style={{ color: '#a855f7' }}>🧩 คลังประวัติแยกประเด็น</strong> (ปุ่มล่างสุดของหน้า)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px 14px 48px' : '24px 32px 60px' }}>

        {/* ★ 19 มิ.ย. (ผู้ใช้): แถบสถานะคิวสกัด เรียลไทม์ — พนักงานหลายคนเห็นว่าระบบว่าง/ยุ่ง */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: '10px 16px', borderRadius: 12, background: (queue.processing + queue.queued) > 0 ? 'rgba(34,197,94,0.08)' : 'var(--bg-card)', border: '1px solid ' + ((queue.processing + queue.queued) > 0 ? 'rgba(34,197,94,0.3)' : 'var(--border)') }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>📊 สถานะคิวสกัด (เรียลไทม์):</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: queue.processing > 0 ? '#22c55e' : 'var(--text-muted)' }}>🟢 กำลังสกัด {queue.processing}</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: queue.queued > 0 ? '#f59e0b' : 'var(--text-muted)' }}>⏳ รอคิว {queue.queued}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(queue.processing + queue.queued) === 0 ? '— ระบบว่าง พร้อมใช้ทันที' : 'ทำพร้อมกันได้ 3 งาน ถ้าเต็มจะต่อคิวอัตโนมัติ'}</span>
          <div style={{ flex: 1 }} />
          <button onClick={me ? changeName : ensureName}
            style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid ' + (me ? 'rgba(99,102,241,0.4)' : 'rgba(245,158,11,0.5)'), background: me ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.12)', color: me ? '#818cf8' : '#f59e0b', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            👤 {me ? `${me} (เปลี่ยนชื่อ)` : 'ใส่ชื่อผู้ใช้ก่อนส่งเจน'}
          </button>
        </div>

        {/* 2-Column Layout (มือถือ = คอลัมน์เดียว กันเฟรมขวาลน) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: isMobile ? 16 : 24,
          marginBottom: 24,
        }}>
          {/* ===== LEFT PANEL (Input) ===== */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: isMobile ? 16 : 24,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Panel Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                ✍️ วางสรุปใจความข่าว
              </h2>
              <button
                onClick={loadSample}
                style={{
                  padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                📰 ตัวอย่าง
              </button>
            </div>

            {/* URL Detection Bar */}
            {(isUrlOnly || scrapeLoading) && (
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: scrapeLoading
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))'
                  : 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(59,130,246,0.06))',
                border: `1px solid ${scrapeLoading ? 'rgba(59,130,246,0.25)' : 'rgba(34,197,94,0.2)'}`,
                transition: 'all 0.3s',
              }}>
                {scrapeLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 20, height: 20, border: '3px solid rgba(59,130,246,0.2)',
                      borderTopColor: '#3b82f6', borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>
                        {scrapeStep}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {sourceUrl.slice(0, 60)}{sourceUrl.length > 60 ? '...' : ''}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>🌐</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          ตรวจพบ URL — พร้อมดึงเนื้อหา
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {detectedUrl.slice(0, 60)}{detectedUrl.length > 60 ? '...' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer',
                      }}>
                        <input
                          type="checkbox"
                          checked={autoFilter}
                          onChange={e => setAutoFilter(e.target.checked)}
                          style={{ accentColor: '#22c55e', width: 14, height: 14 }}
                        />
                        กรองอัตโนมัติ
                      </label>
                      <button
                        onClick={() => handleScrapeUrl()}
                        style={{
                          padding: '8px 18px', borderRadius: 10, border: 'none',
                          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                          color: '#fff', fontSize: 12, fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'inherit',
                          boxShadow: '0 3px 10px rgba(59,130,246,0.3)',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        📡 ดึงเนื้อหา
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Source URL indicator (after scrape) */}
            {sourceUrl && !scrapeLoading && !isUrlOnly && (
              <div style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.15)',
                fontSize: 11, color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>✅</span>
                <span>ดึงจาก: <strong style={{ color: '#22c55e' }}>{sourceUrl.slice(0, 70)}{sourceUrl.length > 70 ? '...' : ''}</strong></span>
              </div>
            )}

            {/* ★ 24 มิ.ย.: ย้ำกฎสำคัญ — สรุปก่อนวาง ห้ามก๊อปเนื้อเต็ม */}
            <div style={{
              marginBottom: 10, padding: '10px 14px', borderRadius: 10,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              fontSize: 12.5, color: '#ef4444', fontWeight: 700, lineHeight: 1.6,
            }}>
              🔴 ต้อง &quot;สรุปใจความข่าว&quot; มาก่อนเท่านั้น แล้วค่อยวาง — ⛔ ห้ามก๊อปเนื้อข่าวเต็มๆ จากเว็บมาวาง (จะได้เนื้อกากๆ ไม่มีคุณภาพ)
            </div>

            {/* Textarea */}
            <textarea
              value={inputText}
              onChange={e => { setInputText(e.target.value); setSourceUrl(''); }}
              placeholder="✍️ สรุปใจความข่าวก่อน แล้ววาง 'สรุป' ที่นี่&#10;&#10;🔴 สำคัญสุด: ต้องสรุปใจความข่าวมาก่อนเท่านั้น&#10;⛔ ห้ามก๊อปเนื้อข่าวเต็มๆ จากเว็บมาวาง — จะได้เนื้อกากๆ ไม่มีคุณภาพ&#10;&#10;(ปิดสกัดจากลิงก์ชั่วคราว — รับเฉพาะข้อความสรุป)"
              style={{
                width: '100%', minHeight: isUrlOnly ? 100 : 400, padding: 16,
                borderRadius: 12, border: '1px solid var(--border)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                resize: 'vertical', outline: 'none',
                transition: 'all 0.3s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />

            {/* Word count */}
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>📊 จำนวนคำ: <strong style={{ color: 'var(--text-primary)' }}>{inputWordCount}</strong></span>
              <span>{inputText.length.toLocaleString()} ตัวอักษร</span>
            </div>

            {/* Filter Mode Selector */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                โหมดการกรอง
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {FILTER_MODES.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 10,
                      border: mode === m.key
                        ? `2px solid ${m.color}`
                        : '2px solid transparent',
                      background: mode === m.key
                        ? `${m.color}15`
                        : 'rgba(255,255,255,0.04)',
                      color: mode === m.key ? m.color : 'var(--text-muted)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                      textAlign: 'center',
                    }}
                  >
                    <div>{m.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 500, marginTop: 2, opacity: 0.8 }}>
                      {m.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ตัวเลือกการกรอง — เหลือเฉพาะที่มีผลจริงในโหมด AI (16 มิ.ย.: ตัด 3 ปุ่มที่ AI ไม่ฟังออก) */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr', gap: 8,
            }}>
              {[
                { key: 'keepQuotes', label: 'เก็บคำพูดตรง (คงคำพูดในเครื่องหมายคำพูด — ปิด = สรุปใจความแทน)', icon: '💬' },
              ].map(opt => (
                <label
                  key={opt.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    background: options[opt.key] ? 'rgba(34,197,94,0.06)' : 'transparent',
                    border: `1px solid ${options[opt.key] ? 'rgba(34,197,94,0.2)' : 'transparent'}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ accentColor: '#22c55e', width: 16, height: 16 }}
                  />
                  <span style={{
                    fontSize: 11, color: options[opt.key] ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: 600,
                  }}>
                    {opt.icon} {opt.label}
                  </span>
                </label>
              ))}
            </div>

            {/* AI Toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 10,
              background: options.useAI
                ? 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))'
                : 'rgba(255,255,255,0.02)',
              border: `1px solid ${options.useAI ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
              transition: 'all 0.3s',
            }}>
              <div>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: options.useAI ? '#818cf8' : 'var(--text-muted)',
                }}>
                  🤖 ใช้ AI วิเคราะห์
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  ใช้ AI วิเคราะห์ความถูกต้องของข้อมูลเชิงลึก
                </div>
              </div>
              <button
                onClick={() => toggleOption('useAI')}
                style={{
                  width: 48, height: 26, borderRadius: 13, border: 'none',
                  background: options.useAI
                    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                    : 'rgba(255,255,255,0.1)',
                  cursor: 'pointer', position: 'relative',
                  transition: 'background 0.3s',
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#fff', position: 'absolute',
                  top: 3,
                  left: options.useAI ? 25 : 3,
                  transition: 'left 0.3s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              {isUrlOnly ? (
                <button
                  onClick={() => handleScrapeUrl()}
                  disabled={scrapeLoading}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: scrapeLoading
                      ? 'rgba(59,130,246,0.2)'
                      : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                    color: '#fff', fontSize: 15, fontWeight: 800,
                    cursor: scrapeLoading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    boxShadow: scrapeLoading ? 'none' : '0 4px 15px rgba(59,130,246,0.3)',
                    opacity: scrapeLoading ? 0.6 : 1,
                  }}
                >
                  {scrapeLoading ? '⏳ กำลังดึงเนื้อหา...' : '📡 ดึงเนื้อหา + กรอง'}
                </button>
              ) : (
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !inputText.trim()}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                    background: loading || !inputText.trim()
                      ? 'rgba(34,197,94,0.2)'
                      : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff', fontSize: 15, fontWeight: 800,
                    cursor: loading || !inputText.trim() ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                    boxShadow: loading || !inputText.trim()
                      ? 'none'
                      : '0 4px 15px rgba(34,197,94,0.3)',
                    opacity: loading || !inputText.trim() ? 0.6 : 1,
                  }}
                >
                  {loading ? '⏳ กำลังวิเคราะห์...' : '🔬 วิเคราะห์'}
                </button>
              )}
              <button
                onClick={handleClear}
                style={{
                  padding: '14px 24px', borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                  e.currentTarget.style.color = '#ef4444';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                🗑️ ล้าง
              </button>
            </div>
          </div>

          {/* ===== RIGHT PANEL (Output) ===== */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            padding: isMobile ? 16 : 24,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {/* Panel Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                ✨ Clean News Core
              </h2>
              {outputData && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleCopy}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: copySuccess ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)',
                      color: copySuccess ? '#22c55e' : '#3b82f6',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    {copySuccess ? '✅ คัดลอกแล้ว!' : '📋 Copy'}
                  </button>
                  <button
                    onClick={handleExport}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: 'rgba(139,92,246,0.1)', color: '#8b5cf6',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    📄 Export
                  </button>
                </div>
              )}
            </div>

            {/* Output Display */}
            {loading ? (
              /* Loading State */
              <div style={{
                minHeight: 400, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 16,
              }}>
                <div style={{
                  width: 56, height: 56, border: '4px solid var(--border)',
                  borderTopColor: '#22c55e', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }} />
                <div style={{
                  fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  🔬 กำลังวิเคราะห์เนื้อหา
                  <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#22c55e', display: 'inline-block',
                        animation: `dotBounce 1.4s ${i * 0.16}s infinite ease-in-out both`,
                      }} />
                    ))}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {options.useAI ? 'AI กำลังวิเคราะห์เชิงลึก...' : 'กำลังประมวลผลข้อความ...'}
                </div>
              </div>
            ) : outputData ? (
              /* Result Display */
              <div style={{
                minHeight: 400, padding: 16, borderRadius: 12,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                overflow: 'auto',
              }}>
                <div style={{
                  whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.8,
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                }}>
                  {outputData.cleanText}
                </div>
              </div>
            ) : (
              /* Empty State */
              <div style={{
                minHeight: 400, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
                borderRadius: 12, border: '2px dashed var(--border)',
                background: 'rgba(255,255,255,0.01)',
              }}>
                <div style={{ fontSize: 48, opacity: 0.3 }}>🔬</div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: 'var(--text-muted)',
                }}>
                  วิเคราะห์ข่าวเพื่อดูผลลัพธ์
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.6 }}>
                  วางข้อความแล้วกด &quot;วิเคราะห์&quot;
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 13, fontWeight: 600,
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* Bottom Action Buttons */}
            {outputData && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: 'none',
                    background: copySuccess
                      ? 'rgba(34,197,94,0.15)'
                      : 'rgba(59,130,246,0.1)',
                    color: copySuccess ? '#22c55e' : '#3b82f6',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  {copySuccess ? '✅ คัดลอกแล้ว!' : '📋 Copy'}
                </button>
                <button
                  onClick={handleExport}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: 'none', background: 'rgba(139,92,246,0.1)',
                    color: '#8b5cf6', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  📄 Export TXT
                </button>
                <button
                  onClick={handleSendToWorkflow}
                  disabled={sendingWf || !outputData?.cleanText}
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 10,
                    border: '1px solid rgba(34,197,94,0.4)',
                    background: sendingWf ? 'rgba(255,255,255,0.04)' : 'rgba(34,197,94,0.12)',
                    color: sendingWf ? 'var(--text-muted)' : '#22c55e', fontSize: 13, fontWeight: 700,
                    cursor: sendingWf ? 'wait' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                  }}
                >
                  {sendingWf ? '⏳ กำลังส่ง...' : '📤 ส่งเข้า Workflow'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===== 🧩 แยกประเด็นย่อย (16 มิ.ย.) — ข่าว/สัมภาษณ์ที่ยัดหลายเรื่องรวมกัน → แยกประเด็น พร้อมส่งเจนทีละเรื่อง ===== */}
        {outputData && (
          <div style={{
            marginBottom: 24, background: 'var(--bg-card)', borderRadius: 16,
            border: '1px solid var(--border)', overflow: 'hidden',
            animation: 'fadeUp 0.4s ease-out both',
          }}>
            <div style={{
              padding: isMobile ? '14px 16px' : '18px 24px', borderBottom: splitData ? '1px solid var(--border)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>🧩 แยกประเด็นย่อย</h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  ข่าว/บทสัมภาษณ์ที่พูดหลายเรื่องในชิ้นเดียว → แยกเป็นประเด็น พร้อมท่อนเนื้อดิบของแต่ละเรื่อง หยิบส่งเจนทีละประเด็นได้เลย
                </p>
              </div>
              <button onClick={handleSplitTopics} disabled={splitLoading}
                style={{
                  padding: '11px 22px', borderRadius: 11, border: 'none',
                  background: splitLoading ? 'rgba(139,92,246,0.2)' : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                  color: '#fff', fontSize: 14, fontWeight: 800, cursor: splitLoading ? 'wait' : 'pointer',
                  fontFamily: 'inherit', boxShadow: splitLoading ? 'none' : '0 4px 15px rgba(139,92,246,0.3)', whiteSpace: 'nowrap',
                }}>
                {splitLoading ? '⏳ กำลังแยกประเด็น...' : splitData ? '🔄 แยกใหม่อีกครั้ง' : '🧩 แยกประเด็นให้หน่อย'}
              </button>
            </div>

            {splitLoading && (
              <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, border: '4px solid var(--border)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>AI กำลังอ่านและแยกประเด็น...</div>
              </div>
            )}

            {splitData && !splitLoading && (
              <div style={{ padding: isMobile ? 14 : 24 }}>
                {splitData.overview && (
                  <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 16 }}>
                    📋 {splitData.overview}
                  </div>
                )}

                {(splitData.isSingleTopic && splitData.topics.length <= 1) ? (
                  <div style={{ padding: '14px 18px', borderRadius: 10, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', fontSize: 13.5, color: '#22c55e', fontWeight: 600, lineHeight: 1.6 }}>
                    ✅ ข่าวนี้เป็นประเด็นเดียวชัดเจนอยู่แล้ว — ใช้เนื้อแก่นด้านบนส่งเจนได้เลย ไม่ต้องแยก
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {splitData.topics.map((t) => (
                      <div key={t.id} style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-primary)' }}>
                        {/* หัวการ์ดประเด็น */}
                        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 26, flexShrink: 0, lineHeight: 1 }}>{t.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 10px', borderRadius: 20, color: '#8b5cf6', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>ประเด็นที่ {t.id} · {t.category}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>~{t.wordCount} คำ</span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6 }}>{t.title}</div>
                            {t.summary && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{t.summary}</div>}
                          </div>
                        </div>
                        {/* ท่อนเนื้อดิบ + ปุ่ม */}
                        <div style={{ padding: '14px 18px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>📄 ท่อนเนื้อดิบประเด็นนี้ (พร้อมส่งเจน)</div>
                          <div style={{ fontSize: 13.5, lineHeight: 1.8, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.12)', borderRadius: 8, padding: 12, maxHeight: 260, overflowY: 'auto' }}>{t.content}</div>
                          {t.viralAngle && (
                            <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.07)', borderLeft: '3px solid #f59e0b', lineHeight: 1.5 }}>
                              💡 มุมน่าเล่น: {t.viralAngle}
                            </div>
                          )}
                          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, marginTop: 12 }}>
                            <button onClick={() => copyTopic(t)}
                              style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: copiedTopic === t.id ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)', color: copiedTopic === t.id ? '#22c55e' : '#3b82f6', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {copiedTopic === t.id ? '✅ คัดลอกแล้ว!' : '📋 คัดลอกประเด็นนี้'}
                            </button>
                            <button onClick={() => sendTopicToWorkflow(t)} disabled={sendingTopic === t.id}
                              style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid rgba(34,197,94,0.4)', background: sendingTopic === t.id ? 'rgba(255,255,255,0.04)' : 'rgba(34,197,94,0.12)', color: sendingTopic === t.id ? 'var(--text-muted)' : '#22c55e', fontSize: 13, fontWeight: 700, cursor: sendingTopic === t.id ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                              {sendingTopic === t.id ? '⏳ กำลังส่ง...' : '📤 ส่งประเด็นนี้เข้า Workflow'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== SUMMARY STATS ===== */}
        {outputData && (
          <div style={{
            display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: isMobile ? 10 : 16, marginBottom: 24,
            animation: 'fadeUp 0.4s ease-out both',
          }}>
            {/* Original words */}
            <StatCard
              icon="📝"
              label="คำต้นฉบับ"
              value={inputWordCount.toLocaleString()}
              color="#3b82f6"
            />
            {/* Clean words */}
            <StatCard
              icon="✨"
              label="คำหลังกรอง"
              value={cleanWordCount.toLocaleString()}
              color="#22c55e"
            />
            {/* Removed percent */}
            <StatCard
              icon="✂️"
              label="ตัดออก %"
              value={`${removedPercent}%`}
              color={removedPercent > 50 ? '#ef4444' : '#eab308'}
              highlight={removedPercent > 50}
            />
            {/* Most removed pattern */}
            <StatCard
              icon="🏷️"
              label="ประเภทที่ตัดมากสุด"
              value={mostRemovedPattern}
              color="#f97316"
            />
          </div>
        )}

        {/* ===== ANALYSIS PANEL ===== */}
        {outputData?.analysis && outputData.analysis.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            animation: 'fadeUp 0.5s ease-out both',
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{
                margin: 0, fontSize: 16, fontWeight: 800,
                color: 'var(--text-primary)',
              }}>
                📊 การวิเคราะห์รายประโยค
              </h2>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {outputData.analysis.length} ประโยค
              </span>
            </div>

            {/* Sentence Rows */}
            <div>
              {outputData.analysis.map((sentence, idx) => (
                <SentenceRow
                  key={idx}
                  sentence={sentence}
                  index={idx}
                  expanded={!!expandedRows[idx]}
                  onToggle={() => toggleRow(idx)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ===== คลังเคสสกัด (13 มิ.ย.) — ตรวจย้อนว่าตัดใจความสำคัญไปไหม ===== */}
        <div style={{ marginTop: 24 }}>
          <button onClick={toggleCases}
            style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: casesOpen ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)', color: casesOpen ? '#818cf8' : 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            📦 คลังเคสที่สกัดแล้ว {casesOpen ? '▲' : '▼'}
          </button>

          {casesOpen && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cases.length} เคสล่าสุด — กดดูเทียบ "ต้นฉบับ ↔ แก่นที่ได้" ว่าตัดใจความสำคัญไปไหม</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={loadCases} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 รีเฟรช</button>
                  {cases.length > 0 && <button onClick={() => { if (confirm('ล้างคลังเคสทั้งหมด?')) fetch('/api/news-filter/cases?id=all', { method: 'DELETE' }).then(() => loadCases()); }} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>🗑️ ล้างคลัง</button>}
                </div>
              </div>

              {cases.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>ยังไม่มีเคส — สกัดข่าวสักครั้งแล้วจะถูกเก็บที่นี่อัตโนมัติ</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cases.map((c) => (
                  <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div onClick={() => setCaseExpanded(caseExpanded === c.id ? null : c.id)}
                      style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-card)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || '(ไม่มีหัวข้อ)'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                          {c.engine} · {c.mode} · ตัด {c.removedPercent}% ({c.originalWordCount}→{c.cleanWordCount} คำ) · {new Date(c.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteCase(c.id); }} style={{ marginLeft: 10, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                    </div>
                    {caseExpanded === c.id && (
                      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>📄 ต้นฉบับ ({c.originalWordCount} คำ)</div>
                            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 10 }}>{c.original}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>✨ แก่นที่ได้ ({c.cleanWordCount} คำ)</div>
                            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', background: 'rgba(34,197,94,0.06)', borderRadius: 8, padding: 10 }}>{c.clean}</div>
                          </div>
                        </div>
                        {c.removedPatterns?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>🗑️ ตัวอย่างสิ่งที่ตัดทิ้ง</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {c.removedPatterns.map((rp, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'rgba(239,68,68,0.06)', borderRadius: 6, padding: '4px 8px' }}>"{rp.text}"</div>)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ★ 19 มิ.ย. (ผู้ใช้): คลังประวัติแยกประเด็น — บางข่าวทำได้หลายหัวข้อ กลับมาหยิบใช้ซ้ำได้ */}
        <div style={{ marginTop: 16 }}>
          <button onClick={toggleSplits}
            style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: splitsOpen ? 'rgba(168,85,247,0.12)' : 'var(--bg-card)', color: splitsOpen ? '#a855f7' : 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            🧩 คลังประวัติแยกประเด็น {splitsOpen ? '▲' : '▼'}
          </button>
          {splitsOpen && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{splits.length} รายการล่าสุด — เก็บมุมขายที่เคยแยกไว้ หยิบไปใช้ซ้ำ/คัดลอก/ส่งเจนได้เลย</span>
                <button onClick={loadSplits} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 รีเฟรช</button>
              </div>
              {splits.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>ยังไม่มี — กด "🧩 แยกประเด็น" สักครั้งแล้วจะถูกเก็บที่นี่อัตโนมัติ</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {splits.map((s) => (
                  <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div onClick={() => setSplitExpanded(splitExpanded === s.id ? null : s.id)}
                      style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-card)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || '(ไม่มีหัวข้อ)'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>🧩 {s.topicCount} มุม · {new Date(s.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); fetch('/api/news-filter/cases?type=splits&id=' + s.id, { method: 'DELETE' }).then(() => loadSplits()); }} style={{ marginLeft: 10, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>ลบ</button>
                    </div>
                    {splitExpanded === s.id && (
                      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {(s.topics || []).map((t, i) => (
                          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-primary)' }}>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>{t.emoji} {t.title}</div>
                            {t.viralAngle && <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 3 }}>💡 {t.viralAngle}</div>}
                            <div style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 200, overflowY: 'auto', background: 'rgba(0,0,0,0.12)', borderRadius: 8, padding: 10 }}>{t.content}</div>
                            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, marginTop: 8 }}>
                              <button onClick={() => copyText(t.content)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📋 คัดลอกมุมนี้</button>
                              <button onClick={() => sendTopicToWorkflow(t)} disabled={sendingTopic === t.id} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 12.5, fontWeight: 700, cursor: sendingTopic === t.id ? 'wait' : 'pointer', fontFamily: 'inherit' }}>{sendingTopic === t.id ? '⏳...' : '📤 ส่งเข้า Workflow'}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Stat Card Component =====
function StatCard({ icon, label, value, color, highlight }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 14,
      border: `1px solid ${highlight ? `${color}40` : 'var(--border)'}`,
      padding: '20px 18px',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      {highlight && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: color,
        }} />
      )}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{icon}</span>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 900, color,
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

// ===== Sentence Row Component =====
function SentenceRow({ sentence, index, expanded, onToggle }) {
  const labelColor = LABEL_COLORS[sentence.label] || '#64748b';
  const actionCfg = ACTION_CONFIG[sentence.action] || ACTION_CONFIG.KEEP;
  const isRemoved = sentence.action === 'REMOVE';

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.2s',
    }}>
      {/* Main Row */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer',
          background: expanded ? 'rgba(255,255,255,0.02)' : 'transparent',
          transition: 'background 0.2s',
        }}
        onMouseEnter={e => {
          if (!expanded) e.currentTarget.style.background = 'rgba(255,255,255,0.015)';
        }}
        onMouseLeave={e => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Index */}
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          minWidth: 20, textAlign: 'center',
        }}>
          {index + 1}
        </span>

        {/* Label Badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '3px 10px',
          borderRadius: 20, whiteSpace: 'nowrap',
          color: labelColor,
          background: `${labelColor}15`,
          border: `1px solid ${labelColor}30`,
          letterSpacing: 0.3,
        }}>
          {sentence.label}
        </span>

        {/* Sentence Text */}
        <span style={{
          flex: 1, fontSize: 13, lineHeight: 1.5,
          color: isRemoved ? 'var(--text-muted)' : 'var(--text-primary)',
          textDecoration: isRemoved ? 'line-through' : 'none',
          opacity: isRemoved ? 0.6 : 1,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {sentence.text}
        </span>

        {/* Action Badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 10px',
          borderRadius: 8, whiteSpace: 'nowrap',
          color: actionCfg.color,
          background: `${actionCfg.color}12`,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {actionCfg.icon} {actionCfg.label}
        </span>

        {/* Reason */}
        {sentence.reason && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)',
            maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sentence.reason}
          </span>
        )}

        {/* Expand icon */}
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}>
          ▼
        </span>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div style={{
          padding: '0 24px 16px 56px',
          animation: 'fadeUp 0.2s ease-out',
        }}>
          {/* Reason full */}
          {sentence.reason && (
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)',
              marginBottom: 12, lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.02)',
              borderLeft: `3px solid ${labelColor}`,
            }}>
              💡 {sentence.reason}
            </div>
          )}

          {/* Score Bars */}
          {sentence.scores && (
            <div style={{
              display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
              gap: '8px 24px',
            }}>
              {[
                { key: 'factual', label: 'ข้อเท็จจริง', color: '#22c55e' },
                { key: 'filler', label: 'คำเฟ้อ', color: '#eab308' },
                { key: 'emotional', label: 'อารมณ์', color: '#ec4899' },
                { key: 'unsupported', label: 'ไม่มีที่มา', color: '#ef4444' },
              ].map(s => {
                const val = sentence.scores[s.key] ?? 0;
                return (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, color: 'var(--text-muted)',
                      minWidth: 70, textAlign: 'right',
                    }}>
                      {s.label}
                    </span>
                    <div style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: 'rgba(255,255,255,0.06)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        width: `${Math.min(val * 100, 100)}%`,
                        background: s.color,
                        transition: 'width 0.4s ease-out',
                      }} />
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: s.color,
                      minWidth: 30,
                    }}>
                      {Math.round(val * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
