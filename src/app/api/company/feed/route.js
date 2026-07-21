/**
 * ============================================================
 * 🏢📡 /api/company/feed — คลังกิจกรรม "สด" ของบริษัท (Supabase = แหล่งเดียว ทุกเครื่องเห็นตรงกันเรียลไทม์)
 * ============================================================
 * แก้ปัญหา: จอออฟฟิศทั้ง 3 แผนกเดิมอ่านไฟล์ .md นิ่ง (เปลี่ยนตอน deploy เท่านั้น)
 *   → บทสนทนา/มติ/ผลงาน/สถานะ ไม่อัปเดตเรียลไทม์ มือถือ+PC ไม่ตรงกัน
 * endpoint นี้ = ทุกเหตุการณ์เขียนลง Supabase store_items(store_name='company_feed')
 *   จอทุกแผนก poll GET ทุกไม่กี่วิ → เห็นสดพร้อมกันทุกเครื่อง
 *
 * GET  ?scope=main|newsdesk|engineering&limit=&kind=  → เหตุการณ์ล่าสุด (ใหม่→เก่า) + byKind + agents(สถานะล่าสุดต่อคน)
 * POST { scope, kind, agent?, text, meta? }           → เพิ่ม 1 เหตุการณ์
 *
 * kind: comm(สื่อสารข้ามคน) · chat(แชท) · decision(มติ/เคาะ) · worklog(สมุดงาน) · result(ผลรอบ/งาน) · status(สถานะ)
 * 🔴 isolated route — ไม่แตะไพป์ไลน์ข่าว/ไฟล์ AI ล็อก
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const STORE = 'company_feed';
const SCOPES = ['main', 'newsdesk', 'engineering'];
const KINDS = ['comm', 'chat', 'decision', 'worklog', 'result', 'status'];
const MAX_TEXT = 2000;
const AGENT_RE = /^[a-z0-9_]{1,24}$/;

function bad(msg, type, code) {
  return NextResponse.json({ success: false, error: msg, errorType: type || 'FEED_ERROR' }, { status: code || 400 });
}

export async function GET(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const scope = sp.get('scope') || '';
    const kind = sp.get('kind') || '';
    const limitRaw = Number(sp.get('limit'));
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 80));

    const sb = getSupabase();
    if (!sb) return NextResponse.json({ success: true, events: [], byKind: {}, agents: {}, note: 'no supabase' });

    // ดึงเผื่อ (กรอง scope/kind ฝั่ง JS เพื่อความง่าย/สอดคล้อง company_tasks) — เพดานดึง 400 กันหนัก
    const q = await sb.from('store_items')
      .select('id,data,created_at')
      .eq('store_name', STORE)
      .order('created_at', { ascending: false })
      .limit(400);
    if (q.error) return bad(q.error.message || 'อ่านคลังกิจกรรมล้มเหลว', 'FEED_READ_ERROR', 500);

    let rows = (q.data || []).map((r) => {
      const d = (r && r.data) || {};
      return {
        id: r.id,
        scope: d.scope || 'main',
        kind: d.kind || 'comm',
        agent: d.agent || '',
        text: d.text || '',
        ts: Number(d.ts) || new Date(r.created_at || 0).getTime(),
        meta: d.meta || null,
      };
    });
    if (scope && SCOPES.indexOf(scope) > -1) rows = rows.filter((e) => e.scope === scope);
    if (kind && KINDS.indexOf(kind) > -1) rows = rows.filter((e) => e.kind === kind);
    rows.sort((a, b) => b.ts - a.ts);
    const events = rows.slice(0, limit);

    // byKind + สถานะล่าสุดต่อ agent (จาก worklog/result/status/comm ล่าสุดของคนนั้น)
    const byKind = {};
    for (const k of KINDS) byKind[k] = [];
    const agents = {};
    for (const e of events) {
      if (byKind[e.kind]) byKind[e.kind].push(e);
      if (e.agent && !agents[e.agent]) agents[e.agent] = { lastText: e.text, lastTs: e.ts, kind: e.kind };
    }

    return NextResponse.json({ success: true, events, byKind, agents, count: events.length });
  } catch (error) {
    return bad(error && error.message ? error.message : 'อ่านคลังกิจกรรมล้มเหลว', 'FEED_READ_ERROR', 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = String(body && body.scope || '').trim();
    const kind = String(body && body.kind || '').trim();
    let agent = String(body && body.agent || '').trim().toLowerCase();
    const text = String(body && body.text || '').trim().slice(0, MAX_TEXT);
    const meta = body && typeof body.meta === 'object' && body.meta ? body.meta : null;

    if (SCOPES.indexOf(scope) === -1) return bad('scope ต้องเป็น main|newsdesk|engineering', 'FEED_BAD_SCOPE');
    if (KINDS.indexOf(kind) === -1) return bad('kind ไม่ถูกต้อง', 'FEED_BAD_KIND');
    if (!text) return bad('text ว่าง', 'FEED_EMPTY');
    if (agent && !AGENT_RE.test(agent)) agent = '';

    const sb = getSupabase();
    if (!sb) return bad('ไม่มี Supabase', 'FEED_NO_DB', 503);

    const now = new Date().toISOString();
    const id = 'feed_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const rec = { scope, kind, agent, text, ts: Date.now(), meta };
    const ins = await sb.from('store_items').insert({ id, store_name: STORE, data: rec, created_at: now, updated_at: now });
    if (ins.error) return bad(ins.error.message || 'บันทึกกิจกรรมล้มเหลว', 'FEED_WRITE_ERROR', 500);

    return NextResponse.json({ success: true, id, event: rec });
  } catch (error) {
    return bad(error && error.message ? error.message : 'บันทึกกิจกรรมล้มเหลว', 'FEED_WRITE_ERROR', 500);
  }
}
