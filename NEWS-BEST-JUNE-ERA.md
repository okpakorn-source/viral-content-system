# ⭐ ระบบเขียนข่าวที่ดีที่สุด — ยุค มิ.ย. 69 (ปักหมุด 8 พ.ย. 2569)

> เจ้าของเคาะ 8 พ.ย. 69: **ระบบชุดนี้คือระบบเขียนข่าวที่ดีที่สุด — ใช้แบบนี้ทุกอย่าง ห้ามแก้บั๊กในสมองเขียนข่าว**
> ("ถ้าบั๊กทำให้ผลลัพธ์ดี ไม่ต้องไปยุ่งกับมัน") · วันไหนระบบถูกเปลี่ยนแล้วอยากกลับมา = ทำตาม "วิธีย้อนกลับ" ด้านล่าง ไม่ต้องสืบใหม่

## จุดย้อนกลับ (ใช้อันไหนก็ได้)
| ชั้น | จุดปักหมุด |
|---|---|
| โค้ด (GitHub) | ป้าย `news-best-june-8nov69` บน `okpakorn-source/viral-content-system` |
| Vercel (ย้อนเร็วสุด) | deployment `dpl_BsFpYbNXivA6cddL4ui6CnUhaBwo` (commit b24e291e) → Vercel › Deployments › Instant Rollback / Promote |
| คลังพรอมต์ (Supabase) | snapshot `store_items` store `prompt-library__best-june-20261108` (73 ใบ) |
| คลังไวรัล (Supabase) | snapshot `store_items` store `viral_examples__best-june-20261108` (73 แถว) |
| สวิตช์ (Vercel env) | ตารางด้านล่าง |

Supabase project: `ajyhujuxvmdhypmnpfny` (okpakorn-source's Project) · Vercel project: `viral-content-system`

## ระบบนี้คืออะไร
- สมองเขียนข่าว = โค้ด commit `5b566c2` (8 ก.ค. 69) ทุกไบต์ — ยุคปัง 12 มิ.ย.–10 ก.ค. 69
  ไฟล์ข่าว 38 ไฟล์ต่างจาก 5b566c2 เฉพาะ path import → `src/lib/ai/era/*` (claudeClient, geminiClient, openai, modelConfig, safetyFilter) และ `src/lib/services/era/generationLogger.js`
- จุดที่ไม่ใช่ มิ.ย. (ตั้งใจ · ไม่แตะการเขียนข่าว):
  1. `autoFlowServiceText.js` ส่ง `generationLog.caseId` กลับ → บอทติดลิงก์ผล + ปุ่ม 👍👎📌
  2. `era/generationLogger.js` จองเลขเคสใหม่เมื่อชนกัน (คิวปัจจุบันเขียนพร้อมกันหลายงาน)
- ระบบรอบนอกเป็นรุ่นปัจจุบัน: คิว/worker/บอท Discord/persistStore/supabase.js/pipelineLogger
- โมเดล (ยืนยันยิงจริง 8 พ.ย. 69 ใช้ได้ทุกตัว): สกัด gemini-3.5-flash → แตกประเด็น gpt-5.5 → ผู้ช่วย gpt-5.4-mini → นักเขียน claude-opus-4-8 (effort medium) · สำรอง gpt-4o
- ลำดับงาน: สกัด → แตกประเด็น+มุม → วางอารมณ์ → ค้นข้อมูลเสริม → เลือกการ์ดสูตร (73 ใบ) → นักเขียนมุมละ 1 เวอร์ชัน
  (เห็นเนื้อข่าวฉบับสกัด ≤3,000 ตัวอักษรแบบ "อ้างอิงเท่านั้น" + กฎห้ามลอก ≤6 คำติดกัน + ครูไวรัล 2 โพสต์) → ด่านแก้หลังเขียน

## ผลที่วัดได้ (% ของโพสต์ที่เป็นวลี ≥10 ตัวอักษรตรงกับเนื้อดิบ · ข่าวคนละเรื่อง = 0.1%)
| ช่วง | ลอกดิบ |
|---|---|
| 12 มิ.ย.–31 ก.ค. 69 (ยุคนี้ของจริง) | ~21% |
| ส.ค.–28 ต.ค. 69 | 27–30% |
| 29 ต.ค.–8 พ.ย. 69 (F2X) | ~46% |
| 8 พ.ย. 69 หลังย้อน: เทส #07545 / พนักงาน #07546 | 15.2% / 7–11% |

## สวิตช์ Vercel (Production) ที่ทำให้ระบบนี้ทำงานถูก
| สวิตช์ | ค่า | เหตุผล |
|---|---|---|
| `QUEUE_TIMEOUT_RESCUE` | `cover-only` | **บังคับ** — route ยุค มิ.ย. ไม่รายงานสถานะคิวเอง (ไม่ตั้ง = ข่าวช้าค้าง 15 นาทีแล้วรันซ้ำ) |
| `TEXT_ONLY_MODE` | `0` | มิ.ย. รับลิงก์ด้วย |
| `ROUTINE_API` | `0` | Routine API ใช้กับ workflowEngine ยุค มิ.ย. ไม่ได้ |
| `CLAUDE_WRITE_MODEL` `CLAUDE_WRITE_EFFORT` `GEN_ANGLES` `GEN_PER_ANGLE` `SKIP_CORRECTION` | **ไม่ตั้ง** | ค่าในโค้ด = ค่า มิ.ย. (opus-4-8 · medium · 3 มุม · มุมละ 1 · ไม่ข้ามด่านแก้) |
| `RESEARCH_AGENT` | **ไม่ตั้ง** | ไม่มีรีเสิร์ชเอเจนต์ในยุค มิ.ย. |

สวิตช์ยุคหลัง (`F2X_WRITER`, `THREE_PARA_EDIT`, `LAYOUT_EDIT`, `ADMIN_VOICE_EDIT`, `EXTRACT_PRIMARY`, `RAW_FACT_COMPLETENESS_GATE`, `VIRAL_SHORTLIST`, `CARD_PICKER_MODEL`, …) ยังตั้งค้างได้ — โค้ดชุดนี้ไม่อ่าน (ไม่มีผล)
ตรวจเร็ว: `node scripts/check-golden-env.mjs <ไฟล์ env ที่ดึงจาก Vercel>`

## 🚫 บั๊กที่ตั้งใจเก็บไว้ (เจ้าของสั่ง — ห้ามแก้ เพราะเป็นส่วนหนึ่งของผลลัพธ์ชุดนี้)
- `safeCorrectionService.js` ขั้น L3B: ผล AI เกลาคำเสี่ยงถูกทิ้งทุกครั้ง (ตรวจ `typeof result === 'string'`) → ถอยไปแทนคำตรงๆ
- `era/safetyFilter.js` แทนคำเสี่ยงแบบไม่ดูขอบคำ
- gpt-4o ตัวสำรองถูกขอคำตอบยาวเกินเพดานรุ่น · ข่าวว่าง/สั้นยังนับสำเร็จ · DNA ล้ม = เสียบ "ดราม่าสังคม" · Gemini timeout ผิดชั้น
- route ยุค มิ.ย. ไม่ส่ง errorType ในบาง error (worker เติม PROCESS_API_FAILED ให้)
แก้อะไรในสมองเขียนข่าวต้องรันชุดทดสอบเนื้อดิบ มิ.ย. ก่อน-หลัง แล้วเทียบ % ลอกดิบ + ให้พนักงานอ่านแบบไม่บอกเวอร์ชัน

## วิธีย้อนกลับมาระบบนี้
1. **โค้ด** — เร็วสุด: Vercel Instant Rollback ไป deployment ด้านบน · ถาวร: เอาโค้ดจากป้ายขึ้น main
   `git checkout -B restore-best news-best-june-8nov69 && git push origin restore-best:main --force-with-lease`
   (หรือ `git revert` ทุก commit หลังป้าย) · Railway บอทไม่ต้องแตะ
2. **สวิตช์** — ตั้งตามตารางด้านบน แล้ว Redeploy 1 ครั้ง
3. **คลัง** — รันใน Supabase SQL (สำรองของที่อยู่ตอนนั้นก่อน):
   ```sql
   begin;
   insert into public.store_items (id, store_name, data, created_at, updated_at)
   select id || '__bk' || to_char(now(),'YYYYMMDD'), 'prompt-library__backup-' || to_char(now(),'YYYYMMDD'), data, created_at, updated_at
   from public.store_items where store_name = 'prompt-library' on conflict (id) do nothing;
   delete from public.store_items where store_name = 'prompt-library';
   insert into public.store_items (id, store_name, data, created_at, updated_at)
   select left(id, length(id) - length('__bestjune')), 'prompt-library', data, created_at, updated_at
   from public.store_items where store_name = 'prompt-library__best-june-20261108';
   -- คลังไวรัล: (สำรอง viral_examples ปัจจุบันก่อนถ้ามีแถวใหม่) แล้วคืน 73 แถว
   delete from public.viral_examples;
   insert into public.viral_examples
   select (jsonb_populate_record(null::public.viral_examples, data)).*
   from public.store_items where store_name = 'viral_examples__best-june-20261108';
   select (select count(*) from public.store_items where store_name='prompt-library') prompt_cards,
          (select count(*) from public.viral_examples) viral_rows;  -- ต้องได้ 73 / 73
   commit;
   ```
4. **ตรวจ** — ส่งข่าว 1 ข่าว: generation_logs ไม่มี `pipeline_info.f2x` · pipeline_logs ขั้น extract = gemini, breakdown = gpt-5.5, analyze = claude · % ลอกดิบราว 10–21%

## ถ้าต้องกลับไประบบก่อนวันที่ 8 พ.ย. (F2X)
โค้ด commit `eaf2229f` · คลัง: `scripts/june-restore/undo-libraries.sql` (snapshot `*__backup-20261108` = 254 ใบ / 129 แถว) · สวิตช์: ลบ `QUEUE_TIMEOUT_RESCUE`, `TEXT_ONLY_MODE`, คืน `ROUTINE_API` ค่าเดิม
