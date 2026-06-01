-- ============================================
-- Supabase Migration: cover_images table
-- ============================================
-- คลังรูปสำหรับระบบสร้างปกข่าว
-- เก็บทุกรูปที่ Agent ค้นมาได้ พร้อม metadata

CREATE TABLE IF NOT EXISTS cover_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  news_title TEXT,
  source_agent TEXT DEFAULT 'unknown',  -- google, youtube, tiktok, web
  source_url TEXT,
  image_url TEXT NOT NULL,
  thumbnail_base64 TEXT,                -- ย่อเก็บ 200x200 สำหรับ UI
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  ai_score INTEGER DEFAULT 0,           -- 0-10
  ai_role TEXT DEFAULT 'support',        -- hero, support, rejected
  ai_reason TEXT,
  is_selected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับค้นหาตาม session
CREATE INDEX IF NOT EXISTS idx_cover_images_session ON cover_images(session_id);
CREATE INDEX IF NOT EXISTS idx_cover_images_created ON cover_images(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE cover_images ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations via service key
CREATE POLICY "Allow all via service key" ON cover_images
  FOR ALL
  USING (true)
  WITH CHECK (true);
