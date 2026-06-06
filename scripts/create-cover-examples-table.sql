-- =============================================
-- Cover Examples Library — คลังปกไวรัลสำหรับ AI เรียนรู้
-- =============================================
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS cover_examples (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'ปกไม่มีชื่อ',
  category TEXT DEFAULT 'ทั่วไป',
  notes TEXT DEFAULT '',
  
  -- ภาพ thumbnail (base64 data URL, ~400px)
  thumbnail TEXT,
  
  -- ขนาดภาพต้นฉบับ
  image_width INTEGER DEFAULT 0,
  image_height INTEGER DEFAULT 0,
  
  -- AI Analysis (JSON) — ผลวิเคราะห์องค์ประกอบจาก Gemini Vision
  -- includes: layout_type, slots, has_circle, color_scheme, composition_rules, 
  --           what_makes_it_viral, slot_assignment_guide
  analysis JSONB DEFAULT '{}',
  
  -- Composition summary (JSON) — สรุปโครงสร้างสำหรับค้นหาเร็ว
  -- includes: layout_type, slot_count, has_circle, has_text, color_scheme
  composition JSONB DEFAULT '{}',
  
  -- Tags สำหรับค้นหา
  tags TEXT[] DEFAULT '{}',
  
  -- คะแนนคุณภาพ 1-10
  quality_score INTEGER DEFAULT 7,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับค้นหา
CREATE INDEX IF NOT EXISTS idx_cover_examples_category ON cover_examples(category);
CREATE INDEX IF NOT EXISTS idx_cover_examples_quality ON cover_examples(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_cover_examples_layout ON cover_examples((composition->>'layout_type'));

-- RLS Policy (อนุญาตทุกคนอ่าน, เฉพาะ service key เขียน)
ALTER TABLE cover_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read cover_examples"
  ON cover_examples FOR SELECT
  USING (true);

CREATE POLICY "Allow service insert cover_examples"
  ON cover_examples FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service update cover_examples"
  ON cover_examples FOR UPDATE
  USING (true);

CREATE POLICY "Allow service delete cover_examples"
  ON cover_examples FOR DELETE
  USING (true);

-- =============================================
-- ตรวจสอบ
-- =============================================
SELECT 'cover_examples table created!' AS status;
