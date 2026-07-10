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
// ★ Wave3 Phase1 (10 ก.ค.): Fair Shadow Diagnostics V2 — เก็บ raw LLM/post-gate/solver rank + universe/coverage
//   เท่านั้น ห้ามแตะผลปกจริง · ปิดกลับ dossier/log/solver call แบบเดิม: MEGA_SOLVER_DIAGNOSTICS_V2=0
const SOLVER_DIAGNOSTICS_V2_ON = process.env.MEGA_SOLVER_DIAGNOSTICS_V2 !== '0';
// Wave3 pre-activation diagnostics only: derive semantic slot ids from the matched ref and
// compare solver on exactly the candidates visible to the LLM. Neither switch mutates `slots`.
const REF_ROLE_CONTRACT_SHADOW_ON = process.env.MEGA_REF_ROLE_CONTRACT !== '0';
const SOLVER_FAIR_UNIVERSE_ON = process.env.MEGA_SOLVER_FAIR_UNIVERSE !== '0';
const SELECTION_TRACE_ON = process.env.MEGA_SELECTION_TRACE !== '0';
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
// ★ Wave2 Batch D1 (10 ก.ค. — _PLAN_MEGA_V2.md Wave2 ข้อ 4): "กักกัน" ภาพข้อมูลไม่ครบ แยกออกจากภาพที่ตรวจครบแล้ว —
//   เดิม 2 ช่องโหว่เงียบ: (1) ภาพไม่มีป้าย triage เลย หายไปเงียบๆ ในตัวกรอง rawPool ของ s6_slots ไม่มีใครนับ/รายงาน
//   (2) heroSizeOk ยอมภาพที่วัดขนาดจริงไม่ได้ (rss==null) ผ่านเกณฑ์ hero ถ้าไม่ใช่ lowRes → แข่ง hero กับภาพที่วัดขนาดจริงผ่านแล้ว
//   ตอนนี้: นับ+รายงานทั้งคู่เสมอ (log ไม่ผูกสวิตช์) และปิดช่องโหว่ (2) เมื่อพูลมีตัวเลือกวัดขนาดแล้วอย่างน้อย 1 ใบ
//   ไม่แตะ _heroGradeOf (ด่าน gap search — calibrate แล้ว) · ปิดกลับพฤติกรรมเดิมทั้งหมด: MEGA_QUARANTINE=0
const QUARANTINE_ON = process.env.MEGA_QUARANTINE !== '0';

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

// ★ Wave2 Batch D1: จำแนกภาพเดี่ยว — 'untriaged' (ยังไม่มีป้ายตาคัดเลย) / 'size_unknown' (มีป้ายแต่หาขนาดจริงไม่ได้
//   และไม่ใช่ thumbnail-only ที่รู้อยู่แล้วว่าเล็ก) / 'ok' (ที่เหลือ) — pure function ไม่แตะ state ไฟล์อื่น เทสตรงได้
export function classifyPoolImage(x) {
  if (!x || typeof x.triage !== 'object' || x.triage === null) return 'untriaged';
  const rw = Number(x.realWidth), rh = Number(x.realHeight);
  const hasRealDims = rw > 0 && rh > 0;
  const hasTriageShortSide = Number(x.triage.realShortSide) > 0;
  if (!hasRealDims && !hasTriageShortSide && x.rehostQuality !== 'thumbnail') return 'size_unknown';
  return 'ok';
}

export async function s6_slots(job, { origin, _deps } = {}) {
  // ★ SEM-1: dependency injection เพื่อ testability เท่านั้น — default = ของจริง (production เดิม 100%)
  const _brainFn = _deps?.slotDirectorBrain || slotDirectorBrain;
  const _jf = _deps?.fetchJson || jfetch;
  const im = job.dossier.images || {};
  const r = await _jf(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
  if (!r.success) return { status: 'failed', nextAction: 'retry', summary: 'อ่านคลังรูปไม่ได้: ' + (r.error || r.httpStatus) };

  const rawPool = (r.images || []).filter((x) => x.triage && x.triage.relevant !== false);
  if (!rawPool.length) return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพที่ตายืนยันว่าเกี่ยวเลย — ทำปกไม่ได้', quality: 'red' };
  // ★ 9 ก.ค. เฟส 5.1+5.2 (แผนคุณภาพคลังรูป): พูลเข้า s6 ต้องสะอาด default —
  //   เดิมกรองแค่ relevant!==false → ภาพ clean=false เข้าพูลได้ พอของสะอาดขาดสมองเลือกภาพจำใจหยิบของสกปรก
  //   ธง junkHidden (เฟส 5.3 AI junk scan ตั้งแทนลบถาวร — ย้อนกลับได้) ห้ามเข้าพูลเสมอ ไม่ผูกกับ kill-switch ด้านล่าง
  const notHidden = (x) => x.triage?.junkHidden !== true;
  const visiblePool = rawPool.filter(notHidden);
  // ★ Wave2 Batch D1: นับ+รายงาน "กักกัน" เสมอ (แม้ MEGA_QUARANTINE=0) — ความจริงต้องเห็น แม้ยังไม่เปลี่ยนพฤติกรรมกรอง
  //   untriaged มาจาก r.images ทั้งก้อน (ก่อนกรอง rawPool) — เดิมภาพไม่มีป้าย triage หายเงียบตรงตัวกรอง rawPool ด้านบน
  //   sizeUnknown นับใน visiblePool (พูลที่ยังไม่ถูกซ่อน junkHidden) ตามสเปก Wave2 ข้อ 4
  const untriagedList = (r.images || []).filter((x) => classifyPoolImage(x) === 'untriaged');
  const sizeUnknownList = visiblePool.filter((x) => classifyPoolImage(x) === 'size_unknown');
  const quarantineSampleIds = [...untriagedList, ...sizeUnknownList].map((x) => x.id).filter((id) => id != null).slice(0, 5);
  console.log(`[MEGA S6] 🧿 กักกัน: ไม่มีป้าย ${untriagedList.length} ใบ · วัดขนาดไม่ได้ ${sizeUnknownList.length} ใบ (พูลใช้จริง ${visiblePool.length})`);
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
  // ★ Wave2 Batch D1: ตัวติดตามว่าเคย "กักกัน" ภาพวัดขนาดไม่ได้ออกจาก hero หรือไม่ (ไว้รายงานใน dossierPatch ท้ายฟังก์ชัน)
  //   hasMeasuredHeroCandidate คำนวณครั้งเดียวหลัง sorted พร้อม (ดูด้านล่าง) — ก่อนหน้านั้น heroSizeOk ยังไม่ถูกเรียกจริง
  let heroDemotedFlag = false;
  let hasMeasuredHeroCandidate = false;
  const heroSizeOk = (x) => {
    if (!S6_REAL_SIZE_GATE) return true; // kill-switch ปิด = พฤติกรรมเดิม (ไม่กรองขนาด)
    if (x.rehostQuality === 'thumbnail') return false;
    const rss = realShortSideOf(x);
    if (rss != null) return rss >= HERO_MIN_SHORT_SIDE;
    // ★ Wave2 Batch D1: วัดขนาดจริงไม่ได้ (rss==null) — เดิมผ่านเกณฑ์เสมอถ้าไม่ lowRes → ภาพข้อมูลไม่ครบแข่ง hero
    //   ชนะภาพที่วัดขนาดจริงผ่านเกณฑ์แล้วได้ (ไม่ควร) → พูลมีตัวเลือกวัดแล้วอย่างน้อย 1 ใบ = ห้ามภาพวัดไม่ได้ชิง hero (กักกัน)
    //   ไม่มีตัวเลือกวัดแล้วเลย = พฤติกรรมเดิมเป๊ะ (กันงานตายเพราะพูลไม่มีของวัดได้) · ปิดกลับพฤติกรรมเดิม: MEGA_QUARANTINE=0
    if (QUARANTINE_ON && hasMeasuredHeroCandidate) { heroDemotedFlag = true; return false; }
    return x.lowRes !== true;
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

  // ★ Wave2 Batch D1: คำนวณครั้งเดียวหลัง sorted พร้อม — พูลนี้มีภาพที่วัดขนาดจริงผ่านเกณฑ์ hero แล้วอย่างน้อย 1 ใบไหม
  //   (heroSizeOk ด้านบนใช้ค่านี้ปิดช่องโหว่ภาพวัดขนาดไม่ได้แข่ง hero — ต้องคำนวณก่อน heroSizeOk ถูกเรียกจริงจุดแรกท้ายไฟล์)
  if (QUARANTINE_ON) {
    hasMeasuredHeroCandidate = sorted.some((x) => { const rss = realShortSideOf(x); return rss != null && rss >= HERO_MIN_SHORT_SIDE; });
    if (!hasMeasuredHeroCandidate) console.log('[MEGA S6] 🧿 เกณฑ์ขนาด hero: ไม่มีตัวเลือกวัดขนาดแล้วในพูล — ยอมใช้ภาพวัดไม่ได้แบบเดิม (กันงานตาย)');
  }

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
  // ★ Wave3 Phase1: mirror เพดาน prompt ของ slotDirectorBrain (megaBrains.js IMG_META_BUDGET=18000)
  //   เพื่อบันทึกความจริงว่า LLM เห็นกี่ id โดยไม่เปลี่ยน candidate/ลำดับ/ผลเลือกเดิม หากค่าต้นทางเปลี่ยนต้องแก้ mirror นี้พร้อมกัน
  const solverDiagLlmVisibleIds = SOLVER_DIAGNOSTICS_V2_ON ? (() => {
    const ids = [];
    let len = 0;
    for (const m of meta) {
      const line = JSON.stringify(m);
      if (len + line.length + 2 > 18000) break;
      len += line.length + 2;
      ids.push(String(m.id));
    }
    return ids;
  })() : null;

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
      // ★ รอบ 6 P1: refId เพิ่มเฉพาะใต้สวิตช์ — ปิด = ไม่มี property เลย (object shape เท่า legacy 100%)
      job.dossier.refMatch = { ...(process.env.MEGA_SELECTION_SPEC === '1' && lockedRef.id ? { refId: lockedRef.id } : {}), dna: lockedRef.dna, styleName: lockedRef.styleName || lockedRef.id, imagePath: lockedRef.imagePath, reason: 'ล็อก refId', typeMatched: true, dnaHash: _dnaHashFor(lockedRef.dna), refBoundAt: new Date().toISOString() };
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
          // ★ รอบ 6 P1: refId เพิ่มเฉพาะใต้สวิตช์ — ปิด = ไม่มี property เลย (object shape เท่า legacy 100%)
          job.dossier.refMatch = { ...(process.env.MEGA_SELECTION_SPEC === '1' && m.ref.id ? { refId: m.ref.id } : {}), dna, styleName: m.ref.styleName || m.ref.id, imagePath: m.ref.imagePath, reason: m.reason, typeMatched: !weak, dnaHash: _dnaHashFor(dna), refBoundAt: new Date().toISOString() };
        }
      } catch { /* ไม่มีคลัง ref → เดินแบบเดิม */ }
    }
  }
  // แมตช์หลวม → ไม่ส่ง DNA เข้าสมองเลือกภาพ (เลือกตามเข็มทิศข่าวล้วน) · โครงยังใช้ตอน s7
  const _refDNA = job.dossier.refMatch?.typeMatched ? job.dossier.refMatch.dna : null;
  // ★ 8 ก.ค. (CASE-361): เทมเพลตของ ref ตระกูลหลัก (vt_ref_5x4) มีแค่ 4 ช่องภาพ แต่เดิมเลือกครบ 5 บทบาทเสมอ
  //   → ช่องที่ 5 ไม่ได้ถูกใช้จริงตอนประกอบ (จำนวนภาพไม่ตรงกับที่ ref กำหนด) — ตัดให้เหลือเท่า panelCount ของ ref ที่แมตช์ (ไม่มี ref/เลขแปลก → คงเดิม 5 ปลอดภัย)
  const _panelCount = Number(job.dossier.refMatch?.dna?.panelCount);
  // ⚠️ root cause (Codex ตรวจรอบ 3 — จดไว้แก้ batch semantic-selection ภายใต้ kill switch ห้ามแตะรอบนี้):
  //   slice ตามตำแหน่งทำ ref 4 ช่องที่มี circle เสีย "บท circle" ไป (ได้ hero/reaction/action/context แทน)
  //   → แผน S6 ไม่มีภาพให้วงกลมเลย — SelectionSpec v1 เปิดโปงเป็น missingPrimary/strictReady=false แล้ว
  let activeSlots = (_panelCount >= 3 && _panelCount <= SLOT_ORDER.length) ? SLOT_ORDER.slice(0, _panelCount) : SLOT_ORDER;
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

  // ★ SEM-1 (Codex อนุมัติ design v2 — เลือกภาพตามบทช่องจริงของ ref): เงื่อนไขเปิดต้องครบ 4 (invariant I5)
  //   ① MEGA_SEMANTIC_SELECTION=1 ② MEGA_SELECTION_SPEC=1 ③ ref แมตช์แน่น (_refDNA=typeMatched เท่านั้น)
  //   ④ contract จาก template.slots จริง + realized template map ครบ (จำนวนช่องตรง) — ขาดข้อใด = legacy เดิมทั้งท่อ
  //   OFF = ไม่มี field/log/prompt ใหม่แม้ byte เดียว · solver ยัง shadow · ยังไม่มี strict consumer/W3-3
  let semContract = null;
  if (process.env.MEGA_SEMANTIC_SELECTION === '1' && process.env.MEGA_SELECTION_SPEC === '1' && _refDNA) {
    try {
      const specApi = await import('@/lib/refSlotContract');
      const { dnaToTemplateSpec } = await import('@/lib/refTemplate');
      const c = specApi.buildRefSlotContract({ refDNA: _refDNA, artBriefOrders: job.dossier.artBrief?.orders || [] });
      const realized = dnaToTemplateSpec(_refDNA);
      const okSource = c?.source === 'template.slots' && Array.isArray(c.slots) && c.slots.length >= 3;
      const okRealized = !!realized && Array.isArray(realized.slots) && realized.slots.length === c.slots.length;
      if (okSource && okRealized) {
        semContract = c;
        activeSlots = c.slots.map((s) => s.id); // instance ids เรียงตาม sourceIndex — deterministic
        console.log(`[MEGA S6] 🧬 semantic-selection ON: ${activeSlots.join(' · ')} (${c.slots.length} ช่องจากบท ref จริง)`);
      } else {
        console.log(`[MEGA S6] 🧬 semantic-selection ขอเปิดแต่เงื่อนไขไม่ครบ (source=${c?.source || '-'} · realizedMap=${okRealized}) → legacy`);
      }
    } catch (e) { console.log('[MEGA S6] 🧬 semantic-selection เปิดไม่ได้ (ล้ม) → legacy:', String(e?.message || '').slice(0, 60)); }
  }
  const semById = semContract ? new Map(semContract.slots.map((s) => [s.id, s])) : null;
  // canonical hero = instance แรกที่บท hero "ที่ไม่ใช่วงกลม" (ผู้ตรวจ P1: canon ชนกับวงกลมทำกติกา
  //   คนละคน/กฎ 11 ขัดแย้งตัวเอง) → ไม่มีบท hero = rect ตัวแรก → สุดท้ายค่อยยอมช่องแรก · legacy = 'hero' เดิมเป๊ะ
  const _canonHeroId = semContract
    ? (semContract.slots.find((s) => (s.refRole === 'hero' || s.refRole === 'main') && s.shape !== 'circle')
      || semContract.slots.find((s) => s.shape !== 'circle')
      || semContract.slots[0]).id
    : 'hero';
  const _circleKey = semContract ? (semContract.slots.find((s) => s.shape === 'circle')?.id || 'circle') : 'circle';
  const _isHeroSlot = (slot) => slot === _canonHeroId;
  const _isCircleSlot = (slot) => (semContract ? semById.get(slot)?.shape === 'circle' : slot === 'circle');
  // แปลง instance → บท generic สำหรับตาราง hint/ชุด story เดิม (legacy: คืนชื่อเดิมตรงตัว = พฤติกรรมเดิม)
  const _legacyKeyOf = (slot) => {
    if (!semContract) return slot;
    const cs = semById.get(slot);
    if (!cs) return slot;
    if (cs.shape === 'circle') return 'circle';
    if (SLOT_ORDER.includes(cs.refRole)) return cs.refRole;
    return (cs.solverRole === 'context' || cs.solverRole === 'evidence') ? 'context' : 'action';
  };
  // ★ SEM-1 correction (Codex P1-5): slotOrder = ลำดับ contract sourceIndex ตรงๆ ห้ามย้าย hero ขึ้นหน้า
  //   (canonical hero = face/identity policy เท่านั้น ไม่ใช่ layout order — S7 หา hero ด้วย heroSlotId authority)
  const _slotOrder = semContract ? [...activeSlots] : null;
  // ★ P1-3 (probe): authority hash ต้องผูก ref identity — canonical object เดียวกับที่ S7 ใช้เทียบ
  //   (precedence ตรง S7 resolvedRefId: refMatch.refId → refMatch.dnaHash → null) — เปลี่ยน refId อย่างเดียว = stale
  const _semAuthorityHash = semContract
    ? _dnaHashFor({ refId: job.dossier.refMatch?.refId || job.dossier.refMatch?.dnaHash || null, contract: semContract })
    : null;
  // ★ SEM-1 fix (ผู้ตรวจ P1): ป้าย legacy ให้ composer — ห้ามใช้ contract.legacySlot (ตำแหน่งล้วน สลับบทได้
  //   เช่น วงกลมได้ป้าย 'reaction' หรือ rect ได้ 'hero') → คำนวณเชิงความหมาย + unique ต่อป้าย:
  //   canonical hero→'hero' · วงแรก→'circle' · refRole ตรงชื่อถ้ายังว่าง · ที่เหลือไล่ช่องว่าง reaction/action/context
  //   ป้ายหมด = null (composer เห็นเป็นสำรอง — ปลอดภัยกว่าป้ายผิดบท)
  const _projMap = (() => {
    if (!semContract) return null;
    const usedL = new Set();
    const m = new Map();
    for (const s of semContract.slots) {
      let lbl = null;
      if (s.id === _canonHeroId) lbl = 'hero';
      else if (s.shape === 'circle') lbl = usedL.has('circle') ? null : 'circle';
      else if (SLOT_ORDER.includes(s.refRole) && s.refRole !== 'hero' && s.refRole !== 'circle' && !usedL.has(s.refRole)) lbl = s.refRole;
      else lbl = ['reaction', 'action', 'context'].find((r) => !usedL.has(r)) || null;
      if (lbl) usedL.add(lbl);
      m.set(s.id, lbl);
    }
    return m;
  })();

  let brain = { slots: {}, note: '' };
  let brainOk = true;
  try {
    brain = await _brainFn({ imagesMeta: meta, compass: job.dossier.compass, deskTitle: job.dossier.desk?.title, refDNA: _refDNA, artBrief: job.dossier.artBrief || null, sceneInventory, ...(semContract ? { slotContract: semContract.slots } : {}) }); // เฟส 3.1: สมองเห็นแผนที่ฉาก · SEM-1: ส่งสัญญาช่องเมื่อ semantic ON เท่านั้น (OFF = args เดิมเป๊ะ)
  } catch (err) {
    brainOk = false; // สมองล่ม → fallback ล้วน (กฎเดียวกับทางหลัก)
  }
  // ★ SEM-1 (ผู้ตรวจ note): schema สั่ง key เป็น instance id แต่ LLM อาจเผลอตอบศัพท์ legacy — ถ้า miss ยกแผง
  //   ทุกช่องจะเงียบเข้า fallback โดยไม่มีใครรู้ → log เตือนชัด (ON เท่านั้น ไม่แตะ OFF)
  if (semContract && brainOk && brain?.slots && Object.keys(brain.slots).length) {
    const hit = activeSlots.filter((s) => brain.slots?.[s]?.id != null).length;
    if (!hit) console.log(`[MEGA S6] 🧬⚠️ สมองตอบ key ไม่ตรง instance ids เลย (ได้: ${Object.keys(brain.slots).slice(0, 6).join(',')}) — ทุกช่องจะเข้า fallback`);
  }
  // ★ Wave3 Phase1: snapshot ผลสมอง "ดิบ" ก่อนด่านโค้ด/fallback/story rescue — diagnostics เท่านั้น
  const rawLlmSlotIds = SOLVER_DIAGNOSTICS_V2_ON
    ? Object.fromEntries(activeSlots.map((name) => [name, brain.slots?.[name]?.id != null ? String(brain.slots[name].id) : null]))
    : null;

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
  // ★ SEM-1 (design v2 ช่องโหว่ 2 — แยก layout role ออกจาก identity policy): identity ต่อช่องตามสัญญา ref
  //   ช่องที่ ref ระบุ "คน" (wantPerson จากใบสั่งบก.ศิลป์) → คนนั้นคือ authority ของช่องนั้นเอง
  //   canonical hero ไม่มี intent → ใช้ heroNames legacy เดิม · ช่องอื่นไม่มี intent → ไม่มี identity kill
  //   ผล: hero_2/บทซ้ำไม่โดน first-hero lock เหมารวมอีก · legacy (semContract=null) = สูตรเดิม 100%
  const _identityOk = (slot, img) => {
    if (!semContract) return isHeroChar(img);
    const want = String(semById.get(slot)?.wantPerson || '').trim();
    if (want) {
      const ps = [img.triage?.person, ...(img.triage?.persons || [])].filter(Boolean);
      return ps.some((p) => namesMatch(p, want));
    }
    return _isHeroSlot(slot) ? isHeroChar(img) : true;
  };
  const _idGated = (slot) => (semContract
    ? (_isHeroSlot(slot) || !!String(semById.get(slot)?.wantPerson || '').trim())
    : slot === 'hero');
  // ★ SEM-1 correction (Codex P0-2): ช่องที่ ref ระบุคนชัด — intent ของ ref ชนะกฎ global ทุกตัว (เช่น "วงกลมคนละคนกับ hero")
  const _slotHasIntent = (slot) => !!(semContract && String(semById.get(slot)?.wantPerson || '').trim());
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
    if (img && _idGated(slot) && !_identityOk(slot, img)) { img = null; reason = ''; } // ★ 10 ก.ค.: hero ต้องถูกคน · SEM-1: ช่องที่ ref ระบุคนก็ยึด intent ของช่องตัวเอง
    // ★ เฟส 3.1: ฉากซ้ำกับช่องที่เลือกไปแล้ว (note เดียวกัน เช่น เฟรมคลิปชุดเดียว/เวทีเดิมหลายรูป) = ตัด
    //   ให้ fallback หาฉากใหม่ — ยกเว้น hero (กฎถูกคนสำคัญกว่า) · แก้ตรงอาการ "ฉากเวทีมอบทุนโผล่ซ้ำ 3 ช่อง"
    if (img && !_isHeroSlot(slot)) {
      const sk = sceneKeyOf(img);
      if (sk && chosenScenes.has(sk)) { img = null; reason = ''; sceneDupBlocked++; }
    }
    // 👤 8 ก.ค. (AC-0027 hero=ภาพกอดแม่ 2 หน้า): brain ฝ่ากฎ "hero หน้าเดี่ยว" ได้ — ด่านโค้ดบังคับ:
    //   hero หลายหน้า + พูลมี "หน้าเดี่ยวถูกคน สะอาด" → สลับเป็นหน้าเดี่ยว (ภาพกอด/คู่ไปช่อง reaction แทนได้)
    // SEM-1: บังคับหน้าเดี่ยวเฉพาะ canonical hero — hero_2/บทซ้ำไม่โดนเหมารวม (design v2 ช่องโหว่ 2)
    if (img && _isHeroSlot(slot) && (img.triage?.faceCount ?? 0) > 1) {
      const solo = sorted.find((x) => !used.has(String(x.id)) && _identityOk(slot, x) && (x.triage?.faceCount ?? 0) === 1 && isClean(x));
      if (solo) { console.log(`[MEGA S6] 👤 hero ${img.id} มี ${img.triage.faceCount} หน้า → สลับหน้าเดี่ยว ${solo.id}`); img = solo; reason = 'hero หน้าเดี่ยว (โค้ดบังคับ — brain เลือกภาพหลายหน้า)'; }
    }
    // ★ 9 ก.ค. เฟส 2.2 (S6_REAL_SIZE_GATE): hero ที่ brain เลือกมาเป็นไฟล์เล็ก/thumbnail-only จริง → สลับเป็นใบที่
    //   เห็นขนาดจริงพอ (realShortSide≥700) ถ้ามีตัวเลือก — กัน "ไฟล์จิ๋วที่ตาคัดให้คะแนนหลอก" หลุดไปยืดแตกตอนประกอบ
    if (img && _isHeroSlot(slot) && !heroSizeOk(img)) {
      const bigger = sorted.find((x) => !used.has(String(x.id)) && _identityOk(slot, x) && (x.triage?.faceCount ?? 0) >= 1 && heroSizeOk(x) && isClean(x))
        || sorted.find((x) => !used.has(String(x.id)) && _identityOk(slot, x) && (x.triage?.faceCount ?? 0) >= 1 && heroSizeOk(x));
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
      const cands = (STORY_SEL_ON && STORY_SLOTS.has(_legacyKeyOf(slot))) ? cands0.slice().sort(storyRank) : cands0;
      const hint = SLOT_CATEGORY_HINT[_legacyKeyOf(slot)] || [];
      // ★ 9 ก.ค. เฟส 2.2: hero fallback ลองแบบมีเกณฑ์ขนาดจริงก่อน (heroSizeOk) — ไม่เจอเลยค่อยถอยเกณฑ์เดิม (ไม่กรองขนาด)
      const findHeroSized = (arr) => {
        const heroBase = (x) => _identityOk(slot, x) && (x.triage?.faceCount ?? 0) >= 1;
        const noBanner = (x) => !(Number(x.width) > 0 && Number(x.height) > 0 && x.width / x.height > 1.5);
        const hit = arr.find((x) => heroBase(x) && heroSizeOk(x) && noBanner(x)) || arr.find((x) => heroBase(x) && heroSizeOk(x));
        if (!hit && arr.some(heroBase)) console.log('[MEGA S6] 📏 เฟส 2.2: ไม่มี hero candidate ผ่านเกณฑ์ขนาดจริง (realShortSide≥700/ไม่ thumbnail-only) — ถอยเกณฑ์เดิม');
        return hit || null;
      };
      const pickFrom = (arr) =>
        // ★ 9 ก.ค. เฟส 2.2: ลองตัวเลือกขนาดจริงพอก่อนเสมอ (hero เท่านั้น — SEM-1: canonical hero)
        (_isHeroSlot(slot) ? findHeroSized(arr) : null) ||
        // ★ 10 ก.ค.: hero เลี่ยงภาพแนวนอนกว้าง (แบนเนอร์) ก่อน — ไม่มีตัวเลือกอื่นค่อยยอม (บรรทัดถัดไป)
        (_isHeroSlot(slot) ? arr.find((x) => _identityOk(slot, x) && (x.triage?.faceCount ?? 0) >= 1 && !(Number(x.width) > 0 && Number(x.height) > 0 && x.width / x.height > 1.5)) : null) ||
        (_isHeroSlot(slot) ? arr.find((x) => _identityOk(slot, x) && (x.triage?.faceCount ?? 0) >= 1) : null) ||
        arr.find((x) => hint.includes(x.triage?.category)) ||
        (_legacyKeyOf(slot) === 'reaction' ? arr.find((x) => (x.triage?.faceCount ?? 0) >= 1) : null) ||
        arr[0] ||
        null;
      // B (reject ลายน้ำ): ช่องทั่วไปหยิบภาพสะอาดก่อน ไม่มีค่อยยอมลายน้ำ · hero ยึด "ถูกคน 100%" เหนือทุกข้อ
      // ★ เฟส 3.1: ชั้นแรกหยิบ "ฉากที่ยังไม่ใช้" ก่อน (สะอาด+ฉากใหม่ → สะอาด → ฉากใหม่ → อะไรก็ได้)
      const freshScene = (x) => { const k = sceneKeyOf(x); return !k || !chosenScenes.has(k); };
      // ★ SEM-1: ช่องรองที่ ref ระบุ "คน" — fallback ต้องหาเฉพาะคนนั้น (identity เป็น authority ของช่อง)
      //   legacy: _idGated เป็นจริงเฉพาะ hero ซึ่งไม่เข้า branch นี้ → candsG === cands = พฤติกรรมเดิมเป๊ะ
      const candsG = (!_isHeroSlot(slot) && _idGated(slot)) ? cands.filter((x) => _identityOk(slot, x)) : cands;
      img = _isHeroSlot(slot)
        ? pickFrom(cands)
        : (pickFrom(candsG.filter((x) => x.triage?.clean !== false && freshScene(x)))
          || pickFrom(candsG.filter((x) => x.triage?.clean !== false))
          || pickFrom(candsG.filter(freshScene))
          || pickFrom(candsG));
      if (img && _idGated(slot) && !_identityOk(slot, img)) img = null; // ไม่มีคนตามสัญญาช่องจริง → ปล่อยว่าง ห้ามฝืนผิดคน
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
        // ★ SEM-1 (additive เฉพาะ ON): ตัวตน instance + บท legacy (projection เชิงความหมาย) สำหรับ composer ที่ S7
        ...(semContract ? { refSlotId: slot, legacySlot: _projMap.get(slot) ?? null } : {}),
        reason,
        ...(STORY_SEL_ON ? { storyFit: storyFitOf(img) } : {}), // ★ เฟส 6A: คะแนนเล่าเรื่องของภาพที่ลงช่องนี้ (ตรวจได้ใน slotPlan)
        // ★ 8 ก.ค. (CASE-360): backups เรียงสะอาดก่อน — v3 QC สลับภาพเสียแล้วต้องมี "ของสะอาด" ให้หยิบ
        backups: (want?.backups || [])
          // ★ SEM-1 correction (Codex P0-3, scope เฉพาะ semantic): ช่องที่มี identity intent — backup ต้องถูกคนด้วย
          //   (กัน composer/strict หยิบผิดคนทีหลัง) · legacy ห้ามกรอง — HEAD เดิมเก็บ backup คนละคนไว้ให้กฎ diffP ใช้
          //   (เทส P2-B จับ parity break ตัวนี้ได้จริงตอนกรองรวม legacy)
          .filter((b) => byId.has(String(b)) && !used.has(String(b)) && (!semContract || !_idGated(slot) || _identityOk(slot, byId.get(String(b)))))
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
      const heroPerson0 = _lc(slots[_canonHeroId]?.person || '');
      for (const slot of activeSlots) {
        if (_isHeroSlot(slot) || !STORY_RESCUE_SLOTS.has(_legacyKeyOf(slot))) continue;
        const cur = slots[slot];
        const curRec = cur ? byId.get(String(cur.id)) : null;
        const curStory = curRec ? (storyFitOf(curRec) ?? 0) : 0;
        if (curStory >= STORY_HIGH) continue; // ช่องนี้เล่าเรื่องดีอยู่แล้ว — ไม่ต้องกู้
        const curQ = curRec ? (curRec.triage?.quality ?? 0) : 0;
        const curScene = curRec ? sceneKeyOf(curRec) : '';
        const best = sorted
          .filter((x) => !used.has(String(x.id)) && isClean(x))
          // ★ SEM-1 correction (Codex P0-1): rescue ห้ามสลับ primary เป็นผิดคนหลังด่าน — identity ของช่องคุมเสมอ
          .filter((x) => !_idGated(slot) || _identityOk(slot, x))
          // circle = ต้องเป็นคนหลักจริง (ภาพวงกลม=บุคคล) · context รับภาพสถานที่/ทริปที่มาจากคำค้นเรื่องราวได้ (landmark ไม่มีคนในภาพ)
          .filter((x) => isMainChar(x) || (_legacyKeyOf(slot) === 'context' && storySet.has(_lc(x.query))))
          .filter((x) => (storyFitOf(x) ?? 0) >= STORY_MIN_TO_WIN && (storyFitOf(x) ?? 0) >= curStory + STORY_SWAP_MARGIN)
          .filter((x) => (x.triage?.quality ?? 0) >= curQ - STORY_Q_TOL)
          .filter((x) => { const sk = sceneKeyOf(x); return !sk || sk === curScene || !chosenScenes.has(sk); })
          // ★ SEM-1 correction (Codex P0-2): ช่องที่ ref ระบุคนชัด → intent ชนะกฎ "คนละคนกับ hero" (identity filter ด้านบนคุมแล้ว)
          .filter((x) => _slotHasIntent(slot) ? true : (!_isCircleSlot(slot) || !heroPerson0 || _lc(x.triage?.person || '') !== heroPerson0))
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
          // ★ SEM-1 fix (ผู้ตรวจ P1): entry ที่ถูกกู้ต้องพก field instance เหมือนลูปแรก — ไม่งั้น S7 ป้าย slot=null
          ...(semContract ? { refSlotId: slot, legacySlot: _projMap.get(slot) ?? null } : {}),
          reason: `story-fit rescue เฟส 6A (${curStory}→${storyFitOf(best)}) — ภาพเล่าแก่นข่าวชนะหน้าชัดเฉยๆ`,
          storyFit: storyFitOf(best),
          // ★ SEM-1 correction (Codex P0-3, scope เฉพาะ semantic): backups หลัง rescue ต้องผ่าน identity ของช่อง
          //   legacy = สูตรเดิมเป๊ะ (ไม่กรอง — byte-parity)
          backups: oldBackups.filter((b) => byId.has(b) && (!semContract || !_idGated(slot) || _identityOk(slot, byId.get(b)))).slice(0, 3),
        };
        console.log(`[MEGA S6] 📖 เฟส 6A สลับช่อง ${slot}: ${cur?.id ?? '(ว่าง)'}(story ${curStory}) → ${best.id}(story ${storyFitOf(best)}, ${best.triage?.person || '-'})`);
      }
    } catch (e) { console.log('[MEGA S6] เฟส 6A story rescue ข้าม:', e.message?.slice(0, 50)); }
  }

  // ★ เฟส 3.2 (คู่กับกติกา composer เฟส 2.3 "วงกลมคนละคนกับ hero"): การันตีว่าแผน (หลัก+สำรอง)
  //   มีภาพ "คนอื่นที่ไม่ใช่ hero" ≥1 ใบเสมอเมื่อพูลมีจริง — ไม่งั้นกติกาฝั่งโรงประกอบไม่มีของให้หยิบ
  //   (หลักฐานรันจริง: log "⭕⚠️ แผนไม่มีภาพคนอื่น" ทั้งที่พูล AC-0045 มีภาพต๊อดเดี่ยว 50 ใบ)
  // ★ SEM-1 correction (Codex P0-4): กฎ global "ดันคนอื่นเข้าแผน" ห้าม override สัญญา ref — semantic mode ข้ามทั้งบล็อก
  //   (ref ระบุคน/บทเองครบแล้ว intent ชนะเสมอ · legacy = พฤติกรรมเดิม 100%)
  try {
    const heroPersonS6 = String(slots.hero?.person || '');
    if (!semContract && heroPersonS6) {
      const inPlanIds = new Set(activeSlots.flatMap((s) => slots[s] ? [String(slots[s].id), ...(slots[s].backups || []).map(String)] : []));
      const hasOther = [...inPlanIds].some((id) => { const p = String(byId.get(id)?.triage?.person || ''); return p && p !== heroPersonS6; });
      if (!hasOther) {
        const wantOther = (x) => { const p = String(x.triage?.person || ''); return p && p !== heroPersonS6 && !inPlanIds.has(String(x.id)) && (x.triage?.faceCount ?? 0) >= 1; };
        // เรียงความอยาก: หน้าเดี่ยวหมวด face-* สะอาด (วงกลมซูมหน้าชัด) → หน้าเดี่ยวสะอาด → มีหน้า+สะอาด → มีหน้า
        const cand = sorted.find((x) => wantOther(x) && isClean(x) && (x.triage?.faceCount ?? 0) === 1 && /^face-/.test(String(x.triage?.category || '')))
          || sorted.find((x) => wantOther(x) && isClean(x) && (x.triage?.faceCount ?? 0) === 1)
          || sorted.find((x) => wantOther(x) && isClean(x))
          || sorted.find(wantOther);
        const targetSlot = slots.circle ? 'circle' : activeSlots.find((s) => slots[s]); // บล็อกนี้วิ่งเฉพาะ legacy (ดูเงื่อนไขบน)
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

  // ★ Wave3 ชุด1 (10 ก.ค.) — SHADOW MODE: solver deterministic คำนวณคู่ขนานหลังลูปจับคู่จบ (slots ครบ/พยายามครบ)
  //   → log เทียบผล LLM/fallback + เก็บ dossier พิสูจน์บนเคสจริง ก่อนสลับให้ solver ตัดสินจริงชุดถัดไป.
  //   shadow-first: **ห้ามเปลี่ยนผลปกจริงแม้แต่ byte** — ครอบ try/catch ทั้งก้อน (solver ล้ม = log อย่างเดียว
  //   งานเดินต่อปกติ 100%) · ไม่ยิง LLM/IO เพิ่ม (ประกอบ input จากข้อมูลที่คำนวณแล้วในฟังก์ชันล้วน) ·
  //   ปิดสนิท (พฤติกรรม byte-เดิม): MEGA_SOLVER_SHADOW=0
  let solverShadow = null;
  let solverShadowV2 = null;
  if (process.env.MEGA_SOLVER_SHADOW !== '0') {
    try {
      const { solveSlotAssignments } = await import('@/lib/slotSolver');
      // ★ Wave3 ชุด2 (10 ก.ค.): getSourceScore ต่อผ่าน dynamic-import แบบ defensive (ตาม pattern เดิมของไฟล์นี้
      //   ดูบรรทัดบน) — `export` ที่ multiAgentImageScraper.js เพิ่มแล้วในชุดเดียวกัน (เดิมเป็น module-private)
      //   ถ้าโมดูล/ฟังก์ชันหายในอนาคต = fail-open ได้ null (solver ตีเป็นกลาง 0.5) ไม่ล้มทั้ง shadow
      let _getSourceScore = null;
      try {
        const _scraperMod = await import('@/lib/services/multiAgentImageScraper');
        if (typeof _scraperMod?.getSourceScore === 'function') _getSourceScore = _scraperMod.getSourceScore;
      } catch { /* โมดูลโหลดไม่ได้ = ปล่อย null (เหมือนไม่มีค่า) */ }
      // characters จากเข็มทิศ + ธง isHero (heroNames = role=hero หรือตัวแรก — ตัวเดียวกับด่าน hero ด้านบน)
      const solverChars = (job.dossier.compass?.mainCharacters || [])
        .map((c) => c?.name).filter(Boolean)
        .map((name) => ({ name, isHero: heroNames.includes(name) }));
      // wantPerson/refShot ต่อช่องจากใบสั่งงานสมอง (artBrief.orders — จับคู่ตาม role ของช่อง ถ้ามี)
      const orders = job.dossier.artBrief?.orders || [];
      const _normShot = (s) => {
        const t = String(s || '').toLowerCase();
        if (/close|โคลส|ใบหน้า|หน้าเต็ม/.test(t)) return 'closeup';
        if (/bust|อก|ครึ่งตัว|half/.test(t)) return 'bust';
        if (/medium|กลาง|เอว|knee/.test(t)) return 'medium';
        if (/wide|กว้าง|เต็มตัว|full|long/.test(t)) return 'wide';
        return null;
      };
      const _slotRole = (name) => (name === 'hero' ? 'hero' : name === 'circle' ? 'circle' : name === 'context' ? 'context' : 'secondary');
      const solverSlots = activeSlots.map((name) => {
        const ord = orders.find((o) => String(o.role) === name) || null;
        return { id: name, role: _slotRole(name), wantPerson: ord?.personHint || null, refShot: _normShot(ord?.shot) };
      });
      // faceBoxHFrac แบบ defensive: Gemini คืน {x,y,w,h} normalized 0-1 (h=สัดส่วนสูงหน้า) —
      //   รับ {x1,y1,x2,y2} เผื่อ path อื่น · ค่า px (>1)/รูปแปลก = null (normalize เชื่อถือไม่ได้)
      const _faceHFrac = (fb) => {
        if (!fb || typeof fb !== 'object') return null;
        const h = Number(fb.h);
        if (Number.isFinite(h) && h > 0 && h <= 1.0001) return Math.min(1, h);
        const y1 = Number(fb.y1), y2 = Number(fb.y2);
        if (Number.isFinite(y1) && Number.isFinite(y2) && y2 > y1 && y2 <= 1.0001) return Math.min(1, y2 - y1);
        return null;
      };
      const solverImages = sorted.map((x) => {
        const persons = [x.triage?.person, ...(x.triage?.persons || [])].filter(Boolean);
        const identityHits = {};
        for (const c of solverChars) identityHits[c.name] = persons.some((p) => _namesMatchSimple(p, c.name));
        return {
          id: x.id,
          persons,
          identityHits, // ★ solver ไม่ match ชื่อเอง — คำนวณให้ที่นี่ด้วย _namesMatchSimple (module-level)
          storyFit: storyFitOf(x), // null เมื่อปิด STORY_SEL → event แกนกลาง 0.5
          newsScene: x.triage?.newsScene !== false,
          category: x.triage?.category || 'other',
          emotion: x.triage?.emotion || null,
          ...(SOLVER_DIAGNOSTICS_V2_ON ? {
            note: String(x.triage?.note || '').replace(/\s+/g, ' ').trim().slice(0, 64) || null,
            orientation: (Number(x.width) > 0 && Number(x.height) > 0)
              ? (x.width / x.height > 1.15 ? 'wide' : (x.width / x.height < 0.87 ? 'tall' : 'sq'))
              : null,
          } : {}),
          quality: x.triage?.quality ?? null,
          faces: Number(x.triage?.faceCount) || 0,
          clean: isClean(x),
          shortSide: realShortSideOf(x),
          sharpness: (typeof x.triage?.sharpness === 'number') ? x.triage.sharpness : null,
          thumbOnly: x.rehostQuality === 'thumbnail',
          lowRes: x.lowRes === true,
          sceneKey: sceneKeyOf(x) || null,
          faceBoxHFrac: _faceHFrac(x.triage?.faceBox),
          // ★ Wave3 ชุด2: sourceScore จริง — ใช้ "หน้าเพจต้นทาง" (sourceLink/source) ไม่ใช่ imageUrl (CDN/rehost)
          //   เพราะ getSourceScore เทียบโดเมน — CDN ทั่วไป (เช่น encrypted-tbn0.gstatic.com หรือ rehost ของเรา)
          //   ไม่บอกความน่าเชื่อถือจริง (คอมเมนต์ต้นทางเตือนไว้ตรงนี้เอง ที่ multiAgentImageScraper.js บรรทัด ~1220)
          //   scale ที่พบจริง: 0-10 (ตาราง SOURCE_RELIABILITY, ดีฟอลต์ไม่รู้จักโดเมน=4) → normalize หาร 10 ก่อนส่งเข้า solver (0-1)
          //   ไม่มี field แหล่ง/เรียกฟังก์ชันไม่ได้/ค่าไม่ใช่ตัวเลข = null (solver ตีเป็นกลาง 0.5 เอง — fail-open)
          sourceScore: (() => {
            const srcArg = x.sourceLink || x.source || null;
            if (!_getSourceScore || !srcArg) return null;
            try {
              const raw = Number(_getSourceScore(srcArg));
              return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / 10)) : null; // 0-10 → 0-1 (inline clamp, ไม่เพิ่ม helper ใหม่ระดับโมดูล)
            } catch { return null; }
          })(),
          // ★ Wave3 ชุด2: pHash64 จากตาคัด (libraryTriage.js) — null ถ้าวัดไม่ได้/ภาพเก่าก่อนมีฟีเจอร์นี้
          pHash64: x.triage?.pHash64 || null,
        };
      });
      const postGateSlotIds = SOLVER_DIAGNOSTICS_V2_ON
        ? Object.fromEntries(activeSlots.map((name) => [name, slots[name]?.id != null ? String(slots[name].id) : null]))
        : null;
      let solved;
      if (SOLVER_DIAGNOSTICS_V2_ON) {
        try {
          solved = solveSlotAssignments({
            slots: solverSlots,
            images: solverImages,
            characters: solverChars,
            diagnostics: {
              v: 2,
              topK: 5,
              compareBySlot: { rawLlm: rawLlmSlotIds, postGateLlm: postGateSlotIds },
            },
          });
        } catch (diagErr) {
          // Diagnostics ใหม่ล้มต้องไม่ทำ shadow v1/งานจริงหาย — ถอย Solver call เดิมทันที
          console.log('[MEGA S6] 🔬 solver-diagnostics-v2 ล้ม → fallback v1:', diagErr?.message?.slice(0, 60));
          solved = solveSlotAssignments({ slots: solverSlots, images: solverImages, characters: solverChars });
        }
      } else {
        solved = solveSlotAssignments({ slots: solverSlots, images: solverImages, characters: solverChars });
      }
      const bySlotSolver = new Map(solved.assignments.map((a) => [a.slotId, a]));
      let agree = 0;
      const diffs = [];
      const perSlot = [];
      for (const name of activeSlots) {
        const llm = slots[name] ? String(slots[name].id) : null;
        const a = bySlotSolver.get(name) || null;
        const solver = a && a.imageId != null ? String(a.imageId) : null;
        const match = llm === solver;
        if (match) agree++; else diffs.push(`${name}(LLM=${llm ?? '(ว่าง)'} vs SOLVER=${solver ?? '(ว่าง)'})`);
        perSlot.push({ slot: name, llm, solver, match, top3: (a?.top3 || []).map((t) => t.id) });
      }
      console.log(`[MEGA S6] 👥 solver-shadow: ตรง ${agree}/${activeSlots.length} ช่อง${diffs.length ? ' — ต่าง: ' + diffs.join(' ') : ''}`);
      solverShadow = { v: 1, agree, total: activeSlots.length, perSlot };
      if (SOLVER_DIAGNOSTICS_V2_ON && solved.diagnostics?.v === 2) {
        const solverIds = solverImages.map((x) => String(x.id));
        const llmIds = solverDiagLlmVisibleIds || [];
        const llmSet = new Set(llmIds);
        const commonCount = solverIds.filter((id) => llmSet.has(id)).length;
        const identicalUniverse = llmIds.length === solverIds.length && llmIds.every((id, i) => id === solverIds[i]);
        const _coverage = (test) => {
          const count = solverImages.filter(test).length;
          return { count, pct: solverImages.length ? Math.round((count / solverImages.length) * 1000) / 10 : 0 };
        };
        solverShadowV2 = {
          v: 2,
          inputHash: _dnaHashFor({ slots: solverSlots, images: solverImages, characters: solverChars }),
          candidateUniverse: {
            llmCount: llmIds.length,
            solverCount: solverIds.length,
            commonCount,
            identical: identicalUniverse,
            llmHash: _dnaHashFor(llmIds),
            solverHash: _dnaHashFor(solverIds),
            llmMetaBudgetMirror: 18000,
          },
          coverage: {
            total: solverImages.length,
            persons: _coverage((x) => Array.isArray(x.persons) && x.persons.length > 0),
            storyFit: _coverage((x) => x.storyFit != null),
            note: _coverage((x) => !!x.note),
            orientation: _coverage((x) => !!x.orientation),
            shortSide: _coverage((x) => x.shortSide != null),
            sharpness: _coverage((x) => x.sharpness != null),
            faceBoxHFrac: _coverage((x) => x.faceBoxHFrac != null),
            sourceScore: _coverage((x) => x.sourceScore != null),
            pHash64: _coverage((x) => !!x.pHash64),
          },
          rawLlm: { slots: rawLlmSlotIds },
          postGateLlm: { slots: postGateSlotIds },
          solver: {
            slots: Object.fromEntries(solved.assignments.map((a) => [a.slotId, a.imageId != null ? String(a.imageId) : null])),
            diagnostics: solved.diagnostics,
          },
        };
        // Pre-activation audit only. Re-run diagnostics with semantic ref roles and/or the exact
        // LLM-visible universe, while preserving `solved` above as the legacy v1 shadow result.
        if (REF_ROLE_CONTRACT_SHADOW_ON || SOLVER_FAIR_UNIVERSE_ON) {
          try {
            const contractApi = await import('@/lib/refSlotContract');
            let diagnosticContract = null;
            let diagnosticSlots = solverSlots;
            let diagnosticRawLlm = rawLlmSlotIds;
            let diagnosticPostGate = postGateSlotIds;
            let diagnosticMode = 'legacy';

            if (REF_ROLE_CONTRACT_SHADOW_ON && _refDNA) {
              diagnosticContract = contractApi.buildRefSlotContract({
                refDNA: _refDNA,
                artBriefOrders: orders,
                legacySlots: activeSlots,
              });
              if (diagnosticContract.slots.length) {
                diagnosticSlots = diagnosticContract.slots.map((slot) => ({
                  id: slot.id,
                  role: slot.solverRole,
                  wantPerson: slot.wantPerson,
                  refShot: _normShot(slot.refShot),
                }));
                diagnosticRawLlm = contractApi.projectLegacySelections(rawLlmSlotIds, diagnosticContract);
                diagnosticPostGate = contractApi.projectLegacySelections(postGateSlotIds, diagnosticContract);
                diagnosticMode = 'ref_contract';
              }
            }

            const diagnosticImages = SOLVER_FAIR_UNIVERSE_ON
              ? contractApi.restrictCandidateUniverse(solverImages, solverDiagLlmVisibleIds || [])
              : solverImages;
            const diagnosticSolved = solveSlotAssignments({
              slots: diagnosticSlots,
              images: diagnosticImages,
              characters: solverChars,
              diagnostics: {
                v: 2,
                topK: 5,
                compareBySlot: { rawLlm: diagnosticRawLlm, postGateLlm: diagnosticPostGate },
              },
            });
            const fairSolverIds = diagnosticImages.map((x) => String(x.id));
            const fairLlmIds = solverDiagLlmVisibleIds || [];
            const fairLlmSet = new Set(fairLlmIds);
            const fairCommonCount = fairSolverIds.filter((id) => fairLlmSet.has(id)).length;
            const fairIdentical = fairLlmIds.length === fairSolverIds.length
              && fairLlmIds.every((id, i) => id === fairSolverIds[i]);
            const fairCoverage = (test) => {
              const count = diagnosticImages.filter(test).length;
              return { count, pct: diagnosticImages.length ? Math.round((count / diagnosticImages.length) * 1000) / 10 : 0 };
            };
            const contractSummary = diagnosticContract ? {
              v: diagnosticContract.v,
              source: diagnosticContract.source,
              hash: _dnaHashFor(diagnosticContract),
              mismatchCount: diagnosticContract.mismatches.length,
              mismatches: diagnosticContract.mismatches,
              slots: diagnosticContract.slots.map((slot) => ({
                id: slot.id,
                refRole: slot.refRole,
                solverRole: slot.solverRole,
                legacySlot: slot.legacySlot,
                shape: slot.shape,
                sourceIndex: slot.sourceIndex,
                wantPerson: slot.wantPerson,
                refShot: slot.refShot,
              })),
            } : null;
            solverShadowV2 = {
              v: 2,
              mode: diagnosticMode,
              inputHash: _dnaHashFor({ slots: diagnosticSlots, images: diagnosticImages, characters: solverChars }),
              candidateUniverse: {
                llmCount: fairLlmIds.length,
                solverCount: fairSolverIds.length,
                commonCount: fairCommonCount,
                identical: fairIdentical,
                llmHash: _dnaHashFor(fairLlmIds),
                solverHash: _dnaHashFor(fairSolverIds),
                llmMetaBudgetMirror: 18000,
                fairLimited: SOLVER_FAIR_UNIVERSE_ON,
              },
              coverage: {
                total: diagnosticImages.length,
                persons: fairCoverage((x) => Array.isArray(x.persons) && x.persons.length > 0),
                storyFit: fairCoverage((x) => x.storyFit != null),
                note: fairCoverage((x) => !!x.note),
                orientation: fairCoverage((x) => !!x.orientation),
                shortSide: fairCoverage((x) => x.shortSide != null),
                sharpness: fairCoverage((x) => x.sharpness != null),
                faceBoxHFrac: fairCoverage((x) => x.faceBoxHFrac != null),
                sourceScore: fairCoverage((x) => x.sourceScore != null),
                pHash64: fairCoverage((x) => !!x.pHash64),
              },
              ...(contractSummary ? { refSlotContract: contractSummary } : {}),
              rawLlm: { slots: diagnosticRawLlm },
              postGateLlm: { slots: diagnosticPostGate },
              legacySolver: {
                slots: Object.fromEntries(solved.assignments.map((a) => [a.slotId, a.imageId != null ? String(a.imageId) : null])),
              },
              solver: {
                slots: Object.fromEntries(diagnosticSolved.assignments.map((a) => [a.slotId, a.imageId != null ? String(a.imageId) : null])),
                diagnostics: diagnosticSolved.diagnostics,
              },
            };
          } catch (contractErr) {
            console.log('[MEGA S6] ref-role/fair-universe diagnostics failed; keeping legacy v2:', contractErr?.message?.slice(0, 80));
          }
        }
        console.log(`[MEGA S6] 🔬 solver-diagnostics-v2: universe LLM ${solverShadowV2.candidateUniverse.llmCount}/solver ${solverShadowV2.candidateUniverse.solverCount} · common ${solverShadowV2.candidateUniverse.commonCount} · same=${solverShadowV2.candidateUniverse.identical} · mode=${solverShadowV2.mode || 'legacy'} · input=${solverShadowV2.inputHash}`);
      }
    } catch (e) {
      console.log('[MEGA S6] 👥 solver-shadow ข้าม (ล้ม แต่งานเดินต่อ):', e?.message?.slice(0, 60));
    }
  }

  const filled = activeSlots.filter((s) => slots[s]).length;
  // ★ Wave2 Batch D1: สรุปกักกันครั้งเดียว — ต่อท้าย summary เสมอ (เห็นความจริงไม่ว่าสวิตช์เปิด/ปิด)
  //   ส่วน dossierPatch.images.quarantine ผูกกับสวิตช์ MEGA_QUARANTINE (เปลี่ยน schema ของแฟ้ม จึงต้องปิดกลับได้)
  const quarantineTotal = untriagedList.length + sizeUnknownList.length;
  const quarantineTag = quarantineTotal > 0 ? ` · 🧿กัก ${untriagedList.length}+${sizeUnknownList.length} ใบ(ข้อมูลไม่ครบ)` : '';
  if (!slots[_canonHeroId]) {
    return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพตัวเอกที่ถูกคนเลย — ห้ามฝืนทำปกผิดคน', quality: 'red', dossierPatch: { pickImages: { slots, note: brain.note || '', ...(semContract ? { semanticSelection: true, slotOrder: _slotOrder, heroSlotId: _canonHeroId, slotContractHash: _semAuthorityHash } : {}), ...(solverShadow ? { solverShadow } : {}), ...(solverShadowV2 ? { solverShadowV2 } : {}) } } };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `จับคู่ ${filled}/${activeSlots.length} ช่อง${fallbackUsed ? ` (fallback ${fallbackUsed})` : ''}${brainOk ? '' : ' · สมองล่ม→กฎสำรองล้วน'}${storyTag}${quarantineTag} — ${(brain.note || '').slice(0, 80)}`,
    dossierPatch: {
      pickImages: { slots, note: brain.note || '', poolSize: pool.length, brainOk, fallbackUsed, ...(STORY_SEL_ON ? { storySelOn: true } : {}), ...(semContract ? { semanticSelection: true, slotOrder: _slotOrder, heroSlotId: _canonHeroId, slotContractHash: _semAuthorityHash } : {}), ...(solverShadow ? { solverShadow } : {}), ...(solverShadowV2 ? { solverShadowV2 } : {}) },
      ...(job.dossier.refMatch ? { refMatch: job.dossier.refMatch } : {}),
      ...(job.dossier.artBrief ? { artBrief: job.dossier.artBrief } : {}),
      // ★ Wave2 Batch D1: merge-patch additive — สเปรด im เดิมกันทับ field อื่นใน images (caseId/storyQueries/heroGradeReport ฯลฯ)
      ...(QUARANTINE_ON ? { images: { ...im, quarantine: { untriaged: untriagedList.length, sizeUnknown: sizeUnknownList.length, heroDemoted: heroDemotedFlag, sample: quarantineSampleIds } } } : {}),
    },
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
// ---------- 🔐 Checkpoint C (FINAL P1 TOCTOU): ตรวจ "wire snapshot" ของ strict payload ----------
// รับ wire = JSON.parse(payloadBody) — สิ่งที่จะขึ้นสายจริง byte-ต่อ-byte (stateful toJSON/getter ถูก
// ทำให้เป็นค่านิ่งไปแล้วตอน stringify ครั้งเดียว) · validator + geometry + binding ตรวจบนก้อนนี้เท่านั้น
// คืน null = ผ่าน · คืน result object = พัก/ปิดงานก่อน queue (reason คงที่) · pure — validator ฉีดจากผู้เรียก
function _strictWireGate(wire, validateStrictRenderActivation) {
  const decision = validateStrictRenderActivation({ selectionSpec: wire.selectionSpec, realizedTemplate: wire.realizedTemplate });
  if (decision.decision !== 'strict_ready') {
    const reasons = (decision.reasons && decision.reasons.length ? decision.reasons : [decision.decision]).join(',').slice(0, 140);
    return { status: 'waiting', nextAction: 'wait', summary: `🔐⏸️ strict producer: สัญญายังไม่พร้อม (${reasons}) — พักงาน ห้าม enqueue/ห้ามถอย legacy` };
  }
  // ① โครง — validator ไม่ตรวจตัวเลข geometry ฝั่ง producer ต้องตรวจเองบน wire:
  //   canvas exact 1080×1350 · slots ไม่ว่าง · x/y/w/h = number finite integer · w/h>0 · อยู่ในผืน · shape rect|circle
  const rt = wire.realizedTemplate;
  const _tErr = [];
  if (!(rt && rt.canvasW === 1080 && rt.canvasH === 1350)) _tErr.push('canvas');
  const _rSlots = Array.isArray(rt?.slots) ? rt.slots : [];
  if (!_rSlots.length) _tErr.push('slots_empty');
  for (let _i = 0; _i < _rSlots.length; _i++) {
    const _s = _rSlots[_i] || {};
    if (![_s.x, _s.y, _s.w, _s.h].every((v) => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v))) { _tErr.push(`geom:${_i}`); continue; }
    if (!(_s.w > 0 && _s.h > 0) || _s.x < 0 || _s.y < 0 || _s.x + _s.w > 1080 || _s.y + _s.h > 1350) _tErr.push(`bounds:${_i}`);
    if (_s.shape != null && _s.shape !== 'rect' && _s.shape !== 'circle') _tErr.push(`shape:${_i}`);
  }
  if (_tErr.length) {
    return { status: 'waiting', nextAction: 'wait', summary: `🔐⏸️ strict producer: strict_template_invalid (${_tErr.join(',').slice(0, 100)}) — พักงานก่อน queue` };
  }
  // ② binding — authority primary ทุกช่องต้องชี้ "wire slotPlan" (แผนที่ส่งจริง) แบบ URL exact หนึ่ง row + refSlotId ตรง
  const _bErr = [];
  const _wirePlan = Array.isArray(wire.slotPlan) ? wire.slotPlan : [];
  for (const _as of decision.authority.slots) {
    const _rows = _wirePlan.filter((row) => row.url === _as.primary.imageUrl);
    if (_rows.length !== 1) { _bErr.push(`rows:${_as.composerSlotId}=${_rows.length}`); continue; }
    if (_rows[0].refSlotId !== _as.refSlotId) _bErr.push(`ref:${_as.composerSlotId}`);
  }
  if (_bErr.length) {
    return { status: 'waiting', nextAction: 'wait', summary: `🔐⏸️ strict producer: strict_binding_invalid (${_bErr.join(',').slice(0, 100)}) — พักงานก่อน queue` };
  }
  return null;
}

export async function s7_cover(job, { origin, _deps } = {}) {
  // ★ SEM-1: dependency injection เพื่อ testability เท่านั้น — default = ของจริง (production เดิม 100%)
  const _jf = _deps?.fetchJson || jfetch;
  // ★ audit A1 (9 ก.ค.): tick ที่เกิดบนคลาวด์ (คนกดหน้า /mega ที่เสิร์ฟบน Vercel/Railway) ไม่มี localhost:3000
  //   ให้ยิง → เดิมส่งงานปกล้มแล้ว job ตายทั้งงาน — คืน waiting ให้ tick รอบถัดไปจากเครื่องทีมมาทำขั้นนี้เอง
  if (process.platform !== 'win32' && !process.env.MEGA_COVER_ORIGIN) {
    return { status: 'waiting', nextAction: 'wait', summary: 'ขั้นปกต้องส่งเข้าเครื่องทีม — รอ tick จากเครื่องทีม (คลาวด์ไม่มี MEGA_COVER_ORIGIN)' };
  }
  const d = job.dossier;
  const slots = d.pickImages?.slots || {};
  // ★ SEM-1 (design v2 ช่องโหว่ 1 — ordered instance carrier): semantic ใช้ slotOrder ของ instance จริงจาก S6
  //   (invariant I2: ทุก instance ต้องถูกส่งครบ รวม circle-shape ไม่ว่าชื่อบทอะไร) · legacy = ลิสต์ generic เดิมเป๊ะ
  // ★ SEM-2 audit C: แยก "สัญญาณ semantic" ออกจาก "carrier สมบูรณ์" — แฟ้ม semantic ที่เสีย/ครึ่งๆ
  //   ห้ามไหลกลับ legacy เด็ดขาด (key instance บนลิสต์ generic = ภาพผิดช่อง) → fail-closed พักงานก่อนแตะ network
  const _semSignal = d.pickImages?.semanticSelection === true
    || !!d.pickImages?.slotContractHash
    || !!d.pickImages?.heroSlotId
    // ★ P1-1 (probe): แค่มี property slotOrder (แม้ค่า null/พัง) = ร่องรอย semantic — legacy จริงไม่มี key นี้
    || (d.pickImages != null && Object.prototype.hasOwnProperty.call(d.pickImages, 'slotOrder'))
    || Object.values(slots).some((s) => s && s.refSlotId);
  const _semOrder0 = d.pickImages?.slotOrder;
  const _heroId0 = d.pickImages?.heroSlotId;
  const _semValid = d.pickImages?.semanticSelection === true
    && Array.isArray(_semOrder0) && _semOrder0.length >= 3
    // เสริม (probe): entries ต้องเป็น string ไม่ว่าง/unique — ห้าม coerce number/ของพังให้ valid
    && _semOrder0.every((id) => typeof id === 'string' && id.trim().length > 0)
    && new Set(_semOrder0).size === _semOrder0.length
    && _semOrder0.every((id) => Object.prototype.hasOwnProperty.call(slots, id))
    // ★ P1-2 (probe): hero ต้องมีตัวจริง — id string ไม่ว่าง + อยู่ใน order + entry มี candidate id/URL จริง
    //   (และถ้า entry พก refSlotId ต้องตรงกับ heroSlotId) — กัน enqueue ปกไร้ hero
    && typeof _heroId0 === 'string' && _heroId0.trim().length > 0
    && _semOrder0.includes(_heroId0)
    && !!(slots[_heroId0] && slots[_heroId0].id != null && slots[_heroId0].imageUrl)
    && (slots[_heroId0].refSlotId == null || slots[_heroId0].refSlotId === _heroId0);
  if (_semSignal && !_semValid) {
    return { status: 'waiting', nextAction: 'wait', summary: '🧬⛔ แฟ้ม semantic ไม่สมบูรณ์ (marker/slotOrder/heroSlotId ขาดหรือไม่ตรง slots) — พักงานกันภาพผิดช่อง ห้ามแปลง legacy' };
  }
  const _sem = _semValid;
  const _order = _sem ? _semOrder0 : ['hero', 'reaction', 'action', 'context', 'circle'];
  // ★ SEM-1 correction (Codex P1-5/6): hero หาโดย heroSlotId (authority จาก S6) — slotOrder คงลำดับ ref เดิม ไม่ย้าย hero ขึ้นหน้า
  const _heroKey = _sem ? ((d.pickImages?.heroSlotId && slots[d.pickImages.heroSlotId]) ? d.pickImages.heroSlotId : _order[0]) : 'hero';
  // ★ SEM-1 final (Codex P1-A): kill switch ต้องคุมถึง S7 — งานที่ S6 เลือกตอน ON แต่สวิตช์ถูกปิดก่อนขั้นนี้
  //   ห้าม enqueue แบบ semantic และห้ามแปลงร่างเป็น legacy (key instance ไม่ตรงสัญญาเดิม = ภาพผิดช่อง)
  //   → พักงาน (waiting) ก่อนแตะ network ใดๆ · เปิดสวิตช์กลับ = tick รอบถัดไปเดินต่อจากจุดเดิม
  const _semEnvOn = process.env.MEGA_SEMANTIC_SELECTION === '1' && process.env.MEGA_SELECTION_SPEC === '1';
  if (_sem && !_semEnvOn) {
    return { status: 'waiting', nextAction: 'wait', summary: '🧬⏸️ แผนนี้เลือกภาพแบบ semantic แต่สวิตช์ปิดอยู่ — พักรอเปิด MEGA_SEMANTIC_SELECTION=1 + MEGA_SELECTION_SPEC=1 (ไม่แปลง legacy กันภาพผิดช่อง)' };
  }
  // ลำดับ: legacy = hero ก่อน (boost เดิม) · semantic = ตามลำดับช่องของ ref จริง + เพดาน 10 ลิงก์
  const links = _order
    .map((s) => slots[s]?.imageUrl)
    .filter(Boolean);
  if (_sem && links.length > 10) console.log(`[MEGA S7] 🧬⚠️ primary ${links.length} ใบ เกินเพดาน 10 ลิงก์ — ใบท้ายลำดับจะถูกตัด (ตรวจ ref/contract)`);
  if (links.length < 3) {
    return { status: 'failed', nextAction: 'fail', summary: `ภาพจาก S6 ไม่พอทำปก (${links.length} ใบ ต้อง ≥3)`, quality: 'red' };
  }
  // ★ P1-4 (probe): semantic — primary หลายช่องชี้ "ไฟล์เดียวกัน" (URL alias) ทำเลขด่านขั้นต่ำหลอกได้
  //   นับ URL unique แบบ deterministic ก่อนแตะ network ใดๆ — ต่ำกว่า 3 = ภาพจริงไม่พอ fail-closed ห้าม fetch/enqueue
  //   legacy ไม่แตะ (เงื่อนไขเดิม byte เดิมด้านบน)
  if (_sem) {
    const _uniqPrimary = new Set(links.map(String)).size;
    if (_uniqPrimary < 3) {
      return { status: 'failed', nextAction: 'fail', quality: 'red', summary: `🧬 ภาพ primary ซ้ำไฟล์กัน — URL unique ${_uniqPrimary}/${links.length} ช่อง (ต้อง ≥3) ภาพจริงไม่พอทำปก` };
    }
  }
  // ★ 7 ก.ค. FIX "คลังแน่นแต่ปกล้มภาพไม่พอ": เดิม backups เป็น id ถูกทิ้ง (นับรายงานเฉยๆ) แล้วส่งแค่ 5 ลิงก์เป๊ะ —
  //   ลิงก์หน้าเว็บ/วิดีโอพัง 1-2 ใบ (403) = พูลต่ำกว่า 4 ล้มทั้งปก → แปลง id→URL จากคลังเคส ต่อท้าย (ไฟล์รูปตรงก่อน) เพดาน 10
  let backupUrls = [];
  let backupEntries = []; // ★ SelectionSpec v1: สำรองพร้อม candidateId (id จริงจากคลัง ไม่ใช่แค่ URL)
  const backupMeta = new Map(); // ★ SEM-1 final (P1-B): url → {id, owner refSlotId} — owner คนแรกตาม slotOrder ชนะ (deterministic)
  let urlTriage = new Map(); // ★ 8 ก.ค.: url → {clean,faces} จากคลัง (ส่งเป็น slotPlan ให้ v3 เชื่อป้ายตาคัด)
  try {
    const backupIds = Object.values(slots).flatMap((s) => s?.backups || []);
    if (origin && d.images?.caseId) {
      const lib = await _jf(`${origin}/api/images/${encodeURIComponent(d.images.caseId)}`, {}, 30000);
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
      const _seenBk = new Set(); // ★ Codex รอบ 3 ข้อ 4: dedupe deterministic — candidateId แรกชนะตามลำดับ backupIds
      const _seenBkUrl = new Set(); // ★ SEM-1 P2 (Codex): URL alias — สอง candidateId ชี้ไฟล์เดียว ห้ามรายงานซ้ำใน spec (ตัวแรกชนะ)
      backupEntries = backupIds
        .map((b) => ({ candidateId: String(b), imageUrl: String(byId.get(String(b)) || '') }))
        .filter((x) => {
          if (!x.imageUrl || _seenBk.has(x.candidateId) || _seenBkUrl.has(x.imageUrl)) return false;
          _seenBk.add(x.candidateId);
          _seenBkUrl.add(x.imageUrl);
          return true;
        });
      // ★ SEM-1 final (Codex P1-B): เจ้าของ backup ต่อช่อง — ไล่ตาม slotOrder, candidate ซ้ำ owner แรกชนะ
      if (_sem) {
        for (const s of _order) {
          for (const b of (slots[s]?.backups || [])) {
            const u = byId.get(String(b));
            if (u && !backupMeta.has(String(u))) backupMeta.set(String(u), { id: String(b), owner: s });
          }
        }
      }
    }
  } catch { /* สำรองไม่ critical — ได้แค่ลิงก์หลักก็เดินต่อ */ }
  // ★ 9 ก.ค. ค่ำ (อุดรอย "ภาพคนอื่นหล่น" — เหมือน compose-test): เรียง backups ให้ "คนละคนกับ hero"
  //   มาก่อนไฟล์ตรง + การันตี 1 ใบรอดเพดาน 10 (ไม่งั้นกติกาวงกลมคนละคนไม่มีของให้หยิบ)
  const _heroPersonPlan = String(slots[_heroKey]?.person || urlTriage.get(String(slots[_heroKey]?.imageUrl))?.person || '');
  const _diffP = (u) => { const p = String(urlTriage.get(String(u))?.person || ''); return !!(_heroPersonPlan && p && p !== _heroPersonPlan); };
  // ★ SEM-1 final (Codex P1-B): กติกา global "คนละคนกับ hero" ห้ามยุ่งกับแผน semantic — identity รายช่องคุมแล้วที่ S6
  if (!_sem) backupUrls = backupUrls.slice().sort((a, b) => (_diffP(b) ? 2 : 0) - (_diffP(a) ? 2 : 0)); // คงลำดับไฟล์ตรงเดิมภายในกลุ่ม (sort เดิมทำไว้แล้ว)
  const _seenL = new Set();
  const allLinks = [...links, ...backupUrls]
    .filter((u) => { const k = String(u); if (_seenL.has(k)) return false; _seenL.add(k); return true; })
    .slice(0, 10);
  if (!_sem && _heroPersonPlan && !allLinks.some(_diffP)) { // ★ SEM-1 final (P1-B): semantic ห้ามฉีดคนนอกสัญญาเข้าแผน
    const cand = backupUrls.find((u) => _diffP(u) && !allLinks.includes(u));
    if (cand && allLinks.length >= 4) { allLinks[allLinks.length - 1] = cand; console.log('[MEGA S7] 👥 การันตีภาพคนอื่นรอดเพดาน 10 ลิงก์'); }
  }
  const backup = allLinks.length - links.length; // จำนวนสำรองที่ส่งจริง
  // ★ 8 ก.ค. (CASE-363/AC-0035 hero โดนดึงลง + ภาพ text หลุดเข้า main): ส่ง "แผนช่อง" ให้ v3
  //   หลักการ: S6 ตัดสิน · v3 แค่ประกอบ — v3 บังคับ main=hero ของแผน + เชื่อ clean ของตาคัด (แม่นกว่า detector 512→1024)
  const heroUrl = slots[_heroKey]?.imageUrl || null;
  const slotPlan = allLinks.map((u) => {
    const primary = _order.find((s) => slots[s]?.imageUrl === u); // SEM-1: หาใน _order (legacy = SLOT_ORDER เดิมเป๊ะ)
    const t = urlTriage.get(String(u)) || {};
    return {
      url: u,
      // SEM-1: semantic → slot = บท legacy (composer compatibility เท่านั้น — ห้ามใช้เป็น key) + refSlotId = authority (primary only)
      //   ★ P1-B: backup ได้ป้าย legacy ของ "เจ้าของช่อง" + backupForRefSlotId (ตรวจ composer แล้ว: primary มาก่อนใน loaded
      //   ทุก tier จึงไม่โดน backup แย่ง — ป้ายนี้ทำให้ QC-swap หยิบสำรองถูกบท/ถูกคนของช่องตัวเอง)
      slot: _sem
        ? (primary
          ? (slots[primary]?.legacySlot ?? null)
          : (backupMeta.has(String(u)) ? (slots[backupMeta.get(String(u)).owner]?.legacySlot ?? null) : null))
        : (primary || null), // hero/reaction/action/context/circle ถ้าเป็นภาพหลัก · null=สำรอง
      ...(_sem && primary ? { refSlotId: primary } : {}),
      ...(_sem && !primary && backupMeta.has(String(u)) ? { backupForRefSlotId: backupMeta.get(String(u)).owner } : {}),
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
  // ★ รอบ 4 P1: refId ตัวตนจริงต้องตามทัน fallback ด้วย — d.refMatch ก่อน แล้วอัปเดตเมื่อ S7 pick เอง
  let resolvedRefId = d.refMatch?.refId || d.refMatch?.dnaHash || null;
  // ★ รอบ 5 P0-2: แยกสอง DNA เด็ดขาด — refDNA (payload/composer) ต้องเป็นพฤติกรรม HEAD เดิมทุก byte
  //   ไม่ว่า kill switch เปิดหรือปิด · selectionRefDNA ใช้สร้าง SelectionSpec เท่านั้น (strip weak-match
  //   ให้ตรงกับที่ S6 ใช้จริง) — สาย d.refMatch ไม่ต้อง strip เพราะ S6 เก็บ dna ที่ strip แล้วตอน bind
  let selectionRefDNA = refDNA;
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
      if (m?.ref?.dna) {
        refDNA = m.ref.dna; // payload/composer: legacy เดิมเป๊ะ ห้าม strip (kill switch ต้องไม่เปลี่ยนผลปก)
        // ★ ผู้ตรวจอิสระ (รอบ 4) + รอบ 5: strip เฉพาะสัญญา — weak match = S6 ใช้เฉพาะโครง
        selectionRefDNA = m.typeMatched ? m.ref.dna : { ...m.ref.dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' };
        resolvedRefId = m.ref.id || _dnaHashFor(selectionRefDNA); // identity จริงเท่านั้น — ห้ามใช้ styleName
        refInfo = ` · 🎯ref ${m.ref.styleName || m.ref.id} (${m.reason})`.slice(0, 90);
      }
    } catch { /* คลัง ref ว่าง/ล้ม → ไม่มี ref (ใช้ template ปกติ) ไม่กระทบ */ }
  }
  // ★ 📜 SelectionSpec v1 (Codex ตรวจรอบ 2 ข้อ 2-5 — 10 ก.ค. ดึก): สัญญา S6→composer สร้าง "ก่อน" เรียกโรงประกอบ
  //   ★ รอบ 4 P1: ระหว่างพัฒนา default OFF ตามกฎ — เปิดเอง MEGA_SELECTION_SPEC=1 เฉพาะ local :3900
  //   ปิด = ไม่มี dossier field/ไม่มี log/พฤติกรรม legacy เดิม 100% · strict composer มาอ่านสัญญานี้หลังตรวจผ่าน
  let selectionSpec = null;
  // ★ Checkpoint C (11 ก.ค. — Codex strict producer): realized template คำนวณ "ครั้งเดียว" จาก selectionRefDNA
  //   แล้วใช้ object ก้อนเดียวกันทั้ง buildSelectionSpec / validator / queue payload — ห้าม recompute จาก refDNA
  let realizedTemplate = null;
  // ★ Checkpoint C (FINAL AUDIT): switch matrix สองจังหวะ —
  //   · strictProducerRequested = งาน semantic จริง + ฝั่งส่งเปิด (MEGA_STRICT_PRODUCER=1)
  //   · strictWireOn = requested + ฝั่งโรงตรวจพร้อม (MEGA_STRICT_RENDER=1)
  //   RENDER เปิดแต่ PRODUCER ปิด/0/junk = shadow เดิม (โรงพร้อมแต่ยังไม่ส่ง) · legacy _sem=false = legacy เสมอ
  //   🧭 rollout ปลอดภัย: เปิด RENDER (โรง) ก่อน → ค่อยเปิด PRODUCER (ฝั่งส่ง) · rollback: ปิด PRODUCER ก่อน
  //   → ค่อยปิด RENDER — จึงไม่มีจังหวะที่งาน strict หลุดไปโรงที่ไม่ตรวจ
  const strictProducerRequested = _sem === true && _semEnvOn && process.env.MEGA_STRICT_PRODUCER === '1';
  const strictWireOn = strictProducerRequested && process.env.MEGA_STRICT_RENDER === '1';
  // PRODUCER เปิดแต่ RENDER ยังไม่ armed = ห้ามส่งงาน strict เข้าโรง legacy — พักงาน "ก่อน queue"
  // (image-library fetch ของขั้นนี้เกิดไปก่อนหน้าแล้ว — จุดที่กันคือ enqueue เท่านั้น)
  if (strictProducerRequested && !strictWireOn) {
    return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ strict producer: strict_render_not_armed — MEGA_STRICT_PRODUCER เปิดแต่ MEGA_STRICT_RENDER ยังไม่พร้อม พักงานก่อน queue (rollout: เปิด RENDER ก่อน PRODUCER)' };
  }
  if (process.env.MEGA_SELECTION_SPEC === '1') {
    try {
      const specApi = await import('@/lib/refSlotContract');
      // ★ Checkpoint C (C): template builder ฉีดได้เฉพาะเทสผ่าน _deps — production default = ของจริงเสมอ
      const dnaToTemplateSpec = _deps?.dnaToTemplateSpec || (await import('@/lib/refTemplate')).dnaToTemplateSpec;
      // ★ รอบ 5 P0-2: สัญญาสร้างจาก selectionRefDNA เท่านั้น (weak-match ถูก strip ตรง S6) —
      //   ส่วน payload ด้านล่างใช้ refDNA legacy · template.slots สองก้อนเหมือนกัน realized geometry จึงตรง composer
      const contract = specApi.buildRefSlotContract({ refDNA: selectionRefDNA, artBriefOrders: d.artBrief?.orders || [] });
      const sentSet = new Set(allLinks.map(String));
      // ★ SEM-2 (Codex): exact authority — สร้าง plannedByRefSlot จาก "slotPlan สุดท้ายที่รอด dedupe+เพดาน 10 จริง"
      //   เท่านั้น (ห้ามสร้างจาก raw slots) · เฉพาะ _sem + สวิตช์ runtime ทั้งสอง ON
      //   ★ Checkpoint C: spec เข้า queue payload ได้ "เฉพาะ strictWireOn" เท่านั้น (เดิม shadow ล้วนใน dossier
      //   — ตอนนี้ dossier ยังได้ spec เสมอเมื่อ SPEC=1 · queue ได้คู่ spec+realized เมื่อกุญแจครบสี่)
      let plannedByRefSlot;
      let specAuthorityStale = false;
      if (_sem && _semEnvOn) {
        plannedByRefSlot = {};
        for (const p of slotPlan) {
          if (p.refSlotId) {
            plannedByRefSlot[p.refSlotId] = {
              candidateId: slots[p.refSlotId]?.id != null ? String(slots[p.refSlotId].id) : null,
              imageUrl: p.url, // URL จาก row ที่ส่งจริง
              legacySlot: p.slot ?? null, // display/compat เท่านั้น
              backups: [],
            };
          }
        }
        for (const p of slotPlan) {
          if (!p.refSlotId && p.backupForRefSlotId && plannedByRefSlot[p.backupForRefSlotId]) {
            const bm = backupMeta.get(String(p.url));
            plannedByRefSlot[p.backupForRefSlotId].backups.push({ candidateId: bm?.id ?? null, imageUrl: p.url });
          }
        }
        // authority freshness: contract ที่ rebuild ตอน S7 ต้องตรง hash ที่ S6 ผูกไว้ — ไม่ตรง/หาย = fail-closed
        //   (strictReady=false ใน spec, ไม่มี legacy fallback) แต่ท่อ shadow เดินต่อปกติ
        const s6Hash = d.pickImages?.slotContractHash;
        // ★ P1-3 (probe): เทียบด้วย hash ที่ "ผูก ref identity" ก้อนเดียวกับที่ S6 stamp — เปลี่ยน refId เฉยๆ ก็ stale
        const s7AuthHash = _dnaHashFor({ refId: resolvedRefId, contract });
        specAuthorityStale = !s6Hash || s6Hash !== s7AuthHash;
        if (specAuthorityStale) console.log(`[MEGA S7] 🧬⚠️ contract authority ไม่ตรงกับตอน S6 (s6=${s6Hash || '-'} vs s7=${s7AuthHash}) — spec fail-closed`);
      }
      // ★ Checkpoint C (B): คำนวณครั้งเดียว — ก้อนเดียวกันนี้ไหลไปทั้ง build/validate/payload
      realizedTemplate = selectionRefDNA ? dnaToTemplateSpec(selectionRefDNA) : null;
      selectionSpec = specApi.buildSelectionSpec({
        contract,
        realizedTemplate,
        plannedSlots: slots,
        backups: backupEntries.filter((b) => sentSet.has(b.imageUrl)), // เฉพาะสำรองที่รอดเพดาน 10 ลิงก์จริง
        // ★ Codex รอบ 3 ข้อ 3 + รอบ 4 P1: refId = ตัวตนจริง (bind refId → dnaHash แฟ้มเก่า → m.ref.id ตอน S7 pick เอง)
        refId: resolvedRefId,
        // ★ SEM-2: มีเฉพาะ semantic ON — legacy/OFF ไม่ส่ง param = branch เดิม byte เดิม
        ...(plannedByRefSlot ? { plannedByRefSlot, authorityStale: specAuthorityStale } : {}),
      });
      console.log(`[MEGA S7] 📜 SelectionSpec v1: ${selectionSpec.counts.total} ช่อง (map ${selectionSpec.counts.mapped} · ไร้ primary ${selectionSpec.counts.missingPrimary}) · strictReady=${selectionSpec.strictReady} · hash=${selectionSpec.specHash}`);
      // ★ Checkpoint C (FINAL P1 TOCTOU): การตรวจ validator/geometry/binding ย้ายไปทำบน "wire snapshot"
      //   (ก้อนที่ parse กลับจาก payloadBody ที่จะส่งจริง) หลังสร้าง payload — ที่นี่เหลือเช็คของที่รู้ก่อนได้
      if (strictWireOn) {
        // ⓪ โครง realized หาย = reason เฉพาะของ producer (คงที่) — wire gate ตรวจฉบับเต็มอีกชั้นก่อน queue
        if (!realizedTemplate) {
          return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ strict producer: strict_realized_template_missing — สร้างโครง realized ไม่ได้ พักงานก่อน queue' };
        }
      }
    } catch (e) {
      // ★ Checkpoint C (D): strictWireOn ห้าม shadow-catch แล้ว enqueue แบบ legacy — build/import/template
      //   พังจุดไหน = failed/retry ก่อนแตะ queue เสมอ · reason คงที่ (รายละเอียดอยู่ log เท่านั้น —
      //   summary ห้ามพกข้อความ exception) · shadow (OFF) = กลืนเงียบตามพฤติกรรมเดิม
      if (strictWireOn) {
        console.log('[MEGA S7] 🔐 strict producer build ล้ม:', String(e?.message || '').slice(0, 120));
        return { status: 'failed', nextAction: 'retry', summary: '🔐 strict producer: strict_carrier_build_failed — สร้างสัญญา/โครงล้ม ไม่ enqueue (รายละเอียดใน log)' };
      }
      console.log('[MEGA S7] SelectionSpec ล้ม (shadow ไม่กระทบงาน):', String(e?.message || '').slice(0, 80));
    }
  }
  // ★ Checkpoint C (D): invariant both-or-neither — ถึงจุดนี้ under strict wire สัญญาต้องครบคู่เสมอ
  //   (validator ผ่านแล้ว spec/realized ห้ามหาย) · หลุด = บั๊กจริง ปิดงานก่อน enqueue
  if (strictWireOn && (!selectionSpec || !realizedTemplate)) {
    return { status: 'failed', nextAction: 'retry', summary: '🔐 strict producer: spec/realized หายก่อน enqueue (invariant both-or-neither) — ไม่ส่งงาน' };
  }
  const payload = {
    jobType: 'cover',
    composer: 'mega', // 🏭 8 ก.ค. (ทีมกราฟฟิก): โรงประกอบใหม่ /api/mega/compose — auto-cover-v3 ถอดทิ้งแล้ว
    newsTitle: nd.newsTitle || d.desk?.title || '',
    slotPlan, // แผนช่องจาก S6 (ภาพ→ช่อง/hero/clean/thumbnail) — โรงประกอบทำตามเป๊ะ ไม่ตัดสินใหม่
    userId: MEGA_USER,
    ...(refDNA ? { refDNA } : {}), // 🎯 โครงจริงจากปกเป้า
    ...(d.refMatch?.imagePath ? { refImagePath: d.refMatch.imagePath } : {}), // 👁️ ภาพ ref จริงให้ตาเทียบ
    // ★ Checkpoint C (D): แนบคู่ strict "both-or-neither" เฉพาะ strictWireOn — OFF = payload เดิม byte-identical
    //   (ไม่มี own key · key order เดิมทุกตัว) · consumer ฝั่ง compose ตรวจซ้ำด้วย validator เดียวกันก่อนประกอบ
    ...(strictWireOn ? { selectionSpec, realizedTemplate } : {}),
  };
  // ★ Checkpoint C (FINAL P1 TOCTOU): strict = serialize exact payload "ครั้งเดียว" → ตรวจ wire snapshot →
  //   ส่ง string ก้อนเดิมที่ตรวจแล้วเป๊ะ — ห้าม stringify ซ้ำ (stateful toJSON/getter อาจผ่านรอบแรกแล้ว
  //   เปลี่ยนร่าง/โยนรอบสอง = throw หลุดหรือส่งของที่ไม่ได้ validate) · OFF = stringify ที่จุดส่งตามเดิม byte เดิม
  let payloadBody = null;
  if (strictWireOn) {
    try {
      const _specApiWire = await import('@/lib/refSlotContract');
      payloadBody = JSON.stringify(payload); // ← ครั้งเดียวเท่านั้นทั้งชีวิต payload นี้
      const wire = JSON.parse(payloadBody);  // snapshot ที่จะขึ้นสายจริง
      const gate = _strictWireGate(wire, _specApiWire.validateStrictRenderActivation);
      if (gate) return gate;
      console.log(`[MEGA S7] 🔐 strict producer ARMED: ref=${wire.selectionSpec.refId} · wire snapshot ผ่านครบ — ส่ง body ก้อนที่ตรวจแล้ว`);
    } catch (e) {
      console.log('[MEGA S7] 🔐 strict wire snapshot ล้ม:', String(e?.message || '').slice(0, 120));
      return { status: 'failed', nextAction: 'retry', summary: '🔐 strict producer: strict_payload_not_serializable — serialize/ตรวจ wire snapshot ล้ม ไม่ enqueue (รายละเอียดใน log)' };
    }
  }
  const q = await _jf(`${coverOrigin()}/api/queue/add`, { method: 'POST', body: payloadBody ?? JSON.stringify(payload) }, 60000);
  if (!q.success || !q.jobId) {
    return { status: 'failed', nextAction: 'retry', summary: 'ส่งงานปกไม่สำเร็จ: ' + (q.error || q.httpStatus) };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ส่งทำปกแล้ว job ${String(q.jobId).slice(0, 10)} (ภาพ ${links.length} ใบจาก 5 ช่อง · สำรอง ${backup})${refInfo}`,
    dossierPatch: { cover: { queueJobId: q.jobId, enqueuedAt: new Date().toISOString(), sourceLinks: links, refStyle: refInfo || null, ...(selectionSpec ? { selectionSpec } : {}) } },
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
    let finalAssignmentTrace = null;
    if (SELECTION_TRACE_ON && Array.isArray(r.manifest?.slots)) {
      try {
        const traceApi = await import('@/lib/refSlotContract');
        const refSlotContract = traceApi.buildRefSlotContract({
          refDNA: job.dossier.refMatch?.dna || null,
          artBriefOrders: job.dossier.artBrief?.orders || [],
        });
        finalAssignmentTrace = traceApi.buildFinalAssignmentTrace({
          plannedSlots: job.dossier.pickImages?.slots || {},
          manifestSlots: r.manifest.slots,
          placed: r.placed || [],
          refSlotContract,
          // ★ รอบ 4 P0: สัญญาจริงจาก S7 มาก่อน positional เสมอ (ไม่มี = ถอย legacy เดิมทั้งก้อน)
          selectionSpec: job.dossier.cover?.selectionSpec || null,
        });
        // ★ รอบ 7 P0: แยก log ตามเวอร์ชัน — v1 (ไม่มี spec) ต้องเป็นข้อความ HEAD เดิมทุกตัวอักษร
        if (finalAssignmentTrace.v === 2) {
          console.log(`[MEGA S7] selection trace: kept ${finalAssignmentTrace.partition.kept}/${finalAssignmentTrace.total} · changed ${finalAssignmentTrace.partition.changed} · missing ${finalAssignmentTrace.partition.missingExpected} · unmapped ${finalAssignmentTrace.partition.unmapped}`);
        } else {
          console.log(`[MEGA S7] selection trace: kept ${finalAssignmentTrace.keptExpectedPrimary}/${finalAssignmentTrace.total} expected primaries · changed ${finalAssignmentTrace.changedExpectedPrimary}`);
        }
      } catch (traceErr) {
        console.log('[MEGA S7] selection trace failed (cover result unchanged):', traceErr?.message?.slice(0, 80));
      }
    }

    const coverCore = {
      ...cv,
      coverPath,
      template: r.template || '',
      score: r.score ?? null,
      coverCaseId: r.caseId || '',
      directorReason: (r.directorReason || '').slice(0, 300),
      manifest: r.manifest || null, // ★ Wave1 Batch E: ความจริงของรอบประกอบ (จาก composeAndVerify) — additive
      ...(finalAssignmentTrace ? { finalAssignmentTrace } : {}),
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
