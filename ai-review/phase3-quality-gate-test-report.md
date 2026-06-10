# Phase 3 — Quality Gate Live Verification Report

> **Generated**: 2026-06-10T03:22:52.775Z  
> **Branch**: ai/post-selection-quality  
> **Commit**: 0f66375  

## Summary

| Case | Status | Score | Gate Passed | Blocked | Downgraded | Policy |
|------|--------|-------|-------------|---------|------------|--------|
| CASE-003 | ✅ OK | 6 | true | 7 | 0 | family_warm |
| CASE-004 | ✅ OK | 7 | true | 2 | 0 | default |
| CASE-005-regression | ✅ OK | 7 | true | 2 | 0 | family_nature_learning |

---

## CASE-003

- **Expected**: BLOCK_MOST — text overlays + news thumbnails + YT thumbnails blocked/downgraded, qualityGatePassed=false if clean images insufficient
- **Status**: SUCCESS
- **Score**: 6
- **Story Type**: family_warm
- **Policy**: family_warm
- **Template**: null
- **Elapsed**: 196.2s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 15 |
| Passed | 8 |
| Blocked | 7 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"NEWS_THUMBNAIL":4,"CLEAN_PHOTO":8,"TEXT_OVERLAY":2,"YOUTUBE_THUMBNAIL":1} |

### Blocked Images

| URL | Source Type | Reason |
|-----|------------|--------|
| https://mpics.mgronline.com/pics/Images/568000002768401.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_warm policy |
| https://s.isanook.com/ns/0/ud/1973/9869938/555881.jpg?ip/crop/w1200h700/q80/jpg | TEXT_OVERLAY | TEXT_OVERLAY forbidden by family_warm policy |
| https://s359.kapook.com/pagebuilder/18b99998-f6fe-4251-9829-bea95051a319.jpg | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_warm policy |
| https://mpics.mgronline.com/pics/Images/567000001167401.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_warm policy |
| https://i.ytimg.com/vi/wAC5NNgHiJw/hq720.jpg?sqp=-oaymwE7CK4FEIIDSFryq4qpAy0IARU | YOUTUBE_THUMBNAIL | YOUTUBE_THUMBNAIL over quota (0/0) in family_warm policy |
| https://img.pptvhd36.com/thumbor/2024/02/01/news-3ff4beb.jpg | TEXT_OVERLAY | TEXT_OVERLAY forbidden by family_warm policy |
| https://mpics.mgronline.com/pics/Images/566000010069101.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_warm policy |

### Story Match

- **Score**: 8
- **Reason**: The cover effectively conveys a sense of love and acceptance, aligning well with the theme of celebrating individuality in a relationship.

---

## CASE-004

- **Expected**: BLOCK_SOME — MGR thumbnail + text overlay blocked
- **Status**: SUCCESS
- **Score**: 7
- **Story Type**: default
- **Policy**: default
- **Template**: null
- **Elapsed**: 204.8s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 11 |
| Passed | 9 |
| Blocked | 2 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"NEWS_THUMBNAIL":1,"CLEAN_PHOTO":9,"YOUTUBE_THUMBNAIL":1} |

### Blocked Images

| URL | Source Type | Reason |
|-----|------------|--------|
| https://mpics2.mgronline.com/pics/Images/569000005512101.JPEG | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by default policy |
| https://i.ytimg.com/vi/jIP_AXmMRQc/maxresdefault.jpg | YOUTUBE_THUMBNAIL | YOUTUBE_THUMBNAIL over quota (0/0) in default policy |

### Story Match

- **Score**: 5
- **Reason**: The cover highlights the lottery ticket and the winner, aligning with the praise, but the overall context may suggest a mix of emotions.

---

## CASE-005-regression

- **Expected**: PASS — clean images should not be false-blocked
- **Status**: SUCCESS
- **Score**: 7
- **Story Type**: nature_learning
- **Policy**: family_nature_learning
- **Template**: null
- **Elapsed**: 162.3s
- **Cover Image**: N/A

### Quality Gate

| Metric | Value |
|--------|-------|
| Total images | 12 |
| Passed | 10 |
| Blocked | 2 |
| Downgraded | 0 |
| Gate Passed | true |
| Types | {"CLEAN_PHOTO":10,"YOUTUBE_THUMBNAIL":1,"NEWS_THUMBNAIL":1} |

### Blocked Images

| URL | Source Type | Reason |
|-----|------------|--------|
| https://i.ytimg.com/vi/73kiODzAG2A/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARU | YOUTUBE_THUMBNAIL | YOUTUBE_THUMBNAIL forbidden by family_nature_learning policy |
| https://s.isanook.com/ns/0/ud/1835/9178526/chom.jpg?ip/crop/w670h402/q80/jpg | NEWS_THUMBNAIL | NEWS_THUMBNAIL forbidden by family_nature_learning policy |

### Story Match

- **Score**: 8
- **Reason**: the cover effectively highlights family bonding and nature, aligning well with the theme of learning and gardening.

---

