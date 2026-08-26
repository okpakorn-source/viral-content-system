/**
 * 🗺️ clipBrain/segmentPlan.js — แผนผ่าคลิปยาว (B2 · 25 ส.ค. 69) — ตรรกะบริสุทธิ์ ไม่แตะดิสก์/เน็ต
 * ------------------------------------------------------------------
 * ที่มา (วัดจากคลังจริง 101 ใบ ยุค r125): คลิปยาวได้ความลึกแค่ 1/12 ของคลิปสั้น
 *   (≤5นาที 556 ตัว/นาที → 20-40นาที 159 → >40นาที 45) และ "ตาเห็น 7-8 ประเด็น แต่เขียนลึกแค่ 3"
 *   = หล่นมัธยฐาน 5 ประเด็น/คลิป · ต้นเหตุ: ยิงรอบเดียว งบก้อนเดียว บันไดความยาวสุดที่ "เกิน 8 นาที"
 * ทางแก้: ผ่าเป็นท่อนตามประเด็นที่ "ตา" เห็น แล้วให้ Gemini เจาะทีละท่อน — ทุกประเด็นได้งบเต็ม
 *
 * 🔑 หลักการ: สมองเป็นคน "เสนอ" แผน แต่ **โค้ดเป็นคนตรวจและตัดสิน** —
 *   แผนที่ผิดกติกา (ทับกัน/เกินความยาวคลิป/ข้ามเนื้อเยอะ) ถูกซ่อมด้วยโค้ดหรือทิ้งไปใช้แผนสำรอง
 *   ไม่มีทางที่สมองจะทำให้ระบบผ่าคลิปมั่วจนเนื้อหาหาย
 */

export const PLAN_DEFAULTS = {
  maxSegments: 8,      // เพดานท่อน = เพดานเงิน (เจ้าของเคาะ 25 ส.ค.)
  minSegmentSec: 150,  // ท่อนสั้นกว่านี้ไม่คุ้มค่าเรียก (รวมกับเพื่อนบ้าน)
  maxSegmentSec: 600,  // ท่อนยาวกว่านี้เริ่มโดนบีบเหมือนเดิม (10 นาที/ท่อน)
  maxSkipRatio: 0.12,  // ข้ามได้ไม่เกิน 12% ของคลิป (โฆษณา/ช่วงเปิดรายการ) — เกินนี้ = เนื้อหาย
  edgeToleranceSec: 3, // ปัดชนขอบคลิป
};

const clampInt = (v, lo, hi, def) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

// ค่า ratio (0-1) ห้ามปัดเป็นจำนวนเต็มเหมือน clampInt — ปัดแล้ว 0.12 จะหายเป็น 0
const clampRatio = (v, lo, hi, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * ตรวจ+ซ่อม option ที่ caller ส่งเข้ามาก่อนใช้งานทุกครั้ง (ไม่แก้ PLAN_DEFAULTS เอง)
 * กัน caller ส่งค่าผิดรูป (0/ลบ/NaN/เกินจริง) เข้าไปทำ loop พังหรือ invariant รั่ว
 */
function sanitizeOptions(opt) {
  const raw = opt && typeof opt === 'object' ? opt : {};
  const o = { ...PLAN_DEFAULTS, ...raw };
  o.maxSegments = clampInt(o.maxSegments, 1, 16, PLAN_DEFAULTS.maxSegments); // แผนสำรองต้องเดินต่อได้เสมอ อย่างน้อย 1 ท่อน
  o.maxSegmentSec = clampInt(o.maxSegmentSec, 1, 24 * 3600, PLAN_DEFAULTS.maxSegmentSec);
  o.minSegmentSec = clampInt(o.minSegmentSec, 1, o.maxSegmentSec, PLAN_DEFAULTS.minSegmentSec);
  o.maxSkipRatio = clampRatio(o.maxSkipRatio, 0, 1, PLAN_DEFAULTS.maxSkipRatio);
  o.edgeToleranceSec = clampInt(o.edgeToleranceSec, 0, 300, PLAN_DEFAULTS.edgeToleranceSec);
  return o;
}

/** "1:23" / "01:02:03" / "83" / 83 → วินาที (คืน null ถ้าอ่านไม่ออก) */
export function toSec(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 0 ? null : Math.round(v);
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})(?:\.\d+)?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** ดึงช่วงเวลาจากบรรทัด timeline ("0:00–1:30" / "00:00-02:27" / {time:...}) */
export function parseRange(x) {
  const raw = typeof x === 'string' ? x : String((x && (x.time || x.timeRange || x.range)) || '');
  const m = raw.replace(/\s/g, '').match(/^(.+?)[–\-—~]+(.+)$/);
  if (!m) {
    const one = toSec(raw);
    return one == null ? null : { startSec: one, endSec: null };
  }
  const a = toSec(m[1]);
  const b = toSec(m[2]);
  if (a == null) return null;
  return { startSec: a, endSec: b == null ? null : b };
}

/**
 * แผนสำรองแบบเครื่องจักร — แบ่งเท่าๆ กัน ใช้เมื่อสมองล่ม/แผนสมองใช้ไม่ได้
 * (fail-open: ระบบต้องเดินต่อได้เสมอแม้ไม่มีสมอง)
 */
export function fallbackPlan(durationSec, opt = {}) {
  const o = sanitizeOptions(opt);
  const dur = Math.max(1, Math.round(Number(durationSec) || 0));
  const n = Math.min(o.maxSegments, Math.max(1, Math.ceil(dur / o.maxSegmentSec)));
  const size = Math.ceil(dur / n);
  // คลิปยาวกว่า maxSegments×maxSegmentSec จริง (เกินเพดานเงิน) — ยอมให้ท่อนเกิน maxSegmentSec ได้
  // (ดีกว่าทิ้งเนื้อหาย) แต่ต้องขึ้นธงให้ผู้เรียกรู้ว่านี่ไม่ใช่แผนปกติ ไม่ใช่เงียบๆ เกินงบ
  const oversized = size > o.maxSegmentSec;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const startSec = i * size;
    if (startSec >= dur) break;
    segs.push({ no: segs.length + 1, startSec, endSec: Math.min(dur, startSec + size), topics: [] });
  }
  segs.oversized = oversized; // ยังเป็น array ปกติ (ไม่ทับ contract เดิม) แค่แปะธงเสริมให้ผู้เรียกเช็คได้
  return segs;
}

/**
 * ตรวจ+ซ่อมแผนจากสมองด้วยโค้ด (ไม่เชื่อสมองดื้อๆ)
 * @returns {{ok:boolean, segments:Array, warnings:string[], reason?:string}}
 *   ok=false = ใช้ไม่ได้จริง ให้ผู้เรียกถอยไป fallbackPlan
 */
export function validatePlan(rawSegments, durationSec, opt = {}) {
  const o = sanitizeOptions(opt);
  const dur = Math.round(Number(durationSec) || 0);
  const warnings = [];
  if (!(dur > 0)) return { ok: false, segments: [], warnings, reason: 'ไม่รู้ความยาวคลิป' };
  if (!Array.isArray(rawSegments) || !rawSegments.length) {
    return { ok: false, segments: [], warnings, reason: 'สมองไม่ได้ส่งท่อนมา' };
  }

  // 1) อ่านค่า + ตัดท่อนที่อ่านไม่ออก
  let segs = [];
  for (const s of rawSegments) {
    if (!s || typeof s !== 'object') continue;
    let a = toSec(s.startSec != null ? s.startSec : s.start);
    let b = toSec(s.endSec != null ? s.endSec : s.end);
    if (a == null || b == null) {
      const r = parseRange(s.timeRange || s.range || s.time || '');
      if (r) { if (a == null) a = r.startSec; if (b == null) b = r.endSec; }
    }
    if (a == null || b == null) { warnings.push('ข้ามท่อนที่อ่านเวลาไม่ออก'); continue; }
    if (b > dur && b - dur <= o.edgeToleranceSec) b = dur;      // ปัดชนขอบ
    if (a < 0) a = 0;
    if (b > dur) { warnings.push('ตัดปลายท่อนที่ยาวเกินคลิป'); b = dur; }
    if (b - a < 1) { warnings.push('ข้ามท่อนที่สั้นเกินจริง'); continue; }
    const topics = Array.isArray(s.topics) ? s.topics.map((t) => String(t || '').trim()).filter(Boolean)
      : (s.topic ? [String(s.topic).trim()] : []);
    segs.push({ startSec: a, endSec: b, topics });
  }
  if (!segs.length) return { ok: false, segments: [], warnings, reason: 'ไม่มีท่อนที่ใช้ได้เลย' };

  // 2) เรียงเวลา + แก้ท่อนทับกัน (เอาขอบท้ายของตัวก่อนเป็นเส้นแบ่ง — กันจ่าย Gemini ซ้ำช่วงเดิม)
  segs.sort((x, y) => x.startSec - y.startSec || x.endSec - y.endSec);
  const merged = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.startSec < prev.endSec) {
      warnings.push('แก้ท่อนที่ทับกัน');
      if (s.endSec <= prev.endSec) { // จมอยู่ในท่อนก่อนทั้งก้อน — ยุบรวมหัวข้อ
        prev.topics = [...new Set([...prev.topics, ...s.topics])];
        continue;
      }
      s.startSec = prev.endSec;
      if (s.endSec - s.startSec < 1) continue;
    }
    merged.push(s);
  }
  segs = merged;

  // 3) ท่อนยาวเกินเพดาน → ซอยย่อย (ยังดีกว่าปล่อยให้โดนบีบ)
  // เช็คจำนวน part ก่อนสร้าง array เสมอ — duration ผิดปกติ (เช่นตัวเลขพัง) ทำให้ parts พุ่งเป็นล้านได้
  // เกินเพดานท่อนของทั้งแผนแน่นอนอยู่แล้ว (ข้อ 5 จะ reject) ไม่ต้องเสียเวลา/หน่วยความจำสร้างมันขึ้นมาก่อน
  const split = [];
  const maxPartsGuard = o.maxSegments + 1;
  for (const s of segs) {
    const len = s.endSec - s.startSec;
    if (len <= o.maxSegmentSec) { split.push(s); continue; }
    const parts = Math.ceil(len / o.maxSegmentSec);
    if (!Number.isFinite(parts) || split.length + parts > maxPartsGuard) {
      return {
        ok: false, segments: [], warnings,
        reason: `ท่อนยาวผิดปกติ ซอยได้เกินเพดานท่อนทั้งแผน (${Number.isFinite(parts) ? parts : '∞'} ท่อนจากท่อนเดียว)`,
      };
    }
    const size = Math.ceil(len / parts);
    warnings.push(`ซอยท่อนยาว ${Math.round(len / 60)} นาที เป็น ${parts} ท่อน`);
    for (let i = 0; i < parts; i++) {
      const a = s.startSec + i * size;
      const b = Math.min(s.endSec, a + size);
      if (b - a >= 1) split.push({ startSec: a, endSec: b, topics: i === 0 ? s.topics : [] });
    }
  }
  segs = split;

  // 4) ท่อนสั้นเกิน → ผนวกเข้าเพื่อนบ้านที่ "ติดกันจริง" (ไม่กระโดดข้ามช่องว่าง)
  // เช็ค 2 ทาง: ท่อนปัจจุบันสั้น (รวมไปข้างหลัง) หรือ "ท่อนก่อนหน้าสั้น" (รวมมันไปข้างหน้า)
  // — ถ้าเช็คทางเดียว ท่อนสั้นตัวแรกสุดของ segs (ไม่มีใครมารวมมันจากด้านหลัง) จะหลุดรอด
  if (segs.length > 1) {
    const out = [];
    for (const s of segs) {
      const len = s.endSec - s.startSec;
      const prev = out[out.length - 1];
      const prevLen = prev ? prev.endSec - prev.startSec : 0;
      const touchesPrev = prev && s.startSec - prev.endSec <= o.edgeToleranceSec;
      const shortSide = len < o.minSegmentSec || (prev && prevLen < o.minSegmentSec);
      if (shortSide && touchesPrev && prevLen + len <= o.maxSegmentSec) {
        prev.endSec = s.endSec;
        prev.topics = [...new Set([...prev.topics, ...s.topics])];
        warnings.push('รวมท่อนสั้นเข้ากับท่อนก่อนหน้า');
        continue;
      }
      out.push(s);
    }
    // ท่อนสุดท้ายสั้นและยังแยกอยู่ → พยายามผนวกย้อนกลับ
    const last = out[out.length - 1];
    const before = out[out.length - 2];
    if (out.length > 1 && (last.endSec - last.startSec) < o.minSegmentSec &&
        last.startSec - before.endSec <= o.edgeToleranceSec &&
        (last.endSec - before.startSec) <= o.maxSegmentSec) {
      before.endSec = last.endSec;
      before.topics = [...new Set([...before.topics, ...last.topics])];
      out.pop();
      warnings.push('รวมท่อนท้ายที่สั้นเข้ากับท่อนก่อนหน้า');
    }
    segs = out;
  }

  // 4.5) invariant สุดท้าย — ตรวจทุกท่อนกับ min/max อีกครั้งหลัง merge/split ทั้งหมดจบแล้ว
  // (CB-12: ท่อนสั้นหัวแถว/กลางแถวที่ "ติดกันจริง" ถูกรวมไปแล้วในขั้น 4 แต่ท่อนสั้นที่มีช่องว่าง
  //  (เกิน edgeToleranceSec) หรือรวมแล้วจะเกิน maxSegmentSec ขวางอยู่ ไม่มีทางรวมได้เลย — เดิมหลุดผ่าน
  //  เพราะขั้น 6 เช็คแค่ "รวม skip ทั้งแผน" ไม่ได้เช็ค "แต่ละท่อน" ทำให้ท่อนสั้นที่ยัง 30 วิ < 150 วิ
  //  ปนออกไปกับแผนที่ ok:true ได้ทั้งที่ skip รวมต่ำ)
  // ข้อยกเว้น: เหลือท่อนเดียวทั้งแผน (segs.length===1) ไม่นับเป็นบั๊ก เพราะไม่มีเพื่อนบ้านให้รวมอยู่แล้ว
  // (คลิปทั้งคลิปสั้นกว่า minSegmentSec เอง — fallbackPlan ก็ให้ผลแบบเดียวกัน ไม่ใช่ merge ล้มเหลว)
  if (segs.length > 1) {
    const tooShort = segs.find((s) => s.endSec - s.startSec < o.minSegmentSec);
    if (tooShort) {
      return {
        ok: false, segments: [], warnings,
        reason: `ท่อนสั้นกว่าเพดาน (${tooShort.endSec - tooShort.startSec}/${o.minSegmentSec} วิ) รวมกับเพื่อนบ้านไม่ได้ (มีช่องว่างขวางหรือรวมแล้วเกินเพดานเงินต่อท่อน)`,
      };
    }
  }
  // max ไม่มีข้อยกเว้นแบบ min (ไม่มีเหตุผลที่ท่อนเดียวควรยาวเกินเพดานเงิน) — โครงสร้างขั้น 3/4 กันไว้แล้ว
  // ทุกทาง แต่ใส่ไว้เป็นเข็มขัดเส้นที่สองกันเผื่อ regression ในอนาคตแก้ขั้นก่อนหน้าแล้วลืมพิสูจน์ invariant นี้ใหม่
  const tooLong = segs.find((s) => s.endSec - s.startSec > o.maxSegmentSec);
  if (tooLong) {
    return {
      ok: false, segments: [], warnings,
      reason: `ท่อนยาวเกินเพดานเงินหลุดรอดหลัง merge/split (${tooLong.endSec - tooLong.startSec}/${o.maxSegmentSec} วิ)`,
    };
  }

  // 5) เกินเพดานจำนวนท่อน = เกินงบ → ใช้ไม่ได้ (ผู้เรียกถอยไปแผนสำรองที่คุมงบได้แน่นอน)
  if (segs.length > o.maxSegments) {
    return { ok: false, segments: [], warnings, reason: `ท่อนเกินเพดาน (${segs.length}/${o.maxSegments})` };
  }

  // 6) กันเนื้อหาย: รวมช่วงที่ถูกข้ามต้องไม่เกินโควตา
  let covered = 0;
  for (const s of segs) covered += s.endSec - s.startSec;
  const skipped = Math.max(0, dur - covered);
  if (skipped / dur > o.maxSkipRatio) {
    return {
      ok: false, segments: [], warnings,
      reason: `แผนข้ามเนื้อ ${Math.round((skipped / dur) * 100)}% (เพดาน ${Math.round(o.maxSkipRatio * 100)}%)`,
    };
  }
  if (skipped > 0) warnings.push(`ข้ามช่วงรวม ${skipped} วินาที (${Math.round((skipped / dur) * 100)}%)`);

  return {
    ok: true,
    warnings,
    segments: segs.map((s, i) => ({ no: i + 1, startSec: s.startSec, endSec: s.endSec, topics: s.topics })),
  };
}

/** พรอมต์สั่งสมองวางแผนผ่า — ให้ "แผนที่ประเด็น" ที่ตาเห็นรอบแรกไปเป็นวัตถุดิบ */
export function buildPlanPrompt({ durationSec, timeline = [], headline = '', caption = '', opt = {} }) {
  const o = sanitizeOptions(opt);
  const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const tl = (Array.isArray(timeline) ? timeline : []).slice(0, 40)
    .map((t, i) => `${i + 1}. ${(t && (t.time || t.timeRange)) || '?'} — ${(t && (t.topic || t.title || t.summary)) || ''}`)
    .join('\n') || '(ไม่มีแผนที่ประเด็น — วางแผนจากความยาวคลิปล้วน)';
  return `คุณคือหัวหน้าทีมข่าว กำลังวางแผน "ผ่าคลิปยาวเป็นท่อน" เพื่อให้ทีมดูแต่ละท่อนอย่างละเอียดแล้วถอดเนื้อครบทุกประเด็น

ข้อมูลคลิป
- ความยาวจริง: ${Math.round(durationSec)} วินาที (${mmss(Math.round(durationSec))} นาที)
- พาดหัวที่ได้จากการดูรอบแรก: ${headline || '(ไม่มี)'}
- แคปชั่นต้นทาง: ${String(caption || '(ไม่มี)').slice(0, 300)}

แผนที่ประเด็นจากการดูรอบแรก (เวลาโดยประมาณ)
${tl}

กติกาการวางแผน (ผิดข้อใดข้อหนึ่ง = แผนถูกทิ้ง)
1. แบ่งได้ไม่เกิน ${o.maxSegments} ท่อน · แต่ละท่อนยาว ${o.minSegmentSec}-${o.maxSegmentSec} วินาที
2. ท่อนต้องเรียงตามเวลา ห้ามทับกัน ห้ามเกิน ${Math.round(durationSec)} วินาที
3. **ต้องครอบคลุมคลิปเกือบทั้งหมด** — ข้ามได้รวมไม่เกิน ${Math.round(o.maxSkipRatio * 100)}% และข้ามได้เฉพาะช่วงที่ไม่มีเนื้อข่าวจริง (โฆษณา/เพลงคั่น/ทักทายเปิดรายการ) พร้อมบอกเหตุผล
4. **ตัดตรงรอยต่อของเรื่อง ไม่ใช่ตัดตรงกลางประโยคหรือกลางเหตุการณ์** — ถ้าประเด็นหนึ่งยาวเกินเพดาน ให้แบ่งตรงจุดที่เนื้อเปลี่ยนจังหวะ
5. ประเด็นหนึ่งควรอยู่ในท่อนเดียว — ถ้าคลิปสลับไปมาระหว่างเรื่อง ให้ยึด "ช่วงเวลา" เป็นหลัก แล้วระบุหัวข้อที่อยู่ในท่อนนั้นให้ครบ

ตอบเป็น JSON บรรทัดเดียว ห้ามมีข้อความอื่นนอก JSON:
{"segments":[{"startSec":0,"endSec":300,"topics":["หัวข้อที่อยู่ในท่อนนี้"],"why":"เหตุผลที่ตัดตรงนี้"}],"skipped":[{"startSec":0,"endSec":0,"reason":"ทำไมถึงข้าม"}],"note":"ข้อสังเกตสั้นๆ"}`;
}
