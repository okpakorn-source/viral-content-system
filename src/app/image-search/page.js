'use client';

// ★ 5 ก.ค. 2026: copy ทั้งระบบจาก C:\Users\User\ระบบทำปกออโต้ (ผู้ใช้สั่ง 'เหมือนเป๊ะ' ยกเว้นส่วนประกอบปก)
import './acsys.css';

import { useEffect, useRef, useState } from 'react';
import { startJob, stopJob, subscribeJob } from '@/lib/jobClient';

export default function Home() {
  const [news, setNews] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [archive, setArchive] = useState([]);
  const [openingId, setOpeningId] = useState('');

  async function loadArchive() {
    try {
      const r = await fetch('/api/cases');
      const j = await r.json();
      if (j.success) setArchive(j.items || []);
    } catch {
      /* เงียบไว้ ไม่ให้ล้มหน้า */
    }
  }

  useEffect(() => {
    loadArchive();
  }, []);

  async function analyze() {
    setError('');
    setResult(null);
    setLoading(true);
    const jobId = startJob('วิเคราะห์ข่าว');
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newsText: news, jobId }),
      });
      const j = await r.json();
      if (!j.success) {
        setError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      } else {
        setResult(j);
        loadArchive();
      }
    } catch (e) {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message);
    } finally {
      stopJob();
      setLoading(false);
    }
  }

  async function openCase(id) {
    setError('');
    setOpeningId(id);
    try {
      const r = await fetch(`/api/cases/${id}`);
      const j = await r.json();
      if (!j.success) setError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setResult(j.case);
        setTimeout(() => {
          document
            .getElementById('result-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
    } catch (e) {
      setError('เปิดเคสไม่สำเร็จ: ' + e.message);
    } finally {
      setOpeningId('');
    }
  }

  const canSubmit = news.trim().length >= 40 && !loading;

  return (
    <div className="acsys"><div className="wrap">
      <ProgressPopup />
      <div className="brand">
        <h1>🖼️ ระบบทำปกออโต้</h1>
        <span className="step">ขั้นที่ 1 — วิเคราะห์ข่าวด้วยสมอง AI</span>
      </div>
      <p className="sub">
        วางเนื้อข่าว "เต็ม" แล้วกดให้สมองที่วิเคราะห์ข่าวเก่งที่สุดอ่านครบทั้งข่าว
        ถอดตัวละคร เนื้อข่าว และบริบท ออกมาตามกรอบตายตัว แล้วเก็บเข้าคลังผลลัพธ์
      </p>

      <div className="card">
        <h2>1) ใส่เนื้อข่าวเต็ม</h2>
        <textarea
          value={news}
          onChange={(e) => setNews(e.target.value)}
          placeholder="วางเนื้อข่าวเต็มที่นี่… (ต้องเป็นเนื้อข่าวจริงแบบครบถ้วน ไม่ใช่เนื้อสั้นตัดทอน)"
        />
        <div className="row">
          <button className="btn" onClick={analyze} disabled={!canSubmit}>
            {loading ? (
              <>
                <span className="spin" />
                กำลังวิเคราะห์…
              </>
            ) : (
              '🧠 วิเคราะห์ด้วยสมอง'
            )}
          </button>
          {news && !loading && (
            <button className="btn-ghost" onClick={() => setNews('')}>
              ล้าง
            </button>
          )}
          <span className="count">{news.trim().length} ตัวอักษร</span>
        </div>
        {error && <div className="err">{error}</div>}
      </div>

      {result && <ResultView key={result.id} data={result} />}

      <div className="card">
        <h2>📁 คลังผลลัพธ์ (ล่าสุด)</h2>
        <p className="count" style={{ marginTop: -4, marginBottom: 10 }}>
          คลิกที่เคสเพื่อดูผลวิเคราะห์เต็ม + คีย์เวิร์ดที่สกัดไว้ ย้อนหลังได้ทุกใบ
        </p>
        {archive.length === 0 ? (
          <p className="count">ยังไม่มีเคสในคลัง</p>
        ) : (
          archive.map((c) => (
            <div
              className={'archive-item clickable' + (result?.id === c.id ? ' active' : '')}
              key={c.id}
              onClick={() => openCase(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openCase(c.id)}
            >
              <span className="id">{c.id}</span>
              <span className="snip">{c.headline || c.newsSnippet}</span>
              <span className="count">{openingId === c.id ? 'กำลังเปิด…' : c.tone}</span>
            </div>
          ))
        )}
      </div>

    </div></div>
  );
}

function ResultView({ data }) {
  const a = data.analysis || {};
  const c = a.content || {};
  const ctx = a.context || {};

  const [kw, setKw] = useState(data.keywords || null);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState('');

  const [images, setImages] = useState([]);
  const [imgStats, setImgStats] = useState({ total: 0, byPlatform: {} });
  const [imgLoading, setImgLoading] = useState('');
  const [imgError, setImgError] = useState('');
  const [imgInfo, setImgInfo] = useState('');
  const [handle, setHandle] = useState('');
  // ★ 6 ก.ค. (ผู้ใช้สั่ง): ติ๊กคีย์เวิร์ดออกได้ (ชุดที่ไม่ใช้ค้น) + วางลิงก์คลิปให้เครื่องทีมแคปเฟรมเจาะจง
  const [qOff, setQOff] = useState(() => new Set());
  const toggleQ = (t) => setQOff((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const [clipLink, setClipLink] = useState('');
  const uploadRef = useRef(null);
  // ค้นหลายแหล่งพร้อมกัน (ติ๊กเลือก → จัดคิวค้นทีละแหล่ง)
  const [batchSel, setBatchSel] = useState(() => new Set(['google', 'google_news', 'facebook', 'tiktok']));

  // โหลดคลังรูปที่เคยค้นไว้ของเคสนี้ (ดูย้อนหลัง)
  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const r = await fetch(`/api/images/${data.id}`);
        const j = await r.json();
        if (ok && j.success) {
          setImages(j.images || []);
          setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        }
      } catch {
        /* เงียบ ไม่ให้ล้ม */
      }
    })();
    return () => {
      ok = false;
    };
  }, [data.id]);

  // ★ 6 ก.ค. รอบ 5 (ผู้ใช้สั่ง): 🎯 เรดาร์คลิป — ยาข่าวชาวบ้าน: หน้าชัดในคลังน้อย → หาคลิป/Lens/เพจต้นทางให้เอง
  const [radar, setRadar] = useState(null);
  const radarFired = useRef(false);
  async function runClipRadar(auto = true) {
    try {
      const r = await fetch('/api/images/clip-radar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id }),
      });
      const j = await r.json();
      if (!j.success) return;
      setRadar(j);
      if (auto && j.needMore && !radarFired.current) {
        radarFired.current = true;
        // อัตโนมัติ: Lens จากหน้าที่ยืนยันแล้ว (เร็ว ได้คนเดิมเพิ่ม) → แล้วส่งแคปคลิปแรกเข้าคิวเครื่องทีม
        if (j.canLens) await searchPlatform('reverse');
        if (j.clips && j.clips.length) searchPlatform('youtube', { clipUrl: j.clips[0].link });
      }
    } catch {
      /* เงียบ */
    }
  }

  // ★ 6 ก.ค.: เฝ้างานแคปเฟรมบนเครื่องทีม — เสร็จเมื่อไหร่ดึงรูปเข้าจอเองทันที (พนักงานไม่ต้องรีเฟรช)
  function watchYtJob(ytJobId) {
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      if (tries > 120) { clearInterval(timer); return; } // เฝ้าสูงสุด ~30 นาที
      try {
        const r = await fetch('/api/images/youtube-jobs');
        const j = await r.json();
        const jobs = j.jobs || [];
        const job = jobs.find((x) => x.id === ytJobId);
        if (!job) return;
        // ★ สถานะสดทุกขั้น: รอคิวบอกอันดับ · กำลังรันบอกขั้นตอนจริงจากเครื่องทีม
        if (job.status === 'pending') {
          const active = jobs.filter((x) => x.status === 'pending' || x.status === 'running');
          const pos = active.findIndex((x) => x.id === ytJobId) + 1;
          setImgInfo(`🕐 YouTube รอคิวบนเครื่องทีม${pos > 1 ? ` — อันดับ ${pos} (มีงานคนอื่นก่อนหน้า)` : ' — ใกล้ถึงคิวแล้ว'}`);
          return;
        }
        if (job.status === 'running') {
          const pg = job.progress;
          setImgInfo(pg ? `⚙️ เครื่องทีมกำลังทำ: ${pg.step}${pg.detail ? ' — ' + pg.detail : ''}` : '⚙️ เครื่องทีมกำลังเริ่มงานแคปเฟรม…');
          return;
        }
        clearInterval(timer);
        if (job.status === 'done') {
          const ri = await fetch(`/api/images/${data.id}`);
          const ji = await ri.json();
          if (ji.success) {
            setImages(ji.images || []);
            setImgStats({ total: ji.total, byPlatform: ji.byPlatform || {} });
          }
          setImgInfo(`✅ เครื่องทีมแคปเฟรม YouTube เสร็จแล้ว — เพิ่ม ${job.added ?? '?'} เฟรมเข้าคลัง (ดูในแกลเลอรีได้เลย)`);
        } else {
          setImgError('เครื่องทีมแคปเฟรม YouTube ไม่สำเร็จ: ' + (job.error || 'ไม่ทราบสาเหตุ'));
        }
      } catch {
        /* เงียบ — รอบหน้าลองใหม่ */
      }
    }, 15000);
  }

  async function searchPlatform(platform, extra = {}) {
    setImgError('');
    setImgLoading(platform);
    const jobId = startJob(platform === 'youtube' ? 'แคปเฟรม YouTube' : platform === 'reverse' ? 'ค้นย้อนกลับ' : 'ค้นภาพ ' + platform);
    try {
      const endpoint =
        platform === 'youtube' ? '/api/images/youtube'
        : platform === 'reverse' ? '/api/images/reverse'
        : platform === 'instagram' || platform === 'facebook_profile' ? '/api/images/profile'
        : '/api/images/search';
      const payload = { caseId: data.id, platform, jobId, ...(qOff.size ? { excludeQueries: [...qOff] } : {}), ...extra };
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.success) {
        // แนบรายละเอียด log (เช่น YouTube: แต่ละคลิปล้มเพราะอะไร) ให้ผู้ใช้เห็น
        const detail = Array.isArray(j.log) && j.log.length ? '\n• ' + j.log.join('\n• ') : '';
        setImgError(`[${j.errorType || 'ERROR'}] ${j.error}${detail}`);
      } else if (j.queued) {
        // ★ 6 ก.ค.: เว็บแคปเฟรมเองไม่ได้ → ฝากงานให้เครื่องทีมรันอัตโนมัติ + เฝ้าจนเสร็จ
        setImgInfo(j.message || '🕐 ส่งงานไปรันบนเครื่องทีมแล้ว — เสร็จแล้วรูปจะเข้าคลังเอง');
        if (j.ytJobId) watchYtJob(j.ytJobId);
      } else {
        if (j.images) setImages(j.images);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        const vetMsg = j.vetOn ? ` · 👁️ กรองรูปไม่เกี่ยวออก ${j.vetDropped}` : '';
        if (j.added === 0) setImgError(`ไม่พบรูปใหม่จาก ${platform} (อาจซ้ำของเดิม${j.vetOn && j.vetDropped ? ` · ตากรองไม่เกี่ยวออก ${j.vetDropped}` : ''})`);
        else {
          setImgInfo(`✅ ค้น ${PLATFORM_LABEL[platform] || platform}: เพิ่มรูปที่เกี่ยว ${j.added}${vetMsg}${j.blockedCatalog ? ` · กันแคตตาล็อก ${j.blockedCatalog}` : ''}`);
          if (j.errors && j.errors.length) setImgError(`บางคำค้นล้มเหลว ${j.errors.length} รายการ`);
        }
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      stopJob();
      setImgLoading('');
    }
  }

  function toggleBatch(p) {
    setBatchSel((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  }

  // ค้น "หลายแหล่ง" ตามที่ติ๊กเลือก — ★ 8 ก.ค. (เร่งค้นภาพ แก้ 4): ยิงขนานครั้งละ SRC_CONC แหล่ง
  //   (เดิมต่อคิวทีละแหล่ง เวลารวม = บวกกันทุกแหล่ง → ขนานแล้วเวลารวม ≈ แหล่งที่ช้าสุด)
  //   ใช้ job เดียวทั้งชุด เพราะ jobClient เป็นตัวเดียวทั้งหน้า ห้ามให้แต่ละแหล่งแย่ง start/stop กัน
  //   ปรับ SRC_CONC = 1 เพื่อกลับพฤติกรรมต่อคิวแบบเดิม
  const SRC_CONC = 3;
  async function runBatch() {
    const list = SEARCH_SOURCES.filter((s) => batchSel.has(s.p)).map((s) => s.p);
    if (list.length === 0) {
      setImgError('ยังไม่ได้เลือกแหล่ง — ติ๊กอย่างน้อย 1 แหล่ง');
      return;
    }
    setImgError('');
    setImgInfo('');
    setImgLoading('batch');
    let totalAdded = 0;
    let doneCount = 0;
    const fails = [];
    const queuedMsgs = []; // ★ 6 ก.ค.: แหล่งที่ฝากงานให้เครื่องทีมรัน (YouTube บนเว็บ)
    const active = new Set();
    const jobId = startJob('ค้นภาพหลายแหล่ง');
    const report = () => {
      const doing = [...active].map((x) => PLATFORM_LABEL[x] || x).join(', ');
      setImgInfo(`⏳ ค้นขนาน — เสร็จ ${doneCount}/${list.length}${doing ? ` · กำลังค้น: ${doing}` : ''} … เพิ่มแล้ว ${totalAdded} รูป`);
    };
    async function searchOne(p) {
      const label = PLATFORM_LABEL[p] || p;
      active.add(p);
      report();
      try {
        const endpoint = p === 'youtube' ? '/api/images/youtube' : '/api/images/search';
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: data.id, platform: p, jobId, ...(qOff.size ? { excludeQueries: [...qOff] } : {}) }),
        });
        const j = await r.json();
        if (j.success) {
          if (j.queued) {
            queuedMsgs.push(`${label}: ${j.message || 'ส่งไปรันบนเครื่องทีมแล้ว'}`);
            if (j.ytJobId) watchYtJob(j.ytJobId);
          }
          if (j.images) setImages(j.images);
          if (j.total !== undefined) setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
          totalAdded += j.added || 0;
        } else {
          fails.push(`${label}: ${j.error || 'ล้มเหลว'}`);
        }
      } catch (e) {
        fails.push(`${label}: ${e.message}`);
      } finally {
        active.delete(p);
        doneCount++;
        report();
      }
    }
    let next = 0;
    const workers = Array.from({ length: Math.min(SRC_CONC, list.length) }, async () => {
      while (next < list.length) {
        const p = list[next++];
        await searchOne(p);
      }
    });
    await Promise.all(workers);
    stopJob();
    // ★ ขนานเสร็จ: ดึงคลังรอบสุดท้าย — response ที่มาถึงช้าสุดอาจถือ snapshot เก่ากว่าของจริง
    try {
      const ri = await fetch(`/api/images/${data.id}`);
      const ji = await ri.json();
      if (ji.success) {
        setImages(ji.images || []);
        setImgStats({ total: ji.total, byPlatform: ji.byPlatform || {} });
      }
    } catch {
      /* เงียบ — ใช้ snapshot ล่าสุดที่มีอยู่ */
    }
    setImgLoading('');
    setImgInfo(`✅ ค้นครบ ${list.length} แหล่ง — เพิ่มรูปใหม่รวม ${totalAdded} รูป${queuedMsgs.length ? `\n🕐 ${queuedMsgs.join(' · ')}` : ''}${fails.length ? ` · ล้มเหลว ${fails.length} แหล่ง` : ''}`);
    if (fails.length) setImgError('บางแหล่งล้มเหลว:\n• ' + fails.join('\n• '));
    runClipRadar(true); // 🎯 หน้าชัดพอไหม — ไม่พอจะหาคลิป/Lens ให้เอง
  }

  async function clearPlatform(platform) {
    setImgError('');
    setImgInfo('');
    setImgLoading('clear:' + platform);
    try {
      const r = await fetch('/api/images/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, platform }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`เคลียร์ ${PLATFORM_LABEL[platform] || platform} แล้ว (ลบ ${j.removed} รูป เหลือ ${j.total})`);
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      setImgLoading('');
    }
  }

  async function cleanJunk() {
    setImgError('');
    setImgInfo('');
    setImgLoading('clean');
    const jobId = startJob('คัดขยะออก (AI)');
    try {
      const r = await fetch('/api/images/clean', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, jobId }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`🧹 คัดขยะออก ${j.removed} รูป (สแกน ${j.scanned} · เหลือ ${j.total})`);
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      stopJob();
      setImgLoading('');
    }
  }

  async function sortEmotions() {
    setImgError('');
    setImgInfo('');
    setImgLoading('emotions');
    const jobId = startJob('แยกอารมณ์ภาพ (AI)');
    try {
      const r = await fetch('/api/images/emotions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, jobId }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`🎭 แยกอารมณ์แล้ว ${j.classified} รูป — กดชิปอารมณ์ใต้แกลเลอรีเพื่อดูแต่ละหมวด`);
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      stopJob();
      setImgLoading('');
    }
  }

  // 🧠 คัดกรองคลังทั้งใบ (Full Library Triage) — วนเรียก endpoint ทีละก้อนจนครบ แล้วโหลดคลังใหม่ (ให้ป้ายโผล่)
  async function runTriage() {
    setImgError('');
    setImgInfo('');
    setImgLoading('triage');
    const jobId = startJob('คัดกรองคลัง (AI)');
    try {
      let done = false;
      let guard = 0;
      let last = null;
      while (!done && guard < 80) {
        guard++;
        const r = await fetch('/api/images/triage', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: data.id, jobId }),
        });
        const j = await r.json();
        if (!j.success) {
          setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
          break;
        }
        last = j;
        done = j.done;
        const tagged = (j.summary?.relevant || 0) + (j.summary?.junk || 0);
        setImgInfo(`🧠 คัดกรองคลัง… ติดป้าย ${tagged}/${j.summary?.total || 0} · เหลือ ${j.remaining}`);
      }
      if (last?.summary) {
        setImgInfo(`🧠 คัดกรองคลังเสร็จ — เกี่ยวข้อง ${last.summary.relevant} · ขยะ/ไม่เกี่ยว ${last.summary.junk} · จากทั้งหมด ${last.summary.total} (กดชิป "คน/หมวด" ใต้แกลเลอรีเพื่อกรอง)`);
      }
      const rr = await fetch(`/api/images/${data.id}`);
      const jj = await rr.json();
      if (jj.images) setImages(jj.images);
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      stopJob();
      setImgLoading('');
    }
  }

  async function uploadToLibrary(fileList) {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    setImgError('');
    setImgInfo('');
    setImgLoading('upload');
    try {
      const dataUrls = await Promise.all(
        files.map(
          (f) =>
            new Promise((res) => {
              const rd = new FileReader();
              rd.onload = () => res(rd.result);
              rd.onerror = () => res(null);
              rd.readAsDataURL(f);
            })
        )
      );
      const imgs = dataUrls.filter(Boolean);
      const r = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, images: imgs }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`⬆️ อัปโหลดเข้าคลัง ${j.added} รูป (แล้วกด 🔁 ค้นเพิ่มจากรูปนี้ได้)`);
      }
    } catch (e) {
      setImgError('อัปโหลดไม่สำเร็จ: ' + e.message);
    } finally {
      setImgLoading('');
    }
  }

  async function reverseFrom(imageUrl) {
    setImgError('');
    setImgInfo('');
    setImgLoading('reverse');
    try {
      const r = await fetch('/api/images/reverse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, seedImageUrl: imageUrl }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`🔁 ค้นเพิ่มจากรูปนี้ได้ ${j.added} รูป`);
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      setImgLoading('');
    }
  }

  async function removeImages(mode, ids) {
    setImgError('');
    setImgInfo('');
    const body = mode === 'keep' ? { caseId: data.id, keepIds: ids } : { caseId: data.id, removeIds: ids };
    try {
      const r = await fetch('/api/images/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
        setImgInfo(`ลบ ${j.removed} รูป เหลือ ${j.total}`);
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    }
  }

  async function searchProfile(network, profileId) {
    if (!profileId) { setImgError('ใส่ username/ลิงก์โปรไฟล์ก่อน'); return; }
    setImgError('');
    setImgLoading(network === 'instagram' ? 'instagram' : 'facebook_profile');
    try {
      const r = await fetch('/api/images/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, network, profileId }),
      });
      const j = await r.json();
      if (!j.success) setImgError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else {
        setImages(j.images || []);
        setImgStats({ total: j.total, byPlatform: j.byPlatform || {} });
      }
    } catch (e) {
      setImgError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      setImgLoading('');
    }
  }

  async function extractKeywords() {
    setKwError('');
    setKwLoading(true);
    try {
      const r = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: data.id, analysis: a, newsText: data.newsText }),
      });
      const j = await r.json();
      if (!j.success) setKwError(`[${j.errorType || 'ERROR'}] ${j.error}`);
      else setKw(j.keywords);
    } catch (e) {
      setKwError('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally {
      setKwLoading(false);
    }
  }

  return (
    <div className="card result" id="result-card">
      <h3>
        ผลวิเคราะห์ · {data.id}
        {data.createdAt && (
          <span className="count"> · {new Date(data.createdAt).toLocaleString('th-TH')}</span>
        )}
      </h3>
      <div className="kv">
        <span className="k">แก่นข่าว</span>
        <span>{a.headline}</span>
        <span className="k">สรุป</span>
        <span>{a.summary}</span>
        <span className="k">ความมั่นใจ</span>
        <span>{a.confidence || '-'}</span>
      </div>

      <h3>ตัวละคร</h3>
      {(a.characters || []).length === 0 && <p className="count">— ไม่พบตัวละครที่ระบุชัด —</p>}
      {(a.characters || []).map((p, i) => (
        <div className="person" key={i}>
          <span className="name">{p.name}</span>
          <span className="role">{p.role}</span>
          <span className="chip">เพศ: {p.gender || 'ไม่ระบุ'}</span>
          {(p.descriptors || []).map((d, j) => (
            <span className="chip" key={j}>
              {d}
            </span>
          ))}
          {p.evidence && <div className="ev">“{p.evidence}”</div>}
        </div>
      ))}

      <h3>เนื้อข่าว</h3>
      <div className="kv">
        <span className="k">เกิดอะไรขึ้น</span>
        <span>{c.what_happened}</span>
        <span className="k">สถานที่</span>
        <span>{c.location}</span>
        <span className="k">เวลา</span>
        <span>{c.time}</span>
      </div>
      {(c.key_events || []).length > 0 && (
        <>
          <div className="k" style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>
            ลำดับเหตุการณ์
          </div>
          <ul className="clean">
            {c.key_events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {(c.numbers_facts || []).length > 0 && (
        <div>
          {c.numbers_facts.map((n, i) => (
            <span className="chip" key={i}>
              {n}
            </span>
          ))}
        </div>
      )}

      <h3>บริบท</h3>
      <div className="kv">
        <span className="k">ภูมิหลัง</span>
        <span>{ctx.background}</span>
        <span className="k">ทำไมน่าสนใจ</span>
        <span>{ctx.why_notable}</span>
        <span className="k">โทนอารมณ์</span>
        <span className="tone">{ctx.emotional_tone}</span>
        <span className="k">หลักฐานโทน</span>
        <span>{ctx.tone_evidence}</span>
        <span className="k">โมเมนต์สำคัญ</span>
        <span>{ctx.key_moment}</span>
      </div>

      {(a.missing_info || []).length > 0 && (
        <>
          <h3>ข้อมูลที่ข่าวไม่ได้ระบุ</h3>
          <ul className="clean">
            {a.missing_info.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}

      <div className="kw-action">
        <button className="btn" onClick={extractKeywords} disabled={kwLoading}>
          {kwLoading ? (
            <>
              <span className="spin" />
              กำลังสกัดคีย์เวิร์ด…
            </>
          ) : kw ? (
            '🔄 สกัดคีย์เวิร์ดใหม่'
          ) : (
            '🔎 วิเคราะห์คีย์เวิร์ดค้นหาภาพ'
          )}
        </button>
        <span className="count">สกัดคำค้นภาพจากเนื้อหา จุดสำคัญ และบริบททั้งหมด</span>
      </div>
      {kwError && <div className="err">{kwError}</div>}
      {kw && <KeywordView kw={kw} qOff={qOff} onToggleQ={toggleQ} />}

      {kw && (
        <div className="imgsec">
          {/* ค้นหลายแหล่งพร้อมกัน — ติ๊กเลือกแล้วกดค้นทีเดียว จัดคิวทีละแหล่ง */}
          <div className="src-multi">
            <span className="src-multi-title">🔍 ค้นหลายแหล่งพร้อมกัน (ติ๊กเลือก):</span>
            <div className="src-multi-chks">
              {SEARCH_SOURCES.map((s) => (
                <label key={s.p} className={'src-chk' + (batchSel.has(s.p) ? ' on' : '')}>
                  <input type="checkbox" checked={batchSel.has(s.p)} disabled={!!imgLoading} onChange={() => toggleBatch(s.p)} />
                  {s.label}
                </label>
              ))}
            </div>
            <div className="src-multi-actions">
              <button className="btn-src accent" disabled={!!imgLoading || batchSel.size === 0} onClick={runBatch}>
                {imgLoading === 'batch' ? (<><span className="spin" />กำลังค้นชุด…</>) : `🚀 ค้นแหล่งที่เลือก (${batchSel.size})`}
              </button>
              <button className="btn-src" disabled={!!imgLoading} onClick={() => setBatchSel(new Set(SEARCH_SOURCES.map((s) => s.p)))}>เลือกทั้งหมด</button>
              <button className="btn-src" disabled={!!imgLoading} onClick={() => setBatchSel(new Set())}>ล้าง</button>
            </div>
          </div>
          <div className="src-bar-sep">— หรือค้นทีละแหล่ง —</div>
          <div className="src-bar">
            {SEARCH_SOURCES.filter((s) => s.p !== 'youtube').map((s) => (
              <button key={s.p} className="btn-src" disabled={!!imgLoading} onClick={() => searchPlatform(s.p)}>
                {imgLoading === s.p ? (<><span className="spin" />กำลังค้น…</>) : s.label}
              </button>
            ))}
            <button className="btn-src" disabled={!!imgLoading} onClick={() => searchPlatform('youtube')}>
              {imgLoading === 'youtube' ? (<><span className="spin" />แคปเฟรม…</>) : '▶️ YouTube (แคปเฟรม)'}
            </button>
            <button className="btn-src accent" disabled={!!imgLoading} onClick={() => searchPlatform('reverse')}>
              {imgLoading === 'reverse' ? (<><span className="spin" />ค้นย้อนกลับ…</>) : '🔁 ค้นย้อนกลับ (Lens)'}
            </button>
            <button className="btn-src accent" disabled={!!imgLoading} onClick={() => uploadRef.current?.click()}>
              {imgLoading === 'upload' ? (<><span className="spin" />อัปโหลด…</>) : '⬆️ อัปโหลดรูปเข้าคลัง'}
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                uploadToLibrary(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <div className="src-profile">
            <input
              className="src-input"
              placeholder="username หรือลิงก์โปรไฟล์ IG/FB (เช่น bestrw หรือ instagram.com/bestrw)"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <button className="btn-src" disabled={!!imgLoading} onClick={() => searchProfile('instagram', handle)}>
              {imgLoading === 'instagram' ? (<><span className="spin" />…</>) : '📸 IG'}
            </button>
            <button className="btn-src" disabled={!!imgLoading} onClick={() => searchProfile('facebook', handle)}>
              {imgLoading === 'facebook_profile' ? (<><span className="spin" />…</>) : '📘 FB โปรไฟล์'}
            </button>
          </div>
          {/* ★ 6 ก.ค. (ผู้ใช้สั่ง): วางลิงก์คลิป FB/YouTube/TikTok/IG → เครื่องทีมถอดคลิปแล้วแคปเฟรมสำคัญตามบริบทข่าว */}
          <div className="src-profile">
            <input
              className="src-input"
              placeholder="🎬 วางลิงก์คลิป FB / YouTube / TikTok / IG — ให้ AI แคปเฟรมสำคัญจากคลิปนี้ตามบริบทข่าว"
              value={clipLink}
              onChange={(e) => setClipLink(e.target.value)}
            />
            <button
              className="btn-src"
              disabled={!!imgLoading || !/^https?:\/\//.test(clipLink.trim())}
              onClick={() => { searchPlatform('youtube', { clipUrl: clipLink.trim() }); }}
              title="ส่งไปเครื่องทีม: ถอดคลิปนี้ → แคปเฟรมอารมณ์/เฟรมสำคัญตามคีย์เวิร์ดข่าว → เข้าคลังเอง"
            >
              🎯 แคปเฟรมจากคลิปนี้
            </button>
          </div>
          <span className="count">
            ข่าว (Google News) ตรงประเด็น · Yandex เก่งหาคน · 🔁 ค้นย้อนกลับจากภาพในคลัง = เจอคนคนเดิมเป๊ะ · IG/FB ต้องรู้ username · 🎬 วางลิงก์คลิป = เจาะเฟรมจากคลิปเดียวตรงๆ
          </span>
          {imgError && <div className="err" style={{ whiteSpace: 'pre-line' }}>{imgError}</div>}
          {imgInfo && <div className="info-box">{imgInfo}</div>}
          {/* ★ 6 ก.ค. รอบ 5: 🎯 แผงเรดาร์คลิป — ข่าวชาวบ้านหน้าชัดน้อย ระบบหาคลิป/เพจให้เอง */}
          {radar && (
            <div className="info-box" style={{ marginTop: 8 }}>
              <b>🎯 เรดาร์คลิป:</b> หน้าชัดในคลัง {radar.faceCount}/{radar.faceMin} ใบ
              {radar.emotionCount !== undefined ? ` · อารมณ์ ${radar.emotionCount}/${radar.emoMin} แบบ${radar.emotions?.length ? ` (${radar.emotions.join(', ')})` : ''}` : ''}
              {(radar.perPerson || []).length > 0 && ` · รายคน: ${radar.perPerson.map((p) => `${p.name} ${p.faces}`).join(' / ')}`}
              {radar.needMore
                ? ` — ยังไม่พอ${(radar.missingPersons || []).length ? ` (ขาด: ${radar.missingPersons.join(', ')})` : ''} ล่าต่อ: ${radar.canLens ? 'ยิงค้นย้อนกลับให้แล้ว · ' : ''}${radar.clips?.length ? 'ส่งแคปคลิปแรกเข้าคิวแล้ว · คลิปอื่นกดเพิ่มได้:' : 'ไม่เจอคลิปเพิ่ม — ลองวางลิงก์คลิปเอง'}`
                : ' — ✅ ครบเกณฑ์ทั้งจำนวน อารมณ์ และรายคน'}
              {radar.needMore &&
                (radar.clips || []).map((v, i) => (
                  <div key={i} style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn-src" disabled={!!imgLoading} onClick={() => searchPlatform('youtube', { clipUrl: v.link })}>
                      🎬 แคป
                    </button>
                    <a href={v.link} target="_blank" rel="noreferrer" className="count" style={{ textDecoration: 'underline' }}>
                      {(v.title || v.link).slice(0, 60)}
                    </a>
                    <span className="count">{v.channel} {v.length}</span>
                  </div>
                ))}
              {(radar.pageNames || []).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <span className="count">เพจ/รายการที่พบในข่าว (กดเพื่อใส่ช่องโปรไฟล์): </span>
                  {radar.pageNames.map((n, i) => (
                    <button key={i} className="btn-src" style={{ marginRight: 6 }} onClick={() => setHandle(n)}>
                      📘 {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {imgStats.total > 0 && (
            <div className="src-bar" style={{ marginTop: 10 }}>
              <button className="btn-src accent" disabled={!!imgLoading} onClick={runTriage} title="ตาดูทุกรูปในคลัง → ติดป้าย เกี่ยว/ขยะ + คน + หมวด + คุณภาพ (ทำครั้งเดียว เก็บถาวร)">
                {imgLoading === 'triage' ? (<><span className="spin" />กำลังคัดกรองคลัง…</>) : '🧠 คัดกรองคลัง (AI)'}
              </button>
              <button className="btn-src accent" disabled={!!imgLoading} onClick={cleanJunk}>
                {imgLoading === 'clean' ? (<><span className="spin" />กำลังสแกนขยะ…</>) : '🧹 คัดขยะออก (AI)'}
              </button>
              <button className="btn-src" disabled={!!imgLoading} onClick={() => runClipRadar(false)} title="เช็คว่าหน้าชัดพอไหม + หาคลิป/เพจต้นทางให้ (ไม่ยิงอัตโนมัติ)">
                🎯 เรดาร์คลิป
              </button>
              <button className="btn-src accent" disabled={!!imgLoading} onClick={sortEmotions}>
                {imgLoading === 'emotions' ? (<><span className="spin" />กำลังแยกอารมณ์…</>) : '🎭 แยกอารมณ์ (AI)'}
              </button>
              {Object.keys(imgStats.byPlatform || {}).map((p) => (
                <button key={p} className="btn-src" disabled={!!imgLoading} onClick={() => clearPlatform(p)}>
                  {imgLoading === 'clear:' + p ? (<><span className="spin" />…</>) : `🗑️ ${PLATFORM_LABEL[p] || p} (${imgStats.byPlatform[p]})`}
                </button>
              ))}
              <button className="btn-src" disabled={!!imgLoading} onClick={() => clearPlatform('all')}>
                {imgLoading === 'clear:all' ? (<><span className="spin" />…</>) : '🗑️ ทั้งหมด'}
              </button>
            </div>
          )}

          <ImageGallery images={images} stats={imgStats} onRemove={removeImages} onReverseFrom={reverseFrom} />
        </div>
      )}

      <div className="meta">
        สมอง: {data.meta?.provider} · {data.meta?.model} · schema {data.meta?.schema}
      </div>

      <details className="raw">
        <summary>ดู JSON ดิบ</summary>
        <pre>{JSON.stringify(a, null, 2)}</pre>
      </details>
    </div>
  );
}

function ProgressPopup() {
  const [s, setS] = useState({ active: false });
  useEffect(() => subscribeJob(setS), []);
  if (!s.active) return null;
  const p = s.progress || {};
  const pct = typeof p.pct === 'number' ? Math.min(100, Math.max(3, p.pct)) : null;
  return (
    <div className="job-pop">
      <div className="job-card">
        <div className="job-head">
          <span className="spin" />
          {s.label || 'กำลังทำงาน'}
        </div>
        <div className="job-step">{p.step || 'กำลังเริ่ม…'}</div>
        {p.detail && <div className={'job-detail' + (p.retry ? ' retry' : '')}>{p.detail}</div>}
        {pct !== null && (
          <div className="job-bar">
            <div style={{ width: pct + '%' }} />
          </div>
        )}
        {p.status === 'error' && <div className="job-detail retry">❌ {p.error || 'ผิดพลาด'}</div>}
      </div>
    </div>
  );
}

const EMOTION_ORDER = ['happy', 'laugh', 'sad', 'serious', 'angry', 'shock', 'warm', 'worried', 'context', 'document', 'other'];
const EMOTION_LABEL = {
  happy: '😊 สุข/ยิ้ม',
  laugh: '😄 หัวเราะ',
  sad: '😢 เศร้า/ร้องไห้',
  serious: '😐 จริงจัง/นิ่ง',
  angry: '😠 โกรธ',
  shock: '😲 ตกใจ',
  warm: '🥹 อบอุ่น/ซึ้ง',
  worried: '😟 กังวล/เครียด',
  context: '🏞️ บริบท/ฉาก',
  document: '📄 เอกสาร',
  other: '❓ อื่นๆ',
};

// หมวดภาพจากการคัดกรองคลัง (triage)
const CAT_LABEL = {
  'face-emotional': '😢 หน้าอารมณ์',
  'face-neutral': '🙂 หน้านิ่ง',
  group: '👥 ภาพหมู่',
  context: '🏞️ ฉาก/บริบท',
  document: '📄 เอกสาร',
  other: '❓ อื่นๆ',
};

// ★ 9 ก.ค. เฟส 2.4: badge ขนาดจริง — ให้คนเห็นก่อนเลือก ไม่ต้องรอปกแตกถึงรู้ว่าไฟล์จิ๋ว
//   ลำดับ field: realWidth/realHeight (วัดจริงหลัง rehost/ตาคัด) ก่อน แล้วค่อย width/height (เมื่อไม่ null)
//   ไม่มีทั้งคู่ = ไม่โชว์ badge (วัดไม่ได้ อย่าเดา) · เขียว≥800 / เหลือง 500-799 / แดง<500 หรือ thumbnail-only
function sizeBadgeFor(im) {
  const rw = Number(im.realWidth), rh = Number(im.realHeight);
  const w = Number(im.width), h = Number(im.height);
  const shortSide = (rw > 0 && rh > 0) ? Math.min(rw, rh) : ((w > 0 && h > 0) ? Math.min(w, h) : null);
  if (shortSide == null) return null;
  const thumbOnly = im.rehostQuality === 'thumbnail';
  if (thumbOnly || shortSide < 500) return { label: `จิ๋ว ${shortSide}px`, bg: 'rgba(200,40,40,.85)' };
  if (shortSide < 800) return { label: `${shortSide}px`, bg: 'rgba(180,140,20,.85)' };
  return { label: `${shortSide}px`, bg: 'rgba(30,150,80,.85)' };
}

const PLATFORM_LABEL = {
  google: 'Google',
  google_news: 'Google News',
  yandex: 'Yandex',
  bing: 'Bing',
  bing_news: 'Bing News',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  clip: '🎬 คลิปที่วางเอง', // ★ 6 ก.ค.: เฟรมจากลิงก์คลิปที่ผู้ใช้ระบุ — หมวดแยก เลือกดู/ประเมินง่าย
  reverse: 'ค้นย้อนกลับ',
  instagram: 'Instagram',
};

// แหล่งที่ค้นแบบ "หลายแหล่งพร้อมกัน" ได้ (จัดคิวทีละแหล่ง) — YouTube ช้า (แคปเฟรม) ติ๊กได้แต่กินเวลา
const SEARCH_SOURCES = [
  { p: 'google', label: '🖼️ Google' },
  { p: 'google_news', label: '📰 Google News' },
  { p: 'yandex', label: '🌐 Yandex' },
  { p: 'facebook', label: '📘 FB (เว็บ)' },
  { p: 'tiktok', label: '🎵 TikTok' },
  { p: 'youtube', label: '▶️ YouTube (ช้า)' },
];

function ImageGallery({ images, stats, onRemove, onReverseFrom }) {
  const [filter, setFilter] = useState('all');
  const [emoFilter, setEmoFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all'); // 🧠 กรองตาม "คน" จาก triage
  const [catFilter, setCatFilter] = useState('all'); // 🧠 กรองตาม "หมวด" จาก triage
  const [hideJunk, setHideJunk] = useState(true); // 🧠 ซ่อนภาพขยะเป็นค่าเริ่มต้น (★ DEVIATION ผู้ใช้สั่ง 6 ก.ค. — ต้นฉบับ false)
  const [sceneFilter, setSceneFilter] = useState('all'); // ★ 8 ก.ค. เฟส A: all | news (ภาพข่าวจริง) | file (ภาพแฟ้ม)
  const [lb, setLb] = useState(null); // index ในรายการที่กรองแล้ว
  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const byPlat = stats.byPlatform || {};
  const platforms = Object.keys(byPlat);

  const byEmotion = {};
  for (const im of images) if (im.emotion) byEmotion[im.emotion] = (byEmotion[im.emotion] || 0) + 1;
  const emotions = EMOTION_ORDER.filter((e) => byEmotion[e]);
  const hasEmotion = emotions.length > 0;

  // 🧠 นับป้ายจากการคัดกรองคลัง (triage)
  const byPerson = {};
  const byCat = {};
  let triagedCount = 0;
  let junkCount = 0;
  let fileCount = 0; // ★ 8 ก.ค. เฟส A: จำนวนภาพแฟ้ม (คนถูกแต่มาจากงานอื่น)
  for (const im of images) {
    if (!im.triage) continue;
    triagedCount++;
    if (im.triage.relevant === false) junkCount++;
    if (im.triage.newsScene === false && im.triage.relevant !== false) fileCount++;
    if (im.triage.person) byPerson[im.triage.person] = (byPerson[im.triage.person] || 0) + 1;
    if (im.triage.category) byCat[im.triage.category] = (byCat[im.triage.category] || 0) + 1;
  }
  const persons = Object.keys(byPerson).sort((a, b) => byPerson[b] - byPerson[a]);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const hasTriage = triagedCount > 0;

  const shown = images
    .filter(
      (im) =>
        (filter === 'all' || im.platform === filter) &&
        (emoFilter === 'all' || im.emotion === emoFilter) &&
        (personFilter === 'all' || im.triage?.person === personFilter) &&
        (catFilter === 'all' || im.triage?.category === catFilter) &&
        (sceneFilter === 'all' || (sceneFilter === 'file' ? im.triage?.newsScene === false : im.triage?.newsScene !== false)) &&
        (!hideJunk || im.triage?.relevant !== false)
    )
    // ★ DEVIATION (ผู้ใช้สั่ง 6 ก.ค.): ภาพที่ตายืนยันว่าเกี่ยว+คุณภาพสูง ขึ้นก่อนเสมอ (ต้นฉบับเรียงตามลำดับเก็บ)
    // ★ 8 ก.ค. เฟส A: ภาพข่าวจริง (newsScene) มาก่อนภาพแฟ้มเสมอ
    .sort((a, b) => {
      const ra = a.triage?.relevant === true ? 1 : 0;
      const rb = b.triage?.relevant === true ? 1 : 0;
      if (ra !== rb) return rb - ra;
      const sa = a.triage?.newsScene === false ? 0 : 1;
      const sb = b.triage?.newsScene === false ? 0 : 1;
      if (sa !== sb) return sb - sa;
      return (b.triage?.quality || 0) - (a.triage?.quality || 0);
    });

  useEffect(() => {
    setLb(null); // เปลี่ยนตัวกรอง = ปิด lightbox
  }, [filter, emoFilter, personFilter, catFilter, hideJunk, sceneFilter]);

  useEffect(() => {
    if (lb === null || selMode) return;
    function onKey(e) {
      if (e.key === 'Escape') setLb(null);
      else if (e.key === 'ArrowRight') setLb((i) => (i + 1) % shown.length);
      else if (e.key === 'ArrowLeft') setLb((i) => (i - 1 + shown.length) % shown.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, shown.length, selMode]);

  function toggleSel(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function clickThumb(im, i) {
    if (selMode) toggleSel(im.id);
    else setLb(i);
  }
  async function doRemove(mode) {
    const ids = [...selected];
    if (ids.length === 0 || !onRemove) return;
    setBusy(true);
    try {
      await onRemove(mode, ids);
      setSelected(new Set());
      setSelMode(false);
    } finally {
      setBusy(false);
    }
  }

  if (!images || images.length === 0) {
    return (
      <p className="count" style={{ marginTop: 12 }}>
        ยังไม่มีรูปในคลังเคสนี้ — กดปุ่มด้านบนเพื่อค้นภาพ
      </p>
    );
  }

  return (
    <div className="gallery-wrap">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '16px 0 8px' }}>
        <h3 style={{ margin: 0 }}>🗂️ คลังรูปเคสนี้ · {stats.total} รูป</h3>
        <button className={'btn-src' + (selMode ? ' accent' : '')} onClick={() => { setSelMode((m) => !m); setSelected(new Set()); setLb(null); }}>
          {selMode ? '✕ ออกจากโหมดเลือก' : '☑️ เลือกรูปเอง (ลบ/เก็บ)'}
        </button>
      </div>

      {selMode && (
        <div className="src-bar" style={{ marginBottom: 8, alignItems: 'center' }}>
          <span className="count">เลือกแล้ว {selected.size} รูป · แตะรูปเพื่อติ๊ก</span>
          <button className="btn-src" onClick={() => setSelected(new Set(shown.map((i) => i.id)))}>เลือกทั้งหมดที่แสดง</button>
          <button className="btn-src" onClick={() => setSelected(new Set())}>ล้างเลือก</button>
          <button className="btn-src" disabled={busy || selected.size === 0} onClick={() => doRemove('remove')}>
            {busy ? <span className="spin" /> : '🗑️'} ลบที่เลือก ({selected.size})
          </button>
          <button className="btn-src accent" disabled={busy || selected.size === 0} onClick={() => doRemove('keep')}>
            {busy ? <span className="spin" /> : '✅'} เก็บเฉพาะที่เลือก
          </button>
          {/* ★ 6 ก.ค. (ผู้ใช้สั่ง): ส่งรูปที่ติ๊กไปจัดแทมเพลตปกทันที — ไม่ต้องเซฟลงเครื่อง */}
          <button
            className="btn-src accent"
            disabled={selected.size === 0}
            onClick={() => {
              const picked = images
                .filter((im) => selected.has(im.id))
                .map((im) => ({
                  id: im.id,
                  url: im.imageUrl,
                  thumb: im.thumbnailUrl || im.imageUrl,
                  title: (im.title || '').slice(0, 80),
                  caseId: im.caseId || '',
                }));
              try {
                localStorage.setItem('acs_picked_images', JSON.stringify(picked));
              } catch {
                /* เงียบ */
              }
              window.location.href = '/cover-tester?fromLib=1';
            }}
          >
            🖼️ นำไปใส่แทมเพลต ({selected.size})
          </button>
        </div>
      )}

      <div className="gallery-filter">
        <button className={'fchip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>
          ทั้งหมด {stats.total}
        </button>
        {platforms.map((p) => (
          <button key={p} className={'fchip' + (filter === p ? ' active' : '')} onClick={() => setFilter(p)}>
            {PLATFORM_LABEL[p] || p} {byPlat[p]}
          </button>
        ))}
      </div>
      {hasEmotion && (
        <div className="gallery-filter" style={{ marginTop: -4 }}>
          <span className="count" style={{ alignSelf: 'center', marginRight: 4 }}>อารมณ์:</span>
          <button className={'fchip emo' + (emoFilter === 'all' ? ' active' : '')} onClick={() => setEmoFilter('all')}>
            ทุกอารมณ์
          </button>
          {emotions.map((e) => (
            <button key={e} className={'fchip emo' + (emoFilter === e ? ' active' : '')} onClick={() => setEmoFilter(e)}>
              {EMOTION_LABEL[e] || e} {byEmotion[e]}
            </button>
          ))}
        </div>
      )}
      {hasTriage && (
        <>
          {persons.length > 0 && (
            <div className="gallery-filter" style={{ marginTop: -4 }}>
              <span className="count" style={{ alignSelf: 'center', marginRight: 4 }}>👤 คน:</span>
              <button className={'fchip' + (personFilter === 'all' ? ' active' : '')} onClick={() => setPersonFilter('all')}>ทุกคน</button>
              {persons.map((p) => (
                <button key={p} className={'fchip' + (personFilter === p ? ' active' : '')} onClick={() => setPersonFilter(p)}>{p} {byPerson[p]}</button>
              ))}
            </div>
          )}
          {cats.length > 0 && (
            <div className="gallery-filter" style={{ marginTop: -4 }}>
              <span className="count" style={{ alignSelf: 'center', marginRight: 4 }}>🗂️ หมวด:</span>
              <button className={'fchip' + (catFilter === 'all' ? ' active' : '')} onClick={() => setCatFilter('all')}>ทุกหมวด</button>
              {cats.map((cat) => (
                <button key={cat} className={'fchip' + (catFilter === cat ? ' active' : '')} onClick={() => setCatFilter(cat)}>{CAT_LABEL[cat] || cat} {byCat[cat]}</button>
              ))}
              <button className={'fchip' + (hideJunk ? ' active' : '')} onClick={() => setHideJunk((v) => !v)} title="ซ่อนภาพที่ตาตีว่าไม่เกี่ยวข่าว/ขยะ">
                {hideJunk ? '🙈 ซ่อนขยะแล้ว' : `🗑️ ซ่อนขยะ (${junkCount})`}
              </button>
              {/* ★ 8 ก.ค. เฟส A: กรอง ภาพข่าวจริง / ภาพแฟ้ม (คนถูกแต่มาจากงานอื่น) */}
              {fileCount > 0 && (
                <>
                  <button className={'fchip' + (sceneFilter === 'news' ? ' active' : '')} onClick={() => setSceneFilter((v) => (v === 'news' ? 'all' : 'news'))} title="เฉพาะภาพจากเหตุการณ์ข่าวนี้จริง">
                    📰 ภาพข่าวจริง {triagedCount - junkCount - fileCount}
                  </button>
                  <button className={'fchip' + (sceneFilter === 'file' ? ' active' : '')} onClick={() => setSceneFilter((v) => (v === 'file' ? 'all' : 'file'))} title="ภาพแฟ้ม — คนในข่าวตัวจริงแต่ถ่ายจากงาน/บริบทอื่น">
                    📁 แฟ้ม {fileCount}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      <div className="gallery">
        {shown.map((im, i) => {
          const sb = sizeBadgeFor(im); // ★ 9 ก.ค. เฟส 2.4: badge ขนาดจริง (null = วัดไม่ได้ ไม่โชว์)
          return (
          <button
            className={'thumb' + (selMode && selected.has(im.id) ? ' selected' : '')}
            key={im.id}
            onClick={() => clickThumb(im, i)}
            title={im.title || im.source}
          >
            <img src={im.thumbnailUrl || im.imageUrl} alt={im.title || ''} loading="lazy" style={im.triage?.relevant === false ? { opacity: 0.4 } : undefined} />
            <span className="thumb-plat">{PLATFORM_LABEL[im.platform] || im.platform}</span>
            {/* ★ 9 ก.ค. เฟส 2.4: badge ขนาดจริง มุมขวาบน (ซ่อนตอนโหมดเลือก กันซ้อน thumb-check) */}
            {!selMode && sb && (
              <span className="thumb-plat" style={{ left: 'auto', right: 6, background: sb.bg }} title="ขนาดจริงของไฟล์">{sb.label}</span>
            )}
            {im.emotion && <span className="thumb-emo" title={EMOTION_LABEL[im.emotion]}>{(EMOTION_LABEL[im.emotion] || '').split(' ')[0]}</span>}
            {im.triage?.relevant === false && <span className="thumb-plat" style={{ top: 'auto', bottom: 4, left: 4, background: 'rgba(200,40,40,.85)' }}>🗑️ ขยะ</span>}
            {/* ★ 8 ก.ค. เฟส A: ป้ายภาพแฟ้ม — คนถูกจริงแต่มาจากงาน/บริบทอื่น */}
            {im.triage?.newsScene === false && im.triage?.relevant !== false && (
              <span className="thumb-plat" style={{ top: 'auto', bottom: 4, left: 4, background: 'rgba(180,120,20,.85)' }}>📁 แฟ้ม</span>
            )}
            {im.source && <span className="thumb-src">{im.source}</span>}
            {selMode && <span className="thumb-check">{selected.has(im.id) ? '✓' : ''}</span>}
          </button>
          );
        })}
      </div>
      {lb !== null && !selMode && shown[lb] && (
        <Lightbox
          image={shown[lb]}
          index={lb}
          total={shown.length}
          onClose={() => setLb(null)}
          onPrev={() => setLb((i) => (i - 1 + shown.length) % shown.length)}
          onNext={() => setLb((i) => (i + 1) % shown.length)}
          onReverseFrom={onReverseFrom}
        />
      )}
    </div>
  );
}

function Lightbox({ image, index, total, onClose, onPrev, onNext, onReverseFrom }) {
  return (
    <div className="lb-overlay" onClick={onClose}>
      <div className="lb-box" onClick={(e) => e.stopPropagation()}>
        <div className="lb-top">
          <span className="chip chip-key">{PLATFORM_LABEL[image.platform] || image.platform}</span>
          <span className="lb-src">{image.source || '—'}</span>
          <span className="lb-count">
            {index + 1} / {total}
          </span>
          <button className="lb-close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>
        <div className="lb-imgwrap">
          <button className="lb-nav lb-prev" onClick={onPrev} aria-label="ก่อนหน้า">
            ‹
          </button>
          <img
            className="lb-img"
            src={image.imageUrl || image.thumbnailUrl}
            alt={image.title || ''}
            onError={(e) => {
              if (image.thumbnailUrl && e.target.src !== image.thumbnailUrl) {
                e.target.src = image.thumbnailUrl;
              }
            }}
          />
          <button className="lb-nav lb-next" onClick={onNext} aria-label="ถัดไป">
            ›
          </button>
        </div>
        <div className="lb-bottom">
          {image.title && <div className="lb-title">{image.title}</div>}
          <div className="lb-links">
            <a
              href={image.sourceLink || image.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              🔗 เปิดหน้าต้นทาง
            </a>
            <a href={image.imageUrl} target="_blank" rel="noreferrer" className="btn-ghost">
              🖼️ เปิดรูปเต็ม
            </a>
            {onReverseFrom && (
              <button
                className="btn-ghost"
                onClick={() => {
                  onReverseFrom(image.imageUrl);
                  onClose();
                }}
              >
                🔁 ค้นเพิ่มจากรูปนี้
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const KW_GROUPS = [
  { key: 'queries_th', label: 'คำค้นภาษาไทย' },
  { key: 'queries_en', label: 'คำค้นภาษาอังกฤษ' },
  { key: 'scene_place', label: 'ฉาก / สถานที่' },
  { key: 'moment_action', label: 'โมเมนต์ / แอ็คชัน' },
  { key: 'emotion', label: 'อารมณ์' },
  { key: 'source_show', label: 'รายการ / แหล่งที่มา' },
  { key: 'hashtags', label: 'แฮชแท็ก' },
];

const PLAN_PRIO = { must: '🔴 ต้องมี', should: '🟡 ควรมี', nice: '⚪ มีก็ดี' };
// ★ 6 ก.ค. (ผู้ใช้สั่ง): หมวดที่ถูกใช้ค้นจริง = ติ๊กเปิด/ปิดรายคำได้ (ปิด = ขีดฆ่า ไม่ถูกใช้ค้น)
const KW_SEARCHABLE = new Set(['queries_th', 'queries_en', 'object_queries', 'scene_place', 'moment_action']);

function KeywordView({ kw, qOff, onToggleQ }) {
  const total =
    kw.total_count ??
    KW_GROUPS.reduce((n, g) => n + (kw[g.key]?.length || 0), 0);

  function copyAll() {
    const all = KW_GROUPS.flatMap((g) => kw[g.key] || []);
    if (navigator.clipboard) navigator.clipboard.writeText(all.join('\n'));
  }

  const offCount = qOff ? qOff.size : 0;
  return (
    <div className="kwbox">
      <h3>🔎 คีย์เวิร์ดค้นหาภาพ · {total} คำ{offCount ? ` · ปิดไว้ ${offCount}` : ''}</h3>
      <div className="count" style={{ marginBottom: 6 }}>
        💡 กดที่คำเพื่อ เปิด/ปิด การใช้ค้นจริง — คำที่ขีดฆ่าจะไม่ถูกใช้ (หมวดอารมณ์/แฮชแท็ก/รายการ ไว้ดูประกอบ ไม่ได้ยิงค้นตรง)
      </div>

      {(kw.subjects || []).length > 0 && (
        <div className="kwgroup">
          <div className="kwlabel">ตัวหลักที่ภาพต้องมี</div>
          <div>
            {kw.subjects.map((s, i) => (
              <span className={'chip' + (s.must_have ? ' chip-key' : '')} key={i}>
                {s.name}
                {s.role ? ` · ${s.role}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {KW_GROUPS.map((g) =>
        kw[g.key]?.length > 0 ? (
          <div className="kwgroup" key={g.key}>
            <div className="kwlabel">
              {g.label} <span className="count">({kw[g.key].length})</span>
            </div>
            <div>
              {kw[g.key].map((t, i) => {
                const searchable = KW_SEARCHABLE.has(g.key) && typeof onToggleQ === 'function';
                const off = searchable && qOff && qOff.has(t);
                return (
                  <span
                    className="chip"
                    key={i}
                    onClick={searchable ? () => onToggleQ(t) : undefined}
                    title={searchable ? (off ? 'ถูกปิดไว้ — กดเพื่อใช้ค้นอีกครั้ง' : 'กดเพื่อปิด ไม่ใช้คำนี้ค้น') : undefined}
                    style={searchable ? { cursor: 'pointer', opacity: off ? 0.35 : 1, textDecoration: off ? 'line-through' : 'none' } : undefined}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null
      )}

      <button className="btn-ghost" style={{ marginTop: 12 }} onClick={copyAll}>
        📋 คัดลอกคำค้นทั้งหมด
      </button>
    </div>
  );
}
