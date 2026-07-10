// ============================================================
// 🏭 MEGA Workflow — ตัวเชื่อมสถานี (adapters) เฟส 1: S1 → S4
// ------------------------------------------------------------
// ทุกตัว: อ่านแฟ้มทั้งใบ → เรียก "ท่อเดิม" ตามสัญญาใน _MEGA_PHASE0_MAP.md →
// คืนผลตาม contract กลาง { status, nextAction, summary, dossierPatch, quality }
// 🔴 ไม่แตะโค้ดระบบข่าว: คิว/extract เรียกผ่าน HTTP same-origin แบบเดียวกับโต๊ะข่าว
// ============================================================

import { preflightBrain, compassBrain, judgeBrain, slotDirectorBrain, artBriefBrain } from '@/lib/megaBrains';
import { evaluateCoverQc } from '@/lib/coverQcGate'; // ★ Wave2 A1: ด่าน QC แข็ง — ของเสียไม่เข้าคลัง
// ★ Wave2 Batch B1 (10 ก.ค.): เกณฑ์ตัวเลขคุณภาพภาพ/hero รวมเป็น single source of truth — ค่าเดิมเป๊ะ
import { HERO_MIN_SHORT_SIDE, SHARPNESS_MIN_HERO, GAP_SEARCH_MIN_HERO_PER_PERSON as GAP_SEARCH_MIN_HERO_PER_PERSON_CFG } from '@/lib/imageQualityConfig';

const MEGA_USER = 'mega-bot';
const MIN_EXTRACT_CHARS = parseInt(process.env.MEGA_MIN_EXTRACT_CHARS || '400', 10);
const MAX_S1_ATTEMPTS = 3;

// 🔴 คิวข่าว: queue/add เตะ worker ที่ "origin ของคนส่ง" + กติกาคิว "ข่าว→คลาวด์เท่านั้น" (เครื่องทีมข้าม)
//   บทเรียนเทสทองคำ 7 ก.ค.: ส่งจากเครื่องทีม → ไม่มีใครเตะ Vercel → งานนั่งรอจน Railway คว้า →
//   โดน edge ตัด ~60-90 วิ ตอบ HTML = ล้มเร็วทุกครั้ง · พนักงานรอดเพราะส่งจากเว็บ Vercel (เตะ worker
//   Vercel ทันที) → MEGA ต้องส่งผ่าน Vercel origin เหมือนพนักงานเป๊ะ — override: MEGA_QUEUE_ORIGIN
const QUEUE_ORIGIN_DEFAULT = 'https://viral-content-system.vercel.app';
function queueOrigin() {
  return process.env.MEGA_QUEUE_ORIGIN || QUEUE_ORIGIN_DEFAULT;
}

// ★ 7 ก.ค.: ปิด undici headersTimeout/bodyTimeout ภายใน (default 5 นาที) — ขั้นหาภาพ/วิชั่นช้าเกิน 5 นาทีได้จริง
//   (เช่น search+EyeScreen 5 นาที) → เดิม undici ตัดที่ 5 นาที = "fetch failed"/abort ทั้งที่งานยังไม่เสร็จ
//   ให้ AbortSignal.timeout(timeoutMs) เป็นเพดานเดียวที่คุมจริง
let _undiciDispatcher;
async function _getDispatcher() {
  if (_undiciDispatcher !== undefined) return _undiciDispatcher;
  try { const { Agent } = await import('undici'); _undiciDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 }); }
  catch { _undiciDispatcher = null; }
  return _undiciDispatcher;
}
async function jfetch(url, opts = {}, timeoutMs = 60000) {
  const dispatcher = await _getDispatcher();
  const r = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const j = await r.json().catch(() => ({}));
  return { httpStatus: r.status, ...j };
}

// ---------- S1 คัดข่าว: เลือกการ์ดคะแนนสูงสุดที่ยังว่าง + claim (กันชนพนักงาน) ----------
export async function s1_pick(job, { origin }) {
  const tried = job.dossier.triedCardIds || [];
  const d = await jfetch(`${origin}/api/news-desk?limit=60`);
  if (!d.success) return { status: 'failed', nextAction: 'retry', summary: 'อ่านโต๊ะข่าวไม่ได้: ' + (d.error || d.httpStatus) };

  const cards = (d.items || [])
    .filter((c) => (c.status === 'new' || !c.status) && !tried.includes(c.id))
    .sort((a, b) => (b._sortScore ?? b.finalScore ?? 0) - (a._sortScore ?? a.finalScore ?? 0));

  for (const card of cards.slice(0, 5)) {
    const cl = await jfetch(`${origin}/api/news-desk`, {
      method: 'POST',
      body: JSON.stringify({ action: 'claim', id: card.id, user: MEGA_USER }),
    });
    if (cl.success) {
      return {
        status: 'done',
        nextAction: 'continue',
        summary: `คัด "${(card.title || '').slice(0, 60)}" (เลน ${card.lane || '-'} คะแนน ${card._sortScore ?? card.finalScore ?? '-'})`,
        dossierPatch: {
          desk: {
            cardId: card.id,
            title: card.title || '',
            lane: card.lane || '',
            category: card.category || '',
            score: card._sortScore ?? card.finalScore ?? null,
            judgeReason: card.judgeReason || '',
            url: card.url || card.link || card.sourceUrl || '',
            imageUrl: card.imageUrl || '',
            clipWorthy: !!card.clipWorthy,
            fullText: card.fullText || card.snippet || card.summary || '',
            raw: { hasMainChar: card.hasMainChar, dramaType: card.dramaType, notability: card.notability },
          },
          triedCardIds: [...tried, card.id],
        },
      };
    }
    // 409 ALREADY_CLAIMED → ลองใบถัดไป
  }
  return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีการ์ดว่างที่คะแนนถึงเกณฑ์ให้หยิบ', quality: 'yellow' };
}

// ปล่อยการ์ดคืน (งานตาย/ข้าม — กันการ์ดค้างจอง)
export async function unclaimCard(job, { origin }) {
  const id = job.dossier?.desk?.cardId;
  if (!id) return;
  await jfetch(`${origin}/api/news-desk`, {
    method: 'POST',
    body: JSON.stringify({ action: 'unclaim', id, user: MEGA_USER }),
  }).catch(() => {});
}

// ---------- S1.5 Preflight: ตายเร็ว = ถูก ----------
export async function s1_5_preflight(job, ctx) {
  const card = job.dossier.desk;
  const pf = await preflightBrain({ card });
  const pass = pf.decision === 'pass';
  if (!pass) {
    await unclaimCard(job, ctx);
    const attempts = (job.dossier.s1Attempts || 0) + 1;
    if (attempts < MAX_S1_ATTEMPTS) {
      return {
        status: 'done',
        nextAction: 'goto:s1_pick',
        summary: `ข้าม "${(card?.title || '').slice(0, 40)}" — ${pf.reason} (ลองข่าวใหม่ รอบ ${attempts + 1})`,
        dossierPatch: { preflight: pf, s1Attempts: attempts, desk: null },
      };
    }
    return { status: 'failed', nextAction: 'fail', summary: `ข้ามครบ ${MAX_S1_ATTEMPTS} ข่าวติด — วัตถุดิบไม่พอทั้งหมด`, dossierPatch: { preflight: pf }, quality: 'red' };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ผ่าน (score ${pf.score}) — ${pf.reason}`,
    dossierPatch: { preflight: pf },
  };
}

// ---------- S2 สกัดเนื้อ ----------
export async function s2_extract(job, { origin }) {
  const desk = job.dossier.desk || {};
  let text = '';
  let from = '';
  if (desk.url) {
    const ex = await jfetch(`${origin}/api/extract`, { method: 'POST', body: JSON.stringify({ url: desk.url }) }, 120000);
    if (ex.success && ex.data?.content) {
      text = ex.data.content;
      from = 'extract:' + desk.url.slice(0, 60);
    }
  }
  if (!text && desk.fullText && desk.fullText.length >= MIN_EXTRACT_CHARS) {
    text = desk.fullText; // การ์ดโต๊ะข่าวเก็บเนื้อมาแล้ว (เลน rss/ytwatch)
    from = 'desk-card';
  }
  if (!text || text.length < MIN_EXTRACT_CHARS) {
    // 🛟 สกัดเองไม่ผ่านแต่มี URL → ให้ "ท่อข่าวเดิม" scrape เอง (S3 ส่ง url แทน text — ตัว scrape ของท่อข่าวแกร่งกว่า มี OCR)
    if (desk.url) {
      const stub = [desk.title, desk.fullText].filter(Boolean).join('\n');
      return {
        status: 'done',
        nextAction: 'continue',
        summary: `สกัดเองได้ ${text.length} ตัวอักษร → ส่ง URL ให้ท่อข่าว scrape เอง (เข็มทิศใช้หัวข่าว+snippet ไปก่อน)`,
        dossierPatch: { extract: { text: stub, chars: stub.length, from: 'snippet-fallback', urlOnly: true } },
        quality: 'yellow',
      };
    }
    return { status: 'failed', nextAction: 'fail', summary: `เนื้อสกัดสั้นเกิน (${text.length} ตัวอักษร < ${MIN_EXTRACT_CHARS}) — วัตถุดิบไม่พอ`, quality: 'red' };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ได้เนื้อ ${text.length} ตัวอักษร (${from})`,
    dossierPatch: { extract: { text, chars: text.length, from } },
  };
}

// ---------- S2.5 เข็มทิศเรื่อง ----------
export async function s2_5_compass(job) {
  const compass = await compassBrain({ card: job.dossier.desk, extractText: job.dossier.extract?.text });
  if (compass.contentComplete === false) {
    return {
      status: 'done',
      nextAction: 'continue',
      summary: `เข็มทิศ: ${compass.angle} (⚠️ ขาด: ${(compass.missingFacts || []).join(', ').slice(0, 80)})`,
      dossierPatch: { compass },
      quality: 'yellow',
    };
  }
  return { status: 'done', nextAction: 'continue', summary: `เข็มทิศ: ${compass.angle} · อารมณ์ ${compass.primaryEmotion}`, dossierPatch: { compass } };
}

// ---------- S3 เจนข่าว: ส่งเข้าคิวเดิม (ประตูเดียวกับพนักงาน) ----------
export async function s3_generate(job, { origin }) {
  const ex = job.dossier.extract || {};
  const gen = job.dossier.generate || {};
  // รอบแก้ตัว (คิวล้มรอบแรก): บังคับส่งเป็นเนื้อ text ตรงๆ แทน URL
  const input = gen.forceTextInput
    ? gen.forceTextInput
    : ex.urlOnly && job.dossier.desk?.url
      ? job.dossier.desk.url
      : ex.text;
  // payload เลียนแบบโต๊ะข่าวเป๊ะ (เส้นทางที่พิสูจน์ทุกวัน) — ต่างแค่ editor เป็น mega-bot
  const desk = job.dossier.desk || {};
  const payload = {
    input,
    contentLength: 'short',
    userId: 'desk-mega-bot',
    deskMeta: {
      newsId: desk.cardId || '',
      lane: desk.lane || '',
      category: desk.category || '',
      editor: 'mega-bot',
      editorIcon: '🏭',
      judgeScore: null,
      finalScore: desk.score ?? null,
    },
  };
  const q = await jfetch(`${queueOrigin()}/api/queue/add`, { method: 'POST', body: JSON.stringify(payload) }, 60000);
  if (q.httpStatus === 409) {
    return { status: 'failed', nextAction: 'fail', summary: 'คิวตีเป็นข่าวซ้ำ (NEAR_DUPLICATE) — มีคนทำเรื่องนี้อยู่แล้ว', quality: 'yellow' };
  }
  if (!q.success || !q.jobId) {
    return { status: 'failed', nextAction: 'retry', summary: 'ส่งเข้าคิวไม่สำเร็จ: ' + (q.error || q.httpStatus) };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `เข้าคิวแล้ว job ${String(q.jobId).slice(0, 10)} (อันดับ ${q.position ?? '-'}${q.duplicate ? ' · งานเดิม' : ''})`,
    dossierPatch: { generate: { queueJobId: q.jobId, enqueuedAt: new Date().toISOString() } },
  };
}

// ---------- S3w รอผลเจน: โพล + "ก๊อบผลทันที" (คิว purge ~30 นาที) ----------
export async function s3_wait(job, { origin }) {
  const gen = job.dossier.generate || {};
  // 🛑 ไม่มีเลขงานคิวในแฟ้ม (ขั้นส่งคิวโดนข้าม/ล้าง) → เข้าเส้นกู้เหมือนงานหาย ห้ามเดินต่อมือเปล่า
  const st = gen.queueJobId
    ? await jfetch(`${queueOrigin()}/api/queue/status?id=${encodeURIComponent(gen.queueJobId)}`, {}, 30000)
    : { error: 'ไม่มีเลขงานคิวในแฟ้ม (ขั้นส่งคิวโดนข้าม)' };
  const status = st.status || st.jobStatus;
  if (status === 'completed' && st.result) {
    // สัณฐานจริง (พิสูจน์จากโพรบ 7 ก.ค.): versions อยู่ที่ result.data.versions
    const r = st.result;
    const versions = r.data?.versions || r.versions || r.data?.analysisResult?.versions || [];
    if (!versions.length) {
      return { status: 'failed', nextAction: 'fail', summary: 'คิวจบแต่ไม่มีเวอร์ชันเนื้อในผล', quality: 'red' };
    }
    // 🎁 newsData (หัว+เนื้อข่าวสะอาดจากท่อ) = วัตถุดิบชั้นดีให้เฟส 2 (ค้นภาพ) — เก็บเข้าแฟ้มด้วย
    const newsData = r.newsData || r.data?.newsData || null;
    return {
      status: 'done',
      nextAction: 'continue',
      summary: `เจนเสร็จ ${versions.length} เวอร์ชัน — ก๊อบผลเข้าแฟ้มแล้ว (กัน purge)`,
      dossierPatch: {
        generate: {
          ...gen,
          versions,
          newsData: newsData ? { newsTitle: newsData.newsTitle || '', newsBody: (newsData.newsBody || '').slice(0, 8000) } : null,
          pipeline: r.data?.analysisResult?.pipeline || '',
          completedAt: new Date().toISOString(),
        },
      },
    };
  }
  const purged = !status && st.error; // งานหายจากคิว (ถูก purge/ไม่พบ) = กู้ผลไม่ได้แล้ว
  if (status === 'failed' || status === 'superseded' || purged) {
    // 🛟 แก้ตัว 1 รอบ: ล้มจาก URL/ชั่วคราว → ส่งใหม่เป็นเนื้อ text ตรงๆ (ท่อไม่ต้อง scrape เอง)
    if (!gen.retriedWithText) {
      const desk = job.dossier.desk || {};
      const fallbackInput = [desk.title, job.dossier.extract?.text || desk.fullText]
        .filter(Boolean)
        .join('\n\n');
      return {
        status: 'done',
        nextAction: 'goto:s3_generate',
        summary: `คิวจบแบบ ${status || 'หายจากคิว'} (${(st.error || '').slice(0, 60)}) → ส่งใหม่รอบแก้ตัวด้วยเนื้อ text`,
        dossierPatch: { generate: { ...gen, retriedWithText: true, forceTextInput: fallbackInput, queueJobId: null } },
        quality: 'yellow',
      };
    }
    return { status: 'failed', nextAction: 'fail', summary: `คิวจบแบบ ${status || 'หายจากคิว'} (ลองซ้ำแล้ว): ${st.error || ''}`.slice(0, 150), quality: 'red' };
  }
  // ยังไม่เสร็จ → รอ tick หน้า
  const age = gen.enqueuedAt ? Math.round((Date.now() - new Date(gen.enqueuedAt).getTime()) / 60000) : 0;
  if (age > 30) {
    return { status: 'failed', nextAction: 'fail', summary: `รอคิวเกิน 30 นาที (สถานะล่าสุด: ${status || 'ไม่พบงาน'})`, quality: 'red' };
  }
  return { status: 'waiting', nextAction: 'wait', summary: `รอคิวเจน… (${status || 'pending'} · ${age} นาที)` };
}

// ---------- S4 บก.เลือกเนื้อดีสุด (กันตาเอียง) ----------
export async function s4_choose(job) {
  const versions = job.dossier.generate?.versions || [];
  // 🛑 ไม่มีร่างให้ตัดสิน = ห้ามเรียก Judge (เปลืองเงิน) + ห้ามปิดงานเป็นสำเร็จปลอม
  if (!versions.length) {
    return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีฉบับร่างให้ บก. ตัดสิน (versions=0) — ย้อนกลับไปเจนใหม่ด้วยปุ่มลองต่อ', quality: 'red' };
  }
  const pick = await judgeBrain({
    versions,
    extractText: job.dossier.extract?.text,
    compass: job.dossier.compass,
  });
  const chosen = versions[pick.chosenIndex];
  const chosenText = String(chosen?.content || chosen?.text || chosen || '');
  const top = (pick.scores || []).find((s) => s.label === (pick.scores || [])[0]?.label);
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `เลือกเวอร์ชัน #${pick.chosenIndex + 1}/${versions.length} — ${pick.reason}`.slice(0, 180),
    dossierPatch: {
      pick: {
        chosenIndex: pick.chosenIndex,
        chosenText,
        scores: pick.scores,
        reason: pick.reason,
      },
    },
    quality: top && top.factuality < 25 ? 'yellow' : 'green',
  };
}

// ============================================================
// เฟส 2 — S5 ค้นภาพครบวงจร (/image-search เดิมทั้งระบบ) + S6 ผู้กำกับจับคู่ช่อง
// ============================================================

const MIN_RELEVANT_IMAGES = parseInt(process.env.MEGA_MIN_RELEVANT_IMAGES || '8', 10);
// แพลตฟอร์มตามที่ /api/images/search รองรับจริง (PLATFORMS ใน imageSearch.js — bing ตายแล้ว,
// youtube เป็นท่อแคปเฟรมแยก /api/images/youtube ไม่ใช่ท่อนี้ — บทเรียนเทสเฟส 2 รอบแรก)
const SEARCH_PLATFORMS = ['google', 'google_news', 'facebook', 'tiktok'];
// ★ 9 ก.ค. (เคาะ 6 แหล่ง): default 2→4 = ปิด STAGED ค้นเว็บครบทุกแหล่งทุกงาน
//   (เดิมหยุดที่ 2 แหล่ง = วัตถุดิบผอม ปกคลิปเลยหลุดขึ้นปก) — อยากได้พฤติกรรมเก่า: MEGA_SEARCH_INITIAL_BATCH=2
const SEARCH_INITIAL_BATCH = parseInt(process.env.MEGA_SEARCH_INITIAL_BATCH || '4', 10);
const MAX_TRIAGE_ROUNDS = 8;
// ★ 9 ก.ค. (เคาะ 6 แหล่ง): สวิตช์ชุดใหม่ — ปิดคืนได้ทีละตัวอิสระ
const LENS_ON = process.env.MEGA_LENS !== '0'; // ขั้น s5_lens ค้นย้อนกลับ
const LENS_SEEDS = parseInt(process.env.MEGA_LENS_SEEDS || '2', 10); // seed สูงสุดต่องาน
// ★ 9 ก.ค. เฟส 4b ข้อ 4.4: เพดาน seed "ชุดที่สอง" (เชิงเรื่องราว/ความสัมพันธ์) — เพิ่มต้นทุนรวมไม่เกิน 2 call จากเดิม
const STORY_SEED_MAX = 2;
const YT_PARALLEL = process.env.MEGA_YT_PARALLEL !== '0'; // ยิงแคปเฟรมตั้งแต่เริ่มค้นเว็บ (ขนาน)
const YT_WAIT_MIN = parseInt(process.env.MEGA_YT_WAIT_MIN || '10', 10); // เพดานรอเฟรมก่อน S6 (นาที)
const S6_MIN_CLEAN = parseInt(process.env.MEGA_S6_MIN_CLEAN || '5', 10); // ด่านแข็ง S6: สะอาด≥N → ตัด clean=false ทิ้ง (0=ปิดด่าน)
// ★ 9 ก.ค. เฟส 2.2 (แผนคุณภาพคลังรูป): hero ต้องเห็นขนาดจริงพอ (realShortSide≥700 ไม่ใช่ thumbnail-only)
//   กันไฟล์จิ๋วที่ตาคัดให้คะแนนสูงหลอก (จากรูปย่อ) หลุดขึ้น hero แล้วยืดแตกตอนประกอบ · ปิดกลับพฤติกรรมเดิม: S6_REAL_SIZE_GATE=0
const S6_REAL_SIZE_GATE = process.env.S6_REAL_SIZE_GATE !== '0';
// ★ 10 ก.ค. เฟส 6A (Story-fit selector — ผู้ใช้: "บริบทรูปต้องสื่อสารกับเนื้อหาข่าวจริงๆ มันถึงแมส"):
//   ให้ช่อง context/circle/action ชั่งน้ำหนัก "ภาพนี้เล่าเรื่องเดียวกับข่าวแค่ไหน" (จาก query หมวดเรื่องราว +
//   หมวด/อารมณ์/note เทียบเข็มทิศ) ไม่ใช่แค่หน้าชัดสวย · hero คงกติกาเดิมเป๊ะ · ปิดกลับพฤติกรรมเดิม: S6_STORY_FIT=0
const S6_STORY_FIT = process.env.S6_STORY_FIT !== '0';
// ภาพ "ใช้ขึ้นปกได้จริง" = ตายืนยันแล้วว่าเกี่ยว + สะอาด (ปกคลิป/การ์ดกราฟิก = relevant แต่ clean=false)
const isCleanRelevant = (x) => x?.triage && x.triage.relevant !== false && x.triage.clean !== false;
// ★ 9 ก.ค. เฟส 5.1 (แผนคุณภาพคลังรูป): ด่านพูลสะอาด "ก่อนเข้า s6" — ต่างจาก S6_MIN_CLEAN ด้านบน (ที่ทำงานหลัง sort/gate ซ้อนอีกชั้น)
//   คลังจริงพิสูจน์: clean แค่ 33.6% (AC-0058) → กันของสกปรกไม่ให้แม้แต่เข้าสมองเลือกภาพตั้งแต่ต้น · ปิดกลับพฤติกรรมเดิม: POOL_CLEAN_GATE=0
const POOL_CLEAN_GATE = process.env.POOL_CLEAN_GATE !== '0';
const POOL_MIN_FLOOR = 6; // พูลสะอาดบางกว่านี้ → อนุญาตเติม clean=false ที่ดีที่สุดกลับ (กันงานล่ม) พร้อมติดธง dirtyFallback

// ★ 9 ก.ค. เฟส 4b ข้อ 4.3: auto profile mining — หา IG/FB username คนหลักอัตโนมัติ → ดึงภาพต้นฉบับคมสุดเข้าคลัง
//   ปิดกลับพฤติกรรมเดิม (ปุ่มแมนนวลอย่างเดียว): IMG_AUTO_PROFILE=0
const AUTO_PROFILE_ON = process.env.IMG_AUTO_PROFILE !== '0';
const AUTO_PROFILE_MAX_PEOPLE = 2; // เพดานคนหลัก/เคส (ตามสเปค)
const AUTO_PROFILE_MAX_IMAGES = 40; // เพดานภาพ/โปรไฟล์ (ตามสเปค)
// ★ 9 ก.ค. เฟส 4b ข้อ 4.5: ค้นรอบสองอัจฉริยะ — วัดแกน hero-grade/ฉากตรงบริบท ขาด→ให้สมองสร้างคำค้นใหม่
//   ปิดกลับพฤติกรรมเดิม (ค้นรอบสองแบบเดิม ไม่มีคำค้นใหม่): IMG_GAP_SEARCH=0
const GAP_SEARCH_ON = process.env.IMG_GAP_SEARCH !== '0';
const GAP_SEARCH_MAX_QUERIES = 5;
// ★ Wave2 B1: ค่านี้ย้ายไป imageQualityConfig.js (single source of truth) — ค่าเดิมเป๊ะ (=2)
const GAP_SEARCH_MIN_HERO_PER_PERSON = GAP_SEARCH_MIN_HERO_PER_PERSON_CFG;
const GAP_SEARCH_MIN_SCENE = 3;
// ★ Wave2 Batch B1 (10 ก.ค. — _PLAN_MEGA_V2.md Wave2 ข้อ 2): hero-grade <GAP_SEARCH_MIN_HERO_PER_PERSON
//   ต่อ "คนหลัก" (role=hero ในเข็มทิศ) หลังค้นรอบสอง (s5_gapsearch) จบแล้ว = จบงานด้วย holdStatus
//   'insufficient_assets' (เดิม continue เสมอ ไม่มีทางหยุด) — ปิดกลับพฤติกรรมเดิม: MEGA_HERO_GRADE_HARD=0
const HERO_GRADE_HARD_ON = process.env.MEGA_HERO_GRADE_HARD !== '0';
// ★ Wave2 Batch B1: ต่อสาย triage.sharpness (Laplacian variance — วัดเก็บทุกใบตั้งแต่เฟส 2.1 ไม่เคยมีใครอ่าน)
//   เข้า heroGradeOf — ภาพเบลอ (sharpness<SHARPNESS_MIN_HERO) ไม่นับเป็น hero-grade แม้ผ่านเกณฑ์อื่นครบ
//   ภาพที่วัดค่าไม่ได้ (sharpness ไม่ใช่ number) = ไม่ตัด ให้ผ่าน · ปิดกลับพฤติกรรมเดิม: MEGA_SHARPNESS_GATE=0
const SHARPNESS_GATE_ON = process.env.MEGA_SHARPNESS_GATE !== '0';

// หา IG username จากชื่อคน ด้วย Serper (เมื่อ entityResolver ไม่มีข้อมูลโซเชียลให้) — ล้ม/ไม่มีคีย์ = คืน null เงียบๆ
async function _findInstagramUsername(name) {
  const key = process.env.SERPER_API_KEY;
  if (!key || !name) return null;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${name} instagram`, gl: 'th', hl: 'th', num: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    for (const item of (j?.organic || [])) {
      const m = /instagram\.com\/([a-zA-Z0-9._]+)\/?/i.exec(item.link || '');
      const uname = m?.[1];
      if (uname && !['p', 'reel', 'reels', 'explore', 'accounts', 'stories'].includes(uname.toLowerCase())) return uname;
    }
  } catch { /* ล้ม = ไม่มี username (เงียบ ไม่ถ่วงสายพาน) */ }
  return null;
}

// เทียบชื่อระดับ "คำ" (จำลองแยกจาก namesMatch ใน s6_slots — ไม่แตะโค้ด s6 ที่พิสูจน์แล้ว/ถูกแก้บ่อยวันนี้)
const _TITLE_WORDS = new Set(['นาย', 'นาง', 'นางสาว', 'คุณ', 'ดร.', 'หมอ', 'ผู้ก่อตั้ง', 'อดีต']);
function _nameTokens(s) {
  return String(s || '').replace(/[()"'“”]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !_TITLE_WORDS.has(t));
}
function _namesMatchSimple(a, b) {
  const ta = _nameTokens(a);
  const tb = _nameTokens(b);
  return ta.some((x) => tb.some((y) => x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y))));
}

// ★ Wave2 Batch B1: hero-grade จริงต่อคนหลัก — ยกจาก local const ใน s5_gapsearch มาเป็น shared helper
//   (เดิมประกาศซ้ำเฉพาะจุด ตอนนี้ทั้ง heroGaps แบบ soft และ hard gate ท้าย s5_gapsearch ใช้ตัวเดียวกัน)
//   clean + faceCount==1 + ไม่ใช่ thumbnail-only + (realShortSide≥HERO_MIN_SHORT_SIDE หรือวัดไม่ได้แต่ไม่ lowRes)
//   + (ใหม่) ความคมพอ — sharpness<SHARPNESS_MIN_HERO ตัดทิ้ง เฉพาะที่วัดค่าได้ (kill switch: MEGA_SHARPNESS_GATE=0)
function _heroGradeOf(x) {
  if (x.triage?.relevant === false || x.triage?.clean === false) return false;
  if (Number(x.triage?.faceCount) !== 1) return false;
  if (x.rehostQuality === 'thumbnail') return false;
  const rw = Number(x.realWidth), rh = Number(x.realHeight);
  const rss = (rw > 0 && rh > 0) ? Math.min(rw, rh) : (Number(x.triage?.realShortSide) > 0 ? Number(x.triage.realShortSide) : null);
  const sizeOk = rss != null ? rss >= HERO_MIN_SHORT_SIDE : x.lowRes !== true;
  if (!sizeOk) return false;
  if (SHARPNESS_GATE_ON) {
    const sh = x.triage?.sharpness;
    if (typeof sh === 'number' && sh < SHARPNESS_MIN_HERO) return false; // วัดไม่ได้ (ไม่ใช่ number) = ไม่ตัด
  }
  return true;
}

// ★ Wave2 Batch B1: "คนหลัก" ตัวเดียวกับที่ s6_slots ใช้เลือก hero จริง (role=hero ในเข็มทิศ · ไม่ระบุ role=hero
//   เลย → ตัวละครตัวแรกของเข็มทิศ) — ไม่มี mainCharacters เลย (ข่าวไม่มีตัวเอกชัด) = คืน [] (ไม่มีเกณฑ์จะวัด)
function _heroRoleNamesOf(job) {
  const chars = job.dossier.compass?.mainCharacters || [];
  const hs = chars.filter((c) => /hero/i.test(String(c?.role || ''))).map((c) => c?.name).filter(Boolean);
  if (hs.length) return hs;
  return chars.length && chars[0]?.name ? [chars[0].name] : [];
}

// ★ Wave2 Batch B1: ตัดสิน hard gate ท้าย s5_gapsearch — คืน null = ผ่าน/ไม่มีเกณฑ์จะวัด (ไม่แตะ path เดิม)
//   คืน { heroGradeReport } = ยังขาด hero-grade ต่อคนหลักหลังค้นรอบสองแล้ว (imagesForCheck = คลังล่าสุดรวมภาพที่เพิ่งเพิ่ม)
function _heroGateVerdict(job, imagesForCheck) {
  const heroNames = _heroRoleNamesOf(job);
  if (!heroNames.length) return null; // ไม่มีตัวเอกชัดในเข็มทิศ = ข้ามด่านนี้ (กันโดน hold ผิดๆ)
  const report = heroNames.map((name) => {
    const matched = imagesForCheck.filter((x) => [x.triage?.person, ...(x.triage?.persons || [])].filter(Boolean).some((p) => _namesMatchSimple(p, name)));
    const found = matched.filter((x) => _heroGradeOf(x)).length;
    return { person: name, found, need: GAP_SEARCH_MIN_HERO_PER_PERSON, checked: matched.length };
  });
  const failing = report.filter((r) => r.found < r.need);
  return failing.length ? { heroGradeReport: report } : null;
}

// ★ Wave2 Batch B1: จุดจบทุกทางของ s5_gapsearch (หลังพยายามค้นรอบสองแล้ว ไม่ว่าจะสำเร็จ/ล้ม/ไม่มีคำค้น) —
//   เช็ค hard gate ครั้งเดียวตรงนี้ · kill switch ปิด = คืน baseResult เดิมเป๊ะ (แค่ log ว่าถ้าเปิดจะเกิดอะไร)
function _endGapSearch(job, imagesForCheck, baseResult) {
  const v = _heroGateVerdict(job, imagesForCheck);
  if (!v) return baseResult; // ผ่านด่าน หรือไม่มี hero person ให้วัด → พฤติกรรมเดิมเป๊ะ
  if (!HERO_GRADE_HARD_ON) {
    console.log(`[MEGA S5-gap] 🔓 kill switch ปิด (MEGA_HERO_GRADE_HARD=0) — ถ้าเปิด hard จะ hold: ${JSON.stringify(v.heroGradeReport)}`);
    return baseResult;
  }
  console.log(`[MEGA S5-gap] ⛔ hero-grade hard gate ไม่ผ่านหลังค้นรอบสอง (${job.id}): ${JSON.stringify(v.heroGradeReport)} → insufficient_assets`);
  return {
    status: 'quality_hold',
    nextAction: 'hold',
    holdStatus: 'insufficient_assets', // terminal ใหม่ (pattern เดียวกับ Wave2 A1 s7_wait) — tick ยังไม่รู้จัก จะตกไป manual_review (กันค่าเพี้ยน)
    summary: `⛔ วัตถุดิบ hero ไม่พอหลังค้นรอบสอง: ${v.heroGradeReport.map((r) => `${r.person} ${r.found}/${r.need} (เช็ค ${r.checked})`).join(' · ')}`.slice(0, 200),
    quality: 'yellow',
    dossierPatch: { images: { ...baseResult.dossierPatch.images, heroGradeReport: v.heroGradeReport } },
  };
}

// เนื้อเต็มสำหรับเปิดเคสภาพ — กฎเดิมของระบบปก: ห้ามใช้เนื้อย่อ
function fullNewsText(job) {
  const d = job.dossier || {};
  const nd = d.generate?.newsData;
  if (nd?.newsBody && nd.newsBody.length >= 300) return [nd.newsTitle, nd.newsBody].filter(Boolean).join('\n\n');
  const ex = d.extract?.text || '';
  if (ex.length >= 300) return [d.desk?.title, ex].filter(Boolean).join('\n\n');
  return [d.desk?.title, ex || d.desk?.fullText || ''].filter(Boolean).join('\n\n');
}

// ---------- S5a เปิดเคสภาพ: วิเคราะห์เนื้อเต็ม → ได้ AC-xxxx ----------
export async function s5_case(job, { origin }) {
  const im = job.dossier.images || {};
  if (im.caseId) return { status: 'done', nextAction: 'continue', summary: `มีเคสภาพอยู่แล้ว ${im.caseId} — ใช้ต่อ ไม่เปิดซ้ำ` };
  const newsText = fullNewsText(job);
  if (newsText.length < 200) {
    return { status: 'failed', nextAction: 'fail', summary: `เนื้อไม่พอเปิดเคสภาพ (${newsText.length} ตัว) — ต้องเนื้อเต็มเท่านั้น`, quality: 'red' };
  }
  const r = await jfetch(`${origin}/api/analyze`, { method: 'POST', body: JSON.stringify({ newsText }) }, 240000);
  if (!r.success || !r.id) {
    return { status: 'failed', nextAction: 'retry', summary: 'เปิดเคสภาพไม่สำเร็จ: ' + (r.error || r.httpStatus) };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `เปิดเคสภาพ ${r.id} (ตัวละคร ${(r.analysis?.characters || []).length} คน · เนื้อ ${newsText.length} ตัว)`,
    dossierPatch: { images: { caseId: r.id, characters: (r.analysis?.characters || []).map((c) => c.name).slice(0, 8) } },
  };
}

// ---------- S5b สกัดคีย์เวิร์ด (สมองอารมณ์ครบสเปกตรัม + ผูกชื่อ) ----------
export async function s5_keywords(job, { origin }) {
  const im = job.dossier.images || {};
  const r = await jfetch(`${origin}/api/keywords`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId }) }, 240000);
  if (!r.success || !r.keywords) {
    return { status: 'failed', nextAction: 'retry', summary: 'สกัดคีย์เวิร์ดไม่สำเร็จ: ' + (r.error || r.httpStatus) };
  }
  const kw = r.keywords;
  // ★ 9 ก.ค. เฟส 4a: นับหมวดเรื่องราว + emotion/source_show เข้ายอดคำค้นด้วย (ให้ log สะท้อนของที่จะยิงจริง)
  const nQueries = [
    'queries_th', 'queries_en', 'object_queries', 'moment_action', 'scene_place',
    'relationship_archive', 'lifestyle_travel', 'family_album', 'landmark_context', 'emotion', 'source_show',
  ].reduce((n, k) => n + (kw[k] || []).length, 0);
  const nStory = ['relationship_archive', 'lifestyle_travel', 'family_album', 'landmark_context']
    .reduce((n, k) => n + (kw[k] || []).length, 0);
  // ★ 9 ก.ค. เฟส 4b ข้อ 4.4/4.5: เก็บ "คำค้นจริง" ของหมวดเรื่องราว+scene_place ไว้ให้ Lens/ค้นรอบสองเทียบกับ
  //   field query ของแต่ละภาพในคลัง (ภาพที่ query ตรงหมวดนี้ = ภาพเชิงบริบท/ความสัมพันธ์ ไม่ใช่แค่ฉากข่าวเดียว)
  const storyQueries = ['relationship_archive', 'lifestyle_travel', 'family_album', 'landmark_context', 'scene_place']
    .flatMap((k) => (kw[k] || []).map((q) => String(q || '').trim()).filter(Boolean));
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `สกัดคีย์ ${nQueries} คำค้น (เชิงเรื่องราว ${nStory}) · บุคคล ${(kw.subjects || []).length} คน`,
    dossierPatch: { images: { ...im, keywordsCount: nQueries, subjects: (kw.subjects || []).map((s) => s.name).slice(0, 8), storyQueries } },
  };
}

// ---------- S5c ค้นภาพ 4 แหล่ง — ทีละแหล่งต่อ 1 tick (กันชน timeout ของ tick) ----------
// ห้ามคืน status:'done' ระหว่างยังไม่ครบทุกแหล่ง — done จะโดน idempotency นับ "เคยสำเร็จ" แล้วข้ามแหล่งที่เหลือ
export async function s5_search(job, { origin }) {
  const im = job.dossier.images || {};
  const done = im.searchedPlatforms || [];
  const next = SEARCH_PLATFORMS.find((p) => !done.includes(p));
  if (next) {
    // ★ 9 ก.ค. (เคาะ 6 แหล่ง): ยิงแคปเฟรม YouTube ตั้งแต่ tick แรก — วิ่งขนานกับค้นเว็บ 4 แหล่ง
    //   fire-and-forget ไม่ await: ล้ม/ช้าไม่บล็อกสายพาน (จุดรอเฟรมอยู่ s5_clipframe เพดาน YT_WAIT_MIN นาที)
    //   เดิมรอถึง S5e ค่อยยิงแบบ synchronous = บวก 3-5 นาทีท้ายสาย + บนคลาวด์เฟรมมาไม่ทัน S6
    let ytFired = im.ytFired || null;
    if (YT_PARALLEL && !ytFired && done.length === 0) {
      const clipUrl = VIDEO_URL_RE.test(String(job.dossier.desk?.url || '')) ? job.dossier.desk.url : '';
      try {
        fetch(`${origin}/api/images/youtube`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: im.caseId, ...(clipUrl ? { clipUrl } : {}) }),
        }).catch(() => {});
        ytFired = new Date().toISOString();
        console.log('[MEGA S5c] 🎬 ยิงแคปเฟรม YouTube ขนาน (ผลไปรอเช็คที่ s5_clipframe)');
      } catch { /* ยิงไม่ได้ → s5_clipframe จะยิงเองแบบเดิม */ }
    }
    const r = await jfetch(`${origin}/api/images/search`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, platform: next }) }, 480000); // ★ 7 ก.ค.: 5→8 นาที (search+EyeScreen ต่อแหล่งแตะ 5 นาทีได้ → เดิม abort พอดี)
    const stat = r.success
      ? { platform: next, found: r.found || 0, added: r.added || 0, vetDropped: r.vetDropped || 0 }
      : { platform: next, error: (r.error || String(r.httpStatus)).slice(0, 80) };
    const patch = {
      images: {
        ...im,
        ...(ytFired ? { ytFired } : {}),
        searchedPlatforms: [...done, next],
        searchStats: [...(im.searchStats || []), stat],
      },
    };
    // ★ 7 ก.ค. STAGED (ผู้ใช้สั่ง): ค้น 2 แหล่งก่อน (google+google_news) → เก็บได้พอ (≥MIN หลัง vet) ก็ "หยุดเลย" ข้ามแหล่งที่เหลือ
    //   คนดัง/ข่าวดังเจอครบใน 2 แหล่ง = เร็ว/ประหยัด ไม่ต้องแตะ fb/tiktok · ไม่พอ → ค้นต่อทีละแหล่งจนพอ/ครบ
    //   done กลางคัน "ตั้งใจ" (ไม่ใช่บั๊ก) = ข้ามแหล่งที่เหลือตามดีไซน์ → tick ไปต่อ s5_triage ถูกต้อง
    const searchedCount = done.length + 1;
    const totalAddedNow = patch.images.searchStats.reduce((n, s) => n + (s.added || 0), 0);
    const remaining = SEARCH_PLATFORMS.length - searchedCount;
    // ★ 9 ก.ค. (เคาะ): "พอ" นับเฉพาะภาพสะอาดใช้ขึ้นปกจริง — ปกคลิป/การ์ด (clean=false) ไม่มีสิทธิ์หยุดการค้น
    //   r.images = คลังทั้งเคสที่ /api/images/search คืนมาหลัง add แล้ว → นับได้เลยไม่ต้องอ่านคลังซ้ำ
    //   (มีผลเฉพาะตอน STAGED เปิด (INITIAL_BATCH < จำนวนแหล่ง) — ค่าใหม่ default 4 = ค้นครบเสมออยู่แล้ว)
    const cleanNow = Array.isArray(r.images) ? r.images.filter(isCleanRelevant).length : 0;
    let enough = searchedCount >= SEARCH_INITIAL_BATCH && cleanNow >= MIN_RELEVANT_IMAGES;
    // ★ 7 ก.ค. (CASE-356 hero พังเพราะพูลมีแต่ภาพหมู่): "พอ" ไม่ใช่แค่นับใบ — ต้องมี "หน้าเดี่ยว" ให้เป็น hero ≥1 ใบ
    //   ยังไม่มี → ค้นแหล่งถัดไปต่อ (จนครบ 4 แหล่ง) · เช็คไม่ได้ (store ล่ม) → ใช้เกณฑ์จำนวนเดิม ไม่บล็อกสายพาน
    if (enough && remaining > 0) {
      try {
        const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 30000);
        const hasSingleFace = (lib?.images || []).some((x) => x.triage?.relevant !== false
          && (Number(x.triage?.faceCount) === 1 || /หน้า(เดี่ยว|นิ่ง|อารมณ์)|portrait|single.?face/i.test(String(x.triage?.category || ''))));
        if (!hasSingleFace) {
          enough = false;
          console.log('[MEGA S5] 👤 เก็บครบจำนวนแต่ยังไม่มี "หน้าเดี่ยว" ให้เป็น hero → ค้นแหล่งถัดไป');
        }
      } catch { /* เช็คไม่ได้ → เกณฑ์จำนวนตามเดิม */ }
    }
    if (enough || remaining <= 0) {
      const anyOk = patch.images.searchStats.some((s) => !s.error);
      if (!anyOk || totalAddedNow === 0) {
        return { status: 'failed', nextAction: 'fail', summary: 'ค้นแล้วไม่ได้ภาพเลย', quality: 'red', dossierPatch: patch };
      }
      return {
        status: 'done',
        nextAction: 'continue',
        summary: `ค้น ${searchedCount} แหล่ง เก็บ ${totalAddedNow} ใบ${enough && remaining > 0 ? ` — พอแล้ว ข้าม ${remaining} แหล่ง (staged)` : ' — ครบแหล่ง'}`,
        dossierPatch: { images: { ...patch.images, totalAdded: totalAddedNow } },
      };
    }
    return {
      status: 'waiting', // ยังไม่พอ + มีแหล่งเหลือ → ค้นต่อแหล่งถัดไป (waiting กัน idempotent ข้าม)
      nextAction: 'wait',
      summary: `ค้น ${next}: ${r.success ? `เก็บ ${stat.added}/${stat.found} ใบ` : 'ล้ม — ' + stat.error} (รวม ${totalAddedNow} · เหลือ ${remaining} แหล่ง)`,
      dossierPatch: patch,
    };
  }
  // ครบทุกแหล่งแล้ว → สรุป
  const totalAdded = (im.searchStats || []).reduce((n, s) => n + (s.added || 0), 0);
  const failedAll = (im.searchStats || []).every((s) => s.error);
  if (failedAll || totalAdded === 0) {
    return { status: 'failed', nextAction: 'fail', summary: 'ค้นครบทุกแหล่งแต่ไม่ได้ภาพเลย', quality: 'red' };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ค้นครบ ${SEARCH_PLATFORMS.length} แหล่ง — เก็บเข้าคลังรวม ${totalAdded} ใบ`,
    dossierPatch: { images: { ...im, totalAdded } },
  };
}

// ---------- S5-Profile auto profile mining (เฟส 4b ข้อ 4.3 — 9 ก.ค.): หา IG/FB โปรไฟล์คนหลักอัตโนมัติ ----------
// แหล่งภาพต้นฉบับคมสุด (IG/FB โปรไฟล์จริง) เดิมเป็นปุ่มแมนนวล 100% — ไม่มีใคร trigger ในท่อ MEGA เลย
// ทำไมอยู่ "ก่อน" s5_triage: ภาพที่ดึงมาที่นี่ยังไม่มี triage ติดมา (ต่างจาก Lens/reverse ที่ vet เองในตัว)
//   ต้องปล่อยให้ s5_triage (ขั้นถัดไป วนดูจนครบทุกใบที่ยังไม่ติดป้าย) ติดป้ายให้ — "ผ่าน vet เดิม" ตามสเปค
//   ไม่งั้น s6 มองไม่เห็น (กรอง !triage ทิ้งเงียบๆ)
// แหล่งเสริมโดยนิยาม: หา username ไม่เจอ/ดึงไม่ได้ต่อคน = ข้ามเงียบคนนั้น ไม่ล้มทั้งงาน · ปิดทั้งขั้น: IMG_AUTO_PROFILE=0
export async function s5_profile(job) {
  const im = job.dossier.images || {};
  if (!AUTO_PROFILE_ON) return { status: 'done', nextAction: 'continue', summary: 'โปรไฟล์อัตโนมัติ: ปิดอยู่ (IMG_AUTO_PROFILE=0) — ข้าม' };
  if (im.profileMiningDone) return { status: 'done', nextAction: 'continue', summary: 'โปรไฟล์อัตโนมัติ: ทำแล้ว — ข้าม' };
  if (!im.caseId) return { status: 'done', nextAction: 'continue', summary: 'โปรไฟล์อัตโนมัติ: ไม่มีเคสภาพ — ข้าม' };

  const mainChars = (job.dossier.compass?.mainCharacters || [])
    .map((c) => c?.name).filter(Boolean).slice(0, AUTO_PROFILE_MAX_PEOPLE);
  if (!mainChars.length) {
    return {
      status: 'done',
      nextAction: 'continue',
      summary: 'โปรไฟล์อัตโนมัติ: ไม่มีคนหลักจากเข็มทิศ — ข้าม',
      dossierPatch: { images: { ...im, profileMiningDone: true } },
    };
  }

  const notes = [];
  let added = 0;
  for (const name of mainChars) {
    try {
      let username = null;
      let network = 'instagram';
      // (ก) ถามข้อมูลโซเชียลจาก entityResolver ก่อน (มี URL Facebook อยู่แล้วไหม — ประหยัด Serper call ซ้ำ)
      try {
        const { resolveEntity } = await import('@/lib/services/entityResolverService');
        const ent = await resolveEntity(name, job.dossier.desk?.title || '');
        const fbUrl = ent?.sources?.facebook?.[0]?.url || '';
        const m = /facebook\.com\/([^/?#]+)/i.exec(fbUrl);
        const cand = m?.[1];
        if (cand && !['profile.php', 'people', 'pages', 'groups'].includes(cand.toLowerCase())) {
          username = decodeURIComponent(cand);
          network = 'facebook';
        }
      } catch { /* entityResolver ล้ม → ไปข้อ (ข) */ }
      // (ข) ไม่มี → หา IG username เอง ผ่าน Serper
      if (!username) {
        const ig = await _findInstagramUsername(name);
        if (ig) { username = ig; network = 'instagram'; }
      }
      if (!username) { notes.push(`${name}: ไม่พบ username`); continue; }

      // เรียก logic เดียวกับ /api/images/profile ตรง (import service — ไม่ยิง HTTP ตัวเอง)
      const { instagramProfile, facebookProfile } = await import('@/lib/imageSearch');
      const { addImages } = await import('@/lib/imageStore');
      const found = network === 'instagram'
        ? await instagramProfile(username, { num: AUTO_PROFILE_MAX_IMAGES })
        : await facebookProfile(username, { num: AUTO_PROFILE_MAX_IMAGES });
      const capped = (found || []).slice(0, AUTO_PROFILE_MAX_IMAGES);
      if (!capped.length) { notes.push(`${name} (${network}:${username}): ไม่มีภาพ`); continue; }
      const records = capped.map((x) => ({ ...x, platform: network, query: `auto-profile:${username}` }));
      const saved = await addImages(im.caseId, records);
      added += saved.added || 0;
      notes.push(`${name} (${network}:${username}): +${saved.added || 0}`);
    } catch (err) {
      notes.push(`${name}: ล้ม (${String(err?.message || '').slice(0, 40)})`);
    }
  }

  return {
    status: 'done',
    nextAction: 'continue',
    summary: `โปรไฟล์อัตโนมัติ: ${notes.join(' · ')}`.slice(0, 220),
    dossierPatch: { images: { ...im, profileMiningDone: true, profileMiningAdded: added } },
  };
}

// ---------- S5d ตาคัดคลัง: ติดป้ายให้ครบทุกใบ (วนหลายรอบ) + เกณฑ์ขั้นต่ำ ----------
export async function s5_triage(job, { origin }) {
  const im = job.dossier.images || {};
  const rounds = im.triageRounds || 0;
  const r = await jfetch(`${origin}/api/images/triage`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, limit: 60 }) }, 420000);
  if (!r.success) {
    // ตาล้มชั่วคราว (Gemini แกว่ง) → รออีกรอบ สูงสุด 2 ครั้ง — ไม่ใช้ระบบ attempt (โดน waiting นับปนจนเพี้ยน)
    const errs = (im.triageErrors || 0) + 1;
    if (errs <= 2) {
      return { status: 'waiting', nextAction: 'wait', summary: `ตาคัดล้มชั่วคราว (${(r.error || '').slice(0, 60)}) — รอลองใหม่ (${errs}/2)`, dossierPatch: { images: { ...im, triageErrors: errs } } };
    }
    return { status: 'failed', nextAction: 'fail', summary: 'ตาคัดคลังล้มซ้ำ: ' + (r.error || r.httpStatus), quality: 'red' };
  }
  if (!r.done && rounds + 1 < MAX_TRIAGE_ROUNDS) {
    return {
      status: 'waiting',
      nextAction: 'wait',
      summary: `ตาคัดรอบ ${rounds + 1}: ติดป้าย ${r.tagged} ใบ เหลือ ${r.remaining}`,
      dossierPatch: { images: { ...im, triageRounds: rounds + 1 } },
    };
  }
  const relevant = r.summary?.relevant ?? 0;
  const triage = {
    total: r.summary?.total ?? 0,
    relevant,
    junk: r.summary?.junk ?? 0,
    byPerson: r.byPerson || {},
    byCategory: r.byCategory || {},
  };
  // Quality gate ตามแผน: เดินต่อได้แต่ติดธงเหลือง (โหมด auto)
  // ★ 9 ก.ค. (เคาะ): เกณฑ์นับ "สะอาดใช้จริง" (relevant+clean) — เดิมนับ relevant รวมปกคลิป/การ์ด = หลอกว่าพอ
  let cleanCount = relevant; // อ่านคลังไม่ได้ → ถอยไปใช้ relevant แบบเดิม ไม่บล็อกสายพาน
  try {
    const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 30000);
    cleanCount = (lib?.images || []).filter(isCleanRelevant).length;
  } catch { /* ใช้ค่า fallback */ }
  const under = cleanCount < MIN_RELEVANT_IMAGES;
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ตาคัดครบ: เกี่ยวจริง ${relevant}/${triage.total} ใบ · สะอาดใช้จริง ${cleanCount}` + (under ? ` ⚠️ ต่ำกว่าเกณฑ์ ${MIN_RELEVANT_IMAGES}` : ''),
    dossierPatch: { images: { ...im, triage, triageDone: true } },
    quality: under ? 'yellow' : undefined,
  };
}

// ---------- S5-Lens ค้นย้อนกลับ (เคาะ 9 ก.ค.): seed จากภาพที่ตายืนยันแล้ว → Google Lens หา "ต้นฉบับ/มุมอื่น" ----------
// ทำไมต้องอยู่หลัง s5_triage: Lens ขยายผลจาก seed ~25 ใบ/ใบ — seed ผิดคน/มีกราฟิก = เครื่องขยายขยะทันที
// จึงใช้เฉพาะ seed ที่ตายืนยันครบ 3 อย่าง: เกี่ยวจริง + สะอาด + รู้ว่าเป็นใคร (person) · ผลที่เก็บผ่าน vet ของ
// /api/images/reverse อยู่แล้ว (ติดป้าย triage มาพร้อม — S6 อ่านเห็นเอง ไม่ต้อง re-triage)
// แหล่งเสริมโดยนิยาม: ล้ม/ไม่มี seed = ข้าม ไม่ถ่วง ไม่ล้มงาน · ปิดทั้งขั้น: MEGA_LENS=0
export async function s5_lens(job, { origin }) {
  const im = job.dossier.images || {};
  if (!LENS_ON) return { status: 'done', nextAction: 'continue', summary: 'Lens: ปิดอยู่ (MEGA_LENS=0) — ข้าม' };
  if (im.lensDone) return { status: 'done', nextAction: 'continue', summary: 'Lens: ทำแล้ว — ข้าม' };

  let seeds = [];
  let storySeedCount = 0;
  try {
    const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
    const libImgs = lib?.images || [];
    const cand = libImgs
      .filter((x) => isCleanRelevant(x) && Number(x.triage?.faceCount) === 1
        && x.triage?.person && /^https?:/.test(String(x.imageUrl || '')))
      .sort((a, b) => (b.triage?.quality ?? 0) - (a.triage?.quality ?? 0));
    // สมดุลต่อบุคคล: คนละ 1 seed ก่อน (ข่าวหลายตัวละครได้ครบทุกคน) แล้วค่อยเติมตามคุณภาพ
    const byPerson = new Map();
    for (const x of cand) {
      const p = String(x.triage.person).toLowerCase();
      if (!byPerson.has(p)) byPerson.set(p, x);
    }
    const eventSeeds = [...new Set([...byPerson.values(), ...cand])].slice(0, LENS_SEEDS).map((x) => x.imageUrl);

    // ★ 9 ก.ค. เฟส 4b ข้อ 4.4: seed "ชุดที่สอง" — ภาพเชิงเรื่องราว/ความสัมพันธ์ (ไม่ใช่แค่หน้าเดี่ยวอีเวนต์ปัจจุบัน)
    //   เดิม seed ล็อกที่ cand ด้านบนเท่านั้น → Lens วนขยายภาพชุดเดิม ไม่มีทางแตกไปเจออัลบั้มครอบครัว
    //   เกณฑ์: query ตรงหมวดเรื่องราว (เก็บไว้ตอน s5_keywords) หรือ faceCount≥2 หรือหมวดตาคัดสื่อความสัมพันธ์/ครอบครัว/กลุ่ม
    const eventSeedSet = new Set(eventSeeds);
    const storySet = new Set((im.storyQueries || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    const storyCand = libImgs
      .filter((x) => isCleanRelevant(x) && /^https?:/.test(String(x.imageUrl || '')) && !eventSeedSet.has(x.imageUrl)
        && (
          storySet.has(String(x.query || '').trim().toLowerCase())
          || Number(x.triage?.faceCount) >= 2
          || /family|relationship|group/i.test(String(x.triage?.category || ''))
        ))
      .sort((a, b) => (b.triage?.quality ?? 0) - (a.triage?.quality ?? 0));
    const storySeeds = [...new Set(storyCand.map((x) => x.imageUrl))].slice(0, STORY_SEED_MAX);
    storySeedCount = storySeeds.length;

    seeds = [...new Set([...eventSeeds, ...storySeeds])];
  } catch { /* อ่านคลังไม่ได้ → ไม่มี seed → ข้ามด้านล่าง */ }
  if (!seeds.length) {
    return {
      status: 'done',
      nextAction: 'continue',
      summary: 'Lens: ไม่มี seed สะอาดที่ยืนยันคนได้ — ข้าม (กันขยายขยะ)',
      dossierPatch: { images: { ...im, lensDone: true, lensAdded: 0 } },
    };
  }

  let added = 0;
  let dropped = 0;
  const errs = [];
  for (const seed of seeds) {
    try {
      const r = await jfetch(`${origin}/api/images/reverse`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, seedImageUrl: seed }) }, 180000);
      if (r.success) { added += r.added || 0; dropped += r.vetDropped || 0; }
      else errs.push(String(r.error || r.httpStatus).slice(0, 50));
    } catch (err) { errs.push(String(err?.message || '').slice(0, 50)); }
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `Lens: seed ${seeds.length} ใบ (เหตุการณ์ ${seeds.length - storySeedCount} + เรื่องราว ${storySeedCount}) → เก็บเพิ่ม ${added} ใบ (ตากรองทิ้ง ${dropped})${errs.length ? ` · ล้ม ${errs.length} (${errs[0]})` : ''}`,
    dossierPatch: { images: { ...im, lensDone: true, lensAdded: added } },
    quality: (!added && errs.length >= seeds.length) ? 'yellow' : undefined,
  };
}

// ---------- S5e เฟรมคลิป (ยาเฉพาะทาง): หน้าเดี่ยวสะอาดไม่พอ → แคปเฟรมจากคลิปข่าว/YouTube ----------
// A (7 ก.ค. ผู้ใช้สั่ง "แก้ให้จบ"): เว็บมักได้แต่พอร์ตเทรตโปรโมท/ลายน้ำ ไม่มีโมเมนต์เล่าเรื่อง →
//   นับ "หน้าเดี่ยวสะอาด" ในคลัง ถ้าต่ำกว่าเกณฑ์ → เรียก /api/images/youtube
//   (win32: ค้นคลิป→โหลด→แคปเฟรม→Gemini คัด→vet ติดป้าย→เข้าคลังเอง · เว็บ: ฝากเครื่องทีม)
//   ทำครั้งเดียว (clipFrameDone) · พอแล้ว/อ่านคลังไม่ได้/แคปล้ม = ข้าม ไม่ถ่วง ไม่ล้มทั้งงาน (เดินต่อด้วยของเดิม)
//   เฟรมเข้าคลังพร้อม triage แล้ว → s6 อ่านคลังสดเห็นเอง ไม่ต้อง re-triage
const CLIPFRAME_MIN_CLEAN_FACES = parseInt(process.env.MEGA_CLIPFRAME_MIN_CLEAN_FACES || '3', 10);
const CLIPFRAME_MIN_CLEAN_STORY = parseInt(process.env.MEGA_CLIPFRAME_MIN_CLEAN_STORY || '1', 10);
const VIDEO_URL_RE = /youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com/i;
const isCleanFaceImg = (x) =>
  x?.triage?.relevant !== false && x?.triage?.clean !== false
  && (Number(x?.triage?.faceCount) === 1
    || /หน้า(เดี่ยว|นิ่ง|อารมณ์)|portrait|single.?face|^face/i.test(String(x?.triage?.category || '')));
// ★ 8 ก.ค. (CASE-360): "หน้าพอแต่ไม่มีภาพเล่าเรื่อง" = ปกยังพัง (ช่องขวาได้พอร์ตเทรตมั่ว)
//   → นับ "โมเมนต์สะอาด" แยกอีกแกน — ขาดแกนไหนก็แคปเฟรม (คลิปคือแหล่งโมเมนต์จริง)
// ★ เฟส 1.1: regex เดิมเช็คหมวด action/moment/event ที่ตาคัดไม่เคยผลิต → นับได้ 0 ตลอด (แคปเฟรมถูก trigger ฟรีทุกงาน)
//   นิยามใหม่ตาม vocabulary จริง: ภาพเล่าเรื่อง = ฉาก/แอ็คชัน (context) หรือเหตุการณ์หลายคน (group) ที่เป็นฉากข่าวจริง
const isCleanStoryImg = (x) =>
  x?.triage?.relevant !== false && x?.triage?.clean !== false && x?.triage?.newsScene !== false
  && /^(context|group)$/i.test(String(x?.triage?.category || ''));

export async function s5_clipframe(job, { origin }) {
  const im = job.dossier.images || {};
  if (im.clipFrameDone) return { status: 'done', nextAction: 'continue', summary: 'เฟรมคลิป: ทำแล้ว — ข้าม' };

  // นับ 2 แกน: "หน้าเดี่ยวสะอาด" (hero/reaction/circle) + "โมเมนต์สะอาด" (action/เล่าเรื่อง)
  let cleanFaces = 0;
  let cleanStory = 0;
  let libImages = [];
  try {
    const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
    libImages = lib?.images || [];
    cleanFaces = libImages.filter(isCleanFaceImg).length;
    cleanStory = libImages.filter(isCleanStoryImg).length;
  } catch {
    return { status: 'done', nextAction: 'continue', summary: 'เฟรมคลิป: อ่านคลังไม่ได้ — ข้าม', dossierPatch: { images: { ...im, clipFrameDone: true } } };
  }

  if (cleanFaces >= CLIPFRAME_MIN_CLEAN_FACES && cleanStory >= CLIPFRAME_MIN_CLEAN_STORY) {
    return { status: 'done', nextAction: 'continue', summary: `เฟรมคลิป: หน้าเดี่ยวสะอาด ${cleanFaces} + โมเมนต์ ${cleanStory} ใบ (พอ) — ไม่ต้องแคปเฟรม` };
  }

  // ขาด → แคปเฟรมจากคลิป (ช้า 3-5 นาที · ลิงก์ข่าวเป็นคลิป = แคปตรง / ไม่ใช่ = ค้น YouTube จากคีย์เวิร์ด)
  const clipUrl = VIDEO_URL_RE.test(String(job.dossier.desk?.url || '')) ? job.dossier.desk.url : '';
  const lack = cleanFaces < CLIPFRAME_MIN_CLEAN_FACES ? `หน้าเดี่ยวสะอาดแค่ ${cleanFaces}/${CLIPFRAME_MIN_CLEAN_FACES}` : `ไม่มีภาพโมเมนต์เล่าเรื่อง (${cleanStory}/${CLIPFRAME_MIN_CLEAN_STORY})`;

  // ★ 9 ก.ค. (เคาะ): โหมดขนาน — S5c ยิงแคปเฟรมไปแล้วตั้งแต่ต้น → ขั้นนี้กลายเป็น "จุดรอเฟรม"
  //   เฟรมมาถึงแล้ว (platform youtube/clip โผล่ในคลังพร้อมป้าย triage) หรือรอครบเพดาน YT_WAIT_MIN นาที → เดินต่อ
  //   ยังไม่มา + ยังไม่ครบเพดาน → waiting (tick ถัดไปเช็คใหม่ — คลังอ่านสดทุกรอบ)
  if (im.ytFired) {
    const frames = libImages.filter((x) => x.platform === 'youtube' || x.platform === 'clip');
    const waitedMin = (Date.now() - new Date(im.ytFired).getTime()) / 60000;
    if (frames.length || waitedMin >= YT_WAIT_MIN) {
      return {
        status: 'done',
        nextAction: 'continue',
        summary: frames.length
          ? `เฟรมคลิป(ขนาน): เฟรมมาถึง ${frames.length} ใบ (${lack}) — เดินต่อ`
          : `เฟรมคลิป(ขนาน): รอครบ ${YT_WAIT_MIN} นาที เฟรมยังไม่มา (${lack}) — เดินต่อด้วยของเดิม`,
        dossierPatch: { images: { ...im, clipFrameDone: true, clipFramesAdded: frames.length } },
        quality: frames.length ? undefined : 'yellow',
      };
    }
    return { status: 'waiting', nextAction: 'wait', summary: `เฟรมคลิป(ขนาน): ${lack} — รอเฟรม ${waitedMin.toFixed(1)}/${YT_WAIT_MIN} นาที` };
  }

  // โหมดเดิม (MEGA_YT_PARALLEL=0 หรืองานเก่าที่ไม่ได้ยิงขนาน): เรียก synchronous ครั้งเดียว
  console.log(`[MEGA S5e] 🎬 ${lack} → แคปเฟรมจากคลิป${clipUrl ? ' (ลิงก์ข่าว)' : ' (ค้น YouTube)'}`);
  let r;
  try {
    r = await jfetch(`${origin}/api/images/youtube`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, ...(clipUrl ? { clipUrl } : {}) }) }, 600000);
  } catch (err) {
    return { status: 'done', nextAction: 'continue', summary: `เฟรมคลิป: เรียกไม่สำเร็จ (${String(err?.message || '').slice(0, 50)}) — เดินต่อด้วยของเดิม`, dossierPatch: { images: { ...im, clipFrameDone: true } }, quality: 'yellow' };
  }
  const added = r?.added || 0;
  const summary = r?.queued
    ? `เฟรมคลิป: ฝากเครื่องทีมแคป (หน้าน้อย ${cleanFaces}) — สายพานเดินต่อ เฟรมตามมาทีหลัง`
    : r?.success
      ? `เฟรมคลิป: แคปได้ ${added} เฟรมเข้าคลัง (หน้าเดิม ${cleanFaces})`
      : `เฟรมคลิป: แคปไม่ได้ (${(r?.error || '').slice(0, 60)}) — เดินต่อด้วยของเดิม`;
  return {
    status: 'done',
    nextAction: 'continue',
    summary,
    dossierPatch: { images: { ...im, clipFrameDone: true, clipFramesAdded: added } },
    quality: (!r?.success && !r?.queued) ? 'yellow' : undefined,
  };
}

// ---------- S5-Gap ค้นรอบสองอัจฉริยะ (เฟส 4b ข้อ 4.5 — 9 ก.ค.): วัดแกนใหม่ + สร้างคำค้นชุดใหม่เมื่อขาด ----------
// เดิม "ค้นรอบสอง" วัดแค่จำนวนหน้าชัด+อารมณ์+รายคน ไม่มีแกน hero-grade/ฉากตรงบริบท และไม่เคยสร้างคำค้นใหม่
//   (ยิงชุดเดิมซ้ำทุกแหล่ง) — ขั้นนี้วัด 2 แกนเพิ่ม แล้วให้สมองแต่งคำค้นใหม่เฉพาะตอนขาดจริง
// ทำไมอยู่ท้ายสุดก่อน s6: ให้ Lens(4.4)/เฟรมคลิปมีโอกาสเติมพูลก่อน — วัดผลจริงหลังทุกแหล่งเดินจบค่อยตัดสินว่ายังขาดไหม
// จำกัด 1 รอบต่อเคส (gapSearchDone) · ล้ม/ไม่มีคีย์ AI/อ่านคลังไม่ได้ = ข้ามเงียบ ไม่ถ่วงสายพาน · ปิดทั้งขั้น: IMG_GAP_SEARCH=0
export async function s5_gapsearch(job, { origin } = {}) {
  const im = job.dossier.images || {};
  if (!GAP_SEARCH_ON) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ปิดอยู่ (IMG_GAP_SEARCH=0) — ข้าม' };
  if (im.gapSearchDone) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ทำแล้ว — ข้าม' };
  if (!im.caseId) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ไม่มีเคสภาพ — ข้าม' };

  let libImages = [];
  try {
    const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
    libImages = lib?.images || [];
  } catch {
    return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: อ่านคลังไม่ได้ — ข้าม', dossierPatch: { images: { ...im, gapSearchDone: true } } };
  }

  // แกน (ก) hero-grade จริงต่อคนหลัก: clean + faceCount==1 + ไม่ใช่ thumbnail-only + ขนาดจริง/ความคมพอ
  //   ★ Wave2 B1: ย้ายไป _heroGradeOf shared helper (เดิม local const ในนี้อย่างเดียว) — ใช้ตัวเดียวกับ hard gate ท้ายฟังก์ชัน
  const mainChars = (job.dossier.compass?.mainCharacters || []).map((c) => c?.name).filter(Boolean).slice(0, AUTO_PROFILE_MAX_PEOPLE);
  const heroGaps = [];
  for (const name of mainChars) {
    const n = libImages.filter((x) => {
      if (!_heroGradeOf(x)) return false;
      const ps = [x.triage?.person, ...(x.triage?.persons || [])].filter(Boolean);
      return ps.some((p) => _namesMatchSimple(p, name));
    }).length;
    if (n < GAP_SEARCH_MIN_HERO_PER_PERSON) heroGaps.push({ name, have: n });
  }

  // แกน (ข) ฉากตรงบริบท: relevant + query อยู่ในหมวดเรื่องราว/scene_place (เก็บคำค้นจริงไว้ตอน s5_keywords)
  const storySet = new Set((im.storyQueries || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  const sceneCount = storySet.size
    ? libImages.filter((x) => x.triage?.relevant !== false && storySet.has(String(x.query || '').trim().toLowerCase())).length
    : 0;
  const sceneGap = sceneCount < GAP_SEARCH_MIN_SCENE;

  if (!heroGaps.length && !sceneGap) {
    return {
      status: 'done',
      nextAction: 'continue',
      summary: `ค้นรอบสอง: ครบทั้ง 2 แกน (hero-grade≥${GAP_SEARCH_MIN_HERO_PER_PERSON}/คน · ฉาก ${sceneCount}/${GAP_SEARCH_MIN_SCENE}) — ไม่ต้องเสริม`,
      dossierPatch: { images: { ...im, gapSearchDone: true } },
    };
  }

  // ขาด → ให้สมองสร้างคำค้นใหม่ (ห้ามซ้ำของเดิม)
  const gapDesc = [
    ...heroGaps.map((g) => `hero-grade ของ "${g.name}" (มี ${g.have}/${GAP_SEARCH_MIN_HERO_PER_PERSON})`),
    ...(sceneGap ? [`ภาพฉากตรงบริบท/ความสัมพันธ์ (มี ${sceneCount}/${GAP_SEARCH_MIN_SCENE})`] : []),
  ].join(' · ');
  const usedQueries = [...new Set(libImages.map((x) => String(x.query || '').trim()).filter(Boolean))].slice(0, 60);

  let newQueries = [];
  try {
    const { callBrain } = await import('@/lib/aiClient');
    const people = mainChars.join(', ') || (job.dossier.desk?.title || 'ข่าวนี้');
    const r = await callBrain({
      system: 'คุณเป็นผู้ช่วยสร้างคำค้นรูปภาพสำหรับนักข่าว ตอบเป็น JSON เท่านั้น รูปแบบ {"queries": ["คำค้น1", "คำค้น2", ...]} ห้ามมีข้อความอื่นนอก JSON',
      user: `ข่าวนี้ยังขาดภาพ ${gapDesc} ของ ${people} — สร้างคำค้นภาพใหม่ ${GAP_SEARCH_MAX_QUERIES} คำ (ภาษาไทยหรืออังกฤษตามความเหมาะสม) ที่ยังไม่เคยใช้ ห้ามซ้ำกับคำค้นเดิมเหล่านี้: ${usedQueries.join(', ') || '(ไม่มี)'}`,
      maxTokens: 400,
      cost: { step: 'mega-gap-search', caseId: im.caseId },
    });
    // แกะ JSON แบบเดียวกับ megaBrains.js parseJson (กันสมองห่อ ```json ทั้งที่สั่งห้ามแล้ว)
    const rawText = String(r.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const jStart = rawText.indexOf('{');
    const jEnd = rawText.lastIndexOf('}');
    const parsed = (jStart >= 0 && jEnd > jStart) ? JSON.parse(rawText.slice(jStart, jEnd + 1)) : null;
    const usedSet = new Set(usedQueries.map((q) => q.toLowerCase()));
    newQueries = Array.isArray(parsed?.queries)
      ? parsed.queries.map((q) => String(q || '').trim()).filter((q) => q.length >= 2 && !usedSet.has(q.toLowerCase())).slice(0, GAP_SEARCH_MAX_QUERIES)
      : [];
  } catch (err) {
    // ★ Wave2 B1: สมองสร้างคำค้นล้ม = จบรอบค้นเสริมแล้ว (ไม่มีรอบถัดไป) → เช็ค hard gate ด้วยคลังเท่าที่มี
    return _endGapSearch(job, libImages, {
      status: 'done',
      nextAction: 'continue',
      summary: `ค้นรอบสอง: ขาด ${gapDesc} แต่สมองสร้างคำค้นล้ม (${String(err?.message || '').slice(0, 50)}) — ข้าม`,
      dossierPatch: { images: { ...im, gapSearchDone: true } },
      quality: 'yellow',
    });
  }

  if (!newQueries.length) {
    // ★ Wave2 B1: ไม่ได้คำค้นใหม่ = จบรอบค้นเสริมแล้วเช่นกัน → เช็ค hard gate
    return _endGapSearch(job, libImages, { status: 'done', nextAction: 'continue', summary: `ค้นรอบสอง: ขาด ${gapDesc} แต่สมองไม่ได้คำค้นใหม่ — ข้าม`, dossierPatch: { images: { ...im, gapSearchDone: true } } });
  }

  // ยิงคำใหม่กับ google + google_news เท่านั้น (ตามสเปค) — vet เองก่อนเก็บ (ตรรกะเดียวกับ /api/images/search)
  let added = 0;
  let vetDropped = 0;
  let toStore = []; // ★ Wave2 B1: hoist ออกมานอก try ให้ hard gate ท้ายฟังก์ชันอ่านภาพที่เพิ่งเพิ่มได้ด้วย
  const errs = [];
  try {
    const { searchImages } = await import('@/lib/imageSearch');
    const { isCatalogSource, isOwnPageSource, isMismatchedFbMedia } = await import('@/lib/junkSources');
    const { vetImages } = await import('@/lib/libraryTriage');
    const { addImages } = await import('@/lib/imageStore');
    const { getCase } = await import('@/lib/caseStore');

    const collected = [];
    const seen = new Set(libImages.map((x) => x.imageUrl));
    for (const q of newQueries) {
      for (const platform of ['google', 'google_news']) {
        try {
          const imgs = await searchImages(platform, q, { num: 15, caseId: im.caseId });
          for (const x of imgs) {
            if (!x.imageUrl || seen.has(x.imageUrl)) continue;
            if (isCatalogSource(x) || isOwnPageSource(x) || isMismatchedFbMedia(x)) continue;
            seen.add(x.imageUrl);
            collected.push({ ...x, platform, query: q });
          }
        } catch (err) { errs.push(String(err?.message || '').slice(0, 40)); }
      }
    }

    if (collected.length) {
      const c = await getCase(im.caseId);
      const chars = c?.analysis?.characters || [];
      const genderOf = (name) => {
        const n = (name || '').trim();
        const hit = chars.find((ch) => ch.name === n || (ch.name && (n.includes(ch.name) || ch.name.includes(n))));
        return hit?.gender || '';
      };
      const subjects = (c?.keywords?.subjects || []).map((s) => ({ ...s, gender: s.gender || genderOf(s.name) }));
      const newsGist = (c?.analysis?.summary || c?.analysis?.content || c?.newsSnippet || '').slice(0, 600);
      toStore = collected;
      try {
        const { vetted } = await vetImages({ images: collected, subjects, newsGist, caseId: im.caseId });
        const anyTag = vetted.some((x) => x.triage);
        toStore = anyTag ? vetted.filter((x) => x.triage?.relevant !== false) : vetted;
        vetDropped = collected.length - toStore.length;
      } catch { /* ตาล้ม → เก็บดิบไปก่อน (กันได้ 0 ใบทั้งที่ค้นเจอ) */ }
      const saved = await addImages(im.caseId, toStore);
      added = saved.added || 0;
    }
  } catch (err) {
    // ★ Wave2 B1: ยิงล้ม (แต่ toStore อาจมีบางส่วนที่เข้าคลังไปแล้วก่อนล้ม) → รวม libImages+toStore ให้ gate เห็นของจริงที่สุด
    return _endGapSearch(job, [...libImages, ...toStore], {
      status: 'done',
      nextAction: 'continue',
      summary: `ค้นรอบสอง: ขาด ${gapDesc} → ได้คำค้นใหม่ ${newQueries.length} คำ แต่ยิงล้ม (${String(err?.message || '').slice(0, 50)}) — ข้าม`,
      dossierPatch: { images: { ...im, gapSearchDone: true, gapSearchQueries: newQueries } },
      quality: 'yellow',
    });
  }

  // ★ Wave2 B1: จบรอบค้นเสริมสำเร็จ — เช็ค hard gate ด้วยคลังล่าสุด (ของเดิม + ที่เพิ่งเก็บเพิ่มรอบนี้)
  return _endGapSearch(job, [...libImages, ...toStore], {
    status: 'done',
    nextAction: 'continue',
    summary: `ค้นรอบสอง: ขาด ${gapDesc} → คำค้นใหม่ ${newQueries.length} คำ → เก็บเพิ่ม ${added} ใบ (ตากรองทิ้ง ${vetDropped}${errs.length ? ` · ล้ม ${errs.length} แหล่งย่อย` : ''})`,
    dossierPatch: { images: { ...im, gapSearchDone: true, gapSearchAdded: added, gapSearchQueries: newQueries } },
  });
}

// ---------- S6 เลือกภาพลงช่อง: สมองจับคู่ + ด่านโค้ดกันซ้ำ/ผิดคน + fallback กฎเดียวกัน ----------
const SLOT_ORDER = ['hero', 'reaction', 'action', 'context', 'circle'];
// ★ เฟส 1.1 (9 ก.ค. — audit ยืนยัน): hint เดิมใช้หมวด action/moment/event/evidence ที่ตาคัด "ไม่เคยผลิต"
//   (vocabulary จริงจาก gemini.js: face-emotional / face-neutral / context / group / document / other)
//   → hint ช่อง action/circle ไม่มีวันแมตช์ fallback เลยหยิบ arr[0] (พอร์ตเทรตคะแนนสูง) เสมอ
//   map ใหม่ตามความหมายจริง: context=ฉาก/แอ็คชัน · group=เหตุการณ์หลายคน · document=ป้าย/เอกสาร/หลักฐาน
const SLOT_CATEGORY_HINT = {
  action: ['context', 'group'],
  context: ['context', 'document'],
  circle: ['face-emotional', 'document'],
};

// ★ Wave1 Batch E (10 ก.ค. — manifest-lite): hash สั้นของ DNA ที่ผูกกับข่าวนี้ (debug ว่า refMatch เปลี่ยนไหมข้ามรอบ)
//   FNV-1a 32-bit เดียวกับที่ refCoverMatch.js ใช้ (ไม่ได้ export จากที่นั่น → ก็อปตัวเล็กมาไว้ในไฟล์นี้แทน กัน import วุ่น)
function _dnaHashFor(dna) {
  try {
    let h = 0x811c9dc5;
    const s = JSON.stringify(dna || {});
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return (h >>> 0).toString(16);
  } catch { return null; }
}

export async function s6_slots(job, { origin }) {
  const im = job.dossier.images || {};
  const r = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
  if (!r.success) return { status: 'failed', nextAction: 'retry', summary: 'อ่านคลังรูปไม่ได้: ' + (r.error || r.httpStatus) };

  const rawPool = (r.images || []).filter((x) => x.triage && x.triage.relevant !== false);
  if (!rawPool.length) return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพที่ตายืนยันว่าเกี่ยวเลย — ทำปกไม่ได้', quality: 'red' };
  // ★ 9 ก.ค. เฟส 5.1+5.2 (แผนคุณภาพคลังรูป): พูลเข้า s6 ต้องสะอาด default —
  //   เดิมกรองแค่ relevant!==false → ภาพ clean=false เข้าพูลได้ พอของสะอาดขาดสมองเลือกภาพจำใจหยิบของสกปรก
  //   ธง junkHidden (เฟส 5.3 AI junk scan ตั้งแทนลบถาวร — ย้อนกลับได้) ห้ามเข้าพูลเสมอ ไม่ผูกกับ kill-switch ด้านล่าง
  const notHidden = (x) => x.triage?.junkHidden !== true;
  const visiblePool = rawPool.filter(notHidden);
  const dirtyFallbackIds = new Set();
  let pool = visiblePool;
  if (POOL_CLEAN_GATE) {
    const cleanOnly = visiblePool.filter((x) => x.triage?.clean !== false);
    if (cleanOnly.length < POOL_MIN_FLOOR && cleanOnly.length < visiblePool.length) {
      const need = POOL_MIN_FLOOR - cleanOnly.length;
      const dirtyBest = visiblePool
        .filter((x) => x.triage?.clean === false)
        .sort((a, b) => (Number(b.triage?.faceCount) || 0) - (Number(a.triage?.faceCount) || 0) || (Number(b.triage?.quality) || 0) - (Number(a.triage?.quality) || 0))
        .slice(0, need);
      dirtyBest.forEach((x) => dirtyFallbackIds.add(String(x.id)));
      pool = [...cleanOnly, ...dirtyBest];
      console.log(`[MEGA S6] 🧹 เฟส 5.1: พูลสะอาดบาง (${cleanOnly.length}/${POOL_MIN_FLOOR}) → เติม clean=false ที่ดีที่สุด ${dirtyBest.length} ใบ (dirtyFallback)`);
    } else {
      pool = cleanOnly;
    }
  }
  // ★ เฟส 5.2: ข้อความ error แยกเคส "ไม่มีภาพเกี่ยวเลย" ออกจาก "มีแต่ถูกซ่อนหมด" — debug ง่ายกว่า (กฎ error ชัดเจน)
  if (!pool.length) {
    const hiddenAll = rawPool.length - visiblePool.length;
    return { status: 'failed', nextAction: 'fail', summary: hiddenAll >= rawPool.length ? `ภาพที่เกี่ยวทั้งหมด ${rawPool.length} ใบ ถูกตั้งธงซ่อน (junkHidden) หมด — กู้คืนบางใบก่อนทำปก` : 'ไม่มีภาพที่ตายืนยันว่าเกี่ยวเลย — ทำปกไม่ได้', quality: 'red' };
  }

  // metadata กะทัดรัด (สะอาดก่อน → คุณภาพสูงก่อน · เพดาน 80 ใบกัน prompt บวม)
  //   B (reject ลายน้ำ 7 ก.ค.): triage ติดป้าย clean=false เมื่อมีลายน้ำ/ตัวหนังสือ — ยกภาพสะอาดขึ้นหัวคิว
  //   ให้ทั้ง Director และ fallback หยิบสะอาดก่อนเสมอ (ยอมลายน้ำเฉพาะไม่มีตัวเลือกสะอาดจริงๆ)
  const isClean = (x) => x.triage?.clean !== false;
  // ★ 9 ก.ค. เฟส 2.2: ขนาดจริง (record เฟส 1 ก่อน → triage.realShortSide เฟส 2.1 สำรอง) — ใช้กันไฟล์จิ๋วขึ้น hero
  const realShortSideOf = (x) => {
    const rw = Number(x.realWidth), rh = Number(x.realHeight);
    if (rw > 0 && rh > 0) return Math.min(rw, rh);
    const ts = Number(x.triage?.realShortSide);
    return ts > 0 ? ts : null;
  };
  // hero candidate ต้อง: ไม่ใช่ thumbnail-only + (สั้นสุดจริง≥HERO_MIN_SHORT_SIDE หรือวัดไม่ได้แต่ไม่ติดธง lowRes)
  //   ★ Wave2 B1: เลข 700 ย้ายมาจาก imageQualityConfig.js (single source of truth — ค่าเดิมเป๊ะ ตัวเดียวกับ s5_gapsearch)
  const heroSizeOk = (x) => {
    if (!S6_REAL_SIZE_GATE) return true; // kill-switch ปิด = พฤติกรรมเดิม (ไม่กรองขนาด)
    if (x.rehostQuality === 'thumbnail') return false;
    const rss = realShortSideOf(x);
    return rss != null ? rss >= HERO_MIN_SHORT_SIDE : x.lowRes !== true;
  };
  // ช่องรอง (ไม่ใช่ hero): โทษ thumbnail-only/lowRes ให้ท้ายคิวตอนคะแนนเท่ากัน (ไม่ตัดทิ้ง แค่เรียงหลัง)
  const sizePenalty = (x) => (x.rehostQuality === 'thumbnail' ? 2 : 0) + (x.lowRes === true ? 1 : 0);
  // ★ 9 ก.ค. (เคาะ): ด่านแข็ง — ภาพสะอาดพอ 5 ช่องปก (MEGA_S6_MIN_CLEAN) → ตัด clean=false ออกจากลิสต์เลย
  //   เดิมแค่เรียงท้าย: ภาพสะอาดน้อยทีไร ปกคลิป/การ์ดกราฟิกหลุดขึ้นปก (ขยะที่ผู้ใช้แนบตัวอย่าง 9 ก.ค.)
  //   สะอาดไม่พอ → ถอยใช้ pool เต็มแบบเดิม (เรียงสะอาดก่อน) — ไม่มีวันทำปกไม่ได้เพราะด่านนี้ · ปิดด่าน: MEGA_S6_MIN_CLEAN=0
  const cleanPool = pool.filter(isClean);
  const gatedPool = (S6_MIN_CLEAN > 0 && cleanPool.length >= S6_MIN_CLEAN) ? cleanPool : pool;
  if (gatedPool.length < pool.length) {
    console.log(`[MEGA S6] 🧹 ด่านสะอาด: ตัด clean=false ${pool.length - gatedPool.length} ใบ — สมองเห็นเฉพาะสะอาด ${gatedPool.length} ใบ`);
  }
  const sorted = gatedPool.slice().sort((a, b) => {
    const c = (isClean(b) ? 1 : 0) - (isClean(a) ? 1 : 0);
    if (c) return c;
    const q = (b.triage?.quality ?? 0) - (a.triage?.quality ?? 0);
    if (q) return q;
    // ★ 9 ก.ค. เฟส 2.2: คุณภาพเท่ากัน → เรียงโทษไฟล์เล็ก/thumbnail-only ไปท้ายคิว (ไม่ตัดทิ้ง แค่ให้ตัวเลือกจริงขึ้นก่อน)
    return S6_REAL_SIZE_GATE ? sizePenalty(a) - sizePenalty(b) : 0;
  }).slice(0, 80);

  // ★ 10 ก.ค. เฟส 6A (Story-fit selector): คะแนน "ภาพนี้เล่าเรื่องเดียวกับข่าวแค่ไหน" 0-10 — คำนวณครั้งเดียวต่อพูล ไม่ยิง LLM
  //   สัญญาณ: query มาจากหมวดเรื่องราว (storyQueries เก็บไว้ตอน s5_keywords) = แรงสุด +4 · หมวดสื่อความสัมพันธ์/ครอบครัว/สถานที่ +2 ·
  //   อารมณ์ตรงเข็มทิศ +1 · note ตรงช็อตในฝัน/มุมเล่า +1 · ฐานกลาง 3 (ภาพปกติไม่ถูกกดต่ำเกิน)
  //   ภาพแฟ้ม (newsScene=false) ที่มาจากคำค้นเรื่องราว = "วัตถุดิบเล่าแก่นข่าว" ไม่หักแต้ม (เคสป้าเจี๊ยบ+หลาน+หอไอเฟล)
  const _cmp = job.dossier.compass || {};
  const storySet = new Set((im.storyQueries || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  // 6.4 กันถอยหลัง: ปิดสวิตช์ หรือพูลไม่มีคำค้นเรื่องราวเลย → ปิดเงียบทั้งกลไก (meta/ลำดับ/log/slot เหมือนเดิมเป๊ะ ไม่มีคะแนนผี ไม่มี LLM เพิ่ม)
  const STORY_SEL_ON = S6_STORY_FIT && storySet.size > 0;
  const _lc = (s) => String(s || '').trim().toLowerCase();
  const _cmpEmo = [_cmp.primaryEmotion, ...(_cmp.secondaryEmotions || [])].map(_lc).filter(Boolean);
  const _dreamText = _lc([_cmp.angle, ...(_cmp.visualDreamShots || []).map((v) => `${v?.slot || ''} ${v?.description || ''}`)].join(' '));
  const STORY_CAT_RE = /(relationship|family|group|lifestyle|travel|landmark|context|scene)/i;
  const _sfCache = new Map();
  const storyFitOf = (x) => {
    if (!STORY_SEL_ON) return null;
    const id = String(x?.id ?? '');
    if (_sfCache.has(id)) return _sfCache.get(id);
    const fromStory = storySet.has(_lc(x?.query));
    const relCat = STORY_CAT_RE.test(String(x?.triage?.category || ''));
    const emo = _lc(x?.triage?.emotion);
    const emoMatch = !!emo && _cmpEmo.some((e) => e && (e.includes(emo) || emo.includes(e)));
    const note = _lc(x?.triage?.note);
    const dreamMatch = !!note && !!_dreamText && note.split(/\s+/).some((w) => w.length >= 3 && _dreamText.includes(w));
    let s = 3;
    if (fromStory) s += 4;
    if (relCat) s += 2;
    if (emoMatch) s += 1;
    if (dreamMatch) s += 1;
    s = Math.max(0, Math.min(10, s));
    _sfCache.set(id, s);
    return s;
  };
  // 6.3 ถ่วงน้ำหนักเรียง: story 40 / clean 30 / ขนาดจริง 30 — เฉพาะ context/action/circle (hero ไม่ใช้ — ถูกคน+หน้าชัดมาก่อน)
  const STORY_SLOTS = new Set(['context', 'action', 'circle']);
  const _combinedStory = (x) => 4 * ((storyFitOf(x) ?? 0) / 10) + 3 * (isClean(x) ? 1 : 0) + 3 * (1 - Math.min(sizePenalty(x), 2) / 2);
  const storyRank = (a, b) => {
    const d = _combinedStory(b) - _combinedStory(a);
    if (Math.abs(d) > 1e-6) return d;
    return (b.triage?.quality ?? 0) - (a.triage?.quality ?? 0);
  };
  // 6.2 กู้ช่องเล่าเรื่อง: ช่อง context/circle ที่ LLM ได้ภาพ story ต่ำ → สลับภาพ story สูงจริงถ้าพูลมี (รายละเอียดใต้ลูป)
  const STORY_RESCUE_SLOTS = new Set(['context', 'circle']);
  const STORY_HIGH = 8;          // ช่องได้ story-fit ≥ นี้ = เล่าเรื่องดีอยู่แล้ว ไม่ต้องกู้
  const STORY_MIN_TO_WIN = 6;    // ตัวใหม่ต้อง "เล่าเรื่องจริง" (≥6) ถึงมีสิทธิ์ชนะช่อง
  const STORY_SWAP_MARGIN = 3;   // และต้องดีกว่าของเดิมชัด ≥3 แต้ม (กันสลับเพราะต่างนิดเดียว)
  const STORY_Q_TOL = 1;         // ยอมคุณภาพต่ำกว่าของเดิมได้ไม่เกิน 1 (คุณภาพต้อง "ไม่ห่างกันมาก")
  let storyTag = '';
  if (STORY_SEL_ON) {
    const inv = sorted.map((x) => ({ id: x.id, sf: storyFitOf(x) })).filter((o) => o.sf >= 6).sort((a, b) => b.sf - a.sf).slice(0, 8);
    console.log(`[MEGA S6] 📖 เฟส 6A story-fit: ภาพเล่าเรื่อง(≥6) ${inv.length}/${sorted.length} ใบ${inv.length ? ' — ' + inv.map((o) => `${o.id}:${o.sf}`).join(' ') : ''}`);
  }

  const meta = sorted.map((x) => ({
    id: x.id,
    person: x.triage?.person || null,
    persons: x.triage?.persons || [],
    category: x.triage?.category || 'other',
    emotion: x.triage?.emotion || null,
    quality: x.triage?.quality ?? 5,
    faces: x.triage?.faceCount ?? 0,
    clean: isClean(x), // false = มีลายน้ำ/ตัวหนังสือ ห้ามขึ้นช่องถ้ามีตัวเลือกสะอาด
    newsScene: x.triage?.newsScene !== false, // ★ 9 ก.ค.: false = ภาพแฟ้ม/งานอื่น (คนถูกแต่บริบทผิด) — เลี่ยงถ้ามีภาพข่าวจริง
    src: x.platform || '',
    // ★ เฟส 1.2 (audit ยืนยัน note แยกฉากได้ 46-62% ในภาพเว็บ แต่ถูกทิ้งก่อนถึงสมอง):
    //   note = คำบรรยายฉากจากตาคัด — สมองใช้แยก "โมเมนต์บริจาคจริง" จาก "ยืนโพสเฉยๆ" ได้เป็นครั้งแรก
    //   orient = สัดส่วนภาพ (aspect คงเดิมแม้ dims stale หลัง rehost — ห้ามใช้เป็น pixel)
    note: String(x.triage?.note || '').replace(/\s+/g, ' ').trim().slice(0, 64) || undefined,
    orient: (Number(x.width) > 0 && Number(x.height) > 0)
      ? (x.width / x.height > 1.15 ? 'wide' : (x.width / x.height < 0.87 ? 'tall' : 'sq'))
      : undefined,
    // ★ เฟส 6A: storyFit 0-10 = ภาพนี้เล่าเรื่องเดียวกับข่าวแค่ไหน — ให้ผู้กำกับ LLM เห็น provenance เชิงเรื่อง
    //   (เพิ่ม field เมื่อเปิดเท่านั้น · พูลไม่มีคำค้นเรื่องราว/ปิดสวิตช์ → ไม่เพิ่ม = prompt เดิมเป๊ะ ไม่ regress)
    ...(STORY_SEL_ON ? { storyFit: storyFitOf(x) } : {}),
  }));

  // ★ เฟส 3.1 (9 ก.ค.): จัดกลุ่ม "ฉาก" จาก note (ตัดวลีลายน้ำ/overlay ทิ้งก่อน) —
  //   ① สมองเห็น inventory ว่าพูลมีฉากอะไรกี่ใบ (วางเรื่องได้จริง)  ② ด่านโค้ดกันฉากซ้ำข้ามช่อง
  const OVERLAY_PHRASE_RE = /(มี)?(ลายน้ำ|โลโก้|วอเตอร์มาร์ก|ตัวหนังสือ|แคปชั่น|ซับ|UI)\S*(\s?(ทับ|บัง|มุม|บน|และ)\S*)*/gi;
  const sceneKeyOf = (x) => {
    const n = String(x?.triage?.note || '').replace(OVERLAY_PHRASE_RE, ' ').replace(/\s+/g, ' ').trim();
    return n.length >= 10 ? n.slice(0, 42) : ''; // note สั้น/ว่าง = ไม่จัดฉาก (อย่าเหมารวมมั่ว)
  };
  const sceneCount = new Map();
  for (const x of sorted) { const k = sceneKeyOf(x); if (k) sceneCount.set(k, (sceneCount.get(k) || 0) + 1); }
  const sceneInventory = [...sceneCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
  if (sceneInventory) console.log(`[MEGA S6] 🗺️ ฉากในพูล: ${sceneCount.size} ฉาก — ${sceneInventory.slice(0, 180)}`);

  // 🎯 7 ก.ค. (ผู้ใช้สั่ง ref-first): เลือก "ปกเป้า" จากคลัง reference ก่อนคัดภาพ — ให้ DNA ขับการเลือกภาพลงช่อง
  //   คำนวณครั้งเดียวเก็บใน dossier.refMatch (s7 ใช้ต่อ ไม่คำนวณซ้ำ) · คลังว่าง/ล้ม → ทำงานแบบเดิม
  if (!job.dossier.refMatch) {
    // ★ 10 ก.ค. Wave1-A: job.dossier.refIdLock (string refId) → ข้ามสุ่ม/เลือกทั้งหมด ผูก ref ใบนั้นตรงๆ
    //   หาไม่เจอในคลัง/ไม่มี dna → log แล้ว fallthrough ไป pickBestRef ตามปกติ (ห้าม fail งาน)
    let lockedRef = null;
    if (job.dossier.refIdLock) {
      try {
        const { listRefCovers } = await import('@/lib/refCoverLibrary');
        const allRefs = await listRefCovers(500);
        lockedRef = allRefs.find((x) => x.id === job.dossier.refIdLock && x.dna && x.imagePath) || null;
        if (!lockedRef) console.log(`[MEGA S6] 🔒 refIdLock ${job.dossier.refIdLock} หาไม่เจอในคลัง/ไม่มี dna → fallback pickBestRef`);
      } catch { /* คลังล้ม → fallback ปกติ */ }
    }
    if (lockedRef) {
      // ★ Wave1 Batch E: dnaHash+refBoundAt — stamp ว่า DNA ก้อนไหน/เมื่อไหร่ถูกผูกกับข่าวนี้ (debug/replay)
      job.dossier.refMatch = { dna: lockedRef.dna, styleName: lockedRef.styleName || lockedRef.id, imagePath: lockedRef.imagePath, reason: 'ล็อก refId', typeMatched: true, dnaHash: _dnaHashFor(lockedRef.dna), refBoundAt: new Date().toISOString() };
      console.log(`[MEGA S6] 🔒 ใช้ ref ที่ล็อก: ${lockedRef.styleName || lockedRef.id}`);
    } else {
      try {
        const { pickBestRef } = await import('@/lib/refCoverMatch');
        const c = job.dossier.compass || {};
        // ★ 10 ก.ค. Wave1-A: seedKey นิ่งต่อข่าว (หัวข่าวก่อน — ข่าวเดิมเทสซ้ำคนละ job/คนละ caseId ก็ได้ ref ใบเดิม) → caseId → job.id
        const m = await pickBestRef({
          emotion: c.primaryEmotion || '',
          text: [c.angle, ...(c.secondaryEmotions || [])].filter(Boolean).join(' '),
          charCount: (c.mainCharacters || []).length,
          dreamShots: (c.visualDreamShots || []).map((v) => v.slot || v.description || ''),
        }, { seedKey: job.dossier.desk?.title || job.dossier.images?.caseId || job.id });
        if (m?.ref?.dna) {
          // ★ 8 ก.ค. (CASE-360): แนวข่าวไม่ตรงจริง (แมตช์แค่อารมณ์/role generic) = "หลวม"
          //   → ตัด slot subject/storyFlow ทิ้ง (กัน ref รับปริญญาพาเลือก "คนกอด/เด็กในวง" ที่ข่าวนี้ไม่มี)
          //   คงไว้แค่ "โครง" (layoutFamily/template) ซึ่งพิสูจน์แล้วว่าตรง — vt_ref_5x4 จัดถูก
          const weak = !m.typeMatched;
          const dna = weak ? { ...m.ref.dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' } : m.ref.dna;
          // ★ Wave1 Batch E: dnaHash+refBoundAt — stamp ว่า DNA ก้อนไหน/เมื่อไหร่ถูกผูกกับข่าวนี้ (debug/replay)
          job.dossier.refMatch = { dna, styleName: m.ref.styleName || m.ref.id, imagePath: m.ref.imagePath, reason: m.reason, typeMatched: !weak, dnaHash: _dnaHashFor(dna), refBoundAt: new Date().toISOString() };
        }
      } catch { /* ไม่มีคลัง ref → เดินแบบเดิม */ }
    }
  }
  // แมตช์หลวม → ไม่ส่ง DNA เข้าสมองเลือกภาพ (เลือกตามเข็มทิศข่าวล้วน) · โครงยังใช้ตอน s7
  const _refDNA = job.dossier.refMatch?.typeMatched ? job.dossier.refMatch.dna : null;
  // ★ 8 ก.ค. (CASE-361): เทมเพลตของ ref ตระกูลหลัก (vt_ref_5x4) มีแค่ 4 ช่องภาพ แต่เดิมเลือกครบ 5 บทบาทเสมอ
  //   → ช่องที่ 5 ไม่ได้ถูกใช้จริงตอนประกอบ (จำนวนภาพไม่ตรงกับที่ ref กำหนด) — ตัดให้เหลือเท่า panelCount ของ ref ที่แมตช์ (ไม่มี ref/เลขแปลก → คงเดิม 5 ปลอดภัย)
  const _panelCount = Number(job.dossier.refMatch?.dna?.panelCount);
  const activeSlots = (_panelCount >= 3 && _panelCount <= SLOT_ORDER.length) ? SLOT_ORDER.slice(0, _panelCount) : SLOT_ORDER;
  if (job.dossier.refMatch) {
    console.log(`[MEGA S6] 🎯 ปกเป้า: ${job.dossier.refMatch.styleName || '-'} (${job.dossier.refMatch.reason || ''}) — ${_refDNA ? 'ใช้ขับการเลือกภาพ + โครง' : 'แมตช์หลวม → ใช้เฉพาะโครง (เลือกภาพตามเข็มทิศข่าว)'}${activeSlots.length !== SLOT_ORDER.length ? ` · ตัดเหลือ ${activeSlots.length} ช่องตาม panelCount ref` : ''}`);
  }

  // 🎨 S6a บก.ศิลป์ (ทีมกราฟฟิก 8 ก.ค.): ref → "ใบสั่งงาน" ของข่าวนี้ (ครั้งเดียว เก็บแฟ้ม) — ล้ม = เดินต่อแบบไม่มีใบสั่ง
  if (!job.dossier.artBrief && job.dossier.refMatch?.dna) {
    try {
      job.dossier.artBrief = await artBriefBrain({
        refDNA: job.dossier.refMatch.dna,
        compass: job.dossier.compass,
        deskTitle: job.dossier.desk?.title,
        typeMatched: !!job.dossier.refMatch.typeMatched,
      });
      console.log(`[MEGA S6a] 🎨 ใบสั่งงาน ${job.dossier.artBrief.orders?.length || 0} ช่อง — ${String(job.dossier.artBrief.storyNote || '').slice(0, 80)}`);
    } catch (e) { console.log('[MEGA S6a] บก.ศิลป์ล้ม (เดินต่อไม่มีใบสั่ง):', e.message?.slice(0, 50)); }
  }

  let brain = { slots: {}, note: '' };
  let brainOk = true;
  try {
    brain = await slotDirectorBrain({ imagesMeta: meta, compass: job.dossier.compass, deskTitle: job.dossier.desk?.title, refDNA: _refDNA, artBrief: job.dossier.artBrief || null, sceneInventory }); // เฟส 3.1: สมองเห็นแผนที่ฉาก
  } catch (err) {
    brainOk = false; // สมองล่ม → fallback ล้วน (กฎเดียวกับทางหลัก)
  }

  // ด่านโค้ด: id ต้องมีจริง + ห้ามซ้ำข้ามช่อง + hero ต้องถูกคน (ถูกคน 100% เหนือทุกข้อ)
  const byId = new Map(sorted.map((x) => [String(x.id), x]));
  const mainNames = (job.dossier.compass?.mainCharacters || []).map((c) => c.name).filter(Boolean);
  // เทียบชื่อระดับ "คำ" ไม่ใช่ทั้งก้อน — บทเรียน MG-0001: เข็มทิศเรียก "อากงจุน (ผู้ก่อตั้งฮาตาริ)"
  // แต่ตาติดป้าย "จุน วนวิทย์ (อากงจุน)" → ไม่มีใครครอบใคร ทั้งที่คนเดียวกัน 108 ใบ
  const TITLE_WORDS = new Set(['นาย', 'นาง', 'นางสาว', 'คุณ', 'ดร.', 'หมอ', 'ผู้ก่อตั้ง', 'อดีต']);
  const nameTokens = (s) =>
    String(s || '')
      .replace(/[()"'“”]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !TITLE_WORDS.has(t));
  const namesMatch = (a, b) => {
    const ta = nameTokens(a);
    const tb = nameTokens(b);
    return ta.some((x) => tb.some((y) => x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y))));
  };
  const isMainChar = (img) => {
    const ps = [img.triage?.person, ...(img.triage?.persons || [])].filter(Boolean);
    return mainNames.length === 0 || ps.some((p) => mainNames.some((m) => namesMatch(p, m)));
  };
  // ★ 10 ก.ค. (ผู้ใช้: "hero ได้ใครมาไม่รู้" — เคสแม่น้องเมย hero เป็นคนอื่นในข่าว): hero ต้องเป็น
  //   "ตัวเอกอันดับหนึ่ง" (role=hero ในเข็มทิศ) เท่านั้น — เดิม isMainChar ยอมทุก mainCharacters
  //   (แม่/พ่อ/กมธ. ผ่านหมด) · ไม่มี role=hero ระบุ → ใช้ตัวละครตัวแรกของเข็มทิศ
  const heroNames = (() => {
    const chars = job.dossier.compass?.mainCharacters || [];
    const hs = chars.filter((c) => /hero/i.test(String(c?.role || ''))).map((c) => c?.name).filter(Boolean);
    if (hs.length) return hs;
    return chars.length && chars[0]?.name ? [chars[0].name] : [];
  })();
  const isHeroChar = (img) => {
    const ps = [img.triage?.person, ...(img.triage?.persons || [])].filter(Boolean);
    return heroNames.length === 0 ? isMainChar(img) : ps.some((p) => heroNames.some((m) => namesMatch(p, m)));
  };
  const used = new Set();
  const slots = {};
  let fallbackUsed = 0;
  const chosenScenes = new Set(); // เฟส 3.1: กันฉากซ้ำข้ามช่อง
  let sceneDupBlocked = 0;

  for (const slot of activeSlots) {
    const want = brainOk ? brain.slots?.[slot] : null;
    let img = want?.id != null ? byId.get(String(want.id)) : null;
    let reason = want?.reason || '';
    if (img && used.has(String(img.id))) img = null; // ซ้ำข้ามช่อง = ตัด
    if (img && slot === 'hero' && !isHeroChar(img)) { img = null; reason = ''; } // ★ 10 ก.ค.: hero ต้องเป็นตัวเอก role=hero เท่านั้น
    // ★ เฟส 3.1: ฉากซ้ำกับช่องที่เลือกไปแล้ว (note เดียวกัน เช่น เฟรมคลิปชุดเดียว/เวทีเดิมหลายรูป) = ตัด
    //   ให้ fallback หาฉากใหม่ — ยกเว้น hero (กฎถูกคนสำคัญกว่า) · แก้ตรงอาการ "ฉากเวทีมอบทุนโผล่ซ้ำ 3 ช่อง"
    if (img && slot !== 'hero') {
      const sk = sceneKeyOf(img);
      if (sk && chosenScenes.has(sk)) { img = null; reason = ''; sceneDupBlocked++; }
    }
    // 👤 8 ก.ค. (AC-0027 hero=ภาพกอดแม่ 2 หน้า): brain ฝ่ากฎ "hero หน้าเดี่ยว" ได้ — ด่านโค้ดบังคับ:
    //   hero หลายหน้า + พูลมี "หน้าเดี่ยวถูกคน สะอาด" → สลับเป็นหน้าเดี่ยว (ภาพกอด/คู่ไปช่อง reaction แทนได้)
    if (img && slot === 'hero' && (img.triage?.faceCount ?? 0) > 1) {
      const solo = sorted.find((x) => !used.has(String(x.id)) && isHeroChar(x) && (x.triage?.faceCount ?? 0) === 1 && isClean(x));
      if (solo) { console.log(`[MEGA S6] 👤 hero ${img.id} มี ${img.triage.faceCount} หน้า → สลับหน้าเดี่ยว ${solo.id}`); img = solo; reason = 'hero หน้าเดี่ยว (โค้ดบังคับ — brain เลือกภาพหลายหน้า)'; }
    }
    // ★ 9 ก.ค. เฟส 2.2 (S6_REAL_SIZE_GATE): hero ที่ brain เลือกมาเป็นไฟล์เล็ก/thumbnail-only จริง → สลับเป็นใบที่
    //   เห็นขนาดจริงพอ (realShortSide≥700) ถ้ามีตัวเลือก — กัน "ไฟล์จิ๋วที่ตาคัดให้คะแนนหลอก" หลุดไปยืดแตกตอนประกอบ
    if (img && slot === 'hero' && !heroSizeOk(img)) {
      const bigger = sorted.find((x) => !used.has(String(x.id)) && isHeroChar(x) && (x.triage?.faceCount ?? 0) >= 1 && heroSizeOk(x) && isClean(x))
        || sorted.find((x) => !used.has(String(x.id)) && isHeroChar(x) && (x.triage?.faceCount ?? 0) >= 1 && heroSizeOk(x));
      if (bigger) {
        console.log(`[MEGA S6] 📏 hero ${img.id} ขนาดจริงไม่พอ/thumbnail-only → สลับ ${bigger.id} (เห็นขนาดจริงชัดกว่า)`);
        img = bigger;
        reason = 'hero ขนาดจริงพอ (โค้ดบังคับ เฟส 2.2 — เดิมได้ไฟล์เล็ก/thumbnail)';
      } else {
        // ห้าม hard-fail: ไม่มีตัวเลือกอื่นผ่านเกณฑ์ขนาด → ถอยไปใช้ใบเดิม (ระบบเดิมต้องยังทำงานได้กับเคสที่ไม่มี field ใหม่)
        console.log(`[MEGA S6] 📏 hero ${img.id} ขนาดจริงไม่พอ/thumbnail-only แต่ไม่มีตัวเลือกอื่นในพูล → คงไว้ (กัน hard-fail)`);
      }
    }
    if (!img) {
      // fallback กฎเดียวกับทางหลัก: hero=ตัวเอกหน้าชัดคุณภาพสูง / อื่นๆ=หมวดใกล้เคียง → คุณภาพสูงสุดที่เหลือ
      const cands0 = sorted.filter((x) => !used.has(String(x.id)));
      // ★ 10 ก.ค. เฟส 6A (6.3): ช่อง context/action/circle เรียง candidate ด้วยแกน story-fit (story40/clean30/ขนาดจริง30)
      //   ภาพ "สื่อเรื่อง" ชนะ "หน้าชัดเฉยๆ" เมื่อคุณภาพใกล้กัน · hero ไม่แตะ (ถูกคน+หน้าชัดมาก่อน) · ปิด/ไม่มีคำค้นเรื่องราว = ลำดับเดิมเป๊ะ
      const cands = (STORY_SEL_ON && STORY_SLOTS.has(slot)) ? cands0.slice().sort(storyRank) : cands0;
      const hint = SLOT_CATEGORY_HINT[slot] || [];
      // ★ 9 ก.ค. เฟส 2.2: hero fallback ลองแบบมีเกณฑ์ขนาดจริงก่อน (heroSizeOk) — ไม่เจอเลยค่อยถอยเกณฑ์เดิม (ไม่กรองขนาด)
      const findHeroSized = (arr) => {
        const heroBase = (x) => isHeroChar(x) && (x.triage?.faceCount ?? 0) >= 1;
        const noBanner = (x) => !(Number(x.width) > 0 && Number(x.height) > 0 && x.width / x.height > 1.5);
        const hit = arr.find((x) => heroBase(x) && heroSizeOk(x) && noBanner(x)) || arr.find((x) => heroBase(x) && heroSizeOk(x));
        if (!hit && arr.some(heroBase)) console.log('[MEGA S6] 📏 เฟส 2.2: ไม่มี hero candidate ผ่านเกณฑ์ขนาดจริง (realShortSide≥700/ไม่ thumbnail-only) — ถอยเกณฑ์เดิม');
        return hit || null;
      };
      const pickFrom = (arr) =>
        // ★ 9 ก.ค. เฟส 2.2: ลองตัวเลือกขนาดจริงพอก่อนเสมอ (hero เท่านั้น)
        (slot === 'hero' ? findHeroSized(arr) : null) ||
        // ★ 10 ก.ค.: hero เลี่ยงภาพแนวนอนกว้าง (แบนเนอร์) ก่อน — ไม่มีตัวเลือกอื่นค่อยยอม (บรรทัดถัดไป)
        (slot === 'hero' ? arr.find((x) => isHeroChar(x) && (x.triage?.faceCount ?? 0) >= 1 && !(Number(x.width) > 0 && Number(x.height) > 0 && x.width / x.height > 1.5)) : null) ||
        (slot === 'hero' ? arr.find((x) => isHeroChar(x) && (x.triage?.faceCount ?? 0) >= 1) : null) ||
        arr.find((x) => hint.includes(x.triage?.category)) ||
        (slot === 'reaction' ? arr.find((x) => (x.triage?.faceCount ?? 0) >= 1) : null) ||
        arr[0] ||
        null;
      // B (reject ลายน้ำ): ช่องทั่วไปหยิบภาพสะอาดก่อน ไม่มีค่อยยอมลายน้ำ · hero ยึด "ถูกคน 100%" เหนือทุกข้อ
      // ★ เฟส 3.1: ชั้นแรกหยิบ "ฉากที่ยังไม่ใช้" ก่อน (สะอาด+ฉากใหม่ → สะอาด → ฉากใหม่ → อะไรก็ได้)
      const freshScene = (x) => { const k = sceneKeyOf(x); return !k || !chosenScenes.has(k); };
      img = slot === 'hero'
        ? pickFrom(cands)
        : (pickFrom(cands.filter((x) => x.triage?.clean !== false && freshScene(x)))
          || pickFrom(cands.filter((x) => x.triage?.clean !== false))
          || pickFrom(cands.filter(freshScene))
          || pickFrom(cands));
      if (img && slot === 'hero' && !isHeroChar(img)) img = null; // ไม่มีตัวเอกจริง → ปล่อยว่าง ห้ามฝืนผิดคน (role=hero เท่านั้น)
      if (img) { fallbackUsed++; reason = reason || 'fallback ตามสูตรแสนไลค์ (หมวด/คุณภาพ)'; }
    }
    if (img) {
      const _sk = sceneKeyOf(img);
      if (_sk) chosenScenes.add(_sk); // เฟส 3.1: จำฉากที่ใช้แล้ว
      used.add(String(img.id));
      slots[slot] = {
        id: img.id,
        imageUrl: img.imageUrl, // rehost สลับเป็นไฟล์ถาวรให้เองในคลัง (ต้นทางอยู่ originUrl)
        person: img.triage?.person || null,
        category: img.triage?.category || null,
        emotion: img.triage?.emotion || null,
        clean: isClean(img),                       // ★ 8 ก.ค.: พก clean/faces ไป slotPlan → v3 เชื่อป้ายตาคัด (แม่นกว่า detector)
        newsScene: img.triage?.newsScene !== false, // ★ 9 ก.ค.: ภาพแฟ้ม=false
        faces: Number(img.triage?.faceCount) || 0,
        dirtyFallback: dirtyFallbackIds.has(String(img.id)), // ★ เฟส 5.1: ของเติมพูลบาง (clean=false) ไม่ใช่ตัวเลือกสะอาดปกติ
        reason,
        ...(STORY_SEL_ON ? { storyFit: storyFitOf(img) } : {}), // ★ เฟส 6A: คะแนนเล่าเรื่องของภาพที่ลงช่องนี้ (ตรวจได้ใน slotPlan)
        // ★ 8 ก.ค. (CASE-360): backups เรียงสะอาดก่อน — v3 QC สลับภาพเสียแล้วต้องมี "ของสะอาด" ให้หยิบ
        backups: (want?.backups || [])
          .filter((b) => byId.has(String(b)) && !used.has(String(b)))
          .sort((a, b) => (isClean(byId.get(String(b))) ? 1 : 0) - (isClean(byId.get(String(a))) ? 1 : 0))
          .slice(0, 2),
      };
    } else {
      slots[slot] = null;
    }
  }

  if (sceneDupBlocked) console.log(`[MEGA S6] 🗺️ กันฉากซ้ำข้ามช่อง: ตัดตัวเลือกฉากซ้ำ ${sceneDupBlocked} ครั้ง (fallback หาฉากใหม่แทน)`);

  // ★ 10 ก.ค. เฟส 6A (6.2/6.3 ให้ภาพ "เล่าเรื่อง" ชนะจริงในช่องบริบท/วงกลม):
  //   ผู้กำกับ LLM มีกฎเลี่ยง newsScene=false (ภาพแฟ้ม) — แต่ภาพแฟ้มเชิงความสัมพันธ์/ทริปที่มาจากคำค้นเรื่องราว
  //   คือ "วัตถุดิบเล่าแก่นข่าว" (เคสชมพู่: ป้าเจี๊ยบ+หลาน+หอไอเฟล สื่อ ตปท./ครอบครัว) → ถ้าช่อง context/circle
  //   ได้ภาพ story ต่ำ แต่พูลมีภาพ story สูงจริง (≥6) ที่ดีกว่าชัด (≥margin) คุณภาพไม่ห่าง → สลับเป็นตัวหลัก (ของเดิมลง backup ย้อนได้)
  //   hero ไม่แตะเด็ดขาด · กันสลับไปคนนอกข่าว/ฉากซ้ำ/คนซ้ำ hero(วงกลม) · ปิด S6_STORY_FIT=0 = ข้ามทั้งบล็อก
  if (STORY_SEL_ON) {
    try {
      const heroPerson0 = _lc(slots.hero?.person || '');
      for (const slot of activeSlots) {
        if (slot === 'hero' || !STORY_RESCUE_SLOTS.has(slot)) continue;
        const cur = slots[slot];
        const curRec = cur ? byId.get(String(cur.id)) : null;
        const curStory = curRec ? (storyFitOf(curRec) ?? 0) : 0;
        if (curStory >= STORY_HIGH) continue; // ช่องนี้เล่าเรื่องดีอยู่แล้ว — ไม่ต้องกู้
        const curQ = curRec ? (curRec.triage?.quality ?? 0) : 0;
        const curScene = curRec ? sceneKeyOf(curRec) : '';
        const best = sorted
          .filter((x) => !used.has(String(x.id)) && isClean(x))
          // circle = ต้องเป็นคนหลักจริง (ภาพวงกลม=บุคคล) · context รับภาพสถานที่/ทริปที่มาจากคำค้นเรื่องราวได้ (landmark ไม่มีคนในภาพ)
          .filter((x) => isMainChar(x) || (slot === 'context' && storySet.has(_lc(x.query))))
          .filter((x) => (storyFitOf(x) ?? 0) >= STORY_MIN_TO_WIN && (storyFitOf(x) ?? 0) >= curStory + STORY_SWAP_MARGIN)
          .filter((x) => (x.triage?.quality ?? 0) >= curQ - STORY_Q_TOL)
          .filter((x) => { const sk = sceneKeyOf(x); return !sk || sk === curScene || !chosenScenes.has(sk); })
          .filter((x) => slot !== 'circle' || !heroPerson0 || _lc(x.triage?.person || '') !== heroPerson0)
          .sort((a, b) => (storyFitOf(b) ?? 0) - (storyFitOf(a) ?? 0) || ((b.triage?.quality ?? 0) - (a.triage?.quality ?? 0)))[0];
        if (!best) continue;
        const oldBackups = cur ? [String(cur.id), ...((cur.backups || []).map(String))] : [];
        used.add(String(best.id));
        const bsk = sceneKeyOf(best); if (bsk) chosenScenes.add(bsk);
        slots[slot] = {
          id: best.id,
          imageUrl: best.imageUrl,
          person: best.triage?.person || null,
          category: best.triage?.category || null,
          emotion: best.triage?.emotion || null,
          clean: isClean(best),
          newsScene: best.triage?.newsScene !== false,
          faces: Number(best.triage?.faceCount) || 0,
          dirtyFallback: dirtyFallbackIds.has(String(best.id)),
          reason: `story-fit rescue เฟส 6A (${curStory}→${storyFitOf(best)}) — ภาพเล่าแก่นข่าวชนะหน้าชัดเฉยๆ`,
          storyFit: storyFitOf(best),
          backups: oldBackups.filter((b) => byId.has(b)).slice(0, 3),
        };
        console.log(`[MEGA S6] 📖 เฟส 6A สลับช่อง ${slot}: ${cur?.id ?? '(ว่าง)'}(story ${curStory}) → ${best.id}(story ${storyFitOf(best)}, ${best.triage?.person || '-'})`);
      }
    } catch (e) { console.log('[MEGA S6] เฟส 6A story rescue ข้าม:', e.message?.slice(0, 50)); }
  }

  // ★ เฟส 3.2 (คู่กับกติกา composer เฟส 2.3 "วงกลมคนละคนกับ hero"): การันตีว่าแผน (หลัก+สำรอง)
  //   มีภาพ "คนอื่นที่ไม่ใช่ hero" ≥1 ใบเสมอเมื่อพูลมีจริง — ไม่งั้นกติกาฝั่งโรงประกอบไม่มีของให้หยิบ
  //   (หลักฐานรันจริง: log "⭕⚠️ แผนไม่มีภาพคนอื่น" ทั้งที่พูล AC-0045 มีภาพต๊อดเดี่ยว 50 ใบ)
  try {
    const heroPersonS6 = String(slots.hero?.person || '');
    if (heroPersonS6) {
      const inPlanIds = new Set(activeSlots.flatMap((s) => slots[s] ? [String(slots[s].id), ...(slots[s].backups || []).map(String)] : []));
      const hasOther = [...inPlanIds].some((id) => { const p = String(byId.get(id)?.triage?.person || ''); return p && p !== heroPersonS6; });
      if (!hasOther) {
        const wantOther = (x) => { const p = String(x.triage?.person || ''); return p && p !== heroPersonS6 && !inPlanIds.has(String(x.id)) && (x.triage?.faceCount ?? 0) >= 1; };
        // เรียงความอยาก: หน้าเดี่ยวหมวด face-* สะอาด (วงกลมซูมหน้าชัด) → หน้าเดี่ยวสะอาด → มีหน้า+สะอาด → มีหน้า
        const cand = sorted.find((x) => wantOther(x) && isClean(x) && (x.triage?.faceCount ?? 0) === 1 && /^face-/.test(String(x.triage?.category || '')))
          || sorted.find((x) => wantOther(x) && isClean(x) && (x.triage?.faceCount ?? 0) === 1)
          || sorted.find((x) => wantOther(x) && isClean(x))
          || sorted.find(wantOther);
        const targetSlot = slots.circle ? 'circle' : activeSlots.find((s) => slots[s]);
        if (cand && targetSlot) {
          slots[targetSlot].backups = [String(cand.id), ...(slots[targetSlot].backups || []).map(String)].slice(0, 3);
          console.log(`[MEGA S6] 👥 ดันภาพ "คนอื่น" เข้าแผน: ${cand.id} (${cand.triage?.person}) → backups ช่อง ${targetSlot} (เดิมแผนมีแต่ ${heroPersonS6})`);
        }
      }
    }
  } catch { /* การันตีล้มไม่ทำ S6 พัง */ }

  // ★ เฟส 6A: สรุปคะแนนเล่าเรื่องต่อช่อง (ตรวจงานได้จาก log + summary) — เปิดเมื่อ STORY_SEL_ON เท่านั้น
  if (STORY_SEL_ON) {
    const sfLine = activeSlots.filter((s) => slots[s]).map((s) => `${s}:${storyFitOf(byId.get(String(slots[s].id))) ?? '-'}`).join(' ');
    console.log(`[MEGA S6] 📖 story-fit ต่อช่อง (สรุป): ${sfLine}`);
    storyTag = ` · story[${sfLine}]`;
  }

  const filled = activeSlots.filter((s) => slots[s]).length;
  if (!slots.hero) {
    return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพตัวเอกที่ถูกคนเลย — ห้ามฝืนทำปกผิดคน', quality: 'red', dossierPatch: { pickImages: { slots, note: brain.note || '' } } };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `จับคู่ ${filled}/${activeSlots.length} ช่อง${fallbackUsed ? ` (fallback ${fallbackUsed})` : ''}${brainOk ? '' : ' · สมองล่ม→กฎสำรองล้วน'}${storyTag} — ${(brain.note || '').slice(0, 80)}`,
    dossierPatch: { pickImages: { slots, note: brain.note || '', poolSize: pool.length, brainOk, fallbackUsed, ...(STORY_SEL_ON ? { storySelOn: true } : {}) }, ...(job.dossier.refMatch ? { refMatch: job.dossier.refMatch } : {}), ...(job.dossier.artBrief ? { artBrief: job.dossier.artBrief } : {}) },
    quality: filled < activeSlots.length ? 'yellow' : undefined,
  };
}

// ============================================================
// เฟส 3 — S7 ทำปก (auto-cover-v3 ผ่านคิวเดิม — งานปกวิ่ง "เครื่องทีมเท่านั้น" กลับด้านกับงานข่าว)
// ============================================================

// งานปก: queueService ให้เครื่องทีมเท่านั้น claim (QUEUE_COVER_ON_VERCEL!=1) →
// ส่งเข้าคิวผ่าน :3000 (kick worker เครื่องทีมทันที เส้นเดียวกับที่พนักงานใช้บนเว็บแล้ววิ่ง local)
const COVER_ORIGIN_DEFAULT = 'http://localhost:3000';
function coverOrigin() {
  return process.env.MEGA_COVER_ORIGIN || COVER_ORIGIN_DEFAULT;
}

// ---------- S7a ส่งงานปก: ภาพ 5 ช่องที่ S6 คัด → ช่อง "แหล่งรูป" ของ v3 (sourceOnly) ----------
export async function s7_cover(job, { origin } = {}) {
  // ★ audit A1 (9 ก.ค.): tick ที่เกิดบนคลาวด์ (คนกดหน้า /mega ที่เสิร์ฟบน Vercel/Railway) ไม่มี localhost:3000
  //   ให้ยิง → เดิมส่งงานปกล้มแล้ว job ตายทั้งงาน — คืน waiting ให้ tick รอบถัดไปจากเครื่องทีมมาทำขั้นนี้เอง
  if (process.platform !== 'win32' && !process.env.MEGA_COVER_ORIGIN) {
    return { status: 'waiting', nextAction: 'wait', summary: 'ขั้นปกต้องส่งเข้าเครื่องทีม — รอ tick จากเครื่องทีม (คลาวด์ไม่มี MEGA_COVER_ORIGIN)' };
  }
  const d = job.dossier;
  const slots = d.pickImages?.slots || {};
  // ลำดับสำคัญ: hero มาก่อน (ตัวดึงภาพ boost ตามลำดับ) + เพดาน 10 ลิงก์ (extractFromUserSources slice(0,10))
  const links = ['hero', 'reaction', 'action', 'context', 'circle']
    .map((s) => slots[s]?.imageUrl)
    .filter(Boolean);
  if (links.length < 3) {
    return { status: 'failed', nextAction: 'fail', summary: `ภาพจาก S6 ไม่พอทำปก (${links.length} ใบ ต้อง ≥3)`, quality: 'red' };
  }
  // ★ 7 ก.ค. FIX "คลังแน่นแต่ปกล้มภาพไม่พอ": เดิม backups เป็น id ถูกทิ้ง (นับรายงานเฉยๆ) แล้วส่งแค่ 5 ลิงก์เป๊ะ —
  //   ลิงก์หน้าเว็บ/วิดีโอพัง 1-2 ใบ (403) = พูลต่ำกว่า 4 ล้มทั้งปก → แปลง id→URL จากคลังเคส ต่อท้าย (ไฟล์รูปตรงก่อน) เพดาน 10
  let backupUrls = [];
  let urlTriage = new Map(); // ★ 8 ก.ค.: url → {clean,faces} จากคลัง (ส่งเป็น slotPlan ให้ v3 เชื่อป้ายตาคัด)
  try {
    const backupIds = Object.values(slots).flatMap((s) => s?.backups || []);
    if (origin && d.images?.caseId) {
      const lib = await jfetch(`${origin}/api/images/${encodeURIComponent(d.images.caseId)}`, {}, 30000);
      // ★ เฟส 1.3 (slotPlan v2): พกป้ายตาคัดครบ — person/category/emotion/note + กล่อง (faceBox/peopleBox = hint เท่านั้น
      //   ตาม audit 9 ก.ค.: peopleBox full-frame ~23% เป็นขยะ + พิกัดอิง thumbnail — ชั้นครอปต้องกรอง/เผื่อ margin เอง)
      urlTriage = new Map((lib?.images || []).map((x) => [String(x.imageUrl), {
        clean: x.triage?.clean !== false,
        newsScene: x.triage?.newsScene !== false,
        faces: Number(x.triage?.faceCount) || 0,
        thumbnailUrl: x.thumbnailUrl || '',
        person: x.triage?.person || null,
        category: x.triage?.category || null,
        emotion: x.triage?.emotion || null,
        note: String(x.triage?.note || '').replace(/\s+/g, ' ').trim().slice(0, 64) || null,
        faceBox: x.triage?.faceBox || null,
        peopleBox: x.triage?.peopleBox || null,
      }]));
      const byId = new Map((lib?.images || []).map((x) => [String(x.id), x.imageUrl]));
      const isDirect = (u) => /\.(jpe?g|png|webp|gif)([?#]|$)/i.test(String(u || ''));
      backupUrls = backupIds.map((b) => byId.get(String(b))).filter(Boolean)
        .sort((a, b) => (isDirect(b) ? 1 : 0) - (isDirect(a) ? 1 : 0));
    }
  } catch { /* สำรองไม่ critical — ได้แค่ลิงก์หลักก็เดินต่อ */ }
  // ★ 9 ก.ค. ค่ำ (อุดรอย "ภาพคนอื่นหล่น" — เหมือน compose-test): เรียง backups ให้ "คนละคนกับ hero"
  //   มาก่อนไฟล์ตรง + การันตี 1 ใบรอดเพดาน 10 (ไม่งั้นกติกาวงกลมคนละคนไม่มีของให้หยิบ)
  const _heroPersonPlan = String(slots.hero?.person || urlTriage.get(String(slots.hero?.imageUrl))?.person || '');
  const _diffP = (u) => { const p = String(urlTriage.get(String(u))?.person || ''); return !!(_heroPersonPlan && p && p !== _heroPersonPlan); };
  backupUrls = backupUrls.slice().sort((a, b) => (_diffP(b) ? 2 : 0) - (_diffP(a) ? 2 : 0)); // คงลำดับไฟล์ตรงเดิมภายในกลุ่ม (sort เดิมทำไว้แล้ว)
  const _seenL = new Set();
  const allLinks = [...links, ...backupUrls]
    .filter((u) => { const k = String(u); if (_seenL.has(k)) return false; _seenL.add(k); return true; })
    .slice(0, 10);
  if (_heroPersonPlan && !allLinks.some(_diffP)) {
    const cand = backupUrls.find((u) => _diffP(u) && !allLinks.includes(u));
    if (cand && allLinks.length >= 4) { allLinks[allLinks.length - 1] = cand; console.log('[MEGA S7] 👥 การันตีภาพคนอื่นรอดเพดาน 10 ลิงก์'); }
  }
  const backup = allLinks.length - links.length; // จำนวนสำรองที่ส่งจริง
  // ★ 8 ก.ค. (CASE-363/AC-0035 hero โดนดึงลง + ภาพ text หลุดเข้า main): ส่ง "แผนช่อง" ให้ v3
  //   หลักการ: S6 ตัดสิน · v3 แค่ประกอบ — v3 บังคับ main=hero ของแผน + เชื่อ clean ของตาคัด (แม่นกว่า detector 512→1024)
  const heroUrl = slots.hero?.imageUrl || null;
  const slotPlan = allLinks.map((u) => {
    const primary = SLOT_ORDER.find((s) => slots[s]?.imageUrl === u);
    const t = urlTriage.get(String(u)) || {};
    return {
      url: u,
      slot: primary || null, // hero/reaction/action/context/circle ถ้าเป็นภาพหลัก · null=สำรอง
      clean: primary ? (slots[primary].clean !== false) : (t.clean !== false),
      newsScene: primary ? (slots[primary].newsScene !== false) : (t.newsScene !== false),
      faces: primary ? (slots[primary].faces || 0) : (t.faces || 0),
      dirtyFallback: primary ? !!slots[primary].dirtyFallback : false, // ★ เฟส 5.1: ติดธงถ้าเป็นของเติมพูลบาง (clean=false)
      isHero: u === heroUrl,
      // ★ 8 ก.ค. (CASE-366): thumbnail สำรอง (gstatic cache) — sourceLinks เป็น string เปล่า ไม่พก thumbnailUrl
      //   ส่งผ่าน slotPlan แทน ให้ v3 ใช้ตอนโหลดตรงพัง (Instagram/TikTok โดน anti-hotlink)
      thumbnailUrl: t.thumbnailUrl || '',
      // ★ เฟส 1.3 (slotPlan v2): ป้ายตาคัดไปให้ถึงโรงประกอบ — ใครอยู่ในภาพ/หมวด/ฉาก + กล่อง (hint เท่านั้น)
      person: primary ? (slots[primary].person || t.person || null) : (t.person || null),
      category: primary ? (slots[primary].category || t.category || null) : (t.category || null),
      emotion: primary ? (slots[primary].emotion || t.emotion || null) : (t.emotion || null),
      note: t.note || null,
      faceBox: t.faceBox || null,
      peopleBox: t.peopleBox || null,
    };
  });
  const nd = d.generate?.newsData || {};
  // 🎯 ref-first (7 ก.ค.): ใช้ "ปกเป้าเดียวกับที่ s6 ใช้เลือกภาพ" (dossier.refMatch) — เป้าเดียวกันทั้งท่อ
  //   (fallback: ถ้าแฟ้มเก่าไม่มี refMatch เช่นงานค้างก่อนอัป → หาใหม่ตรงนี้)
  let refDNA = d.refMatch?.dna || null;
  let refInfo = refDNA ? ` · 🎯ref ${d.refMatch.styleName || ''} (${d.refMatch.reason || ''})`.slice(0, 90) : '';
  if (!refDNA) {
    try {
      const { pickBestRef } = await import('@/lib/refCoverMatch');
      const c = d.compass || {};
      const m = await pickBestRef({
        emotion: c.primaryEmotion || '',
        text: [c.angle, ...(c.secondaryEmotions || [])].filter(Boolean).join(' '),
        charCount: (c.mainCharacters || []).length,
        dreamShots: (c.visualDreamShots || []).map((v) => v.slot || v.description || ''),
      });
      if (m?.ref?.dna) { refDNA = m.ref.dna; refInfo = ` · 🎯ref ${m.ref.styleName || m.ref.id} (${m.reason})`.slice(0, 90); }
    } catch { /* คลัง ref ว่าง/ล้ม → ไม่มี ref (ใช้ template ปกติ) ไม่กระทบ */ }
  }
  const payload = {
    jobType: 'cover',
    composer: 'mega', // 🏭 8 ก.ค. (ทีมกราฟฟิก): โรงประกอบใหม่ /api/mega/compose — auto-cover-v3 ถอดทิ้งแล้ว
    newsTitle: nd.newsTitle || d.desk?.title || '',
    slotPlan, // แผนช่องจาก S6 (ภาพ→ช่อง/hero/clean/thumbnail) — โรงประกอบทำตามเป๊ะ ไม่ตัดสินใหม่
    userId: MEGA_USER,
    ...(refDNA ? { refDNA } : {}), // 🎯 โครงจริงจากปกเป้า
    ...(d.refMatch?.imagePath ? { refImagePath: d.refMatch.imagePath } : {}), // 👁️ ภาพ ref จริงให้ตาเทียบ
  };
  const q = await jfetch(`${coverOrigin()}/api/queue/add`, { method: 'POST', body: JSON.stringify(payload) }, 60000);
  if (!q.success || !q.jobId) {
    return { status: 'failed', nextAction: 'retry', summary: 'ส่งงานปกไม่สำเร็จ: ' + (q.error || q.httpStatus) };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ส่งทำปกแล้ว job ${String(q.jobId).slice(0, 10)} (ภาพ ${links.length} ใบจาก 5 ช่อง · สำรอง ${backup})${refInfo}`,
    dossierPatch: { cover: { queueJobId: q.jobId, enqueuedAt: new Date().toISOString(), sourceLinks: links, refStyle: refInfo || null } },
  };
}

// ---------- S7w รอปกเสร็จ: โพล + เซฟไฟล์ปกถาวรทันที (result มี base64 — ห้ามเก็บลงแฟ้ม) ----------
export async function s7_wait(job) {
  // ★ audit A1: เช่นเดียวกับ s7_cover — บนคลาวด์ไม่มีคิว :3000 ให้โพล อย่าปล่อย jfetch throw จน job ตาย
  if (process.platform !== 'win32' && !process.env.MEGA_COVER_ORIGIN) {
    return { status: 'waiting', nextAction: 'wait', summary: 'รอผลปกจากเครื่องทีม (tick นี้เกิดบนคลาวด์ — โพลคิวไม่ได้)' };
  }
  const cv = job.dossier.cover || {};
  const st = cv.queueJobId
    ? await jfetch(`${coverOrigin()}/api/queue/status?id=${encodeURIComponent(cv.queueJobId)}`, {}, 30000)
    : { error: 'ไม่มีเลขงานปกในแฟ้ม (ขั้นส่งงานโดนข้าม)' };
  const status = st.status || st.jobStatus;
  if (status === 'completed' && st.result) {
    const r = st.result;
    const base64 = r.base64 || r.coverBase64 || r.data?.base64 || '';
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(base64);
    if (!m) {
      return { status: 'failed', nextAction: 'fail', summary: 'ปกเสร็จแต่ไม่พบรูปในผล (ไม่มี base64)', quality: 'red' };
    }
    // ★ Wave2 A1: ด่าน QC แข็ง — ตัดสิน "ผ่าน/ไม่ผ่าน" จากธงคุณภาพ deterministic ก่อนตัดสินใจเข้าคลัง
    //   (refSimilarity ส่งเข้าไปด้วยแต่ gate ใช้เป็น advisory เท่านั้น — พิสูจน์แล้วเชื่อไม่ได้ เคส AC-0066)
    const qcVerdict = evaluateCoverQc({ qcFlags: r.qcFlags, refSimilarity: r.refSimilarity ?? null, manifest: r.manifest || null });
    if (qcVerdict.pass) console.log(`[MEGA S7] ✅ QC gate ผ่าน (${job.id})${qcVerdict.reasons.length ? ' · เตือน: ' + qcVerdict.reasons.join(' / ') : ''}`);
    else console.log(`[MEGA S7] ⛔ QC gate: ${qcVerdict.reasons.join(' / ')} → ${qcVerdict.suggestedStatus}`);

    // เซฟเป็นไฟล์ให้ UI ใช้ได้เลย (ทั้งผ่าน/ไม่ผ่าน — คนต้องเปิดดูใบที่ถูก hold ได้)
    // ★ 9 ก.ค.: เขียนดิสก์ล้ม (Vercel/Railway อ่านอย่างเดียว) ห้ามพังงาน — คลังคลาวด์รับช่วงเสิร์ฟภาพแทน
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const file = `${job.id}-${Date.now().toString(36)}.${m[1] === 'png' ? 'png' : 'jpg'}`;
    let coverPath = `/mega-covers/${file}`;
    try {
      const dir = path.join(process.cwd(), 'public', 'mega-covers');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, file), Buffer.from(m[2], 'base64'));
    } catch { coverPath = null; }

    // แฟ้ม cover ที่เก็บครบทุกกรณี (ผ่าน/hold) — คนต้องเห็น coverPath/manifest/qcVerdict ได้เสมอ
    const coverCore = {
      ...cv,
      coverPath,
      template: r.template || '',
      score: r.score ?? null,
      coverCaseId: r.caseId || '',
      directorReason: (r.directorReason || '').slice(0, 300),
      manifest: r.manifest || null, // ★ Wave1 Batch E: ความจริงของรอบประกอบ (จาก composeAndVerify) — additive
      qcVerdict, // ★ Wave2 A1: คำตัดสินด่าน (pass/reasons/suggestedStatus/advisory)
      completedAt: new Date().toISOString(),
    };

    // ⛔ ไม่ผ่านด่าน → ของเสียไม่เข้าคลัง (ไม่เรียก addMegaCover) แต่เก็บ dossier ครบ + จบงานด้วยสถานะบอกความจริง
    //   คืน status='quality_hold' + holdStatus → ให้ tick แปลงเป็นสถานะ terminal ใหม่ (แตะ state machine น้อยสุด)
    if (!qcVerdict.pass) {
      if (!coverPath) coverPath = ''; // ไม่มีคลังรับช่วงเสิร์ฟภาพ (ไม่ addMegaCover) → path ว่างได้ (base64 ยังอยู่ในคิว)
      return {
        status: 'quality_hold',
        nextAction: 'hold',
        holdStatus: qcVerdict.suggestedStatus, // 'needs_gap_search' | 'manual_review'
        summary: `⛔ ปกไม่ผ่านด่าน QC → ${qcVerdict.suggestedStatus}: ${qcVerdict.reasons.join(' · ')}`.slice(0, 200),
        quality: 'yellow',
        dossierPatch: { cover: { ...coverCore, coverPath, archiveId: null } }, // ไม่เข้าคลัง = ไม่มี archiveId (ซื่อตรง)
      };
    }

    // ✅ ผ่านด่าน → เข้าคลังตามปกติ
    // 🗂️ ส่งเข้าคลังงานปก MEGA อัตโนมัติ (ล้มไม่ critical ต่อสายพาน) — base64 ขึ้นคลาวด์ให้ Vercel เห็นด้วย
    // ★ 10 ก.ค.: id ที่ addMegaCover คืนกลับมาไม่ใช่ job.id ตรงๆ อีกแล้ว (เป็น archive id ต่อ revision
    //   MCV-<job.id>-rN กัน insert ชน PK เดิม) → เก็บ ent ไว้นอก try เพื่อฝัง archiveId ลง dossier ด้วย
    let ent = null;
    try {
      const { addMegaCover } = await import('@/lib/megaCoverArchive');
      ent = await addMegaCover({ id: job.id, title: job.dossier.desk?.title || '', source: 'mega', imageCaseId: job.dossier.images?.caseId || null, coverCaseId: r.caseId || '', coverPath, base64, template: r.template || '', score: r.score ?? null, throughMega: true, qcFlags: Array.isArray(r.qcFlags) ? r.qcFlags : [] }); // audit: ธงคุณภาพต้องถึงคลังจากทางหลักด้วย
      if (!coverPath) coverPath = `/api/mega-covers/img?id=${encodeURIComponent(ent?.id || job.id)}`;
    } catch { if (!coverPath) coverPath = ''; /* คลังไม่ critical */ }
    return {
      status: 'done',
      nextAction: 'continue',
      summary: `ปกเสร็จ! template ${r.template || '-'} · คะแนน QC ${r.score ?? '-'} · เคสปก ${r.caseId || '-'}`,
      dossierPatch: {
        cover: {
          ...coverCore,
          coverPath, // อาจถูกอัปเป็น /api/mega-covers/img หลัง addMegaCover (เขียนดิสก์ล้ม)
          archiveId: ent?.id || cv.archiveId || null, // ★ 10 ก.ค.: revision id จริงในคลัง mega-cover-runs (ต่างจาก job.id)
        },
      },
    };
  }
  const purged = !status && st.error;
  if (status === 'failed' || status === 'superseded' || purged) {
    if (!cv.retriedCover) {
      return {
        status: 'done',
        nextAction: 'goto:s7_cover',
        summary: `งานปกจบแบบ ${status || 'หายจากคิว'} (${(st.error || '').slice(0, 60)}) → ส่งใหม่รอบแก้ตัว`,
        dossierPatch: { cover: { retriedCover: true, queueJobId: null } },
        quality: 'yellow',
      };
    }
    return { status: 'failed', nextAction: 'fail', summary: `งานปกจบแบบ ${status || 'หายจากคิว'} (ลองซ้ำแล้ว): ${st.error || ''}`.slice(0, 150), quality: 'red' };
  }
  const age = cv.enqueuedAt ? Math.round((Date.now() - new Date(cv.enqueuedAt).getTime()) / 60000) : 0;
  if (age > 30) {
    return { status: 'failed', nextAction: 'fail', summary: `รอปกเกิน 30 นาที (สถานะล่าสุด: ${status || 'ไม่พบงาน'})`, quality: 'red' };
  }
  return { status: 'waiting', nextAction: 'wait', summary: `รอประกอบปก… (${status || 'pending'} · ${age} นาที)` };
}

// ---------- ตารางเดินสายพาน เฟส 1+2+3 ----------
export const STAGE_FLOW = {
  s1_pick: { run: s1_pick, next: 's1_5_preflight', label: 'S1 คัดข่าว' },
  s1_5_preflight: { run: s1_5_preflight, next: 's2_extract', label: 'S1.5 เช็ควัตถุดิบ' },
  s2_extract: { run: s2_extract, next: 's2_5_compass', label: 'S2 สกัดเนื้อ' },
  s2_5_compass: { run: s2_5_compass, next: 's3_generate', label: 'S2.5 เข็มทิศเรื่อง' },
  s3_generate: { run: s3_generate, next: 's3_wait', label: 'S3 ส่งเจนข่าว' },
  s3_wait: { run: s3_wait, next: 's4_choose', label: 'S3 รอผลเจน' },
  s4_choose: { run: s4_choose, next: 's5_case', label: 'S4 เลือกเนื้อดีสุด' },
  s5_case: { run: s5_case, next: 's5_keywords', label: 'S5 เปิดเคสภาพ' },
  s5_keywords: { run: s5_keywords, next: 's5_search', label: 'S5 สกัดคีย์เวิร์ด' },
  s5_search: { run: s5_search, next: 's5_profile', label: 'S5 ค้นภาพหลายแหล่ง' },
  // ★ 9 ก.ค. เฟส 4b ข้อ 4.3: โปรไฟล์อัตโนมัติ — อยู่ก่อน s5_triage เสมอ (ภาพยังไม่มี triage ต้องให้ s5_triage ติดป้ายให้)
  s5_profile: { run: s5_profile, next: 's5_triage', label: 'S5 โปรไฟล์อัตโนมัติ' },
  s5_triage: { run: s5_triage, next: 's5_lens', label: 'S5 ตาคัดคลัง' },
  s5_lens: { run: s5_lens, next: 's5_clipframe', label: 'S5 ค้นย้อนกลับ (Lens)' },
  s5_clipframe: { run: s5_clipframe, next: 's5_gapsearch', label: 'S5 เฟรมคลิป (รอ/เช็คเฟรม)' },
  // ★ 9 ก.ค. เฟส 4b ข้อ 4.5: ค้นรอบสองอัจฉริยะ — อยู่หลังทุกแหล่งเสริม (Lens/เฟรมคลิป) ก่อนตัดสินว่ายังขาดไหม
  s5_gapsearch: { run: s5_gapsearch, next: 's6_slots', label: 'S5 ค้นรอบสองอัจฉริยะ' },
  s6_slots: { run: s6_slots, next: 's7_cover', label: 'S6 เลือกภาพลงช่อง' },
  s7_cover: { run: s7_cover, next: 's7_wait', label: 'S7 ส่งทำปก' },
  s7_wait: { run: s7_wait, next: 'cover_ready', label: 'S7 รอปกเสร็จ' },
};
