// ============================================================
// slotSolver.js — ★ Wave3 ชุด1 (10 ก.ค.): "สมองเลือกภาพลงช่อง" แบบ deterministic ล้วน
// ============================================================
//
// เหตุผล (shadow-first): ต้นตอ "ปกไม่นิ่ง/ภาพผิดบทบาท" คือ LLM director เลือกภาพลงช่อง
// แล้วผลแกว่งทุกรอบ. เป้าใหญ่ของ Wave3 = ถอด LLM ออกจาก "การเลือก" (เหลือหน้าที่ art brief +
// semantic tags) แล้วให้ solver นี้คิดทั้งชุดด้วยคะแนนถ่วง. แต่ **ชุดนี้ทำแค่ shadow** —
// solver คำนวณคู่ขนานใน s6_slots → log เทียบผล LLM → เก็บ dossier ไว้พิสูจน์บนเคสจริงก่อน
// จึงค่อยสลับให้ solver ตัดสินจริงในชุดถัดไป. ตอนนี้ไฟล์นี้ไม่แตะผลปกจริงแม้แต่ byte เดียว.
//
// สัญญาของไฟล์นี้ (ห้ามผิด — เพื่อให้ replay/เทสตรง 100%):
//   • pure ล้วน: ไม่ import อะไรเลย · ไม่มี IO/LLM/Math.random/Date · input เป็น plain data ทั้งหมด
//   • deterministic: input เดิม → ผล byte เดิมทุกครั้ง · เสมอกันตัดสินด้วย id เรียง string น้อยก่อน
//   • name matching ไม่ทำในนี้ — adapter คำนวณ identityHits ให้ (solver รับ boolean มาใช้)
//
// สเปกคะแนน: 6 แกน normalize 0-1 ก่อนคูณน้ำหนัก แล้ว normalize ผลรวมกลับเป็น 0-100
//   (hero ใช้ heroIdentity 40 แทน identity 30 + hard rule "ผิดคน hero = ตัดออกเลย")

// น้ำหนักแต่ละแกน (ตามแผน MEGA V2 Wave3 ข้อ 1)
export const SOLVER_WEIGHTS = { identity: 30, event: 25, technical: 20, clean: 10, shotPose: 10, source: 5, heroIdentity: 40 };

// ★ เกณฑ์ตัวเลข — mirror ค่าจริงในระบบ (imageQualityConfig.HERO_MIN_SHORT_SIDE=700, SHARPNESS_MIN_HERO=25)
//   แต่ **ไม่ import** ตามสัญญา pure (ถ้าเลขต้นทางเปลี่ยน ต้องมาแก้ที่นี่ด้วย — คอมเมนต์เตือนไว้)
const HERO_MIN_SHORT_SIDE = 700;   // technical: shortSide ถึงเกณฑ์นี้ = เต็ม, ต่ำกว่า = สเกลลง
const SHARPNESS_MIN = 25;          // sharpness ต่ำกว่านี้ (เฉพาะที่วัดค่าได้) = ลดครึ่ง
const SCENE_DUP_PENALTY = 0.30;    // ภาพ sceneKey ซ้ำกับที่ใช้ไปแล้ว โดนหัก 30% ตอนจัดอันดับ
const CIRCLE_ALT_THRESHOLD = 0.60; // circle: มีตัวเลือกอื่น (คนละคน hero) ≥60% ของตัวเต็ง → สลับเลี่ยงคนซ้ำ
// ★ Wave3 ชุด2 (10 ก.ค.): pHash64 (dHash 16 hex จาก libraryTriage.js) — จับภาพเกือบซ้ำระดับพิกเซล
//   (sceneKey จับด้วยข้อความ, ตัวนี้จับด้วยพิกเซลจริง — สองตัวคนละแบบ ใช้คู่กัน ไม่แทนกัน)
const PHASH_DUP_HAMMING_MAX = 10;  // hamming ≤10/64 บิต = ถือว่าภาพเกือบซ้ำ → โทษเหมือน sceneKey ซ้ำ (ค่าคงที่ร่วม SCENE_DUP_PENALTY)

// ---------- helper เล็ก (pure) ----------
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function round2(v) { return Math.round(v * 100) / 100; }

// trapezoid: เต็ม (1) ในช่วง [lo,hi] แล้วลาดลงเป็น 0 ที่ระยะ m นอกช่วง (ให้คะแนนไล่ระดับ ไม่ใช่ 0/1)
function trap(v, lo, hi, m) {
  if (v >= lo && v <= hi) return 1;
  if (v < lo) return clamp01((v - (lo - m)) / m);
  return clamp01(((hi + m) - v) / m);
}

// ★ Wave3 ชุด2: hamming distance ระหว่าง pHash64 สองค่า (hex string 16 ตัวอักษร = 64 บิต) — pure ล้วน เขียนเอง ห้าม import
//   popcount ต่อ nibble (0-15 → จำนวนบิต 1) แบบตารางคงที่ เร็วกว่า loop ทีละบิต
const _NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
// คืนจำนวนบิตที่ต่างกัน (0-64) · ค่าใดว่าง/ไม่ใช่ hex/ยาวไม่เท่ากัน = null (วัดไม่ได้ = ไม่เช็ค, fail-open)
export function hammingDistanceHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a.length !== b.length) return null;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const na = parseInt(a[i], 16);
    const nb = parseInt(b[i], 16);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return null; // อักขระนอก hex = พาร์สไม่ได้
    dist += _NIBBLE_POPCOUNT[na ^ nb];
  }
  return dist;
}

// ---------- แกนคะแนน (แต่ละตัวคืน 0-1) ----------

// identity: adapter ส่ง identityHits{ชื่อ:true/false} มาให้ (solver ไม่ match ชื่อเอง)
//   ตรง wantPerson=1 · ตรงตัวละครใดๆ ในเข็มทิศ=0.6 · ไม่รู้/ไม่ตรงใคร=0.3
//   คืน { frac, matchesWant, matchesHero, matchesAny } — ตัวเรียกใช้ต่อ (hero hard rule + circle-dup)
function identityAxis(img, slot, characters) {
  const hits = (img && img.identityHits && typeof img.identityHits === 'object') ? img.identityHits : {};
  const heroChars = characters.filter((c) => c && c.isHero && c.name);
  const matchesWant = !!(slot.wantPerson && hits[slot.wantPerson] === true);
  const matchesHero = heroChars.some((c) => hits[c.name] === true);
  const matchesAny = characters.some((c) => c && c.name && hits[c.name] === true);
  let frac;
  if (matchesWant) frac = 1;
  else if (matchesAny) frac = 0.6;
  else frac = 0.3;
  // hero ที่ยืนยันว่าเป็น "คน hero" จริง → identity เต็ม (ภาพนี้ถูกตัวเอกแล้ว)
  if (slot.role === 'hero' && matchesHero) frac = 1;
  return { frac, matchesWant, matchesHero, matchesAny };
}

// event: ภาพนี้เล่าเรื่องเดียวกับข่าวแค่ไหน — storyFit/10 (null=0.5 กลาง) · newsScene=false ลดครึ่ง
function eventAxis(img) {
  const sf = (img && img.storyFit != null && Number.isFinite(Number(img.storyFit))) ? clamp01(Number(img.storyFit) / 10) : 0.5;
  let v = sf;
  if (img && img.newsScene === false) v *= 0.5;
  return clamp01(v);
}

// technical: ขนาดจริงเทียบ 700 (null=0.4) ผสม quality/10 · sharpness<25 ลดครึ่ง · thumbOnly/lowRes ลดหนัก
function technicalAxis(img) {
  const ss = (img && img.shortSide != null && Number.isFinite(Number(img.shortSide)) && Number(img.shortSide) > 0) ? Number(img.shortSide) : null;
  const sizeComp = ss == null ? 0.4 : clamp01(ss / HERO_MIN_SHORT_SIDE);
  const qFrac = (img && img.quality != null && Number.isFinite(Number(img.quality))) ? clamp01(Number(img.quality) / 10) : 0.5;
  let t = 0.6 * sizeComp + 0.4 * qFrac;
  const sh = (img && img.sharpness != null && Number.isFinite(Number(img.sharpness))) ? Number(img.sharpness) : null;
  if (sh != null && sh < SHARPNESS_MIN) t *= 0.5; // วัดไม่ได้ (null) = ไม่ลด
  if (img && img.thumbOnly === true) t *= 0.4;
  if (img && img.lowRes === true) t *= 0.6;
  return clamp01(t);
}

// clean: พร้อมขึ้นปก (ไม่มีลายน้ำ/ตัวหนังสือ) = 1 · clean===false = 0
function cleanAxis(img) { return (img && img.clean === false) ? 0 : 1; }

// shotPose: ท่าช็อต (faceBoxHFrac เทียบ refShot) + จำนวนหน้าเทียบ role · refShot null = วัดจาก role อย่างเดียว
function shotPoseAxis(img, slot) {
  const faces = num(img && img.faces, 0);
  const hFrac = (img && img.faceBoxHFrac != null && Number.isFinite(Number(img.faceBoxHFrac))) ? clamp01(Number(img.faceBoxHFrac)) : null;
  const role = slot.role;
  // จำนวนหน้าเทียบบทบาทช่อง
  let faceComp;
  if (role === 'hero' || role === 'circle') faceComp = faces === 1 ? 1 : (faces === 0 ? 0 : 0.3);
  else if (role === 'context') faceComp = faces === 0 ? 1 : (hFrac != null ? clamp01(1 - 1.6 * hFrac) : 0.5); // กลับด้าน: ไร้หน้า/หน้าเล็ก=ดี
  else if (role === 'evidence') faceComp = faces === 0 ? 1 : 0.4;
  else if (role === 'secondary') faceComp = faces >= 1 ? 0.85 : 0.5;
  else faceComp = 0.5; // unknown
  // ท่าช็อตจาก faceBoxHFrac เทียบ refShot (ช่วงทับกันได้ ให้คะแนนไล่ระดับ)
  let shotComp = null;
  const rs = slot.refShot;
  if (rs && hFrac != null) {
    if (rs === 'closeup') shotComp = trap(hFrac, 0.35, 1, 0.20);
    else if (rs === 'bust') shotComp = trap(hFrac, 0.20, 0.40, 0.12);
    else if (rs === 'medium') shotComp = trap(hFrac, 0.08, 0.25, 0.08);
    else if (rs === 'wide') shotComp = trap(hFrac, 0, 0.12, 0.13);
    else shotComp = null;
  } else if (rs && hFrac == null) {
    shotComp = 0.5; // มี refShot แต่วัดหน้าไม่ได้ = กลางๆ
  }
  return shotComp == null ? faceComp : (0.5 * shotComp + 0.5 * faceComp);
}

// source: sourceScore null = 0.5 กลาง · ★ Wave3 ชุด2: adapter ส่งค่าจริง (normalize 0-1 แล้ว) มาได้ — ฟังก์ชันนี้ไม่ต้องแก้
function sourceAxis(img) {
  return (img && img.sourceScore != null && Number.isFinite(Number(img.sourceScore))) ? clamp01(Number(img.sourceScore)) : 0.5;
}

// ---------- คะแนนรวมภาพเดียวต่อช่อง ----------
// คืน { total(0-100), breakdown{แกน:0-1}, hardZero(bool), matchesWant, matchesHero, matchesAny }
function scoreImageForSlot(img, slot, characters) {
  const isHero = slot.role === 'hero';
  const id = identityAxis(img, slot, characters);
  const heroChars = characters.filter((c) => c && c.isHero && c.name);
  // ★ HERO HARD RULE: มีตัวเอก hero ในเข็มทิศ แต่ภาพไม่ตรงคน hero เลย = คะแนนรวม 0 (ห้ามติด top เด็ดขาด)
  if (isHero && heroChars.length > 0 && !id.matchesHero) {
    return { total: 0, breakdown: { identity: 0, event: 0, technical: 0, clean: 0, shotPose: 0, source: 0 }, hardZero: true, matchesWant: false, matchesHero: false, matchesAny: id.matchesAny };
  }
  const bd = {
    identity: id.frac,
    event: eventAxis(img),
    technical: technicalAxis(img),
    clean: cleanAxis(img),
    shotPose: shotPoseAxis(img, slot),
    source: sourceAxis(img),
  };
  const W = SOLVER_WEIGHTS;
  const idW = isHero ? W.heroIdentity : W.identity;
  const weighted = idW * bd.identity + W.event * bd.event + W.technical * bd.technical + W.clean * bd.clean + W.shotPose * bd.shotPose + W.source * bd.source;
  const maxW = idW + W.event + W.technical + W.clean + W.shotPose + W.source;
  const total = maxW > 0 ? (weighted / maxW) * 100 : 0;
  return { total, breakdown: bd, hardZero: false, matchesWant: id.matchesWant, matchesHero: id.matchesHero, matchesAny: id.matchesAny };
}

// ลำดับประมวลผลช่อง: hero → circle → ที่เหลือตามลำดับใน slots (คงลำดับเดิมในแต่ละกลุ่ม)
function orderSlots(slots) {
  const heroS = slots.filter((s) => s && s.role === 'hero');
  const circleS = slots.filter((s) => s && s.role === 'circle');
  const rest = slots.filter((s) => s && s.role !== 'hero' && s.role !== 'circle');
  return [...heroS, ...circleS, ...rest];
}

/**
 * solveSlotAssignments — เลือกภาพลงช่องทั้งชุดแบบ greedy deterministic
 * @param {{slots:Array, images:Array, characters:Array, constraints?:Object}} input
 *   slots: [{id, role:'hero'|'circle'|'context'|'evidence'|'secondary'|'unknown', wantPerson, refShot}]
 *   images: [{id, persons, identityHits, storyFit, newsScene, category, emotion, quality, faces,
 *             clean, shortSide, sharpness, thumbOnly, lowRes, sceneKey, faceBoxHFrac, sourceScore,
 *             pHash64}] // ★ Wave3 ชุด2: pHash64 = dHash hex 16 ตัวอักษร|null — จับภาพเกือบซ้ำระดับพิกเซล
 *   characters: [{name, role, isHero}]
 *   constraints: { sceneDupPenalty?, circleAltThreshold?, pixelDupPenalty? }
 * @returns {{assignments:Array<{slotId,imageId,total,breakdown,top3}>, holes:string[], notes:string[]}}
 *   assignments มีทุกช่อง (imageId=null สำหรับช่องที่ไม่มีภาพลง) — ช่องว่างซ้ำใน holes ด้วย
 */
export function solveSlotAssignments({ slots, images, characters, constraints } = {}) {
  const notes = [];
  const S = Array.isArray(slots) ? slots.filter((s) => s && s.id != null) : [];
  const IMG = Array.isArray(images) ? images.filter((x) => x && x.id != null) : [];
  const CH = Array.isArray(characters) ? characters.filter((c) => c && c.name) : [];
  const cfg = constraints || {};
  const sceneDupPenalty = clamp01(num(cfg.sceneDupPenalty, SCENE_DUP_PENALTY));
  const circleAltThreshold = clamp01(num(cfg.circleAltThreshold, CIRCLE_ALT_THRESHOLD));
  // ★ Wave3 ชุด2: โทษ near-dup พิกเซล — ค่าคงที่ร่วมกับ sceneDupPenalty (คนละสัญญาณ แต่หนักเท่ากัน) เว้นแต่ override
  const pixelDupPenalty = clamp01(num(cfg.pixelDupPenalty, SCENE_DUP_PENALTY));

  const order = orderSlots(S);
  const used = new Set();
  const usedScenes = new Set();
  const usedPHashes = []; // ★ Wave3 ชุด2: pHash64 ของภาพที่เลือกไปแล้วทุกใบ (array — ต้องเทียบกับทุกใบ ไม่ใช่ set ข้อความ)
  const assignments = [];
  const holes = [];
  let heroMatchedNames = null; // Set ชื่อตัวละครที่ hero image ที่เลือกแล้ว "ตรง" (ใช้กันวงกลมซ้ำคน hero)

  for (const slot of order) {
    const isHero = slot.role === 'hero';
    const isCircle = slot.role === 'circle';

    // ให้คะแนนทุกภาพที่ยังไม่ถูกใช้
    const scored = [];
    for (const img of IMG) {
      const id = String(img.id);
      if (used.has(id)) continue;
      const sc = scoreImageForSlot(img, slot, CH);
      if (isHero && sc.hardZero) continue; // hero: ผิดคน = ตัดออกจากการแข่งเลย (ห้ามติด top)
      const sk = img.sceneKey != null ? String(img.sceneKey) : null;
      const sceneDup = !!(sk && usedScenes.has(sk));
      // ★ Wave3 ชุด2: near-dup พิกเซล — เทียบ pHash64 ผู้ท้าชิงกับภาพที่เลือกไปแล้วทุกใบ (hamming ≤10/64 = เกือบซ้ำ)
      //   ทั้งคู่ null (ไม่มีค่า) = ไม่เช็ค (hammingDistanceHex คืน null เอง) → ไม่กระทบพฤติกรรมเดิมของภาพเก่าที่ไม่มี pHash64
      const iph = (typeof img.pHash64 === 'string' && img.pHash64) ? img.pHash64 : null;
      const pixelDup = !!(iph && usedPHashes.some((uph) => { const d = hammingDistanceHex(iph, uph); return d != null && d <= PHASH_DUP_HAMMING_MAX; }));
      // โทษฉากซ้ำ/พิกเซลซ้ำเฉพาะตอนจัดอันดับ (ไม่มีตัวเลือกอื่นก็ยังชนะ) — สองสัญญาณคนละแบบ โดนทั้งคู่ = โทษซ้อน (คูณ)
      let rank = sc.total;
      if (sceneDup) rank *= (1 - sceneDupPenalty);
      if (pixelDup) rank *= (1 - pixelDupPenalty);
      scored.push({ id, total: sc.total, rank, breakdown: sc.breakdown, sceneKey: sk, sceneDup, pHash64: iph, pixelDup, matchesHero: sc.matchesHero, img });
    }
    // จัดอันดับ deterministic: rank มากก่อน · เสมอ → id เรียง string น้อยก่อน
    scored.sort((a, b) => (b.rank - a.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const top3 = scored.slice(0, 3).map((s) => ({ id: s.id, total: round2(s.total) }));

    let chosen = scored.length ? scored[0] : null;

    // circle: ห้ามคนเดียวกับ hero ถ้ามีตัวเลือกอื่น (คนละคน) ที่คะแนน ≥ threshold ของตัวเต็ง
    if (chosen && isCircle && heroMatchedNames && heroMatchedNames.size) {
      const sharesHero = (im) => {
        const hits = (im && im.identityHits && typeof im.identityHits === 'object') ? im.identityHits : {};
        for (const nm of heroMatchedNames) if (hits[nm] === true) return true;
        return false;
      };
      if (sharesHero(chosen.img)) {
        const topScore = chosen.rank;
        const alt = scored.find((s) => !sharesHero(s.img));
        if (alt && alt.rank >= circleAltThreshold * topScore) {
          notes.push(`circle เลี่ยงคนซ้ำ hero: ${chosen.id}→${alt.id} (alt ${round2(alt.rank)} ≥ ${round2(circleAltThreshold * topScore)})`);
          chosen = alt;
        }
      }
    }

    if (chosen) {
      used.add(chosen.id);
      if (chosen.sceneKey) usedScenes.add(chosen.sceneKey);
      // ★ Wave3 ชุด2: บันทึก pHash64 ของภาพที่เลือกแล้ว (ไม่ว่าจะมาจาก chosen เดิมหรือ alt ที่สลับใน circle-dup — ทั้งคู่มี field นี้จาก scored.push แล้ว)
      if (chosen.pHash64) usedPHashes.push(chosen.pHash64);
      if (isHero) {
        heroMatchedNames = new Set(
          CH.filter((c) => {
            const hits = (chosen.img.identityHits && typeof chosen.img.identityHits === 'object') ? chosen.img.identityHits : {};
            return hits[c.name] === true;
          }).map((c) => c.name)
        );
      }
      assignments.push({ slotId: slot.id, imageId: chosen.id, total: round2(chosen.total), breakdown: chosen.breakdown, top3 });
    } else {
      holes.push(slot.id);
      notes.push(`${slot.id}: ไม่มีภาพลงช่อง (${isHero ? 'ไม่มีภาพตรงคน hero' : 'พูลหมด/ถูกใช้ครบ'})`);
      assignments.push({ slotId: slot.id, imageId: null, total: 0, breakdown: null, top3 });
    }
  }

  return { assignments, holes, notes };
}
