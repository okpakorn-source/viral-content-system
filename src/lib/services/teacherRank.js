/**
 * teacherRank — กติกาหยิบครูไวรัลแบบใหม่ ("rank-v2") · โค้ดล้วน **ไม่มี import ใดๆ**
 *   (ตั้งใจให้ไฟล์นี้ยืนเดี่ยว: ข้อสอบยิงตรงได้ และไม่ไปชนเทสเก่าที่โหลด viralFewshot.js แบบแทน import ด้วย stub)
 *
 * ★ 2 ก.ย. 69 — เจ้าของสั่ง "แมตช์ก่อน แล้วยอดสูงนำ ไม่ล็อก ไม่เอาแต่ดัง"
 *   ที่มา: จำลองย้อนหลังกับสมุดประวัติหยิบครูจริง (C:\tmp\news-r233-run\teacher-rule-sim.mjs)
 *   ได้ไลก์เฉลี่ยของครูที่หยิบ +28% เทียบ weightedSample เดิม โดยยังกระจายครูได้ (ไม่ล็อกใบดัง)
 *   เปิด/ปิดอยู่ที่ viralFewshot.js: TEACHER_RANK_V2 (ค่าเริ่มต้นเปิด · =0 คืน weightedSample เดิมไบต์ต่อไบต์)
 *
 * ลำดับกติกา (ทำตามลำดับนี้เท่านั้น — สลับแล้วผลเพี้ยน):
 *   1) ด่านแมตช์: ต้องมี hitsTheme หรือ hitsEmo อย่างน้อย 1 **และ** score ≥ 2
 *      ใบที่เข้าโผเพราะ "เกราะ 1 พื้นชั้นเดิม" อย่างเดียว (guard แต่ไม่มี hit) จึงไม่ผ่านโดยอัตโนมัติ
 *      ผ่านน้อยกว่า k → ผ่อนเป็น score > 0 (gate='loose') → ยังไม่พอ → รับทุกใบ (gate='any')
 *   2) เรียงไลก์จริงมาก→น้อย (ไม่มีข้อมูลไลก์ = ท้ายแถว) · เสมอกัน: score มาก→น้อย แล้ว id (นิ่งทุกเครื่อง)
 *   3) พื้นคุณภาพ: ถ้าในแถวมีใบไลก์ ≥ floor อยู่ (50,000 พอดี = ถึงพื้น) ใบที่ต่ำกว่า floor ถูกข้าม
 *      ⚠️ ผลข้างเคียงเชิงออกแบบ (ผู้ตรวจไขว้ชี้ 2 ก.ย. 69 — ยังไม่ได้ให้เจ้าของเคาะ): ใบที่ "ไม่มีข้อมูลไลก์" นับเป็นต่ำกว่าพื้นด้วย
 *         วันนี้ครู 52/202 ใบไม่มีไลก์ใน data/viral-likes-real.json (+ ครูใหม่ทุกใบในอนาคต) → เมื่อโผมีใบ ≥ 50k ใบพวกนี้
 *         จะถูกหยิบได้ทางเติม (ข้อ 6) เท่านั้น · ทางเลือกถ้าเจ้าของไม่ได้ตั้งใจ: ถือใบไม่มีไลก์ว่า "ผ่านพื้น" หรือใช้ค่ากลางของโผแทน 0
 *         ระหว่างนี้: เพิ่มครูใหม่ต้องอัปเดตไฟล์ไลก์ทุกครั้ง (scripts/match-real-likes.mjs หรือแมตช์จาก CSV แบบ 2 ก.ย. 69)
 *   4) กันซ้ำ: recentUsageById[id] ≥ cap (นับใน 7 วันโดยผู้เรียก) → ข้าม
 *   5) หมุน: สุ่มถ่วงน้ำหนัก sqrt(likes) ในกลุ่มหัวแถว rotate ใบ — อันดับ 1 ไม่ผูกขาด
 *      🔴 ความสุ่มอยู่ตรงนี้จุดเดียว · ส่ง opts.rnd เอง = ผลนิ่ง 100% (ข้อสอบใช้)
 *   6) ยังไม่ครบ k → เติมจากใบที่ข้าม "ตามลำดับไลก์" (ใบแรงที่ติด cap มาก่อนใบต่ำกว่าพื้น) — ต้องได้ครูครบเสมอ
 *
 * @param {Array<{id:string, score:number, hitsTheme?:any[], hitsEmo?:any[], guard?:boolean}>} candidates โผจาก shortlistExamples (ใส่ช่องอื่นติดมาได้ เช่น row — คืนอ็อบเจกต์เดิมกลับไปใน picks)
 * @param {{likesById?:object, recentUsageById?:object, k?:number, cap?:number, floor?:number, rotate?:number, rnd?:()=>number}} opts
 * @returns {{picks: object[], debug: {gate:string, sortedIds:string[], skipped:{id:string, why:string}[], backfilled:string[], hasGood:boolean, reason:string}}}
 */

export const RANK_DEFAULTS = Object.freeze({ k: 2, cap: 8, floor: 50000, rotate: 3 });

const _cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const _cnt = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? (v > 0 ? v : 0) : v ? 1 : 0);
const _int = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; };
const _kfmt = (n) => (n == null ? 'ไม่มีไลก์' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** ไลก์จริงของใบ: รับทั้ง map id→number และ id→{likes} (โครง data/viral-likes-real.json byId) · ค่าขยะ/0/ติดลบ = ไม่มีข้อมูล */
export function likesFromMap(likesById, id) {
  if (!likesById || typeof likesById !== 'object') return null;
  const e = likesById[id];
  const n = typeof e === 'number' ? e : Number(e?.likes);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function rankTeachers(candidates, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const k = Math.max(1, _int(o.k, RANK_DEFAULTS.k));
  const cap = Math.max(0, _int(o.cap, RANK_DEFAULTS.cap));           // 0 = ปิดกันซ้ำ
  const floor = Math.max(0, _int(o.floor, RANK_DEFAULTS.floor));     // 0 = ปิดพื้น
  const rotate = Math.max(1, _int(o.rotate, RANK_DEFAULTS.rotate));  // 1 = ไม่หมุน (หยิบหัวแถวเสมอ)
  const rnd = typeof o.rnd === 'function' ? o.rnd : Math.random;
  const likesById = o.likesById && typeof o.likesById === 'object' ? o.likesById : {};
  const usage = o.recentUsageById && typeof o.recentUsageById === 'object' ? o.recentUsageById : {};

  const cands = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c === 'object' && c.id != null && c.id !== '')
    .map((c) => {
      const id = String(c.id);
      const used = Number(usage[id]);
      return {
        c, id,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0,
        matched: _cnt(c.hitsTheme) + _cnt(c.hitsEmo) > 0,
        likes: likesFromMap(likesById, id),
        used: Number.isFinite(used) && used > 0 ? used : 0,
      };
    });

  // 1) ด่านแมตช์ (strict → loose → any)
  let gate = 'strict';
  let pool = cands.filter((x) => x.matched && x.score >= 2);
  if (pool.length < k) { gate = 'loose'; pool = cands.filter((x) => x.score > 0); }
  if (pool.length < k) { gate = 'any'; pool = cands.slice(); }

  // 2) เรียงไลก์ (ไม่มีข้อมูล = -1 = ท้ายแถว) · เสมอ → score → id
  pool.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || b.score - a.score || _cmpId(a.id, b.id));

  // 3) พื้นคุณภาพ + 4) กันซ้ำ
  const hasGood = floor > 0 && pool.some((x) => (x.likes ?? 0) >= floor);
  const elig = [];
  const skipped = []; // คงลำดับไลก์ไว้ — ใช้เติมข้อ 6
  for (const x of pool) {
    if (hasGood && (x.likes ?? 0) < floor) { skipped.push({ x, why: `ต่ำกว่าพื้น ${floor.toLocaleString('en-US')} (${_kfmt(x.likes)})` }); continue; }
    if (cap > 0 && x.used >= cap) { skipped.push({ x, why: `ใช้ไป ${x.used} ครั้ง/7วัน ≥ cap ${cap}` }); continue; }
    elig.push(x);
  }

  // 5) หมุนในกลุ่มหัวแถว rotate ใบ — น้ำหนัก sqrt(likes) (ไม่มีไลก์ = 1)
  const picks = [];
  while (picks.length < k && elig.length) {
    const head = elig.slice(0, rotate);
    const w = head.map((x) => Math.sqrt(x.likes ?? 1));
    const total = w.reduce((s, v) => s + v, 0);
    let roll = rnd() * total;
    let idx = head.length - 1; // กันเศษทศนิยมหลุดปลายลูป (แบบแผนเดียวกับ weightedSample)
    for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) { idx = i; break; } }
    const chosen = head[idx];
    picks.push(chosen);
    elig.splice(elig.indexOf(chosen), 1);
  }

  // 6) เติมจากใบที่ข้าม ตามลำดับไลก์ (ต้องได้ครูครบ k เสมอเมื่อโผมีพอ)
  const backfilled = [];
  for (const s of skipped) {
    if (picks.length >= k) break;
    picks.push(s.x);
    backfilled.push(s.x.id);
  }

  const nCap = skipped.filter((s) => s.why.startsWith('ใช้ไป')).length;
  const nFloor = skipped.length - nCap;
  const reason = [
    `ด่านแมตช์ ${gate === 'strict' ? 'ผ่าน' : `ผ่อน(${gate})`} ${pool.length}/${cands.length} ใบ`,
    'เรียงไลก์จริง',
    floor > 0 ? `พื้น ${floor.toLocaleString('en-US')} ${hasGood ? 'บังคับ' : 'ไม่บังคับ (ไม่มีใบถึงพื้น)'}` : 'ไม่ใช้พื้น',
    skipped.length ? `ข้าม ${skipped.length} (cap ${nCap} · ต่ำกว่าพื้น ${nFloor})` : 'ไม่ข้ามใบไหน',
    `หมุนหัวแถว ${rotate}`,
    `หยิบ ${picks.map((x) => `${x.id.slice(0, 8)}(${_kfmt(x.likes)}${x.used ? ` ใช้${x.used}` : ''})`).join(' ')}`,
    backfilled.length ? `เติมจากใบที่ข้าม ${backfilled.length}` : '',
  ].filter(Boolean).join(' · ');

  return {
    picks: picks.map((x) => x.c),
    debug: {
      gate,
      sortedIds: pool.map((x) => x.id),
      skipped: skipped.map((s) => ({ id: s.x.id, why: s.why })),
      backfilled,
      hasGood,
      reason,
    },
  };
}
