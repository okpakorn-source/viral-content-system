# Viral Content System — AI Agent Rules

## ระบบนี้คืออะไร
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

### 3. AI Provider Routing (src/lib/ai/aiRouter.js)
- **extract**: Gemini Flash (fast + cheap)
- **breakdown**: GPT-4o (structured JSON)
- **write**: Claude Sonnet → fallback GPT-4o
- **general**: GPT-4o

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

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data.
Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
