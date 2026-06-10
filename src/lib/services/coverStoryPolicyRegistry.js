/**
 * Cover Story Policy Registry
 * ─────────────────────────────────────────────────────────────
 * Central source of truth for per-story-type cover composition policies.
 * Each policy defines slot priorities, forbidden source types, template
 * preferences, and manual review triggers.
 *
 * Usage:
 *   import { getPolicyForStoryType, STORY_POLICIES } from './coverStoryPolicyRegistry';
 *   const policy = getPolicyForStoryType('family_nature_learning');
 *   // → { mainSlotPriority, circleSlotPriority, forbiddenSourceTypes, ... }
 *
 * Phase 2 — does NOT modify existing pipeline behavior.
 * Later phases (3-5) will wire this into route.js, quality gates, and regression tests.
 */

// ─── Shared constants ──────────────────────────────────────────────────────────

/** Source image types that can be detected and blocked */
export const SOURCE_IMAGE_TYPES = {
  CLEAN_PHOTO: 'CLEAN_PHOTO',
  NEWS_THUMBNAIL: 'NEWS_THUMBNAIL',
  TEXT_OVERLAY: 'TEXT_OVERLAY',
  COLLAGE: 'COLLAGE',
  SCREENSHOT: 'SCREENSHOT',
  SPLIT_SCREEN: 'SPLIT_SCREEN',
  WATERMARKED: 'WATERMARKED',
  PREVIOUS_COVER: 'PREVIOUS_COVER',
  YOUTUBE_THUMBNAIL: 'YOUTUBE_THUMBNAIL',
  SOCIAL_POST: 'SOCIAL_POST',
  INTERVIEW_FRAME: 'INTERVIEW_FRAME',
};

/** Image roles used in slot assignment */
export const IMAGE_ROLES = {
  STORY_ANCHOR: 'STORY_ANCHOR',
  KEY_ACTIVITY: 'KEY_ACTIVITY',
  CONTEXT_SCENE: 'CONTEXT_SCENE',
  RELATIONSHIP: 'RELATIONSHIP',
  HERO_FACE: 'HERO_FACE',
  HERO2: 'HERO2',
  EVIDENCE: 'EVIDENCE',
  EMOTION: 'EMOTION',
  PERSON_SUPPORT: 'PERSON_SUPPORT',
  EVIDENCE_CANDIDATE: 'EVIDENCE_CANDIDATE',
  LOW_PRIORITY: 'LOW_PRIORITY',
};

// ─── Default policy (fallback for unknown story types) ─────────────────────────

const DEFAULT_POLICY = {
  mainSlotPriority: ['HERO_FACE', 'CONTEXT_SCENE', 'KEY_ACTIVITY', 'STORY_ANCHOR'],
  supportSlotPriority: ['CONTEXT_SCENE', 'KEY_ACTIVITY', 'RELATIONSHIP', 'HERO_FACE', 'PERSON_SUPPORT'],
  circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'PERSON_SUPPORT'],
  allowedTemplates: ['template_9', 'template_8', 'template_1', 'template_2', 'template_3', 'template_5', 'template_7'],
  forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'SPLIT_SCREEN', 'PREVIOUS_COVER'],
  forbiddenMainVisual: [],
  maxHeroFaceCount: 2,
  maxTextOverlaySourceImages: 0,
  maxNewsThumbnailImages: 0,
  maxYoutubeThumbnailImages: 0,
  maxSocialPostImages: 0,
  // Types that can NEVER be used in main or circle slots even if they pass the gate
  forbiddenSlotTypes: {
    main: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'SPLIT_SCREEN', 'PREVIOUS_COVER', 'INTERVIEW_FRAME'],
    circle: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'SPLIT_SCREEN', 'PREVIOUS_COVER'],
  },
  technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
  manualReviewTriggers: ['ALL_TEXT_OVERLAY', 'NO_CLEAN_PHOTO', 'SCORE_BELOW_5'],
  visualWeightRules: { storyAnchorMin: 0, heroFaceMax: 60 },
};

// ─── 15 Story Type Policies ────────────────────────────────────────────────────

export const STORY_POLICIES = {

  // ────────────────────────────────────────────────────────────────────────────
  // 1. FAMILY / NATURE / LEARNING
  // ────────────────────────────────────────────────────────────────────────────

  family_nature_learning: {
    mainSlotPriority: ['STORY_ANCHOR', 'KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP', 'HERO_FACE'],
    circleSlotPriority: ['RELATIONSHIP', 'KEY_ACTIVITY', 'HERO_FACE'],
    circleSlotRejection: ['airport', 'event', 'press', 'interview', 'red_carpet'],
    allowedTemplates: ['template_9', 'template_8'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'SPLIT_SCREEN', 'PREVIOUS_COVER', 'YOUTUBE_THUMBNAIL'],
    forbiddenMainVisual: ['generic_portrait', 'press_interview', 'airport_photo', 'red_carpet'],
    maxHeroFaceCount: 1,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_STORY_ANCHOR', 'ALL_PORTRAITS', 'MAIN_IS_INTERVIEW', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 40, heroFaceMax: 30 },
    description: 'ข่าวครอบครัว/ธรรมชาติ/เรียนรู้ — เน้นกิจกรรม/สถานที่ ไม่ใช่หน้าดารา',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 2. FAMILY WARMTH (ครอบครัวอบอุ่น)
  // ────────────────────────────────────────────────────────────────────────────

  family_warm: {
    mainSlotPriority: ['RELATIONSHIP', 'KEY_ACTIVITY', 'STORY_ANCHOR', 'HERO_FACE'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'HERO_FACE', 'PERSON_SUPPORT'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'PERSON_SUPPORT'],
    circleSlotRejection: ['press', 'interview', 'unrelated_event'],
    allowedTemplates: ['template_9', 'template_8', 'template_7'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['press_interview', 'red_carpet'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['ALL_TEXT_OVERLAY', 'NO_CLEAN_PHOTO'],
    visualWeightRules: { storyAnchorMin: 30, heroFaceMax: 40 },
    description: 'ข่าวครอบครัวอบอุ่น — เน้นความสัมพันธ์ ภาพกิจกรรมร่วมกัน',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 3. FAMILY CARE (ดูแลพ่อแม่/ลูก)
  // ────────────────────────────────────────────────────────────────────────────

  family_care: {
    mainSlotPriority: ['STORY_ANCHOR', 'KEY_ACTIVITY', 'RELATIONSHIP', 'HERO_FACE'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP', 'EMOTION'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'EMOTION'],
    circleSlotRejection: ['occupation_context', 'unrelated_animal', 'press'],
    allowedTemplates: ['template_9', 'template_8'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['occupation_dominant', 'animal_dominant', 'press_interview'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['OCCUPATION_DOMINATES_MAIN', 'NO_STORY_ANCHOR', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 35, occupationMax: 20 },
    description: 'ข่าวดูแลครอบครัว/กตัญญู — เน้นการดูแล ไม่ใช่อาชีพ (เช่น หมอโบว์ ต้องเน้นแม่ ไม่ใช่ช้าง)',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 4. CHARITY / DONATION (บริจาค/ช่วยเหลือ)
  // ────────────────────────────────────────────────────────────────────────────

  charity_donation: {
    mainSlotPriority: ['KEY_ACTIVITY', 'STORY_ANCHOR', 'CONTEXT_SCENE', 'RELATIONSHIP'],
    supportSlotPriority: ['CONTEXT_SCENE', 'RELATIONSHIP', 'HERO_FACE', 'EVIDENCE'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP'],
    circleSlotRejection: ['glamour_portrait', 'red_carpet', 'fashion'],
    allowedTemplates: ['template_8', 'template_9', 'template_5'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['donor_glamour_portrait', 'press_interview', 'unrelated_event'],
    maxHeroFaceCount: 1,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['DONOR_PORTRAIT_AS_MAIN', 'NO_DONATION_ACTION_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 40, heroFaceMax: 25 },
    description: 'ข่าวบริจาค/การกุศล — เน้นการให้/ผู้รับ ไม่ใช่ portrait ผู้บริจาค',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 5. DEBT / SACRIFICE (หนี้/เสียสละ)
  // ────────────────────────────────────────────────────────────────────────────

  debt_sacrifice: {
    mainSlotPriority: ['STORY_ANCHOR', 'KEY_ACTIVITY', 'EMOTION', 'HERO_FACE'],
    supportSlotPriority: ['EVIDENCE', 'CONTEXT_SCENE', 'RELATIONSHIP', 'KEY_ACTIVITY'],
    circleSlotPriority: ['HERO_FACE', 'EMOTION'],
    circleSlotRejection: ['glamour', 'celebration', 'fashion'],
    allowedTemplates: ['template_9', 'template_8', 'template_3'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['cheerful_portrait', 'celebration_photo'],
    maxHeroFaceCount: 1,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_EVIDENCE_IMAGE', 'ALL_TEXT_OVERLAY', 'CHEERFUL_MAIN_IN_SAD_STORY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 30 },
    description: 'ข่าวหนี้สิน/เสียสละ — เน้นบริบทเรื่องราว/หลักฐาน ไม่ใช่ภาพสวยๆ',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 6. ILLNESS / CARE (เจ็บป่วย/ดูแลผู้ป่วย)
  // ────────────────────────────────────────────────────────────────────────────

  illness_care: {
    mainSlotPriority: ['STORY_ANCHOR', 'RELATIONSHIP', 'KEY_ACTIVITY', 'HERO_FACE'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'EMOTION', 'EVIDENCE'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'EMOTION'],
    circleSlotRejection: ['glamour', 'celebration', 'occupation_unrelated'],
    allowedTemplates: ['template_9', 'template_8'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['cheerful_glamour_portrait', 'occupation_dominant', 'animal_dominant'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['OCCUPATION_DOMINATES_MAIN', 'CHEERFUL_MAIN_IN_SAD_STORY', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 35, occupationMax: 15 },
    description: 'ข่าวเจ็บป่วย/ดูแลผู้ป่วย — เน้นความสัมพันธ์ผู้ดูแล+ผู้ป่วย ไม่ใช่อาชีพ',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7. FUNERAL / LOSS (งานศพ/สูญเสีย)
  // ────────────────────────────────────────────────────────────────────────────

  funeral_loss: {
    mainSlotPriority: ['STORY_ANCHOR', 'HERO_FACE', 'EMOTION', 'CONTEXT_SCENE'],
    supportSlotPriority: ['CONTEXT_SCENE', 'RELATIONSHIP', 'KEY_ACTIVITY', 'EVIDENCE'],
    circleSlotPriority: ['HERO_FACE', 'EMOTION', 'RELATIONSHIP'],
    circleSlotRejection: ['cheerful_portrait', 'celebration', 'glamour'],
    allowedTemplates: ['template_9', 'template_8', 'template_1'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['cheerful_unrelated_portrait', 'glamour_event', 'celebration'],
    maxHeroFaceCount: 1,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['CHEERFUL_MAIN_IN_SAD_STORY', 'NO_DECEASED_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 40, heroFaceMax: 35 },
    description: 'ข่าวงานศพ/สูญเสีย — เน้นผู้เสียชีวิต/บรรยากาศ ห้ามใช้ภาพสดใสไม่เกี่ยวข้อง',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 8. CRIME / INCIDENT (อาชญากรรม/คดี)
  // ────────────────────────────────────────────────────────────────────────────

  crime_incident: {
    mainSlotPriority: ['EVIDENCE', 'STORY_ANCHOR', 'CONTEXT_SCENE', 'HERO_FACE'],
    supportSlotPriority: ['CONTEXT_SCENE', 'EVIDENCE', 'HERO_FACE', 'KEY_ACTIVITY'],
    circleSlotPriority: ['HERO_FACE', 'EVIDENCE'],
    circleSlotRejection: ['glamour', 'celebration', 'unrelated_family'],
    allowedTemplates: ['template_3', 'template_1', 'template_5', 'template_8'],
    forbiddenSourceTypes: ['TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['random_celebrity_portrait', 'cheerful_glamour'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 1,
    technicalBadRules: ['LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_EVIDENCE_IMAGE', 'RANDOM_PORTRAIT_AS_MAIN', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 40, heroFaceMax: 30 },
    description: 'ข่าวอาชญากรรม/คดี — เน้นหลักฐาน/สถานที่เกิดเหตุ ไม่ใช่ portrait สวยๆ',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 9. FRAUD / WARNING (ฉ้อโกง/แจ้งเตือน)
  // ────────────────────────────────────────────────────────────────────────────

  fraud_warning: {
    mainSlotPriority: ['EVIDENCE', 'STORY_ANCHOR', 'CONTEXT_SCENE', 'HERO_FACE'],
    supportSlotPriority: ['EVIDENCE', 'CONTEXT_SCENE', 'KEY_ACTIVITY', 'HERO_FACE'],
    circleSlotPriority: ['HERO_FACE', 'EVIDENCE'],
    circleSlotRejection: ['glamour', 'celebration', 'unrelated_celebrity'],
    allowedTemplates: ['template_3', 'template_1', 'template_5'],
    forbiddenSourceTypes: ['COLLAGE', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['random_celebrity_portrait', 'cheerful_glamour', 'unrelated_event'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 1,
    technicalBadRules: ['LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_EVIDENCE_IMAGE', 'RANDOM_PORTRAIT_AS_MAIN', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 45, heroFaceMax: 25 },
    description: 'ข่าวฉ้อโกง/แจ้งเตือน — เน้นหลักฐาน/เอกสาร/บุคคลที่เกี่ยวข้อง',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 10. ACCIDENT / RESCUE (อุบัติเหตุ/กู้ภัย)
  // ────────────────────────────────────────────────────────────────────────────

  accident_rescue: {
    mainSlotPriority: ['STORY_ANCHOR', 'CONTEXT_SCENE', 'KEY_ACTIVITY', 'EVIDENCE'],
    supportSlotPriority: ['EVIDENCE', 'CONTEXT_SCENE', 'KEY_ACTIVITY', 'HERO_FACE'],
    circleSlotPriority: ['HERO_FACE', 'EVIDENCE', 'KEY_ACTIVITY'],
    circleSlotRejection: ['glamour', 'celebration'],
    allowedTemplates: ['template_5', 'template_3', 'template_1', 'template_8'],
    forbiddenSourceTypes: ['COLLAGE', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['cheerful_portrait', 'unrelated_event'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 1,
    technicalBadRules: ['LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_SCENE_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 45, heroFaceMax: 25 },
    description: 'ข่าวอุบัติเหตุ/กู้ภัย — เน้นสถานที่เกิดเหตุ/การช่วยเหลือ',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 11. CELEBRITY INTERVIEW (ดาราให้สัมภาษณ์)
  // ────────────────────────────────────────────────────────────────────────────

  celebrity_interview: {
    mainSlotPriority: ['HERO_FACE', 'KEY_ACTIVITY', 'CONTEXT_SCENE', 'STORY_ANCHOR'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP', 'PERSON_SUPPORT'],
    circleSlotPriority: ['HERO2', 'RELATIONSHIP', 'PERSON_SUPPORT'],
    circleSlotRejection: ['same_person_as_main'],
    allowedTemplates: ['template_2', 'template_9', 'template_7'],
    forbiddenSourceTypes: ['TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER', 'SOCIAL_POST'],
    forbiddenMainVisual: [],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    maxNewsThumbnailImages: 1,       // allow max 1 news thumbnail as evidence only
    maxYoutubeThumbnailImages: 1,    // allow max 1 YT thumbnail as evidence only
    maxSocialPostImages: 0,
    forbiddenSlotTypes: {
      main: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'PREVIOUS_COVER', 'INTERVIEW_FRAME'],
      circle: ['NEWS_THUMBNAIL', 'YOUTUBE_THUMBNAIL', 'TEXT_OVERLAY', 'SOCIAL_POST', 'SCREENSHOT', 'COLLAGE', 'PREVIOUS_COVER'],
    },
    technicalBadRules: ['TEXT_AREA_>40%', 'LOGO_AREA_>20%', 'MULTI_PANEL'],
    manualReviewTriggers: ['ALL_TEXT_OVERLAY', 'NO_CLEAN_PORTRAIT', 'THUMBNAIL_DOMINATES'],
    visualWeightRules: { storyAnchorMin: 0, heroFaceMax: 60 },
    description: 'ข่าวดาราให้สัมภาษณ์ — เน้น portrait สวย + กิจกรรม/ความสัมพันธ์ ห้ามใช้ภาพซ้อนข้อความ/thumbnail เป็นหลัก',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 12. RELATIONSHIP DRAMA (ดราม่าความสัมพันธ์)
  // ────────────────────────────────────────────────────────────────────────────

  relationship_drama: {
    mainSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'KEY_ACTIVITY', 'EMOTION'],
    supportSlotPriority: ['HERO2', 'RELATIONSHIP', 'CONTEXT_SCENE', 'EVIDENCE'],
    circleSlotPriority: ['HERO2', 'RELATIONSHIP', 'EMOTION'],
    circleSlotRejection: ['unrelated_event'],
    allowedTemplates: ['template_7', 'template_1', 'template_2', 'template_9'],
    forbiddenSourceTypes: ['COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['unrelated_event', 'unrelated_location'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 1,
    technicalBadRules: ['TEXT_AREA_>40%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['ALL_TEXT_OVERLAY', 'NO_CLEAN_PHOTO', 'WRONG_PERSON_IN_MAIN'],
    visualWeightRules: { storyAnchorMin: 0, heroFaceMax: 50 },
    description: 'ข่าวดราม่าความสัมพันธ์ — เน้นบุคคลหลัก+คู่กรณี',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 13. EDUCATION SUPPORT (การศึกษา/ทุนเรียน)
  // ────────────────────────────────────────────────────────────────────────────

  education_support: {
    mainSlotPriority: ['STORY_ANCHOR', 'KEY_ACTIVITY', 'CONTEXT_SCENE', 'HERO_FACE'],
    supportSlotPriority: ['CONTEXT_SCENE', 'KEY_ACTIVITY', 'RELATIONSHIP', 'EVIDENCE'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP'],
    circleSlotRejection: ['glamour', 'unrelated_event'],
    allowedTemplates: ['template_8', 'template_9', 'template_5'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['donor_glamour_portrait', 'press_interview'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_SCHOOL_OR_STUDENT_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 30 },
    description: 'ข่าวการศึกษา/ทุนเรียน — เน้นนักเรียน/โรงเรียน/กิจกรรมเรียน',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 14. COMMUNITY HELP (ชุมชนช่วยเหลือ)
  // ────────────────────────────────────────────────────────────────────────────

  community_help: {
    mainSlotPriority: ['STORY_ANCHOR', 'KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP'],
    supportSlotPriority: ['KEY_ACTIVITY', 'CONTEXT_SCENE', 'RELATIONSHIP', 'HERO_FACE'],
    circleSlotPriority: ['HERO_FACE', 'RELATIONSHIP', 'KEY_ACTIVITY'],
    circleSlotRejection: ['glamour', 'press_interview'],
    allowedTemplates: ['template_8', 'template_9', 'template_5'],
    forbiddenSourceTypes: ['NEWS_THUMBNAIL', 'TEXT_OVERLAY', 'COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['celebrity_glamour', 'press_interview'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 0,
    technicalBadRules: ['TEXT_AREA_>30%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_ACTION_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 30 },
    description: 'ข่าวชุมชนช่วยเหลือ — เน้นกิจกรรมรวม/สถานที่ ไม่ใช่บุคคลเดียว',
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 15. SPORTS ACHIEVEMENT (กีฬา/ความสำเร็จ)
  // ────────────────────────────────────────────────────────────────────────────

  sports_achievement: {
    mainSlotPriority: ['KEY_ACTIVITY', 'STORY_ANCHOR', 'HERO_FACE', 'CONTEXT_SCENE'],
    supportSlotPriority: ['CONTEXT_SCENE', 'KEY_ACTIVITY', 'EVIDENCE', 'HERO_FACE'],
    circleSlotPriority: ['HERO_FACE', 'EVIDENCE'],
    circleSlotRejection: ['unrelated_portrait'],
    allowedTemplates: ['template_8', 'template_1', 'template_9'],
    forbiddenSourceTypes: ['COLLAGE', 'SCREENSHOT', 'PREVIOUS_COVER'],
    forbiddenMainVisual: ['casual_portrait', 'unrelated_event'],
    maxHeroFaceCount: 2,
    maxTextOverlaySourceImages: 1,
    technicalBadRules: ['TEXT_AREA_>40%', 'LOGO_AREA_>15%', 'MULTI_PANEL'],
    manualReviewTriggers: ['NO_SPORT_ACTION_IMAGE', 'ALL_TEXT_OVERLAY'],
    visualWeightRules: { storyAnchorMin: 35, heroFaceMax: 40 },
    description: 'ข่าวกีฬา/ความสำเร็จ — เน้นการแข่งขัน/รับรางวัล ไม่ใช่ portrait ธรรมดา',
  },
};

// ─── Alias mapping: existing DNA enums → policy keys ───────────────────────────
// Maps old DNA_MAP keys and normalizer outputs to the new policy keys.
// Keeps backward compatibility without changing GPT normalizer.

const POLICY_ALIASES = {
  // Direct matches (key === DNA enum)
  family_nature_learning: 'family_nature_learning',
  family_warm: 'family_warm',
  family_care: 'family_care',
  nature_learning: 'family_nature_learning',

  // Map existing DNA enums to new policy keys
  donation: 'charity_donation',
  rescue: 'accident_rescue',
  celebrity: 'celebrity_interview',
  relationship: 'relationship_drama',
  achievement: 'sports_achievement',
  conflict: 'crime_incident',
  accident: 'accident_rescue',
  drama: 'relationship_drama',
  politics: 'crime_incident',

  // New policy-only types (not in GPT normalizer yet — Phase 2 only)
  charity_donation: 'charity_donation',
  debt_sacrifice: 'debt_sacrifice',
  illness_care: 'illness_care',
  funeral_loss: 'funeral_loss',
  crime_incident: 'crime_incident',
  fraud_warning: 'fraud_warning',
  accident_rescue: 'accident_rescue',
  celebrity_interview: 'celebrity_interview',
  relationship_drama: 'relationship_drama',
  education_support: 'education_support',
  community_help: 'community_help',
  sports_achievement: 'sports_achievement',
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the cover policy for a story type.
 * Resolves aliases and falls back to DEFAULT_POLICY.
 *
 * @param {string} storyType — from storyIdentityService or coverDNAService
 * @returns {Object} policy object with all slot/source/template rules
 */
export function getPolicyForStoryType(storyType) {
  if (!storyType || typeof storyType !== 'string') {
    return { ...DEFAULT_POLICY, _policyKey: 'default', _resolved: false };
  }

  const normalized = storyType.toLowerCase().trim();
  const policyKey = POLICY_ALIASES[normalized] || normalized;
  const policy = STORY_POLICIES[policyKey];

  if (policy) {
    return { ...policy, _policyKey: policyKey, _resolved: true };
  }

  return { ...DEFAULT_POLICY, _policyKey: 'default', _resolved: false };
}

/**
 * Get list of all registered policy keys.
 * @returns {string[]}
 */
export function getAllPolicyKeys() {
  return Object.keys(STORY_POLICIES);
}

/**
 * Check if a source image type is forbidden by a policy.
 * @param {Object} policy — from getPolicyForStoryType
 * @param {string} sourceType — from SOURCE_IMAGE_TYPES
 * @returns {boolean}
 */
export function isSourceTypeForbidden(policy, sourceType) {
  return (policy.forbiddenSourceTypes || []).includes(sourceType);
}

/**
 * Get the slot priority for a specific slot type.
 * @param {Object} policy
 * @param {'main'|'support'|'circle'} slotType
 * @returns {string[]} ordered role priority
 */
export function getSlotPriority(policy, slotType) {
  switch (slotType) {
    case 'main': return policy.mainSlotPriority || DEFAULT_POLICY.mainSlotPriority;
    case 'support': return policy.supportSlotPriority || DEFAULT_POLICY.supportSlotPriority;
    case 'circle': return policy.circleSlotPriority || DEFAULT_POLICY.circleSlotPriority;
    default: return DEFAULT_POLICY.mainSlotPriority;
  }
}

/**
 * Check if a template is allowed by the policy.
 * @param {Object} policy
 * @param {string} templateId
 * @returns {boolean}
 */
export function isTemplateAllowed(policy, templateId) {
  if (!policy.allowedTemplates || policy.allowedTemplates.length === 0) return true;
  return policy.allowedTemplates.includes(templateId);
}

/**
 * Get manual review triggers for a policy.
 * @param {Object} policy
 * @returns {string[]}
 */
export function getManualReviewTriggers(policy) {
  return policy.manualReviewTriggers || DEFAULT_POLICY.manualReviewTriggers;
}
