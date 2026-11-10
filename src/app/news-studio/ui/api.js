// ตัวช่วยเรียก API ของสตูดิโอเขียนข่าว (ฝั่งหน้าเว็บ) — ไม่มี state ไม่มี React

/** อ่านคำตอบเป็น JSON เสมอ: หน้า error ที่เป็น HTML (เช่น timeout ของโฮสต์) ถูกแปลงเป็น {success:false, error} แทนการพังตอน parse */
export async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: `เซิร์ฟเวอร์ตอบกลับผิดรูป (HTTP ${res.status})`, errorType: 'BAD_RESPONSE' };
  }
}

export async function getJson(url, { signal } = {}) {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    return await readJson(res);
  } catch (e) {
    if (e?.name === 'AbortError') return { success: false, aborted: true, error: 'ยกเลิกแล้ว' };
    return { success: false, error: `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${String(e?.message || e).slice(0, 120)}`, errorType: 'NETWORK' };
  }
}

export async function sendJson(url, method, body) {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await readJson(res);
  } catch (e) {
    return { success: false, error: `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${String(e?.message || e).slice(0, 120)}`, errorType: 'NETWORK' };
  }
}

/**
 * สั่งเขียน 1 งานและรับเหตุการณ์ทีละบรรทัด (NDJSON)
 * @returns {Promise<{ended:'result'|'error'|'broken', runId:string|null}>}
 *   broken = สายหลุดก่อนได้ผล (ผู้เรียกควรไปตามผลจากคลังประวัติด้วย runId)
 */
export async function streamRun(body, onEvent) {
  let runId = null;
  let ended = 'broken';
  let res;
  try {
    res = await fetch('/api/news-studio/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    onEvent({ type: 'error', error: `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${String(e?.message || e).slice(0, 120)}`, errorType: 'NETWORK' });
    return { ended: 'error', runId };
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('ndjson') || !res.body) {
    // อ่านตัวคำตอบไม่ได้ (สายหลุดระหว่างอ่าน) ก็ต้องจบเป็น error ที่หน้าจอเห็น — ไม่ปล่อยให้ค้าง "กำลังเขียน"
    let data = {};
    try { data = await readJson(res); } catch { /* ใช้ข้อความสำรองด้านล่าง */ }
    onEvent({ type: 'error', error: data.error || `สั่งเขียนไม่สำเร็จ (HTTP ${res.status})`, errorType: data.errorType || 'RUN_REJECTED' });
    return { ended: 'error', runId };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line) => {
    const s = line.trim();
    if (!s) return;
    let e;
    try { e = JSON.parse(s); } catch { return; }
    if (e.type === 'start') runId = e.runId;
    if (e.type === 'result') ended = 'result';
    if (e.type === 'error') { ended = 'error'; if (e.runId) runId = e.runId; }
    if (e.type !== 'open' && e.type !== 'heartbeat') onEvent(e);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(handle);
    }
    buffer += decoder.decode();
    handle(buffer);
  } catch {
    // สายหลุดกลางทาง — ended ยังเป็น 'broken' ถ้ายังไม่ได้ผล
  }
  return { ended, runId };
}

export const TECHNIQUE_LABEL = {
  own_words_quote: 'ชูคำพูดของเจ้าตัว',
  contrast_expectation: 'ขัดกับที่คนคาด',
  act_of_giving: 'การให้ที่จับต้องได้',
  concrete_detail: 'รายละเอียดเล็กที่เห็นภาพ',
  number_lead: 'นำด้วยตัวเลข',
  loss_and_what_remains: 'การจากไปและสิ่งที่เหลือ',
  little_known_fact: 'เรื่องที่คนไม่ค่อยรู้',
  other: 'อื่นๆ',
};

export const OPENING_LABEL = {
  quote: 'เปิดด้วยคำพูด',
  tribute: 'เปิดด้วยการไว้อาลัย',
  admire: 'เปิดด้วยคำชื่นชม',
  contrast: 'เปิดด้วยสิ่งที่ขัดความคาดหมาย',
  number: 'เปิดด้วยตัวเลข',
  plain: 'เปิดเล่าตรงๆ',
};

export const ROLE_LABEL = {
  director: 'ผู้กำหนดทิศทางข่าว',
  analyzer: 'ตัววิเคราะห์หมวดข่าว',
  librarian: 'บรรณารักษ์เลือกครู',
  writer: 'นักเขียน',
  checker: 'ผู้ตรวจข้อเท็จจริง',
  reader: 'ผู้อ่านจับใจความ',
};

export const FAIL_LABEL = {
  EMPTY: 'ไม่มีเนื้อ', PARAGRAPHS: 'จำนวนย่อหน้า', TOO_SHORT: 'สั้นเกิน', TOO_LONG: 'ยาวเกิน', DASH: 'มีขีดยาว', EMOJI: 'มีอีโมจิ', HASHTAG: 'มีแฮชแท็ก',
  LIST: 'มีรายการ', QUESTION_END: 'จบด้วยคำถาม', DANGLING: 'ประโยคค้าง', COPIED_TEACHER: 'ยกจากครู', RAW_COPY: 'ยกจากเนื้อดิบ', ANGLE_DROPPED: 'ประเด็นหาย',
  FORMAT_LEAK: 'รูปแบบหลุด', OPENING_TOO_LONG: 'ย่อหน้าแรกยาว', CLOSING_TOO_LONG: 'ย่อหน้าท้ายยาว', OPENING_MISSES_POINT: 'ย่อหน้าแรกไม่ถึงประเด็น',
};

export function formatViews(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} ล้านวิว`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} พันวิว`;
  return v ? `${v} วิว` : '';
}

export function formatWhen(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  } catch {
    return new Date(t).toLocaleString();
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
