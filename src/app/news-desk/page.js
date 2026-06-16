'use client';

/**
 * 🗞️ โต๊ะข่าวกลาง (News Desk) — เฟส 1
 * feed ข่าวคัดกรองแล้วเรียงคะแนน · จองกันชนกัน · ส่งเข้า workflow คลิกเดียว
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Header from '@/components/layout/Header';

const TABS = [
  { id: 'all', label: '📋 ทั้งหมด' },
  { id: 'good', label: '💎 น้ำดี' },          // good + ข่าวเก่า + ตามรอย + ลำบาก
  { id: 'celeb', label: '🎬 ดารา' },          // celeb + ย้อนสัมภาษณ์ + ดาราอมตะ
  { id: 'trend', label: '🔥 กระแส' },         // trend + แชร์จริง
  { id: 'trendtrack', label: '🔴 ติดตามกระแส' }, // ตามกระแสเฉพาะที่ทีมสั่ง
  { id: 'clip', label: '📺 คลิป/เพจ' },        // video/รีลส์ + คลิปสัมภาษณ์
  { id: 'shortlist', label: '⭐ คลังส่งเช้า' },
  { id: 'ready', label: '✅ พร้อมใช้' },
  { id: 'junk', label: '🗑️ คลังขยะ' },        // ของที่ระบบตัดออก — รีวิว+เอากลับได้
];

const LANE_ICONS = { trend: '🔥', good: '💎', evergreen: '🗄️', interview: '🎙️', followup: '🔁', buzz: '📊', celeb: '🎬', throwback: '⏪', 'evergreen-celeb': '⭐', video: '📺', 'trend-track': '🔴' };

// ★ 15 มิ.ย.: แนวที่ "สั่งหาเฉพาะแนว" ได้ (key ต้องตรงกับ generateFocusQueries ใน goodNewsScout)
const FOCUS_OPTIONS = [
  { key: 'viral_dna', label: '🧬 แนวที่ปังบนเพจ (DNA)' },
  { key: 'good_all', label: '💎 ข่าวน้ำดี (รวมทุกหมวด)' },
  { key: 'celeb_family', label: '🎁 ดาราให้ของขวัญครอบครัว' },
  { key: 'celeb_lifestyle', label: '🏡 เปิดบ้าน/รับสัตว์/ไลฟ์สไตล์ดารา' },
  { key: 'celeb_drama', label: '🎬 ดราม่า/ความรักดารา' },
  { key: 'circle_drama', label: '🏐 ดราม่าวงการ (กีฬา/บันเทิง สด)' },
  { key: 'throwback', label: '⏪ ย้อนสัมภาษณ์เก่า' },
  { key: 'celeb_good', label: '⭐ ดาราทำดี/อมตะ' },
  { key: 'video', label: '📺 วิดีโอดารา (ยูทูป)' },
  { key: 'social', label: '📘 เพจ/รีลส์ (สัมภาษณ์+ดราม่า)' },
  { key: 'animal', label: '🐶 รักสัตว์' },
  { key: 'good_deed', label: '🙏 น้ำใจ/พลเมืองดี' },
  { key: 'fighter', label: '💪 สู้ชีวิต' },
  { key: 'hardship', label: '💧 เรื่องลำบาก/กินใจ' },
  { key: 'trend', label: '🔥 กระแสไวรัล' },
];

// ★★ สวิตช์ปิดระบบหาภาพชั่วคราว (คำสั่งทีม 12 มิ.ย. 69): บัคภาพซ้ำข้ามข่าว + ออโต้รันถี่เกิน
//    ให้คนหาภาพเองไปก่อน — เปิดกลับ: เปลี่ยนเป็น false (โค้ดหลังบ้านยังอยู่ครบ)
const PHOTO_SCOUT_OFF = true;

// ★ ช่องทางแหล่งภาพ (Image Scout) — เรียงตามที่ทีมใช้ทำปกบ่อยสุด
const IMG_CHANNELS = {
  facebook:  { icon: '📘', label: 'Facebook' },
  images:    { icon: '🖼️', label: 'ภาพจาก Google' },
  news:      { icon: '📰', label: 'เว็บข่าว' },
  youtube:   { icon: '▶️', label: 'YouTube' },
  tiktok:    { icon: '🎵', label: 'TikTok' },
  instagram: { icon: '📷', label: 'Instagram' },
};

const CAT_COLORS = {
  'น้ำใจ/ช่วยเหลือ': '#22c55e', 'กตัญญู/ครอบครัวอบอุ่น': '#10b981', 'สู้ชีวิต': '#06b6d4',
  'คนดังทำดี/ติดดิน': '#a3e635', 'สัมภาษณ์/บทสนทนาดี': '#8b5cf6', 'บันเทิงกระแส': 'var(--desk-amber)',
  'ดราม่าสังคม': '#ef4444', 'เตือนภัย/อุทาหรณ์': '#f97316', 'อื่นๆ': '#6b7280',
};

function scoreColor(s) {
  if (s >= 75) return '#22c55e';
  if (s >= 55) return 'var(--desk-amber)';
  return '#6b7280';
}

// ★ 15 มิ.ย.: เกรดคุณภาพอ่านเร็ว — อิงคะแนน บก.AI (น่าหยิบ 0-10) ก่อน ไม่มีค่อยใช้ finalScore
//   ให้ทีมสแกนเร็วว่าข่าวไหน ดีมาก/ดี/ดีปนกลาง/ผ่าน + เห็นแนวโน้มว่าข่าว "ประเภทไหน" ดี
function qualityGrade(it) {
  const j = it.judgeScore;
  let tier; // 0=ผ่าน 1=ดีปนกลาง 2=ดี 3=ดีมาก
  if (typeof j === 'number') tier = j >= 9 ? 3 : j >= 7 ? 2 : j >= 5 ? 1 : 0;
  else { const s = it.finalScore || 0; tier = s >= 85 ? 3 : s >= 70 ? 2 : s >= 55 ? 1 : 0; }
  return [
    { label: 'ผ่านเกณฑ์', emoji: '⚪', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
    { label: 'ดีปนกลาง', emoji: '🟡', color: '#d97706', bg: 'rgba(217,119,6,0.14)' },
    { label: 'ดี', emoji: '✅', color: '#16a34a', bg: 'rgba(22,163,74,0.14)' },
    { label: 'ดีมาก', emoji: '🌟', color: '#15803d', bg: 'rgba(21,128,61,0.16)' },
  ][tier];
}

// ★ 15 มิ.ย. (ทีมขอ "แยกแหล่งที่มา ไม่ให้ปนกัน"): ตรวจจากลิงก์ว่ามาจาก สำนักข่าว/โพสต์เพจ/รีลส์/ยูทูป/ลิงก์
function sourceTypeOf(it) {
  const u = String(it.url || '').toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) return { label: '▶️ ยูทูป', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
  if (/facebook\.com\/(reel|watch|share\/[rv]|[^/]+\/videos)|fb\.watch/.test(u)) return { label: '🎬 รีลส์ FB', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (/facebook\.com|m\.facebook|fb\.com/.test(u)) return { label: '📘 โพสต์เพจ', color: '#2563eb', bg: 'rgba(37,99,235,0.13)' };
  if (/tiktok\.com/.test(u)) return { label: '🎵 TikTok', color: '#0f172a', bg: 'rgba(15,23,42,0.12)' };
  if (/instagram\.com/.test(u)) return { label: '📸 IG', color: '#db2777', bg: 'rgba(219,39,119,0.12)' };
  if (it.lane === 'interview' || it.lane === 'video' || it.fullText) return { label: '🎬 คลิป', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
  return { label: '📰 สำนักข่าว', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
}

export default function NewsDeskPage() {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [mixToday, setMixToday] = useState({});
  const [sentToday, setSentToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);
  const [focusSel, setFocusSel] = useState('celeb_family');
  const [trendTopic, setTrendTopic] = useState('');
  const [trendCases, setTrendCases] = useState([]); // คลังค้นหาติดตาม (เคสคีย์เวิร์ด+ลิงก์)
  const [msg, setMsg] = useState('');
  const [me, setMe] = useState('');
  const [governor, setGovernor] = useState(null);
  const [clipUrl, setClipUrl] = useState('');
  const [mining, setMining] = useState(false);
  const [jobStatus, setJobStatus] = useState({}); // jobId → { status, position, error }
  const [chiefBrief, setChiefBrief] = useState(null);
  const [mktUrl, setMktUrl] = useState('');
  const [mktSending, setMktSending] = useState(false);
  const [researching, setResearching] = useState({}); // id → true
  const [moreBtns, setMoreBtns] = useState({}); // id → กางปุ่มขั้นสูง (ปรึกษา บก./เจาะลึก)

  useEffect(() => {
    setMe(localStorage.getItem('desk_username') || '');
    // ★ 16 มิ.ย.: เปิดแท็บตาม ?tab= ใน URL (ให้ลิงก์ "คลังส่งเช้า" จาก sidebar เด้งมาที่แท็บคลังเลย)
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t && TABS.some(x => x.id === t)) setTab(t);
    } catch {}
  }, []);

  const ensureName = () => {
    let name = localStorage.getItem('desk_username');
    if (!name) {
      name = prompt('ชื่อของคุณ (ใช้ติดป้ายตอนจองข่าว):') || '';
      if (name) { localStorage.setItem('desk_username', name); setMe(name); }
    }
    return name;
  };

  // ★ 16 มิ.ย.: อ่าน response แบบทน — งานหนัก (harvest/trend-track) บางทีแพลตฟอร์ม timeout ส่งข้อความ (ไม่ใช่ JSON) → กัน res.json() พัง crash หน้า
  const parseRes = async (res) => {
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch { return { success: false, _nonJson: true, error: 'เซิร์ฟเวอร์ใช้เวลานาน (timeout) — งานยังรันเบื้องหลังอยู่ รอสักครู่แล้วกดรีเฟรช ผลจะทยอยขึ้นเอง' }; }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/news-desk?tab=${tab}&limit=80`, { cache: 'no-store' });
      const d = await parseRes(res);
      if (d.success) { setItems(d.items); setMixToday(d.mixToday || {}); setSentToday(d.sentToday || 0); setGovernor(d.governor || null); setChiefBrief(d.chiefBrief || null);
        setEditorStats(d.editorStats || {}); setQueueDepth(d.queueDepth || { pending: 0, processing: 0 }); setReadyCount(d.readyCount || 0);
        // ★ สวิตช์ Auto-Pilot โชว์ค่าจริงจากระบบ (เดิม hardcode เปิด — ทีมเห็นว่า "เปิดเอง" ทุกครั้งที่เข้าหน้า)
        if (typeof d.autopilot === 'boolean') setAutopilot(d.autopilot);
        // ★ ติดตามสถานะงานเขียนของการ์ดที่ส่งทำใน 2 ชม.ล่าสุด
        const recent = (d.items || []).filter(i => i.status === 'sent' && i.jobId && Date.now() - new Date(i.sentAt || 0).getTime() < 2 * 3600e3).slice(0, 8);
        for (const it of recent) {
          fetch(`/api/queue/status?id=${it.jobId}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(q => setJobStatus(prev => ({ ...prev, [it.jobId]: { status: q.status, position: q.position, error: q.error } })))
            .catch(() => {});
        }
      }
    } catch {} finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  // ★ 16 มิ.ย.: โหลดคลังค้นหาติดตามเมื่อเข้าแท็บ 🔴 (persistent — ไม่รีเซ็ตเวลาปิดเบราว์เซอร์)
  const loadTrendCases = useCallback(() => {
    fetch('/api/news-desk/trend-track').then(r => r.json()).then(d => { if (d.success) setTrendCases(d.cases || []); }).catch(() => {});
  }, []);
  useEffect(() => { if (tab === 'trendtrack') loadTrendCases(); }, [tab, loadTrendCases]);

  // ★ Auto Photo Board ที่ชั้นวาง ✅: ปิดชั่วคราว (PHOTO_SCOUT_OFF) — รอแก้บัคภาพซ้ำ/ออโต้ถี่เกิน
  const _autoScouted = useRef(new Set());
  useEffect(() => {
    if (PHOTO_SCOUT_OFF || tab !== 'ready' || !items.length) return;
    const targets = items.filter(i => !i.imageSources && !_autoScouted.current.has(i.id)).slice(0, 2);
    for (const t of targets) {
      _autoScouted.current.add(t.id);
      fetch('/api/news-desk/image-scout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsId: t.id }),
      }).then(() => load()).catch(() => {});
    }
  }, [tab, items, load]);

  const harvest = async () => {
    setHarvesting(true); setMsg('🔄 กำลังเก็บ+คัดกรองข่าวรอบใหม่ (~2-4 นาที — AI ให้คะแนนทีละข่าว)...');
    try {
      const res = await fetch('/api/news-desk/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await parseRes(res);
      setMsg(d.success ? `✅ เก็บมา ${d.harvested} · ผ่านคัด ${d.added} · AI ให้คะแนน ${d.judged}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  // ★ สั่งกองสืบน้ำดี (13 มิ.ย.): ยิงเลน good ที่ใช้สมองสืบ 7 แนวคิดคำค้นสด หมุนเวรตามชั่วโมง
  const scoutHarvest = async () => {
    setHarvesting(true); setMsg('🕵️ สั่งกองสืบน้ำดีออกล่า — AI คิดคำค้นเชิงลึกแล้วไปค้นข่าว (~2-3 นาที)...');
    try {
      const res = await fetch('/api/news-desk/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lanes: ['good'], judgeTop: 12 }) });
      const d = await parseRes(res);
      setMsg(d.success ? `🕵️ กองสืบกลับมาแล้ว · เก็บ ${d.harvested} · ผ่านคัด ${d.added} · ส่งเจน ${d.autoPicked || 0}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  // ★ ล้างกระดาน + หาข่าวชุดใหม่ (15 มิ.ย. คำสั่งทีม): เคลียร์ข่าวเก่าทั้งหมด แล้วสั่ง AI ไปเก็บใหม่
  const clearAndRefresh = async () => {
    if (!confirm('ล้างข่าวทั้งหมดบนกระดาน (เก็บเข้ากรุ ไม่ลบถาวร) แล้วสั่งหาข่าวชุดใหม่?')) return;
    setHarvesting(true); setMsg('🧹 กำลังล้างกระดาน...');
    try {
      const r = await fetch('/api/news-desk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clearBoard', user: ensureName() || 'ทีม' }) });
      const cd = await r.json();
      setItems([]); // เคลียร์จอทันที
      setMsg(`🧹 ล้าง ${cd.cleared || 0} ใบ · กำลังหาข่าวชุดใหม่ (~2-4 นาที)...`);
      const res = await fetch('/api/news-desk/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await parseRes(res);
      setMsg(d.success ? `✅ ล้างแล้ว + เก็บใหม่ ${d.harvested} · ผ่านคัด ${d.added} · AI ให้คะแนน ${d.judged}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  // ★ สั่งหาข่าว "เฉพาะแนว" (15 มิ.ย.): เลือกโฟกัส → ค้นเฉพาะแนวนั้น เติมช่องว่างได้ตรงจุด
  const focusHarvest = async () => {
    const f = FOCUS_OPTIONS.find(x => x.key === focusSel);
    setHarvesting(true); setMsg(`🎯 สั่งหาข่าวแนว "${f?.label || focusSel}" — AI ค้น+คัด (~2-3 นาที)...`);
    try {
      const res = await fetch('/api/news-desk/harvest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focus: focusSel }) });
      const d = await parseRes(res);
      setMsg(d.success ? `🎯 หาแนว "${f?.label}" เสร็จ · เก็บ ${d.harvested} · ผ่านคัด ${d.added} · ส่งเจน ${d.autoPicked || 0}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  // ★ 16 มิ.ย.: ติดตามกระแส — ใส่ชื่อกระแส → AI วิเคราะห์ตัวละคร+คีย์เวิร์ด → ค้นทุกแหล่ง → แท็บ 🔴 ติดตามกระแส
  const trackTrend = async () => {
    const topic = trendTopic.trim();
    if (!topic) { setMsg('ใส่ชื่อกระแสก่อน (เช่น "ตินติน ฟรีด้า")'); return; }
    setHarvesting(true); setMsg(`🔴 วิเคราะห์กระแส "${topic}" — AI หาตัวละคร+คีย์เวิร์ด แล้วค้นทุกแหล่ง (ข่าว/เว็บ/ยูทูป/เพจ) ~1-2 นาที...`);
    try {
      const res = await fetch('/api/news-desk/trend-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic }) });
      const d = await parseRes(res);
      if (d.success) {
        setMsg(`🔴 กระแส "${topic}" — คีย์เวิร์ด ${(d.keywords || []).length} คำ (${(d.keywords || []).join(', ').slice(0, 80)}) · เก็บ ${d.harvested} · ผ่านคัด ${d.added}`);
        setTab('trendtrack'); setTrendTopic('');
      } else setMsg(`❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setHarvesting(false);
  };

  // ★ คัดลอกเคสคลังค้นหาติดตาม (คีย์เวิร์ด + ลิงก์ทั้งหมด)
  const copyCase = async (c) => {
    const lines = (c.links || []).map((l, i) => `${i + 1}. ${l.title}\n🔗 ${l.url}`);
    const text = `🔴 ติดตามกระแส: ${c.keyword} (${(c.links || []).length} ลิงก์)\n━━━━━━━━━━━━━━━\n\n${lines.join('\n\n')}`;
    try { await navigator.clipboard.writeText(text); setMsg(`📋 คัดลอก "${c.keyword}" ${(c.links || []).length} ลิงก์ — วางในแชทได้เลย`); }
    catch { window.prompt('คัดลอกข้อความนี้:', text); }
  };

  // ★ คัดลอก "คลังส่งเช้า" เป็นข้อความ → วางในแชทส่งพนักงานได้เลย (title + แนว + ลิงก์ เรียงเข้าใจง่าย)
  const copyShortlist = async () => {
    if (!items.length) { setMsg('คลังว่าง — ไปเลือกข่าวกด ☆ เก็บส่งเช้า ก่อน'); return; }
    const today = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    // ★ แยกหมวดหมู่ — ส่งพนักงานเห็นชัดว่าข่าวกลุ่มไหนมีอะไรบ้าง
    const groups = {};
    for (const it of items) { const cat = it.category || 'อื่นๆ'; (groups[cat] = groups[cat] || []).push(it); }
    let n = 0;
    const blocks = Object.entries(groups).map(([cat, arr]) => {
      const lines = arr.map(it => { n++; return `${n}. ${it.title}\n🔗 ${it.url || '(คลิป/บทถอดเสียง — เปิดในโต๊ะข่าว)'}`; });
      return `【 ${cat} 】\n${lines.join('\n\n')}`;
    });
    const text = `📰 ข่าวให้เจนวันนี้ (${today}) — ${items.length} ข่าว\n━━━━━━━━━━━━━━━\n\n${blocks.join('\n\n\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`📋 คัดลอกแล้ว ${items.length} ข่าว (แยกหมวด) — วางในแชท Discord/Line ส่งพนักงานได้เลย`);
    } catch {
      window.prompt('คัดลอกข้อความนี้ (Ctrl+C):', text);
    }
  };

  const act = async (id, action) => {
    // ★ 16 มิ.ย.: เก็บคลัง/ไม่เอา ไม่ต้องบังคับใส่ชื่อ (เดิม ☆ เก็บส่งเช้า กดแล้วเงียบเพราะ return ตอนไม่มีชื่อ)
    const noNameOk = ['dismiss', 'shortlist', 'unshortlist'].includes(action);
    const user = ensureName() || (noNameOk ? 'ทีม' : '');
    if (!user && !noNameOk) return;
    // ★ optimistic: เก็บคลัง=สลับ ⭐ ทันที | ไม่เอา/หยิบใช้/เอาออกจากคลัง(ในแท็บคลัง)=ลบการ์ดทันที
    const isRemove = action === 'dismiss' || action === 'used' || (action === 'unshortlist' && tab === 'shortlist');
    if (isRemove) setItems(prev => prev.filter(x => x.id !== id));
    else if (action === 'shortlist') setItems(prev => prev.map(x => x.id === id ? { ...x, shortlisted: true } : x));
    else if (action === 'unshortlist') setItems(prev => prev.map(x => x.id === id ? { ...x, shortlisted: false } : x));
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, user }),
      });
      const d = await parseRes(res);
      if (!d.success) { alert(d.error); load(); return; }   // พลาด → ดึงใหม่คืนสถานะ
      // dismiss/used/shortlist/unshortlist อัปเดตจอแล้ว ไม่ refetch (กันเด้งกลับ); อื่นๆ refetch
      if (!isRemove && action !== 'shortlist' && action !== 'unshortlist') load();
    } catch (e) {
      alert('บันทึกไม่สำเร็จ: ' + (e.message || '')); load();
    }
  };

  // ★ 16 มิ.ย.: เอากลับจากคลังขยะ → คืนขึ้นโต๊ะ
  const restoreJunk = async (id) => {
    setItems(prev => prev.filter(x => x.id !== id));
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restoreJunk', id, user: 'ทีม' }),
      });
      const d = await parseRes(res);
      if (d.success) setMsg('♻️ เอากลับขึ้นโต๊ะแล้ว — ไปดูที่แท็บ 📋 ทั้งหมด');
      else { alert(d.error || 'เอากลับไม่สำเร็จ'); load(); }
    } catch (e) { alert('ไม่สำเร็จ: ' + (e.message || '')); load(); }
  };

  const sendToWorkflow = async (item) => {
    const user = ensureName();
    if (!user) return;
    setMsg(`🚀 กำลังส่ง "${item.title.slice(0, 40)}..." เข้าคิวเขียน...`);
    try {
      // ฝั่งเซิร์ฟเวอร์จัดการเอง: คลิปสัมภาษณ์ → ส่งบทถอดเสียงเต็ม / ข่าวปกติ → ส่งลิงก์
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendWorkflow', id: item.id, user }),
      });
      const d = await parseRes(res);
      if (d.success) {
        setMsg(`✅ เข้าคิวแล้ว (คิวที่ ${d.position}) — ดูผลในหน้า Generation Log`);
        // ★ Auto Photo Board: ปิดชั่วคราว (PHOTO_SCOUT_OFF) — รอแก้บัคภาพซ้ำ
        if (!PHOTO_SCOUT_OFF && !item.imageSources) {
          fetch('/api/news-desk/image-scout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newsId: item.id }),
          }).then(() => load()).catch(() => {});
        }
      } else setMsg(`❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const mineClip = async () => {
    if (!/^https?:\/\//.test(clipUrl)) { setMsg('❌ วางลิงก์คลิปก่อน (YouTube / Facebook / IG / TikTok)'); return; }
    setMining(true);
    setMsg('⛏️ กำลังถอดเสียง + ขุดนาทีทอง... (คลิปยาวใช้เวลาหลายนาที)');
    try {
      const res = await fetch('/api/news-desk/mine-clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clipUrl }),
      });
      const d = await parseRes(res);
      if (d.success) {
        setMsg(`✅ ขุดสำเร็จ: "${d.item.title}" — นาทีทอง ${d.golden?.length || 0} จุด (อยู่แท็บ 🎙️)`);
        setClipUrl('');
        setTab('interview');
      } else setMsg(`❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setMining(false);
  };

  const research = async (item) => {
    setResearching(prev => ({ ...prev, [item.id]: true }));
    setMsg(`🔬 กำลังเจาะลึก "${item.title.slice(0, 40)}..." (หาแหล่งเพิ่ม+สังเคราะห์ ~1 นาที)`);
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'research', id: item.id, user: me || 'ไม่ระบุ' }),
      });
      const d = await parseRes(res);
      setMsg(d.success ? `✅ เจาะลึกเสร็จ — พร้อมเขียน ${d.research.readyScore}/10 (${d.research.keyFacts?.length || 0} ข้อเท็จจริง)` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setResearching(prev => ({ ...prev, [item.id]: false }));
  };

  // ★ หาแหล่งภาพประกอบข่าว — AI วิเคราะห์บริบท+ค้นทุกช่องทาง ส่งเป็นลิงก์จัดกลุ่ม (ไม่แคปภาพ)
  const scoutImg = async (item) => {
    setResearching(prev => ({ ...prev, ['img_' + item.id]: true }));
    setMsg(`📸 กำลังหาแหล่งภาพ "${item.title.slice(0, 40)}..." (วิเคราะห์บริบท+ค้น 6 ช่องทาง ~1 นาที)`);
    try {
      const res = await fetch('/api/news-desk/image-scout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsId: item.id, force: !!item.imageSources }),
      });
      const d = await parseRes(res);
      setMsg(d.success ? `✅ เจอแหล่งภาพ ${d.imageSources.totalLinks} ลิงก์ — ${d.imageSources.event?.slice(0, 60)}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setResearching(prev => ({ ...prev, ['img_' + item.id]: false }));
  };

  const sendMarketPost = async () => {
    if (!/^https?:\/\//.test(mktUrl)) { setMsg('❌ วางลิงก์โพสต์/คลิปที่เห็นว่าแรงก่อน'); return; }
    setMktSending(true);
    setMsg('📈 กำลังดึงเนื้อ+ถอด pattern โพสต์แรง...');
    try {
      const res = await fetch('/api/news-desk/market-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mktUrl, user: me || 'ไม่ระบุ' }),
      });
      const d = await parseRes(res);
      setMsg(d.success ? `✅ เข้าคลังตลาดแล้ว: "${d.item.topic}" — ${d.item.whyViral}` : `❌ ${d.error}`);
      if (d.success) setMktUrl('');
    } catch (e) { setMsg('❌ ' + e.message); }
    setMktSending(false);
  };

  const consult = async (item) => {
    setResearching(prev => ({ ...prev, ['c_' + item.id]: true }));
    setMsg(`💼 บก.ประจำแนวกำลังวิเคราะห์ "${item.title.slice(0, 40)}..." (~1 นาที)`);
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consult', id: item.id, user: me || 'ไม่ระบุ' }),
      });
      const d = await parseRes(res);
      setMsg(d.success ? `${d.consult.icon} ${d.consult.by}: ${d.consult.verdict} — แนะนำแนว "${d.consult.bestAngle}"` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setResearching(prev => ({ ...prev, ['c_' + item.id]: false }));
  };

  const callChief = async (instruction = '') => {
    setMsg(instruction ? `🧠 บก.ใหญ่รับคำสั่ง: "${instruction.slice(0, 60)}" กำลังทำ (~2-4 นาที)...` : '🧠 บก.ใหญ่ AI กำลังวิเคราะห์ภาพรวม+สั่งเก็บเพิ่ม (~2-4 นาที)...');
    try {
      const res = await fetch('/api/news-desk/chief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instruction ? { instruction } : {}),
      });
      const d = await parseRes(res);
      setMsg(d.success ? `🧠 ${(d.orders || []).join(' · ') || d.brief || 'เสร็จแล้ว'}` : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const [chiefCmd, setChiefCmd] = useState('');
  const [expanded, setExpanded] = useState({}); // id → versions[] (แท็บพร้อมใช้)
  const [autopilot, setAutopilot] = useState(true);
  const [editorStats, setEditorStats] = useState({});
  const [queueDepth, setQueueDepth] = useState({ pending: 0, processing: 0 });
  const [readyCount, setReadyCount] = useState(0);
  const [editorRunning, setEditorRunning] = useState('');

  const runEditor = async (key, label) => {
    setEditorRunning(key);
    setMsg(`${label} กำลังสแกนเลนตัวเอง + เลือกส่งเจน (~1-3 นาที)...`);
    try {
      const res = await fetch('/api/news-desk/editor-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editor: key }),
      });
      const d = await parseRes(res);
      setMsg(d.success ? d.summary : `❌ ${d.error}`);
      load();
    } catch (e) { setMsg('❌ ' + e.message); }
    setEditorRunning('');
  };

  const toggleAutopilot = async () => {
    const next = !autopilot;
    setAutopilot(next);
    try {
      const res = await fetch('/api/news-desk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'autopilot', enabled: next }),
      });
      const d = await parseRes(res);
      if (!d.success) {
        setAutopilot(!next); // บันทึกไม่สำเร็จ — คืนสวิตช์ตามจริง อย่าหลอกทีม
        setMsg('❌ บันทึกสวิตช์ไม่สำเร็จ ลองใหม่อีกครั้ง');
        setTimeout(() => setMsg(''), 4000);
        return;
      }
    } catch {
      setAutopilot(!next);
      setMsg('❌ บันทึกสวิตช์ไม่สำเร็จ ลองใหม่อีกครั้ง');
      setTimeout(() => setMsg(''), 4000);
      return;
    }
    setMsg(next ? '🤖 Auto-Pilot เปิด — บก.จะเลือกข่าวคะแนน 8+ ส่งเจนเองทุกรอบเก็บข่าว' : '⏸️ Auto-Pilot ปิด — บก.แนะนำอย่างเดียว ทีมกดส่งเอง');
  };

  const openVersions = async (item) => {
    if (expanded[item.id]) { setExpanded(prev => ({ ...prev, [item.id]: null })); return; }
    if (!item.jobId) { setMsg('❌ การ์ดนี้ไม่มีงานเขียนผูกอยู่'); return; }
    setMsg('📖 กำลังเปิดเนื้อที่เจนไว้...');
    try {
      const res = await fetch(`/api/queue/status?id=${item.jobId}`, { cache: 'no-store' });
      const d = await parseRes(res);
      const data = d.result?.data || d.result || {};
      const versions = data?.analysis?.versions || data?.versions || [];
      if (d.status !== 'completed') { setMsg(d.status === 'failed' ? `❌ งานเขียนล้มเหลว: ${d.error || ''}` : '⏳ ยังเขียนไม่เสร็จ รอแป๊บ'); return; }
      if (!versions.length) { setMsg('❌ ไม่พบเวอร์ชันในงานนี้ — ดูใน Generation Log แทน'); return; }
      setExpanded(prev => ({ ...prev, [item.id]: versions }));
      setMsg('');
    } catch (e) { setMsg('❌ ' + e.message); }
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setMsg('📋 คัดลอกแล้ว — เอาไปทำโพสต์/ปกได้เลย'); }
    catch { setMsg('❌ คัดลอกไม่สำเร็จ'); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0f1419)' }}>
      <Header title="🗞️ โต๊ะข่าวกลาง" subtitle="ข่าวคัดกรองด้วยสมอง 4 ชั้น — เรียงตามความน่าทำของเพจเรา" />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 20px 60px' }}>
        {/* แถวบน: แท็บ + ปุ่มเก็บข่าว */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer',
                background: tab === t.id ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(255,255,255,0.05)',
                color: tab === t.id ? '#000' : 'var(--text-primary)', fontWeight: 600, fontSize: 14,
              }}>{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={toggleAutopilot} title="เปิด: บก.เลือกข่าวคะแนน 8+ ส่งเจนเองทุกรอบ / ปิด: บก.แนะนำอย่างเดียว"
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid ' + (autopilot ? 'rgba(34,197,94,0.45)' : 'var(--border)'), cursor: 'pointer', background: autopilot ? 'rgba(34,197,94,0.12)' : 'var(--bg-card)', color: autopilot ? '#22c55e' : 'var(--text-muted)', fontWeight: 700, fontSize: 13.5 }}>
            {autopilot ? '🤖 Auto-Pilot: เปิด' : '⏸️ Auto-Pilot: ปิด'}</button>
          <button onClick={() => callChief()}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.4)', cursor: 'pointer', background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontWeight: 700, fontSize: 13.5 }}>
            🧠 เรียก บก.ใหญ่</button>
          <button onClick={scoutHarvest} disabled={harvesting} title="สมองสืบ 7 แนวคิดคำค้นน้ำดีสดๆ หมุนเวรตามชั่วโมง แล้วไปค้นข่าวที่คนอื่นไม่ขุด"
            style={{
              padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.5)', cursor: harvesting ? 'wait' : 'pointer',
              background: harvesting ? '#4b5563' : 'rgba(34,197,94,0.15)', color: harvesting ? '#fff' : 'var(--desk-green, #16a34a)', fontWeight: 700, fontSize: 14,
            }}>{harvesting ? '⏳...' : '🕵️ สั่งกองสืบน้ำดี'}</button>
          <button onClick={clearAndRefresh} disabled={harvesting} title="เก็บข่าวทั้งหมดบนกระดานเข้ากรุ (ไม่ลบถาวร) แล้วสั่ง AI หาข่าวชุดใหม่ทันที"
            style={{
              padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.45)', cursor: harvesting ? 'wait' : 'pointer',
              background: harvesting ? '#4b5563' : 'rgba(239,68,68,0.12)', color: harvesting ? '#fff' : 'var(--desk-red, #dc2626)', fontWeight: 700, fontSize: 14,
            }}>{harvesting ? '⏳...' : '🧹 ล้างกระดาน + หาใหม่'}</button>
          <button onClick={harvest} disabled={harvesting}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none', cursor: harvesting ? 'wait' : 'pointer',
              background: harvesting ? '#4b5563' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontWeight: 700, fontSize: 14,
            }}>{harvesting ? '⏳ กำลังคัดกรอง...' : '🔄 หาข่าวรอบใหม่'}</button>
        </div>

        {/* ★ สั่งหาข่าวเฉพาะแนว (15 มิ.ย.) — เลือกแนวที่อยากได้ แล้วยิงค้นเฉพาะแนวนั้น */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>🎯 สั่งหาเฉพาะแนว:</span>
          <select value={focusSel} onChange={e => setFocusSel(e.target.value)} disabled={harvesting}
            style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {FOCUS_OPTIONS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button onClick={focusHarvest} disabled={harvesting}
            style={{ padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(59,130,246,0.5)', cursor: harvesting ? 'wait' : 'pointer', background: harvesting ? '#4b5563' : 'rgba(59,130,246,0.13)', color: harvesting ? '#fff' : 'var(--desk-blue, #2563eb)', fontWeight: 700, fontSize: 13.5 }}>
            {harvesting ? '⏳...' : '🎯 หาแนวนี้'}</button>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>— เติมช่องว่างของวันได้ตรงจุด (เช่น วันนี้ขาดข่าวรักสัตว์)</span>
        </div>

        {/* ★ 16 มิ.ย.: ติดตามกระแส — ใส่ชื่อกระแสวันนี้ → AI วิเคราะห์ตัวละคร+คีย์เวิร์ด → ค้นทุกแหล่ง */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <span style={{ fontSize: 18 }}>🔴</span>
          <input value={trendTopic} onChange={e => setTrendTopic(e.target.value)} disabled={harvesting}
            onKeyDown={e => { if (e.key === 'Enter') trackTrend(); }}
            placeholder='ติดตามกระแสวันนี้ — ใส่ชื่อกระแส/คน (เช่น "ตินติน ฟรีด้า") AI จะหาตัวละคร+ค้นทุกแหล่งให้'
            style={{ flex: 1, padding: '9px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14 }} />
          <button onClick={trackTrend} disabled={harvesting || !trendTopic.trim()}
            style={{ padding: '9px 18px', borderRadius: 9, border: 'none', cursor: (harvesting || !trendTopic.trim()) ? 'not-allowed' : 'pointer', background: (harvesting || !trendTopic.trim()) ? '#4b5563' : 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
            {harvesting ? '⏳...' : '🔍 วิเคราะห์+ตามกระแส'}</button>
        </div>

        {/* ช่องวางลิงก์คลิปสัมภาษณ์ (เหมืองนาทีทอง) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={clipUrl} onChange={e => setClipUrl(e.target.value)} disabled={mining}
            placeholder="🎙️ วางลิงก์คลิปสัมภาษณ์/รายการ (YouTube / FB Reel / TikTok) — ระบบถอดเสียง+ขุดนาทีทองให้"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={mineClip} disabled={mining}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mining ? 'wait' : 'pointer', background: mining ? '#4b5563' : 'linear-gradient(135deg,#06b6d4,#0e7490)', color: '#fff', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mining ? '⏳ กำลังขุด...' : '⛏️ ขุดนาทีทอง'}</button>
        </div>

        {/* ช่องรายงานโพสต์แรงตลาด — ตา engagement ของระบบ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={mktUrl} onChange={e => setMktUrl(e.target.value)} disabled={mktSending}
            placeholder="📈 เห็นโพสต์ไหนกำลังแรงในฟีด? วางลิงก์ตรงนี้ — ระบบเก็บเข้าคลังตลาด ให้ บก.ใหญ่เรียนรู้ว่าตลาดเล่นอะไร"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.05)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={sendMarketPost} disabled={mktSending}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: mktSending ? 'wait' : 'pointer', background: mktSending ? '#4b5563' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            {mktSending ? '⏳...' : '📈 รายงานโพสต์แรง'}</button>
        </div>

        {/* brief จาก บก.ใหญ่ AI — รูปแบบหัวข้อสั้น */}
        {(chiefBrief?.orders?.length > 0 || chiefBrief?.brief) && (
          <div style={{ marginBottom: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div style={{ fontSize: 13.5, color: 'var(--desk-purple)', fontWeight: 700 }}>🧠 บก.ใหญ่ AI ({new Date(chiefBrief.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)</div>
            {(chiefBrief.orders || []).map((o, i) => (
              <div key={i} style={{ fontSize: 13.5, color: 'var(--desk-purple-soft)', marginTop: 4 }}>📌 {o}</div>
            ))}
            {(chiefBrief.warnings || []).map((w, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--desk-red)', marginTop: 4 }}>⚠️ {w}</div>
            ))}
            {(chiefBrief.pushNow || []).length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--desk-green-soft)', marginTop: 4 }}>🚀 ดันทันที: {chiefBrief.pushNow.join(' · ')}</div>
            )}
            {!chiefBrief.orders?.length && chiefBrief.brief && (
              <div style={{ fontSize: 13.5, color: 'var(--desk-purple-soft)', marginTop: 4 }}>{chiefBrief.brief}</div>
            )}
            {chiefBrief.extraQueries?.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--desk-purple)', marginTop: 4 }}>🔎 สั่งเก็บเพิ่ม {chiefBrief.extraQueries.length} คำค้น (+{chiefBrief.harvested} ใบ)</div>
            )}
          </div>
        )}

        {/* ★ สั่ง บก.ใหญ่ ด้วยข้อความ — ไม่ต้องรอรอบ */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={chiefCmd} onChange={e => setChiefCmd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && chiefCmd.trim()) { callChief(chiefCmd.trim()); setChiefCmd(''); } }}
            placeholder="🧠 สั่ง บก.ใหญ่ได้เลย เช่น: หาข่าวสัตว์น่ารักช่วยคน 3 เรื่อง / วิเคราะห์ว่าทำไมวันนี้ส่งทำน้อย / เช็คว่าคลังขาดหมวดไหน"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.06)', color: 'var(--text-primary)', fontSize: 13.5, outline: 'none' }} />
          <button onClick={() => { if (chiefCmd.trim()) { callChief(chiefCmd.trim()); setChiefCmd(''); } }}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            🧠 สั่งเลย</button>
        </div>

        {/* ★ แถวสั่ง บก.รายฝ่ายทำทันที + สถานะคิว */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700 }}>สั่ง บก.ทำทันที:</span>
          {[['good', '💚 บก.น้ำดี'], ['drama', '🌶️ บก.ดราม่า'], ['interview', '🎙️ บก.สัมภาษณ์']].map(([key, label]) => (
            <button key={key} onClick={() => runEditor(key, label)} disabled={!!editorRunning}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', cursor: editorRunning ? 'wait' : 'pointer', background: editorRunning === key ? 'rgba(139,92,246,0.2)' : 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
              {editorRunning === key ? '⏳ กำลังสแกน...' : label + ' ลุย'}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            ✍️ กำลังเขียน <b style={{ color: 'var(--desk-blue)' }}>{queueDepth.processing}</b> · รอคิว <b style={{ color: 'var(--desk-amber)' }}>{queueDepth.pending}</b> · ✅ พร้อมใช้ <b style={{ color: 'var(--desk-green)' }}>{readyCount}</b>
          </span>
        </div>

        {/* แถบส่วนผสมวันนี้ + Mix Governor */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>วันนี้ส่งทำแล้ว <b style={{ color: '#f59e0b' }}>{sentToday}</b> ข่าว</span>
          {Object.entries(editorStats).map(([who, n]) => (
            <span key={who} style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontWeight: 700 }}>{who} ×{n}</span>
          ))}
          {governor && governor.total > 0 && (
            <>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.positiveOk ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: governor.positiveOk ? '#22c55e' : 'var(--desk-red)' }}>
                💚 น้ำดี {governor.positivePct}% {governor.positiveOk ? '✓' : '(เป้า ≥40%)'}
              </span>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: governor.dramaOk ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.2)', color: governor.dramaOk ? 'var(--text-secondary)' : 'var(--desk-red)' }}>
                🌶️ ดราม่า {governor.dramaPct}% {governor.dramaOk ? '✓' : '⚠️ เกินเพดาน 20% — การ์ดดราม่าถูกกดลงแล้ว'}
              </span>
            </>
          )}
          {Object.entries(mixToday).map(([cat, n]) => (
            <span key={cat} style={{ padding: '3px 10px', borderRadius: 999, background: (CAT_COLORS[cat] || '#666') + '22', color: CAT_COLORS[cat] || '#999', fontWeight: 600 }}>
              {cat} ×{n}
            </span>
          ))}
        </div>

        {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,0.12)', color: 'var(--desk-purple)', fontSize: 14 }}>{msg}</div>}

        {/* ★ 16 มิ.ย.: แถบทางเดิน — เปิดมารู้เลยว่าทำอะไรก่อน-หลัง (ลดความงง) */}
        {tab !== 'shortlist' && tab !== 'ready' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(139,92,246,0.06)', border: '1px dashed rgba(139,92,246,0.3)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>🧭 <b>วิธีใช้:</b></span>
            <span>① เลื่อนดูข่าว</span><span style={{ opacity: 0.5 }}>→</span>
            <span>② เจอข่าวดีกด <b style={{ color: '#ca8a04' }}>☆ เก็บส่งเช้า</b></span><span style={{ opacity: 0.5 }}>→</span>
            <span>③ เช้าเข้าแท็บ <b style={{ color: '#ca8a04' }}>⭐ คลังส่งเช้า</b> กด <b>📋 คัดลอกส่งพนักงาน</b></span>
          </div>
        )}

        {/* ★ 16 มิ.ย.: คลังค้นหาติดตาม — เคสคีย์เวิร์ดที่เคยค้น + ลิงก์ (persistent ไม่รีเซ็ตเมื่อปิดเบราว์เซอร์) */}
        {tab === 'trendtrack' && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.28)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>📁 คลังค้นหาติดตาม ({trendCases.length} คีย์เวิร์ด) — ปิดเบราว์เซอร์แล้วยังอยู่</div>
            {trendCases.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>ยังไม่มี — ใส่ชื่อกระแสที่ช่อง 🔴 ด้านบนแล้วกด "วิเคราะห์+ตามกระแส" จะเก็บลิงก์ที่เจอไว้ที่นี่อัตโนมัติ</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {trendCases.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 9, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--desk-red, #dc2626)' }}>🔴 {c.keyword}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(c.links || []).length} ลิงก์ · {c.createdAt ? new Date(c.updatedAt || c.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : ''}</span>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => copyCase(c)} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', fontSize: 12.5, fontWeight: 700 }}>📋 คัดลอกลิงก์</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ★ แบนเนอร์คลังส่งเช้า — ปุ่มคัดลอกส่งพนักงาน */}
        {tab === 'shortlist' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 12, borderRadius: 12, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.35)' }}>
            <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text-secondary)' }}>⭐ <b>คลังส่งเช้า</b> — ข่าวที่เลือกไว้ส่งพนักงาน ({items.length} ข่าว) · เช้ามากดคัดลอกแล้ววางในแชทให้พนักงานไปเจนได้เลย</div>
            <button onClick={copyShortlist} disabled={!items.length}
              style={{ padding: '8px 18px', borderRadius: 10, border: 'none', cursor: items.length ? 'pointer' : 'not-allowed', background: items.length ? 'linear-gradient(135deg,#eab308,#ca8a04)' : '#4b5563', color: '#fff', fontWeight: 700, fontSize: 14 }}>
              📋 คัดลอกส่งพนักงาน</button>
          </div>
        )}

        {/* ★ แบนเนอร์คลังขยะ */}
        {tab === 'junk' && (
          <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.28)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            🗑️ <b>คลังขยะ</b> — ข่าวที่ระบบตัดออก (แง่ลบ/นอกแนว/เสี่ยง/ต่างประเทศ/กระแสเก่า) เก็บไว้ให้ตรวจ ไม่ได้ลบทิ้ง · ถ้าเจออันที่ตัดผิดกด <b>♻️ เอากลับ</b> ขึ้นโต๊ะได้ ({items.length} ชิ้น)
          </div>
        )}

        {/* รายการข่าว */}
        {tab === 'junk' ? (
          loading ? (
            <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>⏳ โหลด...</div>
          ) : items.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>🗑️ คลังขยะว่าง — ยังไม่มีข่าวที่ระบบตัดออก</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(it => (
                <div key={it.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{(LANE_ICONS[it.lane] || '📰') + ' '}{it.title}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 11.5, alignItems: 'center' }}>
                        <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>🗑️ {it.junkReason}</span>
                        {it.category && <span style={{ color: 'var(--text-muted)' }}>{it.category}</span>}
                        {it.source && <span style={{ color: 'var(--text-muted)' }}>· {it.source}</span>}
                        {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>🔗 เปิด</a>}
                      </div>
                    </div>
                    <button onClick={() => restoreJunk(it.id)}
                      style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                      ♻️ เอากลับ</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>⏳ โหลด...</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', padding: 40, textAlign: 'center' }}>
            คลังยังว่าง — กด <b>🔄 หาข่าวรอบใหม่</b> เพื่อให้ระบบไปเก็บ+คัดกรองข่าวชุดแรก
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(it => (
              <div key={it.id} style={{
                padding: '14px 16px', borderRadius: 14, background: 'var(--bg-card)',
                border: it.status === 'claimed' ? '1px solid rgba(245,158,11,0.5)' : it.status === 'sent' ? '1px solid rgba(34,197,94,0.4)' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* คะแนน + เกรดคุณภาพ (อ่านเร็ว) */}
                  {(() => { const g = qualityGrade(it); return (
                    <div style={{ minWidth: 58, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: '100%', textAlign: 'center', padding: '8px 0', borderRadius: 12, background: scoreColor(it.finalScore) + '1d', color: scoreColor(it.finalScore), fontWeight: 800, fontSize: 20 }}>
                        {it.finalScore ?? '-'}
                      </div>
                      <div title={it.judgeScore != null ? `บก.AI ให้ ${it.judgeScore}/10` : 'ประเมินจากคะแนนรวม'} style={{ width: '100%', textAlign: 'center', padding: '2px 0', borderRadius: 7, background: g.bg, color: g.color, fontWeight: 700, fontSize: 10.5, lineHeight: 1.25 }}>
                        {g.emoji} {g.label}
                      </div>
                    </div>
                  ); })()}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15, lineHeight: 1.45 }}>
                      {(LANE_ICONS[it.lane] || '📰') + ' '}{it.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                      {(() => { const st = sourceTypeOf(it); return (
                        <span title="แหล่งที่มาของข่าว" style={{ padding: '2px 9px', borderRadius: 999, background: st.bg, color: st.color, fontWeight: 700 }}>{st.label}</span>
                      ); })()}
                      <span style={{ padding: '2px 9px', borderRadius: 999, background: (CAT_COLORS[it.category] || '#666') + '22', color: CAT_COLORS[it.category] || '#999', fontWeight: 600 }}>{it.category}</span>
                      {it.trendTopic && <span title="ติดตามกระแส" style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(239,68,68,0.13)', color: 'var(--desk-red, #dc2626)', fontWeight: 700 }}>🔴 {it.trendTopic}</span>}
                      {it._spotlight && <span title="ข่าวคะแนนกลางที่ระบบดึงขึ้นมาให้ผ่านตา — กันข่าวดีจมล่าง (หมุนเวียนเรื่อยๆ)" style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(168,85,247,0.15)', color: 'var(--desk-purple, #a855f7)', fontWeight: 700 }}>💡 ค้นพบ</span>}
                      {it.foreignCountry && <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(59,130,246,0.15)', color: 'var(--desk-blue)', fontWeight: 700 }}>🌏 ข่าวต่างประเทศ · {it.foreignCountry}</span>}
                      {it.sameStoryAs && <span title={it.sameStoryAs.title} style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: 'var(--desk-amber)', fontWeight: 700 }}>⚠️ เรื่องนี้เคยส่งเจนแล้ว (ทำซ้ำได้ถ้าตั้งใจ)</span>}
                      <span style={{ color: 'var(--text-muted)' }}>{it.source}</span>
                      {Array.isArray(it.altSources) && it.altSources.length > 0 && (
                        <span title={it.altSources.map(a => a.source || a.url).join(' · ')} style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: 'var(--desk-green, #16a34a)', fontWeight: 700 }}>
                          🔗 อีก {it.altSources.length} แหล่งรายงานเรื่องเดียวกัน</span>
                      )}
                      {it.pickedBy && <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(139,92,246,0.15)', color: 'var(--desk-purple)', fontWeight: 700 }}>{it.pickedByIcon || '🤖'} {it.pickedBy} เลือก</span>}
                      {it.status === 'claimed' && <span style={{ color: 'var(--desk-amber)', fontWeight: 700 }}>📌 {it.claimedBy} จองแล้ว</span>}
                      {it.status === 'sent' && (() => {
                        const js = it.jobId ? jobStatus[it.jobId] : null;
                        if (!js) return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                        if (js.status === 'pending') return <span style={{ color: 'var(--desk-amber)', fontWeight: 700 }}>⏳ รอคิว{js.position ? `ที่ ${js.position}` : ''}</span>;
                        if (js.status === 'processing') return <span style={{ color: 'var(--desk-blue)', fontWeight: 700 }}>✍️ AI กำลังเขียน...</span>;
                        if (js.status === 'completed') return <a href="/generation-logs" style={{ color: '#22c55e', fontWeight: 700, textDecoration: 'underline' }}>✅ เขียนเสร็จ — เปิดดูใน Generation Log</a>;
                        if (js.status === 'failed') return <span style={{ color: 'var(--desk-red)', fontWeight: 700 }} title={js.error}>❌ เขียนล้มเหลว — ลองส่งใหม่</span>;
                        return <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ ส่งทำแล้ว</span>;
                      })()}
                      {it.performance === 'viral' && <span style={{ color: '#fb923c', fontWeight: 700 }}>🔥 ปังจริง</span>}
                      {it.performance === 'flop' && <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>🧊 แป้ก</span>}
                      {it.followupOf && <span style={{ color: '#c084fc' }}>🔁 ตามรอย: {String(it.followupOf).slice(0, 40)}</span>}
                    </div>
                    {it.judgeReason && (
                      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>🧠 {it.judgeReason}</div>
                    )}
                    {(it.angles || []).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--desk-blue)' }}>
                        💡 {it.angles.join(' · ')}
                      </div>
                    )}
                    {it.research?.enrichedSummary && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)' }}>
                        <div style={{ fontSize: 12, color: 'var(--desk-green)', fontWeight: 700 }}>🔬 เจาะลึกแล้ว — พร้อมเขียน {it.research.readyScore}/10 ({it.research.sources?.length || 1} แหล่ง)</div>
                        {(it.research.keyFacts || []).slice(0, 3).map((f, fi) => (
                          <div key={fi} style={{ fontSize: 12.5, color: 'var(--desk-green-soft)', marginTop: 3 }}>• {f}</div>
                        ))}
                        {(it.research.quotes || []).slice(0, 1).map((q, qi) => (
                          <div key={qi} style={{ fontSize: 12.5, color: 'var(--desk-green-soft)', marginTop: 3, fontStyle: 'italic' }}>&ldquo;{q}&rdquo;</div>
                        ))}
                      </div>
                    )}
                    {it.consult?.angles?.length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.22)' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--desk-purple)', fontWeight: 700 }}>
                          {it.consult.icon} {it.consult.by} — {it.consult.verdict} <span style={{ fontWeight: 400 }}>({it.consult.verdictWhy})</span>
                        </div>
                        {it.consult.angles.map((a, ai) => (
                          <div key={ai} style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                            <b style={{ color: a.name === it.consult.bestAngle ? 'var(--desk-green)' : 'var(--text-primary)' }}>
                              {a.name === it.consult.bestAngle ? '⭐ ' : '• '}{a.name}
                            </b> — {a.how}{a.risk ? <span style={{ color: 'var(--desk-red)' }}> ⚠ {a.risk}</span> : ''}
                          </div>
                        ))}
                        {it.consult.doNot && <div style={{ fontSize: 12, color: 'var(--desk-red)', marginTop: 4 }}>🚫 ห้าม: {it.consult.doNot}</div>}
                      </div>
                    )}
                    {(it.goldenMoments || []).length > 0 && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                        {it.goldenMoments.map((g, gi) => (
                          <div key={gi} style={{ fontSize: 12.5, color: 'var(--desk-cyan)', marginBottom: 4 }}>
                            ⛏️ &ldquo;{g.quote}&rdquo; <span style={{ color: 'var(--text-muted)' }}>— {g.why}</span>
                          </div>
                        ))}
                        {it.captionSkeleton && <div style={{ fontSize: 12, color: 'var(--desk-blue)', marginTop: 4 }}>📝 โครงเล่า: {it.captionSkeleton}</div>}
                      </div>
                    )}
                    {/* ★ แหล่งภาพของข่าวนี้ — ปิดชั่วคราว (PHOTO_SCOUT_OFF) */}
                    {!PHOTO_SCOUT_OFF && (it.imageSources?.totalLinks > 0 || it.imageSources?.photoBoard?.images?.length > 0) && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--desk-amber)', fontWeight: 700 }}>
                          📸 แหล่งภาพของข่าวนี้ — {it.imageSources.totalLinks} ลิงก์
                          {it.imageSources.photoBoard?.images?.length > 0 && <span> · 🖼️ รูปพร้อมใช้ {it.imageSources.photoBoard.images.length}</span>}
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {String(it.imageSources.event || '').slice(0, 70)}</span>
                        </div>
                        {/* 🏠 ต้นโพสต์จากเครดิต "ขอบคุณภาพจาก" — อัลบั้มเต็มอยู่ที่นี่ */}
                        {(it.imageSources.photoBoard?.originPosts || []).map((op, oi) => (
                          <div key={oi} style={{ marginTop: 5, fontSize: 12.5 }}>
                            <a href={op.url} target="_blank" rel="noreferrer" style={{ color: 'var(--desk-green)', fontWeight: 700, textDecoration: 'none' }}>
                              🏠 ต้นโพสต์: {op.name} — {op.title || op.url}
                            </a>
                          </div>
                        ))}
                        {/* แผงรูป — ✅ ขอบเขียว = คนชัดไม่มีตัวหนังสือเผา (ตา AI คัดแล้ว) */}
                        {it.imageSources.photoBoard?.images?.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                            {it.imageSources.photoBoard.images.map((p, pi) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a key={pi} href={p.img} target="_blank" rel="noreferrer" title={p.clean ? 'คนชัด ไม่มีตัวหนังสือ — ใช้ได้เลย' : p.face ? 'มีคน แต่มีตัวหนังสือ (ครอปหลบได้)' : 'ภาพฉาก/ของ'}
                                style={{ position: 'relative', width: 106, height: 80, borderRadius: 8, overflow: 'hidden', border: p.clean ? '2px solid var(--desk-green)' : '1px solid var(--border)', flexShrink: 0 }}>
                                <img src={p.img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                {p.clean && <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 11 }}>✅</span>}
                              </a>
                            ))}
                          </div>
                        )}
                        {Object.entries(IMG_CHANNELS).filter(([k]) => it.imageSources.channels?.[k]?.length > 0).map(([k, cfg]) => (
                          <div key={k} style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{cfg.icon} {cfg.label} ({it.imageSources.channels[k].length})</div>
                            {it.imageSources.channels[k].slice(0, 6).map((l, li) => (
                              <div key={li} style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                                {l.score != null && <span style={{ color: l.score >= 8 ? 'var(--desk-green)' : 'var(--desk-amber)', fontWeight: 700, flexShrink: 0 }}>[{l.score}]</span>}
                                <a href={l.url} target="_blank" rel="noreferrer"
                                  style={{ color: 'var(--desk-blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {l.title || l.url}
                                </a>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* ★ เนื้อที่เจนเสร็จ — คนหยิบ copy ไปทำโพสต์/ปกได้เลย */}
                {expanded[it.id] && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {expanded[it.id].map((v, vi) => (
                      <div key={vi} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <b style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>เวอร์ชัน {vi + 1}{v.title ? ` — ${String(v.title).slice(0, 60)}` : ''}</b>
                          <button onClick={() => copyText(v.content || v.text || '')}
                            style={{ padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            📋 คัดลอก</button>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
                          {String(v.content || v.text || '')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* ปุ่ม */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a href={it.url} target="_blank" rel="noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>🔗 เปิดลิงก์</a>
                  {it.status !== 'sent' && (
                    <button onClick={() => sendToWorkflow(it)}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                      🚀 ส่งเข้า workflow</button>
                  )}
                  {/* ปุ่มขั้นสูง (ปรึกษา บก./เจาะลึก) ซ่อนใน ⋯ — ลดความรกของการ์ด */}
                  {it.status !== 'sent' && moreBtns[it.id] && !it.consult && (
                    <button onClick={() => consult(it)} disabled={researching['c_' + it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching['c_' + it.id] ? 'wait' : 'pointer', background: 'rgba(139,92,246,0.15)', color: 'var(--desk-purple)', fontSize: 13, fontWeight: 700 }}>
                      {researching['c_' + it.id] ? '⏳ บก.กำลังดู...' : '💼 ปรึกษา บก.'}</button>
                  )}
                  {it.status !== 'sent' && moreBtns[it.id] && it.lane !== 'interview' && !it.research && (
                    <button onClick={() => research(it)} disabled={researching[it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching[it.id] ? 'wait' : 'pointer', background: 'rgba(6,182,212,0.15)', color: 'var(--desk-cyan)', fontSize: 13, fontWeight: 700 }}>
                      {researching[it.id] ? '⏳ กำลังเจาะ...' : '🔬 เจาะลึก'}</button>
                  )}
                  {it.status !== 'sent' && (!it.consult || !it.research) && (
                    <button onClick={() => setMoreBtns(p => ({ ...p, [it.id]: !p[it.id] }))} title="ปุ่มเพิ่มเติม: ปรึกษา บก. / เจาะลึก"
                      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 700 }}>
                      {moreBtns[it.id] ? '✕' : '⋯'}</button>
                  )}
                  {!PHOTO_SCOUT_OFF && (
                    <button onClick={() => scoutImg(it)} disabled={researching['img_' + it.id]}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: researching['img_' + it.id] ? 'wait' : 'pointer', background: 'rgba(245,158,11,0.15)', color: 'var(--desk-amber)', fontSize: 13, fontWeight: 700 }}>
                      {researching['img_' + it.id] ? '⏳ กำลังหาภาพ...' : it.imageSources ? '📸 หาภาพใหม่' : '📸 หาแหล่งภาพ'}</button>
                  )}
                  {it.status === 'new' && (
                    <button onClick={() => act(it.id, 'claim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.2)', color: 'var(--desk-amber)', fontSize: 13, fontWeight: 700 }}>
                      📌 จองข่าวนี้</button>
                  )}
                  {it.status !== 'sent' && (
                    <button onClick={() => act(it.id, it.shortlisted ? 'unshortlist' : 'shortlist')} title="เก็บเข้าคลังส่งเช้า — รวมไว้พรุ่งนี้คัดลอกส่งพนักงานทีเดียว"
                      style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid ' + (it.shortlisted ? 'rgba(234,179,8,0.6)' : 'var(--border)'), cursor: 'pointer', background: it.shortlisted ? 'rgba(234,179,8,0.18)' : 'var(--bg-card)', color: it.shortlisted ? '#ca8a04' : 'var(--text-secondary)', fontSize: 13, fontWeight: 700 }}>
                      {it.shortlisted ? '⭐ เก็บแล้ว' : '☆ เก็บส่งเช้า'}</button>
                  )}
                  {it.status === 'claimed' && it.claimedBy === me && (
                    <button onClick={() => act(it.id, 'unclaim')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13 }}>
                      ↩️ ปล่อยคืน</button>
                  )}
                  {it.status !== 'sent' && (
                    <button onClick={() => act(it.id, 'dismiss')}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: 'var(--desk-red)', fontSize: 13 }}>
                      🗑 ไม่เอา</button>
                  )}
                  {it.status === 'sent' && (
                    <button onClick={() => openVersions(it)}
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: 'var(--desk-green)', fontSize: 13, fontWeight: 700 }}>
                      {expanded[it.id] ? '📕 ปิดเนื้อ' : '📖 เปิดเนื้อที่เจนแล้ว'}</button>
                  )}
                  {it.status === 'sent' && !it.used && (
                    <button onClick={() => act(it.id, 'used')} title="หยิบเนื้อไปทำโพสต์แล้ว — เก็บการ์ดออกจากชั้นวาง"
                      style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, border: '1px solid var(--border)' }}>
                      ✔️ หยิบไปใช้แล้ว</button>
                  )}
                  {/* ปุ่ม 🔥ปัง/🧊แป้ก ถอดออก (คำสั่งทีม 12 มิ.ย. — ไม่มีใครกด) — backend action 'viral'/'flop' ยังอยู่ เผื่อต่อสัญญาณอัตโนมัติในอนาคต */}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
