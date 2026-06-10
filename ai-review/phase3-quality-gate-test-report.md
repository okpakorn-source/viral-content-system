# Phase 3 — Quality Gate Live Verification Report

> **Generated**: 2026-06-10T03:00:01.684Z  
> **Branch**: ai/post-selection-quality  
> **Commit**: 0f66375  

## Summary

| Case | Status | Score | Gate Passed | Blocked | Downgraded | Policy |
|------|--------|-------|-------------|---------|------------|--------|
| CASE-003 | ✅ OK | 7 | true | 0 | 0 | celebrity_interview |
| CASE-004 | ✅ OK | 7 | true | 2 | 0 | default |
| CASE-005-regression | ✅ OK | 7 | true | 8 | 0 | family_nature_learning |

---

## CASE-003

- **Expected**: BLOCK_MOST — text overlays + collages should be blocked
- **Status**: SUCCESS
- **Score**: 7
- **Story Type**: celebrity
- **Policy**: celebrity_interview
- **Template**: null
- **Elapsed**: 197.3s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 12 |
| Passed | 12 |
| Blocked | 0 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"NEWS_THUMBNAIL":3,"YOUTUBE_THUMBNAIL":1,"CLEAN_PHOTO":7,"TEXT_OVERLAY":1} |

### Story Match

- **Score**: 7
- **Reason**: ภาพหลักแสดงถึงความใกล้ชิดและความสุขในความสัมพันธ์ ทำให้ผู้ชมเชื่อมโยงกับการเฉลิมฉลองความเป็นตัวเองของโอ๋

---

## CASE-004

- **Expected**: BLOCK_SOME — MGR thumbnail + text overlay blocked
- **Status**: SUCCESS
- **Score**: 7
- **Story Type**: default
- **Policy**: default
- **Template**: null
- **Elapsed**: 148.9s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 8 |
| Passed | 6 |
| Blocked | 2 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"NEWS_THUMBNAIL":2,"CLEAN_PHOTO":5,"YOUTUBE_THUMBNAIL":1} |

### Blocked Images

| URL | Source Type | Reason |
|-----|------------|--------|
| https://static.amarintv.com/media/KVunBvWg8eCF3eKiOJU9QI5DOSDYN5Ink2JTwvi1lK9WXz | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by default policy |
| https://mpics2.mgronline.com/pics/Images/569000005512101.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by default policy |

### Story Match

- **Score**: 7
- **Reason**: The cover effectively highlights the emotional struggle of the winner, aligning with the praise of helping customers prove their lottery win.

---

## CASE-005-regression

- **Expected**: PASS — clean images should not be false-blocked
- **Status**: SUCCESS
- **Score**: 7
- **Story Type**: family_nature_learning
- **Policy**: family_nature_learning
- **Template**: null
- **Elapsed**: 210.0s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 19 |
| Passed | 11 |
| Blocked | 8 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"NEWS_THUMBNAIL":5,"TEXT_OVERLAY":2,"CLEAN_PHOTO":11,"YOUTUBE_THUMBNAIL":1} |

### Blocked Images

| URL | Source Type | Reason |
|-----|------------|--------|
| https://s.isanook.com/ns/0/ud/1900/9502726/555.jpg?ip/crop/w670h402/q80/jpg | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |
| https://www.dailynews.co.th/wp-content/uploads/2026/06/IMG_6962.jpeg | TEXT_OVERLAY | TEXT_OVERLAY forbidden by family_nature_learning policy |
| https://mpics.mgronline.com/pics/Images/567000000839401.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |
| https://s.isanook.com/ns/0/ud/1643/8215890/2.jpg?ip/crop/w670h402/q80/jpg | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |
| https://www.tnnthailand.com/static/2025/6c26ccd7-6c99-409d-b926-6ddae57d71ea.web | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |
| https://static.amarintv.com/media/PJVlR0ljpN9mLZ8mQXWDv8t4CqjqeqqJVz15bE3rlie2Wj | TEXT_OVERLAY | TEXT_OVERLAY forbidden by family_nature_learning policy |
| https://i.ytimg.com/vi/73kiODzAG2A/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARU | YOUTUBE_THUMBNAIL | YOUTUBE_THUMBNAIL forbidden by family_nature_learning policy |
| https://s.isanook.com/ns/0/ud/1835/9178526/chom.jpg?ip/crop/w670h402/q80/jpg | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |

### Story Match

- **Score**: 4
- **Reason**: While the cover features children engaging with nature, it does not specifically highlight planting vegetables or learning about nature in a structured way.

---

