/**
 * =====================================================
 * News Studio — ชุดคีย์ Anthropic แบบสลับใช้ (10 พ.ย. 69)
 * =====================================================
 * เจ้าของสั่ง 10 พ.ย. 69: "ใส่หลายคีย์ไว้ ให้มันสลับใช้กันถ้าหมด" — เฉพาะระบบเขียนข่าวตัวใหม่
 *
 * ตั้งค่า (Vercel → Environment Variables):
 *   ANTHROPIC_API_KEY      คีย์หลัก (ตัวเดิม — ระบบส่วนอื่นของเว็บยังใช้คีย์นี้ตัวเดียว)
 *   ANTHROPIC_API_KEY_2 … ANTHROPIC_API_KEY_9   คีย์สำรอง ใช้ตามลำดับเลข
 *   ★ คีย์สำรองต้องมาจาก "คนละบัญชี (organization)" จึงจะมีเครดิตและโควตาแยกกัน — หลายคีย์ในบัญชีเดียวกันหมดพร้อมกัน
 *
 * สลับคีย์เมื่อ "คีย์นั้น" ใช้ไม่ได้ (อ้างอิงชนิดข้อผิดพลาดของ API):
 *   402 billing_error (เครดิต/การชำระเงิน) · 400 ที่ข้อความบอกว่าเครดิตหมดหรือถึงเพดานใช้จ่ายรายเดือน
 *   401 authentication_error (คีย์ผิด/ถูกยกเลิก) · 403 permission_error
 *   404 not_found_error (บัญชีของคีย์นั้นใช้โมเดลนี้ไม่ได้) · 429 rate_limit_error (โควตาของบัญชีนั้นเต็มชั่วคราว)
 * ไม่สลับเมื่อปัญหาไม่ได้อยู่ที่คีย์ (คำขอผิดรูป 400 · ระบบของผู้ให้บริการล่ม 5xx/529 · หมดเวลา) — เปลี่ยนคีย์ก็ได้ผลเดิม และเสียเวลาของงานเป็นสองเท่า
 *
 * มีคีย์เดียว = ไม่มีอะไรให้สลับ: ข้อผิดพลาดถูกส่งต่อตามเดิมทุกประการ (ไม่พักคีย์ ไม่เปลี่ยนชนิดข้อผิดพลาด)
 *
 * ไฟล์นี้ไม่สร้าง client เอง ไม่มี import แบบ alias และไม่พิมพ์/คืนค่าคีย์ออกไปที่ใด (สถานะบอกแค่ลำดับและชื่อตัวแปร)
 * สถานะ "พักคีย์" อยู่ในหน่วยความจำของแต่ละเครื่อง: เครื่องใหม่จะรู้เองจากคำขอแรกที่ล้ม (ข้อผิดพลาดชนิดคีย์ตอบกลับทันที ไม่กินเวลางาน)
 * → หน้าสถานะจึงอ่านสัญญาณจริงจาก "ประวัติงาน" ซึ่งทุกเครื่องเห็นร่วมกัน (keyAlertFromRuns)
 */

const clean = (v) => String(v ?? '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
/** แยกค่าในช่องหนึ่งเป็นคีย์ทีละตัว — ลบตัวอักษรล่องหนที่มักติดมาตอนคัดลอก (zero-width) ก่อน แล้วแยกด้วยช่องว่าง/ขึ้นบรรทัด/จุลภาค */
const tokensOf = (v) => String(v ?? '').replace(/[​-‍⁠﻿]/g, '').split(/[\s,;]+/).map(clean).filter(Boolean);
/** ค่าคีย์ที่ส่งเป็น header ได้: ตัวอักษรที่พิมพ์ได้ล้วน ไม่มีช่องว่าง/ขึ้นบรรทัด (ค่าที่ header ไม่รับจะทำให้ SDK โยนข้อความที่มีค่าคีย์ติดออกมา) */
const USABLE_KEY = /^[\x21-\x7E]+$/;

export const KEY_ENV_NAMES = Object.freeze(['ANTHROPIC_API_KEY', ...Array.from({ length: 8 }, (_, i) => `ANTHROPIC_API_KEY_${i + 2}`)]);

/** ระยะพักคีย์ตามเหตุ (มิลลิวินาที) — ครบแล้วลองคีย์นั้นใหม่เอง (เผื่อเติมเงิน/แก้คีย์แล้ว) */
export const KEY_BENCH_MS = Object.freeze({ billing: 10 * 60 * 1000, auth: 30 * 60 * 1000, permission: 30 * 60 * 1000, model: 30 * 60 * 1000, rate: 60 * 1000 });

export const KEY_REASON = Object.freeze({ billing: 'เครดิตหมดหรือมีปัญหาการชำระเงิน', auth: 'คีย์ไม่ถูกต้องหรือถูกยกเลิก', permission: 'คีย์นี้ไม่มีสิทธิ์', model: 'บัญชีของคีย์นี้ใช้โมเดลนี้ไม่ได้', rate: 'โควตาของบัญชีนี้เต็มชั่วคราว' });

/** รหัสคำเตือนเรื่องคีย์ในประวัติงาน — เป็นเรื่องของเจ้าของ ไม่ส่งถึงพนักงานใน Discord */
export const KEY_WARNING_CODES = Object.freeze(['KEY_BENCHED', 'KEYS_ALL_BENCHED']);

/**
 * คีย์ทั้งหมดที่ตั้งไว้ ตามลำดับการใช้
 * - ค่าซ้ำกันนับครั้งเดียว (คีย์เดียวกันใส่สองช่องไม่ได้ช่วยอะไร)
 * - ช่องเดียววางหลายคีย์ (คั่นด้วยขึ้นบรรทัด/ช่องว่าง/จุลภาค) = แยกเป็นหลายคีย์
 * - ค่าที่มีตัวอักษรซึ่ง header ไม่รับ = ข้าม (ไม่ส่งเข้า SDK)
 */
export function readAnthropicKeys(env = process.env) {
  const out = [];
  for (const envName of KEY_ENV_NAMES) {
    for (const key of tokensOf(env?.[envName])) {
      if (!USABLE_KEY.test(key) || out.some((k) => k.key === key)) continue;
      out.push({ envName, key, label: `คีย์ ${out.length + 1}` });
    }
  }
  return out;
}

/** ชื่อตัวแปรที่มีค่าซึ่งถูกข้ามเพราะมีตัวอักษรที่ใช้เป็นคีย์ไม่ได้ — บอกแค่ชื่อตัวแปร (ให้เจ้าของรู้ว่าต้องวางคีย์ใหม่ ไม่ใช่เงียบหาย) */
export function skippedAnthropicEnvNames(env = process.env) {
  return KEY_ENV_NAMES.filter((envName) => tokensOf(env?.[envName]).some((key) => !USABLE_KEY.test(key)));
}

/**
 * ข้อผิดพลาดนี้ "เป็นปัญหาของคีย์" ไหม — ใช่ = คืนชนิด (ต้องสลับคีย์) · ไม่ใช่ = null (ห้ามสลับ)
 * ดูทั้ง .type ของ SDK และรหัส HTTP (บางรุ่น/บางทางผ่านให้มาอย่างเดียว)
 */
export function classifyKeyFailure(e) {
  const status = Number(e?.status);
  const type = String(e?.type || e?.error?.error?.type || e?.error?.type || '');
  if (type === 'billing_error' || status === 402) return 'billing';
  if (type === 'authentication_error' || status === 401) return 'auth';
  if (type === 'permission_error' || status === 403) return 'permission';
  if (type === 'rate_limit_error' || status === 429) return 'rate';
  if (type === 'not_found_error' || status === 404) return 'model';
  // เครดิตหมด/ถึงเพดานใช้จ่ายรายเดือน ถูกรายงานเป็นคำขอผิด (400) พร้อมข้อความ — ถือเป็นเรื่องเครดิตของคีย์นั้น
  if (status === 400 && /credit balance|billing|usage limits?|regain access/i.test(String(e?.message || ''))) return 'billing';
  return null;
}

/** ลบค่าคีย์ออกจากข้อความก่อนส่งต่อ (ข้อความ error ของ SDK/เครือข่ายอาจมีค่า header ติดมา) */
export function redactKeys(text, keyValues = []) {
  let out = String(text ?? '');
  for (const k of keyValues) if (k && String(k).length >= 8) out = out.split(String(k)).join('[คีย์ถูกซ่อน]');
  return out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[คีย์ถูกซ่อน]');
}

function fail(errorType, message, status) {
  const err = new Error(message);
  err.errorType = errorType;
  if (status) err.status = status;
  return err;
}

/**
 * ชุดคีย์ 1 ชุด
 * @param {object} p
 * @param {Array<{envName:string,key:string,label:string}>} p.keys  จาก readAnthropicKeys
 * @param {(key:string) => object} p.makeClient  สร้าง client ของ SDK จากคีย์ (ถูกเรียกครั้งเดียวต่อคีย์ ตอนใช้ครั้งแรก)
 * @param {() => number} [p.now]
 */
export function createKeyPool({ keys, makeClient, now = Date.now, skipped = [] }) {
  // benchedUntil/benchKind = "พักถึงเมื่อไร" (จับเวลา) · downKind = "คีย์นี้ใช้ไม่ได้ด้วยเหตุของคีย์เอง และยังไม่เคยกลับมาสำเร็จ" (ไม่ขึ้นกับเวลา — ใช้เตือนเจ้าของ)
  const slots = (keys || []).map((k) => ({ ...k, client: null, benchedUntil: 0, benchKind: '', downKind: '', benchSeq: 0, uses: 0, failures: 0, lastUsedAt: 0, lastFailAt: 0 }));
  const clientOf = (s) => (s.client ||= makeClient(s.key));
  const isBenched = (s, t) => s.benchedUntil > t;

  /**
   * ลำดับที่จะลองในคำขอหนึ่ง: คีย์ที่ไม่ถูกพักก่อน (ตามลำดับเลข) แล้วตามด้วยคีย์ที่ถูกพัก (ตัวที่ใกล้ครบเวลาพักก่อน)
   * คีย์ที่ถูกพักจึงถูกแตะก็ต่อเมื่อคีย์ที่ใช้ได้ล้มหมดในคำขอนี้แล้วเท่านั้น — และเติมเงินแล้วกลับมาใช้ได้ทันทีโดยไม่ต้องรอครบเวลาพัก
   */
  function order() {
    const t = now();
    const free = slots.filter((s) => !isBenched(s, t));
    const benched = slots.filter((s) => isBenched(s, t)).sort((a, b) => a.benchedUntil - b.benchedUntil);
    // คีย์ที่เคยล้มด้วยเหตุของคีย์เองและครบเวลาพักแล้ว ถูกลองก่อน 1 ครั้งต่อรอบพัก (ล้ม = ตอบทันทีแล้วพักต่อ · สำเร็จ = คำเตือนถึงเจ้าของหาย)
    // ถ้าไม่ลอง คีย์สำรองที่เจ้าของเติมเงินแล้วจะไม่ถูกเรียกอีกเลยตราบที่คีย์ก่อนหน้ายังดี และคำเตือนจะค้างตลอด
    return [...free.filter((s) => s.downKind), ...free.filter((s) => !s.downKind), ...benched];
  }

  function bench(s, kind) {
    s.benchKind = kind;
    s.benchedUntil = now() + KEY_BENCH_MS[kind];
    if (kind !== 'rate') s.downKind = kind;
    s.benchSeq++;
  }

  /**
   * เรียก fn(client) ด้วยคีย์ที่ใช้ได้ตัวแรก · คีย์มีปัญหา = พักคีย์นั้นแล้วลองคีย์ถัดไปในคำขอเดียวกัน
   * ข้อผิดพลาดที่ไม่ใช่เรื่องคีย์ถูกโยนต่อทันทีตามเดิม (ไม่ลองคีย์อื่น)
   */
  async function run(fn) {
    if (slots.length === 0) {
      throw fail('ANTHROPIC_KEY_MISSING', skipped.length
        ? `ค่าใน ${skipped.join(', ')} มีตัวอักษรที่ใช้เป็นคีย์ไม่ได้ ให้วางคีย์ใหม่`
        : 'ระบบยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY');
    }
    const tried = [];
    for (const s of order()) {
      s.uses++;
      s.lastUsedAt = now();
      const seq = s.benchSeq;
      try {
        const out = await fn(clientOf(s), s.label);
        // กลับมาใช้ได้แล้ว — เว้นแต่มีคำขออื่นเพิ่งพักคีย์นี้ระหว่างที่คำขอนี้ค้างอยู่ (คำตอบที่มาช้าไม่ได้พิสูจน์ว่าคีย์ยังใช้ได้)
        if (s.benchSeq === seq) { s.benchedUntil = 0; s.benchKind = ''; s.downKind = ''; }
        // คีย์นี้ทำคำขอเดียวกันสำเร็จ = คีย์ที่ตอบ "ไม่พบโมเดล" ก่อนหน้าในคำขอนี้ ใช้โมเดลนี้ไม่ได้จริง → พักตอนนี้
        for (const x of tried) if (x.kind === 'model') bench(x.slot, 'model');
        return out;
      } catch (e) {
        const kind = classifyKeyFailure(e);
        if (!kind) throw e;
        s.failures++;
        s.lastFailAt = now();
        if (slots.length === 1) throw e; // คีย์เดียว: ไม่มีอะไรให้สลับ — ส่งข้อผิดพลาดเดิมต่อ ไม่พักคีย์
        tried.push({ slot: s, kind, err: e });
        // "ไม่พบโมเดล" ยังไม่แตะสถานะของคีย์: จะนับเป็นปัญหาของคีย์ก็ต่อเมื่อคีย์อื่นทำคำขอเดียวกันสำเร็จ (ดูด้านบน) — ไม่งั้นคือชื่อโมเดลผิด/เลิกใช้
        if (kind !== 'model') bench(s, kind);
      }
    }
    // ไม่มีคีย์ไหนสำเร็จ และมีคีย์ตอบ "ไม่พบโมเดล" → ส่งข้อผิดพลาด 404 เดิมที่มีชื่อโมเดลต่อ (คีย์ที่ล้มด้วยเหตุอื่น เช่น เครดิตหมด ถูกพักตามจริงไปแล้ว)
    const notFound = tried.filter((x) => x.kind === 'model');
    if (notFound.length) throw notFound[0].err;
    throw fail('ANTHROPIC_KEYS_EXHAUSTED', `คีย์ Anthropic ใช้ไม่ได้ทั้ง ${slots.length} คีย์ (${tried.map((x) => `${x.slot.label}: ${KEY_REASON[x.kind]}`).join(' · ')})`, tried[tried.length - 1]?.err?.status);
  }

  /** สถานะของชุดคีย์ — ไม่มีค่าคีย์ · benched = อยู่ในช่วงพัก (จับเวลา) · down = ใช้ไม่ได้ด้วยเหตุของคีย์เองและยังไม่กลับมาสำเร็จ (ไม่นับโควตาเต็มชั่วคราว) */
  function snapshot() {
    const t = now();
    return slots.map((s) => ({
      label: s.label, envName: s.envName, benched: isBenched(s, t), kind: isBenched(s, t) ? s.benchKind : '', reason: isBenched(s, t) ? KEY_REASON[s.benchKind] || '' : '',
      retryAt: isBenched(s, t) ? new Date(s.benchedUntil).toISOString() : '', down: !!s.downKind, downReason: KEY_REASON[s.downKind] || '', uses: s.uses, failures: s.failures,
      lastFailAt: s.lastFailAt ? new Date(s.lastFailAt).toISOString() : '',
    }));
  }

  /** ลบค่าคีย์ของชุดนี้ออกจากข้อความ */
  const redact = (text) => redactKeys(text, slots.map((s) => s.key));

  return { size: slots.length, run, snapshot, redact };
}

/**
 * คำเตือนถึงเจ้าของเมื่อจบงานแล้วมีคีย์ถูกพักเพราะปัญหาของคีย์เอง (ไม่นับโควตาเต็มชั่วคราว ซึ่งหายเองใน 1 นาที)
 * @param {ReturnType<ReturnType<typeof createKeyPool>['snapshot']>} snapshot
 * @returns {{code:string,message:string}|null}
 */
export function keyWarning(snapshot) {
  const all = Array.isArray(snapshot) ? snapshot : [];
  const down = all.filter((k) => k.down);
  if (!down.length) return null;
  const list = down.map((k) => `${k.label}: ${k.downReason}`).join(' · ');
  return down.length >= all.length
    ? { code: 'KEYS_ALL_BENCHED', message: `คีย์ Anthropic ใช้ไม่ได้ครบทั้ง ${all.length} คีย์แล้ว (${list}) — ด่านตรวจของงานนี้อาจไม่ได้ทำงาน และงานถัดไปจะเขียนไม่ได้ ต้องเติมเงินหรือแก้คีย์ทันที` }
    : { code: 'KEY_BENCHED', message: `คีย์ Anthropic ใช้ไม่ได้ ${down.length} จาก ${all.length} คีย์ (${list}) — ระบบสลับไปใช้คีย์ที่เหลือแล้ว ให้เติมเงินหรือแก้คีย์ก่อนคีย์ที่เหลือหมด` };
}

/**
 * สัญญาณเรื่องคีย์จากประวัติงาน (ทุกเครื่องเห็นร่วมกัน — ต่างจากสถานะพักคีย์ที่อยู่ในหน่วยความจำของแต่ละเครื่อง)
 * ดู "งานล่าสุดที่จบแล้ว" ภายใน 24 ชั่วโมง: มีคำเตือนเรื่องคีย์ หรือล้มเพราะคีย์ = แจ้งเจ้าของ · งานล่าสุดปกติ = ไม่แจ้ง
 * @returns {{level:'warn'|'bad', message:string, at:string}|null}
 */
export function keyAlertFromRuns(runs, now = Date.now()) {
  const since = now - 24 * 60 * 60 * 1000;
  const keyWords = [KEY_REASON.billing, KEY_REASON.auth, KEY_REASON.permission, 'คีย์ Anthropic ใช้ไม่ได้'];
  const warningOf = (r) => (Array.isArray(r?.warnings) ? r.warnings : []).find((x) => KEY_WARNING_CODES.includes(x?.code));
  const failedByKey = (r) => r?.status === 'failed' && keyWords.some((k) => String(r.error || '').includes(k));
  // งานที่ "บอกอะไรเรื่องคีย์ได้": งานที่เขียนสำเร็จ (มี/ไม่มีคำเตือน) · งานที่มีคำเตือนเรื่องคีย์ · งานที่ล้มเพราะคีย์
  // งานที่ล้มด้วยเหตุอื่น (หมดเวลา เนื้อดิบสั้น ฯลฯ) ไม่ได้พิสูจน์ว่าคีย์กลับมาใช้ได้ — ไม่เอามาลบคำเตือนเดิม
  let newest = null;
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!(r?.status === 'done' || warningOf(r) || failedByKey(r))) continue;
    const t = Date.parse(r.finishedAt || '');
    if (!Number.isFinite(t) || t < since) continue;
    if (!newest || t > newest.t) newest = { t, r };
  }
  if (!newest) return null;
  const { r } = newest;
  const w = warningOf(r);
  if (w) return { level: w.code === 'KEYS_ALL_BENCHED' ? 'bad' : 'warn', message: String(w.message || ''), at: r.finishedAt };
  if (failedByKey(r)) return { level: 'bad', message: `งานล่าสุดล้มเพราะคีย์ Anthropic: ${String(r.error).slice(0, 300)}`, at: r.finishedAt };
  return null;
}
