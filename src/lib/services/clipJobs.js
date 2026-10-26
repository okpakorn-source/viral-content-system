import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { randomUUID } from 'crypto';
import { cleanClipUrl, extractFirstUrl } from '@/lib/services/clipAgent/clipUrl'; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ล้างลิงก์ก่อนเข้าคิว

/**
 * ลำดับคิวของใบงานที่ยังรอ — ใช้ร่วม job-status และ clip-agent/status
 *   ★ 25 ต.ค. 69 (P1): Supabase นับด้วย count — เดิม getAll ทั้งคิว (รวมผลถอดเต็ม ~4.7 MB) ทุกรอบที่งานรอคิว
 *   ★ 26 ต.ค. 69 (เฟส 4): ย้ายมาเป็นตัวกลาง เพราะ clip-agent/status ยังดึงทั้งคิวอยู่ (เอเจนต์ long-poll ทุก 2 วิ)
 *   ไฟล์ (แล็บ/เทส) อ่านทั้งคิวเหมือนเดิม · ฐานสะดุด = โยน error ติดธง transient (ผู้เรียกตอบ 503/500 เอง)
 */
export async function queuePosition(job, { store = null, excludeId = '' } = {}) {
  // excludeId = แถวชีพจรของ worker ที่อยู่ในคิวเดียวกัน (ผู้เรียกส่ง HEARTBEAT_ID มา) — ห้ามนับเป็นงาน
  if (!isSupabaseReady()) {
    const all = (await (store || createStore('clip-jobs')).getAll()).filter((j) => j && j.id !== excludeId);
    const ahead = all.filter((j) => j.status === 'pending' && new Date(j.createdAt) < new Date(job.createdAt)).length;
    const processing = all.filter((j) => j.status === 'processing').length;
    return ahead + processing + 1;
  }
  const count = (q) => q.then(({ count: n, error }) => {
    if (error) throw Object.assign(new Error(`นับคิวไม่สำเร็จชั่วคราว: ${error.message}`), { transient: true });
    return n || 0;
  });
  const base = () => {
    const q = getSupabase().from('store_items').select('id', { count: 'exact', head: true }).eq('store_name', 'clip-jobs');
    return excludeId ? q.neq('id', excludeId) : q;
  };
  const [ahead, processing] = await Promise.all([
    count(base().filter('data->>status', 'eq', 'pending').filter('data->>createdAt', 'lt', job.createdAt)),
    count(base().filter('data->>status', 'eq', 'processing')),
  ]);
  return ahead + processing + 1;
}

const CLIP_HOSTS = [
  ['youtube', ['youtube.com', 'youtu.be']],
  ['tiktok', ['tiktok.com']],
  ['meta', ['facebook.com', 'fb.watch', 'instagram.com']],
];

function detectClipType(url, strictUrl) {
  let target = url.toLowerCase();
  if (strictUrl) {
    try { target = new URL(url).hostname.toLowerCase(); }
    catch { throw badRequest('BAD_URL', 'กรุณาวางลิงก์คลิป (http/https)'); }
  }
  for (const [platform, hosts] of CLIP_HOSTS) {
    if (hosts.some(host => strictUrl
      ? target === host || target.endsWith(`.${host}`)
      : new RegExp(host.replaceAll('.', '\\.'), 'i').test(url))) return platform;
  }
  return null;
}

function badRequest(errorType, message) {
  return Object.assign(new Error(message), { errorType, status: 400 });
}

// คิวคลิปใช้กติกาเดียวกันทั้งหน้าเว็บและเอเจนต์ — คงพฤติกรรม submit เดิม
export async function submitClipJob({ url: rawUrl, kind = 'insight', user = '', model = '', force = false }, { strictUrl = false } = {}) {
  // ★ 26 ต.ค. 69 (เฟส 4 · เจ้าของเคาะ): เหลือโหมดเดียว = ถอดคลิปเป็นเนื้อข่าวช่องเดียว — โหมดบทสัมภาษณ์/ค้นข่าวคล้ายเลิกใช้
  if (kind === 'transcript' || kind === 'hunt') {
    throw badRequest('KIND_RETIRED', 'โหมดถอดบทสัมภาษณ์/ค้นข่าวคล้ายเลิกใช้แล้ว — ส่งเป็นงานถอดคลิปปกติ (ได้พาดหัว + เนื้อข่าว)');
  }
  const MODEL_ALLOWED = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'];
  const jobModel = MODEL_ALLOWED.includes(String(model)) ? String(model) : '';
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ล้างลิงก์ก่อนตรวจ — วางซ้อน 2 รอบ/มีข้อความปน → เหลือลิงก์แรกลิงก์เดียว + ตัด tracking
  //   (ใบงาน 15:04 ลิงก์ FB ซ้อนสองรอบผ่านเข้าคิว → yt-dlp Command failed) · เก็บและกันซ้ำด้วยลิงก์ที่ล้างแล้ว
  //   ไม่ใช่ข้อความ/ไม่มีลิงก์ http(s) → '' → BAD_URL เหมือนเดิม
  const url = typeof rawUrl === 'string' ? cleanClipUrl(extractFirstUrl(rawUrl)) : '';
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw badRequest('BAD_URL', 'กรุณาวางลิงก์คลิป (http/https)');
  }
  // เอเจนต์ตรวจ hostname จริง; หน้าเว็บเดิมคงการตรวจแบบเดิมเพื่อไม่เปลี่ยนสัญญา
  const platform = detectClipType(url, strictUrl);
  if (!platform) {
    throw badRequest('UNSUPPORTED_PLATFORM', 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)');
  }
  const store = createStore('clip-jobs');
  const all = await store.getAll();
  // กันซ้ำทุกงาน active โดยเทียบชนิดและโมเดลด้วย แม้ส่ง force ก็คืนงานที่กำลังทำ
  const normKind = 'insight';
  const isActive = (j) => j.status === 'pending' || j.status === 'processing' || j.status === 'retry_wait';
  const recent = all.find(j => j.url === url && isActive(j)
    && (j.kind || 'insight') === normKind
    && String(j.model || '') === jobModel);
  if (recent) {
    const position = recent.status === 'pending'
      ? all.filter(j => j.status === 'processing' || (j.status === 'pending' && new Date(j.createdAt) < new Date(recent.createdAt))).length + 1
      : 0;
    return {
      jobId: recent.id, status: recent.status, position, platform: recent.platform || platform,
      dup: true, message: 'คลิปนี้อยู่ในคิวแล้ว (กำลังทำ/รอลองใหม่)',
    };
  }
  const jobId = randomUUID();
  await store.add({
    id: jobId, url, platform, kind: normKind,
    user: String(user || 'ไม่ระบุชื่อ').slice(0, 40),
    ...(jobModel ? { model: jobModel } : {}),
    ...(force ? { force: true } : {}),
    status: 'pending', createdAt: new Date().toISOString(),
  });
  // เก็บกวาดเฉพาะงานจบแล้ว โดยคงเกณฑ์ > 50 ของเส้นทางเดิม
  if (all.length > 50) {
    const old = all.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 50);
    for (const o of old) await store.remove(o.id).catch(() => {});
  }
  const pending = all.filter(j => j.status === 'pending' || j.status === 'processing').length;
  return { jobId, status: 'pending', position: pending + 1, platform, dup: false };
}
