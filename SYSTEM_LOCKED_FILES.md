# 🔒 ไฟล์ที่ถูกล็อก — ระบบเขียนข่าวอัตโนมัติ

> ตั้งล็อก 28 มิ.ย. 2026 (ผู้ใช้สั่ง): **ห้ามแก้ไฟล์ระบบเขียนข่าวอัตโนมัติแม้แต่บรรทัดเดียว
> โดยไม่ได้รับอนุญาต/ยืนยันจากเจ้าของก่อน** — ไม่ว่าจะแก้จากส่วนไหน/ใครก็ตาม

## ไฟล์ที่ถูกล็อก (ระบบเขียนข่าว เท่านั้น)
- `src/lib/services/autoFlowService.js`
- `src/lib/services/autoFlowServiceText.js`
- `src/lib/services/summarizeService.js` ⬅️ เพิ่ม 2 ก.ค. (ไฟล์แกนเขียนข่าว — เคยหลุดจากล็อก)
- `src/lib/services/summarizeServiceText.js` ⬅️ เพิ่ม 2 ก.ค.
- `src/lib/ai/aiRouter.js`
- `src/lib/ai/openai.js`
- `src/lib/ai/promptStore.js`
- `src/lib/ai/promptStoreText.js`
- `src/lib/ai/modelConfig.js`
- `src/app/api/auto/**` (route, detect, process, stream)
- `src/app/api/summarize/**`
- `src/app/api/extract/**`
- `src/app/api/research-search/**`
- `src/app/content/new/page.js`
- `scripts/validate-workflow.mjs` ⬅️ เพิ่ม 2 ก.ค. (CI gate ระบบข่าว)

## ล็อก 2 ชั้น (enforced จริง ไม่ใช่แค่คอมเมนต์)
| ชั้น | กลไก | ป้องกันอะไร |
|---|---|---|
| **1. Claude hook** | `.claude/settings.json` → PreToolUse → `scripts/news-lock-guard.mjs` | เวลา AI (เซสชันนี้หรือ agent อื่น) จะ Edit/Write ไฟล์เหล่านี้ → **เด้งถาม-ยืนยันก่อนทุกครั้ง** |
| **2. git pre-commit** | `.git/hooks/pre-commit` | เวลามี commit แตะไฟล์เหล่านี้ (ทางไหนก็ตาม) → **บล็อก commit** |

## วิธีปลดล็อก (เมื่อเจ้าของอนุญาตจริงเท่านั้น)
- **ชั้น 1:** ตอบยืนยัน "อนุญาต" เมื่อ hook เด้งถาม
- **ชั้น 2:** commit ด้วย `git commit --no-verify` (การพิมพ์ --no-verify = การจงใจอนุญาต)

## ⚠️ ห้ามทำ
- ❌ ห้ามแก้ guard/hook/manifest นี้เพื่อ "เอาไฟล์ออกจากล็อก" โดยไม่ได้รับอนุญาต
- ❌ ห้าม disable hook เพื่อเลี่ยงการถาม

> 🔴 ระบบ "ปก / คลิป / คิว / โต๊ะข่าว" ไม่ได้ถูกล็อก — แก้ได้ตามปกติ (ล็อกเฉพาะ "การเขียนข่าว")


## ➕ เสริมลิสต์ 10 ก.ค. 2569 (หลังปิดเคส #01641 — ไฟล์หัวใจที่เคยหลุดล็อก)
- src/lib/ai/claudeClient.js — ตัวเขียนหลัก (Claude) กฎเหล็ก+Safety ของตัวเขียนอยู่ที่นี่
- src/lib/ai/geminiClient.js — ตัวสกัดข่าว chain แรก
- src/lib/ai/safetyFilter.js — ตัวกรองคำเสี่ยง sanitizeOutput
- src/lib/correction/ (ทั้งโฟลเดอร์) — ด่านตรวจ/แก้หลังเขียน
- src/lib/utils/withTimeout.js — เพดานเวลา + ป้าย failedStep
- src/lib/services/queueService.js + src/app/api/queue/ — คิวงาน/worker/dedup
- src/lib/persistStore.js — ชั้นเก็บข้อมูล + fallback ไฟล์
- scripts/news-lock-guard.mjs — ตัวล็อกเอง (แก้ลิสต์ต้องยืนยัน)

บทเรียนที่มาของการเสริม: เคส #01641 พิสูจน์ว่ากฎแบนคำ/ด่านตรวจกระจายอยู่หลายไฟล์นอกลิสต์เดิม — แก้ผิดตัวเดียวเนื้อหาเพี้ยนได้ทั้งระบบ

---

## 🏆🔒 GOLDEN-LOCK — ระบบข่าวถูกล็อกไว้ที่ "ยุคปัง" (เพิ่ม 23 ส.ค. 69 — เจ้าของสั่ง)
- production ตั้งแต่ 23 ส.ค. 69 = ระบบข่าวยุคปัง 12 มิ.ย.–10 ก.ค. 69 (GitHub tag `news-golden-era-23aug69` = commit 02f0c34 · โค้ดข่าว = 5b566c2 ทุกไบต์ + `src/lib/ai/era/*`)
- **ห้ามแก้ไฟล์ระบบข่าวทุกไฟล์ในรายการด้านบน + `src/lib/ai/era/` + `data/prompt-library.json` + `scripts/golden-lock/`** เว้นเจ้าของอนุมัติเป็นรายครั้ง
- ด่าน 3 ชั้น: ① Claude PreToolUse `scripts/news-lock-guard.mjs` (ถามยืนยันก่อนแก้) ② git pre-commit (บล็อก commit) ③ **git pre-push → main** (บล็อก push ถ้า commit ที่แตะไฟล์ข่าวไม่มีรหัสอนุมัติ) — ติดตั้งด้วย `scripts\golden-lock\install-hooks.cmd`
- **รหัสอนุมัติ** (ใส่ในข้อความ commit เมื่อเจ้าของอนุมัติแล้วเท่านั้น): `[NEWS-LOCK-APPROVED by <ชื่อ> <วันที่>]`
- ตรวจว่ายังเป็นยุคปังครบทุกไฟล์: `node scripts/golden-lock/check-golden-lock.mjs` (หรือระบุ commit เช่น `origin/main`) · ลายนิ้วมือ 42 ไฟล์อยู่ `scripts/golden-lock/manifest.json`
- กู้ไฟล์ที่เผลอแตะ: `git checkout news-golden-era-23aug69 -- <ไฟล์>` · ก้อนกู้เต็ม: `C:\Users\User\GOLDEN-ระบบข่าวยุคปัง-23-8-69\00-อ่านก่อน-วิธีกู้ระบบข่าวยุคปัง.md`
