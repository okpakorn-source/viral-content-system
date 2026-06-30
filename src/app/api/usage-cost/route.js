/**
 * API Usage Cost — สรุปต้นทุน API แบบเรียลไทม์ (1 มิ.ย. ฐาน → ปรับช่วงได้)
 * 🔴 อ่านอย่างเดียวจากตาราง api_usage_logs (Supabase) — ไม่แตะระบบทำข่าว/ปก/คลิป
 *
 * GET /api/usage-cost?days=1|7|30  (&rate=36.5)
 *   → totals(usd/thb/tokens) + byProvider + byModel + byFeature + byDay
 *
 * หมายเหตุ: นับเฉพาะ LLM ที่ logApiUsage บันทึก (OpenAI/Anthropic/Gemini)
 *   ยังไม่รวม Serper/Firecrawl/Replicate/ภาพปก/วิดีโอ-3rd-party (ต้อง instrument เพิ่ม — Phase 2)
 */
import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USD_TO_THB_DEFAULT = 36.5; // ★ ปรับอัตราแลกเปลี่ยนเริ่มต้นที่นี่ (หรือส่ง ?rate=)
const CACHE_TTL_MS = 60_000;      // กัน egress พุ่ง: cache ผลรวม 60 วิ (โพลถี่แค่ไหนก็ query จริง ≤1 ครั้ง/นาที)
const _cache = new Map();          // key = days → { at, payload }

const num = (v) => Number(v) || 0;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '30', 10)));
    const rate = parseFloat(searchParams.get('rate')) || USD_TO_THB_DEFAULT;

    if (!isSupabaseReady()) {
      return NextResponse.json({ success: false, error: 'Supabase ไม่พร้อม', errorType: 'NO_DB' }, { status: 503 });
    }

    // ── cache (เฉพาะตัวเลขดิบ ไม่รวม rate — rate คูณภายหลัง) ──
    const cached = _cache.get(days);
    let raw;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      raw = cached.raw;
    } else {
      const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
      const sb = getSupabase();
      let rows = [];
      for (let from = 0; from < 300000; from += 1000) {
        const p = await sb.from('api_usage_logs')
          .select('provider,model,cost_usd,input_tokens,output_tokens,feature,created_at')
          .gte('created_at', sinceISO)
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (p.error) {
          return NextResponse.json({ success: false, error: p.error.message, errorType: 'QUERY_ERROR' }, { status: 500 });
        }
        if (!p.data || p.data.length === 0) break;
        rows.push(...p.data);
        if (p.data.length < 1000) break;
      }

      const groupBy = (key) => {
        const m = {};
        for (const r of rows) {
          const k = r[key] || '?';
          if (!m[k]) m[k] = { calls: 0, usd: 0, inTok: 0, outTok: 0 };
          m[k].calls++; m[k].usd += num(r.cost_usd); m[k].inTok += num(r.input_tokens); m[k].outTok += num(r.output_tokens);
        }
        return Object.entries(m).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.usd - a.usd);
      };
      const dayMap = {};
      for (const r of rows) {
        const d = (r.created_at || '').slice(0, 10);
        if (!d) continue;
        if (!dayMap[d]) dayMap[d] = { usd: 0, calls: 0 };
        dayMap[d].usd += num(r.cost_usd); dayMap[d].calls++;
      }
      raw = {
        calls: rows.length,
        usd: rows.reduce((s, r) => s + num(r.cost_usd), 0),
        inputTokens: rows.reduce((s, r) => s + num(r.input_tokens), 0),
        outputTokens: rows.reduce((s, r) => s + num(r.output_tokens), 0),
        byProvider: groupBy('provider'),
        byModel: groupBy('model'),
        byFeature: groupBy('feature'),
        byDay: Object.entries(dayMap).map(([d, v]) => ({ day: d, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
      };
      _cache.set(days, { at: Date.now(), raw });
    }

    const withThb = (arr) => arr.map((x) => ({ ...x, thb: x.usd * rate }));
    return NextResponse.json({
      success: true,
      rangeDays: days,
      rate,
      totals: {
        calls: raw.calls,
        usd: raw.usd,
        thb: raw.usd * rate,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        totalTokens: raw.inputTokens + raw.outputTokens,
      },
      byProvider: withThb(raw.byProvider),
      byModel: withThb(raw.byModel),
      byFeature: withThb(raw.byFeature),
      byDay: raw.byDay.map((d) => ({ ...d, thb: d.usd * rate })),
      note: 'นับเฉพาะ LLM (OpenAI/Anthropic/Gemini) จาก api_usage_logs · ยังไม่รวม Serper/Firecrawl/Replicate/ภาพปก/วิดีโอ-3rd-party',
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, errorType: 'COST_ERROR' }, { status: 500 });
  }
}
