// ============================================================
// 🏭 MEGA Workflow — ตัวเชื่อมสถานี (adapters) เฟส 1: S1 → S4
// ------------------------------------------------------------
// ทุกตัว: อ่านแฟ้มทั้งใบ → เรียก "ท่อเดิม" ตามสัญญาใน _MEGA_PHASE0_MAP.md →
// คืนผลตาม contract กลาง { status, nextAction, summary, dossierPatch, quality }
// 🔴 ไม่แตะโค้ดระบบข่าว: คิว/extract เรียกผ่าน HTTP same-origin แบบเดียวกับโต๊ะข่าว
// ============================================================

import { preflightBrain, compassBrain, judgeBrain, slotDirectorBrain } from '@/lib/megaBrains';

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

async function jfetch(url, opts = {}, timeoutMs = 60000) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
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
const SEARCH_PLATFORMS = ['google', 'facebook', 'youtube', 'tiktok']; // bing ตายแล้ว (ลบ 6 ก.ค.)
const MAX_TRIAGE_ROUNDS = 8;

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
  const nQueries = ['queries_th', 'queries_en', 'object_queries', 'moment_action', 'scene_place']
    .reduce((n, k) => n + (kw[k] || []).length, 0);
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `สกัดคีย์ ${nQueries} คำค้น · บุคคล ${(kw.subjects || []).length} คน`,
    dossierPatch: { images: { ...im, keywordsCount: nQueries, subjects: (kw.subjects || []).map((s) => s.name).slice(0, 8) } },
  };
}

// ---------- S5c ค้นภาพ 4 แหล่ง — ทีละแหล่งต่อ 1 tick (กันชน timeout ของ tick) ----------
// ห้ามคืน status:'done' ระหว่างยังไม่ครบทุกแหล่ง — done จะโดน idempotency นับ "เคยสำเร็จ" แล้วข้ามแหล่งที่เหลือ
export async function s5_search(job, { origin }) {
  const im = job.dossier.images || {};
  const done = im.searchedPlatforms || [];
  const next = SEARCH_PLATFORMS.find((p) => !done.includes(p));
  if (next) {
    const r = await jfetch(`${origin}/api/images/search`, { method: 'POST', body: JSON.stringify({ caseId: im.caseId, platform: next }) }, 300000);
    const stat = r.success
      ? { platform: next, found: r.found || 0, added: r.added || 0, vetDropped: r.vetDropped || 0 }
      : { platform: next, error: (r.error || String(r.httpStatus)).slice(0, 80) };
    const patch = {
      images: {
        ...im,
        searchedPlatforms: [...done, next],
        searchStats: [...(im.searchStats || []), stat],
      },
    };
    const remaining = SEARCH_PLATFORMS.length - (done.length + 1);
    return {
      status: 'waiting', // กลางคัน = waiting เสมอ (กัน idempotent ข้ามแหล่งที่เหลือ)
      nextAction: 'wait',
      summary: `ค้น ${next}: ${r.success ? `เก็บ ${stat.added}/${stat.found} ใบ` : 'ล้ม — ' + stat.error} (เหลือ ${remaining} แหล่ง)`,
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
  // Quality gate ตามแผน: ภาพเกี่ยวจริง < เกณฑ์ → เดินต่อได้แต่ติดธงเหลือง (โหมด auto)
  const under = relevant < MIN_RELEVANT_IMAGES;
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `ตาคัดครบ: เกี่ยวจริง ${relevant}/${triage.total} ใบ` + (under ? ` ⚠️ ต่ำกว่าเกณฑ์ ${MIN_RELEVANT_IMAGES}` : ''),
    dossierPatch: { images: { ...im, triage, triageDone: true } },
    quality: under ? 'yellow' : undefined,
  };
}

// ---------- S6 เลือกภาพลงช่อง: สมองจับคู่ + ด่านโค้ดกันซ้ำ/ผิดคน + fallback กฎเดียวกัน ----------
const SLOT_ORDER = ['hero', 'reaction', 'action', 'context', 'circle'];
const SLOT_CATEGORY_HINT = {
  action: ['action', 'moment', 'event'],
  context: ['place', 'object', 'context', 'scene'],
  circle: ['evidence', 'moment', 'object'],
};

export async function s6_slots(job, { origin }) {
  const im = job.dossier.images || {};
  const r = await jfetch(`${origin}/api/images/${encodeURIComponent(im.caseId)}`, {}, 60000);
  if (!r.success) return { status: 'failed', nextAction: 'retry', summary: 'อ่านคลังรูปไม่ได้: ' + (r.error || r.httpStatus) };

  const pool = (r.images || []).filter((x) => x.triage && x.triage.relevant !== false);
  if (!pool.length) return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพที่ตายืนยันว่าเกี่ยวเลย — ทำปกไม่ได้', quality: 'red' };

  // metadata กะทัดรัด (เรียงคุณภาพสูงก่อน · เพดาน 80 ใบกัน prompt บวม)
  const sorted = pool.slice().sort((a, b) => (b.triage?.quality ?? 0) - (a.triage?.quality ?? 0)).slice(0, 80);
  const meta = sorted.map((x) => ({
    id: x.id,
    person: x.triage?.person || null,
    persons: x.triage?.persons || [],
    category: x.triage?.category || 'other',
    emotion: x.triage?.emotion || null,
    quality: x.triage?.quality ?? 5,
    faces: x.triage?.faceCount ?? 0,
    src: x.platform || '',
  }));

  let brain = { slots: {}, note: '' };
  let brainOk = true;
  try {
    brain = await slotDirectorBrain({ imagesMeta: meta, compass: job.dossier.compass, deskTitle: job.dossier.desk?.title });
  } catch (err) {
    brainOk = false; // สมองล่ม → fallback ล้วน (กฎเดียวกับทางหลัก)
  }

  // ด่านโค้ด: id ต้องมีจริง + ห้ามซ้ำข้ามช่อง + hero ต้องถูกคน (ถูกคน 100% เหนือทุกข้อ)
  const byId = new Map(sorted.map((x) => [String(x.id), x]));
  const mainNames = (job.dossier.compass?.mainCharacters || []).map((c) => c.name).filter(Boolean);
  const isMainChar = (img) => {
    const ps = [img.triage?.person, ...(img.triage?.persons || [])].filter(Boolean);
    return mainNames.length === 0 || ps.some((p) => mainNames.some((m) => p.includes(m) || m.includes(p)));
  };
  const used = new Set();
  const slots = {};
  let fallbackUsed = 0;

  for (const slot of SLOT_ORDER) {
    const want = brainOk ? brain.slots?.[slot] : null;
    let img = want?.id != null ? byId.get(String(want.id)) : null;
    let reason = want?.reason || '';
    if (img && used.has(String(img.id))) img = null; // ซ้ำข้ามช่อง = ตัด
    if (img && slot === 'hero' && !isMainChar(img)) { img = null; reason = ''; } // ผิดคน = ตัด
    if (!img) {
      // fallback กฎเดียวกับทางหลัก: hero=ตัวเอกหน้าชัดคุณภาพสูง / อื่นๆ=หมวดใกล้เคียง → คุณภาพสูงสุดที่เหลือ
      const cands = sorted.filter((x) => !used.has(String(x.id)));
      const hint = SLOT_CATEGORY_HINT[slot] || [];
      img =
        (slot === 'hero' ? cands.find((x) => isMainChar(x) && (x.triage?.faceCount ?? 0) >= 1) : null) ||
        cands.find((x) => hint.includes(x.triage?.category)) ||
        (slot === 'reaction' ? cands.find((x) => (x.triage?.faceCount ?? 0) >= 1) : null) ||
        cands[0] ||
        null;
      if (img && slot === 'hero' && !isMainChar(img)) img = null; // ไม่มีตัวเอกจริง → ปล่อยว่าง ห้ามฝืนผิดคน
      if (img) { fallbackUsed++; reason = reason || 'fallback ตามสูตรแสนไลค์ (หมวด/คุณภาพ)'; }
    }
    if (img) {
      used.add(String(img.id));
      slots[slot] = {
        id: img.id,
        imageUrl: img.imageUrl, // rehost สลับเป็นไฟล์ถาวรให้เองในคลัง (ต้นทางอยู่ originUrl)
        person: img.triage?.person || null,
        category: img.triage?.category || null,
        emotion: img.triage?.emotion || null,
        reason,
        backups: (want?.backups || []).filter((b) => byId.has(String(b)) && !used.has(String(b))).slice(0, 2),
      };
    } else {
      slots[slot] = null;
    }
  }

  const filled = SLOT_ORDER.filter((s) => slots[s]).length;
  if (!slots.hero) {
    return { status: 'failed', nextAction: 'fail', summary: 'ไม่มีภาพตัวเอกที่ถูกคนเลย — ห้ามฝืนทำปกผิดคน', quality: 'red', dossierPatch: { pickImages: { slots, note: brain.note || '' } } };
  }
  return {
    status: 'done',
    nextAction: 'continue',
    summary: `จับคู่ ${filled}/5 ช่อง${fallbackUsed ? ` (fallback ${fallbackUsed})` : ''}${brainOk ? '' : ' · สมองล่ม→กฎสำรองล้วน'} — ${(brain.note || '').slice(0, 80)}`,
    dossierPatch: { pickImages: { slots, note: brain.note || '', poolSize: pool.length, brainOk, fallbackUsed } },
    quality: filled < 5 ? 'yellow' : undefined,
  };
}

// ---------- ตารางเดินสายพาน เฟส 1+2 ----------
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
  s5_search: { run: s5_search, next: 's5_triage', label: 'S5 ค้นภาพ 4 แหล่ง' },
  s5_triage: { run: s5_triage, next: 's6_slots', label: 'S5 ตาคัดคลัง' },
  s6_slots: { run: s6_slots, next: 'assets_ready', label: 'S6 เลือกภาพลงช่อง' },
};
