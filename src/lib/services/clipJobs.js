import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

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
export async function submitClipJob({ url, kind = 'insight', tidy = false, user = '', model = '', force = false }, { strictUrl = false } = {}) {
  const MODEL_ALLOWED = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash'];
  const jobModel = MODEL_ALLOWED.includes(String(model)) ? String(model) : '';
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
  const normKind = kind === 'transcript' ? 'transcript' : kind === 'hunt' ? 'hunt' : 'insight';
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
    id: jobId, url, platform, kind: normKind, tidy: !!tidy,
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
