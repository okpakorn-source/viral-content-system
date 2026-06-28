# 🔒 ไฟล์ที่ถูกล็อก — ระบบเขียนข่าวอัตโนมัติ

> ตั้งล็อก 28 มิ.ย. 2026 (ผู้ใช้สั่ง): **ห้ามแก้ไฟล์ระบบเขียนข่าวอัตโนมัติแม้แต่บรรทัดเดียว
> โดยไม่ได้รับอนุญาต/ยืนยันจากเจ้าของก่อน** — ไม่ว่าจะแก้จากส่วนไหน/ใครก็ตาม

## ไฟล์ที่ถูกล็อก (ระบบเขียนข่าว เท่านั้น)
- `src/lib/services/autoFlowService.js`
- `src/lib/services/autoFlowServiceText.js`
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
