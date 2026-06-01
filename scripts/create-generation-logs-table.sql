-- =============================================
-- Generation Logs Table for Supabase
-- สร้าง table สำหรับเก็บ log ทุกเคสที่ generate
-- =============================================

CREATE TABLE IF NOT EXISTS generation_logs (
  id BIGSERIAL PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  news_title TEXT DEFAULT '',
  source_type TEXT DEFAULT 'web',
  source_url TEXT DEFAULT '',
  source_text TEXT DEFAULT '',
  source_text_length INTEGER DEFAULT 0,
  version_count INTEGER DEFAULT 0,
  versions JSONB DEFAULT '[]'::jsonb,
  breakdown JSONB DEFAULT '{}'::jsonb,
  pipeline_info JSONB DEFAULT '{}'::jsonb,
  user_id TEXT DEFAULT 'anonymous',
  status TEXT DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'good', 'bad')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับ query ที่ใช้บ่อย
CREATE INDEX IF NOT EXISTS idx_generation_logs_case_id ON generation_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_generation_logs_status ON generation_logs(status);
CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at ON generation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_logs_source_type ON generation_logs(source_type);

-- Enable Row Level Security (optional — ใช้ service key จึงไม่จำเป็น)
-- ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;
