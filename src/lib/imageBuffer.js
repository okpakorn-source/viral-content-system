// ============================================================
// [ระบบทำปกออโต้] โหลดรูปเป็น Buffer
// - local (/case-frames/...) อ่านจาก public
// - remote (http) โหลดผ่าน fetch (มี timeout + fallback thumbnail)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';

async function fetchBuf(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function oneUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const i = url.indexOf(',');
    if (i === -1) return null;
    try {
      return Buffer.from(url.slice(i + 1), 'base64');
    } catch {
      return null;
    }
  }
  if (url.startsWith('/')) {
    try {
      return await fs.readFile(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
    } catch {
      return null;
    }
  }
  return fetchBuf(url);
}

// คืน Buffer ของรูป (ลอง imageUrl ก่อน แล้ว fallback thumbnailUrl)
export async function loadImageBuffer(im) {
  if (!im) return null;
  return (await oneUrl(im.imageUrl)) || (await oneUrl(im.thumbnailUrl)) || null;
}
