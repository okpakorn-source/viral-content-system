/**
 * ========================================
 * RESEARCH IDENTITY VERIFIER — กันข่าวผิดคน/ผิดเหตุการณ์
 * ========================================
 * ปัญหา: ค้นชื่อคน ("ครูสมศรี") บน Google อาจเจอ "คนละคน" ที่ชื่อเหมือนกัน
 * แล้ว fact ของคนผิดถูกยัดเข้าเนื้อข่าว = ความเสียหายร้ายแรงที่สุดของเพจข่าว
 *
 * แนวทาง: Defense-in-depth + FAIL-CLOSED (ไม่มั่นใจ = ทิ้ง ดีกว่าเสี่ยงผิด)
 *  ชั้น 1 (deterministic): Anchor check — ผลค้นหาที่เอ่ยชื่อบุคคลในข่าว
 *         ต้องมี "หลักฐานยืนยันตัวตน" อย่างน้อย 1 อย่างร่วมด้วย
 *         (จังหวัด/อำเภอ/โรงเรียน/องค์กร/อายุ/สถานที่จาก key_facts)
 *         ชื่อโผล่แต่ไม่มี anchor → ทิ้งทันที (โอกาสคนละคนสูง)
 *  ชั้น 2 (AI judge): gpt-5.4-mini เทียบ item ที่เหลือกับข่าวต้นฉบับ
 *         "เรื่องเดียวกัน/คนเดียวกันไหม" — ตอบไม่ใช่ → ทิ้ง
 *  ชั้น 3 (tagging): item ที่ "ไม่เอ่ยชื่อบุคคลเลย" = บริบททั่วไป (generic)
 *         ติดป้ายให้ AI เขียนรู้ว่า "ห้ามผูกกับตัวบุคคล" (กฎอยู่ใน narrativePayload)
 *  Fail-closed: judge พัง → เก็บเฉพาะ item ที่มี anchor ≥ 2 เท่านั้น
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

const _norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

const STOP_TOKENS = new Set(['ที่เกิดเหตุ', 'ประเทศไทย', 'ไทย', 'กรุงเทพ']);

/**
 * สกัด "ชื่อบุคคล" + "anchor ยืนยันตัวตน" จากข่าวต้นฉบับ (deterministic ไม่ใช้ AI)
 */
export function extractIdentityAnchors({ newsTitle = '', newsBody = '', breakdownData = null }) {
  const text = `${newsTitle}\n${newsBody}`;
  const names = new Set();
  const anchors = new Set();

  // ── ชื่อบุคคล: จาก breakdown.key_facts.people + regex คำนำหน้า ──
  (breakdownData?.key_facts?.people || []).forEach((p) => {
    const clean = String(p).replace(/\(.*?\)/g, '').trim();
    // ตัดคำนำหน้าออกเพื่อให้ match ได้ทั้งแบบมี/ไม่มีคำนำหน้า
    const core = clean.replace(/^(นาย|นาง|นางสาว|น\.ส\.|ครู|หมอ|ดร\.|ด\.ช\.|ด\.ญ\.|พระ|อาจารย์|ลุง|ป้า|ตา|ยาย)\s*/, '');
    if (clean.length >= 3) names.add(clean);
    if (core.length >= 3 && core !== clean) names.add(core);
  });
  const nameRegex = /(?:นาย|นาง(?:สาว)?|น\.ส\.|ครู|หมอ|ดร\.|ด\.ช\.|ด\.ญ\.|พระ|อาจารย์)\s*([ก-๙]{2,15})/g;
  let m;
  while ((m = nameRegex.exec(text)) !== null) {
    if (m[1] && m[1].length >= 2) { names.add(m[0].trim()); names.add(m[1].trim()); }
  }

  // ── anchors: สถานที่/องค์กร/อายุ — สิ่งที่แยก "คนนี้" ออกจากคนชื่อซ้ำ ──
  (breakdownData?.key_facts?.places || []).forEach((p) => {
    const clean = String(p).replace(/\(.*?\)/g, '').replace(/^(จ\.|จังหวัด|อ\.|อำเภอ|ต\.|ตำบล)\s*/, '').trim();
    if (clean.length >= 3 && !STOP_TOKENS.has(clean)) anchors.add(clean);
  });
  const anchorPatterns = [
    /(?:จ\.|จังหวัด)\s*([ก-๙]{3,15})/g,
    /(?:อ\.|อำเภอ)\s*([ก-๙]{3,15})/g,
    /(?:โรงเรียน|รร\.)\s*([ก-๙A-Za-z]{3,25})/g,
    /(?:โรงพยาบาล|รพ\.)\s*([ก-๙A-Za-z]{3,25})/g,
    /(?:มหาวิทยาลัย|บริษัท|วัด|สภ\.)\s*([ก-๙A-Za-z]{3,25})/g,
  ];
  for (const re of anchorPatterns) {
    while ((m = re.exec(text)) !== null) {
      if (m[1] && !STOP_TOKENS.has(m[1])) anchors.add(m[1].trim());
    }
  }
  const ageMatch = text.match(/อายุ\s*(\d{1,3})\s*ปี/);
  if (ageMatch) anchors.add(`อายุ${ageMatch[1]}ปี`);

  return {
    names: [...names],
    anchors: [...anchors],
  };
}

/**
 * ชั้น 1: ตรวจ item เดียวกับชุด name/anchor
 * @returns 'person' (ชื่อ+anchor ตรง) | 'generic' (ไม่เอ่ยชื่อ) | null (ทิ้ง — ชื่อตรงแต่ไม่มี anchor)
 */
function classifyItem(itemText, names, anchors) {
  const t = _norm(itemText);
  const nameHit = names.some((n) => n.length >= 3 && t.includes(_norm(n)));
  const anchorHits = anchors.filter((a) => t.includes(_norm(a.replace(/อายุ(\d+)ปี/, '$1')))).length;

  if (!nameHit) return { cls: 'generic', anchorHits };
  if (anchorHits >= 1) return { cls: 'person', anchorHits };
  return { cls: null, anchorHits: 0 }; // ชื่อโผล่แต่ไร้หลักฐานยืนยัน → เสี่ยงคนละคน → ทิ้ง
}

/**
 * ชั้น 2: AI judge — เทียบ items กับข่าวต้นฉบับว่าเรื่อง/คนเดียวกันจริงไหม
 * fail-closed: ถ้า judge พัง เก็บเฉพาะ person ที่ anchorHits >= 2
 */
async function aiIdentityJudge({ newsTitle, newsBody, candidates }) {
  if (candidates.length === 0) return [];
  const list = candidates
    .map((c, i) => `${i + 1}. ${String(c.text).slice(0, 220)}`)
    .join('\n');

  const prompt = `คุณคือผู้ตรวจสอบข้อเท็จจริงของกองบรรณาธิการข่าว — งานเดียว: กัน "ข้อมูลคนละคน/คนละเหตุการณ์" ปนเข้าข่าว

=== ข่าวต้นฉบับ ===
หัวข้อ: ${newsTitle || '-'}
เนื้อหา: ${(newsBody || '').slice(0, 900)}
=== จบข่าวต้นฉบับ ===

=== ข้อมูลจากการค้นเว็บ (ตรวจทีละข้อ) ===
${list}
=== จบข้อมูล ===

กฎตัดสิน (เข้มงวดที่สุด — สงสัย = ตัดทิ้ง):
- "ใช้ได้" เฉพาะเมื่อมั่นใจว่าข้อมูลพูดถึง บุคคลเดียวกัน/เหตุการณ์เดียวกัน กับข่าวต้นฉบับ
  (ชื่อตรง + บริบทตรงอย่างน้อย 1 อย่าง: จังหวัด/อาชีพ/อายุ/องค์กร/เหตุการณ์)
- ชื่อเหมือนแต่บริบทต่าง (คนละจังหวัด คนละอาชีพ คนละวงการ) = "ใช้ไม่ได้"
- ข้อมูลทั่วไปที่ไม่ผูกกับตัวบุคคล (สถิติ/กฎหมาย/ความรู้) = "ใช้ได้แบบ generic"
- ไม่แน่ใจแม้แต่นิดเดียว = "ใช้ไม่ได้"

ตอบ JSON เท่านั้น:
{"verdicts":[{"i":1,"verdict":"same|generic|reject","reason":"สั้นๆ"}]}`;

  const result = await callAI({ model: MODEL_FAST, prompt, temperature: 0.0, maxTokens: 1200 });
  if (!Array.isArray(result?.verdicts)) throw new Error('judge ตอบรูปแบบไม่ถูกต้อง');
  return result.verdicts;
}

/**
 * MAIN — กรอง research items ก่อนปล่อยเข้า pipeline เขียนข่าว
 * @param {object} p { newsTitle, newsBody, breakdownData, items, getText? }
 * @returns { items (tagged _identity), droppedCount, report[] }
 */
export async function verifyResearchItems({ newsTitle, newsBody, breakdownData, items, getText }) {
  if (!items || items.length === 0) return { items: [], droppedCount: 0, report: [] };

  const textOf = getText || ((it) => [it.title, it.content, it.snippet, it.keyword, it.text].filter(Boolean).join(' '));
  const { names, anchors } = extractIdentityAnchors({ newsTitle, newsBody, breakdownData });
  const report = [];
  report.push(`anchors: names=[${names.slice(0, 4).join(',')}] anchors=[${anchors.slice(0, 5).join(',')}]`);

  // ── ชั้น 1: anchor classification ──
  const survivors = [];
  let dropped = 0;
  for (const it of items) {
    const { cls, anchorHits } = classifyItem(textOf(it), names, anchors);
    if (cls === null) {
      dropped++;
      report.push(`🔴 DROP(name-no-anchor): "${String(it.title || it.text || '').slice(0, 50)}"`);
      continue;
    }
    survivors.push({ item: it, cls, anchorHits, text: textOf(it) });
  }

  if (survivors.length === 0) {
    report.push(`ชั้น 1 ตัดหมด (${dropped} items) — ไม่มี research เข้าเนื้อหา (fail-closed)`);
    return { items: [], droppedCount: dropped, report };
  }

  // ── ชั้น 2: AI judge (เข้มงวด + fail-closed) ──
  let kept = [];
  try {
    const verdicts = await aiIdentityJudge({ newsTitle, newsBody, candidates: survivors });
    const byIndex = new Map(verdicts.map((v) => [Number(v.i), v]));
    survivors.forEach((s, idx) => {
      const v = byIndex.get(idx + 1);
      const verdict = v?.verdict || 'reject'; // ไม่มีคำตัดสิน = ทิ้ง
      if (verdict === 'reject') {
        dropped++;
        report.push(`🔴 DROP(judge): "${String(s.item.title || '').slice(0, 50)}" — ${v?.reason || 'no verdict'}`);
      } else {
        const identity = verdict === 'same' && s.cls === 'person' ? 'verified' : 'generic';
        kept.push({ ...s.item, _identity: identity });
      }
    });
  } catch (judgeErr) {
    // FAIL-CLOSED: judge พัง → เก็บเฉพาะที่หลักฐานแน่นที่สุด (ชื่อ + anchor ≥ 2)
    console.warn('[ResearchVerifier] ⚠️ AI judge failed — fail-closed mode:', judgeErr.message);
    report.push(`⚠️ judge failed (${judgeErr.message}) → fail-closed: เก็บเฉพาะ anchor≥2`);
    kept = survivors
      .filter((s) => s.cls === 'person' && s.anchorHits >= 2)
      .map((s) => ({ ...s.item, _identity: 'verified' }));
    dropped += survivors.length - kept.length;
  }

  report.push(`✅ kept ${kept.length}/${items.length} (verified=${kept.filter(k => k._identity === 'verified').length}, generic=${kept.filter(k => k._identity === 'generic').length})`);
  return { items: kept, droppedCount: dropped, report };
}
