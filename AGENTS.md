# Viral Content System — AI Agent Rules

## ⚠️ อ่านก่อนทำงานทุกครั้ง

> **กฎเหล็กของโปรเจกต์นี้อยู่ที่: `SYSTEM_SAFETY_RULES.md`**
> ห้ามแก้ไฟล์ใดๆ ก่อนอ่านและเข้าใจ SYSTEM_SAFETY_RULES.md ครบทุกข้อ

Next.js 15+ (App Router) + React 19 — AI Pipeline สร้างข่าวไวรัลสำหรับ Facebook

## กฎบังคับก่อนแก้โค้ดทุกครั้ง

### 1. อ่าน Next.js Docs ก่อนเสมอ
This version has breaking changes — APIs, conventions, and file structure may differ from training data.
Read `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

### 2. Architecture ของระบบ
```
URL/Text Input
  → /api/auto (orchestrator)
    → /api/extract (scrape + OCR)
    → /api/summarize?mode=extract (AI news extraction)
    → /api/summarize?mode=breakdown (issue analysis)
    → /api/summarize?mode=blueprint (emotional structure)
    → /api/research-search (Serper Google search)
    → /api/summarize?mode=analyze (Classic + Enhanced generate)
  → src/app/content/new/page.js (UI + WorkflowTracker)
```

### 3. AI Provider Routing
- **ความจริงปัจจุบัน = `src/lib/ai/modelConfig.js`** (อัปเกรดชุดใหญ่ 8 มิ.ย. 69 — ข้อมูล GPT-4o/Claude/Gemini ที่เคยเขียนไว้ตรงนี้ตกรุ่นแล้ว)
- งานหนัก (วิเคราะห์ข่าว/breakdown/เขียน/ตัดสินปก): **gpt-5.5** → fallback **gpt-4o**
- งานเร็ว/ประหยัด (คีย์เวิร์ด/JSON/แคปชั่น): **gpt-5.4-mini**
- breakdown จูน 10 ก.ค. 69: gpt-5.5 inner timeout 200s + maxTokens 24000 (reasoning model — เพดานต่ำ=ตอบว่างเปล่า) → fallback gpt-4o มี timeout 60s เอง, outer 300s ทั้งสาย text/URL

### 4. Prompt System
- Built-in prompts: `src/lib/ai/promptStore.js`
- User Library: Supabase `store_items` table → fallback: `data/prompt-library.json`
- **ห้ามลบ fallback** — Supabase อาจว่างได้เสมอ

### 5. Database
- **Primary**: Supabase (PostgreSQL) — `src/lib/supabase.js`
- **Fallback**: SQLite via Prisma — `prisma/schema.prisma`
- **In-memory**: Map cache ใน `src/lib/persistStore.js`

### 6. กฎห้ามแตะ
- ห้าม rewrite ไฟล์ใหญ่ทั้งหมด — แก้ incremental เท่านั้น
- ห้ามลบ fallback logic ใดๆ
- ห้าม expose API key ใน log
- ทุก API route ต้องมี try/catch + return error JSON
- ก่อนแก้ให้ backup ไฟล์ (cp file file.bak) แต่ commit โดยไม่ include .bak
- 🔴 **ห้าม AI เจน/สังเคราะห์/วาดพิกเซลภาพในท่ออัตโนมัติทุกท่อ (ปก/ข่าว/คลังรูป)** —
  ห้ามเรียก generative model กับภาพ (Real-ESRGAN/GFPGAN/inpaint/outpaint/img2img ฯลฯ)
  แม้อ้างว่า "upscale ล้วน" ก็ห้าม (GAN วาดรายละเอียดใหม่ = หน้าคนออกมาเหมือนภาพเจน)
  ภาพบนปกต้องเป็นต้นฉบับ 100% — จัดการได้เฉพาะ crop/resize interpolation ธรรมดา (sharp)
  ข้อยกเว้นเดียว: เครื่องมือ /photo-enhance ที่ผู้ใช้กดเองต่อภาพ (ห้ามต่อเข้าท่ออัตโนมัติ)
  บทเรียน: 10 ก.ค. 69 hero ถูก Real-ESRGAN อัตโนมัติจนผู้ใช้เห็น "เหมือน AI เจนใหม่" (MCV-mrevr836xbl)

### 7. Error Convention
```js
// ใช้ errorType ที่ชัดเจนเสมอ
return NextResponse.json({
  success: false,
  error: 'Human readable message',
  errorType: 'SNAKE_CASE_ERROR_TYPE',
}, { status: 4xx|5xx });
```

### 8. Validate ก่อน Commit
```bash
node scripts/validate-workflow.mjs   # ต้องผ่าน 100%
npx next build                        # ต้องไม่มี error
```

### 9. ห้ามแก้ไฟล์เหล่านี้โดยไม่ได้รับอนุญาต
- `prisma/schema.prisma` (DB schema)
- `src/lib/ai/openai.js` (core AI client)
- `src/lib/ai/aiRouter.js` (model routing logic)
- `scripts/validate-workflow.mjs` (CI validator)

### 10. Project Knowledge (Latest Updates)
- **Database Fallback Sync**: `persistStore.js` (e.g., prompt-library) uses Supabase as primary and local JSON as fallback. When executing `add()` or `addMany()` on Supabase, the system MUST also sync the data to the local file cache (`data/prompt-library.json`) immediately.
- **AI Hallucinations (Gender)**: The AI has a bias to guess gender based on Thai names (e.g., "ทราย" = "เธอ"). `promptStore.js` and `promptStoreText.js` have strict rules forbidding gender guessing. If gender is unspecified, the AI must use the person's name or a neutral term like "เจ้าตัว".
- **Backups**: A full system backup (excluding `node_modules` and `.next`) was created at `C:\Users\User\สำรองล่าสุดเกือบสมบูรณ์25-5-22.30-Folder1` and `Folder2`.

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data.
Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
