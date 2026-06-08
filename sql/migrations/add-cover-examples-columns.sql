-- Migration: Add missing columns to cover_examples
-- Run in Supabase SQL Editor
-- Date: 2026-06-08
--
-- These columns were previously stored only inside the JSONB `analysis` field.
-- After running this migration, coverLibrarySaver.js will write to both
-- real columns (for queryability) AND keep the JSONB backup for compatibility.

ALTER TABLE cover_examples
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'auto_generated',
  ADD COLUMN IF NOT EXISTS case_id TEXT,
  ADD COLUMN IF NOT EXISTS news_url TEXT,
  ADD COLUMN IF NOT EXISTS subjects TEXT[],
  ADD COLUMN IF NOT EXISTS emotion TEXT,
  ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_cover_examples_case_id ON cover_examples(case_id);
CREATE INDEX IF NOT EXISTS idx_cover_examples_source_type ON cover_examples(source_type);
CREATE INDEX IF NOT EXISTS idx_cover_examples_emotion ON cover_examples(emotion);
