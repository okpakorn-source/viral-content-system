/**
 * companyFeed.js — helper กลางเขียน "คลังกิจกรรมสด" ของบริษัท ลง Supabase store_items(company_feed)
 * ให้ route ฝั่ง server (chat, newsdesk-run ฯลฯ) เรียกตรง ไม่ต้อง HTTP self-call
 * 🔴 fire-and-forget: ถ้าเขียนไม่สำเร็จต้องไม่ทำ flow หลักพัง (คืน false เงียบ ๆ)
 */
import { getSupabase } from '@/lib/supabase';

export const FEED_STORE = 'company_feed';
const SCOPES = ['main', 'newsdesk', 'engineering'];
const KINDS = ['comm', 'chat', 'decision', 'worklog', 'result', 'status'];
const AGENT_RE = /^[a-z0-9_]{1,24}$/;

export async function writeFeed({ scope, kind, agent, text, meta } = {}) {
  try {
    scope = String(scope || '').trim();
    kind = String(kind || '').trim();
    agent = String(agent || '').trim().toLowerCase();
    text = String(text || '').trim().slice(0, 2000);
    if (SCOPES.indexOf(scope) === -1 || KINDS.indexOf(kind) === -1 || !text) return false;
    if (agent && !AGENT_RE.test(agent)) agent = '';

    const sb = getSupabase();
    if (!sb) return false;

    const now = new Date().toISOString();
    const id = 'feed_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const rec = { scope, kind, agent, text, ts: Date.now(), meta: (meta && typeof meta === 'object') ? meta : null };
    const ins = await sb.from('store_items').insert({ id, store_name: FEED_STORE, data: rec, created_at: now, updated_at: now });
    return !ins.error;
  } catch (_e) {
    return false;
  }
}

/** เขียนหลายเหตุการณ์พร้อมกัน (best-effort) */
export async function writeFeedMany(events) {
  if (!Array.isArray(events) || !events.length) return 0;
  const results = await Promise.all(events.map((e) => writeFeed(e).catch(() => false)));
  return results.filter(Boolean).length;
}
