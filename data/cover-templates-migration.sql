-- Cover Templates Migration Script
-- Generated: 2026-06-08
-- Purpose: Create and populate cover_templates table for Thai news FB page layout analysis

-- Create table
CREATE TABLE IF NOT EXISTS cover_templates (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  day TEXT NOT NULL,
  layout_type TEXT NOT NULL CHECK (layout_type IN ('full-bleed', 'split-vertical', 'split-horizontal', 'overlay-bottom', 'overlay-top', 'centered', 'thirds')),
  subject_position_x TEXT NOT NULL CHECK (subject_position_x IN ('left', 'center', 'right')),
  subject_position_y TEXT NOT NULL CHECK (subject_position_y IN ('top', 'center', 'bottom')),
  subject_size_ratio DECIMAL(3,2) NOT NULL,
  text_zone_position TEXT NOT NULL CHECK (text_zone_position IN ('top', 'center', 'bottom', 'overlay')),
  text_zone_alignment TEXT NOT NULL CHECK (text_zone_alignment IN ('left', 'center', 'right')),
  text_zone_height_ratio DECIMAL(3,2) NOT NULL,
  fade_type TEXT NOT NULL CHECK (fade_type IN ('none', 'bottom-fade', 'top-fade', 'left-fade', 'right-fade', 'vignette', 'gradient-overlay')),
  fade_opacity DECIMAL(3,2) NOT NULL DEFAULT 0.0,
  color_primary TEXT,
  color_secondary TEXT,
  subject_visibility TEXT NOT NULL CHECK (subject_visibility IN ('full-body', 'upper-body', 'face-close', 'multiple-people', 'no-person', 'object-only')),
  has_logo_area BOOLEAN NOT NULL DEFAULT FALSE,
  has_headline BOOLEAN NOT NULL DEFAULT FALSE,
  headline_size TEXT CHECK (headline_size IN ('large', 'medium', 'small')),
  viral_score INTEGER NOT NULL CHECK (viral_score BETWEEN 1 AND 10),
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  canvas_ratio TEXT NOT NULL DEFAULT '1:1',
  analyzed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_cover_templates_day ON cover_templates(day);
CREATE INDEX IF NOT EXISTS idx_cover_templates_layout_type ON cover_templates(layout_type);
CREATE INDEX IF NOT EXISTS idx_cover_templates_viral_score ON cover_templates(viral_score DESC);
CREATE INDEX IF NOT EXISTS idx_cover_templates_subject_visibility ON cover_templates(subject_visibility);
CREATE INDEX IF NOT EXISTS idx_cover_templates_tags ON cover_templates USING GIN(tags);

-- Insert all 59 template records
INSERT INTO cover_templates (id, source_file, day, layout_type, subject_position_x, subject_position_y, subject_size_ratio, text_zone_position, text_zone_alignment, text_zone_height_ratio, fade_type, fade_opacity, color_primary, color_secondary, subject_visibility, has_logo_area, has_headline, headline_size, viral_score, tags, notes, canvas_ratio, analyzed_at) VALUES

('tpl_001', 'วันที่22พ.ค/ปก1.jpg', 'วันที่22พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'left', 0.25, 'bottom-fade', 0.75, '#1a1a2e', '#c0392b', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','emotion','text-overlay','grief'], 'Close-up face of grieving man on left, multiple inset photos (funeral, collision wreck, embracing children). Red-box text labels mid-image. Strong emotional composition.', '1:1', '2026-06-08'),

('tpl_002', 'วันที่22พ.ค/ปก2.jpg', 'วันที่22พ.ค', 'split-vertical', 'left', 'center', 0.55, 'bottom', 'center', 0.20, 'gradient-overlay', 0.60, '#2c3e50', '#e74c3c', 'upper-body', FALSE, TRUE, 'large', 7, ARRAY['person','multiple-people','text-overlay'], 'Two-person split: upper-body shots side by side with text overlay at bottom.', '1:1', '2026-06-08'),

('tpl_003', 'วันที่22พ.ค/ปก3.jpg', 'วันที่22พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'left', 0.30, 'bottom-fade', 0.80, '#000000', '#f39c12', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','emotion','text-overlay','dark-bg'], 'Dark background with large face close-up left. Bold Thai text at bottom. High contrast.', '1:1', '2026-06-08'),

('tpl_004', 'วันที่22พ.ค/ปก4.jpg', 'วันที่22พ.ค', 'thirds', 'left', 'center', 0.50, 'center', 'left', 0.25, 'right-fade', 0.50, '#2c3e50', '#27ae60', 'multiple-people', TRUE, TRUE, 'medium', 6, ARRAY['multiple-people','inset-photo','circle-inset'], 'Multi-photo collage with circle inset at bottom. Green-bordered rectangular inset top-right. Standard celebrity news layout.', '1:1', '2026-06-08'),

('tpl_005', 'วันที่22พ.ค/ปก5.jpg', 'วันที่22พ.ค', 'overlay-bottom', 'center', 'top', 0.70, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#1a1a2e', '#e74c3c', 'upper-body', FALSE, TRUE, 'large', 8, ARRAY['person','tragedy','text-overlay'], 'Strong emotional news cover with full-image subject and prominent bottom text zone.', '1:1', '2026-06-08'),

('tpl_006', 'วันที่22พ.ค/ปก6.jpg', 'วันที่22พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#000000', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset'], '4-quadrant collage with circle inset and rectangular green-border inset. Multiple story panels.', '1:1', '2026-06-08'),

('tpl_007', 'วันที่23พ.ค/ปก1.jpg', 'วันที่23พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'left', 0.28, 'bottom-fade', 0.80, '#1c1c1c', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','emotion','grief','text-overlay'], 'Large face extreme close-up dominating left half. Multiple inset panels right side. Heavy emotional content.', '1:1', '2026-06-08'),

('tpl_008', 'วันที่23พ.ค/ปก2.jpg', 'วันที่23พ.ค', 'thirds', 'left', 'center', 0.50, 'center', 'left', 0.25, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['multiple-people','celebrity','logo','circle-inset'], 'Collage with prominent TV show logo circle center. Multiple persons around. Entertainment news format.', '1:1', '2026-06-08'),

('tpl_009', 'วันที่23พ.ค/ปก3.jpg', 'วันที่23พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#1a1a2e', '#f39c12', 'upper-body', FALSE, TRUE, 'large', 7, ARRAY['person','text-overlay','strong-headline'], 'Subject upper body left, headline occupies bottom third prominently.', '1:1', '2026-06-08'),

('tpl_010', 'วันที่23พ.ค/ปก4.jpg', 'วันที่23พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset','green-border'], 'Standard 4-quadrant collage with green-border rectangular inset top-right. Red text label boxes.', '1:1', '2026-06-08'),

('tpl_011', 'วันที่23พ.ค/ปก5.jpg', 'วันที่23พ.ค', 'overlay-bottom', 'right', 'center', 0.60, 'bottom', 'left', 0.35, 'bottom-fade', 0.80, '#000000', '#f1c40f', 'upper-body', FALSE, TRUE, 'large', 8, ARRAY['person','text-overlay','drama','couple'], 'Dramatic relationship news cover, subject right side, large bold text bottom. Dark overlay.', '1:1', '2026-06-08'),

('tpl_012', 'วันที่23พ.ค/ปก6.jpg', 'วันที่23พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset'], 'Multi-panel collage, circle inset bottom-left. Multiple related story panels.', '1:1', '2026-06-08'),

('tpl_013', 'วันที่24พ.ค/ปก1.jpg', 'วันที่24พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#1a1a2e', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 9, ARRAY['person','emotion','tragedy','text-overlay'], 'Extreme close-up emotional face, high-contrast, strong grief expression. Multiple insets of related scenes. Top viral potential.', '1:1', '2026-06-08'),

('tpl_014', 'วันที่24พ.ค/ปก2.jpg', 'วันที่24พ.ค', 'thirds', 'left', 'center', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['celebrity','logo','entertainment','collage'], 'TV show logo circle prominent in center. Multiple celebrity panels. Entertainment gossip format.', '1:1', '2026-06-08'),

('tpl_015', 'วันที่24พ.ค/ปก3.jpg', 'วันที่24พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'left', 0.28, 'bottom-fade', 0.80, '#000000', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','emotion','drama','breakup'], 'Emotional face left, relationship drama content. Circle inset showing couple. Strong engagement bait.', '1:1', '2026-06-08'),

('tpl_016', 'วันที่24พ.ค/ปก4.jpg', 'วันที่24พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#333333', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','green-border'], '4-quadrant photo collage with green-border inset. Multiple persons. Standard news collage.', '1:1', '2026-06-08'),

('tpl_017', 'วันที่24พ.ค/ปก5.jpg', 'วันที่24พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#f39c12', 'upper-body', FALSE, TRUE, 'large', 8, ARRAY['person','crime','arrest','text-overlay'], 'Crime/arrest news. Dark overlay, prominent text bottom.', '1:1', '2026-06-08'),

('tpl_018', 'วันที่25พ.ค/ปก1.jpg', 'วันที่25พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'left', 0.30, 'bottom-fade', 0.80, '#1c1c1c', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','emotion','grief','text-overlay'], 'Emotional grieving person close-up left. Accident/tragedy content. Multiple evidence photos right.', '1:1', '2026-06-08'),

('tpl_019', 'วันที่25พ.ค/ปก2.jpg', 'วันที่25พ.ค', 'thirds', 'left', 'center', 0.55, 'center', 'left', 0.25, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['celebrity','entertainment','logo','collage'], 'Entertainment collage. TV logo circle center-top. Multiple celebrity panels with emotion.', '1:1', '2026-06-08'),

('tpl_020', 'วันที่25พ.ค/ปก3.jpg', 'วันที่25พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#000000', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','drama','text-overlay','emotion'], 'Dramatic close-up, strong headline bottom. Relationship drama content.', '1:1', '2026-06-08'),

('tpl_021', 'วันที่25พ.ค/ปก4.jpg', 'วันที่25พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#333333', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset','green-border'], 'Standard 4-quadrant collage with circle bottom-left and green-border inset. Standard news collage.', '1:1', '2026-06-08'),

('tpl_022', 'วันที่25พ.ค/ปก5.jpg', 'วันที่25พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#e74c3c', 'upper-body', FALSE, TRUE, 'large', 8, ARRAY['person','crime','text-overlay'], 'Crime news. Large face upper body. Heavy dark overlay with strong text.', '1:1', '2026-06-08'),

('tpl_023', 'วันที่25พ.ค/ปก6.jpg', 'วันที่25พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset'], 'Multi-panel news collage. Circle inset bottom-left. Standard format.', '1:1', '2026-06-08'),

('tpl_024', 'วันที่26พ.ค/ปก1.jpg', 'วันที่26พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.30, 'bottom-fade', 0.80, '#1c1c1c', '#c0392b', 'face-close', FALSE, TRUE, 'large', 9, ARRAY['person','emotion','tragedy','text-overlay'], 'Extreme emotional content. Face crying/grieving extreme close-up left. Strong accident/grief theme.', '1:1', '2026-06-08'),

('tpl_025', 'วันที่26พ.ค/ปก2.jpg', 'วันที่26พ.ค', 'thirds', 'left', 'center', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['celebrity','logo','entertainment','collage'], 'Entertainment show collage with TV logo. Multiple celeb panels.', '1:1', '2026-06-08'),

('tpl_026', 'วันที่26พ.ค/ปก3.jpg', 'วันที่26พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'left', 0.28, 'bottom-fade', 0.80, '#000000', '#e74c3c', 'upper-body', FALSE, TRUE, 'large', 7, ARRAY['person','drama','text-overlay'], 'Drama/conflict news. Upper body shot left, text-heavy bottom.', '1:1', '2026-06-08'),

('tpl_027', 'วันที่26พ.ค/ปก4.jpg', 'วันที่26พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset','green-border'], 'Standard collage format. 4-panel with circle and green-border insets.', '1:1', '2026-06-08'),

('tpl_028', 'วันที่26พ.ค/ปก5.jpg', 'วันที่26พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','crime','arrest','text-overlay'], 'Crime news close-up. Dark background, high contrast, strong text impact.', '1:1', '2026-06-08'),

('tpl_029', 'วันที่27พ.ค/ปก1.jpg', 'วันที่27พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'left', 0.30, 'bottom-fade', 0.80, '#1c1c1c', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 9, ARRAY['person','emotion','grief','tragedy'], 'Extremely emotional face, tears or grief visible. Multiple inset panels showing accident and funeral.', '1:1', '2026-06-08'),

('tpl_030', 'วันที่27พ.ค/ปก2.jpg', 'วันที่27พ.ค', 'thirds', 'left', 'center', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['celebrity','logo','entertainment','gossip'], 'Entertainment gossip collage. Large TV logo bubble at center-top. Multiple celebrity panels.', '1:1', '2026-06-08'),

('tpl_031', 'วันที่27พ.ค/ปก3.jpg', 'วันที่27พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#000000', '#f39c12', 'upper-body', FALSE, TRUE, 'large', 7, ARRAY['person','text-overlay','conflict'], 'Conflict/confrontation news. Upper body left, bold text bottom.', '1:1', '2026-06-08'),

('tpl_032', 'วันที่27พ.ค/ปก4.jpg', 'วันที่27พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#333333', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset','green-border'], 'Standard news collage. 4 panels, circle inset bottom-left, green-border inset mid-right.', '1:1', '2026-06-08'),

('tpl_033', 'วันที่27พ.ค/ปก5.jpg', 'วันที่27พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#e74c3c', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','crime','text-overlay','emotion'], 'High-impact crime/accident story. Close-up with dark overlay, large text.', '1:1', '2026-06-08'),

('tpl_034', 'วันที่28พ.ค/ปก1.jpg', 'วันที่28พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'left', 0.30, 'bottom-fade', 0.80, '#1c1c1c', '#c0392b', 'face-close', FALSE, TRUE, 'large', 9, ARRAY['person','grief','tragedy','text-overlay'], 'Grieving male close-up, hands clasped as if praying. Insets show funeral and accident scenes. Very high emotional impact.', '1:1', '2026-06-08'),

('tpl_035', 'วันที่28พ.ค/ปก2.jpg', 'วันที่28พ.ค', 'thirds', 'left', 'center', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#3498db', 'multiple-people', TRUE, TRUE, 'medium', 7, ARRAY['celebrity','logo','entertainment','multiple-people'], 'Entertainment TV show collage. Blue logo circle center. Multiple celebrity panels with varied expressions.', '1:1', '2026-06-08'),

('tpl_036', 'วันที่28พ.ค/ปก3.jpg', 'วันที่28พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'center', 0.30, 'bottom-fade', 0.85, '#000000', '#e74c3c', 'upper-body', FALSE, TRUE, 'large', 7, ARRAY['person','drama','text-overlay'], 'Drama news. Prominent text bottom.', '1:1', '2026-06-08'),

('tpl_037', 'วันที่28พ.ค/ปก4.jpg', 'วันที่28พ.ค', 'thirds', 'left', 'top', 0.50, 'center', 'left', 0.20, 'none', 0.00, '#ffffff', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 6, ARRAY['multiple-people','collage','circle-inset','green-border'], 'Standard 4-quadrant news collage format with green border and circle insets.', '1:1', '2026-06-08'),

('tpl_038', 'วันที่28พ.ค/ปก5.jpg', 'วันที่28พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#f39c12', 'face-close', FALSE, TRUE, 'large', 8, ARRAY['person','crime','text-overlay'], 'High-impact crime news. Face close-up with heavy text bottom.', '1:1', '2026-06-08'),

('tpl_039', 'วันที่29พ.ค/ปก1.jpg', 'วันที่29พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'center', 'left', 0.25, 'bottom-fade', 0.75, '#1c1c1c', '#c0392b', 'face-close', FALSE, TRUE, 'large', 9, ARRAY['person','grief','tragedy','text-overlay','accident'], 'Grieving man praying/weeping extreme close-up left. Insets: accident scene (b&w), funeral scene (green-bordered), embracing children (circle). White box text labels mid-image. Very high emotional impact tragedy cover.', '1:1', '2026-06-08'),

('tpl_040', 'วันที่29พ.ค/ปก2.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'bottom', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#1a2a4a', '#e74c3c', 'multiple-people', TRUE, TRUE, 'large', 7, ARRAY['celebrity','entertainment','logo','collage','multiple-people'], 'Entertainment collage. TV show logo ''โหน กระแส'' circle center. Large face lower-left dominant. Medical/hospital inset lower-right.', '1:1', '2026-06-08'),

('tpl_041', 'วันที่29พ.ค/ปก3.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'top', 0.60, 'center', 'left', 0.20, 'none', 0.00, '#1a1a1a', '#27ae60', 'multiple-people', FALSE, TRUE, 'medium', 8, ARRAY['rescue','cave','multiple-people','emergency','circle-inset','green-border'], 'Cave rescue dramatic cover. Main face left close-up. Green-bordered inset showing cave/rescue scene. Circle inset bottom-left with two faces. Bottom-right separate rescue person. Red text box labels. Dark cave environment colors.', '1:1', '2026-06-08'),

('tpl_042', 'วันที่29พ.ค/ปก4.jpg', 'วันที่29พ.ค', 'split-vertical', 'left', 'center', 0.55, 'center', 'right', 0.25, 'none', 0.00, '#b0b0b0', '#f39c12', 'multiple-people', TRUE, TRUE, 'medium', 6, ARRAY['death','mourning','multiple-people','grayscale','circle-inset'], 'Grayscale/monochrome death announcement. Large face upper-left, small grayscale faces right column. TV channel 3 logo small. Orange monk circle inset bottom-left. White name labels on photos.', '1:1', '2026-06-08'),

('tpl_043', 'วันที่29พ.ค/ปก5.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'top', 0.60, 'center', 'left', 0.15, 'none', 0.00, '#1a1a2e', '#27ae60', 'multiple-people', FALSE, FALSE, 'small', 7, ARRAY['rescue','cave','hero','emergency','circle-inset','green-border'], 'Rescue hero story. Smiling face in cave environment upper-left dominant. Circle inset shows fireman smiling. Green-bordered inset shows cave passage scene. Lower-right shows man lying unconscious after rescue. Survival/hero narrative.', '1:1', '2026-06-08'),

('tpl_044', 'วันที่29พ.ค/ปก6.jpg', 'วันที่29พ.ค', 'overlay-bottom', 'left', 'top', 0.65, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#000000', '#f1c40f', 'multiple-people', FALSE, TRUE, 'large', 9, ARRAY['accident','death','tragedy','text-overlay','medical-student'], 'Doctor/medical student accident tragedy. Split color/BW montage. Large yellow text bottom. Extremely high viral potential - young promising life lost.', '1:1', '2026-06-08'),

('tpl_045', 'วันที่29พ.ค/ปก7.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#1a1a2e', '#c0392b', 'multiple-people', FALSE, TRUE, 'medium', 7, ARRAY['money','crime','fraud','female','gold','circle-inset','green-border'], 'Financial fraud/crime story. Attractive woman large face upper-left. Cash piles top-right. Green-bordered CCTV gold shop inset. Circle inset shows cash stacks. Another woman bottom-right with gold bar.', '1:1', '2026-06-08'),

('tpl_046', 'วันที่29พ.ค/ปก8.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#1a1a2e', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 7, ARRAY['celebrity','relationship','breakup','multiple-people','circle-inset','green-border'], 'Celebrity divorce/breakup news. Close-up face upper-left. Wedding photo top-right. Green-bordered inset shows family with kids. Circle inset shows romantic moment. Lower-right shows crying face.', '1:1', '2026-06-08'),

('tpl_047', 'วันที่29พ.ค/ปก9.jpg', 'วันที่29พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#1a1a2e', '#27ae60', 'multiple-people', FALSE, TRUE, 'medium', 8, ARRAY['rescue','cave','emergency','oxygen','multiple-people','circle-inset','green-border'], 'Cave rescue update. Person with oxygen mask top-left. Green-bordered inset of medical procedure. Circle inset shows man with oxygen mask zoomed. Bottom-right rescuer in cave with headlamp. Text labels show rescue limitations and rest period.', '1:1', '2026-06-08'),

('tpl_048', 'วันที่30พ.ค/ปก1.jpg', 'วันที่30พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.15, 'none', 0.00, '#2c3e50', '#27ae60', 'face-close', TRUE, FALSE, 'small', 6, ARRAY['celebrity','actor','rehabilitation','monk','circle-inset','green-border'], 'Thai celebrity entering retreat/rehabilitation. Handsome male face upper-left dominant. House/building top-right. Green-bordered inset with sign. Circle inset shows meditation group. Lower-right: walking in nature. Calm positive tone.', '1:1', '2026-06-08'),

('tpl_049', 'วันที่30พ.ค/ปก2.jpg', 'วันที่30พ.ค', 'thirds', 'left', 'top', 0.60, 'center', 'left', 0.20, 'none', 0.00, '#f5a623', '#ffffff', 'face-close', FALSE, TRUE, 'medium', 7, ARRAY['celebrity','hospital','illness','cancer','circle-inset','green-border'], 'Celebrity medical/cancer story. Older man in yellow jacket face dominant upper-left. Hospital sign top-right. Green-bordered family graduation photo inset. Circle inset: MRI machine. Lower-right: hospital room bed. Red text labels bottom.', '1:1', '2026-06-08'),

('tpl_050', 'วันที่30พ.ค/ปก3.jpg', 'วันที่30พ.ค', 'split-vertical', 'left', 'top', 0.55, 'center', 'right', 0.20, 'none', 0.00, '#3d4a5c', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 7, ARRAY['farmer','scam','fraud','money','circle-inset','yellow-border'], 'Farmer scam story. Two female faces top (masked and unmasked). Yellow-bordered inset shows 500 baht note. Circle inset shows fertilizer shop. Bottom-right shows loaded truck. Rural/agriculture theme.', '1:1', '2026-06-08'),

('tpl_051', 'วันที่30พ.ค/ปก4.jpg', 'วันที่30พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.15, 'none', 0.00, '#1a1a2e', '#e74c3c', 'multiple-people', FALSE, FALSE, 'small', 7, ARRAY['celebrity','relationship','breakup','multiple-people','circle-inset'], 'Celebrity love triangle/breakup. Female face upper-left. Couple together top-right. Couple sitting together mid-right. Circle inset shows romantic couple. No prominent headline but strong visual story.', '1:1', '2026-06-08'),

('tpl_052', 'วันที่30พ.ค/ปก5.jpg', 'วันที่30พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'right', 0.15, 'none', 0.00, '#2c3e50', '#8e44ad', 'multiple-people', FALSE, TRUE, 'small', 6, ARRAY['celebrity','cat','animals','relationship','circle-inset'], 'Celebrity couple and cats lifestyle. Two couple portraits top. Circle inset shows formal couple portrait. Bottom-right shows person with multiple cats. Warm lifestyle content.', '1:1', '2026-06-08'),

('tpl_053', 'วันที่30พ.ค/ปก6.jpg', 'วันที่30พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#2c3e50', '#e74c3c', 'multiple-people', FALSE, TRUE, 'medium', 7, ARRAY['crime','drugs','celebrity','arrest','circle-inset','green-border'], 'Drug arrest/crime story. Young man with glasses face close-up left. Messy room police search top-right. Green-bordered drug paraphernalia inset. Circle inset shows man with baby. Bottom-right shows smiling suspect.', '1:1', '2026-06-08'),

('tpl_054', 'วันที่31พ.ค/ปก1.jpg', 'วันที่31พ.ค', 'thirds', 'left', 'top', 0.60, 'center', 'left', 0.20, 'none', 0.00, '#3d4a5c', '#c0392b', 'multiple-people', FALSE, TRUE, 'medium', 8, ARRAY['rescue','cave','hero','illness','circle-inset','green-border','red-circle-highlight'], 'Cave rescue hero now sick story. Rugged face upper-left. Group in cave with red circle highlight top-right. Hospital bed inset (green-bordered). Circle inset: statue/memorial. Bottom-right: person drinking through straw in hospital. Hero to patient narrative.', '1:1', '2026-06-08'),

('tpl_055', 'วันที่31พ.ค/ปก2.jpg', 'วันที่31พ.ค', 'thirds', 'left', 'bottom', 0.55, 'center', 'left', 0.15, 'none', 0.00, '#2c3e50', '#adff2f', 'face-close', TRUE, FALSE, 'small', 7, ARRAY['celebrity','entertainment','workpoint','logo','circle-inset','green-border'], 'Workpoint Entertainment celebrity news. Bald/shaved head man large face lower-left. B&W historical photos top-left. WorkPoint building sign top-right. Green-bordered Workpoint logo circle center. Bottom-right: two in camouflage suits. Company drama narrative.', '1:1', '2026-06-08'),

('tpl_056', 'วันที่31พ.ค/ปก3.jpg', 'วันที่31พ.ค', 'thirds', 'left', 'top', 0.60, 'center', 'left', 0.15, 'none', 0.00, '#1a1a2e', '#27ae60', 'multiple-people', FALSE, FALSE, 'small', 8, ARRAY['rescue','cave','emergency','multiple-people','circle-inset','green-border'], 'Latest cave rescue update. Young face upper-left. Top-right: rescue team giving first aid. Green-bordered inset: unconscious person with oxygen mask. Circle inset: two rescuers hugging. Bottom-right: Laos rescuer in tight cave space. Dramatic survival narrative.', '1:1', '2026-06-08'),

('tpl_057', 'วันที่31พ.ค/ปก4.jpg', 'วันที่31พ.ค', 'overlay-bottom', 'left', 'center', 0.55, 'bottom', 'center', 0.35, 'bottom-fade', 0.90, '#1a1a2e', '#f1c40f', 'multiple-people', FALSE, TRUE, 'large', 9, ARRAY['celebrity','generosity','education','heartwarming','text-overlay'], 'Heartwarming generosity story. Handwritten letter top-left. University building top-right. Celebrity casual wear middle-left. Tattooed celebrity middle-right pensive. Large yellow and white bold text bottom three lines. High shareability - generosity + education theme.', '1:1', '2026-06-08'),

('tpl_058', 'วันที่31พ.ค/ปก5.jpg', 'วันที่31พ.ค', 'thirds', 'left', 'top', 0.55, 'center', 'left', 0.20, 'none', 0.00, '#c0392b', '#ffffff', 'face-close', FALSE, TRUE, 'medium', 7, ARRAY['celebrity','temple','religion','lifestyle','circle-inset','green-border'], 'Celebrity at temple/religious event. Female face upper-left with sunglasses. Red temple signboard top-right. Green-bordered inset with another temple sign. Circle inset shows couple embracing. Bottom-right person in Thai traditional dress praying.', '1:1', '2026-06-08'),

('tpl_059', 'วันที่31พ.ค/ปก6.jpg', 'วันที่31พ.ค', 'overlay-bottom', 'left', 'top', 0.60, 'bottom', 'center', 0.20, 'bottom-fade', 0.70, '#ffffff', '#f39c12', 'multiple-people', FALSE, TRUE, 'large', 7, ARRAY['celebrity','comedy','entertainment','contract','multiple-people','inset'], 'Comedy actor contract non-renewal. Older man in white t-shirt praying gesture upper-left. Multiple celebrity group photos right column. Small rectangular b&w historical inset bottom-left. Bottom bold text. Bright/cheerful tone despite sad content.', '1:1', '2026-06-08')

ON CONFLICT (id) DO UPDATE SET
  source_file = EXCLUDED.source_file,
  day = EXCLUDED.day,
  layout_type = EXCLUDED.layout_type,
  subject_position_x = EXCLUDED.subject_position_x,
  subject_position_y = EXCLUDED.subject_position_y,
  subject_size_ratio = EXCLUDED.subject_size_ratio,
  text_zone_position = EXCLUDED.text_zone_position,
  text_zone_alignment = EXCLUDED.text_zone_alignment,
  text_zone_height_ratio = EXCLUDED.text_zone_height_ratio,
  fade_type = EXCLUDED.fade_type,
  fade_opacity = EXCLUDED.fade_opacity,
  color_primary = EXCLUDED.color_primary,
  color_secondary = EXCLUDED.color_secondary,
  subject_visibility = EXCLUDED.subject_visibility,
  has_logo_area = EXCLUDED.has_logo_area,
  has_headline = EXCLUDED.has_headline,
  headline_size = EXCLUDED.headline_size,
  viral_score = EXCLUDED.viral_score,
  tags = EXCLUDED.tags,
  notes = EXCLUDED.notes,
  canvas_ratio = EXCLUDED.canvas_ratio,
  analyzed_at = EXCLUDED.analyzed_at;

-- Useful views for the system
CREATE OR REPLACE VIEW high_viral_templates AS
SELECT * FROM cover_templates
WHERE viral_score >= 8
ORDER BY viral_score DESC, analyzed_at DESC;

CREATE OR REPLACE VIEW layout_stats AS
SELECT
  layout_type,
  COUNT(*) AS total,
  ROUND(AVG(viral_score), 2) AS avg_viral_score,
  MAX(viral_score) AS max_viral_score
FROM cover_templates
GROUP BY layout_type
ORDER BY avg_viral_score DESC;

CREATE OR REPLACE VIEW subject_visibility_stats AS
SELECT
  subject_visibility,
  COUNT(*) AS total,
  ROUND(AVG(viral_score), 2) AS avg_viral_score
FROM cover_templates
GROUP BY subject_visibility
ORDER BY avg_viral_score DESC;

-- Grant permissions (adjust role as needed)
-- GRANT SELECT ON cover_templates TO authenticated;
-- GRANT SELECT ON high_viral_templates TO authenticated;
-- GRANT SELECT ON layout_stats TO authenticated;
-- GRANT SELECT ON subject_visibility_stats TO authenticated;
