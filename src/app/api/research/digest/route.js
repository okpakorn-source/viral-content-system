// ============================================================
// 📊 GET /api/research/digest?since=<ISO>&until=<ISO> — สรุปรีเสิร์ชรายช่วง (ตัวเลขล้วน) ให้บอท DM เจ้าของ
// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7) — ใหม่ · อ่านอย่างเดียว
// ------------------------------------------------------------
// ยืนยันตัวตนแบบบอท (checkBotKey ของ src/lib/research-agent/http.js): header x-api-key / x-bot-secret = env DISCORD_API_SECRET
//   ไม่ตั้ง env = 403 BOT_SECRET_NOT_CONFIGURED (ปิดประตู fail-closed) · ไม่ตรง = 401 UNAUTHORIZED · ปฏิเสธก่อนแตะฐานเสมอ
// อ่าน generation_logs (pipeline_info.researchAgent) + store_items research-cards (สถานะ/ธง/usage/feedback) + api_usage_logs (cost_usd)
//   → src/lib/research-agent/digest.js สรุป · bounded 8 วิ · ส่วนที่ล้ม/ไม่ทัน = ช่องนั้น null + errors (ไม่ 500 ทั้งก้อน)
//   Supabase ไม่พร้อม = ทุกช่อง null (200 · partial) — บอทยังส่งสรุปพร้อมบอกว่าข้อมูลไม่ครบ
// ไม่คืนเนื้อข่าว (มีแค่ชื่อข่าว ≤ 60 ตัวอักษรในรายการ "ข่าวที่ควรดู" ≤ 3) · ไม่มีค่าลับ · ไม่มีสวิตช์ฝั่งเว็บ (ตอบ enabled/mode ให้บอทรู้)
// ช่วงเวลา: since/until (ISO) · ไม่ส่ง until = ตอนนี้ · ไม่ส่ง since = until − 24 ชม. · ยาวสุด 8 วัน · ผิดรูป = 400 VALIDATION_ERROR
// รูปคำตอบ: { success, enabled, mode, since, until, news|null, cards|null, aiCost|null, watchlist[], partial, errors[] } (ดู digest.js)
// ============================================================
import { checkBotKey, jsonFail, jsonOk } from '@/lib/research-agent/http';
import { getResearchAgentConfig } from '@/lib/research-agent/modes';
import { collectResearchDigest, parseDigestRange } from '@/lib/research-agent/digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Supabase client หรือ null (ยังไม่เชื่อม/โหลดไม่ได้) — lazy import แบบ store.js (โหลด route เฉยๆ ไม่แตะฐาน) */
async function loadSupabaseClient() {
  try {
    const supabase = await import('@/lib/supabase');
    return supabase?.isSupabaseReady?.() ? supabase.getSupabase() : null;
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    const denied = checkBotKey(req);
    if (denied) return denied;
    const url = new URL(req.url);
    const range = parseDigestRange({ since: url.searchParams.get('since'), until: url.searchParams.get('until') }, Date.now());
    if (!range.ok) return jsonFail(400, range.error, 'VALIDATION_ERROR');
    const sb = await loadSupabaseClient();
    const digest = await collectResearchDigest({ sb, range });
    const config = getResearchAgentConfig();
    return jsonOk({ enabled: config.enabled, mode: config.mode, ...digest });
  } catch (error) {
    console.warn(`[ResearchDigest] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return jsonFail(500, 'สรุปรีเสิร์ชไม่สำเร็จ', 'RESEARCH_DIGEST_ERROR');
  }
}
