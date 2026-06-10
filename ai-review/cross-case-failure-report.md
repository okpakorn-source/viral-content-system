# Cross-Case Failure Report

> **Report ID**: cross-case-failure-v1  
> **Generated**: 2026-06-10T03:42:00+07:00  
> **Branch**: `ai/post-selection-quality`  
> **Cases Inspected**: 12 (CASE-001 to CASE-010, CASE-020, CASE-030)

## Failure Summary

| Verdict | Count | Cases |
|---------|-------|-------|
| ✅ PASS | 3 | CASE-005, CASE-007, CASE-008 |
| ⚠️ PARTIAL_FAIL | 3 | CASE-001, CASE-006, CASE-009 |
| ❌ FAIL | 3 | CASE-004, CASE-010 |
| 🚫 HARD_FAIL | 3 | CASE-003, CASE-020, CASE-030 |

## Failure Type Frequency

| Failure Type | Count | Severity |
|---|---|---|
| `TEXT_OVERLAY_SOURCE_IMAGE` | **8** | #1 problem — news screenshots with Thai headlines |
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | **5** | Finished covers/thumbnails from other outlets reused |
| `WRONG_MAIN_VISUAL` | **3** | Dominant visual doesn't match story core |
| `COLLAGE_SOURCE_IMAGE` | **3** | 4-panel collage graphics from news |
| `CIRCLE_NOT_STORY_RELATED` | **2** | Airport photos in nature stories |
| `SUPPORT_IMAGE_OVERPOWERS_MAIN` | **2** | Interview/elephant dominates |
| `FINAL_QA_SHOULD_HAVE_BLOCKED_SAVE` | **3** | Score ≤5 or all-text covers saved as SUCCESS |
| `WRONG_STORY_TYPE` | 0 | — |
| `BAD_TEMPLATE_FOR_STORY_TYPE` | 0 | — |

---

## Per-Case Detail

### CASE-001 — ชมพู่/ยายหนิง สวน (Score: 7) ⚠️

| Failure | Severity | Detail |
|---------|----------|--------|
| `CIRCLE_NOT_STORY_RELATED` | medium | Circle shows airport (Suvarnabhumi) family photo, not garden/nature |
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | low | Instagram screenshot with UI (username, play button) as source |
| `WRONG_MAIN_VISUAL` | medium | Main hero is children near Christmas tree (indoor), not garden activity |

---

### CASE-002 — ชมพู่/ยายหนิง ปลูกผัก (Score: 8) ⚠️

| Failure | Severity | Detail |
|---------|----------|--------|
| `SUPPORT_IMAGE_OVERPOWERS_MAIN` | medium | Press interview with mic logos (ET Thailand/true4U) dominates support |
| `CIRCLE_NOT_STORY_RELATED` | medium | Airport family photo (Q18 Qatar First Class gate visible) |

---

### CASE-003 — เบียร์ เดอะวอยซ์ / โอ๋ ภัคจีรา (Score: 5) 🚫

> [!CAUTION]
> **WORST CASE** — Zero clean source photos. Every slot is a news screenshot or social media post.

| Failure | Severity | Detail |
|---------|----------|--------|
| `TEXT_OVERLAY_SOURCE_IMAGE` | critical | ALL slots use massive Thai text overlays — article text, Facebook comments, quote graphics |
| `COLLAGE_SOURCE_IMAGE` | critical | Support image is pre-made news collage (wedding photo + quote in designed frame) |
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | critical | YouTube/news thumbnail with large Thai quote text used as source |
| `FINAL_QA_SHOULD_HAVE_BLOCKED_SAVE` | critical | Score 5 saved as SUCCESS — should have been NEED_MANUAL_REVIEW |

---

### CASE-004 — เจ๊แห้ง แม่ค้าหัวใจทองคำ (Score: 6) ❌

| Failure | Severity | Detail |
|---------|----------|--------|
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | high | MGR Online screenshot with logo watermark as main. Circle from news interview with channel 23 banner |
| `TEXT_OVERLAY_SOURCE_IMAGE` | high | Lottery-ticket-in-trash image has large Thai text + decorative stars (pre-made graphic) |
| `WRONG_MAIN_VISUAL` | medium | Shows sad elderly face from broadcast, not the vendor or heroic action |

---

### CASE-005 — ชมพู่/ยายหนิง ธรรมชาติ (Score: 7) ✅

**PASS** — Clean source photos. Children in nature/water. Garden scene. Circle shows mother+child in stream.

---

### CASE-006 — tye.chutima ส่งลูกเรียนต่างประเทศ ⚠️

| Failure | Severity | Detail |
|---------|----------|--------|
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | medium | Instagram story screenshot with UI (username, timestamp, reply bar) |
| `TEXT_OVERLAY_SOURCE_IMAGE` | low | Instagram story text overlay ('Thank you', 'picture board', 'le girl') |

---

### CASE-007 — Celebrity family (mother-daughter) ✅

**PASS** — Clean photos. Good portrait + activity mix. No text overlays.

---

### CASE-008 — Award ceremony (royal foundation) ✅

**PASS** — Clean event photos. Award ceremony context. Good story-activity match.

---

### CASE-009 — Celebrity family (colorful) ⚠️

| Failure | Severity | Detail |
|---------|----------|--------|
| `TEXT_OVERLAY_SOURCE_IMAGE` | low | Circle image has 'สประกอบ' text at bottom — cropped from news interview lower-third |

---

### CASE-010 — หมอโบว์ ช้าง / แม่อัลไซเมอร์ ❌

| Failure | Severity | Detail |
|---------|----------|--------|
| `TEXT_OVERLAY_SOURCE_IMAGE` | high | One31 TV interview with Thai text banners |
| `COLLAGE_SOURCE_IMAGE` | high | Circle is 4-panel collage (2x2 grid) — pre-made news graphic |
| `WRONG_MAIN_VISUAL` | high | Elephant dominates >50% of hero. Story is mother-care but looks like elephant/zoo news |
| `SUPPORT_IMAGE_OVERPOWERS_MAIN` | medium | Elephant visual weight overpowers person |

---

### CASE-020 — หมอโบว์ ช้าง / อัลไซเมอร์ (variant 2) 🚫

| Failure | Severity | Detail |
|---------|----------|--------|
| `TEXT_OVERLAY_SOURCE_IMAGE` | critical | Multiple slots: 'อัลไซเมอร์', 'เดินไม่ได้', 'และแม่อัลไซเมอร์' banners |
| `COLLAGE_SOURCE_IMAGE` | high | Same 4-panel collage as CASE-010 |
| `WRONG_MAIN_VISUAL` | critical | Elephant ~70% of hero area. Mother-care story invisible |
| `FINAL_QA_SHOULD_HAVE_BLOCKED_SAVE` | high | Text overlays + collage + wrong subject → should be blocked |

---

### CASE-030 — หมอโบว์ คุณหมอเคียงข้างน้องช้าง 🚫

| Failure | Severity | Detail |
|---------|----------|--------|
| `TEXT_OVERLAY_SOURCE_IMAGE` | critical | Main hero: Thai headline 'คุณหมอเคียง ของ น้องช้าง' covers >40% of image. Also 'Made (วันนี้ดีที่สุด)' branding |
| `THUMBNAIL_OR_NEWS_COVER_USED_AS_SOURCE` | critical | Support: มติชน article layout. Circle: MCOT HD interview screenshot |
| `FINAL_QA_SHOULD_HAVE_BLOCKED_SAVE` | critical | Main image is literally another outlet's cover/header — system should NEVER reuse as source |

---

## Key Insights

1. **#1 problem is source image quality** — text overlays and news thumbnails are the most common failure (8/12 and 5/12 cases)
2. **The system cannot distinguish clean photos from news graphics** — it treats a news screenshot with Thai headline text the same as a clean portrait
3. **Wrong main visual is story-type specific** — หมอโบว์ cases consistently show elephant as dominant when the story is about mother care (3 cases)
4. **No final save gate exists** — CASE-003 with score 5 and ALL text-overlay images was saved as SUCCESS
5. **Template selection is not the problem** — template_9 is appropriate for most stories; the issue is source image quality
