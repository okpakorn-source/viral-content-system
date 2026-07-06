// ============================================================
// 🏭 MEGA Workflow — ตัวเชื่อมสถานี (adapters) เฟส 1: S1 → S4
// ------------------------------------------------------------
// ทุกตัว: อ่านแฟ้มทั้งใบ → เรียก "ท่อเดิม" ตามสัญญาใน _MEGA_PHASE0_MAP.md →
// คืนผลตาม contract กลาง { status, nextAction, summary, dossierPatch, quality }
// 🔴 ไม่แตะโค้ดระบบข่าว: คิว/extract เรียกผ่าน HTTP same-origin แบบเดียวกับโต๊ะข่าว
// ============================================================

import { preflightBrain, compassBrain, judgeBrain } from '@/lib/megaBrains';

const MEGA_USER = 'mega-bot';
const MIN_EXTRACT_CHARS = parseInt(process.env.MEGA_MIN_EXTRACT_CHARS || '400', 10);
const MAX_S1_ATTEMPTS = 3;

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
  const payload = gen.forceTextInput
    ? { input: gen.forceTextInput }
    : ex.urlOnly && job.dossier.desk?.url
      ? { url: job.dossier.desk.url }
      : { input: ex.text };
  const q = await jfetch(`${origin}/api/queue/add`, { method: 'POST', body: JSON.stringify(payload) }, 60000);
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
  const st = await jfetch(`${origin}/api/queue/status?id=${encodeURIComponent(gen.queueJobId)}`, {}, 30000);
  const status = st.status || st.jobStatus;
  if (status === 'completed' && st.result) {
    const versions = st.result.versions || [];
    if (!versions.length) {
      return { status: 'failed', nextAction: 'fail', summary: 'คิวจบแต่ไม่มีเวอร์ชันเนื้อในผล', quality: 'red' };
    }
    return {
      status: 'done',
      nextAction: 'continue',
      summary: `เจนเสร็จ ${versions.length} เวอร์ชัน — ก๊อบผลเข้าแฟ้มแล้ว (กัน purge)`,
      dossierPatch: { generate: { ...gen, versions, pipeline: st.result.pipeline || '', completedAt: new Date().toISOString() } },
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

// ---------- ตารางเดินสายพาน เฟส 1 ----------
export const STAGE_FLOW = {
  s1_pick: { run: s1_pick, next: 's1_5_preflight', label: 'S1 คัดข่าว' },
  s1_5_preflight: { run: s1_5_preflight, next: 's2_extract', label: 'S1.5 เช็ควัตถุดิบ' },
  s2_extract: { run: s2_extract, next: 's2_5_compass', label: 'S2 สกัดเนื้อ' },
  s2_5_compass: { run: s2_5_compass, next: 's3_generate', label: 'S2.5 เข็มทิศเรื่อง' },
  s3_generate: { run: s3_generate, next: 's3_wait', label: 'S3 ส่งเจนข่าว' },
  s3_wait: { run: s3_wait, next: 's4_choose', label: 'S3 รอผลเจน' },
  s4_choose: { run: s4_choose, next: 'content_ready', label: 'S4 เลือกเนื้อดีสุด' },
};
