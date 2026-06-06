-- =====================================================
-- AI Content Review Chat — Database Migration
-- Created: 2026-06-06
-- 
-- ตาราง 6 ตัวสำหรับระบบ Chat Review:
--   1. chat_users       — ผู้ใช้งาน (employee, manager, admin)
--   2. chat_rooms       — ห้องแชท (1 ห้อง / 1 employee)
--   3. chat_messages    — ข้อความในห้อง
--   4. review_rules     — กฎการตรวจสอบ AI
--   5. viral_examples   — ตัวอย่างคอนเทนต์ไวรัล
--   6. ai_feedback_log  — บันทึกผลการตรวจ AI
-- =====================================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. chat_users
-- =====================================================
CREATE TABLE IF NOT EXISTS chat_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  avatar_emoji TEXT DEFAULT '👤',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_users_username ON chat_users(username);
CREATE INDEX IF NOT EXISTS idx_chat_users_role ON chat_users(role);

-- =====================================================
-- 2. chat_rooms
-- =====================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES chat_users(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  room_slug TEXT NOT NULL UNIQUE,
  ai_instructions TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_slug ON chat_rooms(room_slug);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_employee ON chat_rooms(employee_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_status ON chat_rooms(status);

-- =====================================================
-- 3. chat_messages
-- =====================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES chat_users(id) ON DELETE SET NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('employee', 'manager', 'ai')),
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (
    message_type IN ('text', 'news_submit', 'caption_submit', 'image_submit', 'ai_review', 'system')
  ),
  attachments JSONB DEFAULT '[]'::jsonb,
  review_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_type ON chat_messages(message_type);

-- =====================================================
-- 4. review_rules
-- =====================================================
CREATE TABLE IF NOT EXISTS review_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type TEXT NOT NULL CHECK (
    rule_type IN ('banned_word', 'required_style', 'topic_guideline', 'format_rule')
  ),
  content TEXT NOT NULL,
  keywords JSONB DEFAULT '[]'::jsonb,
  action TEXT DEFAULT 'flag' CHECK (action IN ('flag', 'block', 'warn')),
  severity TEXT DEFAULT 'high' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES chat_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_rules_type ON review_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_review_rules_active ON review_rules(active);

-- =====================================================
-- 5. viral_examples
-- =====================================================
CREATE TABLE IF NOT EXISTS viral_examples (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  engagement_likes INT DEFAULT 0,
  engagement_shares INT DEFAULT 0,
  engagement_comments INT DEFAULT 0,
  tags JSONB DEFAULT '[]'::jsonb,
  writing_notes TEXT,
  uploaded_by UUID REFERENCES chat_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_viral_examples_category ON viral_examples(category);

-- =====================================================
-- 6. ai_feedback_log
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_feedback_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  ai_verdict TEXT,
  ai_feedback TEXT,
  manager_override TEXT,
  manager_note TEXT,
  learned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_room ON ai_feedback_log(room_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_message ON ai_feedback_log(message_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_learned ON ai_feedback_log(learned);

-- =====================================================
-- RLS Policies — Enable for service key access
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback_log ENABLE ROW LEVEL SECURITY;

-- Service role bypass — allows full CRUD via service key
-- (Supabase service_role key bypasses RLS by default,
--  but we add explicit policies for completeness)

-- chat_users policies
CREATE POLICY "chat_users_service_all" ON chat_users
  FOR ALL USING (true) WITH CHECK (true);

-- chat_rooms policies
CREATE POLICY "chat_rooms_service_all" ON chat_rooms
  FOR ALL USING (true) WITH CHECK (true);

-- chat_messages policies
CREATE POLICY "chat_messages_service_all" ON chat_messages
  FOR ALL USING (true) WITH CHECK (true);

-- review_rules policies
CREATE POLICY "review_rules_service_all" ON review_rules
  FOR ALL USING (true) WITH CHECK (true);

-- viral_examples policies
CREATE POLICY "viral_examples_service_all" ON viral_examples
  FOR ALL USING (true) WITH CHECK (true);

-- ai_feedback_log policies
CREATE POLICY "ai_feedback_log_service_all" ON ai_feedback_log
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- Seed: Default admin user (password: admin123)
-- Hash generated with SHA-256 + salt
-- =====================================================
-- INSERT INTO chat_users (username, password_hash, display_name, role, avatar_emoji)
-- VALUES ('admin', '<run chatAuth.hashPassword("admin123") to get hash>', 'แอดมิน', 'admin', '👑');
