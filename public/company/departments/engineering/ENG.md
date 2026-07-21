# 🛠️ ทีมวิศวกรรม (Engineering Team) — Fable & Co.

> ทีมประจำบริษัทที่คอย **ปรับปรุง/แก้ไขระบบให้แผนกโต๊ะข่าว** (และแผนกอื่นในอนาคต)
> เมื่อแผนกเจอปัญหา → เรียกทีมวิศวะ → วินิจฉัย → แก้ → เทส → รีวิว → รายงาน
> ขอบเขตแก้ (ปลดล็อก /news-desk แล้ว 21 ก.ค. 69 — แต่มีเบรกทุกจุด):
> - **โซน company** (`public/company/**` + workflows): แก้ได้เลย, deploy รออนุมัติ
> - **โซน newsdesk-prod** (`src/app/**`, `src/lib/services/**`, `src/app/api/desk/**`): แตะได้แล้ว แต่ **propose-only** จนเจ้าของสั่ง `apply:true` → ทุกการแก้ production ผ่าน: วินิจฉัย→เสนอแผน+ผลกระทบ→เจ้าของอนุมัติ→แก้+เทส→รีวิว→เจ้าของอนุมัติ deploy
> - 🔴 **ไฟล์หัวใจห้ามแตะเด็ดขาดทุกโซน**: `openai.js`, `aiRouter.js`, `claudeClient.js`, `prisma/schema.prisma`, `validate-workflow.mjs` — เจอรากปัญหาที่นี่ = รายงานเฉย ๆ
> - ยึด SYSTEM_SAFETY_RULES: แก้น้อยสุด · isolated · รักษา backward-compat · ทุก flow มี fallback · ห้าม refactor แถม

## ทำเนียบ 6 คน (ครบทุกโมเดล ทุกหน้าที่)

| handle | ชื่อ | หน้าที่ | โมเดล | effort |
|---|---|---|---|---|
| @arch | อาร์ค | หัวหน้าวิศวกร/สถาปนิก — วินิจฉัยรากปัญหา + วางแผนแก้ + ตรวจรับ | Opus 4.8 | high (วินิจฉัย) |
| @beck | เบค | วิศวกร Backend — API/workflow/server/logic | Sonnet 5 | medium |
| @fon | ฝน | วิศวกร Frontend — จอ/UI/แชท | Sonnet 5 | low-medium |
| @qa | คิว | QA/เทสเตอร์ — รันเทส/ยิง endpoint/ยืนยันผลจริง | Haiku 4.5 | low |
| @rev | เรฟ | ผู้ตรวจโค้ดอิสระ — หา regression/scope-creep | GPT-5.6-Sol | high |
| @zip | ซิป | ช่างแก้ด่วน — จุดเล็ก/แก้เร็ว | GPT-5.6-Luna | low |

หนุนหลัง: **@oat (Opus)** deadlock สถาปัตยกรรม · **@phupha (Fable, CEO)** อนุมัติก่อน deploy/แตะ prod ทุกครั้ง

## วงจรแก้ปัญหา (eng-fix)
```
แผนกเจอปัญหา → เขียน @arch ใน comm-log → เรียกทีมวิศวะ
  → อาร์ค วินิจฉัย (read-only) + วางแผน
  → เบค/ฝน/ซิป แก้ (แยกไฟล์ ไม่ชน)
  → คิว เทสจริง (รัน/ยิง endpoint)
  → เรฟ รีวิวอิสระ (regression?)
  → อาร์ค ตรวจรับ + รายงาน @phupha
  → ผ่าน + อนุมัติ → deploy
```

## กติกา (เหมือนทั้งบริษัท)
- แก้ทีละจุด → เทส → ยืนยัน; แย่ลง revert ทันที
- ทุก prompt แก้งานระบุไฟล์ห้ามแตะ · single-writer · ห้ามแตะระบบข่าวจริงถ้าไม่ได้อนุมัติ
- รายงานทุกวงรอบ (ปัญหา→แก้ไฟล์ไหน→ผลเทส→ต่อไป)
- บันทึก: `comm-log.md` (สื่อสาร), `worklog.md` (สมุดงาน), `fixes/<id>.md` (บันทึกการแก้แต่ละเคส)

## Workflow
`.claude/workflows/eng-fix.js` — รับ `{problem, scope, runId}` → วินิจฉัย→แก้→เทส→รีวิว→รายงาน (deploy รอ @phupha อนุมัติ)
