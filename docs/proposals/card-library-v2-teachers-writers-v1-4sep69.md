# ครูตัวอย่างชุด writers-v1 (Nisada Jaraket · Po Ny) — ปิดครูไวรัลชุดเดิมด้วยสวิตช์ · 4 ก.ย. 69 (WF5 · Fable)

> คำตัดสินเจ้าของ 4 ก.ย. 69 ~12:45: ครูไวรัลชุดเดิม 202 ใบมีงาน AI ของพนักงานปน 70–80% → ปิดชุดเดิม ใช้เฉพาะชุดใหม่ที่คัดจากงานจริงของนักเขียนเก่ง 2 คน · ~13:00 แก้เกณฑ์เป็น ≥30,000 ไลก์ "เอาเท่าที่ได้ก่อน" (ชุด 12 วัน) · ชุด 60 วันจะเติมภายหลังด้วยขั้นตอนเดียวกัน
> สถานะ: **Gate W1 ผ่าน (5/6) · โค้ด+ข้อมูล+เทสอยู่ใน worktree ยังไม่ commit · ตาราง viral_examples ยังไม่ถูกแตะ (เจ้าของเป็นคน --apply) · ทุกอย่างอยู่หลังสวิตช์ ปิด = ระบบเดิมไบต์ต่อไบต์**

## 1) ชุดครู `data/teachers-writers-v1.json` (28 ใบ)

| เรื่อง | ค่า |
|---|---|
| แหล่ง | โพสต์เพจ รวมไอจีดารา 466 โพสต์ (23 ส.ค.–3 ก.ย. 69) เก็บ 3 ก.ย. 69 → `C:\tmp\news-r233-run\writer-samples\posts-igdara-3sep69.json` |
| เกณฑ์คัด | author ∈ {Nisada Jaraket, Po Ny} · reactions ≥ 30,000 · content > 200 ตัวอักษร · ไม่ซ้ำเนื้อ → **28 ใบ** (Nisada 17 · Po Ny 11) · ไลก์ 33,000–210,000 |
| ชั้นครูใหญ่ | reactions ≥ 80,000 → `tier: 'master'` 4 ใบ (แจ๊ะ 210k · ต้า 150k · ต้า-Po Ny 110k · 3 เดือน 84k) — rank-v2 เรียงไลก์จริงมาก→น้อยอยู่แล้ว ชั้นนี้จึงได้อันดับสูงสุดโดยกลไกเดิม (ไม่ต้องเพิ่มกติกา) |
| id | uuid รูป v4 คงที่จาก `sha256('igdara-writers-v1:' + sourceUrl)` (สูตรเดียวกับ deriveTeacherId ของ import-new-teachers.mjs · รันกี่ครั้งก็ id เดิม) |
| ป้ายชุด | ตาราง viral_examples **ไม่มีคอลัมน์ source/author** (ตรวจจาก backup 3 ก.ย.: id, category, title, content, source_url, engagement_likes, engagement_shares, engagement_comments, tags, writing_notes, uploaded_by, created_at) → ใช้ `tags: ['igdara-writers-v1', 'author:<ชื่อ>', 'tier:<master|senior>']` เป็นป้าย · ไฟล์ข้อมูลมี `source/author/sourceUrl/tier` ไว้ด้วยสำหรับคนอ่าน |
| เนื้อ | `content` ยกตรงตัวจากโพสต์ (ตัดเฉพาะช่องว่างหัวท้าย · \r\n→\n) **ห้ามแก้** · `title` = 80 ตัวแรก (แบบแถวเดิม) |
| หมวด (category) | Fable จัดตามแก่นเรื่อง (ไม่ใช่อาชีพตัวละคร): ช่วยเหลือกัน 12 · ดราม่าครอบครัว 5 · สู้ชีวิต 3 · ข่าวกีฬา 2 · พลิกชีวิต 2 · ข่าวเศร้า 2 · ข่าวเตือนใจ 1 · ข่าวบันเทิง 1 — **หมวดที่ไม่มีครูเลย** (การเมือง · ความรักสัตว์ · ชาวบ้าน · คนดังตกต่ำ · nostalgia · moral conflict): ระบบถอยไปใช้ครูใกล้เคียง "ในพูลเดียวกัน" (ข้ามหมวด) ไม่ถอยไปครูชุดเดิม |
| บัตรลักษณะ + โน้ต | workflow `wf5-essence-cards` (4 มือเขียน Fable × 7 ใบ → ผู้ตรวจความสม่ำเสมอ 1 คน → มือแก้): `essence {emotion, structure, themes, tone}` รูปแบบเดียวกับ data/viral-essences.json · คำศัพท์ themes/emotion/tone **ทั้งหมดอยู่ในคลังคำเดิม** (essence-vocab-freq-2sep69.json) เพื่อให้ตัวคัดโผ (นับคำตรง) ทำงานกับข่าวเหมือนครูเดิม · `writing_notes` ย่อหน้าเดียว 366–399 ตัว ขึ้นต้น "ด้านดีของโพสต์นี้คือ" · ผู้ตรวจ 13 ข้อ (0 high · 7 medium · 6 low) แก้ครบ |
| เติมครูภายหลัง | ทำซ้ำ 3 ขั้น: `wf5/build-base.mjs` (คัด+id) → workflow บัตรลักษณะ (สคริปต์ `wf5-essence-cards-*.js`) → `wf5/assemble.mjs` → ได้ไฟล์ใหม่ทั้งชุด (ใบเดิม id เดิม) → `import-writer-teachers.mjs` กันซ้ำ insert เฉพาะใบใหม่ |

## 2) สคริปต์นำเข้า `scripts/import-writer-teachers.mjs` (+ `tests/import-writer-teachers.test.mjs`)
คัดลอกกติกาความปลอดภัยจาก import-new-teachers.mjs: dry-run ค่าเริ่มต้น · `--apply` = backup ตาราง+ไฟล์ 2 ไฟล์ → insert 8 คอลัมน์ (id, category, title, content, source_url, writing_notes, engagement_likes, tags) → เติม data/viral-likes-real.json byId `{likes, matchedBy:'igdara-writers-v1'}` + data/viral-essences.json (เติมท้ายอย่างเดียว · round-trip ไบต์เดิม) → manifest `C:\tmp\news-r233-run\writer-teachers-import-manifest.json` · `--rollback` คืนทั้งชุด · `--verify` อ่านอย่างเดียวหลังนำเข้า · ยาม `TEACHER_IMPORT_APPLY=0`
(ผล dry-run และเทส: ดู §6)

## 3) สวิตช์ (ทะเบียน newsSwitches.js · เอกสาร docs/NEWS-SWITCHES.md regen)
| สวิตช์ | ค่า | ผล |
|---|---|---|
| `TEACHER_POOL` | ไม่ตั้ง/ว่าง | พูลเดิมทุกใบ = โค้ดเดิมทุกไบต์ (พิสูจน์ด้วยเทสพาริตี้เทียบ HEAD แบบ fuzz) |
| | `writers-v1` | ดึงทั้งคลังแล้วกรองเฉพาะแถว tags มี `igdara-writers-v1` · แคชแยกก้อน · ชั้นเฉพาะกิจ/rank-v2/ไลก์จริง/บัตร/สมุดประวัติ ทำงานเหมือนเดิมบนพูลนี้ · หมวดไม่มีครู → ทั้งพูล (ข้ามหมวด) · พูลว่าง (ยังไม่ --apply) → **ไม่มีครู + log ดัง ไม่ถอยไปชุดเดิม** |
| `TEACHER_POOL_FILE` | พาธไฟล์ (เฉพาะ `CARD_LIBRARY_LAB=1` · ไม่ใช่ Vercel) | ห้องแล็บ: อ่านครูจากไฟล์แทน Supabase · ไลก์/บัตรจากไฟล์ถึง rank-v2 · ไม่จดสมุดประวัติ · Vercel = เพิกเฉย + console.error (fail-closed) |

## 4) Gate W1 — แบบทดลอง (ห้องแล็บ ไม่แตะ DB ครู)
- ข่าว 6: ab-news 5 (ดราม่า · น้ำดี · บันเทิง · สู้ชีวิต · เศร้า) + กีฬา (สนุกเกอร์คนพิการแชมป์โลก จาก card-news) × แขน 2 (old = ครูเดิม Supabase · writers = TEACHER_POOL_FILE) × 3 ฉบับ = 36 รอบ · GEN_ANGLES=1 (1 ฉบับ/รอบ)
- **ตรึงตัวแปรปน** (gate1-extra-stats.md): รันในโปรเซสเดียว (`wf5/w1/run-one.mjs` เรียก POST route ตรง แบบ angle2-field) + loader hook `wf5/w1/w1-hooks.mjs` แคชผล performSummarize โหมด extract/breakdown/blueprint และ getTopPrompts ลงไฟล์ (คีย์ = sha ของอินพุต) → ทุกแขน/ทุกฉบับได้ Stage-1 + การ์ดชุดเดียวกัน · คลังการ์ด = overlay A.json (สำเนา store เดิม) ทั้งสองแขน · ไม่บันทึกคลังข่าว (W1_NO_ARCHIVE) · ต่างกันเฉพาะ "ครูตัวอย่าง" + การสุ่มของตัวเขียน
- กรรมการ: Fable 3 เลนส์ (editor · reader · factcheck) ซองปิดชื่อ 6 ฉบับ/ข่าว (Fisher–Yates seed 20260904) · เกณฑ์ `wf5/w1/judge-prompts/house.md` = STYLE-PROFILE §5.3 (5 มิติ · ห้ามหักเมื่อต้นฉบับไม่มี · fidelity มาก่อน) + **จัดอันดับเทียบคู่ครบ 6** · best-of-3 ต่อแขน = ฉบับอันดับสูงสุดของแขน · ข่าวชนะ = เสียงข้างมาก 3 เลนส์
- เกณฑ์ผ่าน: writers ชนะ ≥4/6 ข่าว · fidelity เฉลี่ยไม่ตกเกิน 0.5 และ factcheck ไม่ตก ≥2 ในข่าวใด · ไม่มีข่าวที่ best-of-3 แพ้ ≥4 คะแนนใน ≥2 เลนส์

## 5) ผล Gate W1 (4 ก.ย. 69 · 36 ฉบับ · กรรมการ Fable 18 คน · ผู้ตรวจความครบ ok)
**✅ ผ่านเกณฑ์: writers ชนะ 5/6 ข่าว · fidelity เฉลี่ยไม่ตก (gap −0.04) · ไม่มีข่าวที่แย่ลงชัด** — ข่าวที่แพ้: สู้ชีวิต (old ชนะ 2/3 เลนส์ · ทั้งสองแขน fidelity ต่ำ 3–6/10 และมีธง fabrication: old 0–3 · writers 2–5 → ข่าวต้นฉบับยาว/ตัวเลขเยอะ ทั้งสองแขนแต่งเติม ชุดใหม่แต่งมากกว่าเล็กน้อย — ควรจับตาหมวดสู้ชีวิตตอนใช้จริง)

รัน: ข่าว 6 × แขน 2 × 3 ฉบับ = 36 รอบ (ตัวเขียน Opus 4.8 · ~3 นาที/รอบ · ค่า API ประมาณ ~$11) · Stage-1/การ์ดตรึงด้วยแคชไฟล์ (การ์ดใบเดียวกันต่อข่าวทั้ง 6 ฉบับ · แคชติด 3/3 ทุกรอบหลัง seed) · แขน writers อ่านครูจากไฟล์ 28 ใบ (โผ 8 · rank-v2) · ทั้งสองแขนไม่จดสมุดประวัติ (หลังแก้ hook — ดู §6) · ความยาวเฉลี่ย old 919 คำ · writers 938 คำ
ไฟล์: `C:\tmp\news-r233-run\wf5\w1\` — results/ (36) · packet-w1.json + key · judging-w1/ (18) · w1-verdict.json · aggregate.out · examples-owner.md (คู่ก่อน/หลัง 2 ข่าว)

```
=== Gate W1 ✅ ผ่าน · writers ชนะ 5/6 (เสมอ 0) · fidelity gap เฉลี่ย -0.04 (ไม่ตก) · แย่ลงชัด ไม่มี ===

กีฬา-snooker: writers (เลนส์ 3/3) · best-of-3 gap เฉลี่ย 5 · fid gap 0.67
   editor    writers old C#2 29/50 fid6 fab0 | writers D#1 34/50 fid9 fab0 | mean 26 vs 28.3 · fid 5 vs 5.67 · อันดับ1=writers
   reader    writers old C#3 30/50 fid7 fab0 | writers F#1 34/50 fid7 fab0 | mean 26 vs 31.7 · fid 5.67 vs 6.67 · อันดับ1=writers
   factcheck writers old C#2 29/50 fid7 fab0 | writers D#1 35/50 fid9 fab0 | mean 26 vs 29.7 · fid 5.67 vs 6 · อันดับ1=writers

ดราม่า-05242: writers (เลนส์ 2/3) · best-of-3 gap เฉลี่ย -0.3 · fid gap -0.11
   editor    writers old A#2 28/50 fid9 fab0 | writers F#1 29/50 fid9 fab0 | mean 26.7 vs 27 · fid 8 vs 8 · อันดับ1=writers
   reader    writers old A#2 32/50 fid9 fab0 | writers F#1 31/50 fid9 fab0 | mean 30 vs 28.7 · fid 8 vs 8 · อันดับ1=writers
   factcheck old     old A#1 30/50 fid9 fab0 | writers D#2 29/50 fid9 fab0 | mean 28 vs 27.3 · fid 8 vs 7.67 · อันดับ1=old

น้ำดี-05247: writers (เลนส์ 2/3) · best-of-3 gap เฉลี่ย 0.3 · fid gap 0.67
   editor    old     old B#1 31/50 fid9 fab0 | writers F#2 30/50 fid9 fab0 | mean 28.7 vs 27 · fid 7.33 vs 8 · อันดับ1=old
   reader    writers old B#2 32/50 fid9 fab0 | writers F#1 33/50 fid9 fab0 | mean 30 vs 30.7 · fid 7.33 vs 8 · อันดับ1=writers
   factcheck writers old B#2 33/50 fid9 fab0 | writers F#1 34/50 fid9 fab0 | mean 30.3 vs 30 · fid 7.33 vs 8 · อันดับ1=writers

บันเทิง-05233: writers (เลนส์ 2/3) · best-of-3 gap เฉลี่ย 2 · fid gap -0.67
   editor    writers old E#2 33/50 fid7 fab0 | writers C#1 36/50 fid8 fab0 | mean 31 vs 29.7 · fid 7.67 vs 6.67 · อันดับ1=writers
   reader    writers old E#2 36/50 fid7 fab0 | writers C#1 37/50 fid8 fab0 | mean 35 vs 33 · fid 8 vs 7.33 · อันดับ1=writers
   factcheck old     old D#1 34/50 fid9 fab0 | writers C#2 36/50 fid8 fab0 | mean 32.7 vs 31.7 · fid 7.33 vs 7 · อันดับ1=old

สู้ชีวิต-05243: old (เลนส์ 1/3) · best-of-3 gap เฉลี่ย -1 · fid gap -0.77
   editor    writers old B#2 24/50 fid4 fab3 | writers F#1 24/50 fid3 fab5 | mean 20.3 vs 20 · fid 3.33 vs 2.67 · อันดับ1=writers
   reader    old     old B#1 30/50 fid6 fab0 | writers F#2 30/50 fid4 fab2 | mean 23 vs 24.3 · fid 4 vs 3.67 · อันดับ1=old
   factcheck old     old B#1 31/50 fid8 fab0 | writers F#2 28/50 fid4 fab2 | mean 24.7 vs 24.3 · fid 5 vs 3.67 · อันดับ1=old

เศร้า-05116: writers (เลนส์ 2/3) · best-of-3 gap เฉลี่ย 1.3 · fid gap 0
   editor    writers old C#2 34/50 fid9 fab0 | writers B#1 37/50 fid10 fab0 | mean 31.7 vs 32.7 · fid 9.33 vs 9.33 · อันดับ1=writers
   reader    writers old C#2 37/50 fid9 fab0 | writers B#1 39/50 fid9 fab0 | mean 33.3 vs 33 · fid 9 vs 9 · อันดับ1=writers
   factcheck old     old C#1 38/50 fid9 fab0 | writers B#2 37/50 fid9 fab0 | mean 35 vs 33.7 · fid 9 vs 9 · อันดับ1=old
```

## 6) เทส / หักล้าง
| ชุด | ผล |
|---|---|
| `tests/import-writer-teachers.test.mjs` | **18/18** — pure functions ทุกตัว · ยาม TEACHER_IMPORT_APPLY=0 มาก่อน IO (พิสูจน์ด้วย client ระเบิด) · dry-run spawn (offline) 2 แบบ · manifest/verify · rollback ด้วย mock client (ลบเฉพาะ id ในชุดที่มีป้าย · id นอกชุด = ปฏิเสธก่อนแตะ · manifest ถอยแล้ว = ไม่รับซ้ำ · คืนไฟล์ไบต์ตรง backup) |
| `tests/teacher-pool-writers-v1.test.mjs` | **56/56** — ชุด ก พาริตี้ HEAD 23 เคส (fuzz env · เรียกครั้งเดียว) + ชุด X 14 เคส (หลายเรียกในโปรเซสเดียว/แคชต่อหมวด · PostgREST 500 · ไม่มี Supabase env · ตารางว่าง · fail-closed Vercel · สลับ env ระหว่างเรียก) เทียบ `git show HEAD` ทุกไบต์ (บล็อก · คำขอ PostgREST · log · สมุดประวัติ) · ชุด ข พูลป้าย (รวม ข6ข แคชโหมดจับคู่ score แยกพูล/แล็บ) · ชุด ค ห้องแล็บไฟล์ |
| `tests/news-switch-registry.test.mjs` | 10/10 (TEACHER_POOL · TEACHER_POOL_FILE · VERCEL · VERCEL_ENV ลงทะเบียนตรงจุดอ่านจริง) |
| dry-run จริง | `TEACHER_IMPORT_APPLY=0 node scripts/import-writer-teachers.mjs` → exit 0 · ตาราง 210 แถว · ป้ายเดิม 0 · insert 28 (master 4 · senior 24) · เติม likes 28 · บัตร 28 · ข้าม 0 (`C:\tmp\news-r233-run\wf5\dry-run-4sep69.txt`) |

**workflow โค้ด 2 เลน** (`wf_8ee6b458-da5` · เขียน→ตรวจไขว้→แก้→ยืนยัน · Fable): เลน B ผ่าน verify (0 high) · เลน A ผู้ตรวจพบ high 1 (เทสผูกบรรทัด select ของไฟล์ที่เลน B แก้ → แดงข้ามเลน) + medium 2 — ตัวแก้ถูกขัดจังหวะ Fable ผู้บัญชาการแก้เองครบ (เทส 2 หาสตริงคอลัมน์ตรงๆ + เทียบ HEAD · runApply รับ `{env, client}` · สรุปนับเฉพาะใบ insert · `assertInsertReturned` pure · `TEACHER_IMPORT_OFFLINE=1` · เทส `--verbose`)

**ทีมหักล้าง 3 มุม** (`wf_96e7223a-16f` · Fable effort high · 391k โทเคน · 13 นาที · ทดลองใน scratch ห้ามแก้ repo): **high 0 · medium 5 · low 5** — แก้ medium ครบ:
| มุม | ข้อค้นพบ | แก้ |
|---|---|---|
| ปิดสวิตช์เท่าเดิม (pass) | ทุบกลายพันธุ์ 18 ตัว — โค้ดไม่พบเส้นต่างจาก HEAD · แต่ชุด ก เรียกครั้งเดียวต่อโปรเซส จึงจับ regression ของ `_poolCacheKey` ตอนปิดไม่ได้ (medium) · ไม่มีเคส error/ว่าง/Vercel แบบพาริตี้ (low) | ย้ายชุด X 14 เคสของผู้หักล้างเข้าเทสจริง (+`viralStatus` ใน mock) |
| ครูใหม่ถูกใช้จริง (fail→แก้) | `_matchCache` (VIRAL_MATCH_MODE=score/ai) คีย์ไม่มีพูล → สลับพูลในโปรเซสเดียวได้ครูชุดเดิมหลุด (medium) · **harness W1 แขน old จดสมุดประวัติครูลง store_items จริง** (medium) · โหมดไม่กว้าง หมวดที่พูลมีครู 1 ใบได้ตัวอย่าง 1 ใบ (low) | คีย์ต่อท้าย `\|pool:…\|lab:…` เฉพาะตอนเปิด (ปิด = คีย์เดิม) + เทส ข6ข · hook 3 ใน `w1-hooks.mjs` ข้าม `_recordPickHistory` ทั้งสองแขนเมื่อ W1_NO_ARCHIVE=1 + จด `historySkipped` ในผล · ทะเบียน TEACHER_POOL ระบุ "ควรเปิดคู่ VIRAL_SHORTLIST=1" (production ตั้งอยู่แล้ว) |
| นำเข้า/ถอยปลอดภัย (fail→แก้) | `--apply` หลัง `--rollback` ยังชี้ backupDir เก่า (medium) · `--rollback` ซ้ำได้ทับไฟล์ด้วย backup เก่า (medium) · rollback ไม่พิสูจน์ว่า id อยู่ในชุด (medium) · คืนไฟล์ทั้งไฟล์ทำคีย์ที่งานอื่นเติมหาย (low) · dry-run offline หลัง rollback อ่าน manifest เก่า (low) · ชั้น IO rollback ไม่มีข้อสอบ (low) | `isUsablePriorManifest` (rolled-back = วงจรใหม่) · runRollback ปฏิเสธ phase rolled-back · `assertRollbackIds` (ทุก id คำนวณซ้ำได้จาก sourceUrl ในชุด/ไฟล์ชุด) · select id,tags ก่อน ลบเฉพาะแถวมีป้าย แถวไม่มีป้าย = รายงานไม่ลบ · `runRollback(manifest, {client, root})` + เทส 15–18 ด้วย mock · ข้อจำกัด "คืนทั้งไฟล์" ระบุในหัวสคริปต์ + เตือนตอนรัน |

⚠️ **ผลข้างเคียงที่เกิดขึ้นแล้ว (ต้องแจ้งเจ้าของ):** W1 seed 5 รอบแรก (แขน old · 10:13–10:29 UTC 4 ก.ย.) รันก่อนแก้ hook → จดสมุดประวัติครูลง `store_items` (store `viral_pick_history`) จริง **7 แถว** (id `vpick_1788516933008_tqn501` … `vpick_1788517704066_2cyexb` · รายการเต็ม `wf5/w1/seed-history-writes.json`) — ไม่แตะตารางครู/คลังข่าว · ผลกระทบ: นับเป็น "การใช้" ของครูเดิม 7 ครั้งในกติกา cap 8/7 วัน · ผมไม่ลบเอง (กติกาห้ามเขียน DB) เจ้าของลบได้ด้วย id เหล่านี้หรือปล่อยหมดอายุ 7 วัน

## 7) คำสั่งสำหรับเจ้าของ
ทุกคำสั่งรันใน `C:/tmp/news-r233` · ยังไม่ push · commit ทีละเลน (ไฟล์ทะเบียนสวิตช์ `newsSwitches.js` เป็นไฟล์ร่วม WF3/WF4/WF5 — ใช้ patch แยก hunk ที่ตรวจแล้วว่า apply บน HEAD ผ่านและรวมสามแผ่นแล้ว == worktree)

**เลน 1 — ข้อมูลครู + สคริปต์นำเข้า (ไม่ติดล็อก)**
```
git add data/teachers-writers-v1.json scripts/import-writer-teachers.mjs tests/import-writer-teachers.test.mjs docs/proposals/card-library-v2-teachers-writers-v1-4sep69.md
git commit -m "feat(teachers): ชุดครู writers-v1 28 ใบ (Nisada/Po Ny ≥30k ไลก์) + สคริปต์นำเข้า dry-run/apply/rollback/verify [NEWS-LOCK-APPROVED by เจ้าของ 3 ก.ย. 69]" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HnfFN7Z7CEsjVcscxhhGYm"
```

**เลน 2 — สวิตช์ TEACHER_POOL / TEACHER_POOL_FILE** (`viralFewshot.js` อยู่ในรายชื่อไฟล์ล็อกของ hook pre-commit → hook สั่งเองว่าเมื่อเจ้าของอนุมัติให้ใช้ `--no-verify` + รหัสในข้อความ · Fable ไม่รันเอง)
```
git add src/lib/services/viralFewshot.js tests/teacher-pool-writers-v1.test.mjs
git apply --cached C:/tmp/news-r233-run/wf5/commit/newsSwitches-wf5.patch
git diff --cached --stat        # ต้องเห็น 3 ไฟล์: viralFewshot.js · newsSwitches.js (+31) · teacher-pool-writers-v1.test.mjs
git commit --no-verify -m "feat(teachers): สวิตช์ TEACHER_POOL / TEACHER_POOL_FILE เลือกพูลครูตัวอย่าง (ปิด = โค้ดเดิมไบต์ต่อไบต์ · แล็บอ่านครูจากไฟล์) [NEWS-LOCK-APPROVED by เจ้าของ 3 ก.ย. 69]" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01HnfFN7Z7CEsjVcscxhhGYm"
```
(patch อีก 2 แผ่นในโฟลเดอร์เดียวกัน: `newsSwitches-wf3.patch` = 6 สวิตช์ WF3 สำหรับเลน WF3 · `newsSwitches-wf4.patch` = CASE_DIAG — WF4 พัก ห้ามใช้)

**เลน 3 — เอกสาร regen (ทำหลังเลน WF3 ทุกสายและเลน 2 เข้าแล้ว เพื่อให้เอกสารตรงทะเบียนที่ commit)**
```
node C:/tmp/news-r233-run/wf5/regen-docs.mjs      # worktree ชั่วคราว ตัด CASE_DIAG (WF4) ออกเอง
git add docs/NEWS-SWITCHES.md docs/NEWS-CHANGELOG.md
git commit -m "docs(news): regen ทะเบียนสวิตช์ + changelog (WF3/WF5) [NEWS-LOCK-APPROVED by เจ้าของ 3 ก.ย. 69]" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**ก่อน push** (กติกาเดิม): ชุดถดถอย 0 แดง → build → เทสสนาม 1 ข่าว → คิวว่าง → แท็กจุดกู้ → push

**นำครูใหม่เข้าใช้จริง (เจ้าของเท่านั้น · ลำดับนี้)**
1. `node scripts/import-writer-teachers.mjs` — dry-run ดูแผนอีกครั้ง (ต้องเห็น insert 28 · ข้าม 0)
2. `node scripts/import-writer-teachers.mjs --apply` — backup ตาราง+ไฟล์ 2 ไฟล์ → insert 28 → เติมไลก์/บัตร → manifest `C:\tmp\news-r233-run\writer-teachers-import-manifest.json`
3. `node scripts/import-writer-teachers.mjs --verify` — ต้องขึ้น ok (28 id ในตาราง · ป้ายครบ · ไฟล์ครบ)
4. commit ไฟล์ที่ถูกเติม: `git add data/viral-likes-real.json data/viral-essences.json` + commit (ไม่ติดล็อก)
5. Vercel → Environment Variables (Production): `TEACHER_POOL=writers-v1` (คู่ `VIRAL_SHORTLIST=1` ที่ตั้งอยู่แล้ว) → redeploy → เฝ้าข่าวจริง 1 ข่าว: log ต้องมี `· พูล writers-v1 (28 ใบ)`

**วิธีถอย (เลือกชั้นที่พอ)**
- ถอยผลเขียนทันที: ลบ `TEACHER_POOL` ออกจาก Vercel env → redeploy = ครูชุดเดิมทั้งคลัง (โค้ดเดิมไบต์ต่อไบต์ · ครูใหม่ 28 แถวยังอยู่ในตารางแต่ไม่มีผลพิเศษ — อยู่ในคลังรวมเหมือนครูใบอื่น)
- ถอยข้อมูล: `node scripts/import-writer-teachers.mjs --rollback` — ลบ 28 แถว (เฉพาะที่มีป้าย) + คืนไฟล์ 2 ไฟล์จาก backup ไบต์ต่อไบต์ (⚠️ คีย์ที่งานอื่นเติมหลัง --apply หายด้วย) · manifest ที่ถอยแล้วใช้ซ้ำไม่ได้
- ถอยโค้ด: `bash scripts/news-rollback.sh code news-prod-48f41228-3sep69c`
- ล็อกสคริปต์ไม่ให้ใครนำเข้าโดยเผลอ: ตั้ง `TEACHER_IMPORT_APPLY=0` (dry-run/verify/rollback ยังใช้ได้)
