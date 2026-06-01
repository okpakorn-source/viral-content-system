-- Viral Radar: History table for freshness check
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS radar_history (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'hot',
  titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast category lookup
CREATE INDEX IF NOT EXISTS idx_radar_history_category 
  ON radar_history(category, created_at DESC);

-- Auto-cleanup: keep only last 50 records per category
-- (optional: run as a cron job)
-- DELETE FROM radar_history 
-- WHERE id NOT IN (
--   SELECT id FROM radar_history 
--   ORDER BY created_at DESC LIMIT 400
-- );
