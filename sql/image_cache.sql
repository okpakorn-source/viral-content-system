-- =============================================
-- Image Cache — คลังภาพสำหรับ Auto Cover
-- =============================================
-- เก็บภาพที่ผ่าน AI Judge แล้ว เพื่อนำกลับมาใช้ซ้ำ
-- สามารถค้นด้วย keywords, characters, emotion

CREATE TABLE IF NOT EXISTS image_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_title TEXT NOT NULL,
  news_hash TEXT NOT NULL,
  image_url TEXT,
  storage_path TEXT,
  source TEXT NOT NULL DEFAULT 'google',
  role TEXT DEFAULT 'SUPPORT',
  ai_score FLOAT DEFAULT 0,
  keywords TEXT[] DEFAULT '{}',
  characters TEXT[] DEFAULT '{}',
  emotion TEXT,
  location TEXT,
  scene_desc TEXT,
  width INT,
  height INT,
  file_size INT,
  is_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_image_cache_hash ON image_cache(news_hash);
CREATE INDEX IF NOT EXISTS idx_image_cache_keywords ON image_cache USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_image_cache_characters ON image_cache USING GIN(characters);
CREATE INDEX IF NOT EXISTS idx_image_cache_emotion ON image_cache(emotion);
CREATE INDEX IF NOT EXISTS idx_image_cache_source ON image_cache(source);
CREATE INDEX IF NOT EXISTS idx_image_cache_created ON image_cache(created_at DESC);

-- RLS (Row Level Security) — ให้ service role เข้าถึงได้
ALTER TABLE image_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON image_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =============================================
-- Supabase Storage Bucket (ถ้ายังไม่มี)
-- =============================================
-- ต้องสร้าง bucket 'image-cache' ใน Supabase Dashboard
-- Settings → Storage → Create bucket → Name: image-cache → Public: true
