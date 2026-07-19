// ============================================================
// 🏭 MEGA Workflow — สมองเล็กประจำสายพาน (เฟส 1: S1.5 / S2.5 / S4 · เฟส 2: S6)
// ------------------------------------------------------------
// ทุกตัวรับ "แฟ้มบริบท" แล้วคืน JSON ตายตัว — ใช้ callBrain (Claude หลัก/OpenAI สำรอง)
// หลักการ: อ่านของที่สถานีก่อนหน้าเขียนไว้เสมอ + เขียนเหตุผลกลับให้สถานีถัดไป
// ============================================================

import { callBrain } from '@/lib/aiClient';

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('สมองไม่ตอบเป็น JSON');
  return JSON.parse(t.slice(s, e + 1));
}

// ---------- S1.5 Preflight: ข่าวนี้ "ลงทุนแล้วคุ้ม" ไหม (ตายเร็ว = ถูก) ----------
export async function preflightBrain({ card }) {
  const system = `คุณคือบรรณาธิการโต๊ะข่าวไวรัล ประเมินว่า "ข่าวการ์ดนี้" ควรลงทุนผลิตครบวงจร (เจนเนื้อ+หาภาพ+ทำปก) หรือไม่
เกณฑ์: (1) มีแหล่งต้นทาง/ลิงก์จริงไหม (2) ทำเป็น "ภาพ" ได้ไหม — มีคนเด่นชัด/มีคลิป/เหตุการณ์ถ่ายรูปได้ (3) ไม่ใช่ข่าวนามธรรม/นโยบายล้วน
ตอบ JSON เท่านั้น: {"score":0.0-1.0,"hasPrimarySource":bool,"hasUsableVisuals":bool,"hasKnownPeople":bool,"hasClip":bool,"decision":"pass|skip","reason":"สั้นๆ ภาษาไทย"}
decision=pass เมื่อ score>=0.6 และ hasUsableVisuals=true`;
  const user = `การ์ดข่าวจากโต๊ะข่าว (JSON):\n${JSON.stringify(card, null, 1).slice(0, 3500)}`;
  const out = await callBrain({ system, user, maxTokens: 500, temperature: 0.1, cost: { step: 'MEGA S1.5 preflight' } });
  return parseJson(out.text || out);
}

// ---------- S2.5 เข็มทิศเรื่อง: วิสัยทัศน์เดียวกำกับทุกสถานีหลังจากนี้ ----------
export async function compassBrain({ card, extractText }) {
  const system = `คุณคือบรรณาธิการบริหารข่าวไวรัลไทย กำหนด "เข็มทิศเรื่อง" ให้ทีมทั้งสายพาน (คนเขียน/คนหาภาพ/คนทำปก) ใช้ร่วมกัน
กฎ: อิงเฉพาะข้อเท็จจริงในเนื้อข่าว ห้ามแต่งเพิ่ม · อารมณ์ต้องตรงหลักฐาน · ช็อตภาพในฝันต้องเป็นภาพที่ "มีโอกาสหาเจอจริง"
ตอบ JSON เท่านั้น:
{"angle":"มุมเล่าหลัก 1 ประโยค","primaryEmotion":"อารมณ์หลัก","secondaryEmotions":["อารมณ์รอง 2-3"],
"mainCharacters":[{"name":"ชื่อ-นามสกุลจริงตามข่าว พร้อมฉายา/ชื่อเล่นในวงเล็บถ้ามี เช่น 'จุน วนวิทย์ (อากงจุน)' — ห้ามใช้ฉายาลอยๆ โดยไม่มีชื่อจริง","role":"hero|reaction|context"}],
"visualDreamShots":[{"slot":"hero|reaction|action|context|evidence","description":"ช็อตที่อยากได้"}],
"doNotUse":["สิ่งที่ห้ามใช้ เช่น ภาพคนผิด/เหตุการณ์อื่น"],
"contentComplete":bool,"missingFacts":["ข้อเท็จจริงที่ยังขาด ถ้ามี"]}`;
  const user = `การ์ดข่าว: ${JSON.stringify({ title: card?.title, lane: card?.lane, category: card?.category }, null, 0)}\n\nเนื้อข่าวที่สกัดได้ (เต็ม):\n"""\n${String(extractText || '').slice(0, 6000)}\n"""`;
  const out = await callBrain({ system, user, maxTokens: 900, temperature: 0.2, cost: { step: 'MEGA S2.5 compass' } });
  return parseJson(out.text || out);
}

// ---------- S4 บก.คัดเวอร์ชัน: เลือกเนื้อที่ดีที่สุดแบบ "กันตาเอียง" ----------
// กัน position bias (งานวิจัย LLM-judge): ปิดชื่อเวอร์ชัน + สลับลำดับ + ให้คะแนนราย rubric ก่อนเลือก
export async function judgeBrain({ versions, extractText, compass }) {
  // สลับลำดับ + ปิดชื่อ (ก/ข/ค…) — เก็บ map ไว้ถอดกลับ
  const order = versions.map((_, i) => i).sort(() => Math.random() - 0.5);
  const labels = 'กขคงจฉชซ'.split('');
  const blinded = order.map((origIdx, k) => ({
    label: labels[k],
    text: String(versions[origIdx]?.content || versions[origIdx]?.text || versions[origIdx] || '').slice(0, 2600),
  }));

  const system = `คุณคือบรรณาธิการอาวุโสข่าวไวรัลไทย ตัดสิน "ฉบับร่าง" หลายตัวโดยยุติธรรม
ให้คะแนนราย rubric ทีละฉบับก่อน แล้วค่อยเลือกผู้ชนะ (ห้ามเลือกก่อนให้คะแนน):
- factuality (35): ตรงข้อเท็จจริงในเนื้อต้นทาง ไม่แต่งเพิ่ม
- angle (20): ตรงเข็มทิศเรื่อง (มุมเล่า/อารมณ์)
- platform_fit (15): เหมาะโพสต์เฟซบุ๊กไทย อ่านลื่น ย่อหน้าสั้น
- hook (15): เปิดเรื่องดึงคนหยุดอ่าน
- clarity (10): ใคร-ทำอะไร-ที่ไหน ชัด
- risk (5): ไม่หมิ่นเหม่/ไม่ชี้นำผิด
ตอบ JSON เท่านั้น: {"scores":[{"label":"ก","factuality":0,"angle":0,"platform_fit":0,"hook":0,"clarity":0,"risk":0,"total":0,"note":"สั้นๆ"}],"winner":"ก","reason":"ทำไมชนะ 1-2 ประโยค"}`;
  const user = `เข็มทิศเรื่อง: ${JSON.stringify(compass || {}, null, 0).slice(0, 1200)}
เนื้อต้นทาง (ย่อ): """${String(extractText || '').slice(0, 2500)}"""

ฉบับร่างทั้งหมด (ลำดับสุ่ม ไม่บอกที่มา):
${blinded.map((b) => `--- ฉบับ ${b.label} ---\n${b.text}`).join('\n\n')}`;

  const out = await callBrain({ system, user, maxTokens: 1200, temperature: 0.1, cost: { step: 'MEGA S4 judge' } });
  const res = parseJson(out.text || out);
  const winIdx = labels.indexOf(res.winner);
  return {
    chosenIndex: order[winIdx >= 0 ? winIdx : 0], // ถอดกลับเป็น index จริงของ versions
    scores: res.scores || [],
    reason: res.reason || '',
    blindOrder: order,
  };
}

// ---------- S6a 🎨 บก.ศิลป์ (ทีมกราฟฟิก 8 ก.ค.): ref DNA + เข็มทิศข่าว → "ใบสั่งงาน" ต่อช่อง ----------
// AI ทำงาน "ความหมาย" อย่างเดียว: แปลงปกต้นแบบ (คนใน ref) → คำสั่งของข่าวนี้ (คนในข่าวนี้)
// เรขาคณิต (พิกัด/ขนาด) ไม่ผ่าน AI — โครงจริงมาจาก dnaToTemplateSpec · faceSizePct ส่งตรงให้สูตรครอป
// ★ D3-B2: template_v1 authority marker (canonical shape) — สร้างจาก pure resolver (ไม่มี LLM/env)
//   ตรวจ axis พร้อม/source ถูก/slots>=3/geometry ครบ · พังชั้นไหน = throw error คงที่ (adapter จับ → waiting)
async function _templateV1Prep(refDNA) {
  const { resolveRefSlotView, buildRefSlotContract } = await import('@/lib/refSlotContract');
  const contract = buildRefSlotContract({ refDNA, mode: 'template_v1' });
  const auth = contract?.authority;
  if (!auth || auth.mode !== 'template_v1' || auth.axis !== 'template.slots' || auth.axisReady !== true) {
    throw new Error('ART_BRIEF_AUTHORITY_AXIS_NOT_READY');
  }
  if (contract.source !== 'template.slots' || !Array.isArray(contract.slots) || contract.slots.length < 3) {
    throw new Error('ART_BRIEF_AUTHORITY_SLOTS_INVALID');
  }
  // ★ D3-B2.1 (Codex P0): geometry ทุกช่องต้อง finite/positive/in-bounds (%) — ไม่ใช่แค่ "มี geometry"
  const _geomOk = (g) => !!g && [g.xPct, g.yPct, g.wPct, g.hPct].every((n) => typeof n === 'number' && Number.isFinite(n))
    && g.xPct >= 0 && g.yPct >= 0 && g.wPct > 0 && g.hPct > 0 && g.xPct + g.wPct <= 100 && g.yPct + g.hPct <= 100;
  if (contract.slots.some((s) => !_geomOk(s.geometry))) throw new Error('ART_BRIEF_AUTHORITY_GEOMETRY_INVALID');
  const view = resolveRefSlotView(refDNA, { mode: 'template_v1' });
  return {
    view,
    marker: { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: auth.effectiveViewHash },
  };
}

// ★ D3-B3 (Codex): PURE template-v1 "current-person authority" — no env/import/IO/time/random
//   สร้างตัวตน hero/reaction ของ "ข่าวปัจจุบัน" จาก compass.mainCharacters เพื่อ override personHint ที่ LLM
//   อาจลอกจาก refSubject (ref = แรงบันดาลใจฉาก/ความหมาย ไม่ใช่ตัวตนคนในข่าวนี้) · idempotent บน hint ที่แก้แล้ว
//   hero = ตัวแรก role=hero มิฉะนั้นตัวแรกที่รู้จัก · reaction = ตัวแรก role=reaction ที่ชื่อไม่ตรง hero (ลำดับ input)
export function templateV1PersonAuthority(compass) {
  // ★ D3-B3.1 (Codex): deterministic name/alias matching รองรับสคีมา "ชื่อจริง (ชื่อเล่น)" — ห้าม fuzzy prefix
  //   variants = แตกชื่อเป็นตัวแปร: ส่วนนอกวงเล็บ + ในแต่ละวงเล็บ (ชื่อเล่น) · match = มี variant คู่ใดตรงแบบ token
  //   (เท่ากันเป๊ะ OR ทุก token ของชื่อสั้นอยู่ในชื่อยาว โดย token แรกตรงกัน) → alias/ชื่อเล่นแมตช์ · lookalike ที่ token
  //   ต่างกัน (วนวิทย์ vs วนวิทยา) = ไม่แมตช์ · output คงสะกด canonical ของ compass เสมอ (ไม่คืน prefix มั่ว)
  const variants = (s) => {
    const raw = String(s ?? '').trim().toLowerCase();
    const out = [];
    const outside = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (outside) out.push(outside);
    for (const p of raw.match(/\(([^)]*)\)/g) || []) {
      const inner = p.slice(1, -1).replace(/\s+/g, ' ').trim();
      if (inner) out.push(inner);
    }
    if (!out.length && raw) out.push(raw);
    return out;
  };
  const tokMatch = (x, y) => {
    if (x === y) return true;
    const xt = x.split(' '), yt = y.split(' ');
    const [short, long] = xt.length <= yt.length ? [xt, yt] : [yt, xt];
    return short[0] === long[0] && short.every((t) => long.includes(t));
  };
  const nameMatch = (a, b) => {
    const va = variants(a), vb = variants(b);
    if (!va.length || !vb.length) return false;
    for (const x of va) for (const y of vb) if (tokMatch(x, y)) return true;
    return false;
  };
  const list = (Array.isArray(compass?.mainCharacters) ? compass.mainCharacters : [])
    .map((c) => ({ name: String(c?.name ?? '').trim(), role: String(c?.role ?? '').trim().toLowerCase() }))
    .filter((c) => c.name); // ลำดับ input เสถียร (ไม่ sort)
  const hero = list.find((c) => c.role === 'hero') || list[0] || null;
  const heroIdx = list.indexOf(hero);
  const names = list.map((c) => c.name);
  const n = list.length;
  const tokenCount = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
  const normLen = (s) => String(s ?? '').replace(/\s+/g, '').length;
  // ★ D3-B4.1 (Codex): order-independent grouping — union-find components + complete-link (clique) check
  //   nameMatch ไม่ transitive (A~B, B~C แต่ A≁C) → component เดียวแต่ "ไม่ใช่ clique" = ambiguous bridge (ห้ามยุบ/ห้ามบังคับ)
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (nameMatch(names[i], names[j])) parent[find(i)] = find(j);
  const byRoot = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); }
  const isClique = (idxs) => {
    for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++)
      if (!nameMatch(names[idxs[a]], names[idxs[b]])) return false;
    return true;
  };
  // ★ P1-B: comparator เดียวใช้ทั้ง canonical pick + candidate ordering — token count desc → normalized length desc → lexical asc
  const cmp = (a, b) => (tokenCount(b) - tokenCount(a)) || (normLen(b) - normLen(a)) || (a < b ? -1 : a > b ? 1 : 0);
  const canonicalOf = (idxs) => idxs.map((i) => names[i]).sort(cmp)[0];
  const components = [...byRoot.values()].map((idxs) => ({
    idxs, clique: isClique(idxs), canonical: canonicalOf(idxs), roles: new Set(idxs.map((i) => list[i].role)),
  }));
  const heroComp = heroIdx >= 0 ? components.find((comp) => comp.idxs.includes(heroIdx)) : null;
  const heroAmbiguous = !!heroComp && !heroComp.clique; // hero name เป็น bridge → กลุ่มกำกวม
  const heroName = heroComp ? (heroComp.clique ? heroComp.canonical : names[heroIdx]) : null;
  // non-hero = ทุก component ที่ไม่ใช่ heroComp (ชื่อที่ match hero ถูก union เข้า heroComp แล้ว)
  const nonHeroComps = components.filter((comp) => comp !== heroComp);
  const validNonHero = nonHeroComps.filter((comp) => comp.clique).map((comp) => comp.canonical).sort(cmp); // ★ P1-B canonical order
  const ambiguousNonHero = nonHeroComps.some((comp) => !comp.clique); // มี bridge non-hero = กำกวม
  const explicitReactionValid = nonHeroComps.filter((comp) => comp.clique && comp.roles.has('reaction')).map((comp) => comp.canonical).sort(cmp);
  // resolve hint → ตัวตน "clique เดียว" ที่มี component match พอดี 1 (0/หลาย component/non-clique = null)
  const resolveIdentity = (hint) => {
    const h = String(hint ?? '').trim();
    if (!h) return null;
    const matched = components.filter((comp) => comp.idxs.some((i) => nameMatch(names[i], h)));
    return (matched.length === 1 && matched[0].clique) ? matched[0].canonical : null;
  };
  const canonicalKnown = (hint) => resolveIdentity(hint); // unique clique identity (adapter guard ใช้)
  // ★ D3-B4 matrix (forced reaction identity) — เฉพาะเมื่อไม่กำกวมทั้ง hero และ non-hero:
  //   1) explicit non-hero reaction unique · 2) non-hero ชัดตัวเดียว (role ใดก็ได้ — เคส AC-0066) · มิฉะนั้น null
  let reactionName = null;
  if (!heroAmbiguous && !ambiguousNonHero) {
    if (explicitReactionValid.length === 1) reactionName = explicitReactionValid[0];
    else if (explicitReactionValid.length === 0 && validNonHero.length === 1) reactionName = validNonHero[0];
  }
  // reaction same-hero (เคส 3): ไม่มี non-hero + ไม่กำกวม + มี hero ชัด → candidate = hero
  const reactionSameHero = reactionName == null && !ambiguousNonHero && validNonHero.length === 0 && heroName != null && !heroAmbiguous;
  const reactionCandidates = reactionName != null ? [reactionName] : (reactionSameHero ? [heroName] : [...validNonHero]);
  const resolveHint = (role, llmHint) => {
    const r = String(role ?? '').trim().toLowerCase();
    if (r === 'hero' || r === 'main') return (heroName != null && !heroAmbiguous) ? heroName : resolveIdentity(llmHint);
    if (r === 'reaction') {
      if (reactionName != null) return reactionName;
      const id = resolveIdentity(llmHint);
      return (id != null && reactionCandidates.includes(id)) ? id : null; // รับเฉพาะ candidate ที่อนุญาต
    }
    return llmHint == null ? null : llmHint; // role อื่นคงเดิม (byte-exact)
  };
  // prompt fields ต่อ slot role — authority (ใช้เป๊ะเมื่อ non-null) + candidates (reaction: เลือกหนึ่งตามบริบทข่าว)
  const slotPersonPrompt = (role) => {
    const r = String(role ?? '').trim().toLowerCase();
    const heroOk = heroName != null && !heroAmbiguous;
    if (r === 'hero' || r === 'main') return { authority: heroOk ? heroName : null, candidates: heroOk ? [heroName] : [] };
    if (r === 'reaction') return { authority: reactionName != null ? reactionName : (reactionSameHero ? heroName : null), candidates: [...reactionCandidates] };
    return { authority: null, candidates: [] };
  };
  // ★ P1-A: data-readiness gate — ambiguity ใดๆ (hero bridge หรือ non-hero bridge) = authority ไม่พร้อม
  //   (compass ว่าง/ไม่มี hero โดยไม่มี bridge = ไม่ถือว่ากำกวม → authorityReady=true คงพฤติกรรมเดิม)
  const authorityReady = !heroAmbiguous && !ambiguousNonHero;
  return { hero: heroName, reaction: reactionName, hasExplicitReaction: explicitReactionValid.length === 1, distinctNonHero: validNonHero, heroAmbiguous, ambiguousNonHero, authorityReady, reactionCandidates, nameMatch, canonicalKnown, resolveHint, slotPersonPrompt };
}

export async function artBriefBrain({ refDNA, compass, deskTitle, typeMatched = false, mode = 'legacy', _callBrain = callBrain }) {
  // ★ D3-B2: template_v1 = prompt rows จาก resolved view (template axis + template shot ชนะ) + แนบ marker หลัง parse
  //   (LLM ห้ามเขียน marker เอง) · default 'legacy' = โค้ด/prompt/return-shape เดิมทุก byte (ไม่มี env read)
  // ★ D3-B3: template_v1 override personHint ด้วย current-person authority (identity ข่าวนี้) — legacy ไม่แตะ
  let _tplPrep = null;
  let slots;
  let _personAuth = null; // ★ D3-B3: null สำหรับ legacy (คงพฤติกรรม/byte เดิมทุกอย่าง)
  if (mode === 'template_v1') {
    _tplPrep = await _templateV1Prep(refDNA); // throw = adapter จับเป็น waiting
    _personAuth = templateV1PersonAuthority(compass);
    slots = _tplPrep.view.views.map((v) => {
      // ★ D3-B4.2 (Codex): ทุกแถวมี currentPersonAuthority (ใช้เป๊ะเมื่อ non-null) + currentPersonCandidates
      //   (reaction: ถ้า authority ว่าง ให้เลือกหนึ่งใน candidates ตามบริบทข่าวปัจจุบัน · ห้ามลอก refSubject)
      const _p = _personAuth.slotPersonPrompt(v.role);
      return {
        i: v.index, role: v.role, pos: v.pos || '', shot: v.shot || '', emotion: v.emotion || '',
        faceSizePct: v.faceSizePct || null,
        ...(typeMatched ? { refSubject: v.subject || '' } : {}),
        currentPersonAuthority: _p.authority,
        currentPersonCandidates: _p.candidates,
      };
    });
  } else {
    slots = (refDNA?.slots || []).map((s, i) => ({
      i, role: s.role, pos: s.pos || '', shot: s.shot || '', emotion: s.emotion || '',
      faceSizePct: Number(s.faceSizePct) || null,
      // แนวข่าวไม่ตรง ref จริง (แมตช์หลวม) → ไม่ให้เห็น subject ของ ref (กัน bias เลือกคนผิดแบบ CASE-356)
      ...(typeMatched ? { refSubject: s.subject || '' } : {}),
    }));
  }
  // ★ D3-B3: note ท้าย system (template_v1 เท่านั้น) — legacy = '' → prompt/args/return เดิมทุก byte
  const _authNote = _tplPrep ? `
★ ตัวตนของ "ข่าวนี้" (เฉพาะช่อง hero/main/reaction):
- ถ้าแถวมี "currentPersonAuthority" ไม่ว่าง → personHint = ค่านั้นเป๊ะ
- ช่อง reaction ที่ currentPersonAuthority ว่าง → เลือก personHint = หนึ่งใน "currentPersonCandidates" ที่ตรงบริบทข่าวปัจจุบันที่สุด (ใช้ความหมายของข่าวนี้เท่านั้น) · ถ้าไม่มีตัวใดเหมาะ = null
- ช่องบทอื่น (context/action/moment ฯลฯ) สั่ง personHint ตามปกติ
- "refSubject" = แรงบันดาลใจฉาก/ความหมายจากปกต้นแบบ ไม่ใช่ตัวตนคนในข่าวนี้ — ห้ามลอก refSubject เป็น personHint` : '';
  const system = `คุณคือบรรณาธิการศิลป์ (Art Director) ของเพจข่าวไวรัลไทย งานเดียว: เขียน "ใบสั่งงาน" ให้มือคัดภาพ
โจทย์: ปกต้นแบบ (ref) จัดช่องไว้แบบหนึ่ง — คุณต้องสั่งว่า "ข่าวนี้" แต่ละช่องควรใส่ภาพแบบไหน (ใคร/ช็อตอะไร/อารมณ์ไหน) ให้เล่าเรื่องแบบเดียวกับ ref แต่เป็นคนและเหตุการณ์ของข่าวนี้
กฎเหล็ก: (1) hero = หน้าเดี่ยวตัวเอกของข่าวเสมอ ห้ามภาพหมู่ (2) สั่งเฉพาะภาพที่ข่าวนี้มีโอกาสมีจริง (3) ช่องไหน ref ใส่โมเมนต์/หลักฐาน ให้แปลงเป็นโมเมนต์/หลักฐานของข่าวนี้
ตอบ JSON เท่านั้น: {"orders":[{"i":<ดัชนีช่องตาม ref>,"want":"สั่ง 1 ประโยค: ใคร+ช็อต+อารมณ์","personHint":"ชื่อคนที่ควรอยู่ช่องนี้ หรือ null"}],"storyNote":"ปกนี้เล่าเรื่องยังไง 1 ประโยค"}${_authNote}`;
  const user = `ข่าว: ${String(deskTitle || '').slice(0, 120)}
เข็มทิศข่าว: ${JSON.stringify({ angle: compass?.angle, primaryEmotion: compass?.primaryEmotion, mainCharacters: compass?.mainCharacters, visualDreamShots: compass?.visualDreamShots }, null, 0).slice(0, 1200)}
ช่องของปกต้นแบบ (เรขาคณิตล็อกแล้ว — สั่งแค่เนื้อหา):
${JSON.stringify(slots, null, 0).slice(0, 1800)}`;
  const out = await _callBrain({ system, user, maxTokens: 700, temperature: 0.15, cost: { step: 'MEGA S6a art brief' } });
  const brief = parseJson(out.text || out);
  // ผูกใบสั่งกลับเข้าช่อง (ตามดัชนี) + พก faceSizePct ไปให้สูตรครอป
  return {
    storyNote: brief.storyNote || '',
    orders: slots.map((s) => {
      const o = (brief.orders || []).find((x) => Number(x.i) === s.i) || {};
      // ★ D3-B3: template_v1 → override personHint ด้วย current-person authority · legacy = o.personHint || null (byte เดิม)
      return { i: s.i, role: s.role, pos: s.pos, shot: s.shot, emotion: s.emotion, faceSizePct: s.faceSizePct, want: o.want || '', personHint: _personAuth ? _personAuth.resolveHint(s.role, o.personHint || null) : (o.personHint || null) };
    }),
    // ★ D3-B2: แนบ marker เชิงโปรแกรม "หลัง" parse — LLM ไม่มีสิทธิ์เขียน · legacy = ไม่มี field นี้เลย
    ...(_tplPrep ? { refShotAuthority: _tplPrep.marker } : {}),
  };
}

// ---------- S6 ผู้กำกับจับคู่ช่อง: ป้าย triage (จ่ายเงินแล้วใน S5) + สูตรปกแสนไลค์ → ช่องละใบ+สำรอง ----------
// ไม่ดูภาพซ้ำ (ประหยัด) — ตัดสินจาก metadata ที่ตาติดป้ายไว้: ใคร/หมวด/อารมณ์/คุณภาพ/จำนวนหน้า
// ★ SEM-1 (Codex อนุมัติ design v2): slotContract = รายการช่อง instance จริงของ ref (จาก buildRefSlotContract)
//   ส่งมาเมื่อ semantic-selection เปิด+เงื่อนไขครบที่ฝั่ง adapter เท่านั้น — ไม่ส่ง = prompt เดิม byte-parity
//   _deps.callBrain = จุดฉีดสำหรับเทสเท่านั้น (default = callBrain จริง — production เดิมทุกอย่าง)
export async function slotDirectorBrain({ imagesMeta, compass, deskTitle, refDNA = null, artBrief = null, sceneInventory = '', slotContract = null, _deps = {} }) {
  const _cb = _deps.callBrain || callBrain;
  // ★ 19 ก.ค. (MEGA_HERO_PROMINENCE): field faceH (0-1, สัดส่วนสูงหน้าเทียบเฟรม) มีเฉพาะ megaAdapters.js
  //   เปิดสวิตช์ MEGA_HERO_PROMINENCE — ตรวจจาก "ข้อมูลจริงที่ส่งมา" ไม่ใช่ env var (ไฟล์นี้ไม่อ่าน process.env ที่ไหนเลย)
  //   ไม่มีใบไหนมี field นี้เลย (สวิตช์ปิด/ผู้ส่งเก่า) → ไม่เติมกฎใหม่ = prompt เดิมเป๊ะ byte-parity
  const _hasFaceH = Array.isArray(imagesMeta) && imagesMeta.some((m) => typeof m?.faceH === 'number');
  // 🎨 8 ก.ค. (ทีมกราฟฟิก): มีใบสั่งจากบก.ศิลป์ → ใช้ใบสั่งนำ (แปลงเป็นข่าวนี้แล้ว แม่นกว่า ref ดิบ)
  const briefBlock = artBrief?.orders?.length ? `
=== 🎨 ใบสั่งงานจากบก.ศิลป์ (แปลงปกต้นแบบเป็นข่าวนี้แล้ว — ทำตามใกล้ที่สุดเท่าที่พูลมีจริง) ===
เรื่องที่ปกต้องเล่า: ${String(artBrief.storyNote || '').slice(0, 150)}
${artBrief.orders.map((o) => `- ช่อง ${o.role}${o.pos ? `@${o.pos}` : ''}: ${o.want}${o.personHint ? ` (คน: ${o.personHint})` : ''}`).join('\n')}
⛔ กฎเหล็กเหนือใบสั่ง: hero = "หน้าเดี่ยว" ตัวเอกเสมอ (faces=1) ห้ามภาพหมู่/คู่
` : '';
  // 🎯 7 ก.ค. (ผู้ใช้สั่ง ref-first): ปกเป้าจากคลัง reference ต้อง "ขับการเลือกภาพ" ไม่ใช่แค่ตอนจัดวาง
  //   gated: ไม่มี refDNA = prompt เดิมเป๊ะ · มีใบสั่งแล้ว = ใบสั่งแทน (กันข้อมูลซ้ำ/ขัดกัน)
  const refBlock = briefBlock || (refDNA ? `
=== 🎯 ปกเป้าหมาย (คัดจากคลังปกไวรัลที่แนวตรงข่าวนี้ — เลือกภาพให้ตอบโจทย์ปกแบบนี้) ===
โครง: ${refDNA.layoutType || '-'}
ช่องของปกเป้า: ${(refDNA.slots || []).map((s) => `${s.role}=${s.desc || s.subject || ''}${s.emotion ? `(${s.emotion})` : ''}`).join(' · ') || '-'}
เล่าเรื่อง: ${String(refDNA.storyFlow || refDNA.compositionLogic || '').slice(0, 180)}
→ เลือกภาพลงช่องให้ได้ "บทบาท+อารมณ์" ใกล้ปกเป้าที่สุดเท่าที่พูลมีจริง (กฎเหล็กเดิมยังเหนือกว่าเสมอ)
⛔ กฎเหล็กเหนือปกเป้า: hero = "หน้าเดี่ยว" ของตัวเอกเสมอ (faces=1) — ห้ามภาพหมู่/ครอบครัว/คู่ขึ้น hero แม้ปกเป้าเป็นแนวครอบครัว (ภาพหมู่/คู่ไว้ช่อง reaction/context)
` : '');
  const system = `คุณคือผู้กำกับภาพปกข่าวไวรัลไทย จับคู่ "ภาพ → ช่องปก" ตามสูตรปกแสนไลค์ (5 ช่อง 5 บทบาท):
- hero: ตัวเอกของข่าว อารมณ์ตรงเรื่อง หน้าชัด (สำคัญสุด) — เลือกภาพแนวตั้ง/จัตุรัส (orient=tall/sq) หน้าใหญ่คมชัด · ⛔ภาพแนวนอนกว้าง (orient=wide เช่นแบนเนอร์เว็บข่าว) ห้ามเป็น hero ถ้ามีตัวเลือกอื่นของตัวเอก (ช่อง hero สูง — แบนเนอร์ถูกยืดจนเบลอ)
- reaction: บุคคลที่สอง/ปฏิกิริยาต่อเหตุการณ์ — เลือก "ภาพเดี่ยว" ของคนนั้นถ้ามี (ภาพคู่/กลุ่มครอปเหลือคนเดียวแล้วเศษตัวคนข้างค้างขอบ ไม่เนียน — เก็บภาพคู่ไว้ช่อง action/context ที่โชว์ทั้งภาพ)
- action: เหตุการณ์กำลังเกิด/โมเมนต์เคลื่อนไหว
- context: บริบท สถานที่ สิ่งของ ที่เล่าเรื่อง
- circle: โมเมนต์-หลักฐานเด็ด (ภาพวงกลมที่คนต้องซูมดู)
กฎเหล็ก: (1) ถูกคน 100% เหนือทุกข้อ — hero ต้องเป็น "ตัวเอกอันดับหนึ่ง" (mainCharacters role=hero) เท่านั้น ห้ามใช้ตัวละครรอง/คนอื่นในข่าวเป็น hero เด็ดขาด (2) ทุกช่องคนละภาพ ห้ามซ้ำ และควรคนละฉาก (3) เลือกจาก id ในรายการเท่านั้น (4) quality ต่ำ (<4) ใช้เมื่อจำเป็นจริงๆ (5) ช่องไหนไม่มีภาพเข้าเกณฑ์จริงๆ ให้ id=null พร้อมเหตุผล — ห้ามฝืนยัดภาพผิดคน (6) ภาพ clean=false (มีลายน้ำ/ตัวหนังสือทับ) ห้ามขึ้นช่อง เลือกภาพ clean=true ก่อนเสมอ — ยอมใช้ clean=false เฉพาะเมื่อไม่มีภาพสะอาดที่ถูกคน/เข้าเกณฑ์จริงๆ (hero ยังยึด "ถูกคน 100%" เหนือข้อนี้) (7) ภาพ newsScene=false = ภาพแฟ้มจากงาน/บริบทอื่น (เช่น ชุดกาล่า/พรมแดง ทั้งที่ข่าวคือเรื่องครอบครัว) — เลี่ยงเสมอ ใช้เฉพาะไม่มีภาพเหตุการณ์จริงให้เลือก
(8) ★ปกทั้งใบต้องเล่าเรื่องครบ: 5 ช่องรวมกันต้องเห็น "คน → กำลังทำอะไร → หลักฐาน/สถานที่" — ห้ามเป็นพอร์ตเทรตล้วนทุกช่อง ใช้ note แยก "โมเมนต์จริง" (กำลังมอบ/ทำ/ยก/ไหว้) จาก "ยืนโพสเฉยๆ"
(9) ★ฉากห้ามซ้ำข้ามช่อง: สองช่องห้ามมาจากฉาก/โมเมนต์เดียวกัน (เทียบจาก note — เฟรมจากคลิปเดียวกัน/เวทีเดียวกันหลายรูป = ฉากเดียวกัน)
(10) ★circle ควรเป็น "บุคคลที่สอง" ของเรื่อง (person คนละคนกับ hero) ถ้าพูลมีให้เลือก — วงกลมซ้ำหน้าคนเดียวกับ hero = ปกดูจน
(11) ★ภาพที่คนหันหลัง/ก้มกราบ/เห็นแต่แผ่นหลัง (สังเกตจาก note เช่น "กราบ/หันหลัง/มองจากด้านหลัง") ใช้ได้เฉพาะช่องฉากกว้าง (context) เท่านั้น — ห้ามลงช่องเล็ก/ช่องคน เพราะครอปแล้วหัวขาดง่ายและไม่เห็นว่าเป็นใคร${_hasFaceH ? '\n(12) ★faceH = สัดส่วนความสูงหน้าเทียบเฟรม (0-1, ยิ่งมากยิ่งหน้าใหญ่เด่น) — ช่อง hero เลือกภาพ faceH สูงก่อนเสมอ หลีกเลี่ยงภาพหน้าเล็กในช็อตกว้าง/มี backdrop เยอะ แม้ภาพนั้นจะดูสะอาด/คุณภาพสูง' : ''}
ตอบ JSON เท่านั้น:
{"slots":{"hero":{"id":"...","reason":"สั้นๆ","backups":["id","id"]},"reaction":{...},"action":{...},"context":{...},"circle":{...}},"note":"ข้อสังเกตรวม 1 ประโยค"}`;
  // ★ เฟส 1.2: meta มี note/orient เพิ่ม — งบ prompt แบบ "ตัดท้ายรายใบ" แทน slice กลางก้อน
  //   (เดิม slice(0,9000) หั่นกลาง JSON — ใบท้ายคิวหายเงียบ+ก้อนพัง) · เรียงสะอาด+คุณภาพมาก่อนแล้ว ตัดท้าย=ตัดใบแย่สุด
  const IMG_META_BUDGET = 18000;
  const _lines = (imagesMeta || []).map((m) => JSON.stringify(m));
  let _included = 0, _len = 0;
  for (const ln of _lines) {
    if (_len + ln.length + 2 > IMG_META_BUDGET) break;
    _len += ln.length + 2;
    _included++;
  }
  if (_included < _lines.length) console.log(`[MEGA S6] ✂️ meta เกินงบ prompt — ส่ง ${_included}/${_lines.length} ใบ (ใบท้ายคิว=คะแนนต่ำสุดถูกตัด)`);
  // ★ เฟส 3.3: compass เป็นบล็อกโครงสร้าง — เดิม JSON.stringify(...).slice(0,1200) หั่นกลางก้อน
  //   visualDreamShots/doNotUse อยู่ท้าย object โดนตัดหายเงียบ = ช็อตในฝัน/ข้อห้ามไม่เคยถึงสมองจริง
  const _c = compass || {};
  const _dnu = [].concat(_c.doNotUse || []).filter(Boolean);
  const compassBlock = [
    `มุมเล่า: ${String(_c.angle || '').slice(0, 220)}`,
    `อารมณ์: ${[_c.primaryEmotion, ...(_c.secondaryEmotions || [])].filter(Boolean).join('/').slice(0, 80)}`,
    `ตัวละคร: ${(_c.mainCharacters || []).map((m) => `${m?.name || ''}(${m?.role || ''})`).join(', ').slice(0, 220)}`,
    (_c.visualDreamShots || []).length ? `ช็อตในฝันต่อช่อง: ${(_c.visualDreamShots || []).map((v) => `${v?.slot || '?'}=${String(v?.description || '').slice(0, 70)}`).join(' · ').slice(0, 600)}` : '',
    _dnu.length ? `⛔ ห้ามใช้ภาพแนวนี้เด็ดขาด: ${_dnu.join(' / ').slice(0, 220)}` : '',
  ].filter(Boolean).join('\n');
  const user = `ข่าว: ${String(deskTitle || '').slice(0, 120)}
เข็มทิศเรื่อง:
${compassBlock}
${sceneInventory ? `🗺️ ฉากที่มีในพูล (จาก note ตาคัด · ×N = จำนวนใบ): ${String(sceneInventory).slice(0, 700)}\n` : ''}${refBlock}
คลังภาพที่ตายืนยันแล้วว่าเกี่ยวข้อง (metadata ต่อใบ — note=คำบรรยายฉากจากตาคัด ใช้แยกโมเมนต์จริงจากภาพโพส; ภาพจากคลิป (src=clip/youtube) note มัก generic ให้ดู persons/emotion/category แทน; orient=tall/wide/sq สัดส่วนภาพ):
[${_lines.slice(0, _included).join(',\n')}]`;
  // ★ SEM-1: system เฉพาะโหมด semantic — สร้างจากช่อง instance จริงของ ref · answer schema key = refSlotId
  //   literal `system` เดิมด้านบนไม่ถูกแตะแม้ตัวอักษรเดียว (byte-parity เมื่อไม่ส่ง slotContract)
  const _semSlots = Array.isArray(slotContract) && slotContract.length >= 3 ? slotContract : null;
  let systemSem = null;
  if (_semSlots) {
    const _heroInst = _semSlots.find((s) => (s.refRole === 'hero' || s.refRole === 'main') && s.shape !== 'circle')
      || _semSlots.find((s) => s.shape !== 'circle')
      || _semSlots[0];
    // กฎ 11 (คนละคนกับ hero) ห้ามรวมช่อง hero เอง — กัน ref ประหลาดที่ hero เป็นวงกลม (ผู้ตรวจ P1)
    const _circleIds = _semSlots.filter((s) => s.shape === 'circle' && s.id !== _heroInst.id).map((s) => s.id);
    const roleLines = _semSlots.map((s) => {
      const tags = [];
      if (s.id === _heroInst.id) tags.push('ช่องตัวเอกหลัก');
      if (s.shape === 'circle') tags.push('วงกลม');
      const desc = [
        s.subject ? `ปกเป้าใช้: ${String(s.subject).slice(0, 60)}` : '',
        s.eventIntent ? `ต้องการ: ${String(s.eventIntent).slice(0, 70)}` : '',
        s.wantPerson ? `คน: ${String(s.wantPerson).slice(0, 40)}` : '',
        s.refShot ? `ช็อต: ${String(s.refShot).slice(0, 20)}` : '',
      ].filter(Boolean).join(' · ');
      return `- ${s.id}${tags.length ? ` (${tags.join('/')})` : ''}: บท ${s.refRole}${desc ? ` — ${desc}` : ''}`;
    }).join('\n');
    const schemaSem = `{"slots":{${_semSlots.map((s) => `"${s.id}":{"id":"...","reason":"สั้นๆ","backups":["id","id"]}`).join(',')}},"note":"ข้อสังเกตรวม 1 ประโยค"}`;
    systemSem = `คุณคือผู้กำกับภาพปกข่าวไวรัลไทย จับคู่ "ภาพ → ช่องปก" ตามช่องจริงของปกเป้า (ref) ใบนี้ทีละช่อง:
${roleLines}
กฎเหล็ก: (1) ถูกคน 100% เหนือทุกข้อ — ${_heroInst.id} ต้องเป็น "ตัวเอกอันดับหนึ่ง" ของข่าวเท่านั้น และช่องที่ระบุ "คน:" ต้องได้ภาพของคนนั้นจริงตามป้าย person ห้ามคนอื่นเด็ดขาด (2) ทุกช่องคนละภาพ ห้ามซ้ำ และควรคนละฉาก (3) เลือกจาก id ในรายการเท่านั้น (4) quality ต่ำ (<4) ใช้เมื่อจำเป็นจริงๆ (5) ช่องไหนไม่มีภาพเข้าเกณฑ์จริงๆ ให้ id=null พร้อมเหตุผล — ห้ามฝืนยัดภาพผิดคน (6) ภาพ clean=false (มีลายน้ำ/ตัวหนังสือทับ) ห้ามขึ้นช่องถ้ามีตัวเลือกสะอาด (7) ภาพ newsScene=false = ภาพแฟ้มจากงาน/บริบทอื่น — เลี่ยงเสมอ ใช้เฉพาะไม่มีภาพเหตุการณ์จริง
(8) ★ปกทั้งใบต้องเล่าเรื่องครบ: ทุกช่องรวมกันต้องเห็น "คน → กำลังทำอะไร → หลักฐาน/สถานที่" — ห้ามเป็นพอร์ตเทรตล้วนทุกช่อง (9) ★ฉากห้ามซ้ำข้ามช่อง (เทียบจาก note — เฟรมคลิปเดียวกัน/เวทีเดิม = ฉากเดียวกัน) (10) ★${_heroInst.id} เลือกภาพ "หน้าเดี่ยว" (faces=1) หน้าใหญ่คมชัด แนวตั้ง/จัตุรัส (orient=tall/sq) ก่อนเสมอ — ห้ามภาพแนวนอนกว้าง/แบนเนอร์ถ้ามีตัวเลือกอื่นของตัวเอก${_circleIds.length ? ` (11) ★ช่องวงกลม (${_circleIds.join('/')}) ควรเป็นคนละคนกับ ${_heroInst.id} เมื่อช่องนั้นไม่ได้ระบุ "คน:" ไว้` : ''} (12) ★ภาพคนหันหลัง/ก้มกราบ/เห็นแต่แผ่นหลัง ใช้ได้เฉพาะช่องฉากกว้างเท่านั้น${_hasFaceH ? ` (13) ★faceH = สัดส่วนความสูงหน้าเทียบเฟรม (0-1) — ${_heroInst.id} เลือกภาพ faceH สูง (หน้าใหญ่เด่น) ก่อนเสมอ หลีกเลี่ยงภาพหน้าเล็กในช็อตกว้าง/มี backdrop เยอะ` : ''}
ตอบ JSON เท่านั้น:
${schemaSem}`;
  }
  const out = await _cb({ system: systemSem || system, user, maxTokens: 1100, temperature: 0.1, cost: { step: 'MEGA S6 slot director' } });
  return parseJson(out.text || out);
}
