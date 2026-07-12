-- ============================================================
-- Supabase Migration 004: read_case_image_snapshot(p_case_id) RPC
-- ------------------------------------------------------------
-- ตัวอ่านคลังรูปต่อเคสแบบ "พิสูจน์ complete ได้" ใน SQL statement เดียว (single MVCC snapshot):
--   คืน jsonb { count, rows } โดย
--     • count = count(*) ของแถวที่แมตช์ทั้งหมด (ไม่ bound) — ให้ Node เทียบหา truncation
--     • rows  = jsonb_agg ของ data ที่เรียงแล้ว และ *** BOUND ≤ 2000 ก่อน/ภายใน aggregate ***
--       (bound ที่ CTE `bounded` ด้วย LIMIT 2000 → ป้อนเข้า jsonb_agg) — ไม่ส่ง jsonb ก้อนยักษ์
--       ออกมาให้ Node มา reject ทีหลัง
--   ทำในคำสั่งเดียว = อ่านทั้ง count และ rows จาก snapshot เดียวกัน กัน TOCTOU (ห้าม count-then-page)
--   Node (readImagesSnapshot) จะ revalidate: count === rows.length + ทุกแถว caseId ตรง ถึงจะ complete
--
-- ⚠️ FILE ONLY — ห้าม apply/รันไฟล์นี้อัตโนมัติ (ไว้ให้ผู้ดูแลรีวิว+รันเอง)
-- ============================================================

CREATE OR REPLACE FUNCTION read_case_image_snapshot(p_case_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH matched AS (
    SELECT si.data AS data
    FROM store_items si
    WHERE si.store_name = 'acs-images'
      AND si.data->>'caseId' = p_case_id
  ),
  -- ★ bound ≤ 2000 ก่อนป้อนเข้า aggregate (ไม่ aggregate ทั้งชุดแล้วค่อยตัด)
  bounded AS (
    SELECT data
    FROM matched
    ORDER BY COALESCE((data->>'ord')::numeric, 0), data->>'id'
    LIMIT 2000
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM matched),
    'rows',  COALESCE(
               (SELECT jsonb_agg(data ORDER BY COALESCE((data->>'ord')::numeric, 0), data->>'id')
                  FROM bounded),
               '[]'::jsonb)
  );
$$;
