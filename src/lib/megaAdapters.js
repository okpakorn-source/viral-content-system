// ============================================================
// 🏭 MEGA Workflow — ตัวเชื่อมสถานี (adapters) เฟส 1: S1 → S4
// ------------------------------------------------------------
// ทุกตัว: อ่านแฟ้มทั้งใบ → เรียก "ท่อเดิม" ตามสัญญาใน _MEGA_PHASE0_MAP.md →
// คืนผลตาม contract กลาง { status, nextAction, summary, dossierPatch, quality }
// 🔴 ไม่แตะโค้ดระบบข่าว: คิว/extract เรียกผ่าน HTTP same-origin แบบเดียวกับโต๊ะข่าว
// ============================================================

import { preflightBrain, compassBrain, judgeBrain, slotDirectorBrain, artBriefBrain, templateV1PersonAuthority } from '@/lib/megaBrains';
import { evaluateCoverQc } from '@/lib/coverQcGate'; // ★ Wave2 A1: ด่าน QC แข็ง — ของเสียไม่เข้าคลัง
// ★ Wave2 Batch B1 (10 ก.ค.): เกณฑ์ตัวเลขคุณภาพภาพ/hero รวมเป็น single source of truth — ค่าเดิมเป๊ะ
import { HERO_MIN_SHORT_SIDE, SHARPNESS_MIN_HERO, GAP_SEARCH_MIN_HERO_PER_PERSON as GAP_SEARCH_MIN_HERO_PER_PERSON_CFG } from '@/lib/imageQualityConfig';
import { resolveRefSlotView } from '@/lib/refSlotContract'; // ★ D3-B3.2 (Codex): read-only — canonical template view สำหรับ derive authoritative target rows (ห้ามแก้ refSlotContract)

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

// ★ Search Provenance V1 — sanitize ตัวนับ provenance (fail-closed แข็ง):
//   รับเฉพาะ plain own-data object (prototype = Object.prototype/null) · class instance/exotic = null
//   อ่านผ่าน own DATA descriptor เท่านั้น (accessor/inherited = ข้าม, ไม่เรียก getter) · throwing getter/Proxy trap = null
//   copy เฉพาะ 6 ฟิลด์ safe non-negative integer (vetKept ยอม null = vet ไม่รัน/ล้ม) · ทิ้ง key แปลกปลอม
//   ไม่มีฟิลด์ valid = null (ป้าย provenance ไม่ติด) · ไม่เก็บ URL/คำค้น/ข้อมูลส่วนตัว · key order คงที่
function _sanitizeSearchProv(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null; // เฉพาะ plain / null-proto (class instance/inherited = ทิ้ง)
    // ตรวจ "ทั้งก้อน" + snapshot descriptor.value ตอนตรวจ (ไม่อ่าน raw[k] อีกเลยหลังจากนี้ = กัน get trap/side-effect)
    //   เจอ accessor/descriptor แปลก/inspection throw = ทิ้งทั้ง carrier · ค่าที่ publish มาจาก descriptor.value เท่านั้น
    const vals = new Map();
    for (const k of Reflect.ownKeys(raw)) {
      const d = Object.getOwnPropertyDescriptor(raw, k);
      if (!d || !('value' in d)) return null; // accessor(get/set) หรือ descriptor ผิดปกติ = fail closed ทั้ง carrier
      vals.set(k, d.value); // descriptor-only snapshot (ไม่เรียก getter)
    }
    // build 6 canonical fields จาก snapshot เท่านั้น — ห้ามแตะ raw อีก (unknown DATA key ปล่อยผ่าน)
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    const out = {};
    const put = (k) => { const n = _int(vals.get(k)); if (n !== null) out[k] = n; };
    put('queriesFired');
    put('urlsReturned');
    put('urlsVetted');
    const vk = vals.get('vetKept'); // undefined = ไม่มี own key vetKept
    if (vk === null) out.vetKept = null; else { const n = _int(vk); if (n !== null) out.vetKept = n; }
    put('vetDropped');
    put('vetFailed');
    return Object.keys(out).length ? out : null;
  } catch { return null; } // ownKeys/descriptor/prototype trap throw → null (fail closed)
}

// 🔎 Search V2 shadow — joinable candidate provenance (diagnostic-only, opt-in MEGA_SEARCH_SHADOW_V2=1)
//   pure · fail-closed descriptor-only sanitizer · ห้าม URL/query/PII · ไม่แตะ selection/vet/add (มิเรอร์ route.js)
const _V2_PROVIDERS = new Set(['google', 'google_news', 'yandex', 'facebook', 'tiktok']);
const _V2_MAX_EMIT = 160;
const _V2_MAX_BYTES = 32 * 1024;
const _V2_ID_MAX = 192;
const _V2_ENC = new TextEncoder(); // UTF-8 byte length (ไม่ใช่ UTF-16 code unit)
const _v2bytes = (s) => _V2_ENC.encode(s).length;
function _sanitizeSearchShadowV2(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null;
    const top = new Map();
    for (const k of Reflect.ownKeys(raw)) {
      const d = Object.getOwnPropertyDescriptor(raw, k);
      if (!d || !('value' in d)) return null; // accessor/แปลก = ทิ้งทั้ง carrier (descriptor-only)
      top.set(k, d.value);
    }
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    if (top.get('version') !== 2) return null;
    const totalCandidates = _int(top.get('totalCandidates'));
    const emittedCandidates = _int(top.get('emittedCandidates'));
    const truncatedCandidates = _int(top.get('truncatedCandidates'));
    const capped = top.get('capped');
    if (totalCandidates === null || emittedCandidates === null || truncatedCandidates === null || typeof capped !== 'boolean') return null;
    const candRaw = top.get('candidates');
    if (!Array.isArray(candRaw) || Object.getPrototypeOf(candRaw) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(candRaw, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    if (lenD.value > _V2_MAX_EMIT) return null; // bounded work: reject ก่อน iterate row/descriptor ใดๆ
    const out = [];
    for (let i = 0; i < lenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(candRaw, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor = ทิ้ง
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const em = new Map();
      for (const k of Reflect.ownKeys(el)) {
        const dd = Object.getOwnPropertyDescriptor(el, k);
        if (!dd || !('value' in dd)) return null;
        em.set(k, dd.value);
      }
      const candidateId = em.get('candidateId');
      const provider = em.get('provider');
      const queryIndex = _int(em.get('queryIndex'));
      const providerRank = em.get('providerRank');
      if (typeof candidateId !== 'string' || candidateId.length === 0 || candidateId.length > _V2_ID_MAX) return null;
      if (typeof provider !== 'string' || !_V2_PROVIDERS.has(provider)) return null;
      if (queryIndex === null) return null;
      if (!Number.isSafeInteger(providerRank) || providerRank < 1) return null;
      out.push({ candidateId, provider, queryIndex, providerRank }); // canonical key order
    }
    if (emittedCandidates !== out.length) return null;
    if (truncatedCandidates !== totalCandidates - emittedCandidates) return null;
    if (capped !== (truncatedCandidates > 0)) return null;
    if (emittedCandidates > _V2_MAX_EMIT) return null;
    const carrier = { version: 2, totalCandidates, emittedCandidates, truncatedCandidates, capped, candidates: out };
    if (_v2bytes(JSON.stringify(carrier)) > _V2_MAX_BYTES) return null; // UTF-8 bytes ≤ 32 KiB
    return carrier;
  } catch { return null; }
}
function _buildSearchShadowV2(cands) {
  const list = Array.isArray(cands) ? cands : [];
  const total = list.length;
  let emitted = list.slice(0, Math.min(_V2_MAX_EMIT, total));
  const mk = (arr) => ({ version: 2, totalCandidates: total, emittedCandidates: arr.length, truncatedCandidates: total - arr.length, capped: total - arr.length > 0, candidates: arr });
  while (emitted.length > 0 && _v2bytes(JSON.stringify(mk(emitted))) > _V2_MAX_BYTES) emitted = emitted.slice(0, emitted.length - 1); // 32 KiB UTF-8 tail-trim
  return _sanitizeSearchShadowV2(mk(emitted));
}
// fresh-suffix trust boundary — descriptor-snapshot saved.images/added + own-data-only rows (ไม่เรียก getter/proxy trap)
function _buildSearchShadowV2FromSaved(saved, attr) {
  try {
    if (!saved || typeof saved !== 'object' || !attr) return null;
    const imD = Object.getOwnPropertyDescriptor(saved, 'images');
    if (!imD || !('value' in imD)) return null; // accessor/หาย → omit
    const all = imD.value;
    if (!Array.isArray(all) || Object.getPrototypeOf(all) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(all, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    const len = lenD.value;
    const adD = Object.getOwnPropertyDescriptor(saved, 'added');
    if (!adD || !('value' in adD)) return null;
    const addedN = adD.value;
    if (!Number.isSafeInteger(addedN) || addedN < 0 || addedN > len) return null; // inconsistent/added>len → omit (ห้ามนับ historical เป็น fresh)
    const cands = [];
    for (let i = len - addedN; i < len; i++) {
      const ed = Object.getOwnPropertyDescriptor(all, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor index → omit V2
      const img = ed.value;
      if (!img || typeof img !== 'object' || Array.isArray(img)) return null; // malformed fresh row → omit V2
      const idD = Object.getOwnPropertyDescriptor(img, 'id');
      const urlD = Object.getOwnPropertyDescriptor(img, 'imageUrl');
      if ((idD && !('value' in idD)) || (urlD && !('value' in urlD))) return null; // accessor id/imageUrl → omit V2 (never invoke getter)
      const id = idD ? idD.value : undefined;
      const url = urlD ? urlD.value : undefined;
      const a = url === undefined ? undefined : attr.get(url);
      if (!a || typeof id !== 'string' || id.length === 0 || id.length > _V2_ID_MAX) continue; // join ไม่ได้ = omit ใบนี้
      cands.push({ candidateId: id, provider: a.provider, queryIndex: a.queryIndex, providerRank: a.providerRank });
    }
    return _buildSearchShadowV2(cands);
  } catch { return null; }
}

// 🔎 Search V2 Outcome Shadow V1 (diagnostic-only, opt-in MEGA_SEARCH_OUTCOME_SHADOW_V1=1) — มิเรอร์ route.js
//   aggregate counters ต่อ (queryIndex, provider) · bound 32 rows/16 KiB UTF-8 · pure · fail-closed descriptor-only sanitizer
const _OS_MAX_ROWS = 32;
const _OS_MAX_BYTES = 16 * 1024;
const _OS_KEYSEP = String.fromCharCode(0); // ตัวคั่น tuple (NUL runtime) — source ไม่มี NUL literal · ชน provider/int ไม่ได้
const _OS_COUNTERS = ['raw', 'sourceBlocked', 'inCallDuplicate', 'capSkipped', 'existingDuplicate', 'vetted', 'relevant', 'irrelevant', 'failed', 'freshPersisted', 'rank1_5', 'rank6_10', 'rank11_20'];
function _osOwnVal(obj, key) { // own DATA descriptor เท่านั้น · accessor/exotic/throw = { bad:true } (ไม่เรียก getter)
  try {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return { has: false };
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d) return { has: false };
    if (!('value' in d)) return { bad: true };
    return { has: true, value: d.value };
  } catch { return { bad: true }; }
}
function _osUrlOf(obj, box) { const v = _osOwnVal(obj, 'imageUrl'); if (v.bad) { box.fail = true; return null; } return v.has && typeof v.value === 'string' && v.value ? v.value : null; }
function _osRow(rows, qi, provider) {
  const key = qi + _OS_KEYSEP + provider;
  let r = rows.get(key);
  if (!r) { r = { queryIndex: qi, provider }; for (const c of _OS_COUNTERS) r[c] = 0; rows.set(key, r); }
  return r;
}
// เก็บ "ทุก occurrence" ของ url จัดกลุ่มตาม (queryIndex, provider) เก็บ best/min normalized rank ต่อกลุ่ม (ห้าม overwrite ข้ามคำค้น)
function _osOcc(os, url, qi, provider, rank) {
  let g = os.occ.get(url); if (!g) { g = new Map(); os.occ.set(url, g); }
  const qk = qi + _OS_KEYSEP + provider;
  const ex = g.get(qk);
  if (!ex || rank < ex.providerRank) g.set(qk, { queryIndex: qi, provider, providerRank: rank });
}
// mirror route _osBlocked — occurrence ที่ยังไม่ผ่าน source-blocker ก่อน _osOcc (gap dup branch fire ก่อน blocker) → ตรวจ eligibility เองแบบ pure
//   ห้าม record occ (=รับ verdict join) ให้ occurrence ที่ source-blocked โดย metadata ตัวเอง แม้ imageUrl ซ้ำกับใบสะอาด (source/title/link คนละใบ)
//   descriptor-safe อ่าน own DATA เฉพาะ 4 field (imageUrl/source/sourceLink/title) · ยอมรับเฉพาะ string/null/undefined · อื่นๆ → os.fail (fail-closed) · plain object เรียก blocker (ไม่แตะ getter/proxy)
function _osBlocked(im, os, B) {
  if (!im || typeof im !== 'object') { os.fail = true; return true; }
  let proto;
  try { proto = Object.getPrototypeOf(im); } catch { os.fail = true; return true; } // Proxy getPrototypeOf trap throw → fail-closed (exception ไม่ escape เข้า business response)
  if (proto !== Object.prototype && proto !== null) { os.fail = true; return true; } // custom/exotic prototype → fail-closed (blocker เห็น inherited field แต่ descriptor-read มองไม่เห็น)
  const plain = {};
  for (const f of ['imageUrl', 'source', 'sourceLink', 'title']) {
    const d = _osOwnVal(im, f);
    if (d.bad) { os.fail = true; return true; } // own accessor/exotic descriptor (descriptor-only, throw=bad)
    if (d.has) { const v = d.value; if (typeof v === 'string') plain[f] = v; else if (v !== null && v !== undefined) { os.fail = true; return true; } }
    else if (proto === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, f); } catch { os.fail = true; return true; } if (pd) { os.fail = true; return true; } } // ไม่มี own → เช็ค Object.prototype pollution ตรงๆ (ไม่แตะ im เลย: ไม่มี in/get/has trap · proto=null = ไม่มี inherited)
  }
  try { return B.isCatalogSource(plain) || B.isOwnPageSource(plain) || B.isMismatchedFbMedia(plain); } catch { os.fail = true; return true; }
}
// fail-closed อ่าน verdict it.triage.relevant — mirror _osBlocked: plain/null proto ทั้ง it และ triage + Object.prototype pollution → os.fail · descriptor-only (ไม่เรียก getter/has/in)
function _osTriageOf(it, os) {
  if (it === null || it === undefined) return undefined;
  if (typeof it === 'function') { os.fail = true; return undefined; } // function-valued vetted row → fail-closed (ก่อน proto check)
  if (typeof it !== 'object') return undefined; // primitive → no verdict (benign)
  let ip; try { ip = Object.getPrototypeOf(it); } catch { os.fail = true; return undefined; }
  if (ip !== Object.prototype && ip !== null) { os.fail = true; return undefined; }
  const td = _osOwnVal(it, 'triage');
  if (td.bad) { os.fail = true; return undefined; }
  if (!td.has) { if (ip === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, 'triage'); } catch { os.fail = true; return undefined; } if (pd) { os.fail = true; return undefined; } } return undefined; }
  const tri = td.value;
  if (typeof tri === 'function') { os.fail = true; return undefined; } // function triage → fail-closed (ก่อน proto check)
  if (!tri || typeof tri !== 'object') return undefined; // triage present แต่ไม่ใช่ object → no-verdict (failed)
  let tp; try { tp = Object.getPrototypeOf(tri); } catch { os.fail = true; return undefined; }
  if (tp !== Object.prototype && tp !== null) { os.fail = true; return undefined; }
  const rd = _osOwnVal(tri, 'relevant');
  if (rd.bad) { os.fail = true; return undefined; }
  if (!rd.has) { if (tp === Object.prototype) { let pd; try { pd = Object.getOwnPropertyDescriptor(Object.prototype, 'relevant'); } catch { os.fail = true; return undefined; } if (pd) { os.fail = true; return undefined; } } return undefined; }
  return rd.value;
}
function _osFreshUrls(saved, box) {
  const imD = _osOwnVal(saved, 'images'); if (imD.bad || !imD.has) { box.fail = true; return null; }
  const all = imD.value; if (!Array.isArray(all) || Object.getPrototypeOf(all) !== Array.prototype) { box.fail = true; return null; }
  const lenD = _osOwnVal(all, 'length'); if (lenD.bad || !lenD.has || !Number.isSafeInteger(lenD.value) || lenD.value < 0) { box.fail = true; return null; }
  const len = lenD.value;
  const adD = _osOwnVal(saved, 'added'); if (adD.bad || !adD.has) { box.fail = true; return null; }
  const addedN = adD.value; if (!Number.isSafeInteger(addedN) || addedN < 0 || addedN > len) { box.fail = true; return null; } // added>len ห้าม clamp เข้า historical
  const urls = [];
  for (let i = len - addedN; i < len; i++) {
    const eD = _osOwnVal(all, i); if (eD.bad || !eD.has) { box.fail = true; return null; } // hole/accessor
    const img = eD.value; if (!img || typeof img !== 'object' || Array.isArray(img)) { box.fail = true; return null; }
    const uD = _osOwnVal(img, 'imageUrl'); if (uD.bad || !uD.has || typeof uD.value !== 'string') { box.fail = true; return null; }
    urls.push(uD.value);
  }
  return { ok: true, urls };
}
function _sanitizeSearchOutcomeShadowV1(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null;
    const top = new Map();
    for (const k of Reflect.ownKeys(raw)) { const d = Object.getOwnPropertyDescriptor(raw, k); if (!d || !('value' in d)) return null; top.set(k, d.value); }
    const _int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    if (top.get('version') !== 1) return null;
    const rowsTruncated = _int(top.get('rowsTruncated'));
    const capped = top.get('capped');
    if (rowsTruncated === null || typeof capped !== 'boolean') return null;
    if (capped !== (rowsTruncated > 0)) return null; // cap metadata ต้องสอดคล้อง
    const rowsRaw = top.get('rows');
    if (!Array.isArray(rowsRaw) || Object.getPrototypeOf(rowsRaw) !== Array.prototype) return null;
    const lenD = Object.getOwnPropertyDescriptor(rowsRaw, 'length');
    if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return null;
    if (lenD.value > _OS_MAX_ROWS) return null; // bounded work: reject ก่อน iterate row ใดๆ
    const out = [];
    let prev = null;
    for (let i = 0; i < lenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(rowsRaw, i);
      if (!ed || !('value' in ed)) return null;
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const em = new Map();
      for (const k of Reflect.ownKeys(el)) { const dd = Object.getOwnPropertyDescriptor(el, k); if (!dd || !('value' in dd)) return null; em.set(k, dd.value); }
      const queryIndex = _int(em.get('queryIndex'));
      const provider = em.get('provider');
      if (queryIndex === null) return null;
      if (typeof provider !== 'string' || !_V2_PROVIDERS.has(provider)) return null;
      const row = { queryIndex, provider };
      for (const c of _OS_COUNTERS) { const v = _int(em.get(c)); if (v === null) return null; row[c] = v; }
      if (row.vetted !== row.relevant + row.irrelevant + row.failed) return null;
      if (row.rank1_5 + row.rank6_10 + row.rank11_20 > row.relevant) return null;
      if (row.sourceBlocked + row.inCallDuplicate + row.capSkipped > row.raw) return null;
      if (row.vetted > row.raw) return null; // vetted (distinct URL join ต่อแถว) ≤ occurrences ดิบ
      if (row.freshPersisted + row.existingDuplicate > row.raw) return null; // canonical persistence ต่อแถว ≤ raw
      const cmp = prev === null ? 1 : ((row.queryIndex - prev.queryIndex) || (row.provider < prev.provider ? -1 : row.provider > prev.provider ? 1 : 0));
      if (cmp <= 0) return null; // unique + canonical-sorted
      prev = row;
      out.push(row);
    }
    const carrier = { version: 1, rows: out, rowsTruncated, capped };
    if (_v2bytes(JSON.stringify(carrier)) > _OS_MAX_BYTES) return null;
    return carrier;
  } catch { return null; }
}
function _buildSearchOutcomeShadowV1(rowsIn) {
  try {
    // descriptor-only normalize input ก่อน filter/sort/map (exported → hostile-safe: getter invocation 0, malformed → null)
    if (!Array.isArray(rowsIn) || Object.getPrototypeOf(rowsIn) !== Array.prototype) return null;
    const inLenD = Object.getOwnPropertyDescriptor(rowsIn, 'length');
    if (!inLenD || !('value' in inLenD) || !Number.isSafeInteger(inLenD.value) || inLenD.value < 0) return null;
    if (inLenD.value > 4096) return null; // bounded work ก่อน iterate (DoS guard — producer จริง ≪ นี้)
    const norm = [];
    for (let i = 0; i < inLenD.value; i++) {
      const ed = Object.getOwnPropertyDescriptor(rowsIn, i);
      if (!ed || !('value' in ed)) return null; // hole/accessor element
      const el = ed.value;
      if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
      const pe = Object.getPrototypeOf(el);
      if (pe !== Object.prototype && pe !== null) return null;
      const qd = Object.getOwnPropertyDescriptor(el, 'queryIndex'); if (!qd || !('value' in qd) || !Number.isSafeInteger(qd.value) || qd.value < 0) return null; // scalar-validate ก่อน sort (กัน valueOf/coerce)
      const pd = Object.getOwnPropertyDescriptor(el, 'provider'); if (!pd || !('value' in pd) || typeof pd.value !== 'string' || !_V2_PROVIDERS.has(pd.value)) return null; // provider ต้อง string + allowlisted (non-allowlisted = reject ที่ extraction ไม่ filter เงียบ · กัน '<' coercion)
      const row = { queryIndex: qd.value, provider: pd.value };
      for (const c of _OS_COUNTERS) { const cd = Object.getOwnPropertyDescriptor(el, c); if (cd && (!('value' in cd) || !Number.isSafeInteger(cd.value) || cd.value < 0)) return null; row[c] = cd ? cd.value : 0; }
      norm.push(row);
    }
    const list = norm; // provider ผ่าน allowlist ตั้งแต่ descriptor extraction แล้ว (reject ทั้ง carrier ถ้าไม่ allowlisted — ไม่ filter เงียบ)
    list.sort((a, b) => (a.queryIndex - b.queryIndex) || (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
    const total = list.length;
    let rows = list.slice(0, _OS_MAX_ROWS);
    const mk = (arr) => ({ version: 1, rows: arr.map((r) => { const o = { queryIndex: r.queryIndex, provider: r.provider }; for (const c of _OS_COUNTERS) o[c] = r[c] || 0; return o; }), rowsTruncated: total - arr.length, capped: total - arr.length > 0 });
    while (rows.length > 0 && _v2bytes(JSON.stringify(mk(rows))) > _OS_MAX_BYTES) rows = rows.slice(0, rows.length - 1);
    return _sanitizeSearchOutcomeShadowV1(mk(rows));
  } catch { return null; }
}

// ---------- S5c ค้นภาพ 4 แหล่ง — ทีละแหล่งต่อ 1 tick (กันชน timeout ของ tick) ----------
// ห้ามคืน status:'done' ระหว่างยังไม่ครบทุกแหล่ง — done จะโดน idempotency นับ "เคยสำเร็จ" แล้วข้ามแหล่งที่เหลือ
export async function s5_search(job, { origin, _deps }) {
  const _jf = _deps?.fetchJson || jfetch; // ★ test seam (เหมือน s6/s7) — prod ไม่ส่ง _deps = jfetch เดิมทุก byte
  const provenanceOn = process.env.MEGA_SEARCH_PROVENANCE === '1'; // 🔎 snapshot ครั้งเดียวก่อน await
  const shadowV2On = process.env.MEGA_SEARCH_SHADOW_V2 === '1';    // 🔎 V2 snapshot อิสระ ก่อน await
  const outcomeOn = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 === '1'; // 🔎 OS snapshot อิสระ ก่อน await
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
    const r = await _jf(`${origin}/api/images/search`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, platform: next }) }, 480000); // ★ 7 ก.ค.: 5→8 นาที (search+EyeScreen ต่อแหล่งแตะ 5 นาทีได้ → เดิม abort พอดี)
    // 🔎 Search Provenance V1 (ON เท่านั้น + fail-closed) — แนบ 6 ตัวนับจาก response เข้า stat เดียวกัน
    //   propagate ทั้ง success stat และ error stat (attempted failure ที่ route แนบ provenance มา — P1-3)
    const _prov = provenanceOn ? _sanitizeSearchProv(r.provenance) : null;
    // 🔎 Search V2 shadow — อ่าน carrier ผ่าน own data descriptor เท่านั้น (กัน getter/proxy trap ของ r) · nest ใน stat เดิม · success only
    let _shadow = null;
    if (shadowV2On) { try { const _sd = Object.getOwnPropertyDescriptor(r, 'searchShadowV2'); if (_sd && 'value' in _sd) _shadow = _sanitizeSearchShadowV2(_sd.value); } catch { _shadow = null; } }
    // 🔎 Outcome Shadow V1 — อ่านผ่าน own data descriptor เท่านั้น · nest ใน stat เดิม (ห้ามสร้าง row) · success only
    let _outcome = null;
    if (outcomeOn) { try { const _od = Object.getOwnPropertyDescriptor(r, 'searchOutcomeShadowV1'); if (_od && 'value' in _od) _outcome = _sanitizeSearchOutcomeShadowV1(_od.value); } catch { _outcome = null; } }
    const stat = r.success
      ? { platform: next, found: r.found || 0, added: r.added || 0, vetDropped: r.vetDropped || 0, ...(_prov ? { provenance: _prov } : {}), ...(_shadow ? { searchShadowV2: _shadow } : {}), ...(_outcome ? { searchOutcomeShadowV1: _outcome } : {}) }
      : { platform: next, error: (r.error || String(r.httpStatus)).slice(0, 80), ...(_prov ? { provenance: _prov } : {}) };
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
export async function s5_gapsearch(job, { origin, _deps } = {}) {
  const _jf = _deps?.fetchJson || jfetch; // ★ test seam — prod ไม่ส่ง _deps = jfetch เดิมทุก byte
  const provenanceOn = process.env.MEGA_SEARCH_PROVENANCE === '1'; // 🔎 snapshot ครั้งเดียวก่อน await
  const shadowV2On = process.env.MEGA_SEARCH_SHADOW_V2 === '1';    // 🔎 V2 snapshot อิสระ ก่อน await
  const _v2attr = shadowV2On ? new Map() : null;                   // 🔎 V2 attribution: imageUrl→provider/queryIndex/providerRank
  const outcomeOn = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 === '1'; // 🔎 OS snapshot อิสระ ก่อน await
  //   collector: rows + first (canonical collected occ → existingDuplicate/freshPersisted) + occ (ทุก occurrence จัดกลุ่ม (queryIndex,provider) best/min rank → URL-verdict join ทุกกลุ่ม) + lib/osSeen (gap dedup-parity)
  const _os = outcomeOn ? { rows: new Map(), first: new Map(), occ: new Map(), lib: null, osSeen: new Set(), fail: false } : null;
  const im = job.dossier.images || {};
  if (!GAP_SEARCH_ON) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ปิดอยู่ (IMG_GAP_SEARCH=0) — ข้าม' };
  if (im.gapSearchDone) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ทำแล้ว — ข้าม' };
  if (!im.caseId) return { status: 'done', nextAction: 'continue', summary: 'ค้นรอบสอง: ไม่มีเคสภาพ — ข้าม' };

  let libImages = [];
  try {
    const lib = await _jf(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
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
  // 🔎 Search Provenance V1 (gap round) — hoist ให้ success/failure return อ่านได้ (collected อยู่ใน try)
  let provQueriesFired = 0, provUrlsReturned = 0, provUrlsVetted = 0, provVetKept = null, provVetDropped = 0, provVetFailed = 0;
  let gapShadowV2 = null; // 🔎 V2 sidecar (ON+valid เท่านั้น) — build หลัง addImages, อ่านที่ success return
  let gapOutcome = null;  // 🔎 OS sidecar (ON+valid เท่านั้น) — build หลัง collect+vet+persist
  try {
    const { searchImages } = await import('@/lib/imageSearch');
    const { isCatalogSource, isOwnPageSource, isMismatchedFbMedia } = await import('@/lib/junkSources');
    const _osBlk = { isCatalogSource, isOwnPageSource, isMismatchedFbMedia }; // 🔎 OS: ส่งให้ _osBlocked (blockers import แบบ dynamic ในฟังก์ชัน ไม่ได้อยู่ module scope)
    const { vetImages } = await import('@/lib/libraryTriage');
    const { addImages } = await import('@/lib/imageStore');
    const { getCase } = await import('@/lib/caseStore');

    const collected = [];
    const seen = new Set(libImages.map((x) => x.imageUrl));
    if (_os) _os.lib = new Set(seen); // 🔎 OS: snapshot lib URLs (gap seen รวม lib) → แยก existingDuplicate (first) จาก inCallDuplicate (later)
    for (let _v2qi = 0; _v2qi < newQueries.length; _v2qi++) {
      const q = newQueries[_v2qi];
      for (const platform of ['google', 'google_news']) {
        provQueriesFired++; // 🔎 ยิงคำค้นจริง (รวมที่ล้ม)
        try {
          const imgs = await searchImages(platform, q, { num: 15, caseId: im.caseId });
          provUrlsReturned += imgs.length; // 🔎 ดิบก่อนกรอง (เฉพาะคำค้นที่คืนสำเร็จ)
          if (_os && !_os.fail) _osRow(_os.rows, _v2qi, platform).raw += imgs.length; // 🔎 OS: raw (gap ไม่มี cap → capSkipped=0)
          let _v2rank = 0; // 🔎 V2: rank ดิบ 1-based ก่อน filter/dedup (ห้าม renumber)
          for (const x of imgs) {
            _v2rank++;
            let _osUrl = null;
            if (_os && !_os.fail) _osUrl = _osUrlOf(x, _os); // 🔎 OS: descriptor-safe url (occ บันทึกเฉพาะ occurrence ที่ eligible ด้านล่าง — ไม่รวม source-blocked)
            if (!x.imageUrl || seen.has(x.imageUrl)) {
              if (_os && !_os.fail && _osUrl) { const blk = _osBlocked(x, _os, _osBlk); if (!_os.fail) { const r = _osRow(_os.rows, _v2qi, platform); if (!_os.osSeen.has(_osUrl)) { if (blk) { r.sourceBlocked++; /* ไม่ mark osSeen: blocked occ ที่ยังไม่ถูก collect สะอาด → sourceBlocked ซ้ำได้ (parity route ไม่ add blocked URL เข้า seen) */ } else { if (_os.lib.has(_osUrl)) r.existingDuplicate++; else r.inCallDuplicate++; _osOcc(_os, _osUrl, _v2qi, platform, _v2rank); _os.osSeen.add(_osUrl); } } else { r.inCallDuplicate++; if (!blk) _osOcc(_os, _osUrl, _v2qi, platform, _v2rank); } } } // 🔎 OS: osSeen(=collect สะอาดแล้ว) → inCallDuplicate เสมอ (parity route dup branch) · ยังไม่ osSeen: blocked=sourceBlocked(ไม่ add), clean stored=existingDuplicate first + occ
              continue;
            }
            if (isCatalogSource(x) || isOwnPageSource(x) || isMismatchedFbMedia(x)) { if (_os && !_os.fail) _osRow(_os.rows, _v2qi, platform).sourceBlocked++; continue; } // source-blocked = ไม่ record occ (ไม่รับ vet verdict)
            seen.add(x.imageUrl);
            collected.push({ ...x, platform, query: q });
            if (_v2attr) _v2attr.set(x.imageUrl, { queryIndex: _v2qi, provider: platform, providerRank: _v2rank }); // first attribution
            if (_os && !_os.fail && _osUrl) { _os.first.set(_osUrl, { queryIndex: _v2qi, provider: platform, providerRank: _v2rank }); _os.osSeen.add(_osUrl); _osOcc(_os, _osUrl, _v2qi, platform, _v2rank); } // 🔎 OS: canonical first/collected occ + mark osSeen + record occ
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
      provUrlsVetted = collected.length; // 🔎 ส่งเข้า vet จริง
      try {
        const { vetted, kept, dropped, failed } = await vetImages({ images: collected, subjects, newsGist, caseId: im.caseId });
        const anyTag = vetted.some((x) => x.triage);
        toStore = anyTag ? vetted.filter((x) => x.triage?.relevant !== false) : vetted;
        vetDropped = collected.length - toStore.length; // legacy — คงเดิม (ใช้ใน summary)
        provVetKept = kept; provVetDropped = dropped; provVetFailed = failed; // 🔎 classifier จริง จาก vetImages
        if (_os && !_os.fail) { try { for (const it of vetted) { const u = _osUrlOf(it, _os); if (_os.fail) break; if (!u) continue; const g = _os.occ.get(u); if (!g) continue; const rel = _osTriageOf(it, _os); if (_os.fail) break; for (const a of g.values()) { const r = _osRow(_os.rows, a.queryIndex, a.provider); r.vetted++; if (rel === true) { r.relevant++; const rk = a.providerRank; if (rk >= 1 && rk <= 5) r.rank1_5++; else if (rk <= 10) r.rank6_10++; else if (rk <= 20) r.rank11_20++; } else if (rel === false) r.irrelevant++; else r.failed++; } } } catch { _os.fail = true; } } // 🔎 OS: URL-verdict join — propagate ไปทุก (queryIndex,provider) occurrence (best/min rank ต่อกลุ่ม) · อาจซ้อน inCallDuplicate
      } catch { provVetFailed = collected.length; /* ตาล้ม → เก็บดิบไปก่อน; execution failure ทั้ง N (kept=null, dropped=0) */
        if (_os && !_os.fail) { try { for (const x of collected) { const u = _osUrlOf(x, _os); if (_os.fail) break; if (!u) continue; const g = _os.occ.get(u); if (!g) continue; for (const a of g.values()) { const r = _osRow(_os.rows, a.queryIndex, a.provider); r.vetted++; r.failed++; } } } catch { _os.fail = true; } } // 🔎 OS: vet throw = failed (join ทุก occurrence)
      }
      const saved = await addImages(im.caseId, toStore);
      added = saved.added || 0;
      // 🔎 Search V2 shadow — join id ที่เพิ่ง persist (N ใบท้าย) → provider/queryIndex/providerRank (ON เท่านั้น · pure)
      if (shadowV2On) gapShadowV2 = _buildSearchShadowV2FromSaved(saved, _v2attr);
      // 🔎 Outcome Shadow V1 — descriptor-safe fresh-suffix → freshPersisted (via canonical first) + late add-time dedup → existingDuplicate (via canonical first)
      if (_os && !_os.fail) { try {
        const _toUrls = [];
        for (const it of toStore) { const u = _osUrlOf(it, _os); if (_os.fail) break; if (u) _toUrls.push(u); }
        const _fr = _os.fail ? null : _osFreshUrls(saved, _os);
        if (!_os.fail && _fr) {
          const _freshSet = new Set(_fr.urls);
          for (const url of _fr.urls) { const a = _os.first.get(url); if (a) _osRow(_os.rows, a.queryIndex, a.provider).freshPersisted++; else { _os.fail = true; break; } } // 🔎 OS: freshPersisted = canonical first/collected occ เท่านั้น
          if (!_os.fail) for (const url of _toUrls) if (!_freshSet.has(url)) { const a = _os.first.get(url); if (a) _osRow(_os.rows, a.queryIndex, a.provider).existingDuplicate++; else { _os.fail = true; break; } }
        }
      } catch { _os.fail = true; } }
    }
    if (_os && !_os.fail) gapOutcome = _buildSearchOutcomeShadowV1([..._os.rows.values()]); // 🔎 OS: build carrier หลัง collect+vet+persist (รวมเคส collected=0 ที่มีแต่ raw/blocked/dup)
  } catch (err) {
    // ★ Wave2 B1: ยิงล้ม (แต่ toStore อาจมีบางส่วนที่เข้าคลังไปแล้วก่อนล้ม) → รวม libImages+toStore ให้ gate เห็นของจริงที่สุด
    // 🔎 outer failure ที่มี attempt วัดได้ → เก็บ gap sidecar (ON) เท่าที่นับได้จริง ณ จุดล้ม (ไม่เปลี่ยน status/summary เดิม)
    const _gapProvErr = provenanceOn
      ? _sanitizeSearchProv({ queriesFired: provQueriesFired, urlsReturned: provUrlsReturned, urlsVetted: provUrlsVetted, vetKept: provVetKept, vetDropped: provVetDropped, vetFailed: provVetFailed })
      : null;
    return _endGapSearch(job, [...libImages, ...toStore], {
      status: 'done',
      nextAction: 'continue',
      summary: `ค้นรอบสอง: ขาด ${gapDesc} → ได้คำค้นใหม่ ${newQueries.length} คำ แต่ยิงล้ม (${String(err?.message || '').slice(0, 50)}) — ข้าม`,
      dossierPatch: { images: { ...im, gapSearchDone: true, gapSearchQueries: newQueries, ...(_gapProvErr ? { gapSearchProvenance: _gapProvErr } : {}) } },
      quality: 'yellow',
    });
  }

  // ★ Wave2 B1: จบรอบค้นเสริมสำเร็จ — เช็ค hard gate ด้วยคลังล่าสุด (ของเดิม + ที่เพิ่งเก็บเพิ่มรอบนี้)
  // 🔎 Search Provenance V1 (ON เท่านั้น + fail-closed) — sibling แยก images.gapSearchProvenance (ไม่ใช่ searchStats!)
  //   ห้ามยัดเข้า searchStats: นั่นคือ control data ของ s5_search (totalAdded/anyOk/failedAll/status/summary/replay)
  //   OFF = ไม่มี key นี้เลย · เขียนครั้งเดียวคู่ gapSearchDone · ไม่เข้า queue/spec/hash (payload S7 = curated subset)
  //   vetDropped = classifier จริง (provVetDropped) ไม่ใช่ legacy subtraction
  const _gapProv = provenanceOn
    ? _sanitizeSearchProv({ queriesFired: provQueriesFired, urlsReturned: provUrlsReturned, urlsVetted: provUrlsVetted, vetKept: provVetKept, vetDropped: provVetDropped, vetFailed: provVetFailed })
    : null;
  return _endGapSearch(job, [...libImages, ...toStore], {
    status: 'done',
    nextAction: 'continue',
    summary: `ค้นรอบสอง: ขาด ${gapDesc} → คำค้นใหม่ ${newQueries.length} คำ → เก็บเพิ่ม ${added} ใบ (ตากรองทิ้ง ${vetDropped}${errs.length ? ` · ล้ม ${errs.length} แหล่งย่อย` : ''})`,
    dossierPatch: { images: { ...im, gapSearchDone: true, gapSearchAdded: added, gapSearchQueries: newQueries, ...(_gapProv ? { gapSearchProvenance: _gapProv } : {}), ...(gapShadowV2 ? { gapSearchShadowV2: gapShadowV2 } : {}), ...(gapOutcome ? { gapSearchOutcomeShadowV1: gapOutcome } : {}) } },
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
// ★ LANE-C (item 3): export ตรงๆ ของ hash fn เดิม (pure re-export, zero behavior change) — ให้ฝั่ง route ใช้ทำ refMatch parity เดียวกับ S6/S7
export function _dnaHashFor(dna) {
  try {
    let h = 0x811c9dc5;
    const s = JSON.stringify(dna || {});
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return (h >>> 0).toString(16);
  } catch { return null; }
}

// ★ D3-B2.1 (Codex P0): ตัว validator/comparator/echo ของ refShotAuthority marker "ตัวเดียว" ใช้ทั้ง S6/S7/s7_wait
//   plain object แท้ (proto = Object.prototype|null) · OWN keys เป๊ะ [axis,effectiveViewHash,mode,v] ไม่มีเกิน/สืบทอด ·
//   own undefined = corrupt (value check ล้ม) · v/mode/axis เป๊ะ · hash = 8-lowerhex เท่านั้น
const REFSHOT_MARKER_KEYS = ['axis', 'effectiveViewHash', 'mode', 'v'];
// ★ D3-B2.2 (Codex P1): safe-normalizer เดียว — try/catch ครอบทั้งหมด (Reflect/Proxy throw = invalid)
//   plain proto · Reflect.ownKeys = 4 string keys ที่คาดเป๊ะ (reject symbol/extra/non-enumerable) ·
//   ทุก key = enumerable DATA descriptor (no get/set) · validate จาก descriptor.value เท่านั้น
//   คืนค่า normalized {v,mode,axis,effectiveViewHash} เมื่อ valid · null เมื่อ invalid
function normalizeRefShotMarker(m) {
  try {
    if (m == null || typeof m !== 'object') return null;
    const proto = Object.getPrototypeOf(m);
    if (proto !== Object.prototype && proto !== null) return null;
    const ownKeys = Reflect.ownKeys(m); // รวม symbol + non-enumerable
    if (ownKeys.length !== REFSHOT_MARKER_KEYS.length) return null;
    for (const k of ownKeys) { if (typeof k !== 'string' || !REFSHOT_MARKER_KEYS.includes(k)) return null; }
    const descs = Object.getOwnPropertyDescriptors(m);
    const out = {};
    for (const k of REFSHOT_MARKER_KEYS) {
      const d = descs[k];
      if (!d || !d.enumerable || typeof d.get === 'function' || typeof d.set === 'function' || !('value' in d)) return null;
      out[k] = d.value;
    }
    if (out.v !== 1 || out.mode !== 'template_v1' || out.axis !== 'template.slots') return null;
    if (typeof out.effectiveViewHash !== 'string' || !/^[0-9a-f]{8}$/.test(out.effectiveViewHash)) return null;
    return { v: out.v, mode: out.mode, axis: out.axis, effectiveViewHash: out.effectiveViewHash };
  } catch { return null; }
}
// ★ D3-B2.5 (Codex P1 fail-closed): อ่าน marker "ที่ระดับ property ของ carrier" ผ่าน descriptor ล้วน — ห้าม container[key]
//   เหตุ: container[key] จะ "รัน" getter บน carrier / ปล่อย throwing-Proxy หลุด · และ property แบบ non-enumerable
//   ผ่านตอนอ่าน แต่ "หาย" ตอน JSON persist → tick หน้าเห็นคู่ marker ไม่ตรง/หาย = ไหลลง legacy เงียบ
//   กติกา (ทั้งก้อนใน try/catch): null/non-object/ไม่มี descriptor = absent (legacy จริง) ·
//   descriptor/trap throw หรือ descriptor เป็น non-enumerable/accessor(get|set)/ไม่มี data value
//   = present:true, marker:null (corrupt → HOLD ห้ามดู absent/legacy) · enumerable DATA descriptor เท่านั้น
//   = normalize(descriptor.value) ครั้งเดียว (คืน canonical|null) · caller cache canonical เหมือนเดิม
function readRefShotMarker(container, key) {
  if (!container || typeof container !== 'object') return { present: false, marker: null };
  try {
    const d = Object.getOwnPropertyDescriptor(container, key); // ไม่แตะ [[Get]] — ไม่รัน getter บน carrier
    if (!d) return { present: false, marker: null }; // ไม่มี property = absent (legacy/fresh)
    // มี property แต่ไม่ใช่ enumerable data descriptor = corrupt (getter/setter/non-enum/no-value) → present + HOLD
    if (!d.enumerable || typeof d.get === 'function' || typeof d.set === 'function' || !('value' in d)) {
      return { present: true, marker: null };
    }
    return { present: true, marker: normalizeRefShotMarker(d.value) }; // normalize descriptor.value ครั้งเดียว
  } catch {
    return { present: true, marker: null }; // descriptor/trap throw = carrier พัง → HOLD (fail-closed, ห้ามดู absent)
  }
}
// เทียบ "canonical snapshot" ที่ normalize มาแล้ว (ไม่อ่าน raw ซ้ำ)
function canonicalMarkersEqual(a, b) {
  return !!a && !!b && a.v === b.v && a.mode === b.mode && a.axis === b.axis && a.effectiveViewHash === b.effectiveViewHash;
}
// clone canonical (รับ canonical snapshot คืน plain clone — ไม่แตะ raw)
function cloneRefShotMarker(n) {
  return n ? { v: n.v, mode: n.mode, axis: n.axis, effectiveViewHash: n.effectiveViewHash } : null;
}
// ★ D3-B2.6 (Codex P1): เขียน canonical marker กลับ carrier แบบ "ยืนยันผลจริง" — carrier frozen/non-writable หรือ
//   Proxy ที่ set trap throw/"โกหก" (คืน true แต่ไม่เซ็ต) ต้องไม่หลุด S6 · คืน boolean เสมอ ไม่ throw
//   ยืนยัน: หลังเขียน ต้องอ่าน own descriptor กลับได้เป็น enumerable DATA property ที่ value === clone ที่เพิ่งเขียนเป๊ะ
//   (swallow/lying write = value identity ไม่ตรง = false) → caller HOLD ก่อน slotDirector/queue ห้ามถอย legacy
function _writeBackRefShotMarker(container, key, clone) {
  try {
    if (!container || typeof container !== 'object' || !clone) return false;
    container[key] = clone; // strict mode: frozen/non-writable = throw · Proxy set-trap throw = throw (จับด้านล่าง)
    const d = Object.getOwnPropertyDescriptor(container, key);
    return !!d && d.enumerable === true && typeof d.get !== 'function' && typeof d.set !== 'function'
      && 'value' in d && d.value === clone; // identity เป๊ะ — swallowed/lying write = value ไม่ตรง = false
  } catch {
    return false;
  }
}
// ★ D3-B3 (Codex): ตรวจ personHint ทุก order บท hero/main/reaction เทียบ current-person authority (helper เดียวกับ brain)
//   valid ต่อ order: (persisted==null && expected==null) OR (ทั้งคู่ non-null && ชื่อตรง canonical) — อื่น = invalid
//   (persisted!=null & expected==null = unknown/ประดิษฐ์ · persisted==null & expected!=null = ขาด canonical) ·
//   ตรวจ "ทุก" order เป้าหมายที่มีจริง (ไม่ใช่ตัวแรก) · order ที่ไม่มี = ไม่บังคับ (contract คุม structure fail-closed เอง)
// ★ D3-B3.3 (Codex TOCTOU): snapshot 1 order → plain scalar object ครั้งเดียว (อ่านค่าจาก descriptor รวดเดียว) ·
//   reject: ไม่ใช่ plain object · symbol key · accessor (get/set) · ค่าไม่ใช่ scalar (nested object/function) →
//   คืน null · downstream ได้ plain data ที่ getter/Proxy re-read ไม่ได้อีก (ไม่มี channel raw หลงเหลือ)
function _plainScalarSnapshot(o) {
  if (!o || typeof o !== 'object') return null;
  const proto = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) return null; // non-plain (Date/class/etc)
  const descs = Object.getOwnPropertyDescriptors(o); // single pass — Proxy trap ยิงครั้งเดียว, ค่าถูก capture ที่นี่
  const out = {};
  for (const k of Reflect.ownKeys(descs)) {
    if (typeof k !== 'string') return null; // symbol key
    const d = descs[k];
    if (!d.enumerable) continue;
    if (typeof d.get === 'function' || typeof d.set === 'function' || !('value' in d)) return null; // accessor
    const v = d.value;
    // ★ D3-B3.4 (Codex): JSON-safe scalar เท่านั้น — null | string | boolean | finite number
    //   reject: undefined, bigint, symbol, NaN, ±Infinity, function, nested object (กัน serialize throw/drift null/หายเงียบ)
    if (v === null || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else return null;
  }
  return out;
}
// ★ D3-B3.3 (Codex): VALIDATE ONCE → PLAIN SNAPSHOT → คืน {ok, orders(snapshot), storyNote} · downstream ต้องใช้ snapshot นี้เท่านั้น
//   อ่าน compass/brief/orders "ภายใน try" (throwing getter บน carrier/compass/orders = false ไม่หลุด s6) ·
//   orders อ่านจาก descriptor (accessor orders = reject ไม่ยิง getter) · แต่ละ order snapshot เป็น plain scalar ครั้งเดียว ·
//   expected target rows = hero/main/reaction จาก resolveRefSlotView(refDNA) (read-only) — ไม่เชื่อ role จาก order ปลอม ·
//   presence exactly-one (index+role) + no-extra target-role + strict integer index + unique-canonical personHint = valid
function _validatePersonSnapshot(getCompass, getArtBrief, refDNA) {
  const FAIL = { ok: false, orders: null, storyNote: '' };
  try {
    const compass = getCompass();
    const brief = getArtBrief();
    if (!brief || typeof brief !== 'object') return FAIL;
    const od = Object.getOwnPropertyDescriptor(brief, 'orders'); // descriptor: accessor = reject (ไม่ยิง getter)
    if (!od || typeof od.get === 'function' || typeof od.set === 'function' || !('value' in od) || !Array.isArray(od.value)) return FAIL;
    const snap = [];
    for (const o of od.value) {
      const p = _plainScalarSnapshot(o); // อ่าน field ดิบครั้งเดียว → plain
      if (p == null) return FAIL;
      snap.push(p);
    }
    const sd = Object.getOwnPropertyDescriptor(brief, 'storyNote');
    const storyNote = (sd && typeof sd.get !== 'function' && 'value' in sd && typeof sd.value === 'string') ? sd.value : '';
    const view = resolveRefSlotView(refDNA, { mode: 'template_v1' });
    const targets = (Array.isArray(view?.views) ? view.views : []).filter((v) => v.role === 'hero' || v.role === 'main' || v.role === 'reaction');
    const auth = templateV1PersonAuthority(compass);
    // ★ D3-B4 P1-A (Codex): data-readiness gate — ถ้า authority กำกวม (hero/non-hero bridge) = waiting ก่อนรับ target row ใดๆ
    //   (กัน hero กำกวมหลุดเข้า contract/slotDirector แม้ reaction จะมี candidate อิสระที่ resolve ได้) ·
    //   compass ว่าง/ไม่มี hero โดยไม่มี bridge = authorityReady=true → คงพฤติกรรมเดิม (ไม่แปลง missing เป็น ambiguity)
    if (auth.authorityReady === false) return FAIL;
    const idxOf = (o) => (Number.isInteger(o.i) ? o.i : null); // strict integer (snap plain — ห้าม coercion ''/null/false)
    const roleOf = (o) => String(o.role ?? '').trim().toLowerCase();
    // pass 1 (presence): ทุก expected target ต้องมี snap order คู่ index+role พอดี 1 + personHint ถูก authority
    for (const t of targets) {
      const at = snap.filter((o) => idxOf(o) === t.index);
      if (at.length !== 1) return FAIL; // missing / duplicate
      const o = at[0];
      if (roleOf(o) !== t.role) return FAIL; // relabel/malformed role
      const rawHint = o.personHint;
      const persisted = (rawHint == null || String(rawHint).trim() === '') ? null : String(rawHint).trim();
      const expected = auth.resolveHint(t.role, persisted);
      // ★ D3-B4 (Codex): reaction-only non-null rule (point 6) — reaction target ต้อง resolve non-null ก่อน
      //   contract/slotDirector (null/unresolved = waiting, ไม่ถอย ref subject/legacy) · hero/main คงพฤติกรรมเดิม:
      //   null valid เฉพาะเมื่อ expected==null (ไม่มีตัวตน hero) · มิฉะนั้น FAIL
      if (persisted == null) {
        if (t.role === 'reaction') return FAIL;
        if (expected != null) return FAIL;
        continue;
      }
      const canon = auth.canonicalKnown(persisted); // unique canonical หรือ null (ambiguous/unknown)
      if (expected == null || canon == null || !auth.nameMatch(canon, expected)) return FAIL;
    }
    // pass 2 (no-extra): snap order ที่ role เป็น target ต้องมี canonical row คู่ (index+role exact) — จับ i:99/นอก view
    for (const o of snap) {
      const r = roleOf(o);
      if (r !== 'hero' && r !== 'main' && r !== 'reaction') continue;
      const idx = idxOf(o);
      if (idx == null || !targets.some((t) => t.index === idx && t.role === r)) return FAIL;
    }
    return { ok: true, orders: snap, storyNote };
  } catch {
    return FAIL; // อ่าน/แปลง/helper/view throw ใดๆ = fail-closed (deterministic HOLD ไม่หลุด s6_slots)
  }
}
// ★ D3-B2.1 geometry (contract % และ realized pixel): finite/positive/in-bounds
function _refShotGeomOk(g) {
  if (!g) return false;
  const { xPct, yPct, wPct, hPct } = g;
  return [xPct, yPct, wPct, hPct].every((n) => typeof n === 'number' && Number.isFinite(n))
    && xPct >= 0 && yPct >= 0 && wPct > 0 && hPct > 0 && xPct + wPct <= 100 && yPct + hPct <= 100;
}
function _refShotContractGeomOk(contract) {
  return Array.isArray(contract?.slots) && contract.slots.length >= 3 && contract.slots.every((s) => _refShotGeomOk(s.geometry));
}
function _refShotRealizedOk(realized, contract) {
  // ★ D3-B2.2 (Codex P1): ตรงกับ strict gate — canvas 1080×1350 · count=contract · id nonblank+unique ·
  //   x/y/w/h finite integer · positive size · x/y>=0 · upper<=canvas · shape rect|circle (ถ้ามี)
  if (!realized || !Array.isArray(realized.slots) || !Array.isArray(contract?.slots)) return false;
  if (realized.canvasW !== 1080 || realized.canvasH !== 1350) return false;
  if (realized.slots.length !== contract.slots.length) return false;
  const ids = new Set();
  for (const s of realized.slots) {
    const id = s?.id;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) return false;
    ids.add(id);
    if (![s.x, s.y, s.w, s.h].every((n) => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n))) return false;
    if (!(s.w > 0 && s.h > 0) || s.x < 0 || s.y < 0 || s.x + s.w > 1080 || s.y + s.h > 1350) return false;
    if (s.shape != null && s.shape !== 'rect' && s.shape !== 'circle') return false;
  }
  return true;
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

// ★ D-sidecar (12 ก.ค.): predicate สวิตช์หลักฐานการตัดสินใจ — pure แยกไว้เทส matrix ได้ตรงๆ
//   เปิดเฉพาะค่า string '1' เป๊ะเท่านั้น (number 1 / '1 ' / 'true' / undefined = ปิดหมด)
export const _finalDecisionEvidenceFlag = (v) => v === '1';

// ============================================================
// 🌊 WAVE1A — REF+CAST+HERO V2 flag-gated authority producer  (flag: MEGA_REF_HERO_V2 exact '1', default OFF)
// ------------------------------------------------------------
//   Additive + fail-closed. On the s6 happy path (flag ON only) it runs the four verified PURE
//   foundations — storyReferenceAuthority / castManifest / heroShotContract / semanticGlobalAssignment —
//   over the REAL S5→S6 universe, then assembles the FROZEN selectionAuthority via the refSlotContract
//   Wave1C handshake (buildSelectionAuthorityV1 / validateSelectionAuthorityV1) + exact render bindings,
//   and attaches ONE key: dossierPatch.pickImages.refHeroV2. Flag OFF/absent = zero bytes changed
//   (legacy selection + S7 untouched; the seam block is skipped).
//   INVARIANTS enforced here:
//    • REFERENCE = STRUCTURE ONLY (slot id / shape / order) — subject/eventIntent/wantPerson are never
//      read into current-news identity, candidate ranking, required cast, hero person, or Global input.
//    • CURRENT-NEWS people come from compass (the news analysis) only; requiredness/priority is a
//      deterministic policy over the genuine editorial role (principals hero|reaction = required).
//    • GENUINE measured evidence ONLY — no identityConfidence/isGroupShot/faceShare/headroom/
//      visibleBodyRegion/occlusion/edgeCut/resolution/cleanliness/scores/scene/readiness is ever
//      manufactured; any missing mandatory field ⇒ typed fixed-code HOLD (no partial payload, no
//      legacy fallback under ON). HOLD markers carry a fixed code only — never an attacker-supplied string.
//    • Once returned, the authority + bindings are DEEP-FROZEN — zero post-S6 mutation.
// ============================================================
const REF_HERO_V2_LIMITS = Object.freeze({ maxPersonRepeats: 1, maxSceneRepeats: 1 }); // policy (not evidence)
const REF_HERO_V2_PRINCIPAL_ROLES = Object.freeze(['hero', 'reaction']); // deterministic requiredness policy
const REF_HERO_V2_MAX_SLOTS = 8;      // envelope + Global solver bound (SOLVER_MAX_SLOTS)
const REF_HERO_V2_MAX_CANDIDATES = 64; // Global solver bound (SOLVER_MAX_CANDIDATES) — deterministic cap

const _rhHold = (errorType) => Object.freeze({ v: 1, ok: false, hold: String(errorType) });
const _rhNonBlank = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const _rhStrictBool = (v) => v === true; // strict true only — never coerce/default to a passing value
const _rhFiniteInt = (v) => (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) ? v : null);
const _rhFiniteNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
function _rhDeepFreeze(o) {
  // Always recurse into own object values (a shallow-frozen handshake envelope must still get its
  // nested slots/hero frozen), then freeze this node. Guarantees ZERO post-S6 mutation defensively.
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) _rhDeepFreeze(o[k]);
    if (!Object.isFrozen(o)) Object.freeze(o);
  }
  return o;
}

// Current-news people from the news analysis (compass) — structured {name, role}. Order-stable, de-duped.
// Reference subjects are deliberately NOT read here (compass only).
function _rhCurrentNewsPeople(compass) {
  const list = Array.isArray(compass?.mainCharacters) ? compass.mainCharacters : [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const name = _rhNonBlank(c?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role: _rhNonBlank(c?.role) ? String(c.role).trim().toLowerCase() : null });
  }
  return out;
}

// Story authority `story` input (identity truth only; reference is OMITTED → layout provenance 'derived').
function _rhStoryInput(people) {
  const heroName = (people.find((p) => p.role === 'hero') || null)?.name || null;
  const isPrincipal = (p) => REF_HERO_V2_PRINCIPAL_ROLES.includes(p.role);
  return {
    identities: people.map((p) => p.name),
    requiredCast: people.filter(isPrincipal).map((p) => p.name),
    optionalCast: people.filter((p) => !isPrincipal(p)).map((p) => p.name),
    editorialHero: heroName,
    eventContext: null,
    facts: [],
    storySemantics: null,
    eligibleAssetProvenance: [],
  };
}

// Cast candidate from a pool record — genuine measured readiness only (strict true). null if no genuine
// person label / sourceAssetId. candidateId doubles as the stable sourceAssetId (record.id is unique).
function _rhCastCandidate(record) {
  const sourceAssetId = _rhNonBlank(record?.id != null ? String(record.id) : null);
  const name = _rhNonBlank(record?.triage?.person);
  if (!sourceAssetId || !name) return null;
  const t = record.triage || {};
  return {
    name,
    candidateId: sourceAssetId,
    sourceAssetId,
    searched: _rhStrictBool(t.searched),
    triaged: _rhStrictBool(t.triaged),
    clean: _rhStrictBool(t.clean),
    highResolution: _rhStrictBool(t.highResolution),
    cropSafe: _rhStrictBool(t.cropSafe),
    identityVerified: _rhStrictBool(t.identityVerified),
  };
}

// Hero measured candidate (13 required fields) — genuine measured evidence ONLY. null if ANY mandatory
// measured field is genuinely absent (never defaults to a passing value).
function _rhHeroCandidate(record, personId, heroSlotId, boundContractHash) {
  const rid = _rhNonBlank(record?.id != null ? String(record.id) : null);
  if (!rid) return null;
  const t = record?.triage || {};
  const rw = _rhFiniteNum(record?.realWidth);
  const rh = _rhFiniteNum(record?.realHeight);
  if (!(rw > 0 && rh > 0)) return null;                        // resolution genuinely unknown
  const faceCount = _rhFiniteNum(t.faceCount);
  if (faceCount === undefined) return null;                    // isGroupShot source genuinely absent
  const identityConfidence = _rhFiniteNum(t.identityConfidence);
  const faceShare = _rhFiniteNum(t.faceShare);
  const headroom = _rhFiniteNum(t.headroom);
  const occlusion = _rhFiniteNum(t.occlusion);
  const edgeCut = _rhFiniteNum(t.edgeCut);
  const cleanliness = _rhFiniteNum(t.cleanliness);
  const visibleBodyRegion = _rhNonBlank(t.visibleBodyRegion);
  if ([identityConfidence, faceShare, headroom, occlusion, edgeCut, cleanliness].some((n) => n === undefined) || !visibleBodyRegion) return null;
  return {
    personId,
    identityConfidence,
    isGroupShot: faceCount > 1,
    faceShare,
    headroom,
    visibleBodyRegion,
    occlusion,
    edgeCut,
    resolution: { width: rw, height: rh },
    cleanliness,
    boundContractHash,
    sourceAssetId: rid,
    heroSlotId,
  };
}

// Global candidate (8 required fields) — genuine measured scores + sceneKey ONLY. null if any absent.
// candidateId/sourceAssetId come from the VERIFIED cast-manifest tuple (Fix #1), not re-derived from records.
function _rhGlobalCandidate(record, personId, eligibleSlotIds, candidateId, sourceAssetId) {
  const cid = _rhNonBlank(candidateId), said = _rhNonBlank(sourceAssetId);
  if (!cid || !said) return null;
  if (!Array.isArray(eligibleSlotIds) || !eligibleSlotIds.length) return null;
  const t = record?.triage || {};
  const semanticScore = _rhFiniteInt(t.semanticScore);
  const qualityScore = _rhFiniteInt(t.qualityScore);
  const slotFitScore = _rhFiniteInt(t.slotFitScore);
  const sceneKey = _rhNonBlank(t.sceneKey);
  if (semanticScore === null || qualityScore === null || slotFitScore === null || !sceneKey) return null;
  if (semanticScore < 0 || qualityScore < 0 || slotFitScore < 0) return null;
  return {
    candidateId: cid,
    sourceAssetId: said,
    personId: personId || null,
    eligibleSlotIds: [...eligibleSlotIds],
    semanticScore,
    qualityScore,
    slotFitScore,
    sceneKey,
  };
}

// Map a structural ref slot to a Cast editorial role (hero|reaction|context) — genuine per-slot eligibility (Fix #3).
function _rhMappedCastRole(s) {
  const refRole = String(s?.refRole ?? '').trim().toLowerCase();
  const shape = String(s?.shape ?? '').trim().toLowerCase();
  if (refRole === 'hero' || refRole === 'main') return 'hero';
  if (refRole === 'reaction' || shape === 'circle') return 'reaction';
  return 'context';
}
// Normalize a slot shape to the SA/V2 enum (rect|circle|rounded).
const _rhSaShape = (s) => { const v = String(s ?? '').trim().toLowerCase(); return v === 'circle' ? 'circle' : v === 'rounded' ? 'rounded' : 'rect'; };


// Independently recompute a Global assignmentHash from its output via the foundation's canonicalStringify
// (code-unit-sorted keys; integer numbers as String(n); arrays order-preserved) + SHA-256 — Fix #8 witness.
function _rhAssignmentHashOf(output, createHash) {
  const cstr = (v) => {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') { if (!Number.isInteger(v)) throw new Error('non-integer'); return String(v); }
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(cstr).join(',') + ']';
    if (v && typeof v === 'object') { const ks = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); return '{' + ks.map((k) => JSON.stringify(k) + ':' + cstr(v[k])).join(',') + '}'; }
    throw new Error('unsupported');
  };
  const base = { decision: output.decision, reason: output.reason, path: output.path, message: output.message, assignments: output.assignments, diagnostics: output.diagnostics, version: output.version };
  return createHash('sha256').update(cstr(base), 'utf8').digest('hex');
}

// Orchestrator: build/validate every authority in order; ANY upstream gate HOLD ⇒ typed fixed-code marker
// (no assignments / no partial strict payload). Deterministic + permutation-invariant (foundations
// canonicalize internally). Never throws — top-level try/catch fails closed to REF_HERO_V2_INTERNAL.
async function _runRefHeroV2({ compass, semContract, canonHeroId, semAuthorityHash, refDNA, refId, gatedPool, deps }) {
  try {
    // ── structural slots (REF = STRUCTURE ONLY: id / order / role / shape) ──
    const cSlots = Array.isArray(semContract?.slots) ? semContract.slots : [];
    if (cSlots.length < 3 || cSlots.length > REF_HERO_V2_MAX_SLOTS) return _rhHold('REF_HERO_V2_STRUCTURAL_SLOTS_INVALID');
    const heroSlotId = _rhNonBlank(canonHeroId);
    if (!heroSlotId || !cSlots.some((s) => s.id === heroSlotId)) return _rhHold('REF_HERO_V2_HERO_SLOT_INVALID');
    const slotIds = cSlots.map((s) => s.id);
    if (new Set(slotIds).size !== slotIds.length) return _rhHold('REF_HERO_V2_STRUCTURAL_SLOTS_INVALID');

    // ── reuse the PROVEN semantic witness (ref identity + exact frozen contract) — never a parallel hash (Fix #7) ──
    const semWitness = _rhNonBlank(semAuthorityHash);
    if (!semWitness || _dnaHashFor({ refId: _rhNonBlank(refId) || null, contract: semContract }) !== semWitness) return _rhHold('REF_HERO_V2_SEM_WITNESS_MISMATCH');

    // ── current-news people (analysis/compass only) ──
    const people = _rhCurrentNewsPeople(compass);
    if (!people.length) return _rhHold('REF_HERO_V2_NO_CURRENT_NEWS_PEOPLE');
    const heroName = (people.find((p) => p.role === 'hero') || null)?.name || null;
    if (!heroName) return _rhHold('REF_HERO_V2_NO_EDITORIAL_HERO');

    // ── load PURE foundations + frozen handshake (DI seams default to the real modules) ──
    const storyApi = deps?.storyApi || await import('@/lib/storyReferenceAuthority');
    const castApi = deps?.castApi || await import('@/lib/castManifest');
    const heroApi = deps?.heroApi || await import('@/lib/heroShotContract');
    const globalApi = deps?.globalApi || await import('@/lib/semanticGlobalAssignment');
    const authApi = deps?.selectionAuthorityApi || await import('@/lib/refSlotContract');
    if (['buildSelectionAuthorityV1', 'validateSelectionAuthorityV1', 'buildSelectionSpecV2', 'validateSelectionSpecV2Activation'].some((fn) => typeof authApi?.[fn] !== 'function')) {
      return _rhHold('REF_HERO_V2_SELECTION_AUTHORITY_API_UNAVAILABLE');
    }

    // ── Story authority (identity truth) — build + capture hash + external validate ──
    const storyBuilt = storyApi.buildStoryReferenceAuthorityContract({ story: _rhStoryInput(people) });
    if (!storyBuilt || storyBuilt.ok !== true || !storyBuilt.contract) return _rhHold('REF_HERO_V2_STORY_BUILD_FAILED');
    const storyAuthorityHash = storyApi.hashContract(storyBuilt.contract);
    if (!_rhNonBlank(storyAuthorityHash)) return _rhHold('REF_HERO_V2_STORY_HASH_FAILED');
    if (storyApi.validateContract(storyBuilt.contract, storyAuthorityHash).ok !== true) return _rhHold('REF_HERO_V2_STORY_VALIDATE_FAILED');

    // ── candidate universe = the FULL pre-cap pool mapped by id (input-order-independent — Fix #5) ──
    const recById = new Map();
    for (const rec of (Array.isArray(gatedPool) ? gatedPool : [])) { const id = _rhNonBlank(rec?.id != null ? String(rec.id) : null); if (id && !recById.has(id)) recById.set(id, rec); }
    if (!recById.size) return _rhHold('REF_HERO_V2_EMPTY_UNIVERSE');

    // ── Cast manifest (current-news only; NO reference param). requiredCast = principals. ──
    const principalNames = people.filter((p) => REF_HERO_V2_PRINCIPAL_ROLES.includes(p.role)).map((p) => p.name);
    const castCandidates = [];
    for (const rec of recById.values()) { const cc = _rhCastCandidate(rec); if (cc) castCandidates.push(cc); }
    let manifest;
    try {
      manifest = castApi.buildCastManifest({
        compass: { mainCharacters: people.map((p) => ({ name: p.name, role: p.role })), requiredCast: principalNames },
        candidates: castCandidates,
      });
    } catch { return _rhHold('REF_HERO_V2_CAST_BUILD_FAILED'); }
    const castManifestHash = _rhNonBlank(manifest?.hash);
    if (!castManifestHash) return _rhHold('REF_HERO_V2_CAST_HASH_FAILED');
    let verified;
    try { verified = castApi.assertCastManifestIntegrity(manifest, castManifestHash); } catch { return _rhHold('REF_HERO_V2_CAST_INTEGRITY_FAILED'); }
    let castHold;
    try { castHold = castApi.evaluateCastAssetHolds(manifest, { expectedHash: castManifestHash }); } catch { return _rhHold('REF_HERO_V2_CAST_EVAL_FAILED'); }
    if (castHold) return _rhHold('REF_HERO_V2_INSUFFICIENT_CAST_ASSETS');

    // ── VERIFIED eligible cast set (Fix #1): iterate the integrity-checked manifest people; RECOMPUTE eligibility
    //   from the six raw readiness booleans (NEVER trust cached candidate.eligible). Hero + Global candidates come
    //   ONLY from here — never from raw scored records; unmatched/ref-only identities have no personId (Fix #2). ──
    const eligibleTuples = [];
    for (const p of (verified.people || [])) {
      const pid = _rhNonBlank(p.personId);
      if (!pid) continue;
      const roles = Array.isArray(p.acceptableSlotRoles) ? p.acceptableSlotRoles.filter((r) => typeof r === 'string') : [];
      for (const c of (Array.isArray(p.candidates) ? p.candidates : [])) {
        if (castApi.computeCandidateEligibility(c) !== true) continue;
        const cid = _rhNonBlank(c.candidateId), said = _rhNonBlank(c.sourceAssetId);
        if (!cid || !said || !recById.has(said)) continue;
        eligibleTuples.push({ personId: pid, candidateId: cid, sourceAssetId: said, roles });
      }
    }
    if (!eligibleTuples.length) return _rhHold('REF_HERO_V2_NO_ELIGIBLE_CAST');

    // ── hero personId (current-news hero, reconciled against the verified manifest) ──
    const heroPersonId = _rhNonBlank(castApi.computePersonId(castApi.normalizeCastName(heroName)));
    if (!heroPersonId) return _rhHold('REF_HERO_V2_HERO_PERSON_INVALID');
    if (!(verified.people || []).some((p) => p.personId === heroPersonId)) return _rhHold('REF_HERO_V2_HERO_NOT_IN_MANIFEST');
    const slotCastRole = new Map(cSlots.map((s) => [s.id, _rhMappedCastRole(s)])); // per-slot cast role (Fix #3)

    // ── Hero contracts: ONLY over eligible hero-person assets — build (asset-bound) + evaluate genuine evidence ──
    const heroContractHashByCid = new Map();
    for (const t of eligibleTuples) {
      if (t.personId !== heroPersonId) continue;
      const rec = recById.get(t.sourceAssetId);
      const contract = heroApi.buildHeroShotContract({ sourceAssetId: t.sourceAssetId, heroSlotId, story: { personId: heroPersonId } });
      const contractHash = _rhNonBlank(contract?.contractHash);
      if (!contract || !contractHash) continue;
      const cand = _rhHeroCandidate(rec, heroPersonId, heroSlotId, contractHash);
      if (!cand) continue;
      const verdict = heroApi.evaluateHeroShotCandidate(contract, cand, { expectedContractHash: contractHash });
      if (verdict && verdict.accepted === true) heroContractHashByCid.set(t.candidateId, contractHash);
    }
    if (!heroContractHashByCid.size) return _rhHold('REF_HERO_V2_HERO_NO_APPROVED_CANDIDATE');

    // ── Global candidates from the eligible set with genuine per-slot (role) eligibility (Fix #1/#3) ──
    let globalCandidates = [];
    for (const t of eligibleTuples) {
      const rec = recById.get(t.sourceAssetId);
      const roleEligible = cSlots.map((s) => s.id).filter((id) => t.roles.includes(slotCastRole.get(id)));
      const finalEligible = roleEligible.filter((id) => id !== heroSlotId || (t.personId === heroPersonId && heroContractHashByCid.has(t.candidateId)));
      if (!finalEligible.length) continue;
      const gc = _rhGlobalCandidate(rec, t.personId, finalEligible, t.candidateId, t.sourceAssetId);
      if (gc) globalCandidates.push(gc);
    }
    if (!globalCandidates.length) return _rhHold('REF_HERO_V2_NO_GLOBAL_CANDIDATES');
    // deterministic TOTAL order (Fix #5): score desc, candidateId code-unit asc tie-break — total & input-order-independent.
    const _byScoreId = (a, b) => (b.semanticScore - a.semanticScore) || (b.qualityScore - a.qualityScore) || (b.slotFitScore - a.slotFitScore) || (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
    globalCandidates.sort(_byScoreId);
    // COVERAGE-PRESERVING cap to the solver bound (reviewer item 5): reserve, in score order, the best hero-APPROVED
    //   candidate + the best candidate of EACH required current-news person FIRST, then deterministically fill the rest
    //   by score — so a low-score required person is never dropped behind >64 high-score OPTIONAL candidates.
    const _requiredPersonIds = new Set((verified.people || []).filter((p) => p.mustRepresent === true).map((p) => p.personId));
    const _reserved = new Map();
    for (const g of globalCandidates) { if (heroContractHashByCid.has(g.candidateId) && g.personId === heroPersonId && g.eligibleSlotIds.includes(heroSlotId)) { _reserved.set(g.candidateId, g); break; } } // best hero-approved
    const _reqCovered = new Set();
    for (const g of globalCandidates) { if (g.personId && _requiredPersonIds.has(g.personId) && !_reqCovered.has(g.personId)) { _reqCovered.add(g.personId); _reserved.set(g.candidateId, g); } }
    if (_reserved.size > REF_HERO_V2_MAX_CANDIDATES) return _rhHold('REF_HERO_V2_REQUIRED_OVERFLOW'); // more hero+required than the solver bound
    const _capped = [..._reserved.values()];
    for (const g of globalCandidates) { if (_capped.length >= REF_HERO_V2_MAX_CANDIDATES) break; if (!_reserved.has(g.candidateId)) _capped.push(g); }
    globalCandidates = _capped.sort(_byScoreId);
    const approvedCandidateIds = globalCandidates.filter((g) => heroContractHashByCid.has(g.candidateId) && g.personId === heroPersonId && g.eligibleSlotIds.includes(heroSlotId)).map((g) => g.candidateId);
    if (!approvedCandidateIds.length) return _rhHold('REF_HERO_V2_HERO_APPROVED_NOT_MEASURED');

    // ── structural slots for Global (order 1..N; hero slot pinned to hero person) ──
    const structSlots = cSlots.map((s, i) => ({ slotId: s.id, order: i + 1, role: _rhNonBlank(s.solverRole) || _rhNonBlank(s.refRole) || 'context', shape: _rhSaShape(s.shape), personId: s.id === heroSlotId ? heroPersonId : null }));
    const requiredCast = (verified.people || []).map((p) => ({ personId: p.personId, required: p.mustRepresent === true, priority: _rhFiniteInt(p.priority) ?? 0 }));

    // ── Global assignment — run EXACTLY once ──
    let assignment;
    try {
      assignment = globalApi.buildSemanticGlobalAssignment({
        slots: structSlots,
        candidates: globalCandidates,
        requiredCast,
        heroAuthority: { heroSlotId, heroPersonId, approvedCandidateIds },
        limits: REF_HERO_V2_LIMITS,
      });
    } catch { return _rhHold('REF_HERO_V2_ASSIGNMENT_ERROR'); }
    if (!assignment || assignment.decision !== 'assigned' || !Array.isArray(assignment.assignments) || !assignment.assignments.length) {
      return _rhHold('REF_HERO_V2_ASSIGNMENT_HOLD'); // Global HOLD ⇒ assignments [] ⇒ no bindings
    }
    const assignmentHash = _rhNonBlank(assignment.assignmentHash);
    if (!assignmentHash) return _rhHold('REF_HERO_V2_ASSIGNMENT_HASH_FAILED');

    // ── crypto for the two independent hash witnesses (assignmentHash recompute + selectionAuthorityHash) ──
    let createHash;
    try { ({ createHash } = await import('node:crypto')); } catch { return _rhHold('REF_HERO_V2_CRYPTO_UNAVAILABLE'); }
    // Fix #8: INDEPENDENTLY recompute the Global assignmentHash via the foundation's canonicalStringify and verify
    //   byte-for-byte — a tampered/forged hash HOLDs (not merely a regex/nonblank shape check).
    let _recomputedAssignHash;
    try { _recomputedAssignHash = _rhAssignmentHashOf(assignment, createHash); } catch { return _rhHold('REF_HERO_V2_ASSIGNMENT_HASH_RECOMPUTE_FAILED'); }
    if (_recomputedAssignHash !== assignmentHash) return _rhHold('REF_HERO_V2_ASSIGNMENT_HASH_TAMPERED');

    // ── hero tuple (exact) from the hero slot's assignment ──
    const heroAssign = assignment.assignments.find((a) => a.slotId === heroSlotId);
    if (!heroAssign || heroAssign.personId !== heroPersonId || !heroContractHashByCid.has(heroAssign.candidateId)) return _rhHold('REF_HERO_V2_HERO_ASSIGNMENT_INVALID');

    // ── envelope hero tuple + slots (order ASCENDING + CONTIGUOUS 1..N; hero = exactly one slot) ──
    //   Re-number order 1..N over the assigned slots (sorted by structural order) so the frozen builder's
    //   contiguity invariant holds even if the solver bound a subset; refSlotId preserves identity.
    const roleBySlotId = new Map(structSlots.map((s) => [s.slotId, s.role]));
    const shapeBySlotId = new Map(structSlots.map((s) => [s.slotId, s.shape]));
    const structOrderBySlotId = new Map(structSlots.map((s) => [s.slotId, s.order]));
    const orderedAssign = assignment.assignments.slice().sort((a, b) => (structOrderBySlotId.get(a.slotId) ?? 1e9) - (structOrderBySlotId.get(b.slotId) ?? 1e9));
    const envSlots = orderedAssign.map((a, i) => ({
      refSlotId: a.slotId, order: i + 1, role: roleBySlotId.get(a.slotId) || 'context', shape: shapeBySlotId.get(a.slotId) || 'rect',
      personId: a.personId ?? null, candidateId: a.candidateId, sourceAssetId: a.sourceAssetId,
    }));
    const envHero = { heroContractHash: heroContractHashByCid.get(heroAssign.candidateId), refSlotId: heroSlotId, personId: heroPersonId, candidateId: heroAssign.candidateId, sourceAssetId: heroAssign.sourceAssetId };

    // ── independently capture expectedSelectionAuthorityHash via the DOCUMENTED canonical form
    //   (recursively key-sorted JSON + SHA-256 over {v,storyAuthorityHash,castManifestHash,assignmentHash,hero,slots}).
    //   This is the witness the frozen Wave1C builder self-verifies against — the two independent computations
    //   must agree. It is NOT a re-implementation of the envelope schema: buildSelectionAuthorityV1 still owns
    //   assembly/canonicalization/freezing; we only supply the required cross-check witness. ──
    let expectedSelectionAuthorityHash;
    try {
      const _saSortDeep = (v) => (Array.isArray(v) ? v.map(_saSortDeep)
        : (v && typeof v === 'object' ? Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).reduce((o, k) => { o[k] = _saSortDeep(v[k]); return o; }, {}) : v));
      const _saPreimage = { v: 1, storyAuthorityHash, castManifestHash, assignmentHash, hero: envHero, slots: envSlots };
      expectedSelectionAuthorityHash = createHash('sha256').update(JSON.stringify(_saSortDeep(_saPreimage)), 'utf8').digest('hex');
    } catch { return _rhHold('REF_HERO_V2_AUTHORITY_HASH_FAILED'); }

    // ── FROZEN handshake (Wave1C): build + externally re-validate the selectionAuthority envelope ──
    const _witnesses = {
      expectedSelectionAuthorityHash,
      expectedStoryAuthorityHash: storyAuthorityHash,
      expectedCastManifestHash: castManifestHash,
      expectedAssignmentHash: assignmentHash,
      expectedHeroContractHash: envHero.heroContractHash,
    };
    let built;
    try { built = authApi.buildSelectionAuthorityV1({ storyAuthorityHash, castManifestHash, assignmentHash, hero: envHero, slots: envSlots, ..._witnesses }); }
    catch { return _rhHold('REF_HERO_V2_SELECTION_AUTHORITY_BUILD_ERROR'); }
    const envelope = built && built.ok === true && built.selectionAuthority && built.selectionAuthority.selectionAuthorityHash === expectedSelectionAuthorityHash ? built.selectionAuthority : null;
    if (!envelope) return _rhHold('REF_HERO_V2_SELECTION_AUTHORITY_BUILD_FAILED');
    let validated;
    try { validated = authApi.validateSelectionAuthorityV1({ selectionAuthority: envelope, ..._witnesses }); }
    catch { return _rhHold('REF_HERO_V2_SELECTION_AUTHORITY_VALIDATE_ERROR'); }
    if (!(validated && validated.ok === true)) return _rhHold('REF_HERO_V2_SELECTION_AUTHORITY_VALIDATE_FAILED');

    // ── realized template + composer map from AUTHENTIC IMMUTABLE PROVENANCE. Authority = a module-private WeakMap in
    //   refTemplate keyed by realized-slot OBJECT IDENTITY, storing a FROZEN content snapshot (sourceIndex+id+geometry+
    //   shape) captured after all mutations. Defense is layered, all fail-closed: (a) locked non-enum data _sourceIndex
    //   descriptor (accessor rejected WITHOUT invocation, TOCTOU-safe); (b) WeakMap identity authenticity — a restamp/
    //   swap/strip is a NEW object ⇒ null ⇒ HOLD; (c) AUTHENTIC-CONTENT INTEGRITY — descriptor-snapshot the current
    //   render fields once and compare to the frozen provenance; a post-return id/geometry/shape mutation on the
    //   authentic object ⇒ HOLD (never blessed as GO). The producer then reads every render field ONLY from the
    //   immutable snapshot. Join BY sourceIndex ONLY (order-invariant); require exact unique 1:1 vs the contract;
    //   shape is a post-join integrity check, never a join key. ──
    let realizedRaw; let realizedSlotProvenance;
    try {
      const _rtMod = await import('@/lib/refTemplate');
      realizedSlotProvenance = _rtMod.realizedSlotProvenance;
      const dts = deps?.dnaToTemplateSpec || _rtMod.dnaToTemplateSpec;
      realizedRaw = dts(refDNA);
    } catch { return _rhHold('REF_HERO_V2_REALIZED_BUILD_ERROR'); }
    if (typeof realizedSlotProvenance !== 'function') return _rhHold('REF_HERO_V2_PROVENANCE_ACCESSOR_UNAVAILABLE');
    if (realizedRaw === null || typeof realizedRaw !== 'object') return _rhHold('REF_HERO_V2_REALIZED_INVALID');
    // (item 2) descriptor-read the realized `slots` CONTAINER exactly ONCE — a getter/accessor is rejected WITHOUT
    //   invocation; the captured array reference is then the SOLE source we iterate (TOCTOU-safe: a post-capture swap
    //   of realizedRaw.slots, or a getter returning alternating arrays, can never influence what we read).
    const _slotsDesc = Object.getOwnPropertyDescriptor(realizedRaw, 'slots');
    if (_slotsDesc && ('get' in _slotsDesc || 'set' in _slotsDesc)) return _rhHold('REF_HERO_V2_REALIZED_CONTAINER_ACCESSOR');
    const _rawSlots = _slotsDesc && Array.isArray(_slotsDesc.value) ? _slotsDesc.value : null;
    if (!_rawSlots || _rawSlots.length !== cSlots.length) return _rhHold('REF_HERO_V2_REALIZED_SLOT_COUNT');
    // top-level realized fields — descriptor-first single read (reject accessors); NOT identity-bound so re-checked below.
    const _topVal = (k) => { const d = Object.getOwnPropertyDescriptor(realizedRaw, k); if (!d) return undefined; if ('get' in d || 'set' in d) throw new Error('accessor'); return d.value; };
    let _templateId, _canvasW, _canvasH, _feather;
    try { _templateId = _rhNonBlank(_topVal('templateId')) || _rhNonBlank(_topVal('id')); _canvasW = _rhFiniteInt(_topVal('canvasW')); _canvasH = _rhFiniteInt(_topVal('canvasH')); _feather = _rhFiniteInt(_topVal('feather')); }
    catch { return _rhHold('REF_HERO_V2_REALIZED_FIELD_ACCESSOR'); }
    if (!_templateId || _canvasW === null || _canvasW < 1 || _canvasH === null || _canvasH < 1 || _feather === null || _feather < 0) return _rhHold('REF_HERO_V2_REALIZED_INVALID');
    // contract provenance key set — bounded, unique, integer (from the structural contract, dna.template.slots order)
    const _contractSrc = cSlots.map((s) => s.sourceIndex);
    if (_contractSrc.some((n) => !Number.isInteger(n) || n < 0) || new Set(_contractSrc).size !== _contractSrc.length) return _rhHold('REF_HERO_V2_CONTRACT_PROVENANCE_INVALID');
    const _contractSrcSet = new Set(_contractSrc);
    const _realizedBySrc = new Map();       // sourceIndex -> { id, shape }  (join)
    const _authSlots = [];                  // normalized V2 realized slots, from FROZEN snapshots (never live fields)
    for (const rs of _rawSlots) {
      if (rs === null || typeof rs !== 'object') return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_MISSING');
      // (1) DESCRIPTOR DEFENSE (TOCTOU-safe): locked non-enum DATA _sourceIndex — accessor rejected WITHOUT invocation.
      const _d = Object.getOwnPropertyDescriptor(rs, '_sourceIndex');
      if (!_d) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_MISSING');
      if ('get' in _d || 'set' in _d || _d.enumerable !== false || _d.writable !== false || _d.configurable !== false || !Number.isInteger(_d.value) || _d.value < 0) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_DESCRIPTOR_INVALID');
      // (2) AUTHENTICITY: the FROZEN content snapshot bound to THIS object identity (a clone/restamp ⇒ null ⇒ HOLD).
      const auth = realizedSlotProvenance(rs);
      if (!auth || !Number.isInteger(auth.sourceIndex) || auth.sourceIndex < 0 || auth.sourceIndex !== _d.value) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_UNAUTHENTIC');
      const _si = auth.sourceIndex;
      if (!_contractSrcSet.has(_si)) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_OUT_OF_SET');
      if (_realizedBySrc.has(_si)) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_DUPLICATE');
      // (2b) AUTHENTIC-CONTENT INTEGRITY (item 1): this slot is WeakMap-authentic, but a caller may have mutated its
      //   live id/geometry/shape AFTER capture (same identity ⇒ still authentic). Descriptor-snapshot EVERY current
      //   authoritative render field exactly once — a getter/accessor on ANY field is rejected WITHOUT invocation —
      //   then compare the CURRENT content field-by-field to the FROZEN provenance. ANY divergence = post-capture
      //   tampering ⇒ HOLD. We NEVER bless attempted mutation by silently rendering the stale snapshot. (A reorder of
      //   the ORIGINAL objects leaves content === provenance ⇒ still GO; the join below is order-invariant.)
      let _cur;
      try {
        _cur = {};
        for (const k of ['id', 'x', 'y', 'w', 'h', 'zIndex', 'border', 'borderWidth', 'shape']) {
          const _fd = Object.getOwnPropertyDescriptor(rs, k);
          if (_fd && ('get' in _fd || 'set' in _fd)) throw new Error('accessor');
          _cur[k] = _fd ? _fd.value : undefined;
        }
      } catch { return _rhHold('REF_HERO_V2_REALIZED_CONTENT_ACCESSOR'); }
      const _curShape = _cur.shape === 'circle' ? 'circle' : 'rect';
      if (_cur.id !== auth.id || _cur.x !== auth.x || _cur.y !== auth.y || _cur.w !== auth.w || _cur.h !== auth.h ||
          _cur.zIndex !== auth.zIndex || _cur.border !== auth.border || _cur.borderWidth !== auth.borderWidth ||
          _curShape !== auth.shape) return _rhHold('REF_HERO_V2_REALIZED_CONTENT_TAMPERED');
      // (3) build the normalized V2 realized slot from the IMMUTABLE snapshot ONLY (authentic id/geometry/shape).
      const _rid = _rhNonBlank(auth.id);
      const _rShape = auth.shape === 'circle' ? 'circle' : auth.shape === 'rounded' ? 'rounded' : 'rect';
      const _x = _rhFiniteInt(auth.x), _y = _rhFiniteInt(auth.y), _w = _rhFiniteInt(auth.w), _h = _rhFiniteInt(auth.h);
      const _z = _rhFiniteInt(auth.zIndex), _bw = _rhFiniteInt(auth.borderWidth);
      if (!_rid || _x === null || _x < 0 || _y === null || _y < 0 || _w === null || _w < 1 || _h === null || _h < 1 || _z === null || _z < 0 || _bw === null || _bw < 0) return _rhHold('REF_HERO_V2_REALIZED_INVALID');
      _realizedBySrc.set(_si, { id: _rid, shape: _rShape });
      _authSlots.push({ id: _rid, x: _x, y: _y, w: _w, h: _h, zIndex: _z, border: auth.border != null && auth.border !== false, borderWidth: _bw, shape: _rShape });
    }
    if (_realizedBySrc.size !== cSlots.length) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_INCOMPLETE'); // exact 1:1
    if (new Set(_authSlots.map((s) => s.id)).size !== _authSlots.length) return _rhHold('REF_HERO_V2_REALIZED_ID_DUPLICATE');
    // JOIN BY KEY ONLY (sourceIndex); shape is a post-join integrity check (rect↔circle provenance corruption ⇒ HOLD).
    const composerBySlotId = new Map();
    for (const s of cSlots) {
      const r = _realizedBySrc.get(s.sourceIndex);
      if (!r) return _rhHold('REF_HERO_V2_REALIZED_PROVENANCE_INCOMPLETE');
      if (r.shape !== _rhSaShape(s.shape)) return _rhHold('REF_HERO_V2_REALIZED_SHAPE_INCONSISTENT');
      composerBySlotId.set(s.id, r.id);
    }
    // EXACT V2 realizedTemplate schema, assembled ONLY from the authentic frozen snapshots (no live-field/getter reads)
    const realizedTemplate = { templateId: _templateId, canvasW: _canvasW, canvasH: _canvasH, feather: _feather, slots: _authSlots };

    // ── render bindings — EXACT V2 schema {refSlotId,composerSlotId,candidateId,sourceAssetId,imageUrl}; authority-bound.
    //   imageUrl lives ONLY here (never in the pre-S6 selectionAuthority). candidate/sourceAsset come straight from the
    //   authority slot (no substitution); composerSlotId is the validated realized id; unique composerId + url (Fix #4). ──
    const urlByCid = new Map();
    for (const t of eligibleTuples) { const u = _rhNonBlank(recById.get(t.sourceAssetId)?.imageUrl); if (u) urlByCid.set(t.candidateId, u); }
    const renderBindings = [];
    for (const s of envelope.slots) {
      const composerSlotId = _rhNonBlank(composerBySlotId.get(s.refSlotId));
      const imageUrl = urlByCid.get(s.candidateId);
      if (!composerSlotId || !imageUrl) return _rhHold('REF_HERO_V2_BINDING_INCOMPLETE');
      renderBindings.push({ refSlotId: s.refSlotId, composerSlotId, candidateId: s.candidateId, sourceAssetId: s.sourceAssetId, imageUrl });
    }
    if (new Set(renderBindings.map((b) => b.composerSlotId)).size !== renderBindings.length) return _rhHold('REF_HERO_V2_BINDING_COMPOSER_DUP');
    if (new Set(renderBindings.map((b) => b.imageUrl)).size !== renderBindings.length) return _rhHold('REF_HERO_V2_BINDING_URL_DUP');

    // ── SelectionSpec V2 producer (Fix #9): build the strict render spec, then round-trip it through the foundation
    //   validator (specHash binds identity/geometry, replayHash binds exact URLs). The S7 CONSUMER is now wired behind
    //   the default-OFF latch (s7_cover carries this spec → validator → queue; megaComposerService renders it). ──
    let specBuilt;
    try { specBuilt = authApi.buildSelectionSpecV2({ selectionAuthority: envelope, expectedSelectionAuthorityHash, renderBindings, realizedTemplate, refId: _rhNonBlank(refId) || realizedTemplate.templateId }); }
    catch { return _rhHold('REF_HERO_V2_SELECTION_SPEC_BUILD_ERROR'); }
    const builtSpec = specBuilt && specBuilt.ok === true && specBuilt.selectionSpec ? specBuilt.selectionSpec : null;
    if (!builtSpec) return _rhHold('REF_HERO_V2_SELECTION_SPEC_BUILD_FAILED');
    // Capture the TRUSTED pins at the S6 freeze boundary FROM THE TRUSTED BUILD (reviewer items 1-2). expectedSpecHash
    //   binds identity/geometry; expectedReplayHash binds the exact render URLs. They are NEVER re-derived later from an
    //   untrusted spec — a re-signed URL/refId/composer tamper (with recomputed self-hashes) recanonicalizes to a hash
    //   that ≠ these frozen pins ⇒ v2_spec_hash_pin_mismatch / v2_replay_hash_pin_mismatch ⇒ HOLD.
    const expectedSpecHash = _rhNonBlank(builtSpec.specHash);
    const expectedReplayHash = _rhNonBlank(builtSpec.replayHash);
    if (!expectedSpecHash || !expectedReplayHash) return _rhHold('REF_HERO_V2_SPEC_PIN_MISSING');
    let specVal;
    try { specVal = authApi.validateSelectionSpecV2Activation({ selectionSpec: builtSpec, selectionAuthority: envelope, expectedSelectionAuthorityHash, expectedSpecHash, expectedReplayHash, realizedTemplate }); }
    catch { return _rhHold('REF_HERO_V2_SELECTION_SPEC_VALIDATE_ERROR'); }
    const selectionSpec = specVal && specVal.ok === true && specVal.selectionSpec ? specVal.selectionSpec : null; // canonical validated spec
    if (!selectionSpec) return _rhHold('REF_HERO_V2_SELECTION_SPEC_VALIDATE_FAILED');

    // ── persist FROZEN authority + expected hash + exact render bindings + strict render spec + trusted pins
    //   + realized template (zero later mutation). S7 consumes this spec under the default-OFF strict-render latch. ──
    return _rhDeepFreeze({ v: 1, ok: true, selectionAuthority: envelope, expectedSelectionAuthorityHash, renderBindings, selectionSpec, expectedSpecHash, expectedReplayHash, realizedTemplate });
  } catch {
    return _rhHold('REF_HERO_V2_INTERNAL');
  }
}

export async function s6_slots(job, { origin, _deps } = {}) {
  // ★ SEM-1: dependency injection เพื่อ testability เท่านั้น — default = ของจริง (production เดิม 100%)
  const _brainFn = _deps?.slotDirectorBrain || slotDirectorBrain;
  const _abFn = _deps?.artBriefBrain || artBriefBrain; // ★ D3-B2: DI seam (default = ของจริง — production เดิม)
  const _jf = _deps?.fetchJson || jfetch;
  // ═══ D-sidecar — FINAL-DECISION EVIDENCE v2 (kill switch MEGA_FINAL_DECISION_EVIDENCE_V2='1' เป๊ะ) ═══
  //   latch "ครั้งเดียวก่อน await แรกของฟังก์ชัน" (TOCTOU-proof — flip env กลางทางไม่มีผล) ·
  //   OFF = inert เต็มตัว: ไม่มี dynamic import โมดูล D / ไม่อ่าน carrier-วินิจฉัยใด / ไม่มี field-log ใหม่ —
  //   ผลธุรกิจ byte-identical กับ legacy · ON แต่หลักฐานไม่ครบ/เพี้ยน = omit sidecar เงียบ (fail-closed)
  const _dEvidenceOn = _finalDecisionEvidenceFlag(process.env.MEGA_FINAL_DECISION_EVIDENCE_V2);
  //   id เอาเฉพาะ primitive (string/finite number) — ไม่เรียก toString ของ object แปลก (ห้ามมี side effect เพิ่มเมื่อ ON)
  const _dIdOf = (v) => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : null));
  const _dTrace = _dEvidenceOn ? new Map() : null; // trace คู่ขนานข้าง slots (ภายในเท่านั้น — id ดิบไม่ออก output ใดๆ)
  let _dUniverse = null; // จักรวาล candidate "ก้อนเดียว" (ids ตามลำดับที่ส่งเข้าสมองจริง) — จับก่อนเรียกสมอง
  let _dSidecar = null;  // หลักฐาน v2 ที่ผ่าน producer (decisionComplete=true เท่านั้น) — แนบ key decisionEvidence ตอน return
  // ═══ LANE-C ROLE READINESS — latch MEGA_ROLE_READINESS='1' (fresh func-scoped snapshot ที่ ENTRY ก่อน await แรก · exact '1') ═══
  //   TOCTOU-proof (flip env กลางทางไม่มีผล) · DEFAULT OFF = byte-identical legacy: ไม่มี read/import/log/field ใหม่บนเส้น OFF
  //   ★ ห้าม reuse HERO_GRADE_HARD_ON (default-ON คนละ semantics) — นี่ latch ใหม่ default OFF ล้วน
  const _roleReadyOn = process.env.MEGA_ROLE_READINESS === '1';
  let _roleReadinessCounts = null; // (1d) verdict counts numbers-only — แนบเข้า D-sidecar เฉพาะ ON (ไม่แตะเส้น OFF)
  // ═══ WAVE1A — REF+CAST+HERO V2 latch MEGA_REF_HERO_V2='1' (exact '1', TOCTOU-proof snapshot at ENTRY) ═══
  //   DEFAULT OFF = byte-identical legacy (no read/import/log/field on the OFF path — the seam block near
  //   the happy-path return is skipped entirely). See the _runRefHeroV2 producer block above s6_slots.
  const _refHeroV2On = process.env.MEGA_REF_HERO_V2 === '1';
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
  //   ★ Codex D P1 (candidate-universe honesty รอบ 2): แกน mirror จุดเดียว — ค่างบ + serialization ต่อใบ ใช้ร่วมทุกผู้บริโภค
  //     ห้ามพิสูจน์จากสิ่งที่ brain fn (จริง/ฉีดเทส) รายงานเอง
  const IMG_META_BUDGET_MIRROR = 18000; // ต้องเท่ากับ IMG_META_BUDGET ใน megaBrains.js เสมอ (แก้ที่โน่นต้องแก้ที่นี่คู่กัน)
  const _promptLineOf = (m) => JSON.stringify(m); // canonical per-row serialization — single source (solver-diag + D-sidecar)
  // FROZEN PROOF ของ D-sidecar: serialize "ทุกใบ" เหมือน production เป๊ะ (megaBrains .map ทุกใบก่อนคิดงบ — ไม่ break กลางคัน)
  //   + บัญชี byte เต็ม (บรรทัดจริงทุกแถว · งบ len+2 สะสม) + id ต่อใบ (primitive-only ผ่าน _dIdOf) · deep-frozen กันแก้ทีหลัง
  //   เรียกเฉพาะโซน ON ใต้ try/catch ของ D — แถวไหน serialize ไม่เป็น string = null ทั้งก้อน (ห้ามใช้ proof บางส่วน)
  const _promptBudgetProof = () => {
    const lines = meta.map((m) => _promptLineOf(m));
    if (!lines.every((ln) => typeof ln === 'string')) return null; // ทุกแถวต้อง serialize สำเร็จ — ขาดแถวเดียว = พิสูจน์ไม่ได้
    let included = 0, len = 0;
    for (const ln of lines) {
      if (len + ln.length + 2 > IMG_META_BUDGET_MIRROR) break;
      len += ln.length + 2;
      included++;
    }
    return Object.freeze({
      lines: Object.freeze(lines),
      ids: Object.freeze(meta.map((m) => _dIdOf(m?.id))),
      includedCount: included,
      budgetLen: len,
      rowCount: lines.length,
    });
  };
  // มุมมอง solver diagnostics — พฤติกรรม Wave3 เดิมทุก byte (early-break · ไม่ serialize แถวหลังจุดตัด)
  const _promptBudgetVisibleIds = () => {
    const ids = [];
    let len = 0;
    for (const m of meta) {
      const line = _promptLineOf(m);
      if (len + line.length + 2 > IMG_META_BUDGET_MIRROR) break;
      len += line.length + 2;
      ids.push(String(m.id));
    }
    return ids;
  };
  const solverDiagLlmVisibleIds = SOLVER_DIAGNOSTICS_V2_ON ? _promptBudgetVisibleIds() : null;

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

  // ★ D3-B2 (11 ก.ค. — Codex): snapshot สวิตช์ครั้งเดียวที่ต้นทาง S6a (env อ่านที่ adapter เท่านั้น)
  const _refShotAuthOn = process.env.MEGA_REF_SHOT_AUTHORITY === '1';
  const _semPrereqOn = process.env.MEGA_SEMANTIC_SELECTION === '1' && process.env.MEGA_SELECTION_SPEC === '1';
  // ★ D3-B2.3 (Codex P1 TOCTOU): normalize marker ทั้งสอง carrier "ครั้งเดียว" ที่ต้นทาง — ใช้ canonical snapshot เท่านั้น
  const _pickImagesExists = !!job.dossier.pickImages;
  const _abRead = readRefShotMarker(job.dossier.artBrief, 'refShotAuthority');   // {present, marker: canonical|null}
  const _pickRead = readRefShotMarker(job.dossier.pickImages, 'refShotAuthority');
  let _jobRefShotMarker = null; // canonical snapshot ของงานนี้ (ตั้งเมื่อผ่าน lifecycle)
  // ★ D3-B3.3 (Codex TOCTOU): whole plain snapshot ของ artBrief สำหรับ template_v1 — consumer ทุกจุดใน S6 template path
  //   อ่านตัวนี้เท่านั้น (ไม่ reread raw carrier/Proxy) · null = legacy/unmarked (ใช้ raw byte เดิม)
  let _templateArtBriefSnapshot = null;

  // 🎨 S6a บก.ศิลป์: ref → "ใบสั่งงาน" — ★ D3-B2.2/3 lifecycle: pick marker ต้องคู่ artBrief valid+equal ·
  //   marked resume เฉพาะ pickImages หาย (pre-selection) · fresh arm ต้องไม่มี pickImages · unmarked = legacy
  if (_pickRead.present) {
    if (!_pickRead.marker || !_abRead.marker || !canonicalMarkersEqual(_pickRead.marker, _abRead.marker)) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: pickImages marker ไม่คู่กับ artBrief marker (valid+equal) — พักงาน ห้ามซ่อม' };
    }
    if (!_refShotAuthOn || !_semPrereqOn) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: แฟ้ม template_v1 (มี pick marker) แต่สวิตช์/prereq ปิด — พักรอ' };
    }
    _jobRefShotMarker = _abRead.marker; // canonical snapshot (resume template_v1)
    // ★ D3-B2.4/2.6 (Codex P1): เขียน canonical plain clone ทับ raw marker ทั้งคู่ + ยืนยันผลจริง —
    //   carrier frozen/non-writable/Proxy set-trap โกหก = HOLD ก่อน slotDirector/queue (ไม่หลุด/ไม่ถอย legacy)
    if (!_writeBackRefShotMarker(job.dossier.artBrief, 'refShotAuthority', cloneRefShotMarker(_abRead.marker))
      || !_writeBackRefShotMarker(job.dossier.pickImages, 'refShotAuthority', cloneRefShotMarker(_pickRead.marker))) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: เขียน canonical marker กลับ carrier ไม่สำเร็จ (frozen/non-writable/set-trap) — พักงาน ห้ามซ่อม/ถอย legacy' };
    }
  } else if (job.dossier.artBrief) {
    if (_abRead.present) {
      if (!_abRead.marker) {
        return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: marker ในใบสั่งเสีย/ถูกแก้ — พักงาน ห้ามซ่อม/ถอย legacy' };
      }
      if (_pickImagesExists) {
        return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: marked artBrief แต่ pickImages มีอยู่โดยไม่มี marker — พักงาน (ไม่ auto-upgrade)' };
      }
      if (!_refShotAuthOn || !_semPrereqOn) {
        return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: แฟ้ม template_v1 แต่สวิตช์/prereq ปิด — พักรอ (ไม่ downgrade legacy)' };
      }
      _jobRefShotMarker = _abRead.marker; // canonical snapshot (pre-selection resume)
      // ★ D3-B2.4/2.6 (Codex P1): เขียน canonical plain clone + ยืนยันผลจริง —
      //   artBrief frozen/non-writable/set-trap โกหก = HOLD ก่อน slotDirector/queue (ไม่ถอย legacy)
      if (!_writeBackRefShotMarker(job.dossier.artBrief, 'refShotAuthority', cloneRefShotMarker(_abRead.marker))) {
        return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: เขียน canonical marker กลับ artBrief ไม่สำเร็จ (frozen/non-writable/set-trap) — พักงาน ห้ามซ่อม/ถอย legacy' };
      }
    }
    // unmarked existing artBrief + no pick marker = legacy — ไม่ทำอะไร (byte เดิม)
  } else if (job.dossier.refMatch?.dna) {
    const _armTemplateV1 = _refShotAuthOn && !!_refDNA && !_pickImagesExists;
    if (_armTemplateV1 && !_semPrereqOn) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: เปิดสวิตช์+ref แน่น แต่ SEM/SPEC ยังไม่ครบ — พักรอ (fail-closed ไม่ผสม legacy)' };
    }
    try {
      const _generatedBrief = await _abFn({
        refDNA: job.dossier.refMatch.dna,
        compass: job.dossier.compass,
        deskTitle: job.dossier.desk?.title,
        typeMatched: !!job.dossier.refMatch.typeMatched,
        ...(_armTemplateV1 && _semPrereqOn ? { mode: 'template_v1' } : {}), // legacy = ไม่ส่ง mode (arg เดิมเป๊ะ)
      });
      if (_armTemplateV1 && _semPrereqOn) {
        // ★ P0/P1: normalize marker ที่ generate มาครั้งเดียว — invalid = HOLD · valid = แทน raw ด้วย canonical plain clone
        const _gRead = readRefShotMarker(_generatedBrief, 'refShotAuthority');
        if (!_gRead.present || !_gRead.marker) {
          return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: ผล template_v1 ไม่มี/เสีย marker — ไม่ assign (กัน retry กลายเป็น unmarked legacy)' };
        }
        // ★ D3-B3.3 (Codex TOCTOU): validate raw generated brief "ครั้งเดียว" → PLAIN snapshot · bad = HOLD ไม่ persist
        //   persist artBrief ที่ orders = snapshot plain เท่านั้น (ไม่เก็บ raw array/order refs/Proxy/getter) →
        //   contract/slotDirector/dossierPatch/S7 อ่าน snapshot เดียวกัน ไม่ reread raw
        const _valF = _validatePersonSnapshot(() => job.dossier.compass, () => _generatedBrief, _refDNA);
        if (!_valF.ok) {
          return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: ใบสั่ง template_v1 ที่เพิ่งสร้าง personHint (hero/main/reaction) ไม่ตรงตัวตนข่าว — ไม่ persist (กัน retry เพี้ยน)' };
        }
        _jobRefShotMarker = _gRead.marker;
        // ★ D3-B3.3: local plain snapshot ก้อนเดียว — fresh persist ลง job.dossier.artBrief (raw carrier = job.dossier plain) ได้
        _templateArtBriefSnapshot = { storyNote: _valF.storyNote, orders: _valF.orders, refShotAuthority: cloneRefShotMarker(_gRead.marker) };
        job.dossier.artBrief = _templateArtBriefSnapshot;
      } else {
        job.dossier.artBrief = _generatedBrief; // legacy = assign ตรง (byte เดิม)
      }
      const _abLog = _templateArtBriefSnapshot || job.dossier.artBrief; // ★ D3-B3.3: template = local snapshot · legacy = raw (_generatedBrief) — ไม่มี raw read สำหรับ template
      console.log(`[MEGA S6a] 🎨 ใบสั่งงาน ${_abLog.orders?.length || 0} ช่อง${_jobRefShotMarker ? ' · 🎯template_v1' : ''} — ${String(_abLog.storyNote || '').slice(0, 80)}`);
    } catch (e) {
      if (_armTemplateV1 && _semPrereqOn) {
        return { status: 'waiting', nextAction: 'wait', summary: `🎯⏸️ ref-shot authority: สร้างใบสั่ง template_v1 ล้ม (${String(e?.message || '').slice(0, 50)}) — พักงานก่อน slotDirector (ไม่ถอย legacy)` };
      }
      console.log('[MEGA S6a] บก.ศิลป์ล้ม (เดินต่อไม่มีใบสั่ง):', e.message?.slice(0, 50)); // legacy เดิมเป๊ะ
    }
  }
  // ★ D3-B2.3: mode ของงานนี้ จาก canonical snapshot ที่ cache ไว้ (ไม่อ่าน raw ซ้ำ) + สวิตช์
  const _jobTemplateV1 = !!_jobRefShotMarker && _refShotAuthOn && _semPrereqOn;

  // ★ D3-B3 (Codex): defense-in-depth (RESUME) — งาน template_v1 ที่ resume/persist มาแล้ว ต้องมี personHint
  //   ทุกช่อง hero/main/reaction ตรง "ตัวตนข่าวปัจจุบัน" (current-person authority) ก่อน build contract/slotDirector ·
  //   fail-closed strict: null/unknown/ผิดคน = waiting (ไม่ซ่อม paired เดิม · ไม่ถอย legacy) · unmarked/legacy ไม่แตะ
  //   ★ D3-B3.3 (Codex): !_templateArtBriefSnapshot = validate-once — fresh สร้าง snapshot S1 แล้ว ข้ามการ revalidate ตรงนี้
  //     (ใช้ S1 ก้อนเดิมถึง contract/brain/solver/dossierPatch) · resume เท่านั้นที่สร้าง snapshot ครั้งเดียวที่นี่
  if (_jobTemplateV1 && !_templateArtBriefSnapshot) {
    const _val = _validatePersonSnapshot(() => job.dossier.compass, () => job.dossier.artBrief, _refDNA);
    if (!_val.ok) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: personHint (hero/main/reaction) ไม่ตรงตัวตนข่าวปัจจุบัน (current-person authority) — พักงาน ห้ามซ่อม/ถอย legacy' };
    }
    // ★ D3-B3.3 (Codex TOCTOU): สร้าง local plain snapshot ก้อนเดียว — ห้าม mutate raw carrier (Proxy set-trap โกหก/swap ได้)
    //   consumer template path ทุกจุด (contract/brain/solver/diagnostics/dossierPatch/S7) อ่าน local นี้เท่านั้น
    //   (representation canonicalization: person/index/role/selection เดิมทุกค่า · ไม่ซ่อม pickImages · marker canonical)
    _templateArtBriefSnapshot = { storyNote: _val.storyNote, orders: _val.orders, refShotAuthority: cloneRefShotMarker(_jobRefShotMarker) };
  }

  // ★ SEM-1 (Codex อนุมัติ design v2 — เลือกภาพตามบทช่องจริงของ ref): เงื่อนไขเปิดต้องครบ 4 (invariant I5)
  //   ① MEGA_SEMANTIC_SELECTION=1 ② MEGA_SELECTION_SPEC=1 ③ ref แมตช์แน่น (_refDNA=typeMatched เท่านั้น)
  //   ④ contract จาก template.slots จริง + realized template map ครบ (จำนวนช่องตรง) — ขาดข้อใด = legacy เดิมทั้งท่อ
  //   OFF = ไม่มี field/log/prompt ใหม่แม้ byte เดียว (byte-identical) · solver ยัง shadow · สาย semantic/template_v1 ถูกบริโภคโดยสาย strict/W3-3 ที่คุมด้วย flag default OFF
  let semContract = null;
  if (_semPrereqOn && _refDNA) { // ★ D3-B2.3 (Codex P1): ใช้ snapshot _semPrereqOn — ไม่ reread SEM/SPEC หลัง artBrief await
    let _semHold = null; // ★ D3-B2: marked template_v1 job ที่ contract ไม่พร้อม = HOLD (ห้ามถอย legacy)
    try {
      const specApi = await import('@/lib/refSlotContract');
      // ★ D3-B2.3: DI seam ใช้เฉพาะงาน template_v1 (armed) — legacy/unmarked ใช้ของจริงเสมอ (ไม่กระทบ Checkpoint C)
      const dnaToTemplateSpec = (_jobTemplateV1 && _deps?.dnaToTemplateSpec) || (await import('@/lib/refTemplate')).dnaToTemplateSpec;
      // ★ D3-B2: ใช้ persisted mode ของงาน — marked → template_v1 (authority) · legacy = arg เดิมเป๊ะ
      const c = specApi.buildRefSlotContract({ refDNA: _refDNA, artBriefOrders: (_jobTemplateV1 ? _templateArtBriefSnapshot : job.dossier.artBrief)?.orders || [], ...(_jobTemplateV1 ? { mode: 'template_v1' } : {}) });
      const realized = dnaToTemplateSpec(_refDNA);
      const okSource = c?.source === 'template.slots' && Array.isArray(c.slots) && c.slots.length >= 3;
      const okRealized = !!realized && Array.isArray(realized.slots) && realized.slots.length === c.slots.length;
      if (_jobTemplateV1) {
        const auth = c?.authority;
        const okAuth = !!auth && auth.mode === 'template_v1' && auth.axis === 'template.slots' && auth.axisReady === true
          && auth.effectiveViewHash === _jobRefShotMarker.effectiveViewHash;
        const okGeom = _refShotContractGeomOk(c); // finite/positive/in-bounds ทุกช่อง
        const okRealizedGeom = _refShotRealizedOk(realized, c); // count/set/geometry realized ถูกต้อง
        if (okSource && okRealized && okRealizedGeom && okAuth && okGeom) {
          semContract = c;
          activeSlots = c.slots.map((s) => s.id);
          console.log(`[MEGA S6] 🎯 template_v1 authority ON: ${activeSlots.join(' · ')} (${c.slots.length} ช่อง · viewHash=${auth.effectiveViewHash})`);
        } else {
          _semHold = `🎯⏸️ ref-shot authority: contract template_v1 ไม่พร้อม (source=${c?.source || '-'} · axisReady=${c?.authority?.axisReady} · hashMatch=${c?.authority?.effectiveViewHash === _jobRefShotMarker.effectiveViewHash} · geom=${okGeom} · realizedGeom=${okRealizedGeom}) — พักงาน ห้ามถอย legacy`;
        }
      } else if (okSource && okRealized) {
        semContract = c;
        activeSlots = c.slots.map((s) => s.id); // instance ids เรียงตาม sourceIndex — deterministic
        console.log(`[MEGA S6] 🧬 semantic-selection ON: ${activeSlots.join(' · ')} (${c.slots.length} ช่องจากบท ref จริง)`);
      } else {
        console.log(`[MEGA S6] 🧬 semantic-selection ขอเปิดแต่เงื่อนไขไม่ครบ (source=${c?.source || '-'} · realizedMap=${okRealized}) → legacy`);
      }
    } catch (e) {
      if (_jobTemplateV1) _semHold = `🎯⏸️ ref-shot authority: build contract template_v1 ล้ม (${String(e?.message || '').slice(0, 50)}) — พักงาน`;
      else console.log('[MEGA S6] 🧬 semantic-selection เปิดไม่ได้ (ล้ม) → legacy:', String(e?.message || '').slice(0, 60));
    }
    if (_semHold) return { status: 'waiting', nextAction: 'wait', summary: _semHold };
  }
  // ★ D3-B2: marked job แต่ contract ไม่ถูกสร้าง (เช่น ref อ่อนลง/prereq หายกลางทาง) = HOLD ก่อน slotDirector
  if (_jobTemplateV1 && !semContract) {
    return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority: งาน template_v1 แต่ contract ไม่ถูกสร้าง (ref/prereq เปลี่ยน?) — พักงาน' };
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

  // ★ D-sidecar: จับ "จักรวาล candidate" ก้อนเดียว = ลิสต์ meta ทั้งก้อนที่กำลังส่งเข้าสมอง (ก่อน arbitration ทุกขั้น) —
  //   detached copy ของ id ล้วน · ห้าม infer จากที่อื่น (top3/solver/พูลท้าย) · id หาย/ไม่ใช่ primitive/ซ้ำ (กำกวม)
  //   = จักรวาลใช้ไม่ได้ → sidecar ทั้งก้อนถูก omit ตอน finalize (ไม่แตะผลธุรกิจ)
  //   ★ Codex D P1 รอบ 2 (serialization-stability honesty): สมองจริงตัด prompt ที่ IMG_META_BUDGET=18000 และ
  //     stringify "อีกรอบทีหลัง" เอง — proof ต้องการันตีว่ารอบหลังได้ byte เดิมแน่ ไม่ใช่แค่ id ตรงกันสองรอบ:
  //     ① เดินตรวจโครงสร้างแบบ descriptor-only ก่อนแตะ stringify ใดๆ (ห้าม invoke): ทุกค่าในกราฟเป็น primitive/
  //        undefined/plain Object/plain dense Array เท่านั้น · ห้ามมี own 'toJSON' ทุกชั้น + เช็ค pollution บน
  //        Object.prototype/Array.prototype · ห้าม accessor/symbol key/proto แปลก — ผ่านแล้ว JSON.stringify
  //        จึงพิสูจน์ได้ว่าไม่เรียกโค้ดแปลกปลอมเลย และให้ byte เดิมทุกรอบ รวมถึงรอบของสมองจริงที่มาทีหลัง
  //     ② FROZEN PROOF จาก mirror สองรอบ (_promptBudgetProof — serialize ทุกใบเหมือน megaBrains): เทียบ byte
  //        ต่อบรรทัด + บัญชีงบตรงกัน + includedCount ต้อง === meta.length (เห็นครบทุกใบเท่านั้น)
  //     ③ id own primitive ครบ/ไม่ว่าง/ไม่ซ้ำ · การันตีข้อเดียวไม่ได้ = omit ทั้ง sidecar (ห้าม prefix/ห้ามเดา)
  //     ไม่ mutate meta/brain input แม้ byte เดียว (อ่านผ่าน descriptor เท่านั้น)
  if (_dEvidenceOn) {
    try {
      const _protoNoToJSON = (P) => {
        try { return Object.getOwnPropertyDescriptor(P, 'toJSON') === undefined; } catch { return false; }
      };
      const _stableJson = (v, depth) => {
        if (v === null || v === undefined) return true; // undefined = stringify ข้าม key (object) / ใส่ null (array) เดิมทุกรอบ
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') return true; // primitive ไม่ถูกถาม toJSON
        if (t !== 'object' || depth <= 0) return false; // function/symbol/bigint/ลึกผิดปกติ = การันตีไม่ได้
        let proto, keys;
        try { proto = Object.getPrototypeOf(v); keys = Reflect.ownKeys(v); } catch { return false; }
        if (Array.isArray(v)) {
          if (proto !== Array.prototype) return false;
          let lenD;
          try { lenD = Object.getOwnPropertyDescriptor(v, 'length'); } catch { return false; }
          if (!lenD || !('value' in lenD) || !Number.isSafeInteger(lenD.value) || lenD.value < 0) return false;
          const n = lenD.value;
          if (keys.length !== n + 1) return false; // dense เท่านั้น: index 0..n-1 + 'length' — มีรู/คีย์เกิน = ปฏิเสธ
          for (let i = 0; i < n; i++) {
            let d;
            try { d = Object.getOwnPropertyDescriptor(v, String(i)); } catch { return false; }
            if (!d || !('value' in d) || !d.enumerable) return false;
            if (!_stableJson(d.value, depth - 1)) return false;
          }
          return true;
        }
        if (proto !== Object.prototype && proto !== null) return false;
        for (const k of keys) {
          if (typeof k !== 'string' || k === 'toJSON') return false;
          let d;
          try { d = Object.getOwnPropertyDescriptor(v, k); } catch { return false; }
          if (!d || !('value' in d) || !d.enumerable) return false; // accessor = รอบหลังตอบต่างได้ → ปฏิเสธ (ไม่ invoke)
          if (!_stableJson(d.value, depth - 1)) return false;
        }
        return true;
      };
      const _graphStable = _protoNoToJSON(Object.prototype) && _protoNoToJSON(Array.prototype)
        && Array.isArray(meta) && meta.length >= 1 && meta.every((m) => _stableJson(m, 6));
      const _proofA = _graphStable ? _promptBudgetProof() : null;
      const _proofB = _graphStable ? _promptBudgetProof() : null;
      const _proofOk = !!_proofA && !!_proofB
        && _proofA.rowCount === meta.length && _proofB.rowCount === meta.length
        && _proofA.includedCount === meta.length && _proofB.includedCount === meta.length // เห็นครบทุกใบเท่านั้น
        && _proofA.budgetLen === _proofB.budgetLen
        && _proofA.lines.length === _proofB.lines.length
        && _proofA.lines.every((ln, i) => ln === _proofB.lines[i]) // byte-identical ต่อบรรทัด — ไม่ใช่แค่ id
        && _proofA.ids.length === _proofB.ids.length
        && _proofA.ids.every((v, i) => v === _proofB.ids[i]);
      const _dIds = _proofOk ? _proofA.ids : null;
      _dUniverse = (_dIds && _dIds.length >= 1 && _dIds.every((s) => typeof s === 'string' && s !== '') && new Set(_dIds).size === _dIds.length)
        ? _dIds
        : null;
    } catch { _dUniverse = null; }
  }

  // ★ WAVE1A (MEGA_REF_HERO_V2): PRE-BRAIN authority GATE (Fix #6). Under ON the SelectionAuthority governs
  //   S5→S6 BEFORE any brain/legacy slot selection: missing/invalid evidence ⇒ HOLD right here — the brain is
  //   NEVER called and NO selection mutation happens (fail-closed before S6). On success the frozen
  //   authority+bindings+spec is stashed and attached additively at the happy-path return. OFF/absent flag ⇒
  //   this block is skipped entirely (byte-identical legacy — the `let` below stays null).
  let _refHeroV2Patch = null;
  if (_refHeroV2On) {
    _refHeroV2Patch = semContract
      ? await _runRefHeroV2({ compass: job.dossier.compass, semContract, canonHeroId: _canonHeroId, semAuthorityHash: _semAuthorityHash, refDNA: _refDNA, refId: job.dossier.refMatch?.refId || job.dossier.refMatch?.dnaHash || null, gatedPool, deps: _deps })
      : _rhHold('REF_HERO_V2_NO_STRUCTURAL_SLOTS');
    if (_refHeroV2Patch.ok !== true) {
      return { status: 'waiting', nextAction: 'wait', quality: 'red', summary: `🔐⏸️ ref-hero-v2: ${_refHeroV2Patch.hold} — พักงานก่อนเลือกภาพ (S6 ยังไม่เริ่ม · flag ON, fail-closed)`, dossierPatch: { pickImages: { refHeroV2: _refHeroV2Patch } } };
    }
  }

  let brain = { slots: {}, note: '' };
  let brainOk = true;
  try {
    brain = await _brainFn({ imagesMeta: meta, compass: job.dossier.compass, deskTitle: job.dossier.desk?.title, refDNA: _refDNA, artBrief: (_jobTemplateV1 ? _templateArtBriefSnapshot : job.dossier.artBrief) || null, sceneInventory, ...(semContract ? { slotContract: semContract.slots } : {}) }); // เฟส 3.1: สมองเห็นแผนที่ฉาก · SEM-1: ส่งสัญญาช่องเมื่อ semantic ON เท่านั้น (OFF = args เดิมเป๊ะ) · ★ D3-B3.3: template path ใช้ local snapshot
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
    // ★ D-sidecar: ผลสมองที่ "รอด" veto gates (ซ้ำ/ตัวตน/ฉาก) ถึงตรงนี้ = 'llm' — ถ้า swap ด้านล่างเปลี่ยนตัวจริง
    //   จะทับเป็น 'policy_override' ที่ไซต์ mutation (ไม่เดาจาก reason string) · OFF = ตัวแปร local เฉยๆ ไม่มีผลใด
    let _dStage = _dEvidenceOn && img ? 'llm' : null;
    const _dPreSwap = _dEvidenceOn ? img : null;
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
    // ★ D-sidecar: solo-face swap / hero-size swap เปลี่ยนตัวจริง (reference เปลี่ยน) = 'policy_override' — ตรวจที่ไซต์จริง
    if (_dEvidenceOn && img && _dPreSwap && img !== _dPreSwap) _dStage = 'policy_override';
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
    // ★ D-sidecar: ได้ตัวจริงจากบล็อก fallback (ไม่ใช่สมอง/swap) = 'fallback'
    if (_dEvidenceOn && img && !_dStage) _dStage = 'fallback';
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
    // ★ D-sidecar: บันทึก trace ที่ไซต์ commit จริง (stage+id primitive) — id ไม่ใช่ primitive = null → finalize ตีตก
    if (_dEvidenceOn) {
      if (img && _dStage) _dTrace.set(slot, { stage: _dStage, id: _dIdOf(img.id) });
      else _dTrace.delete(slot);
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
        // ★ D-sidecar: ไซต์ story-rescue จริง — ทับ stage เดิมของช่องนี้ (ตัวจริงเปลี่ยนเป็น best แล้ว)
        if (_dEvidenceOn) _dTrace.set(slot, { stage: 'story_rescue', id: _dIdOf(best.id) });
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

  // ═══ LANE-C ROLE READINESS GATE (ON = _roleReadyOn) — fail-closed post-selection readiness ═══════════════════════════
  //   ON เท่านั้น: hero ต้อง "พร้อมจริง" ด้วยหลักฐานบวกที่รู้จริง (relevant/clean/หน้าเดี่ยว/ขนาดวัดได้≥เกณฑ์/แหล่งตรง/ตัวตน)
  //   + faceBox เด่น (mirror composer bigFace) + ครอปช่อง hero ได้จริง (มิเรอร์ crop-readiness math ในไฟล์ ตาม _slotUpEst).
  //   unknown/ขาดหลักฐานใดๆ = INSUFFICIENT เสมอ (ไม่ปั้น eligible ปลอม) — จึง "ฆ่า" keep-anyway heroSize fail-open และ
  //   identity-null→generic-fill ของช่อง _idGated โดยปิดงาน typed ก่อนถึง S7/คิว/โรงประกอบ · ทุกช่องผูกตัวตนต้องได้คนตามสัญญา.
  //   ทุกอย่างใต้ try/catch · return HOLD ไม่มี dossierPatch = ZERO downstream side effect (ไม่ mutate dossier/คิว/composer).
  //   OFF = ข้ามทั้งบล็อก byte-identical.
  if (_roleReadyOn) {
    const _rrPersons = (rec) => [rec?.triage?.person, ...((rec?.triage?.persons) || [])].filter(Boolean);
    // หลักฐานบวก "รู้จริง" ต่อ hero — เสริม _heroGradeOf (base predicate 1a) ที่ fail-open บาง unknown (clean/relevant/size)
    const _rrKnownHeroEvidence = (rec) => {
      const t = rec?.triage || {};
      if (t.relevant !== true) return false;                 // unknown/false relevant = insufficient
      if (t.clean !== true) return false;                    // unknown/false clean = insufficient
      if (Number(t.faceCount) !== 1) return false;           // unknown/≠1 single-face = insufficient
      if (rec.rehostQuality === 'thumbnail') return false;   // thumbnail-only = insufficient
      const rss = realShortSideOf(rec);
      if (!(rss != null && rss >= HERO_MIN_SHORT_SIDE)) return false; // unknown/เล็กกว่าเกณฑ์ measured size = insufficient
      if (!(rec.sourceLink || rec.source)) return false;     // unknown direct-source = insufficient
      return _heroGradeOf(rec) === true;                     // base predicate (directive 1a)
    };
    // faceBox prominence (mirror composer bigFace: สูง ≥0.16 + ขอบบน/ล่าง 0.01/0.99) — box หาย/พัง/นอก bound = null → insufficient
    const _rrFaceBox = (rec) => {
      const fb = rec?.triage?.faceBox;
      if (!fb || typeof fb !== 'object') return null;
      let x1; let y1; let x2; let y2;
      if ([fb.x1, fb.y1, fb.x2, fb.y2].every((v) => typeof v === 'number' && Number.isFinite(v))) {
        x1 = fb.x1; y1 = fb.y1; x2 = fb.x2; y2 = fb.y2;
      } else {
        const x = Number(fb.x); const y = Number(fb.y); const w = Number(fb.w ?? fb.width); const h = Number(fb.h ?? fb.height);
        if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
        x1 = x; y1 = y; x2 = x + w; y2 = y + h;
      }
      if (!(x2 > x1 && y2 > y1 && x1 >= 0 && y1 >= 0 && x2 <= 1.0001 && y2 <= 1.0001)) return null;
      return { x1, y1, x2: Math.min(1, x2), y2: Math.min(1, y2) };
    };
    const _rrBigFace = (b) => !!b && (b.y2 - b.y1) >= 0.16 && b.y1 >= 0.01 && b.y2 <= 0.99;
    // hero slot geometry (realized template px integer ใน 1080×1350) — consume evidence, fail-closed ถ้าไม่มี ref/โครง
    let _rrHeroGeo = null;
    try {
      if (_refDNA) {
        const _rt = await import('@/lib/refTemplate');
        const _dts = _rt.dnaToTemplateSpec || _rt.default?.dnaToTemplateSpec;
        const _spec = typeof _dts === 'function' ? _dts(_refDNA) : null;
        const _sl = Array.isArray(_spec?.slots) ? _spec.slots : [];
        _rrHeroGeo = _sl.find((s) => s.id === 'main' && s.shape !== 'circle')
          || _sl.filter((s) => s.shape !== 'circle').sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || null;
      }
    } catch { _rrHeroGeo = null; }
    // crop feasibility — LOCAL MIRROR ของ crop-readiness math (mirror imageQualityConfig/_slotUpEst constants locally):
    //   ★ invariant test บังคับให้โมดูล F/E (crop-readiness/search-quality) อยู่นอก runtime wiring ของไฟล์นี้ →
    //   จึงคำนวณเองในไฟล์: cover-fit upscale + hero short-side floor + positional faceBox containment (RECT).
    //   SAFE เท่านั้น = ครอปช่อง hero ได้จริง · หลักฐานหาย/ล้ม = false (insufficient).
    const _HERO_STRETCH_MAX = 1.2; // imageQualityConfig HERO_STRETCH_MAX (hero crop > 1.2× = แตก)
    const _rrCropSafeHero = (rec, geo, face) => {
      try {
        if (!geo || !face) return false;
        const rw = Number(rec.realWidth); const rh = Number(rec.realHeight);
        const sw = Number(geo.w); const sh = Number(geo.h);
        if (!(rw > 0 && rh > 0 && sw > 0 && sh > 0)) return false;    // dims/geo ไม่ครบ = insufficient
        const up = Math.max(sw / rw, sh / rh);                        // cover-fit upscale = max(slotW/fullW, slotH/fullH)
        if (up > _HERO_STRETCH_MAX + 1e-9) return false;              // ยืดเกิน 1.2× = insufficient
        if (Math.min(rw, rh) < HERO_MIN_SHORT_SIDE) return false;     // hero short-side floor (measured จริงเท่านั้น)
        const slotAspect = sw / sh; const srcAspect = rw / rh;        // positional containment (cover-fit centre gravity)
        let cropW; let cropH;
        if (slotAspect >= srcAspect) { cropW = 1; cropH = srcAspect / slotAspect; }
        else { cropH = 1; cropW = slotAspect / srcAspect; }
        const cx0 = (1 - cropW) / 2; const cy0 = (1 - cropH) / 2;     // หน้าต่างครอป centre ในภาพต้นทาง (normalized)
        const mx1 = (face.x1 - cx0) / cropW; const my1 = (face.y1 - cy0) / cropH; // map faceBox → crop-normalized
        const mx2 = (face.x2 - cx0) / cropW; const my2 = (face.y2 - cy0) / cropH;
        return mx1 >= 0 && my1 >= 0 && mx2 <= 1 && my2 <= 1 && mx2 > mx1 && my2 > my1; // RECT: box ต้องอยู่ในหน้าต่างเต็ม
      } catch { return false; }
    };
    // ── hero readiness (ทุกสัญญาณต้องเป็นบวกที่รู้จริง — AND) ──
    const _heroPick = slots[_canonHeroId];
    const _heroRec = _heroPick ? byId.get(String(_heroPick.id)) : null;
    const _heroFace = _heroRec ? _rrFaceBox(_heroRec) : null;
    const _heroIdOk = !!_heroRec && _rrPersons(_heroRec).length > 0 && _identityOk(_canonHeroId, _heroRec) && (semContract ? true : heroNames.length > 0);
    const _heroReady = !!_heroRec
      && _rrKnownHeroEvidence(_heroRec)
      && _rrBigFace(_heroFace)
      && _heroIdOk
      && _rrCropSafeHero(_heroRec, _rrHeroGeo, _heroFace);
    if (!_heroReady) {
      console.log('[MEGA S6] 🔒 role-readiness HOLD: INSUFFICIENT_HERO_GRADE (hero ไม่ผ่านหลักฐานพร้อมจริง — เกรด/หน้าเด่น/ตัวตน/ครอป)');
      return { status: 'failed', nextAction: 'fail', reason: 'INSUFFICIENT_HERO_GRADE', quality: 'red', summary: '🔒 role-readiness: INSUFFICIENT_HERO_GRADE — ไม่มี hero ที่พร้อมจริง (เกรด/หน้าเด่น/ตัวตน/ครอปช่องได้) — พักงานก่อนดำเนินต่อ' };
    }
    // ── identity-bound slots (นอกเหนือ hero) ต้องได้คนตามสัญญาจริง (unknown/ไม่มีคน = INSUFFICIENT) ──
    let _idBad = null;
    for (const _s of activeSlots) {
      if (_isHeroSlot(_s) || !_idGated(_s)) continue;
      const _pick = slots[_s];
      const _rec = _pick ? byId.get(String(_pick.id)) : null;
      if (!_rec || _rrPersons(_rec).length === 0 || !_identityOk(_s, _rec)) { _idBad = _s; break; }
    }
    if (_idBad) {
      console.log(`[MEGA S6] 🔒 role-readiness HOLD: INSUFFICIENT_SLOT_IDENTITY (ช่อง ${_idBad} ไม่มีคนตาม ref identity)`);
      return { status: 'failed', nextAction: 'fail', reason: 'INSUFFICIENT_SLOT_IDENTITY', quality: 'red', summary: `🔒 role-readiness: INSUFFICIENT_SLOT_IDENTITY — ช่อง ${_idBad} ไม่มีคนตาม ref identity — พักงานก่อนดำเนินต่อ` };
    }
    // ── verdict counts (1d additive) — numbers only ──
    let _idT = 0; let _idR = 0;
    for (const _s of activeSlots) {
      if (!_idGated(_s)) continue;
      _idT++;
      const _p = slots[_s]; const _r = _p ? byId.get(String(_p.id)) : null;
      if (_r && _identityOk(_s, _r)) _idR++;
    }
    _roleReadinessCounts = { heroReady: 1, slotsTotal: activeSlots.length, slotsFilled: activeSlots.filter((s) => slots[s]).length, idGatedTotal: _idT, idGatedReady: _idR };
  }

  // ═══ D-sidecar FINALIZE — หลัง story-rescue + บล็อกเติม backup เสร็จ (แผนตัวจริงนิ่งแล้ว) · ก่อน solver-shadow เริ่ม ═══
  //   candidateCount/chosenIndex มาจาก "จักรวาลก้อนเดียว" ที่จับไว้ก่อนสมองเท่านั้น · ทุกช่อง active ต้องมีตัวจริง +
  //   trace ตรงตัวจริง + id อยู่ในจักรวาล — ขาดข้อเดียว/producer เพี้ยน/throw = omit ทั้ง sidecar (ผลธุรกิจเดิม 100%) ·
  //   dynamic-import producer เฉพาะเมื่อ trace ครบจริงเท่านั้น · ไม่ serialize id ดิบ/trace ดิบออก output ใดๆ
  if (_dEvidenceOn) {
    try {
      if (_dUniverse) {
        const _dIndexOf = new Map(_dUniverse.map((id, i) => [id, i]));
        const _dRows = [];
        let _dComplete = activeSlots.length >= 1;
        for (let i = 0; i < activeSlots.length; i++) {
          const _dSlot = activeSlots[i];
          const _dRec = _dTrace.get(_dSlot);
          const _dFinalId = slots[_dSlot] ? _dIdOf(slots[_dSlot].id) : null;
          if (_dFinalId == null || !_dRec || _dRec.id !== _dFinalId) { _dComplete = false; break; } // ช่องว่าง/trace ไม่ตรงตัวจริง
          const _dIdx = _dIndexOf.get(_dFinalId);
          if (_dIdx === undefined) { _dComplete = false; break; } // ตัวจริงอยู่นอกจักรวาลที่สมองเห็น → omit ทั้งก้อน
          _dRows.push({
            slotIndex: i, // dense ตามลำดับ activeSlots ต้นทาง
            slot: _isHeroSlot(_dSlot) ? 'hero' : (_isCircleSlot(_dSlot) ? 'circle' : 'support'), // บทจาก slot/geometry ที่ validate แล้วเท่านั้น
            stage: _dRec.stage,
            candidateCount: _dUniverse.length,
            chosenIndex: _dIdx,
          });
        }
        if (_dComplete) {
          const _dProduce = (typeof _deps?.produceFinalDecisionEvidence === 'function')
            ? _deps.produceFinalDecisionEvidence
            : (await import('./postSelectionDecisionProducer.js')).produceFinalDecisionEvidence;
          const _dRes = _dProduce({ version: 2, slotCount: _dRows.length, slots: _dRows });
          if (_dRes && _dRes.decisionComplete === true && _dRes.evidence && typeof _dRes.evidence === 'object') _dSidecar = _dRes.evidence;
        }
      }
    } catch { _dSidecar = null; } // ทุกความล้มเหลว = omit เงียบ — ห้ามแตะผลธุรกิจ/asset/backup แม้ byte เดียว
  }
  // ★ LANE-C (1d): แนบ readiness verdict counts เข้า D-sidecar เฉพาะเมื่อ readiness ON + D-sidecar มีจริง (numbers only) —
  //   ไม่ mutate ก้อนเดิม (spread เป็น object ใหม่) · OFF ทั้งคู่ = ไม่แตะ _dSidecar เลย (byte-identical)
  if (_roleReadyOn && _dEvidenceOn && _dSidecar && _roleReadinessCounts) {
    try { _dSidecar = { ..._dSidecar, roleReadiness: _roleReadinessCounts }; } catch { /* ไม่กระทบผลธุรกิจ */ }
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
      const orders = (_jobTemplateV1 ? _templateArtBriefSnapshot : job.dossier.artBrief)?.orders || []; // ★ D3-B3.3: template path ใช้ local snapshot (solver/diagnostics)
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
                ...(_jobTemplateV1 ? { mode: 'template_v1' } : {}), // ★ D3-B2: marked job = persisted mode ไม่ใช่ legacy
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
    // ★ D-sidecar: hero ว่าง = trace ปกติไม่ครบ → _dSidecar มักเป็น null (spread ด้านล่างจึง omit เอง) — ห้ามฝืนแนบของไม่ครบ
    return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพตัวเอกที่ถูกคนเลย — ห้ามฝืนทำปกผิดคน', quality: 'red', ...(_dSidecar ? { decisionEvidence: _dSidecar } : {}), dossierPatch: { ...(_jobTemplateV1 ? { artBrief: _templateArtBriefSnapshot } : {}), pickImages: { slots, note: brain.note || '', ...(semContract ? { semanticSelection: true, slotOrder: _slotOrder, heroSlotId: _canonHeroId, slotContractHash: _semAuthorityHash } : {}), ...(_jobTemplateV1 ? { refShotAuthority: cloneRefShotMarker(_jobRefShotMarker) } : {}), ...(solverShadow ? { solverShadow } : {}), ...(solverShadowV2 ? { solverShadowV2 } : {}) } } };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // R1 — SHADOW CANDIDATE LEDGER (kill switch: MEGA_CANDIDATE_LEDGER=1 · exact opt-in)
  //   ⚠️ DIAGNOSTIC-ONLY. บันทึก "สิ่งที่ตัวเลือกเห็น" เพื่อสืบสวนคุณภาพเท่านั้น —
  //   ❌ ห้ามย้าย/อ่านเข้าเส้น authority/payload ใดๆ: pickImages.slots · slotPlan · SelectionSpec ·
  //      refSlotContract · manifest · queue rawBody · *Hash ทุกตัว. อ่านล้วน ไม่แตะการเลือก/QC/เลย์เอาต์.
  //   ── LIFECYCLE (write-once) ──
  //   • FRESH OFF (env !== '1') = inert เต็มตัว: ไม่แตะ property candidateLedger เลย ไม่ emit field ใหม่ → byte เท่า legacy.
  //   • ON: ตรวจ own-enumerable DATA descriptor ของ candidateLedger บน local im เท่านั้น (ไม่เรียก accessor/inherited):
  //       valid v1 bounded snapshot → คงไว้ verbatim (ไม่คิดใหม่) · invalid carrier → ไม่ normalize/ไม่คิดใหม่ (ปล่อยผ่าน merge) · ไม่มี → คิดใหม่ครั้งเดียว.
  //   • snapshot ที่ persist แล้ว survive ผ่าน dossier merge ปกติ · S7 ไม่เคยเขียน images · ล้ม = field หาย (fail-safe).
  //   Deterministic: ไม่มี Date/random/IO/LLM.
  let _candidateLedger = null;
  let _ledgerPresent = false;        // ★ มี ledger จะ emit (fresh/VALID/INVALID_SAFE) — track แยกเพราะ clone อาจเป็น primitive falsy (null/false)
  let _ledgerImagesBase = null;      // ★ accessor-safe images base (สร้างเมื่อ ledger พร้อม) — ไม่ spread im ตรงๆ
  let _ledgerInspectFailed = false;  // ★ ON-path descriptor/proxy inspection ล้ม → ห้าม fall-back legacy spread (im อาจ hostile)
  if (process.env.MEGA_CANDIDATE_LEDGER === '1') {
    try {
      const _LDG_MAX_ROWS = 30, _LDG_MAX_BYTES = 8192, _LDG_MAX_STR = 256, _LDG_MAX_ARR = 200, _LDG_MAX_DEPTH = 8, _LDG_MAX_KEYS = 64, _LDG_MAX_NODES = 20000;
      // URL-like: //cdn, data:/blob:/file:, http(s), scheme, image-ext
      const _urlLike = (t) => /^\s*(?:\/\/|(?:https?|data|blob|file):)/i.test(t) || /https?:\/\/|www\.|:\/\/|\.(jpe?g|png|webp|gif|bmp|svg)(\?|#|$)/i.test(t);
      const _REJECT = Symbol('reject');
      // bounded recursive own-DATA CLONE — สร้าง object/array ใหม่จาก descriptor.value เท่านั้น (ไม่ get/toJSON/live read)
      //   reject: accessor/function/symbol/bigint/undefined/cycle/nonfinite/exotic-proto/URL/overlong key+value/เกิน depth/array/keys/nodes
      const _clone = (o, depth, seen, cnt) => {
        if (depth > _LDG_MAX_DEPTH) return _REJECT;
        if (++cnt.n > _LDG_MAX_NODES) return _REJECT;
        if (o === null) return null;
        const t = typeof o;
        if (t === 'boolean') return o;
        if (t === 'number') return Number.isFinite(o) ? o : _REJECT;
        if (t === 'string') return (o.length <= _LDG_MAX_STR && !_urlLike(o)) ? o : _REJECT;
        if (t !== 'object') return _REJECT; // function/symbol/bigint/undefined
        if (seen.has(o)) return _REJECT;    // cycle
        seen.add(o);
        const proto = Object.getPrototypeOf(o);
        const isArr = Array.isArray(o);
        if (isArr ? proto !== Array.prototype : (proto !== Object.prototype && proto !== null)) { seen.delete(o); return _REJECT; }
        let out;
        if (isArr) {
          const lenD = Object.getOwnPropertyDescriptor(o, 'length');
          if (!lenD || lenD.get || lenD.set || typeof lenD.value !== 'number' || !Number.isInteger(lenD.value) || lenD.value > _LDG_MAX_ARR) { seen.delete(o); return _REJECT; }
          const len = lenD.value;
          out = [];
          for (let i = 0; i < len; i++) {
            const d = Object.getOwnPropertyDescriptor(o, String(i));
            if (!d || d.get || d.set || !('value' in d)) { seen.delete(o); return _REJECT; }
            const cv = _clone(d.value, depth + 1, seen, cnt);
            if (cv === _REJECT) { seen.delete(o); return _REJECT; }
            out.push(cv);
          }
          for (const k of Reflect.ownKeys(o)) { if (k === 'length') continue; if (typeof k === 'symbol') { seen.delete(o); return _REJECT; } const ki = Number(k); if (!(Number.isInteger(ki) && ki >= 0 && ki < len)) { seen.delete(o); return _REJECT; } }
        } else {
          const keys = Reflect.ownKeys(o);
          if (keys.length > _LDG_MAX_KEYS) { seen.delete(o); return _REJECT; }
          out = {}; // normal proto (deepStrictEqual-friendly) — กัน pollution ด้วย reject __proto__/prototype/constructor + defineProperty (ไม่ใช่ out[k]=)
          for (const k of keys) { // preserve insertion order → JSON bytes เดิม
            if (typeof k === 'symbol' || k.length > _LDG_MAX_KEYS || _urlLike(k)) { seen.delete(o); return _REJECT; }
            if (k === '__proto__' || k === 'prototype' || k === 'constructor') { seen.delete(o); return _REJECT; } // prototype-pollution keys
            const d = Object.getOwnPropertyDescriptor(o, k);
            if (!d || d.get || d.set || d.enumerable !== true || !('value' in d)) { seen.delete(o); return _REJECT; }
            const cv = _clone(d.value, depth + 1, seen, cnt);
            if (cv === _REJECT) { seen.delete(o); return _REJECT; }
            Object.defineProperty(out, k, { value: cv, enumerable: true, writable: true, configurable: true });
          }
        }
        seen.delete(o);
        return out;
      };
      // v1 schema/invariants — ตรวจบน CLONE (plain, own-data) เท่านั้น (import-free local) · ทุก schema field เป็น OWN (inherited ไม่นับ)
      const _int0 = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
      const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const _numOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
      const _boolOrNull = (v) => v === null || typeof v === 'boolean';
      const _strMax = (v, n) => typeof v === 'string' && v.length <= n && !_urlLike(v);
      const _strMaxOrNull = (v, n) => v === null || _strMax(v, n);
      const _onlyKeys = (o, set) => { for (const k of Object.keys(o)) if (!set.has(k)) return false; return true; };
      const _REASONS = new Set(['SELECTED', 'ELIGIBLE', 'REJECT_IRRELEVANT', 'REJECT_DIRTY', 'REJECT_PERSON_MISS', 'REJECT_PERSON_AMBIGUOUS', 'REJECT_FACE_NONE', 'REJECT_MULTIFACE', 'REJECT_THUMBNAIL', 'REJECT_UNDERSIZE', 'REJECT_SHARPNESS', 'METADATA_INSUFFICIENT']);
      const _MATCHKINDS = new Set(['exact', 'alias', 'token_fallback', 'ambiguous', 'miss', null]);
      const _METAS = new Set(['OK', 'METADATA_INSUFFICIENT']);
      const _ROLESET = new Set(['hero', 'reaction', 'action', 'context', 'circle']);
      const _SOURCES = new Set([null, 'contract', 'order', 'compass_hero', 'compass_sole_nonhero']);
      const _ORIENTS = new Set([null, 'wide', 'tall', 'sq']);
      const _UNKF = new Set(['relevant', 'clean', 'faceCount', 'dims', 'faceFrac', 'sharpness', 'identity']);
      const _TOPK = new Set(['v', 'poolSize', 'capped', 'droppedRows', 'roles']);
      const _ROLEK = new Set(['role', 'slotId', 'targetPerson', 'targetSource', 'selectedId', 'totalRows', 'keptRows', 'droppedRows', 'reasonCounts', 'rows']);
      const _ROWFIXED = ['id', 'person', 'matchKind', 'metadataState', 'faceFrac', 'dims', 'measuredFrom', 'orient', 'clean', 'largeText', 'watermark', 'newsScene', 'faceCount', 'quality', 'pHash', 'heroGrade', 'reason', 'selected', 'estimatedUpscale'];
      const _ROWK = new Set([..._ROWFIXED, 'persons', 'matchedLabel', 'unknownFields']);
      // dims: positive-finite W×H เป๊ะ (สองส่วนตัวเลข ไม่มี whitespace/extra) — reject malformed · คืน { short }
      const _parseDims = (d) => {
        if (typeof d !== 'string') return null;
        const p = d.split('x');
        if (p.length !== 2) return null;
        const re = /^[0-9]+(\.[0-9]+)?$/;
        if (!re.test(p[0]) || !re.test(p[1])) return null;
        const w = Number(p[0]), h = Number(p[1]);
        if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return null;
        return { short: Math.min(w, h) };
      };
      // priority prerequisites (จากลำดับ _reasonOf): IRRELEVANT<DIRTY<PERSON_MISS<PERSON_AMBIGUOUS<FACE_NONE<MULTIFACE<THUMBNAIL<UNDERSIZE<SHARPNESS<INSUFFICIENT<ELIGIBLE
      const _AFTER_DIRTY = new Set(['REJECT_PERSON_MISS', 'REJECT_PERSON_AMBIGUOUS', 'REJECT_FACE_NONE', 'REJECT_MULTIFACE', 'REJECT_THUMBNAIL', 'REJECT_UNDERSIZE', 'REJECT_SHARPNESS', 'METADATA_INSUFFICIENT', 'ELIGIBLE']);
      const _AFTER_PERSON = new Set(['REJECT_FACE_NONE', 'REJECT_MULTIFACE', 'REJECT_THUMBNAIL', 'REJECT_UNDERSIZE', 'REJECT_SHARPNESS', 'METADATA_INSUFFICIENT', 'ELIGIBLE']);
      const _AFTER_FACE = new Set(['REJECT_THUMBNAIL', 'REJECT_UNDERSIZE', 'REJECT_SHARPNESS', 'METADATA_INSUFFICIENT', 'ELIGIBLE']);
      const _validRow = (row, role, targetPerson) => {
        if (!row || typeof row !== 'object' || Array.isArray(row) || !_onlyKeys(row, _ROWK)) return false;
        for (const k of _ROWFIXED) if (!_own(row, k)) return false; // fixed ครบ (missing matchKind = invalid)
        if (!_strMax(row.id, 64) || !_strMaxOrNull(row.person, 48)) return false;
        if (!_MATCHKINDS.has(row.matchKind) || !_METAS.has(row.metadataState) || !_REASONS.has(row.reason)) return false;
        if (!(row.faceFrac === null || (typeof row.faceFrac === 'number' && Number.isFinite(row.faceFrac) && row.faceFrac > 0 && row.faceFrac <= 1))) return false;
        const _pd = row.dims === null ? null : _parseDims(row.dims);
        if (!(row.dims === null || (typeof row.dims === 'string' && row.dims.length <= 24 && _pd !== null))) return false; // non-null dims ต้อง parse ได้
        if (!_strMaxOrNull(row.measuredFrom, 24) || !_strMaxOrNull(row.pHash, 32)) return false;
        if (!_ORIENTS.has(row.orient)) return false;
        if (!_boolOrNull(row.clean) || !_boolOrNull(row.largeText) || !_boolOrNull(row.watermark) || !_boolOrNull(row.newsScene) || !_boolOrNull(row.heroGrade)) return false;
        if (!_numOrNull(row.faceCount) || !_numOrNull(row.quality)) return false;
        if (typeof row.selected !== 'boolean' || row.estimatedUpscale !== null) return false;
        if (_own(row, 'persons')) { const p = row.persons; if (!Array.isArray(p) || p.length < 1 || p.length > 4) return false; for (const s of p) if (!_strMax(s, 48)) return false; }
        if (_own(row, 'matchedLabel') && !_strMaxOrNull(row.matchedLabel, 48)) return false;
        const uf = _own(row, 'unknownFields') ? row.unknownFields : null;
        if (uf !== null) { if (!Array.isArray(uf) || uf.length < 1 || uf.length > 8) return false; const seen = new Set(); for (const f of uf) { if (!_UNKF.has(f) || seen.has(f)) return false; seen.add(f); } }
        const has = (f) => uf !== null && uf.includes(f);
        const portrait = role === 'hero' || role === 'circle';
        // ── unknownFields observable truth (จาก _unknownFields production) — relevant ไม่ persist จึงไม่ cross-check ──
        if ((row.clean === null) !== has('clean')) return false;                                     // clean null ⟺ uf 'clean'
        if ((row.dims === null) !== has('dims')) return false;                                       // dims null ⟺ uf 'dims'
        if (portrait) {
          if ((row.faceCount === null) !== has('faceCount')) return false;
          if ((row.faceFrac === null) !== has('faceFrac')) return false;
        } else if (has('faceCount') || has('faceFrac')) return false;                                // non-portrait ห้ามมี face unknowns
        if (has('sharpness') && role !== 'hero') return false;                                       // sharpness เฉพาะ hero
        if (has('identity')) {
          if (targetPerson === null || row.matchKind !== null) return false;                         // identity ต้องมี target + matchKind null
          const usable = (row.person != null && String(row.person).trim() !== '') || (_own(row, 'persons') && Array.isArray(row.persons) && row.persons.some((s) => String(s).trim() !== '')) || (row.matchedLabel != null && String(row.matchedLabel).trim() !== '');
          if (usable) return false;                                                                  // ต้องไม่มี label ใช้ได้ — persons นับ usable เฉพาะ .some(trim) (ยอมรับ ['','  '] จาก production)
        }
        // ── metadataState ↔ unknownFields ──
        if (row.metadataState === 'METADATA_INSUFFICIENT' && uf === null) return false;              // INSUFFICIENT ต้องมี uf
        if (row.metadataState === 'OK' && uf !== null) return false;                                 // OK ห้ามมี uf
        // ── reason relationships (one-way จาก _reasonOf) ──
        if ((row.selected === true) !== (row.reason === 'SELECTED')) return false;                   // selected ⟺ SELECTED
        if (row.reason === 'ELIGIBLE' && row.metadataState !== 'OK') return false;
        if (row.reason === 'METADATA_INSUFFICIENT' && row.metadataState !== 'METADATA_INSUFFICIENT') return false;
        if (row.reason === 'REJECT_PERSON_MISS' && row.matchKind !== 'miss') return false;
        if (row.reason === 'REJECT_PERSON_AMBIGUOUS' && row.matchKind !== 'ambiguous') return false;
        if (row.reason === 'REJECT_DIRTY' && row.clean !== false) return false;
        if (row.reason === 'REJECT_FACE_NONE' && !(portrait && row.faceCount === 0)) return false;
        if (row.reason === 'REJECT_MULTIFACE' && !(portrait && typeof row.faceCount === 'number' && row.faceCount > 1)) return false;
        if ((row.reason === 'REJECT_THUMBNAIL' || row.reason === 'REJECT_UNDERSIZE' || row.reason === 'REJECT_SHARPNESS') && role !== 'hero') return false;
        // ── nonselected priority prerequisites (reason ทีหลัง gate ⟹ gate ก่อนหน้าไม่ trigger) ──
        if (row.selected !== true) {
          if (_AFTER_DIRTY.has(row.reason) && row.clean === false) return false;
          if (_AFTER_PERSON.has(row.reason) && (row.matchKind === 'miss' || row.matchKind === 'ambiguous')) return false;
          if (_AFTER_FACE.has(row.reason) && portrait && (row.faceCount === 0 || (typeof row.faceCount === 'number' && row.faceCount > 1))) return false;
        }
        // ── ELIGIBLE prerequisites (ผ่านทุก gate) ──
        if (row.reason === 'ELIGIBLE') {
          if (row.clean !== true || row.matchKind === 'miss' || row.matchKind === 'ambiguous') return false;
          if (portrait && (row.faceCount === 0 || (typeof row.faceCount === 'number' && row.faceCount > 1))) return false;
          if (role === 'hero') {
            if (row.faceCount !== 1 || row.heroGrade !== true) return false;
            if (_pd === null || _pd.short < HERO_MIN_SHORT_SIDE) return false;                        // hero ELIGIBLE มี dims non-null (metadata OK) → short >= 700
          }
        }
        // ── heroGrade === true one-way consistency ──
        if (row.heroGrade === true) {
          if (row.clean !== true || row.faceCount !== 1) return false;
          if (has('relevant') || has('clean') || has('faceCount') || has('sharpness')) return false;
          if (row.dims !== null && (_pd === null || _pd.short < HERO_MIN_SHORT_SIDE)) return false;   // dims non-null → short >= 700 (dims null ยอมได้: realShortSide)
        }
        if (targetPerson === null && row.matchKind !== null) return false;                           // targetPerson null ⇒ matchKind null
        return true;
      };
      const _validV1 = (c) => {
        if (!c || typeof c !== 'object' || Array.isArray(c) || !_onlyKeys(c, _TOPK)) return false;
        for (const k of _TOPK) if (!_own(c, k)) return false;
        if (c.v !== 1 || !_int0(c.poolSize) || c.poolSize > 80 || typeof c.capped !== 'boolean' || !_int0(c.droppedRows)) return false;
        if (!Array.isArray(c.roles) || c.roles.length < 1 || c.roles.length > 8) return false;
        let globalDropped = 0, globalRows = 0;
        for (const r of c.roles) {
          if (!r || typeof r !== 'object' || Array.isArray(r) || !_onlyKeys(r, _ROLEK)) return false;
          for (const k of _ROLEK) if (!_own(r, k)) return false;
          if (!_ROLESET.has(r.role) || !_strMax(r.slotId, 64)) return false;
          if (!_strMaxOrNull(r.targetPerson, 48) || !_strMaxOrNull(r.selectedId, 64) || !_SOURCES.has(r.targetSource)) return false;
          // target/source relationships: source null ⟺ target null (ยกเว้น contract-null) · order/compass ต้องมี target · compass_hero=hero · compass_sole_nonhero=reaction/circle · null target + compass = invalid
          { const tp = r.targetPerson, ts = r.targetSource;
            if (ts === null) { if (tp !== null) return false; }
            else if (ts === 'order') { if (tp === null) return false; }
            else if (ts === 'compass_hero') { if (tp === null || r.role !== 'hero') return false; }
            else if (ts === 'compass_sole_nonhero') { if (tp === null || !(r.role === 'reaction' || r.role === 'circle')) return false; } }
          if (!_int0(r.totalRows) || !_int0(r.keptRows) || !_int0(r.droppedRows)) return false;
          if (!Array.isArray(r.rows) || r.rows.length !== r.keptRows || r.rows.length > _LDG_MAX_ROWS) return false;
          if (r.totalRows !== r.keptRows + r.droppedRows || r.totalRows !== c.poolSize) return false;
          if (!r.reasonCounts || typeof r.reasonCounts !== 'object' || Array.isArray(r.reasonCounts) || !_onlyKeys(r.reasonCounts, _REASONS)) return false;
          let rcSum = 0;
          for (const k of Object.keys(r.reasonCounts)) { const v = r.reasonCounts[k]; if (!_int0(v)) return false; rcSum += v; }
          if (rcSum !== r.totalRows) return false;
          const retFreq = {}; let selCount = 0, selRowId = null;
          for (const row of r.rows) {
            if (!_validRow(row, r.role, r.targetPerson)) return false;
            retFreq[row.reason] = (retFreq[row.reason] || 0) + 1;
            if (row.selected === true) { selCount++; selRowId = row.id; }
          }
          for (const k of Object.keys(retFreq)) if (!_own(r.reasonCounts, k) || retFreq[k] > r.reasonCounts[k]) return false; // reasonCounts dominates retained
          if (rcSum - r.rows.length !== r.droppedRows) return false;                                 // aggregate diff === droppedRows
          if ((_own(r.reasonCounts, 'SELECTED') ? r.reasonCounts.SELECTED : 0) !== selCount) return false; // SELECTED never trimmed
          if (r.selectedId === null) { if (selCount !== 0) return false; } else if (selCount !== 1 || selRowId !== r.selectedId) return false;
          globalDropped += r.droppedRows; globalRows += r.rows.length;
        }
        if (globalRows > _LDG_MAX_ROWS * 8) return false;
        if (c.droppedRows !== globalDropped || c.capped !== (c.droppedRows > 0)) return false;
        return true;
      };
      // discriminated inspection: UNSAFE (exception/reject/over-cap) → omit · VALID/INVALID_SAFE → emit SAFE CLONE (deep value เดิม, reference ใหม่) — ไม่คืน carrier เดิม, ไม่ recompute/normalize/repair
      const _inspectCarrier = (o) => {
        let c;
        try { c = _clone(o, 0, new Set(), { n: 0 }); } catch { return { state: 'UNSAFE' }; }   // descriptor/proxy exception
        if (c === _REJECT) return { state: 'UNSAFE' };                                          // accessor/function/symbol/cycle/exotic/proto-key/URL/over-node
        let bytes; try { bytes = Buffer.byteLength(JSON.stringify({ candidateLedger: c }), 'utf8'); } catch { return { state: 'UNSAFE' }; }
        if (bytes > _LDG_MAX_BYTES) return { state: 'UNSAFE' };                                  // over byte cap
        return { state: _validV1(c) ? 'VALID' : 'INVALID_SAFE', clone: c };
      };
      // ตรวจ carrier เดิมผ่าน OWN DATA descriptor เท่านั้น (local im — ไม่ touch job.dossier.images ซ้ำ, ไม่เรียก getter/inherited)
      const _desc = Object.getOwnPropertyDescriptor(im, 'candidateLedger');
      const _hasOwnData = !!_desc && !_desc.get && !_desc.set && _desc.enumerable === true && Object.prototype.hasOwnProperty.call(_desc, 'value');
      if (_hasOwnData) {
        const _r = _inspectCarrier(_desc.value);
        if (_r.state === 'UNSAFE') { _ledgerInspectFailed = true; }                             // omit — carrier ไม่ปลอดภัย (proxy/accessor/proto/URL/over-cap)
        else { _candidateLedger = _r.clone; _ledgerPresent = true; }                            // VALID + INVALID_SAFE → preserve write-once ด้วย safe clone (reference ใหม่)
      } else {
        const _sharpGate = process.env.MEGA_SHARPNESS_GATE !== '0'; // call-time (โปรดักชัน env นิ่ง = เท่า SHARPNESS_GATE_ON) — telemetry + เทส gate-off
        const _eb = (v) => (v === true ? true : v === false ? false : null);
        const _en = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const _pnum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null); // ขนาดจริง: positive finite เท่านั้น
        const _norm = (s) => String(s || '').replace(/[()"'“”]/g, ' ').replace(/\s+/g, ' ').trim();
        const _base = (s) => _norm(String(s || '').replace(/\(.*?\)/g, ' ')); // ชื่อฐานนอกวงเล็บ
        const _clip = (s, n) => { if (s == null) return null; const t = String(s); if (_urlLike(t)) return null; return t.length > n ? t.slice(0, n) : t; };
        // id: URL-like/ยาวเกิน → token แฮชคงที่ (ไม่ persist ข้อความ URL/ยาวดิบ) · สั้นปกติ → คงเดิม
        const _clipId = (s) => { const t = String(s ?? ''); return (_urlLike(t) || t.length > 64) ? ('id#' + String(_dnaHashFor({ i: t }) || '0')) : t; };
        // faceFrac = พื้นที่กล่องหน้า (w×h) — ต้อง finite primitive ใน normalized bounds (0,1] มิฉะนั้น null (ไม่เดา)
        const _ff = (x) => {
          const b = x?.triage?.faceBox; if (!b || typeof b !== 'object') return null;
          const w = b.w ?? b.width, h = b.h ?? b.height;
          if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h)) return null;
          if (!(w > 0 && w <= 1 && h > 0 && h <= 1)) return null;
          const v = Math.round(w * h * 1000) / 1000;
          return v > 0 ? v : null; // ปัดแล้ว 0 (หน้าเล็กจิ๋ววัดไม่ได้) → null (คง invariant faceFrac >0)
        };
        const _dims = (x) => { const rw = _pnum(x?.realWidth), rh = _pnum(x?.realHeight); if (rw == null || rh == null) return null; const s = `${rw}x${rh}`; return s.length <= 24 ? s : null; };
        const _rssExplicit = (x) => {
          const rw = _pnum(x?.realWidth), rh = _pnum(x?.realHeight);
          if (rw != null && rh != null) return Math.min(rw, rh);
          return _pnum(x?.triage?.realShortSide);
        };
        const _orient = (x) => { const w = _pnum(x?.width), h = _pnum(x?.height); return (w != null && h != null) ? (w / h > 1.15 ? 'wide' : (w / h < 0.87 ? 'tall' : 'sq')) : null; };
        const _portrait = (role) => role === 'hero' || role === 'circle';
        // heroGrade: hard-fail ก่อน → required ไม่ครบ=null → ครบถึง true · relevant ต้อง explicit true · เคารพ sharpness gate
        const _heroGradeObs = (x) => {
          const relevant = _eb(x?.triage?.relevant), clean = _eb(x?.triage?.clean), fc = _en(x?.triage?.faceCount), rss = _rssExplicit(x), sharp = _en(x?.triage?.sharpness);
          if (relevant === false) return false;
          if (clean === false) return false;
          if (fc != null && fc !== 1) return false;
          if (x?.rehostQuality === 'thumbnail') return false;
          if (rss != null && rss < HERO_MIN_SHORT_SIDE) return false;
          if (_sharpGate && sharp != null && sharp < SHARPNESS_MIN_HERO) return false;
          if (relevant !== true) return null;               // relevant ไม่รู้ → null (ต้อง explicit true ถึง true ได้)
          if (clean == null || fc == null || rss == null) return null;
          if (_sharpGate && sharp == null) return null;      // gate on + sharpness ไม่รู้ = หลักฐานไม่ครบ
          return true;
        };
        // เจตนา "คนของบทบาท" — role-aware + conservative unique-alias clustering (identity ไม่ใช่ชื่อดิบ)
        const _chars = (job.dossier.compass?.mainCharacters || []).map((c) => _norm(c?.name)).filter(Boolean);
        const _uniqChars = [...new Set(_chars)];
        const _tk = (s) => _nameTokens(s); // strip titles
        // a เป็น proper-subset alias ของ b: สั้นกว่า, leading token เท่ากัน, ทุก token ของ a อยู่ใน b
        const _subsetAlias = (a, b) => { const ta = _tk(a), tb = _tk(b); if (!ta.length || ta.length >= tb.length) return false; if (ta[0] !== tb[0]) return false; return ta.every((t) => tb.includes(t)); };
        const _par = _uniqChars.map((_, i) => i);
        const _find = (i) => { while (_par[i] !== i) { _par[i] = _par[_par[i]]; i = _par[i]; } return i; };
        // collapse เฉพาะ alias สั้น↔ยาว "unique" (ชนหลายชื่อ = ไม่ collapse → คงกำกวม) · สมชาย-ใจดี/ใจร้าย ไม่ subset กัน = คนละคน
        for (let i = 0; i < _uniqChars.length; i++) { const fulls = []; for (let j = 0; j < _uniqChars.length; j++) if (j !== i && _subsetAlias(_uniqChars[i], _uniqChars[j])) fulls.push(j); if (fulls.length === 1) { const a = _find(i), b = _find(fulls[0]); if (a !== b) _par[a] = b; } }
        const _rootOfName = (nm) => { const i = _uniqChars.indexOf(_norm(nm)); return i < 0 ? -1 : _find(i); };
        const _canonOfRoot = (root) => { let best = null; for (let i = 0; i < _uniqChars.length; i++) if (_find(i) === root) { const c = _uniqChars[i]; if (best == null || _tk(c).length > _tk(best).length || (_tk(c).length === _tk(best).length && (c.length > best.length || (c.length === best.length && c < best)))) best = c; } return best; };
        const _heroNames = _heroRoleNamesOf(job).map(_norm).filter(Boolean);
        const _heroRoots = new Set(_heroNames.map(_rootOfName).filter((r) => r >= 0));
        const _nonHeroRoots = [...new Set(_uniqChars.map((_, i) => _find(i)))].filter((r) => !_heroRoots.has(r));
        const _heroTarget = _heroRoots.size === 1 ? (_canonOfRoot([..._heroRoots][0]) || _heroNames[0]) : null; // >1 distinct hero identity → null (compass ambiguous)
        const _reactTarget = _nonHeroRoots.length === 1 ? _canonOfRoot(_nonHeroRoots[0]) : null; // >1 identity = ambiguous → null
        // frozen orders: template mode = snapshot (ไม่ใช่ live) · role ซ้ำ = ambiguous (ไม่จับ first)
        const _ordersSrc = (_jobTemplateV1 ? _templateArtBriefSnapshot?.orders : job.dossier.artBrief?.orders) || [];
        // person labels — ตัด blank/whitespace ทิ้ง (ถือว่า absent)
        const _labelsOf = (x) => {
          const out = [];
          const _add = (v) => { if (v != null && _norm(v)) out.push(String(v)); };
          _add(x?.triage?.person);
          if (Array.isArray(x?.triage?.persons)) for (const p of x.triage.persons) _add(p);
          return out;
        };
        // matchKind ต่อ label เดียว — exact (normalized ==) ก่อน ambiguity · distinctHits นับ identity group (alias นับครั้งเดียว)
        const _matchKindOne = (lab, target) => {
          const nc = _norm(lab); if (!nc) return 'miss';
          const nt = _norm(target);
          if (nc === nt) return 'exact';                    // ตรงเป๊ะ (normalized) = ไม่กำกวมเสมอ — ก่อนเช็ค token ชน (full สมชาย ใจดี = exact)
          const hitRoots = new Set();
          for (let i = 0; i < _uniqChars.length; i++) if (_namesMatchSimple(lab, _uniqChars[i])) hitRoots.add(_find(i));
          if (hitRoots.size > 1) return 'ambiguous';        // ป้ายสั้นชน ≥2 identity (เช่น bare สมชาย)
          if (_base(lab) && _base(lab) === _base(target)) return 'alias';
          if (_namesMatchSimple(lab, target)) return 'token_fallback';
          return 'miss';
        };
        // คืน { kind, label } — label = ป้ายที่ชนะจริง (deterministic) เพื่อ persist matchedLabel แม้ persons ถูก cap
        const _matchKind = (labels, target) => {
          if (!target) return { kind: null, label: null };
          if (!labels.length) return { kind: null, label: null };  // มี target แต่ไม่มี label ใช้ได้ = unknown (ไม่ใช่ miss) → identity ใน unknownFields
          const rank = { exact: 5, alias: 4, token_fallback: 3, ambiguous: 2, miss: 1 };
          let best = 'miss', bestLabel = null, exactLabel = null, ambLabel = null, ambiguous = false;
          for (const lab of labels) {
            const mk = _matchKindOne(lab, target);
            if (mk === 'ambiguous') { ambiguous = true; if (ambLabel == null) ambLabel = lab; continue; }
            if (mk === 'exact' && exactLabel == null) exactLabel = lab;
            if (rank[mk] > rank[best]) { best = mk; bestLabel = lab; }
          }
          if (exactLabel != null) return { kind: 'exact', label: exactLabel };
          if (ambiguous) return { kind: 'ambiguous', label: ambLabel };
          return { kind: best, label: best === 'miss' ? null : bestLabel };
        };
        // เจตนาต่อช่อง: semantic → contract slot = authority เดียว (wantPerson null/blank = null authoritative ไม่ยืม order/compass) · legacy → order (unique role) → compass
        const _resolveTarget = (slot, role) => {
          if (semContract) {
            const cs = semById.get(slot);
            if (cs) { const wp = cs.wantPerson != null ? String(cs.wantPerson).trim() : ''; return wp ? { target: _norm(wp), source: 'contract' } : { target: null, source: 'contract' }; }
          }
          const oList = _ordersSrc.filter((o) => o && o.role === role && o.personHint != null && String(o.personHint).trim());
          if (oList.length === 1) return { target: _norm(oList[0].personHint), source: 'order' }; // ซ้ำ >1 = ข้าม (ไม่ยืมจากช่องบทบาทซ้ำ)
          if (role === 'hero') return { target: _heroTarget, source: _heroTarget ? 'compass_hero' : null };
          if (role === 'reaction' || role === 'circle') return { target: _reactTarget, source: _reactTarget ? 'compass_sole_nonhero' : null };
          return { target: null, source: null };
        };
        // unknownFields role-critical (deterministic) — ไม่ครบ → metadataState=METADATA_INSUFFICIENT (แม้ dims มี)
        //   faceCount/faceFrac เฉพาะ role ที่ใช้ face gate (portrait) · sharpness เฉพาะ hero เมื่อ gate on
        const _unknownFields = (x, role, target, ff, dims) => {
          const u = [];
          if (_eb(x?.triage?.relevant) == null) u.push('relevant');
          if (_eb(x?.triage?.clean) == null) u.push('clean');
          if (_portrait(role) && _en(x?.triage?.faceCount) == null) u.push('faceCount');
          if (dims == null) u.push('dims');
          if (_portrait(role) && ff == null) u.push('faceFrac');
          if (role === 'hero' && _sharpGate && _en(x?.triage?.sharpness) == null) u.push('sharpness');
          if (target && _labelsOf(x).length === 0) u.push('identity');
          return u;
        };
        const _reasonOf = (x, role, mk, metaState, selected) => {
          if (selected) return 'SELECTED';
          if (_eb(x?.triage?.relevant) === false) return 'REJECT_IRRELEVANT';
          if (_eb(x?.triage?.clean) === false) return 'REJECT_DIRTY';
          if (mk === 'miss') return 'REJECT_PERSON_MISS';
          if (mk === 'ambiguous') return 'REJECT_PERSON_AMBIGUOUS';
          const fc = _en(x?.triage?.faceCount);
          if (_portrait(role) && fc === 0) return 'REJECT_FACE_NONE';        // แยก 0 หน้าออกจาก multiface
          if (_portrait(role) && fc != null && fc > 1) return 'REJECT_MULTIFACE';
          if (role === 'hero') {
            if (x?.rehostQuality === 'thumbnail') return 'REJECT_THUMBNAIL';
            const rss = _rssExplicit(x);
            if (rss != null && rss < HERO_MIN_SHORT_SIDE) return 'REJECT_UNDERSIZE';
            const sharp = _en(x?.triage?.sharpness);
            if (_sharpGate && sharp != null && sharp < SHARPNESS_MIN_HERO) return 'REJECT_SHARPNESS';
          }
          if (metaState === 'METADATA_INSUFFICIENT') return 'METADATA_INSUFFICIENT';
          return 'ELIGIBLE';
        };
        const _selById = {};
        for (const slot of activeSlots) { const s = slots[slot]; if (s && s.id != null) _selById[slot] = String(s.id); }
        // บทบาท canonical: hero ผ่าน _isHeroSlot (รองรับ refRole main), circle ผ่าน _isCircleSlot — ไม่เดาจาก _legacyKeyOf อย่างเดียว
        const _roleOf = (slot) => (_isHeroSlot(slot) ? 'hero' : (_isCircleSlot(slot) ? 'circle' : _legacyKeyOf(slot)));
        const _rowOf = (x, role, target, selected) => {
          const ff = _ff(x), dims = _dims(x);
          const _mm = _matchKind(_labelsOf(x), target);
          const mk = _mm.kind;
          const uf = _unknownFields(x, role, target, ff, dims);
          const metaState = uf.length ? 'METADATA_INSUFFICIENT' : 'OK';
          const personsArr = Array.isArray(x?.triage?.persons) ? x.triage.persons.filter((p) => p != null).map((p) => _clip(p, 48)).filter((p) => p != null).slice(0, 4) : [];
          return {
            id: _clipId(x.id),
            person: _clip(x?.triage?.person, 48),
            ...(personsArr.length ? { persons: personsArr } : {}),
            matchKind: mk,
            ...(_mm.label != null ? { matchedLabel: _clip(_mm.label, 48) } : {}), // ป้ายที่ชนะจริง (แม้อยู่นอก persons cap)
            metadataState: metaState,        // ★ อิสระจาก reason — selected ยังเห็น METADATA_INSUFFICIENT ได้
            ...(uf.length ? { unknownFields: uf } : {}),
            faceFrac: ff,
            dims,
            measuredFrom: _clip(x?.triage?.measuredFrom, 24),
            orient: _orient(x),
            clean: _eb(x?.triage?.clean),        // explicit true/false เท่านั้น มิฉะนั้น null
            largeText: _eb(x?.triage?.largeText ?? x?.triage?.hasText),
            watermark: _eb(x?.triage?.watermark ?? x?.triage?.hasWatermark),
            newsScene: _eb(x?.triage?.newsScene),
            faceCount: _en(x?.triage?.faceCount),
            quality: _en(x?.triage?.quality),
            pHash: _clip(x?.triage?.pHash64, 32),
            heroGrade: _heroGradeObs(x),
            reason: _reasonOf(x, role, mk, metaState, selected),
            selected,
            estimatedUpscale: null,          // ต้องใช้เรขาคณิตช่องตอน compose → สงวน batch ถัดไป (ไม่เดา)
          };
        };
      // เรียง: matchKind priority → พื้นที่หน้า desc → คุณภาพ desc → id asc (deterministic tie-break)
      const _rank = (a, b) => {
        const mr = { exact: 5, alias: 4, token_fallback: 3, ambiguous: 2, miss: 1 };
        const ma = a.matchKind == null ? 0 : (mr[a.matchKind] || 0), mb = b.matchKind == null ? 0 : (mr[b.matchKind] || 0);
        if (mb !== ma) return mb - ma;
        const fa = a.faceFrac == null ? -1 : a.faceFrac, fb = b.faceFrac == null ? -1 : b.faceFrac;
        if (fb !== fa) return fb - fa;
        const qa = a.quality == null ? -1 : a.quality, qb = b.quality == null ? -1 : b.quality;
        if (qb !== qa) return qb - qa;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      };
      const _orderedSlots = [...activeSlots].sort((s1, s2) => SLOT_ORDER.indexOf(_roleOf(s1)) - SLOT_ORDER.indexOf(_roleOf(s2)));
      const _rolesOut = [];
      for (const slot of _orderedSlots) {
        const role = _roleOf(slot);
        const { target, source } = _resolveTarget(slot, role);
        const selId = _selById[slot] || null;
        // จักรวาลเต็ม — ไม่ pre-filter person-miss (มิฉะนั้นซ่อน REJECT_PERSON_MISS) → นับ reasonCounts จริงก่อน cap
        let rows = sorted.map((x) => _rowOf(x, role, target, String(x.id) === selId));
        // ตรึงใบที่ถูกเลือกเสมอ — เช็คด้วย flag rr.selected (ตั้งจาก raw id) ไม่ใช่ clipped-id equality
        //   (กัน id ที่แชร์ prefix 64 ตัว/แฮชชนกัน มากดใบ selected จริงหาย)
        if (selId != null && !rows.some((rr) => rr.selected)) {
          const sx = sorted.find((x) => String(x.id) === selId) || (slots[slot] && String(slots[slot].id) === selId ? slots[slot] : null);
          if (sx) rows.push(_rowOf(sx, role, target, true));
        }
        rows.sort(_rank);
        const totalRows = rows.length;
        const reasonCounts = {};
        for (const rr of rows) reasonCounts[rr.reason] = (reasonCounts[rr.reason] || 0) + 1;
        let perDropped = 0;
        if (rows.length > _LDG_MAX_ROWS) {
          const sel = rows.filter((rr) => rr.selected);
          const rest = rows.filter((rr) => !rr.selected).slice(0, Math.max(0, _LDG_MAX_ROWS - sel.length));
          perDropped = totalRows - (sel.length + rest.length);
          rows = [...sel, ...rest].sort(_rank);
        }
        _rolesOut.push({ role, slotId: _clipId(slot), targetPerson: target ? _clip(target, 48) : null, targetSource: source, selectedId: selId ? _clipId(selId) : null, totalRows, keptRows: rows.length, droppedRows: perDropped, reasonCounts, rows });
      }
      const ledger = { v: 1, poolSize: sorted.length, capped: false, droppedRows: 0, roles: _rolesOut };
      for (const r of ledger.roles) { if (r.droppedRows > 0) { ledger.capped = true; ledger.droppedRows += r.droppedRows; } }
      // hard cap ≤ 8 KiB (รวม wrapper): ตัดแถวไม่ถูกเลือกอันดับท้ายจากกลุ่มใหญ่สุดทีละแถว + อัปเดตตัวนับจริงทุกตัว
      const _size = () => Buffer.byteLength(JSON.stringify({ candidateLedger: ledger }), 'utf8');
      let _guard = 0;
      while (_size() > _LDG_MAX_BYTES && _guard++ < 20000) {
        let gi = -1, gm = 0;
        for (let i = 0; i < ledger.roles.length; i++) { const n = ledger.roles[i].rows.filter((rr) => !rr.selected).length; if (n > gm) { gm = n; gi = i; } }
        if (gi < 0) break;
        const g = ledger.roles[gi];
        for (let j = g.rows.length - 1; j >= 0; j--) { if (!g.rows[j].selected) { g.rows.splice(j, 1); g.droppedRows++; g.keptRows = g.rows.length; ledger.droppedRows++; ledger.capped = true; break; } }
      }
      if (_size() > _LDG_MAX_BYTES) throw new Error('candidateLedger over size cap after trim');
        _candidateLedger = ledger; _ledgerPresent = true;
      }
      // ── accessor-safe images base: copy own ENUMERABLE DATA props ของ im (ไม่เรียก getter/accessor) ตัด candidateLedger ทิ้ง ──
      //   proxy/descriptor ล้ม (throw ที่นี่) → catch → omit diagnostic + S6 เดินต่อ (ไม่ใช้ base ที่ไม่ปลอดภัย)
      if (_ledgerPresent) {
        const _b = {};
        const _ds = Object.getOwnPropertyDescriptors(im);
        for (const _k of Object.keys(_ds)) {
          if (_k === 'candidateLedger' || _k === '__proto__' || _k === 'prototype' || _k === 'constructor') continue; // ตัด candidateLedger + prototype-pollution keys
          const _d = _ds[_k];
          if (_d && !_d.get && !_d.set && _d.enumerable === true && ('value' in _d)) Object.defineProperty(_b, _k, { value: _d.value, enumerable: true, writable: true, configurable: true });
        }
        _ledgerImagesBase = _b;
      }
    } catch (_e) {
      // ★ total catch: ห้ามอ่าน _e.message/stringify object ที่โยนมา (poisoned getter อาจ throw ซ้ำ) — log คงที่ปลอดภัย
      _candidateLedger = null; _ledgerImagesBase = null; _ledgerInspectFailed = true; // ON-path ล้ม → ห้าม legacy spread (im อาจ hostile proxy)
      console.log('[MEGA S6] 🧾 candidateLedger ข้าม (diagnostic-only inspection ล้ม, งานเดินต่อ)');
    }
  }
  // ★ R1 accessor-safe emit: LEDGER on สำเร็จ = safe base (ไม่ spread im) · ON-path ล้ม = omit (คง dossier เดิม) · LEDGER off = legacy quarantine เดิมทุก byte
  const _quarField = QUARANTINE_ON ? { untriaged: untriagedList.length, sizeUnknown: sizeUnknownList.length, heroDemoted: heroDemotedFlag, sample: quarantineSampleIds } : null;
  let _imagesPatch = null;
  if (_ledgerPresent && _ledgerImagesBase) {
    _imagesPatch = { ..._ledgerImagesBase, ...(_quarField ? { quarantine: _quarField } : {}), candidateLedger: _candidateLedger };
  } else if (_ledgerInspectFailed) {
    _imagesPatch = null; // ON-path descriptor/proxy inspection ล้ม → omit images ทั้งก้อน (ไม่ spread im ที่อาจ throw ซ้ำ) — คง dossier เดิมผ่าน merge
  } else if (QUARANTINE_ON) {
    _imagesPatch = { ...im, quarantine: _quarField };
  }

  // ★ WAVE1A: _refHeroV2Patch was computed by the PRE-BRAIN gate above (Fix #6) and, on success, is attached
  //   additively below. HOLD already returned before the brain, so here it is either null (OFF) or the frozen
  //   success payload (ON). It never mutates slots/slotOrder/heroSlotId/slotContractHash or any legacy field.
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `จับคู่ ${filled}/${activeSlots.length} ช่อง${fallbackUsed ? ` (fallback ${fallbackUsed})` : ''}${brainOk ? '' : ' · สมองล่ม→กฎสำรองล้วน'}${storyTag}${quarantineTag} — ${(brain.note || '').slice(0, 80)}`,
    dossierPatch: {
      pickImages: { slots, note: brain.note || '', poolSize: pool.length, brainOk, fallbackUsed, ...(STORY_SEL_ON ? { storySelOn: true } : {}), ...(semContract ? { semanticSelection: true, slotOrder: _slotOrder, heroSlotId: _canonHeroId, slotContractHash: _semAuthorityHash } : {}), ...(_jobTemplateV1 ? { refShotAuthority: cloneRefShotMarker(_jobRefShotMarker) } : {}), ...(solverShadow ? { solverShadow } : {}), ...(solverShadowV2 ? { solverShadowV2 } : {}), ...(_refHeroV2Patch ? { refHeroV2: _refHeroV2Patch } : {}) },
      ...(job.dossier.refMatch ? { refMatch: job.dossier.refMatch } : {}),
      // ★ D3-B3.3 (Codex): template path echo local plain snapshot (ไม่ใช่ raw carrier) → S7/retry เห็น plain · legacy = raw byte เดิม
      ...((_jobTemplateV1 ? _templateArtBriefSnapshot : job.dossier.artBrief) ? { artBrief: (_jobTemplateV1 ? _templateArtBriefSnapshot : job.dossier.artBrief) } : {}),
      // ★ Wave2 Batch D1 + R1: images = accessor-safe patch คำนวณก่อน return (ดู _imagesPatch) — OFF ทั้งคู่ = ไม่มี key images (byte เท่า legacy)
      ...(_imagesPatch ? { images: _imagesPatch } : {}),
    },
    quality: filled < activeSlots.length ? 'yellow' : undefined,
    // ★ D-sidecar: additive spread เดียว — แนบเฉพาะเมื่อ producer ยืนยัน decisionComplete=true (ไม่มี wrapper ว่าง)
    ...(_dSidecar ? { decisionEvidence: _dSidecar } : {}),
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

// ★ WAVE1A S7 — canonical SelectionSpec-V2 carrier → validated wire (Lane A). Descriptor-safe own-DATA capture of the
//   frozen carrier (accessors rejected without invocation); the SOLE judge is the version DISPATCHER
//   (validateStrictRenderActivationVersioned → V2 when spec.v===2). slotPlan is derived SOLELY from the validator-
//   returned canonical bindings (never legacy pickImages.slots): complete 1:1, mandatory candidateId/personId/
//   sourceAssetId/refSlotId/composerSlotId, unique refSlotId+url, hero by explicit spec.hero.heroSlotId (never regex).
//   Returns { ok:true, slotPlan, selectionSpec, realizedTemplate } or { ok:false, hold:<code> }. No IO, no mutation.
function _s7V2Wire(carrier, dispatcher) {
  const _own = (o, k) => { if (o === null || typeof o !== 'object') return undefined; const d = Object.getOwnPropertyDescriptor(o, k); return d && !('get' in d) && !('set' in d) ? d.value : undefined; };
  if (carrier === null || typeof carrier !== 'object') return { ok: false, hold: 'ref_hero_v2_carrier_invalid' };
  if (_own(carrier, 'ok') !== true || _own(carrier, 'v') !== 1) return { ok: false, hold: 'ref_hero_v2_carrier_not_ok' };
  const selectionSpec = _own(carrier, 'selectionSpec');
  const selectionAuthority = _own(carrier, 'selectionAuthority');
  const expectedSelectionAuthorityHash = _own(carrier, 'expectedSelectionAuthorityHash');
  const expectedSpecHash = _own(carrier, 'expectedSpecHash');
  const expectedReplayHash = _own(carrier, 'expectedReplayHash');
  const realizedTemplate = _own(carrier, 'realizedTemplate');
  if (selectionSpec === null || typeof selectionSpec !== 'object' || selectionAuthority === null || typeof selectionAuthority !== 'object'
    || realizedTemplate === null || typeof realizedTemplate !== 'object'
    || typeof expectedSelectionAuthorityHash !== 'string' || typeof expectedSpecHash !== 'string' || typeof expectedReplayHash !== 'string') {
    return { ok: false, hold: 'ref_hero_v2_carrier_partial' };
  }
  let decision;
  try { decision = dispatcher({ selectionSpec, selectionAuthority, expectedSelectionAuthorityHash, expectedSpecHash, expectedReplayHash, realizedTemplate }); }
  catch { return { ok: false, hold: 'ref_hero_v2_validate_error' }; }
  if (!decision || decision.ok !== true || !decision.selectionSpec || decision.selectionSpec.v !== 2) return { ok: false, hold: 'ref_hero_v2_activation_invalid' };
  const spec = decision.selectionSpec; // canonical, deep-frozen, trusted
  const heroSlotId = _rhNonBlank(spec.hero?.heroSlotId);
  if (!heroSlotId) return { ok: false, hold: 'ref_hero_v2_hero_slot_missing' };
  const rows = Array.isArray(spec.slots) ? spec.slots : null;
  if (!rows || !rows.length) return { ok: false, hold: 'ref_hero_v2_no_bindings' };
  const slotPlan = []; const seenRef = new Set(); const seenUrl = new Set(); let heroRows = 0;
  for (const sl of rows) {
    const refSlotId = _rhNonBlank(sl?.refSlotId); const composerSlotId = _rhNonBlank(sl?.composerSlotId); const primary = sl?.primary;
    if (!refSlotId || !composerSlotId || primary === null || typeof primary !== 'object') return { ok: false, hold: 'ref_hero_v2_binding_incomplete' };
    const personId = _rhNonBlank(primary.personId); const candidateId = _rhNonBlank(primary.candidateId);
    const sourceAssetId = _rhNonBlank(primary.sourceAssetId); const imageUrl = _rhNonBlank(primary.imageUrl);
    if (!personId || !candidateId || !sourceAssetId || !imageUrl) return { ok: false, hold: 'ref_hero_v2_binding_incomplete' };
    if (seenRef.has(refSlotId) || seenUrl.has(imageUrl)) return { ok: false, hold: 'ref_hero_v2_binding_duplicate' };
    seenRef.add(refSlotId); seenUrl.add(imageUrl);
    const isHero = refSlotId === heroSlotId; if (isHero) heroRows++;
    // ★ EVIDENCE INTEGRITY (P1): `clean:true` is genuinely DERIVED — every tuple that reaches this bind cleared the
    //   six-field cast readiness AND (computeCandidateEligibility), of which `clean` is one; dirty/ineligible assets
    //   are never selected. `newsScene` is DELIBERATELY OMITTED: the canonical RH→Cast→Global chain never carries
    //   triage.newsScene (eligibility does not gate on it, and _rhGlobalCandidate does not read/emit it), so asserting
    //   it here — true OR false — would fabricate evidence. Omission reaches the consumer (_strictPrepareV2) as
    //   unknown/null; it must never be inferred to a fabricated true.
    slotPlan.push({ url: imageUrl, refSlotId, composerSlotId, candidateId, personId, sourceAssetId, isHero, clean: true });
  }
  if (heroRows !== 1) return { ok: false, hold: 'ref_hero_v2_hero_row_count' }; // exactly one hero row, by heroSlotId
  return { ok: true, slotPlan, selectionSpec: spec, realizedTemplate };
}

export async function s7_cover(job, { origin, _deps } = {}) {
  // ★ SEM-1: dependency injection เพื่อ testability เท่านั้น — default = ของจริง (production เดิม 100%)
  const _jf = _deps?.fetchJson || jfetch;
  // ★ D3-B2.1 (Codex P0 TOCTOU): snapshot ทุกสวิตช์ครั้งเดียวที่ต้นทาง — reuse ตลอด (ห้าม re-read หลัง await)
  const _envRefAuth = process.env.MEGA_REF_SHOT_AUTHORITY === '1';
  const _envSem = process.env.MEGA_SEMANTIC_SELECTION === '1';
  const _envSpec = process.env.MEGA_SELECTION_SPEC === '1';
  const _envStrictProducer = process.env.MEGA_STRICT_PRODUCER === '1';
  const _envStrictRender = process.env.MEGA_STRICT_RENDER === '1'; // ★ WAVE1A: the SOLE canonical renderer latch (no alias) — governs BOTH V1 and the V2 carrier; V1-vs-V2 chosen from the carrier version, never a separate env flag.
  const _roleReadyOn = process.env.MEGA_ROLE_READINESS === '1'; // ★ LANE-C latch (fresh, default OFF, exact '1')
  // ★ LANE-C (item 2) MINIMAL INTERNAL-ONLY TRANSPORT SEAM — คุมด้วย in-process `_deps` เท่านั้น (ห้าม env/request data):
  //   Lane A เรียก s7_cover(job, { origin, _deps: { fetchJson, queueTransport: 'cover_ref_test_in_process' } }) ให้ยิงในโปรเซส
  //   เอง (ไม่ผ่านเครื่องทีม/คลาวด์) · default callers ไม่ส่ง _deps.queueTransport = false = พฤติกรรมเดิมทุก byte
  const _inProcTransport = _deps?.queueTransport === 'cover_ref_test_in_process' && typeof _deps?.fetchJson === 'function';
  // ★ audit A1 (9 ก.ค.): tick ที่เกิดบนคลาวด์ (คนกดหน้า /mega ที่เสิร์ฟบน Vercel/Railway) ไม่มี localhost:3000
  //   ให้ยิง → เดิมส่งงานปกล้มแล้ว job ตายทั้งงาน — คืน waiting ให้ tick รอบถัดไปจากเครื่องทีมมาทำขั้นนี้เอง
  //   ★ LANE-C: bypass เฉพาะเมื่อ in-process transport ถูกฉีดผ่าน _deps เท่านั้น (ไม่ broaden call path อื่น)
  if (process.platform !== 'win32' && !process.env.MEGA_COVER_ORIGIN && !_inProcTransport) {
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
  const _semEnvOn = _envSem && _envSpec; // ★ D3-B2.1: จาก snapshot (TOCTOU-safe)
  if (_sem && !_semEnvOn) {
    return { status: 'waiting', nextAction: 'wait', summary: '🧬⏸️ แผนนี้เลือกภาพแบบ semantic แต่สวิตช์ปิดอยู่ — พักรอเปิด MEGA_SEMANTIC_SELECTION=1 + MEGA_SELECTION_SPEC=1 (ไม่แปลง legacy กันภาพผิดช่อง)' };
  }
  // ★ WAVE1A P0/P1: canonical SelectionSpec-V2 governance. If S6 persisted a refHeroV2 carrier, V2 renders under the
  //   SOLE canonical latch MEGA_STRICT_RENDER (no alias); V1-vs-V2 is chosen from the carrier version by the dispatcher.
  //   NO-DOWNGRADE: a present carrier while the latch is OFF, or a missing/partial/invalid carrier/version/pins under
  //   the latch, HOLDs BEFORE any queue/network — never silently continues V1/legacy. slotPlan comes SOLELY from the
  //   validator-returned canonical bindings. NO carrier ⇒ this block is skipped ⇒ legacy/V1 path byte-identical.
  if (d.pickImages != null && Object.prototype.hasOwnProperty.call(d.pickImages, 'refHeroV2')) {
    if (!_envStrictRender) {
      return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ ref-hero-v2: carrier ถูก persist แต่ MEGA_STRICT_RENDER (latch เดียว) ปิด — พักงาน ห้าม downgrade V1/legacy' };
    }
    let _verDispatch;
    try { _verDispatch = (await import('@/lib/refSlotContract')).validateStrictRenderActivationVersioned; } catch { return { status: 'failed', nextAction: 'retry', summary: '🔐 ref-hero-v2: โหลด version dispatcher ล้ม — ไม่ enqueue' }; }
    if (typeof _verDispatch !== 'function') return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ ref-hero-v2: version dispatcher ไม่พร้อม — พักงาน' };
    const _v2 = _s7V2Wire(d.pickImages.refHeroV2, _verDispatch);
    if (!_v2.ok) {
      return { status: 'waiting', nextAction: 'wait', summary: `🔐⏸️ ref-hero-v2: ${_v2.hold} — พักงานก่อน queue (fail-closed, ห้าม downgrade)` };
    }
    // serialize ONCE → re-validate the EXACT wire carrier + pins via the dispatcher → enqueue the same bytes (TOCTOU-proof)
    const _v2Payload = {
      jobType: 'cover', composer: 'mega',
      newsTitle: d.generate?.newsData?.newsTitle || d.desk?.title || '',
      slotPlan: _v2.slotPlan, userId: MEGA_USER,
      ...(d.refMatch?.imagePath ? { refImagePath: d.refMatch.imagePath } : {}),
      refHeroV2: d.pickImages.refHeroV2,
    };
    let _v2Body; let _wireOk = false;
    try { _v2Body = JSON.stringify(_v2Payload); const _wire = JSON.parse(_v2Body); _wireOk = _s7V2Wire(_wire.refHeroV2, _verDispatch).ok === true; }
    catch { return { status: 'failed', nextAction: 'retry', summary: '🔐 ref-hero-v2: serialize/ตรวจ wire snapshot ล้ม — ไม่ enqueue' }; }
    if (!_wireOk) return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ ref-hero-v2: wire carrier snapshot ไม่ผ่าน validator — พักงานก่อน queue' };
    const _q = await _jf(`${coverOrigin()}/api/queue/add`, { method: 'POST', body: _v2Body }, 60000);
    if (!_q.success || !_q.jobId) return { status: 'failed', nextAction: 'retry', summary: 'ส่งงานปก (V2) ไม่สำเร็จ: ' + (_q.error || _q.httpStatus) };
    return { status: 'done', nextAction: 'continue', summary: `🔐 ref-hero-v2 ARMED (V2 canonical) → enqueued ${_v2.slotPlan.length} ช่อง`, dossierPatch: { cover: { queueJobId: _q.jobId, refStyle: d.refMatch?.styleName || null, selectionSpec: _v2.selectionSpec } } };
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
  // ★ D3-B2 (11 ก.ค. — Codex): mode ของ S7 = persisted marker (artBrief + pickImages echo) ไม่ใช่ env ล้วน
  //   marker-present ต้องผ่านทุกด่าน (switch ON · prereq · schema · deep-equal ab↔pi · rebuild effectiveViewHash
  //   ตรง · slotContractHash ตรง · strict pair armed) มิฉะนั้น HOLD ก่อน queue (queueCalls=0) — กัน authority
  //   หลุดเข้า composer legacy · OFF/ไม่มี marker = byte เดิมทุก field
  // ★ D3-B2.3 (Codex P1 TOCTOU): normalize marker ทั้งสอง carrier ครั้งเดียว — ใช้ canonical snapshot เท่านั้น
  const _abReadS7 = readRefShotMarker(d.artBrief, 'refShotAuthority');
  const _piReadS7 = readRefShotMarker(d.pickImages, 'refShotAuthority');
  const _markerPresent = _abReadS7.present || _piReadS7.present;
  let _s7TemplateV1 = false;
  if (_markerPresent) {
    if (!_envRefAuth) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority (S7): แฟ้ม marked แต่สวิตช์ปิด — พักรอ (ไม่ downgrade legacy composer)' };
    }
    if (!_semEnvOn) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority (S7): prereq SEM/SPEC ปิด — พักงาน' };
    }
    // ★ D3-B2.3: ต้องมี marker "ครบคู่" valid + equal (เทียบ canonical snapshot ที่ normalize มาแล้ว) — เดี่ยว = ผิด
    if (!_abReadS7.present || !_piReadS7.present || !_abReadS7.marker || !_piReadS7.marker || !canonicalMarkersEqual(_abReadS7.marker, _piReadS7.marker)) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority (S7): marker artBrief/pickImages เสีย/ไม่ครบคู่/ไม่ตรงกัน — พักงาน ห้ามซ่อม' };
    }
    try {
      const authApi = await import('@/lib/refSlotContract');
      const rc = authApi.buildRefSlotContract({ refDNA: selectionRefDNA, artBriefOrders: d.artBrief?.orders || [], mode: 'template_v1' });
      const dnaToTemplateSpecR = _deps?.dnaToTemplateSpec || (await import('@/lib/refTemplate')).dnaToTemplateSpec;
      const realizedR = selectionRefDNA ? dnaToTemplateSpecR(selectionRefDNA) : null;
      const okAuth = !!rc?.authority && rc.authority.mode === 'template_v1' && rc.authority.axis === 'template.slots'
        && rc.authority.axisReady === true && rc.authority.effectiveViewHash === _abReadS7.marker.effectiveViewHash;
      const okGeom = _refShotContractGeomOk(rc);
      const okRealizedGeom = _refShotRealizedOk(realizedR, rc);
      const s7ContractHash = _dnaHashFor({ refId: resolvedRefId, contract: rc });
      const okContractHash = !!d.pickImages?.slotContractHash && d.pickImages.slotContractHash === s7ContractHash;
      if (!okAuth || !okGeom || !okRealizedGeom || !okContractHash) {
        return { status: 'waiting', nextAction: 'wait', summary: `🎯⏸️ ref-shot authority (S7): rebuild ไม่ตรง (viewHash=${okAuth} · geom=${okGeom} · realizedGeom=${okRealizedGeom} · slotContractHash=${okContractHash}) — พักงานก่อน queue` };
      }
    } catch (e) {
      return { status: 'waiting', nextAction: 'wait', summary: `🎯⏸️ ref-shot authority (S7): rebuild contract ล้ม (${String(e?.message || '').slice(0, 50)}) — พักงาน` };
    }
    if (!(_envStrictProducer && _envStrictRender)) {
      return { status: 'waiting', nextAction: 'wait', summary: '🎯⏸️ ref-shot authority (S7): งาน template_v1 ต้องมี strict pair (PRODUCER+RENDER) armed ก่อน enqueue — พักงาน' };
    }
    _s7TemplateV1 = true;
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
  const strictProducerRequested = _sem === true && _semEnvOn && _envStrictProducer; // ★ D3-B2.1: snapshot
  const strictWireOn = strictProducerRequested && _envStrictRender; // ★ D3-B2.1: snapshot
  // PRODUCER เปิดแต่ RENDER ยังไม่ armed = ห้ามส่งงาน strict เข้าโรง legacy — พักงาน "ก่อน queue"
  // (image-library fetch ของขั้นนี้เกิดไปก่อนหน้าแล้ว — จุดที่กันคือ enqueue เท่านั้น)
  if (strictProducerRequested && !strictWireOn) {
    return { status: 'waiting', nextAction: 'wait', summary: '🔐⏸️ strict producer: strict_render_not_armed — MEGA_STRICT_PRODUCER เปิดแต่ MEGA_STRICT_RENDER ยังไม่พร้อม พักงานก่อน queue (rollout: เปิด RENDER ก่อน PRODUCER)' };
  }
  if (_envSpec) { // ★ D3-B2.2 (Codex P1-4): ใช้ snapshot ไม่ re-read process.env หลัง await (TOCTOU)
    try {
      const specApi = await import('@/lib/refSlotContract');
      // ★ Checkpoint C (C): template builder ฉีดได้เฉพาะเทสผ่าน _deps — production default = ของจริงเสมอ
      const dnaToTemplateSpec = _deps?.dnaToTemplateSpec || (await import('@/lib/refTemplate')).dnaToTemplateSpec;
      // ★ รอบ 5 P0-2: สัญญาสร้างจาก selectionRefDNA เท่านั้น (weak-match ถูก strip ตรง S6) —
      //   ส่วน payload ด้านล่างใช้ refDNA legacy · template.slots สองก้อนเหมือนกัน realized geometry จึงตรง composer
      const contract = specApi.buildRefSlotContract({ refDNA: selectionRefDNA, artBriefOrders: d.artBrief?.orders || [], ...(_s7TemplateV1 ? { mode: 'template_v1' } : {}) }); // ★ D3-B2: persisted mode
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
        // ★ LANE-C (1c) PRE-FREEZE TEMPLATE DEMAND — ON + strict-armed เท่านั้น · CONSUME ค่าที่ s7 คำนวณแล้ว (realizedTemplate.slots +
        //   plannedByRefSlot) ไม่ recompute/approximate · ภาพที่ครอปได้จริง (primary ที่ผ่านด่านครอป/ขนาด S6 แล้ว) ต่างกัน (distinct)
        //   ต้อง ≥ จำนวนช่องที่โครงต้องการ — ขาด = HOLD typed ก่อน payload/queue (ไม่มี side effect)
        if (_roleReadyOn) {
          const _demand = Array.isArray(realizedTemplate.slots) ? realizedTemplate.slots.length : 0;
          const _distinct = new Set();
          if (plannedByRefSlot && typeof plannedByRefSlot === 'object') {
            for (const _k of Object.keys(plannedByRefSlot)) {
              const _cid = plannedByRefSlot[_k] && plannedByRefSlot[_k].candidateId;
              if (_cid != null && _cid !== '') _distinct.add(String(_cid));
            }
          }
          if (_demand >= 1 && _distinct.size < _demand) {
            console.log(`[MEGA S7] 🔒 role-readiness HOLD: INSUFFICIENT_POOL_FOR_TEMPLATE (ครอปได้ ${_distinct.size} < โครงต้องการ ${_demand})`);
            return { status: 'waiting', nextAction: 'wait', reason: 'INSUFFICIENT_POOL_FOR_TEMPLATE', summary: `🔒⏸️ role-readiness: INSUFFICIENT_POOL_FOR_TEMPLATE — ภาพครอปได้ ${_distinct.size} ใบ < ช่องที่โครงต้องการ ${_demand} — พักงานก่อน queue` };
          }
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
        // ★ D3-B2.1 (Codex P0): s7_wait derive mode จาก persisted marker "คู่" (artBrief+pickImages) เท่านั้น —
        //   ไม่อ่าน env (switch ปิดหลัง enqueue ก็ยัง template trace) · marker property มีแต่ pair ไม่ valid/equal
        //   = diagnostic failure (ข้าม trace ไม่ rebuild) ห้าม legacy · ไม่มี marker = legacy rebuild เดิม
        const _abT = readRefShotMarker(job.dossier.artBrief, 'refShotAuthority'); // normalize ครั้งเดียว
        const _piT = readRefShotMarker(job.dossier.pickImages, 'refShotAuthority');
        const _markerPresent = _abT.present || _piT.present;
        const _tracePairOk = _abT.present && _piT.present && !!_abT.marker && !!_piT.marker && canonicalMarkersEqual(_abT.marker, _piT.marker);
        if (_markerPresent && !_tracePairOk) {
          console.log('[MEGA S7w] 🎯⚠️ trace: marker property มีแต่ pair ไม่ valid/equal → ข้าม (diagnostic failure ไม่ถอย legacy)');
        } else {
          const traceApi = await import('@/lib/refSlotContract');
          const refSlotContract = traceApi.buildRefSlotContract({
            refDNA: job.dossier.refMatch?.dna || null,
            artBriefOrders: job.dossier.artBrief?.orders || [],
            ...(_tracePairOk ? { mode: 'template_v1' } : {}), // ★ D3-B2.1: pair valid = template mode (ไม่พึ่ง env)
          });
          finalAssignmentTrace = traceApi.buildFinalAssignmentTrace({
            plannedSlots: job.dossier.pickImages?.slots || {},
            manifestSlots: r.manifest.slots,
            placed: r.placed || [],
            refSlotContract,
            // ★ รอบ 4 P0: สัญญาจริงจาก S7 มาก่อน positional เสมอ (ไม่มี = ถอย legacy เดิมทั้งก้อน)
            selectionSpec: job.dossier.cover?.selectionSpec || null,
          });
        }
        // ★ รอบ 7 P0: แยก log ตามเวอร์ชัน — v1 (ไม่มี spec) ต้องเป็นข้อความ HEAD เดิมทุกตัวอักษร
        if (finalAssignmentTrace && finalAssignmentTrace.v === 2) {
          console.log(`[MEGA S7] selection trace: kept ${finalAssignmentTrace.partition.kept}/${finalAssignmentTrace.total} · changed ${finalAssignmentTrace.partition.changed} · missing ${finalAssignmentTrace.partition.missingExpected} · unmapped ${finalAssignmentTrace.partition.unmapped}`);
        } else if (finalAssignmentTrace) {
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
