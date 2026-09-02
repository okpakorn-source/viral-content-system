# NEWS CHANGELOG — ประวัติการแก้ท่อข่าวจากคอมเมนต์ในโค้ด

> สร้างอัตโนมัติด้วย `node scripts/gen-news-changelog.mjs` จากคอมเมนต์ที่มีวันที่ไทยในไฟล์ท่อข่าว
> (34 ไฟล์ตาม `NEWS_SWITCH_FILES`) — **ห้ามแก้ไฟล์นี้ด้วยมือ** แก้ที่คอมเมนต์ในโค้ดแล้วรันสคริปต์ใหม่
> เรียงวันที่ใหม่ → เก่า · รูปแบบ: `ไฟล์:บรรทัด` — ข้อความคอมเมนต์ (ย่อ 170 ตัวอักษร) · ปีที่ไม่ระบุถือเป็น พ.ศ. 69

รายการทั้งหมด: 454 จุด

## 2 ก.ย. 69 (2026-09-02)

- `src/lib/ai/aiRouter.js:146` — ★ 2 ก.ย. 69 ห้องทดลอง (เจ้าของสั่ง "ลองเปลี่ยนโมเดลสำหรับทดลอง"): WRITER_MODEL_LAB = ชื่อ env ใหม่ ไม่มีบน Vercel
- `src/lib/correction/correctionPipeline.js:24` — ★ 2 ก.ย. 69 L4.7 ด่านข้อเท็จจริงหาย — เตือนเท่านั้น (MISSING_FACTS_GATE=0 ปิด)
- `src/lib/correction/correctionPipeline.js:105` — ★ 2 ก.ย. 69 Fact-bearing Guard
- `src/lib/correction/correctionPipeline.js:112` — ★ 2 ก.ย. 69
- `src/lib/correction/correctionPipeline.js:145` — ★ 2 ก.ย. 69 L4.7: เทียบต้นฉบับดิบกับฉบับที่จะคืนจริง — เตือนอย่างเดียว (null = สวิตช์ปิด → ไม่แตะผลลัพธ์)
- `src/lib/correction/correctionPipeline.js:152` — ★ 2 ก.ย. 69 L4.7 (สวิตช์ปิด = ไม่มีคีย์นี้)
- `src/lib/correction/correctionPipeline.js:166` — ★ 2 ก.ย. 69 L4.7 คำเตือนแทน logPipeline (เฉพาะเมื่อมีของหาย)
- `src/lib/correction/correctionPipeline.js:225` — ★ 2 ก.ย. 69 Fact-bearing Guard
- `src/lib/correction/correctionPipeline.js:232` — ★ 2 ก.ย. 69
- `src/lib/correction/correctionPipeline.js:280` — ★ 2 ก.ย. 69 L4.7: เทียบต้นฉบับดิบกับฉบับสุดท้าย — เตือนอย่างเดียว (null = สวิตช์ปิด → ไม่แตะผลลัพธ์)
- `src/lib/correction/correctionPipeline.js:288` — ★ 2 ก.ย. 69 L4.7 (สวิตช์ปิด = ไม่มีคีย์นี้)
- `src/lib/correction/correctionPipeline.js:305` — ★ 2 ก.ย. 69 L4.7 คำเตือนแทน logPipeline (เฉพาะเมื่อมีของหาย)
- `src/lib/correction/correctionPipeline.js:340` — ★ 2 ก.ย. 69 — L4.7 ด่านข้อเท็จจริงหาย (เตือนเท่านั้น ห้ามแก้เนื้อ) · ค่าเริ่มต้นเปิด · MISSING_FACTS_GATE=0 = ไม่ทำอะไร (ผลลัพธ์เหมือนเดิมทุกไบต์)
- `src/lib/correction/semanticSanityCheck.js:103` — ═══ ★ 2 ก.ย. 69 — Fact-bearing Guard (เทสสนามจริงเคส #05234 ศรราม/ป๋าเดียร์) ═══
- `src/lib/correction/semanticSanityCheck.js:145` — ★ 2 ก.ย. 69: เดิมถอยเงียบ (เทสสนามจริง: Claude ล้มโดยไม่มีร่องรอยในล็อก) → บอกสาเหตุ + ติดธงให้กล่องดำ
- `src/lib/correction/semanticSanityCheck.js:175` — ★ 2 ก.ย. 69 ประโยคที่กันไว้เพราะแบกข้อเท็จจริง
- `src/lib/correction/semanticSanityCheck.js:184` — ★ 2 ก.ย. 69 Fact-bearing Guard: ตรงกับต้นฉบับ ≥12 ตัวอักษร → คงไว้ ห้ามลบ (คนตรวจอ่านจากธง)
- `src/lib/services/autoFlowServiceText.js:555` — ★ 2 ก.ย. 69 ANGLE2_DISTINCT_V2 (ค่าเริ่มต้นเปิด · ปิดคืน ANGLE2_DISTINCT_V2=0 = ข้อความส่งนักเขียนเหมือนเดิมทุกไบต์)
- `src/lib/services/autoFlowServiceText.js:556` _(ปีไม่ระบุ)_ — ที่มา: เทสสนามจริงเคสศรราม 2 ก.ย. — 2 มุมเขียนขนานกัน ย่อหน้ากลางซ้ำเกือบคำต่อคำ (คล้าย 38–42%) เพราะแกนจองกันแค่ประโยคแรก
- `src/lib/services/autoFlowServiceText.js:576` — ★ 2 ก.ย. 69 สัญญาว่าง (สวิตช์ทดลอง) → ไม่ใส่บรรทัดเปล่า
- `src/lib/services/autoFlowServiceText.js:577` — ★ 2 ก.ย. 69 ANGLE2_DISTINCT_V2: ต่อท้ายมุมด้วย "ประเด็นที่มุมนี้ต้องเล่าเต็ม / ประเด็นที่มุมอื่นเล่าเต็มแล้วให้ย่อ" — สวิตช์ปิด/มุมเดียว/ประเด็น<2 คืน '' = writeAngle เดิ…
- `src/lib/services/autoFlowServiceText.js:836` — ★ 2 ก.ย. 69 ANGLE2_DISTINCT_V2: บันทึกตัวเลขความคล้ายลงทุกเวอร์ชันเสมอ (_diversitySimilarity) — เกณฑ์บล็อก 37%/50% ไม่เปลี่ยน
- `src/lib/services/autoFlowServiceText.js:941` — ★ 2 ก.ย. 69 ตัวเลขความคล้ายหลัง factual editor
- `src/lib/services/autoFlowServiceText.js:1162` _(อ้างถึง "2 ก.ย. 69")_ — ★ 2 ก.ย. 69 — สวิตช์ทดลองเปิดเรื่อง (ค่าเริ่มต้น = พฤติกรรมเดิม 100% · เจ้าของสั่ง 18 ส.ค. "ห้ามสั่งทับการ์ด" จึงไม่เปิดเอง)
- `src/lib/services/autoFlowServiceText.js:1165` — ★ 2 ก.ย. 69 เย็น — เจ้าของเคาะ "เคาะเปลี่ยน" หลังศึกโมเดล 7 แขน (กรรมการปิดชื่อ: เปิดทั้งคู่ 30.5/40 ชนะทุกแขน)
- `src/lib/services/autoFlowServiceText.js:1197` — ── ANGLE2_DISTINCT_V2 block start ── (★ 2 ก.ย. 69 — ฟังก์ชันบริสุทธิ์ ใช้แค่ process.env + Intl เพื่อให้เทสดึงไปรันแยกได้ · ห้ามเพิ่ม import)
- `src/lib/services/autoFlowServiceText.js:1198` — ที่มา: เทสสนามจริงเคสศรราม 2 ก.ย. 69 — 2 มุมเขียนขนาน ย่อหน้ากลางซ้ำเกือบคำต่อคำ (คล้าย 38–42%) เพราะแกนจอง (_reservedOpeningAngles) กันแค่ประโยคแรก
- `src/lib/services/viralFewshot.js:16` — 🎯 2 ก.ย. 69 rank-v2: กติกาหยิบครูใหม่ (ไฟล์ไม่มี import — ยืนเดี่ยว เทสยิงตรงได้)
- `src/lib/services/viralFewshot.js:95` — ★ 2 ก.ย. 69 (rank-v2): แยก "ตัวอ่านไฟล์" ออกจาก "สวิตช์สูตรแสนไลก์" — rank-v2 ต้องเห็นไลก์จริงเสมอ (ยอดสูงนำ)
- `src/lib/services/viralFewshot.js:178` — 🎯 2 ก.ย. 69: โหมด rank-v2 นับเป็นสายชั้นเฉพาะกิจด้วย (โผเดียวกัน ต้องย้อนสอบได้เท่ากัน) — โหมดเก่าไม่เปลี่ยน
- `src/lib/services/viralFewshot.js:189` — 🎯 2 ก.ย. 69: ผลกติกา rank-v2 (ด่าน/เหตุผล/ใบที่ข้าม) — ใส่เฉพาะโหมดใหม่ ไม่เปลี่ยนรูปแถวเก่า
- `src/lib/services/viralFewshot.js:244` — ═══ 🗂️ 2 ก.ย. 69 — ตัวจำแนกหมวด V2 (LIB_CLASSIFIER_V2) · เลิกกวาดคีย์เวิร์ดในถุงข้อความ + เลิก default ชั้นใหญ่ ═══
- `src/lib/services/viralFewshot.js:245` — ปัญหาที่แก้ (เจ้าของจับจากสมุดประวัติจริง 2 ก.ย. 69 — pickLibraryCategory เดิมเทรวม หมวด+โครงเรื่อง+แท็ก เป็นถุงเดียวแล้วนับคีย์):
- `src/lib/services/viralFewshot.js:256` — ทุกคำในตารางอิงโปรไฟล์ธีมของชั้นจริง (viral_examples 202 ใบ × data/viral-essences.json วัด 2 ก.ย. 69) เช่น
- `src/lib/services/viralFewshot.js:528` — ═══ 🎯 2 ก.ย. 69 — กติกาหยิบครูใหม่ (TEACHER_RANK_V2) · เจ้าของสั่ง "แมตช์ก่อน แล้วยอดสูงนำ ไม่ล็อก ไม่เอาแต่ดัง" ═══
- `src/lib/services/viralFewshot.js:552` — 7 วันจริงมี ~730 แถว (วัด 2 ก.ย. 69) — เผื่อ 5 หน้า
- `src/lib/services/viralFewshot.js:918` — 🎯 2 ก.ย. 69 (rank-v2): โผพร้อมคะแนน/hit/ธงเกราะ 1 รายใบ ให้ teacherRank ใช้ด่านแมตช์ — ช่องใหม่ ผู้เรียกเดิมไม่กระทบ
- `src/lib/services/viralFewshot.js:980` — 🗂️ 2 ก.ย. 69: LIB_CLASSIFIER_V2 (ค่าเริ่มต้นเปิด) — แมปหมวดจากช่อง breakdown ตามความหมายของช่อง · =0 คืน pickLibraryCategory เดิม
- `src/lib/services/viralFewshot.js:1021` — 🗂️ 2 ก.ย. 69: ไม่มีชั้นตรง (libCat null จาก V2) = ดึงทั้งคลังเหมือนโหมดกว้าง — ห้ามยิง .eq('category', null)
- `src/lib/services/viralFewshot.js:1156` — ── 🎯 2 ก.ย. 69 rank-v2: แทนตัวสุ่มเฉพาะเมื่อชั้นเฉพาะกิจคัดโผสำเร็จ + สวิตช์เปิด ──

## 1 ก.ย. 69 (2026-09-01)

- `src/app/api/auto/process/route.js:938` — ★ 1 ก.ย. 69: ด่านความยาวกักทั้งก้อน → เก็บจำนวนคำ+เนื้อที่ถูกกักไว้กับงาน ไม่ให้หายเงียบ
- `src/app/api/auto/process/route.js:957` — ★ 1 ก.ย. 69: หลักฐานด่านความยาว
- `src/app/api/queue/clear/route.js:27` — ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): โหมด 'stale' ก็ลบงานที่ "กำลังทำ" ได้ (ยิงโดยไม่ต้องมีกุญแจ)
- `src/app/api/queue/clear/route.js:54` — ★ 1 ก.ย. 69: เดิม 8 นาทีทุกสถานะ — สั้นกว่าเวลาทำข่าวจริง (ถึง ~13 นาที) และลบผลที่ยังไม่มีใครอ่าน
- `src/lib/ai/legacyLengthRules.js:117` — ★ 1 ก.ย. 69: รับ 1/true/on/yes ทนช่องว่าง+อัญประกาศ (เดิมต้อง '1' เป๊ะ ผิดนิดเดียวคือเงียบ)
- `src/lib/correction/correctionPipeline.js:20` — ★ 1 ก.ย. 69 (แก้บั๊กจากรายงานตรวจสภาพ 41 ข้อ): สวิตช์อ่านทน · แทนคำเคารพ whitelist · L4.5 ห้ามลบเนื้อจริง
- `src/lib/correction/correctionPipeline.js:39` — ★ 1 ก.ย. 69: รับ 1/true/on (เดิมต้อง 'true' เป๊ะ ผิดนิดเดียวคือเงียบ)
- `src/lib/correction/correctionPipeline.js:93` — ★ 1 ก.ย. 69: ด่านตรวจล้ม = เดินเส้นยาวต่อ (ด่านอื่นยังคุม) แต่ต้องมีร่องรอยในกล่องดำ ไม่ใช่เงียบ
- `src/lib/correction/correctionPipeline.js:196` — ★ 1 ก.ย. 69: เดิม split/join ดิบ → ทำลายศัพท์แพทย์ที่ L2 กันไว้ ("เส้นเลือด" → "เส้นร่องรอยเหตุการณ์")
- `src/lib/correction/correctionPipeline.js:213` — ★ 1 ก.ย. 69: ย้ายไป placeScrub.js (เทสได้) + แก้บั๊ก regex กินท่อนยาวไม่จำกัดจนลบเนื้อข่าวจริงเป็นท่อน
- `src/lib/correction/guardedReplace.js:4` — ★ 1 ก.ย. 69 — บั๊กที่พิสูจน์แล้ว 2 จุด:
- `src/lib/correction/outputAuditService.js:133` — ★ 1 ก.ย. 69: แนบ pattern เดิม (ที่มี lookbehind กันศัพท์แพทย์) ให้ด่านแก้ใช้แทนคำอย่างเคารพกันชน
- `src/lib/correction/outputAuditService.js:233` — ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิมคืน "100 คะแนน สะอาด" ทั้งที่ตรวจไม่ได้เลย
- `src/lib/correction/placeScrub.js:4` — ★ 1 ก.ย. 69 — บั๊กที่พิสูจน์แล้ว: regex เดิม `([ก-๙a-zA-Z]+)` กินตัวอักษรไทยยาวไม่จำกัด
- `src/lib/correction/safeCorrectionService.js:14` — ★ 1 ก.ย. 69: แทนคำต้องห้ามด้วย pattern เดิมของ L2 (เคารพ whitelist ศัพท์แพทย์) — บั๊ก "ยาฆ่าเชื้อ→ยาก่อเหตุเชื้อ"
- `src/lib/correction/safeCorrectionService.js:147` — ★ 1 ก.ย. 69: คำยาวก่อนคำสั้น ("ฆ่าตัวตาย" ก่อน "ฆ่า") + แทน "ตำแหน่งแรกที่ผ่านกันชน" ไม่ใช่ตำแหน่งแรกในบทความ
- `src/lib/services/summarizeServiceText.js:8` — ★ 1 ก.ย. 69: สวิตช์อ่านค่าทน
- `src/lib/services/summarizeServiceText.js:2892` — ★ 1 ก.ย. 69 (บั๊กระดับสูง พิสูจน์แล้ว): ถอยเงียบไม่มีร่องรอย → ลงบันทึกท่อเป็น warning ให้ /pipeline-logs และตัวตรวจสุขภาพเห็น
- `src/lib/services/summarizeServiceText.js:3029` — ★ 1 ก.ย. 69: ร่องรอยการถอย (เดิมเงียบ ค้างได้เป็นวันโดยไม่มีใครรู้ว่าคุณภาพการ์ดตก)
- `src/lib/services/viralFewshot.js:1039` — ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิมกลืน error แล้วแคช "ไม่มีครู" ไว้ 10 นาที → ข่าวทุกใบช่วงนั้นเขียนโดยไม่มีครูไวรัล
- `src/lib/services/viralFewshot.js:1049` — ★ 1 ก.ย. 69: แคชเฉพาะผลที่ดึงสำเร็จ
- `src/lib/utils/envFlag.js:3` — ★ 1 ก.ย. 69: บั๊กที่พิสูจน์แล้ว 4 จุด — สวิตช์ต้องพิมพ์ '1' หรือ 'true' เป๊ะ ผิดนิดเดียวคือเงียบ (ไม่เตือน)
- `src/lib/utils/publishablePostText.js:72` — ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิมกักทั้งก้อนแล้วเหลือแค่ข้อความ — คนตรวจไม่รู้ว่าขาด 3 คำหรือ 100 คำ
- `src/lib/utils/withTimeout.js:48` — ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิม "จอง" งบเต็ม ms ทุกขั้น รวมกันเกินงบทั้งระบบ

## 31 ส.ค. 69 (2026-08-31)

- `src/lib/ai/modelConfig.js:73` — โปรถึง 31 ส.ค. 69 → หลังนั้น 3/15

## 24 ส.ค. 69 (2026-08-24)

- `src/lib/ai/legacyLengthRules.js:70` — 24 ส.ค. 69 เจ้าของสั่ง: พื้น 146 คำ ไม่กำหนดเพดาน — นักเขียนต้องปรับความยาวตามสาระจริงในเนื้อดิบแต่ละข่าว
- `src/lib/ai/legacyLengthRules.js:90` — ★ คำยืนยันล่าสุด 24 ส.ค. 69: 146 คือ "ขั้นต่ำ" เท่านั้น; 269 ไม่ใช่เพดานหรือเป้าหมาย
- `src/lib/services/summarizeServiceText.js:1737` — 🎴 24 ส.ค. 69 การ์ดนำทางครู: ป้ายสาระของการ์ดที่เลือก (คลังเดียวกับสารบัญ) ส่งให้ตัวคัดครูเสมอ
- `src/lib/services/viralFewshot.js:512` — 🎴 24 ส.ค. 69 — "การ์ดนำทางครู" (CARD_TEACHER_MATCH=1) · โค้ดล้วน ไม่เรียก AI

## 21 ส.ค. 69 (2026-08-21)

- `src/lib/ai/aiRouter.js:109` — ★ 21 ส.ค. 69 (เจ้าของเลือกจากศึกตาบอด R118): นักเขียนหลัก → claude-opus-4-8
- `src/lib/ai/aiRouter.js:140` — ★ 21 ส.ค. 69 (เจ้าของเคาะจากศึกตาบอด R118): สายนักเขียนโดยเฉพาะ
- `src/lib/ai/modelConfig.js:25` — ★ 21 ส.ค. 69 (เจ้าของเคาะหลังเทส R71–R73): ขั้น Breakdown → gpt-5.6-sol
- `src/lib/services/autoFlowServiceText.js:199` — ★ 21 ส.ค. 69: เก็บข้อความที่ผู้ใช้วางไว้แยกจาก newsData.newsBody ซึ่งผ่าน AI สกัด
- `src/lib/services/summarizeServiceText.js:28` — สัญญา Breakdown ที่เจ้าของยืนยัน 21 ส.ค. 69: ส่งต่อ 4 มุมพอดี
- `src/lib/services/summarizeServiceText.js:948` — ★ 21 ส.ค. 69: Breakdown ใช้ Sol + สัญญา 4 มุมตามที่เจ้าของเคาะจาก R73
- `src/lib/services/summarizeServiceText.js:1769` — ★ 21 ส.ค. 69 เจ้าของกำหนด: วิธีเดิมทุกอย่างต้องอยู่ครบ แต่ Fable ต้องได้อ่าน

## 20 ส.ค. 69 (2026-08-20)

- `src/lib/ai/promptModes.js:2` — promptModes — จุดอ่านสวิตช์ "โหมดถ้อยคำในใบสั่งเขียนข่าว" เพียงจุดเดียวของระบบ (20 ส.ค. 69 · งาน R3)
- `src/lib/services/summarizeServiceText.js:4` — 🎛️ 20 ส.ค. 69 (R3): ENDING_MODE ท่อนจบ + WITNESS_FACTLOCK — ห้ามอ่าน env 2 ตัวนี้เองจากไฟล์อื่น
- `src/lib/services/summarizeServiceText.js:1483` _(อ้างถึง "20 ส.ค. 69")_ — 🎛️ 20 ส.ค. 69 (R3 ข้อ 2): เจ้าของเคาะฝั่ง "สัจธรรม" ไปแล้วตั้งแต่ 18 ส.ค. แต่วรรคห้ามข้อคิดยังค้างในบล็อกนี้ 2 จุด
- `src/lib/services/summarizeServiceText.js:1637` — 🎛️ 20 ส.ค. 69 (R3 ข้อ 3 — เจ้าของเคาะเอง): เก็บบทบาทไว้ แต่ผ่อนด้วยหางกำกับ
- `src/lib/services/summarizeServiceText.js:1789` — 🎛️ 20 ส.ค. 69 (R3 ข้อ 2): ท่อน [ย่อหน้าสุดท้าย] สั่ง "จบเรียบๆ ไม่ตีความ" ซึ่งขัดกับ Style Pack ข้อ 5 (จบด้วยสัจธรรม) ตรงๆ
- `src/lib/services/summarizeServiceText.js:1815` — 🎛️ 20 ส.ค. 69 (R3 ข้อ 2): "ไม่สรุปข้อคิดชีวิต" = วรรคที่ 4 ที่ขัดกับฝั่งสัจธรรม · ENDING_MODE=plain คืนกลับมาทุกไบต์
- `src/lib/services/summarizeServiceText.js:1844` — 🎛️ 20 ส.ค. 69 (R3 ข้อ 3): บรรทัดนี้บังคับ "ทุกย่อหน้าต้องมีภาพ" — ต้นฉบับไม่มีภาพให้ก็ต้องเสก ⇒ เติมหางชุดเดียวกับ The Witness
- `src/lib/services/viralFewshot.js:13` — 🎛️ 20 ส.ค. 69 (R3): ข้อ 1 วลีลายเซ็น + ข้อ 2 ท่อนจบ — ห้ามอ่าน env 2 ตัวนี้เองจากไฟล์อื่น
- `src/lib/services/viralFewshot.js:44` — ★ 20 ส.ค. 69 (R3 ข้อ 1 — เจ้าของเคาะเอง): วลีลายเซ็นข้อ 3
- `src/lib/services/viralFewshot.js:53` — ★ 20 ส.ค. 69 (R3 ข้อ 2 — เจ้าของเคาะ "เอา ก ก่อน" = ฝั่งสัจธรรม)

## 19 ส.ค. 69 (2026-08-19)

- `src/lib/services/autoFlowServiceText.js:30` — ★ 19 ส.ค. 69 รอบ 3 (ANGLE_CLOSING_SPLIT): กติกาจับคู่แผนจบ+เงื่อนไขทุบท้าย อยู่ที่เดียวใน narrativePayloadText
- `src/lib/services/autoFlowServiceText.js:33` — 🎛️ สวิตช์ปลดหาง "ห้ามขึ้นต้นด้วยวันที่" (19 ส.ค. 69) — ห้ามอ่าน env CARD_AUTH* เอง ต้อง import จากไฟล์กลางเท่านั้น
- `src/lib/services/autoFlowServiceText.js:296` — ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE — สเปคเฟเบิ้ล-สุด): มุมแรกคงหมวดแรกตามเดิม · มุมที่ 2 เป็นต้นไปเลือกตาม facebook_viral_score
- `src/lib/services/autoFlowServiceText.js:303` — 🔧 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุมรวมศูนย์ที่ getGenAnglesCount() — เดิมก๊อปสูตรมา 2 ที่
- `src/lib/services/autoFlowServiceText.js:414` — 🔧 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรเดียวกับสวิตช์แบบ ก — รวมศูนย์ helper เดียว ค่าเท่าเดิมเป๊ะ
- `src/lib/services/autoFlowServiceText.js:419` — ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE=1 เท่านั้น): จุดหั่นมุมจุดที่ 2 — มุมแรกยังคงหมวดแรกตาม REVERT ข้างบน
- `src/lib/services/autoFlowServiceText.js:531` — ★ 19 ส.ค. 69 (ร้ายแรง 3 — FIXLIST-planK): จองแผนจบ "ก่อนยิงขนาน" — closing ใบเดียวห้ามถูกใช้ 2 มุม
- `src/lib/services/autoFlowServiceText.js:533` — 🔧 19 ส.ค. 69 รอบ 3 (โซลตรวจ): 3 อย่างในบล็อกเดียว —
- `src/lib/services/autoFlowServiceText.js:552` — 🎛️ CARD_AUTHORITY R6 (19 ส.ค. 69): เปิดสวิตช์ = ถอดหาง " ห้ามขึ้นต้นด้วยวันที่" ทั้ง 4 สูตร + หางพร้อมท์ด้านล่าง · ปิด (default) = ข้อความเดิมทุกไบต์
- `src/lib/services/autoFlowServiceText.js:608` — 🔧 19 ส.ค. 69 รอบ 3: _angleClosingPicks non-null = ฝั่งเขียนจะใช้แผนที่แนบแน่นอน (เงื่อนไข gate ฝั่งเขียน
- `src/lib/services/autoFlowServiceText.js:2034` — ★ 19 ส.ค. 69 (🟡 FIXLIST-planK): สูตรจำนวนมุม 1-4 (default 2) รวมศูนย์ที่เดียว — เดิมก๊อปสูตรไว้ 2 จุด
- `src/lib/services/autoFlowServiceText.js:2040` — ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE — สเปคเฟเบิ้ล-สุด): ตัวเลือกมุมแบบอิงคะแนนไวรัล
- `src/lib/services/autoFlowServiceText.js:2043` _(ปีไม่ระบุ)_ — นิยาม "มีคะแนน" (ผู้ตรวจโซล+คิมิชี้ตรงกัน 19 ส.ค. — Number(null)===0 ทำ null ชนะ key หายผิดสเปค):
- `src/lib/services/autoFlowServiceText.js:2066` — 🔧 19 ส.ค. 69 รอบ 3 (โซลตรวจ): กติกาจับคู่จริงย้ายไปรวมศูนย์ที่ assignAngleClosings
- `src/lib/services/autoFlowServiceText.js:2087` — ★ 19 ส.ค. 69 (ANGLE2_BY_SCORE): จุดหั่นมุมจุดที่ 3 — ต้องสลับพร้อมอีก 2 จุดเสมอ (ดูโน้ตที่ selectAnglesForGen)
- `src/lib/services/summarizeServiceText.js:3` — 🎛️ สวิตช์ปลดกฎกลางทับการ์ด (19 ส.ค. 69) — ห้ามอ่าน env CARD_AUTH* เอง ต้อง import จากไฟล์กลางเท่านั้น
- `src/lib/services/summarizeServiceText.js:6` — 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX): ตัวแปลงกลาง object → ข้อความ (กัน "[object Object]" หลุดเข้าตัวเขียน) — ถอย HOOKS_OBJ_FIX=0
- `src/lib/services/summarizeServiceText.js:18` — ★ 19 ส.ค. 69 รอบ 3: assignAngleClosings = กติกานับ/จับคู่แผนจบรายมุม ชุดเดียวกับ autoFlow
- `src/lib/services/summarizeServiceText.js:1478` — 🎛️ CARD_AUTHORITY R5A/R5B (19 ส.ค. 69): ผ่าบล็อกเป็น 3 ส่วน — สวิตช์ปิด (default) = ต่อกันแล้วได้ข้อความเดิมทุกไบต์
- `src/lib/services/summarizeServiceText.js:1710` — 🎛️ CARD_AUTHORITY RXC (19 ส.ค. 69): เปิดสวิตช์ = ตัดเฉพาะประโยค "ทุกอย่างต้องรับใช้มุมนี้..."
- `src/lib/services/summarizeServiceText.js:1787` — 🎛️ CARD_AUTHORITY R4 (19 ส.ค. 69): เปิดสวิตช์ = ตัดครึ่งหลัง "[ย่อหน้า 1] เปิดแรง hook..." เท่านั้น
- `src/lib/services/summarizeServiceText.js:1800` — ★ 19 ส.ค. 69 FEELING_ECHO (เจ้าของเคาะ "ทางเลือก A" = แยกปลดจุดนี้จุดเดียว ไม่แตะของอื่นที่ VIRAL_HITS_FORMULA คุม):
- `src/lib/services/summarizeServiceText.js:1824` — 🎛️ CARD_AUTHORITY R6 (19 ส.ค. 69): เปิดสวิตช์ = ถอดกฎข้อ 8 "ห้ามเปิดด้วยวันที่" ทั้งบรรทัด (เลขข้ออื่นคงเดิมไม่ขยับ)
- `src/lib/services/summarizeServiceText.js:1856` — 🎛️ CARD_AUTHORITY R6 (19 ส.ค. 69): เปิดสวิตช์ = ถอดเฉพาะหาง " ห้ามเปิดด้วยวันที่"
- `src/lib/services/summarizeServiceText.js:2097` — 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX บั๊ก A): quotes บางรอบเป็น { speaker, quote_type, content, emotional_use } — ไม่มีคีย์ quote/text เลย
- `src/lib/services/summarizeServiceText.js:2236` — 🔧 19 ส.ค. 69 รอบ 3 (โซลจับ): เดิมนับใบที่ "มีชื่อ+มีเนื้อ" — ใบชื่อมั่วไม่เกี่ยวกับมุมไหนเลยก็ถูกนับ (รายงาน 2/2 ปลอม)
- `src/lib/services/summarizeServiceText.js:2367` — 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX): ช่องนี้คืน object บ้าง/สตริงบ้าง — ต่อสตริงตรงๆ ได้ "[object Object]" · ถอย HOOKS_OBJ_FIX=0
- `src/lib/services/summarizeServiceText.js:2372` — 🔧 19 ส.ค. 69 (HOOKS_OBJ_FIX): ตัวใหญ่สุด — พังเป็น "[object Object]" 19 จาก 23 รอบยิง (83%) · ถอย HOOKS_OBJ_FIX=0

## 18 ส.ค. 69 (2026-08-18)

- `src/lib/ai/claudeClient.js:2` — ★ 18 ส.ค. 69 เจ้าของสั่ง "เก็บ log 100% ทุกขั้นตอน ทุกคำสั่ง" — สวิตช์ LOG_FULL_PROMPT=1
- `src/lib/ai/openai.js:9` — ★ 18 ส.ค. 69 เจ้าของสั่ง "เก็บ log 100% ทุกขั้นตอน ทุกคำสั่ง" — สวิตช์ LOG_FULL_PROMPT=1
- `src/lib/services/autoFlowServiceText.js:289` — ★ 18 ส.ค. 69 (แบบ ก — เฟเบิ้ล-สุด): ANGLE_CLOSING_SPLIT — ให้ Blueprint วางแผนจบแยกรายมุม "ในใบเดียว"
- `src/lib/services/autoFlowServiceText.js:312` — ★ 18 ส.ค. 69 (แบบ A — ANGLE_BLUEPRINT_MODE=per_angle): Blueprint หนึ่งใบต่อหนึ่งมุม
- `src/lib/services/autoFlowServiceText.js:436` — 18 ส.ค. 69 (แบบ 2 — สถาปนิกออกแบบ · โซลตรวจไขว้ · เจ้าของอนุมัติ): มุมถัดไปเห็นการ์ดที่มุมก่อนหน้าใช้ไปแล้ว เพื่อไม่ให้ 2 ฉบับเปิดซ้ำ
- `src/lib/services/autoFlowServiceText.js:568` — 18 ส.ค. 69 เจ้าของสั่งถอด 3 รอบ (2132c6a · eb6ff50 · 9b9a689) คืนสภาพยุคปัง
- `src/lib/services/autoFlowServiceText.js:605` — ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): มุมนี้รับเฉพาะแผนจบของมุมตัวเอง — กันท่อนจบแฝดข้ามมุม
- `src/lib/services/autoFlowServiceText.js:1162` _(ปีไม่ระบุ)_ _(อ้างถึง "18 ส.ค.")_ — ★ 2 ก.ย. 69 — สวิตช์ทดลองเปิดเรื่อง (ค่าเริ่มต้น = พฤติกรรมเดิม 100% · เจ้าของสั่ง 18 ส.ค. "ห้ามสั่งทับการ์ด" จึงไม่เปิดเอง)
- `src/lib/services/autoFlowServiceText.js:2065` — ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): หาแผนจบของมุมเดียวจาก blueprint.angle_closings
- `src/lib/services/summarizeServiceText.js:684` — ★ 18 ส.ค. 69 (แบบ A — ANGLE_BLUEPRINT_MODE=per_angle): ส่วน prompt ที่ทำให้ Blueprint แต่ละ call ยึดมุมเดียว
- `src/lib/services/summarizeServiceText.js:721` — ★ 18 ส.ค. 69 (แบบ ก — ANGLE_CLOSING_SPLIT): รายชื่อมุมให้ Blueprint วางแผนจบรายมุมในใบเดียว (โหมด blueprint เท่านั้น · ไม่ส่ง = พฤติกรรมเดิม)
- `src/lib/services/summarizeServiceText.js:1483` _(ปีไม่ระบุ)_ _(อ้างถึง "18 ส.ค.")_ — 🎛️ 20 ส.ค. 69 (R3 ข้อ 2): เจ้าของเคาะฝั่ง "สัจธรรม" ไปแล้วตั้งแต่ 18 ส.ค. แต่วรรคห้ามข้อคิดยังค้างในบล็อกนี้ 2 จุด
- `src/lib/services/summarizeServiceText.js:1518` — ★ 18 ส.ค. 69: จำกัดไว้โหมดถอยเท่านั้น — ถ้าปล่อยรันในโหมดปกติ จะทับเลขกลับเป็น short {250,300}
- `src/lib/services/summarizeServiceText.js:1783` _(อ้างถึง "18 ส.ค. 69")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.
- `src/lib/services/summarizeServiceText.js:1826` _(อ้างถึง "18 ส.ค. 69")_ — ★ 18 ส.ค. 69 (เจ้าของสั่ง "กฎเดิม 11 มิ.ย. เก็บ · กฎใหม่ 16 ส.ค. ลบออก"):
- `src/lib/services/summarizeServiceText.js:2105` — ★ 18 ส.ค. 69 (แบบ ก — เฟเบิ้ล-สุด · ANGLE_CLOSING_SPLIT): แผนจบแยกรายมุมในใบเดียว — Blueprint ยังเรียกครั้งเดียว/ข่าว
- `src/lib/services/summarizeServiceText.js:2627` _(อ้างถึง "18 ส.ค. 69")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.
- `src/lib/services/summarizeServiceText.js:2798` — 18 ส.ค. 69 เจ้าของสั่ง: บรรณารักษ์เห็นข้อมูลการ์ดไม่พอ → เติม ท่าเปิด/โทน/โครงอารมณ์ ลงสารบัญ (อ่านจากการ์ด ไม่แก้การ์ด)
- `src/lib/services/summarizeServiceText.js:2926` — 18 ส.ค. 69 เจ้าของอนุมัติ: ด่านเคาะ 14→1 เห็นการ์ดเต็มใบ (เดิม 600 ตัวอักษร ≈12%)
- `src/lib/services/viralFewshot.js:23` — 🗓️ 18 ส.ค. 69: HOOK_STYLE_MODE ถูกถอดออกจากระบบแล้ว (ไม่มีโค้ดอ่านอีก) — เก็บไว้เป็นตัวอย่างบทเรียนเท่านั้น
- `src/lib/services/viralFewshot.js:28` _(อ้างถึง "18 ส.ค. 69")_ — 18 ส.ค. 69 เจ้าของสั่ง "ใช้โค้ดช่วง 12 มิ.ย. – 1 ก.ค." — คืนสูตรนี้เป็นตัวดั้งเดิม e5ba1eb (11 มิ.ย.)
- `src/lib/services/viralFewshot.js:1248` _(อ้างถึง "18 ส.ค. 69")_ — 18 ส.ค. 69 เจ้าของสั่งถอดสูตรบังคับ v2 (721dbf8 14 ส.ค.) + สวิตช์ HOOK_STYLE_MODE (eb6ff50 16 ส.ค.) — คืนสภาพ 11 มิ.ย.

## 17 ส.ค. 69 (2026-08-17)

- `src/lib/ai/claudeClient.js:18` — 🗑️ กฎที่ 5 ยุคแรก (ถอด 17 ส.ค. 69 · ถอยคืน LEGACY_LENGTH_RULES=1)
- `src/lib/ai/legacyLengthRules.js:2` — 🗑️ ซากกฎ "เขียนให้ยาว" ยุคแรก — ถอดออกจากท่อข่าว 17 ส.ค. 69
- `src/lib/ai/legacyLengthRules.js:4` — ★ เจ้าของสั่ง 17 ส.ค. 69: "กฏพวกนี้ควรแก้หรือเอาออกเลย ตอนสมัยก่อนฉันสั่งเอไอไม่เป็นสั่งฝังกฏมั่ว"
- `src/lib/ai/legacyLengthRules.js:25` _(ปีไม่ระบุ)_ — ไม่มี guard ตัวไหนอยู่นอกสวิตช์ (บทเรียน 17 ส.ค.: BREAKDOWN_LIST_FIX=0 ย้อนได้แค่ 120/140
- `src/lib/ai/legacyLengthRules.js:45` — 🔍 เจอตอนถอด 17 ส.ค. 69: ฝั่ง openai เขียน \\n\\n (สองแบ็กสแลช) ⇒ AI เห็นเป็นตัวอักษร \n\n ตามเจตนา
- `src/lib/ai/legacyLengthRules.js:56` — บรรทัดสุดท้ายของ "กฎที่ 5" — openai.js:60 และ claudeClient.js:87 (เจ้าของสั่งตัดทิ้ง 17 ส.ค. 69)
- `src/lib/ai/legacyLengthRules.js:87` — ★ เจ้าของเคาะถ้อยคำเอง 17 ส.ค. 69:
- `src/lib/ai/legacyLengthRules.js:144` — ★ เจ้าของสั่ง 17 ส.ค. 69 หลังผู้ตรวจ gpt-5.6-sol + claude-fable-5 ยืนยันตรงกันว่า
- `src/lib/ai/legacyLengthRules.js:159` _(ปีไม่ระบุ)_ — 🐛 ผู้ตรวจ gpt-5.6-sol จับได้ 17 ส.ค. (ความมั่นใจ 97%) — รุ่นแรกของผมพังตอนถอย:
- `src/lib/ai/legacyLengthRules.js:179` — 🗑️ 17 ส.ค. 69: thinSourceLenCfg() ถูกลบพร้อมสวิตช์ THIN_SOURCE_2PARA ทั้งก้อน (เจ้าของสั่ง
- `src/lib/ai/legacyLengthRules.js:191` — (ข้อสอบชุด ช. จับได้ตอนรันจริง 17 ส.ค. 69: รุ่นแรกของ mix มีแต่แรงกดให้สั้น ไม่มีตัวถ่วงกลับ
- `src/lib/ai/legacyLengthRules.js:215` — 🔴 วรรคย้ำท้ายใบสั่งงาน — ผู้ตรวจ claude-fable-5 จับได้ 17 ส.ค. 69 (เงื่อนไขก่อน commit)
- `src/lib/ai/legacyLengthRules.js:225` _(ปีไม่ระบุ)_ — 🐛 ผู้ตรวจ gpt-5.6-sol จับได้ 17 ส.ค. (รุ่นแรกของผมเขียน "ครบ 3 ย่อหน้า" ตายตัว):
- `src/lib/ai/legacyLengthRules.js:227` — (ตอนที่จับได้ยังมีสวิตช์ข่าวบาง THIN_SOURCE_2PARA บังคับ 2 ย่อหน้าด้วย — สวิตช์นั้นถูกลบ 17 ส.ค. 69 แล้ว)
- `src/lib/ai/openai.js:5` — 🗑️ กฎที่ 5 ยุคแรก (ถอด 17 ส.ค. 69 · ถอยคืน LEGACY_LENGTH_RULES=1)
- `src/lib/services/summarizeServiceText.js:2` — 🗑️ ซากกฎ "เขียนให้ยาว" ยุคแรก (ถอด 17 ส.ค. 69 · ถอยคืน LEGACY_LENGTH_RULES=1) + นโยบายขั้นต่ำกลางของท่อ TEXT
- `src/lib/services/summarizeServiceText.js:767` _(ปีไม่ระบุ)_ — 3 ย่อหน้ายังล็อกเหนือ VIRAL_HITS_FORMULA เหมือนหลัก 17 ส.ค. (ค่าคงที่ในนโยบายกลาง)
- `src/lib/services/summarizeServiceText.js:1526` — 🗑️ 17 ส.ค. 69: สวิตช์ข่าวบาง THIN_SOURCE_2PARA ถูก "ลบทั้งบล็อก" ตามคำสั่งเจ้าของ ("ลบทิ้งเลยกันพลาด")
- `src/lib/services/summarizeServiceText.js:1528` _(ปีไม่ระบุ)_ — เหตุผลลบ: ปัญหา "ข่าวบางพองเกิน" ถูกแก้ที่รากด้วยการถอดกฎบังคับยาว (17 ส.ค.) — ข่าวดิบ 92 คำ
- `src/lib/services/summarizeServiceText.js:1782` — 🗑️ 17 ส.ค. 69 (เจ้าของสั่ง "ตัดอันนี้ถึงเลย ลบเลย") — เลิกบังคับช่วงคำ เปลี่ยนเป็นประเมินจากเนื้อดิบ · ถอย LEGACY_LENGTH_RULES=1
- `src/lib/services/summarizeServiceText.js:1793` — 🔴 17 ส.ค. 69: ตัดโควตาประโยคต่อย่อหน้าออก — เจ้าของชี้เองว่า "อันนี้ตัวทำพัง"
- `src/lib/services/summarizeServiceText.js:1882` — 🔴 17 ส.ค. 69: "ความยาวตามที่กำหนด" กลายเป็นคำสั่งลอยหลังถอดพื้นคำออก (เฟเบิ้ลจับได้)
- `src/lib/services/summarizeServiceText.js:1888` — 🗑️ 17 ส.ค. 69: ตัวอย่างใน JSON ก็สั่งความยาวด้วย — โมเดลมักยึดตัวอย่างมากกว่าคำอธิบาย · ถอย LEGACY_LENGTH_RULES=1
- `src/lib/services/summarizeServiceText.js:2387` — 🗑️ 17 ส.ค. 69: ถอด "กฎความยาว: เขียนให้ยาว..." ออก (ถอยคืน LEGACY_LENGTH_RULES=1)
- `src/lib/services/summarizeServiceText.js:2468` — 🗑️ 17 ส.ค. 69: โหมด mix (ปุ่ม "AI ผสมมุมข่าว" ที่คนกดเอง) · ถอย LEGACY_LENGTH_RULES=1
- `src/lib/services/summarizeServiceText.js:2481` — 🗑️ 17 ส.ค. 69: ของเดิมเขียน "เนื้อหายาว 250+ คำ 3 ย่อหน้า" ไว้ในตัวอย่าง JSON แบบไม่มีสวิตช์ครอบ

## 16 ส.ค. 69 (2026-08-16)

- `src/app/api/auto/route.js:13` — ★ 16 ส.ค. 69 (เจ้าของสั่ง "ล็อกเส้นเทสให้ตรงกับทีม แล้วบล็อกอีกเส้นกันพลาด"):
- `src/app/api/auto/route.js:17` _(ปีไม่ระบุ)_ — บทเรียน 15-16 ส.ค.: เทสทั้งวันยิงเข้าประตูนี้ ผลที่ได้จึงเป็นของอีกสายหนึ่ง ต้องทบทวนข้อสรุปทั้งหมด
- `src/app/api/queue/worker/route.js:205` — ★ 16 ส.ค. 69 (เจ้าของสั่ง): ถอดเงื่อนไข "เฉพาะงานปก" ออก — ให้ตาข่ายนี้ครอบงานข่าวด้วย
- `src/lib/correction/fabricationGate.js:18` — 🔴 สถานะ 16 ส.ค. 69 — เจ้าของสั่ง "ตัวผ่าปิดเลย ไม่ใช้" (ถาวร ไม่ใช่ปิดชั่วคราว)
- `src/lib/correction/fabricationGate.js:35` — 🔴 16 ส.ค. 69: ตัวตัดสินว่าด่านนี้เปิดหรือปิด — **ปิดเป็นค่าตั้งต้น** เปิดได้ทางเดียวคือตั้ง FAB_GATE เป็นค่าเปิด
- `src/lib/correction/fabricationGate.js:68` — เพราะตั้งแต่ 16 ส.ค. 69 การข้ามด่านมาจาก "ค่าตั้งต้นในโค้ด" ไม่ใช่ "มีคนตั้ง env = 0"
- `src/lib/services/autoFlowServiceText.js:397` — ★ 16 ส.ค. 69 (ผู้ตรวจอิสระท้วง): ข้อความเดิมอ่านแล้วเหมือน "ค้นแล้วไม่เจอ"
- `src/lib/services/summarizeServiceText.js:5` — 📖 สมุดเพดานเนื้อข่าวกลาง (16 ส.ค. 69)
- `src/lib/services/summarizeServiceText.js:64` — ★ 16 ส.ค. 69 (เจ้าของสั่ง "เลิกจำกัด ให้อ่านได้ครบเนื้อที่ส่งเข้าระบบ")
- `src/lib/services/summarizeServiceText.js:74` _(ปีไม่ระบุ)_ — ⚠️ ใช้ตัวอ่านตัวเดียวทั้งไฟล์ (บทเรียน 16 ส.ค.: HOOK_STYLE_MODE ถูกเช็ค 3 แบบ
- `src/lib/services/summarizeServiceText.js:90` — ★ 16 ส.ค. 69 (เจ้าของสั่ง "ปรับให้ยาวกว่านี้ได้ เพราะแต่ละข่าวมีเนื้อเรื่องต่างกัน
- `src/lib/services/summarizeServiceText.js:1534` — ★ 16 ส.ค. 69 (เจ้าของสั่ง): "ปรับความยืดหยุ่นคำลงมาที่ 165 คำขั้นต่ำ ส่วนถ้าเนื้อดิบมาเยอะ เจนยาวกว่านี้ได้"
- `src/lib/services/summarizeServiceText.js:1826` _(ปีไม่ระบุ)_ _(อ้างถึง "16 ส.ค.")_ — ★ 18 ส.ค. 69 (เจ้าของสั่ง "กฎเดิม 11 มิ.ย. เก็บ · กฎใหม่ 16 ส.ค. ลบออก"):
- `src/lib/services/summarizeServiceText.js:1827` _(ปีไม่ระบุ)_ — ท่อนที่สั่ง "ประโยคแรกต้องขึ้นต้นด้วยคน/การกระทำ · บอกก่อนว่าใคร" (เพิ่มโดย eb6ff50 16 ส.ค.) ถูกลบถาวร
- `src/lib/services/viralFewshot.js:18` — ★ 16 ส.ค. 69 — ตัวอ่าน env: ตัดช่องว่าง + ถอดเครื่องหมายคำพูด + ไม่สนตัวพิมพ์
- `src/lib/services/viralFewshot.js:175` — ★ 16 ส.ค. 69 (ผู้ตรวจอิสระ — โจทย์เจ้าของสั่ง "ต้องตรวจย้อนได้"): เหตุผลของชั้นเฉพาะกิจยาวเฉลี่ย ~366 ตัวอักษร
- `src/lib/services/viralFewshot.js:221` — 🐛 บั๊กค้างที่รู้ตัวแล้วแต่ "จงใจไม่แก้ในแบตช์นี้" (16 ส.ค. 69 — ผู้ตรวจอิสระจับได้):
- `src/lib/services/viralFewshot.js:381` _(อ้างถึง "16 ส.ค. 69")_ — 🛡️ 16 ส.ค. 69 (ผู้ตรวจอิสระ — บทเรียนซ้ำรอย "ตำราว่างเงียบๆ" 2 ส.ค.): ของเดิมแคช {} ถาวรถ้าอ่านไฟล์ล้มครั้งเดียว
- `src/lib/services/viralFewshot.js:397` — 🛡️ 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้ — บั๊กแดง): emotionalTags มาจาก newsAnalysis?.emotionalTags ตรงๆ ไม่มีตัวล้างชนิด
- `src/lib/services/viralFewshot.js:403` — 🛡️ 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้ — บทเรียนเดียวกับ _tagsText แต่ลืมฝั่ง "บัตรลักษณะ"):
- `src/lib/services/viralFewshot.js:440` — 🎚️ 16 ส.ค. 69 — "ชั้นวางเฉพาะกิจ" (VIRAL_SHORTLIST=1) · โค้ดล้วน ไม่เรียก AI
- `src/lib/services/viralFewshot.js:452` _(ปีไม่ระบุ)_ — (บทเรียน 16 ส.ค.: HOOK_STYLE_MODE ถูกเช็ค 3 แบบใน 3 ไฟล์ พิมพ์ตัวใหญ่แล้วปิดได้แค่ 1 ใน 3)
- `src/lib/services/viralFewshot.js:453` — 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): ของเดิมค่าที่อ่านไม่ออก (เช่น =2, =enable) "ปิดเงียบ ไม่มี log"
- `src/lib/services/viralFewshot.js:455` — ═══ 📏 16 ส.ค. 69 — เพดานตัวอย่างครูไวรัล (เจ้าของสั่ง "ขยายเพดานเลย ทำสวิตช์ด้วย") ═══
- `src/lib/services/viralFewshot.js:458` — (ไฟล์ส่งออก: _hits-formula-workspace/viral-examples-export.json · วัด 16 ส.ค. 69)
- `src/lib/services/viralFewshot.js:572` — 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): พื้นเดิม 2 ทำให้ env ตัวเดียวพาระบบกลับไปเป็นท่าที่เจ้าของสั่งห้าม —
- `src/lib/services/viralFewshot.js:602` — ⚠️ 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้ — คอมเมนต์เดิมขายเกินจริง ห้ามเชื่อคำโฆษณาเก่า):
- `src/lib/services/viralFewshot.js:628` _(ปีไม่ระบุ)_ — วัดจริง 16 ส.ค. (ข่าวจริง 300 ใบ · เมล็ดสุ่มล็อก · เนื้อเต็ม ไม่ส่งแท็กอารมณ์):
- `src/lib/services/viralFewshot.js:647` — 🔴 16 ส.ค. 69 — แก้คำโฆษณาเกินจริงในคอมเมนต์เดิม (ผู้ตรวจอิสระ 3 มุมยิงตรงกัน ผมรันซ้ำแล้วยืนยัน):
- `src/lib/services/viralFewshot.js:660` — 🧪 16 ส.ค. 69 — เคยลองเปลี่ยนมาใช้ตัวตัดคำไทยจริง (Intl.Segmenter) แล้ว **ถอยกลับ** เพราะวัดแล้วไม่คุ้ม
- `src/lib/services/viralFewshot.js:732` — 🛡️ 16 ส.ค. 69 (ข้อสอบชุดใหม่จับได้ — ผู้ตรวจอิสระเคลมว่ายิงอินพุตพิการ 20 แบบไม่ล้มเลย แต่เคสนี้ล้มจริง):
- `src/lib/services/viralFewshot.js:737` — 🛡️ 16 ส.ค. 69 (ผู้ตรวจอิสระ): K ผิดรูปต้องไม่ทำให้สัญญาในหัวข้อเพี้ยน — ผู้เรียกในไฟล์นี้กันด้วย _shortlistK แล้ว
- `src/lib/services/viralFewshot.js:821` — ↑ 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): ห้ามใช้ localeCompare ตัดเสมอในโค้ดนี้
- `src/lib/services/viralFewshot.js:872` — 🛡️ เกราะ 6 (16 ส.ค. 69 — ผู้ตรวจอิสระจับได้): โผห้ามเหลือใบเดียว
- `src/lib/services/viralFewshot.js:891` — 🔢 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้ — log เดิมบอกเลขที่ไม่ได้วัดสิ่งที่มันพูด):
- `src/lib/services/viralFewshot.js:929` _(ปีไม่ระบุ)_ — ★ 16 ส.ค.: เติม id ย่อ 8 ตัวหน้าทุกใบ (ผู้ตรวจท้วง "log ไม่เคยบอกว่าใบไหนแข่งบ้าง" — ย้อนสอบไม่ได้)
- `src/lib/services/viralFewshot.js:954` — 🔴 16 ส.ค. 69 — คืนเพดาน .slice ตามเดิม (ผู้ตรวจอิสระ 3 มุมจับตรงกันว่ารอบก่อนถอดออกโดยไม่ได้รายงาน)
- `src/lib/services/viralFewshot.js:972` — ⚠️ 16 ส.ค. 69 — ตัวเลือกครูถูกเรียกจาก **3 ที่** (ผู้ตรวจอิสระจับได้ว่าเอกสารรอบก่อนเขียนว่า 2 ที่):
- `src/lib/services/viralFewshot.js:991` — 🛡️ เกราะ 5 (16 ส.ค. 69 — ผู้ตรวจอิสระ 2 มุมยิงตรงกัน · ปิดรูที่อันตรายที่สุดของฟีเจอร์นี้):
- `src/lib/services/viralFewshot.js:998` — 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): matchModeName ไม่ถอดเครื่องหมายคำพูด (โค้ดเก่า ห้ามแตะในแบตช์นี้)
- `src/lib/services/viralFewshot.js:1041` — ⚠️ 16 ส.ค. 69 (ผู้ตรวจอิสระ — ระเบิดเวลา ยังไม่ระเบิดวันนี้เพราะคลังมี 202 ใบ):
- `src/lib/services/viralFewshot.js:1109` — 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): ชั้น libCat ว่าง → usable = ทั้งคลัง = ตัวอย่าง "ข้ามหมวด"
- `src/lib/services/viralFewshot.js:1141` — 🔴 16 ส.ค. 69 (ผู้ตรวจอิสระ 3 มุมท้วงคำว่า "ถอยวิธีเดิมทั้งดุ้น" ว่าไม่จริง — และถูก):
- `src/lib/services/viralFewshot.js:1147` — 🔴 16 ส.ค. 69 รอบ 2 (ผู้ตรวจยิงซ้ำ): log เดิมพิมพ์ `ในชั้น "${libCat}"` เสมอ
- `src/lib/services/viralFewshot.js:1217` _(ปีไม่ระบุ)_ — 🔴 ตะโกนบอกเมื่อครูยังถูกตัด — บทเรียน 16 ส.ค.: ของเดิมตัด 77% ของครูเงียบๆ ไม่มีใครรู้มาเป็นเดือน
- `src/lib/services/viralFewshot.js:1219` — 🔢 16 ส.ค. 69 (ผู้ตรวจอิสระจับได้): "จากโผ N ใบ" เคยพิมพ์ขนาดคลังทั้งก้อน (202) ขณะที่สมุดประวัติจด 8
- `src/lib/services/viralFewshot.js:1227` — ★ 16 ส.ค. 69 (ผู้ตรวจอิสระ): โหมดชั้นเฉพาะกิจจด poolSize = โผที่ตัวสุ่มเห็นจริง (8 ใบ) + libSize = คลังทั้งก้อน
- `src/lib/services/viralFewshot.js:1248` _(ปีไม่ระบุ)_ _(อ้างถึง "16 ส.ค.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดสูตรบังคับ v2 (721dbf8 14 ส.ค.) + สวิตช์ HOOK_STYLE_MODE (eb6ff50 16 ส.ค.) — คืนสภาพ 11 มิ.ย.
- `src/lib/utils/researchSwitch.js:2` — 🔎 สวิตช์ "ค้นข้อมูลเสริมจากเน็ต" ของท่อทำข่าว — 16 ส.ค. 69
- `src/lib/utils/researchSwitch.js:4` — เจ้าของสั่ง (16 ส.ค. 69 หลังพนักงานเจนข่าววิลเลี่ยม LYKN แล้วพบข้อมูลจากเน็ตปนเข้ามาในข่าว):

## 15 ส.ค. 69 (2026-08-15)

- `src/app/api/queue/worker/route.js:9` — ★ 15 ส.ค. 69 (Sol + Fable ตรวจตรงกัน · เจ้าของสั่งแก้): "fetch failed" ปลอมของงานข่าว
- `src/app/api/queue/worker/route.js:125` — ★ 15 ส.ค. 69: งานข่าวใช้ deadline 770s (ต่ำกว่า maxDuration 800 — ของเดิม 900s ไม่มีวันได้ใช้จริง)
- `src/lib/ai/claudeClient.js:56` — ★ 15 ส.ค. 69 (ขั้น 4 sonnet-5 — เจ้าของอนุมัติ): เพิ่ม 3 พารามิเตอร์เลือกได้ ไม่ส่ง = พฤติกรรมเดิมทุกไบต์
- `src/lib/ai/claudeClient.js:132` — ★ 15 ส.ค. 69: effort ต่อการเรียกชนะ env กลาง (ของเดิม: const writeEffort = process.env.CLAUDE_WRITE_EFFORT \|\| 'medium';)
- `src/lib/ai/claudeClient.js:135` — ★ Sol #3 + Fable (15 ส.ค. 69): กันกับระเบิด — เรียกด้วย promptBlocks ล้วนโดยไม่ส่ง prompt ต้องไม่พังที่ preview
- `src/lib/ai/claudeClient.js:155` — ★ 15 ส.ค. 69: promptBlocks = แตกพรอมต์เป็นก้อน + ติด cache_control ก้อนคงที่ (สารบัญการ์ด 201 ใบเหมือนกันทุกข่าว)
- `src/lib/ai/claudeClient.js:208` — ★ 15 ส.ค. 69: โชว์แคชในลอค (cacheW=เขียนแคชครั้งแรก 1.25x · cacheR=อ่านแคช 0.1x) — เกณฑ์คานารี: มุม 2-3 ต้อง cacheR ≥9,000
- `src/lib/ai/claudeClient.js:217` — ★ Sol #2 + รอบ 2 (15 ส.ค. 69): input จริง = input + cache_creation + cache_read (เดิมนับแค่ input_tokens ทำ /cost ต่ำกว่าจริง)
- `src/lib/ai/modelConfig.js:30` — ★ 15 ส.ค. 69 (เจ้าของเคาะ): ขั้น 3 Blueprint (วางโครงอารมณ์) → gpt-5.6-sol
- `src/lib/ai/modelConfig.js:72` — ★ 15 ส.ค. 69 นักเขียนหลักใหม่ — ไม่มีแถวนี้ /cost จะบันทึก $0 (ผู้ตรวจ Fable จับ)
- `src/lib/correction/fabricationGate.js:140` — ★ 15 ส.ค. 69 (เจ้าของเคาะหลังศึกหมอผ่าตัด 8 โมเดล × 2 รอบ ด้วยโจทย์เดียวกันเป๊ะ): ระบุตัวผ่า = claude-opus-5
- `src/lib/services/summarizeServiceText.js:2219` — ★ 15 ส.ค. 69 (เจ้าของเคาะหลังแข่ง 9 โมเดล · กรรมการปิดตา 7 เสียง): ขั้น 3 → gpt-5.6-sol
- `src/lib/services/summarizeServiceText.js:2832` — ★ 15 ส.ค. 69 (ขั้น 4 sonnet-5 — เจ้าของอนุมัติ หลังแล็บ 44+12 นัด): โมเดลขึ้นต้น claude- → callClaude คิดเบา + แคชสารบัญ
- `src/lib/services/summarizeServiceText.js:2834` — ★ 15 ส.ค. 69 ดึก (เจ้าของสั่ง "เปิดใช้ sonnet5"): default → claude-sonnet-5 · ถอยกลับ: CARD_PICKER_MODEL=gpt-5.6-luna
- `src/lib/services/summarizeServiceText.js:2836` _(ปีไม่ระบุ)_ — ★ 15 ส.ค. เย็น เจ้าของสั่งถอย: sonnet-5 ทำข่าวบิดเบือนเยอะ → กลับ luna (เปิด sonnet-5 คืน: CARD_PICKER_MODEL=claude-sonnet-5)
- `src/lib/services/summarizeServiceText.js:2903` — ★ รอบเทสจริง s5_abort (15 ส.ค. 69): ประกาศนอก try — catch (_pickErr) ใช้ชื่อโมเดลใน log ต้องมองเห็น
- `src/lib/services/summarizeServiceText.js:2905` — ★ 15 ส.ค. 69 ดึก (เจ้าของสั่ง "เปิดใช้ sonnet5"): default → claude-sonnet-5 (ของเดิม: \|\| MODEL_FAST_CHEAP = luna)
- `src/lib/services/summarizeServiceText.js:2906` _(ปีไม่ระบุ)_ — ★ 15 ส.ค. เย็น เจ้าของสั่งถอยกลับ luna
- `src/lib/services/summarizeServiceText.js:2969` — ★ 15 ส.ค. 69 (ขั้น 4 sonnet-5 — เจ้าของอนุมัติ): ซ่อมบั๊ก race ไม่ตัดสาย HTTP จริง (จ่ายเงินฟรีหลัง timeout)

## 14 ส.ค. 69 (2026-08-14)

- `src/lib/correction/correctionPipeline.js:35` — ★ 14 ส.ค. 69 (เจ้าของสั่ง "คืนการพัฒนาเรื่องแบบยุค 2 เดือน"): researchFacts = ข้อเท็จจริงรีเสิร์ชที่ยืนยันแล้ว
- `src/lib/correction/correctionPipeline.js:114` — ★ 14 ส.ค. 69 (ผู้ตรวจ #3): พาธง Seam Guard (OPENING/UNSAFE_SEAM_GUARD) ถึงกล่องดำ
- `src/lib/correction/correctionPipeline.js:234` — ★ 14 ส.ค. 69 (ผู้ตรวจ #3): พาธง Seam Guard ถึงกล่องดำ
- `src/lib/correction/fabricationGate.js:59` — @param {string\|null} researchFacts - ★ 14 ส.ค. 69: ข้อเท็จจริงรีเสิร์ชที่ยืนยันแล้ว (ฐานความจริงเสริม —
- `src/lib/correction/outputAuditService.js:54` — ★ 14 ส.ค. 69 (เจ้าของอนุมัติ + Sol รับรอง 9.1/10): ขยายศัพท์แพทย์ หลอด\|ลิ่ม\|เม็ด\|ฟอก\|ดัน\|บริจาค —
- `src/lib/correction/outputAuditService.js:62` — ★ 14 ส.ค. 69 ดึก (Sol backlog ข้อ 3 ขั้น 3 — ปิดความเสี่ยงคงเหลือที่จดไว้ตอนทำ whitelist):
- `src/lib/correction/safeCorrectionService.js:222` — ★ 14 ส.ค. 69 (Sol backlog ข้อ 3 ขั้น 2 — แก้สัญญา L3B): callAI คืน JSON object เสมอ
- `src/lib/correction/safeCorrectionService.js:235` — ★ 14 ส.ค. 69 (Sol: AI ล้มต้อง fail-closed กับท่อนยาว): direct replace ได้เฉพาะคำสั้น ≤12 ตัว —
- `src/lib/correction/semanticSanityCheck.js:50` — ═══ ★ 14 ส.ค. 69 — Seam Guard (เจ้าของสั่ง "ทำเลย ระมัดระวังที่สุด" · สเปก Sol 9.1/10 ใน sol-seam-verdict.md) ═══
- `src/lib/services/autoFlowServiceText.js:286` — ★ 14 ส.ค. 69 (Sol 9.5/10 — sol-backlog4 ข้อ 4a): จับเวลาจริงของแต่ละงานใน finally —
- `src/lib/services/autoFlowServiceText.js:797` — ★ 14 ส.ค. 69: ส่งข้อเท็จจริงรีเสิร์ชให้ด่าน L1.8 — ของจริงจากรีเสิร์ชไม่ใช่ "ของเกิน"
- `src/lib/services/autoFlowServiceText.js:1064` — ★ 14 ส.ค. 69 (Sol 4a): เวลาจริงรายงาน — เดิมสองตัวนี้ใช้ช่วงขนานรวม = เลขซ้ำทุกเคส
- `src/lib/services/autoFlowServiceText.js:1138` — ★ 14 ส.ค. 69 (Sol 4a): เวลาจริงรายงาน — logger กับ response ใช้ก้อนเดียวกัน
- `src/lib/services/summarizeServiceText.js:1799` — ★ 14 ส.ค. 69 สูตรแสนไลก์: วลี "ใครเห็นก็..." ชนกฎ v2 ห้ามบอกความรู้สึกแทนคนอ่าน (Sol จับได้ตอนรีวิวร่วม) — สวิตช์ปิด=ข้อความเดิมเป๊ะ
- `src/lib/services/viralFewshot.js:29` _(ปีไม่ระบุ)_ _(อ้างถึง "14 ส.ค.")_ — ถอยที่คืนออกไป: c168841 (14 ส.ค. แก้ข้อ 1) · ee64be8 (1 ส.ค. แก้ข้อ 5) · กู้กลับ: git show e5ba1eb
- `src/lib/services/viralFewshot.js:39` — ★ 14 ส.ค. 69 ค่ำ — "สูตรแสนไลก์" เป็นตัวจริง (เจ้าของสั่ง "จัดการให้เป็นโค้ดใหม่" หลังดูผลเทส 3 ข่าวแล้วชอบ)
- `src/lib/services/viralFewshot.js:87` — ★ 14 ส.ค. 69 (สูตรแสนไลก์ ข้อ 3): ถ่วงการหยิบครูด้วยไลก์จริงจากเพจ — ไฟล์ data/viral-likes-real.json
- `src/lib/services/viralFewshot.js:89` _(ปีไม่ระบุ)_ — ★ ผู้ตรวจอิสระจับได้ (S1 — กันซ้ำรอย "ครูหด" ที่เจ้าของสั่งย้อน 14 ส.ค.): ไลก์ในตารางเป็น 0 ทั้ง 202 ใบ
- `src/lib/services/viralFewshot.js:362` — ★ 14 ส.ค. 69 เจ้าของเคาะกลับ "สุ่มทั้งหมวด" (default ปิดบรรณารักษ์) — หลังใช้จริง 4 วันพบสำนวนลู่จืด:
- `src/lib/services/viralFewshot.js:370` _(ปีไม่ระบุ)_ — ว่าง/off/ค่าอื่นทุกแบบ = สุ่มทั้งหมวดแบบเดิม (ค่าเริ่มต้นตามคำสั่งเจ้าของ 14 ส.ค.)
- `src/lib/services/viralFewshot.js:449` _(ปีไม่ระบุ)_ — (ห้ามเลือกใบสุดท้ายตายตัวเด็ดขาด = ท่าที่ทำให้ "ครูหด สำนวนจืด" จนเจ้าของสั่งย้อน a10a40f 14 ส.ค.)
- `src/lib/services/viralFewshot.js:989` _(ปีไม่ระบุ)_ — 🛡️ เกราะ 4 (ลำดับความสำคัญของสวิตช์): VIRAL_MATCH_MODE เป็นสวิตช์เก่าที่เจ้าของเคาะไปแล้ว 14 ส.ค. → ชนะเสมอ
- `src/lib/services/viralFewshot.js:993` _(ปีไม่ระบุ)_ — จะกลายเป็น "หยิบ 2 ใบคะแนนสูงสุดของโผ" = ท่า "ครูหด สำนวนจืด" ที่เจ้าของสั่งย้อน a10a40f 14 ส.ค.
- `src/lib/services/viralFewshot.js:1002` _(ปีไม่ระบุ)_ — 🔴 รอบ 2 (ผู้ตรวจยิงซ้ำ): ห้ามเตือนค่าปิดสามัญ — 'off' คือค่าที่เอกสาร/คอมมิต 14 ส.ค. บอกให้ใช้ปิดบรรณารักษ์
- `src/lib/services/viralFewshot.js:1054` — ★ 14 ส.ค. 69: สวิตช์สูตรแสนไลก์เปิด → ทับไลก์จริงก่อนเข้าตัวเลือก (idempotent — ทับซ้ำได้ค่าเดิม)
- `src/lib/services/viralFewshot.js:1248` _(ปีไม่ระบุ)_ _(อ้างถึง "14 ส.ค.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดสูตรบังคับ v2 (721dbf8 14 ส.ค.) + สวิตช์ HOOK_STYLE_MODE (eb6ff50 16 ส.ค.) — คืนสภาพ 11 มิ.ย.

## 8 ส.ค. 69 (2026-08-08)

- `src/lib/services/summarizeServiceText.js:1748` — 📒 ผูกประวัติการหยิบเข้ากับข่าว (สมุดประวัติ 8 ส.ค. 69)
- `src/lib/services/viralFewshot.js:3` — Viral Few-shot — เรียนสำนวนจากหอสมุดไวรัลจริง 200+ โพสต์ (8 ส.ค. 69: 202 ใบ/14 หมวด — ทุกใบถูกเรียกได้จริง)
- `src/lib/services/viralFewshot.js:162` — 📒 สมุดประวัติการหยิบ (8 ส.ค. 69 เจ้าของสั่ง "เก็บประวัติแม่นยำ ตัวไหนถูกเรียก")
- `src/lib/services/viralFewshot.js:359` — ═══ 🎯 8 ส.ค. 69 เจ้าของสั่ง "ห้ามสุ่ม — ต้องแมชโครงเรื่อง/อารมณ์/แนวทางจริง มีเหตุผลรองรับ" ═══
- `src/lib/services/viralFewshot.js:1037` — ★ 8 ส.ค. 69: โหมดจับคู่/ชั้นเฉพาะกิจ=ทั้งคลัง · โหมดเดิม=ทั้งหมวด (ใหญ่สุดจริง 64 ใบ)
- `src/lib/services/viralFewshot.js:1058` _(ปีไม่ระบุ)_ — โหมดจับคู่ (เจ้าของสั่ง 8 ส.ค. "ห้ามสุ่ม"): ai → บรรณารักษ์เลือกพร้อมเหตุผล · score → คะแนนแมชนิ่งๆ
- `src/lib/services/viralFewshot.js:1226` — 📒 8 ส.ค. 69 เจ้าของสั่ง: จดสมุดประวัติถาวร — ข่าวไหนได้ตัวอย่างใบไหน + วิธีเลือก + เหตุผล

## 7 ส.ค. 69 (2026-08-07)

- `src/lib/services/viralFewshot.js:134` — ★ 7 ส.ค. 69: เติม 6 หมวดล่างที่มีในคลังจริง (17 ใบ) แต่โค้ดเดิมไม่รู้จัก = ไร้ทางเข้าถาวร
- `src/lib/services/viralFewshot.js:153` — ★ 7 ส.ค. 69: แคชเก็บ "รายการ top-N" ต่อหมวด (ของเดิมเก็บผิดรูป — cached.at ไม่มีจริง แคชเลยไม่เคยติด)

## 4 ส.ค. 69 (2026-08-04)

- `src/lib/ai/claudeClient.js:28` — ★ 4 ส.ค. 69 (เจ้าของสั่ง "เลือก opus 4.8 ประกอบเลย" หลังศึกตาบอด 6 นักเขียน × 5 ข่าวจริง):
- `src/lib/correction/correctionPipeline.js:18` — ★ 4 ส.ค. 69 ด่านจับของเกิน — ผลทดลองศึก 6 นักเขียน (FAB_GATE=0 ปิดได้)
- `src/lib/correction/correctionPipeline.js:74` — === ★ Layer 1.8: ด่านจับของเกิน (4 ส.ค. 69) ===
- `src/lib/correction/fabricationGate.js:2` — ด่านจับของเกิน (Fabrication Gate) — ★ 4 ส.ค. 69
- `src/lib/correction/fabricationGate.js:5` _(ปีไม่ระบุ)_ — แล้วผ่าออกแบบศัลยกรรม — มาจากผลทดลอง 3-4 ส.ค. (แซนด์บ็อกซ์ 10 ข่าว + ศึกตาบอด 6 นักเขียน):
- `src/lib/correction/fabricationGate.js:90` _(ปีไม่ระบุ)_ — (เทสจริง 4 ส.ค.: เติมคำว่า ฉาก แล้วด่านไล่จับสำนวนแต่งถึง 10 จุด/เวอร์ชัน จนการผ่าใหญ่เกินเกราะ)
- `src/lib/services/summarizeServiceText.js:316` — 2.7 ★ เพดานย่อหน้าเชิงโค้ด (4 ส.ค. 69 — เทสจริง: ตัวเขียนแยกประโยคปิดเป็นย่อหน้าเกินกติกา)
- `src/lib/services/summarizeServiceText.js:1527` — ของเดิม (สร้าง 4 ส.ค. 69 · default ปิดตลอด ไม่เคยตั้งใน .env ไหน): ต้นฉบับ <500 ตัวอักษร → 2 ย่อหน้า เพดาน 160 คำ

## 2 ส.ค. 69 (2026-08-02)

- `src/lib/services/summarizeServiceText.js:2224` — ★ 2 ส.ค. 69: 1200→8000 — ค่าเดิมจากยุคโมเดลเล็ก พอโล๊ะเป็น luna (reasoning คิดกินโควตา) เพดานไม่พอ
- `src/lib/services/viralFewshot.js:173` _(ปีไม่ระบุ)_ — ★ ผู้ตรวจจับได้ (บทเรียนซ้ำรอย "ตำราว่างเงียบๆ" 2 ส.ค.): supabase-js ไม่ throw เมื่อ insert ล้ม —
- `src/lib/services/viralFewshot.js:381` _(ปีไม่ระบุ)_ _(อ้างถึง "2 ส.ค.")_ — 🛡️ 16 ส.ค. 69 (ผู้ตรวจอิสระ — บทเรียนซ้ำรอย "ตำราว่างเงียบๆ" 2 ส.ค.): ของเดิมแคช {} ถาวรถ้าอ่านไฟล์ล้มครั้งเดียว
- `src/lib/services/viralFewshot.js:536` _(ปีไม่ระบุ)_ — อ่านล้ม/หมดเวลา → ถือว่าใช้ 0 ทุกใบ (ห้ามให้ท่อข่าวล้ม) และลองใหม่ใน 60 วิ (บทเรียน "ตำราว่างเงียบๆ" 2 ส.ค.: ห้ามแคชความล้มเหลวยาว)
- `src/lib/services/viralFewshot.js:838` _(ปีไม่ระบุ)_ — — บทเรียนเดียวกับ 'ตำราว่างเงียบๆ' 2 ส.ค.) · ตั้ง 1.0 → ถอย 23/300 และครูหดจาก 144 เหลือ 137 ใบ

## 1 ส.ค. 69 (2026-08-01)

- `src/app/api/auto/process/route.js:27` — ★ 1 ส.ค. 69 กล่องดำ workflow — สืบย้อนหลังได้ไม่ต้องเดา
- `src/app/api/queue/clear/route.js:26` — ★ 1 ส.ค. 69 (ออดิต): โหมด 'all' = ล้างคิวทั้งระบบ — ด่าน fail-closed (ไม่ตั้ง env = ปฏิเสธเสมอ)
- `src/lib/ai/claudeClient.js:26` — ★ 1 ส.ค. 69 (เจ้าของสั่ง "เอา claude opus5 มาเขียนดีที่สุด"): default → claude-opus-5
- `src/lib/ai/claudeClient.js:144` — ★ 1 ส.ค. 69: opus-5/fable "คิดก่อนเขียน" เปิดเองอัตโนมัติ และช่วงคิดกิน max_tokens ร่วมกับเนื้อ
- `src/lib/ai/claudeClient.js:197` — ★ 1 ส.ค. 69 (Sol รอบ 2): refusal อาจมาพร้อม partial content — ตัดสินจาก stop_reason ตรงๆ ก่อนแตะเนื้อ
- `src/lib/ai/modelConfig.js:9` — ★ STRATEGY (★ 1 ส.ค. 69 — เจ้าของสั่ง "โล๊ะโมเดลต่ำกว่า 5.6 ทั้งสาย"):
- `src/lib/ai/modelConfig.js:20` — สมองหลัก — reasoning หลายชั้น (★ 1 ส.ค. 69 โล๊ะ 5.5→sol)
- `src/lib/ai/modelConfig.js:39` — เขียนเนื้อหาข่าว (★ 1 ส.ค. 69: ตัวเขียนหลักตามคำสั่งโล๊ะ — ราคาเท่า 5.5 เป๊ะ)
- `src/lib/ai/modelConfig.js:46` — ลูกมือ — งานเร็ว/เยอะ (★ 1 ส.ค. 69 โล๊ะ mini→luna)
- `src/lib/ai/modelConfig.js:57` _(อ้างถึง "1 ส.ค. 69")_ — ★ อัปเกรด 10 มิ.ย. 2026 (เดิม gpt-4o legacy) — OCR ไทยแม่นขึ้น · ★ 1 ส.ค. 69 โล๊ะ→sol
- `src/lib/ai/modelConfig.js:58` — fallback เมื่อ MODEL_PRIMARY ล้มเหลว/timeout (★ 1 ส.ค. 69: เดิม gpt-4o ตายทุกครั้งเพราะเพดาน 16384 — terra วัดจริง ~42s)
- `src/lib/ai/openai.js:177` — ★ 1 ส.ค. 69 (เจ้าของสั่งโล๊ะ <5.6): โซ่ไม้สองยกชุดเป็นตระกูล 5.6 — sol↔terra, luna→terra
- `src/lib/ai/openai.js:200` — ★ 1 ส.ค. 69 (ออดิต): gpt-4o/gpt-4o-mini รับ completion สูงสุด 16384 — ส่งเพดานดิบ (เช่น 24000) ทำไม้สองตาย 400 ทุกครั้ง
- `src/lib/ai/promptStoreText.js:148` — ★ 1 ส.ค. 69 (เจ้าของสั่ง "ระบบห้ามยัดข้อคิด"): default ปิดกฎบังคับ — เปิดคืน FORCE_LESSON_ANGLE=1
- `src/lib/correction/correctionPipeline.js:19` — ★ 1 ส.ค. 69 กล่องดำ: เก็บ before/after ทุกด่าน — ชี้ตัวการได้ไม่ต้องเดา
- `src/lib/correction/correctionPipeline.js:126` — ★ 1 ส.ค. 69 (Sol รอบ 2): เส้น clean ก็วิ่งผ่าน L4.6 ที่ "ลบท่อนพังทิ้ง" ได้เหมือนกัน — ต้องผ่านเกราะเดียวกันก่อนคืน
- `src/lib/correction/flagFixerService.js:14` — ★ 1 ส.ค. 69: ชั้นเขียนแทนประโยคใช้ตัวเขียนหลัก opus-5 ก่อน
- `src/lib/correction/flagFixerService.js:16` — ภาษาไทยลื่นพอ + เร็ว/ถูกกว่า write-tier (★ 1 ส.ค. 69 โล๊ะ 4o→terra)
- `src/lib/correction/flagFixerService.js:19` — ★ 1 ส.ค. 69 (เกราะแก่นข่าว): เปิด export ให้ safeCorrectionService ใช้ตัวเดียวกัน
- `src/lib/correction/flagFixerService.js:30` — ★ 1 ส.ค. 69 (Sol รอบ 2): dedupe ด้วย "เลข+หน่วย" — เดิม key เลขอย่างเดียวทำ "12 เดือน" กับ "12 คน" ยุบเหลือตัวเดียว
- `src/lib/correction/flagFixerService.js:34` — ★ 1 ส.ค. 69 (Sol รอบ 2): ตัวเช็ค "เลข+หน่วยยังอยู่" แบบมีขอบเลข — กัน "12" ไปแมตช์ใน "312" และผูกหน่วยกันเลขคนละเรื่อง
- `src/lib/correction/flagFixerService.js:39` — ★ 1 ส.ค. 69 (Sol รอบ 3 — P1): escape metacharacter ก่อนประกอบ regex — เลขทศนิยม "12.5" เคยกลายเป็น wildcard จับ "1235" ว่าผ่าน
- `src/lib/correction/flagFixerService.js:73` — ★ 1 ส.ค. 69 (Sol รอบ 2): เช็คแบบขอบเลข+หน่วย
- `src/lib/correction/flagFixerService.js:171` — ★ 1 ส.ค. 69 (เจ้าของสั่ง "GPT ที่แตะภาษาตรง → opus5"): ชั้นนี้เขียนประโยคแทนจริง → claude-opus-5 ก่อน · ล้ม/ไม่มีคีย์ → terra เดิม
- `src/lib/correction/flagFixerService.js:183` — ★ 1 ส.ค. 69 (เกราะแก่นข่าว): ผลแก้ต้องไม่ทำ "เลขเด่นที่เวอร์ชันนี้มีอยู่แล้ว" หายไปแม้ตัวเดียว
- `src/lib/correction/outputAuditService.js:47` — ★ 1 ส.ค. 69 (กรรมการเทสจับได้ — เคสจริง "ตามลำดับ"→"ตามลำจากไป" แล้วท่อนพังถูกลบทั้งท่อนจนแก่นข่าวหาย):
- `src/lib/correction/safeCorrectionService.js:12` — ★ 1 ส.ค. 69 (เกราะแก่นข่าว): ใช้ตัวสกัด "เลขเด่น" ตัวเดียวกับ flagFixer — แหล่งความจริงเดียว ไม่ก๊อปตรรกะซ้ำ
- `src/lib/correction/safeCorrectionService.js:17` — ═══ ★ 1 ส.ค. 69 (เกราะแก่นข่าว) ═══════════════════════════════════════════
- `src/lib/correction/safeCorrectionService.js:18` _(ปีไม่ระบุ)_ — เหตุ (พิสูจน์แล้ว 1 ส.ค.): เวอร์ชันที่ติดป้าย _correctionApplied=true มีเนื้อพัง —
- `src/lib/correction/safeCorrectionService.js:103` — ★ 1 ส.ค. 69 (เกราะแก่นข่าว): เส้นนี้ยังไม่แตะเนื้อ (ผลแก้ = ต้นฉบับ) — ด่านจะปล่อยผ่านทันที
- `src/lib/correction/safeCorrectionService.js:271` — ★ 1 ส.ค. 69 (เกราะแก่นข่าว): ทางออกหลัก — ผลแก้ทั้งชุด (direct replace + AI rewrite + ลบ bait)
- `src/lib/correction/semanticSanityCheck.js:17` — ★ 1 ส.ค. 69: ชั้นตัดสิน/ตัดประโยคจริง → opus-5 ก่อน
- `src/lib/correction/semanticSanityCheck.js:138` — ★ 1 ส.ค. 69 (เจ้าของสั่ง "GPT ที่แตะภาษาตรง → opus5"): ชั้นนี้ชี้ประโยคที่จะถูกตัดจริง → claude-opus-5 ก่อน · ล้ม/ไม่มีคีย์ → luna เดิม
- `src/lib/correction/viralPolishService.js:15` — ขัดเงา = งานภาษาละเอียด ใช้ตัวเก่งสุด (★ 1 ส.ค. 69 โล๊ะ 5.5→sol)
- `src/lib/services/autoFlowServiceText.js:511` — ★ 1 ส.ค. 69 (Opus P2-A): ใบที่ luna ตั้งใจเลือก (AI_PICKED) อ่านการ์ดเต็ม+เนื้อข่าวแล้ว — ห้ามใช้คะแนนสูตร
- `src/lib/services/autoFlowServiceText.js:1131` _(ปีไม่ระบุ)_ — ★ 1 ส.ค. (Opus P2-E): เหตุผล luna ต้องทะลุถึงกล่องดำ/job_queue จริง
- `src/lib/services/summarizeServiceText.js:25` — ★ 1 ส.ค. 69 เจ้าของสั่ง 3.5→3.6 (ใหม่ ไว ไม่ล่ม)
- `src/lib/services/summarizeServiceText.js:1051` — ★ 1 ส.ค. 69 (ออดิต): เส้นคิวหลุดไปใช้ Built-in ต้องไม่ติดป้าย 'library' — ป้ายหลอกทำให้ดู log ไม่ออกวันที่หลุดจริง
- `src/lib/services/summarizeServiceText.js:1271` — ★ 1 ส.ค. 69: ยกระดับจาก "fallback เฉพาะ BORROWED" → สมองเลือกการ์ดทุกข่าว (เจ้าของสั่งหลังประลอง 6 โมเดล
- `src/lib/services/summarizeServiceText.js:1274` _(ปีไม่ระบุ)_ — หมายเหตุเส้นทาง (Opus ตรวจ 1 ส.ค.): สายคิว/autoFlow ส่ง presetPrompt มาเสมอ → บล็อกนี้ทำงานเฉพาะสายเรียกตรง
- `src/lib/services/summarizeServiceText.js:1476` — ★ 1 ส.ค. 69 (เจ้าของสั่ง): กฎเหล็ก "บังคับมีข้อคิด/บทเรียน" default ปิด — ข่าวหลากหลาย ระบบห้ามยัดข้อคิดเอง
- `src/lib/services/summarizeServiceText.js:1568` — ★ 1 ส.ค. 69 (Opus P2-4): ใบที่ luna เลือก (_matchType='AI_PICKED') ต้องใช้เกรดสูตรจริง (_formulaMatchType)
- `src/lib/services/summarizeServiceText.js:1783` _(ปีไม่ระบุ)_ _(อ้างถึง "1 ส.ค.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.
- `src/lib/services/summarizeServiceText.js:1999` — ★ 1 ส.ค. 69 กล่องดำ: เก็บร่างดิบจากตัวเขียนก่อนโดนจัดระเบียบ/แก้คำ — หลักฐานชี้ตัวการชั้นแรก
- `src/lib/services/summarizeServiceText.js:2059` _(ปีไม่ระบุ)_ — ★ 1 ส.ค.: แยก "luna ยืนยัน/เลือก" ออกจาก "luna ล่ม" ได้ในบันทึก
- `src/lib/services/summarizeServiceText.js:2627` _(ปีไม่ระบุ)_ _(อ้างถึง "1 ส.ค.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.
- `src/lib/services/summarizeServiceText.js:2785` — ═══ ★ 1 ส.ค. 69 ชั้นสารบัญ 201 ใบ (เจ้าของสั่งหลังประเมิน blind 5 ข่าว: ชนะ 2 · แพ้ฉิว 1 · เลือกตรงกัน 2) ═══
- `src/lib/services/summarizeServiceText.js:2897` — ★ 1 ส.ค. 69: AI CARD PICKER (luna) ที่จุดเลือกจริงของท่ออัตโนมัติ — เจ้าของสั่งหลังประลอง 6 โมเดล
- `src/lib/services/viralFewshot.js:29` _(ปีไม่ระบุ)_ _(อ้างถึง "1 ส.ค.")_ — ถอยที่คืนออกไป: c168841 (14 ส.ค. แก้ข้อ 1) · ee64be8 (1 ส.ค. แก้ข้อ 5) · กู้กลับ: git show e5ba1eb

## 16 ก.ค. 69 (2026-07-16)

- `src/app/api/auto/process/route.js:319` — ★ 16 ก.ค. 69: TEXT-ONLY MODE — รับเฉพาะข้อความล้วน ปิดสาย URL/คลิป/รูปทั้งหมด
- `src/app/api/auto/route.js:29` — ★ 16 ก.ค. 69: TEXT-ONLY MODE — ปิดสาย URL (ด่านหลักอยู่ /api/queue/add · เปิดคืน: TEXT_ONLY_MODE=0)
- `src/app/api/queue/add/route.js:80` — ★ 16 ก.ค. 69: TEXT-ONLY MODE — ปิดรับเจนข่าวจากลิงก์/รูปทุกชนิด (คำสั่งเจ้าของระบบ:
- `src/lib/ai/aiRouter.js:69` — ★ 16 ก.ค. 69 (B1): คืน "โมเดลจริง" (_modelUsed จาก client) แทนป้าย chain —
- `src/lib/ai/aiRouter.js:71` _(ปีไม่ระบุ)_ — (ไม่มีโค้ดไหน branch ตามค่านี้ — ใช้แสดงผล/logPipeline เท่านั้น, grep ยืนยัน 16 ก.ค.)
- `src/lib/ai/claudeClient.js:34` — ★ 16 ก.ค. 69 (B6): + sonnet-5/opus-5 — พิสูจน์ด้วย API จริง: "`temperature` is deprecated for this model"
- `src/lib/ai/claudeClient.js:175` — ★ 16 ก.ค. 69 (B4): รับ AbortSignal จาก withTimeoutSignal — timeout แล้วยกเลิก HTTP จริง ตัดจ่ายซ้อน
- `src/lib/ai/claudeClient.js:239` — ★ 16 ก.ค. 69 (B1): แนบโมเดลจริงไปกับผล (non-enumerable — ไม่ปนใน JSON.stringify/spread เหมือน openai.js)
- `src/lib/ai/modelConfig.js:11` _(ปีไม่ระบุ)_ — gpt-5.6-terra = ไม้สองมาตรฐานทุกจุด (A/B 16 ก.ค.: เร็ว 3 เท่า ถูกครึ่ง คุณภาพเท่า)
- `src/lib/ai/modelConfig.js:22` — ★ 16 ก.ค. 69 (B6.2 — เจ้าของเคาะ): breakdown สายข่าว text → terra ตามผล A/B
- `src/lib/ai/modelConfig.js:61` — ★ 16 ก.ค. 69 (B1 audit fix): แก้ราคาให้ตรงหน้าราคาจริง — ค่าเดิม gpt-5.5 3/12 ต่ำกว่าจริง
- `src/lib/ai/openai.js:217` — ★ 16 ก.ค. 69 (B4): รับ AbortSignal จาก withTimeoutSignal — timeout แล้วยกเลิก HTTP จริง ตัดจ่ายซ้อน
- `src/lib/ai/openai.js:252` — ★ 16 ก.ค. 69 (B1 + review fix): ติดป้ายโมเดลจริง "หลัง" sanitizeOutput — sanitize สร้าง object ใหม่
- `src/lib/correction/outputAuditService.js:33` — ★ 16 ก.ค. 69 (B2 completion — review จับได้): ถอดกฎแบน "เสียชีวิต" ออกจาก L2 —
- `src/lib/correction/safeCorrectionService.js:125` — ★ 16 ก.ค. 69 (B2): เพิ่ม 'เลือด'/'เลือดสาด' — เดิมตกไป direct-replace ได้ "พบร่องรอยเหตุการณ์ไหลออกมา"
- `src/lib/services/autoFlowServiceText.js:240` — ★ 16 ก.ค. 69 (B3): AI สกัดล้มแล้วตกมาใช้ raw text — เดิมเงียบสนิท ไม่มีใครรู้ว่างานนี้ไม่ได้ผ่าน AI
- `src/lib/services/autoFlowServiceText.js:362` — ★ 16 ก.ค. 69 (B4): 60s (was 30s) — sync สาย URL: SmartResearch มี 2 AI calls + 7 Serper HTTP calls
- `src/lib/services/autoFlowServiceText.js:660` — ★ 16 ก.ค. 69 (B4 review fix): 420s (เดิม 300s) — งบนี้ "แชร์" กัน
- `src/lib/services/autoFlowServiceText.js:745` — ★ 16 ก.ค. 69 (B4): พอร์ต FIX จากสาย URL (autoFlowService.js:504) — breakdownData.primaryCategory มักมีค่าเสมอ
- `src/lib/services/autoFlowServiceText.js:1057` — ★ 16 ก.ค. 69 (B4): พอร์ตจากสาย URL — เดิม stepTimings มีเฉพาะใน return data ไม่เข้า Generation Log
- `src/lib/services/autoFlowServiceText.js:1124` — ★ 16 ก.ค. 69 (B5): ฟิลด์ตรวจย้อน — ส่งคะแนนจับคู่จริงทะลุถึง job_queue (เดิมถูกตัดทิ้งเป็นทอดๆ)
- `src/lib/services/summarizeServiceText.js:9` — ★ 16 ก.ค. 69: withTimeout เดิมไม่ถูกใช้ในไฟล์นี้แล้ว (ทุกจุดย้ายไป withTimeoutSignal)
- `src/lib/services/summarizeServiceText.js:23` — ★ 16 ก.ค. 69 (B4): sync กับสาย URL (summarizeService.js:15) — เดิม hardcode 'gemini-2.5-pro' ตกรุ่น 2 เวอร์ชัน
- `src/lib/services/summarizeServiceText.js:774` — ★ 16 ก.ค. 69 (B3): เก็บเหตุที่ AI สกัดล้ม — แนบไปกับธง extractFallback
- `src/lib/services/summarizeServiceText.js:823` — ★ 16 ก.ค. 69 (B3): ติดธง extractFallback จริง — เดิมคืน success:true เฉยๆ ทำ AI ล้มแบบเงียบ
- `src/lib/services/summarizeServiceText.js:905` — ★ 16 ก.ค. 69 (B3): ติดธง extractFallback จริง — เดิมคืน success:true เฉยๆ ทำ AI ล้มแบบเงียบ
- `src/lib/services/summarizeServiceText.js:953` — ★ 16 ก.ค. 69 (B4): เปลี่ยนเป็น withTimeoutSignal — เมื่อเปิด WITHTIMEOUT_ABORT=1 จะยกเลิก request
- `src/lib/services/summarizeServiceText.js:1059` — ★ 16 ก.ค. 69 (B5): presetPrompt จาก getTopPrompts มีคะแนนจริงติดมาแล้ว (_matchScore/_matchType)
- `src/lib/services/summarizeServiceText.js:1213` — ★ 16 ก.ค. 69 (B5): แนบโทน+เนื้อย่อจริง — ให้ STAGE 2.5 ตัดสินจากเนื้อ ไม่ใช่แค่ชื่อ
- `src/lib/services/summarizeServiceText.js:1564` — ★ 16 ก.ค. 69 (B5 — สวิตช์ REF_WEIGHT_BY_MATCH=1 · default OFF = พฤติกรรมเดิมเป๊ะ):
- `src/lib/services/summarizeServiceText.js:1585` — ★ 16 ก.ค. 69 (B5): CLOSE = ยึดโครง/จังหวะได้ แต่ข้อเท็จจริงข่าวชนะโทนพร้อมท์เสมอ
- `src/lib/services/summarizeServiceText.js:1913` — ★ 16 ก.ค. 69 (B4): ขั้นเขียน (แพง+ช้าสุด) เดิมไม่มีเพดานเวลาชั้นใน — โมเดลค้าง = ตายทั้งมุม
- `src/lib/services/summarizeServiceText.js:2043` — ★ 16 ก.ค. 69 (B4): sync สาย URL — เดิมเช็ค === 'library' เป๊ะ ทำงานที่ผ่าน STAGE 2.5
- `src/lib/services/summarizeServiceText.js:2290` — ★ 16 ก.ค. 69 (B4): เพิ่มเพดานเวลาชั้นใน 120s (เดิมไม่มี — พึ่ง outer อย่างเดียว)
- `src/lib/services/summarizeServiceText.js:2766` — ★ 16 ก.ค. 69 (recheck fix): แนบ _matchType/_isBorrowed จริงด้วย — เดิมแนบแค่ _matchScore
- `src/lib/utils/withTimeout.js:37` — ★ 16 ก.ค. 69 (B4): timeout แบบ "หยุดงานจริง" — ของเดิม Promise.race แค่เลิกรอ

## 10 ก.ค. 69 (2026-07-10)

- `src/app/api/queue/add/route.js:155` _(ปีไม่ระบุ)_ — ★ 10 ก.ค. (ผู้ใช้ขอเทสผลลัพธ์ซ้ำ): พิมพ์ "ทำใหม่" นำหน้าข่าว = ตั้งใจสั่งเจนซ้ำ → ข้ามด่าน near-dup 45 นาทีด้านล่าง
- `src/app/api/queue/add/route.js:160` _(ปีไม่ระบุ)_ — ★ ทนเครื่องหมายคำพูด/วงเล็บที่คนก๊อบติดมา เช่น «"ทำใหม่ " เนื้อข่าว» (เคสจริง 10 ก.ค. ผู้ใช้ก๊อบจากข้อความ ⚠️)
- `src/app/api/queue/worker/route.js:86` — ★ 10 ก.ค. 69: Vercel Cron เรียก worker ผ่าน "deployment URL" (มี Vercel Authentication ขวาง)
- `src/lib/correction/outputAuditService.js:53` — ★ 10 ก.ค. 69: เพิ่ม lookbehind (?<!เส้น) — "เส้นเลือด/เส้นเลือดในสมอง" คือศัพท์การแพทย์ ห้ามจับ (เคยถูกแทนเป็น "เส้นร่องรอยเหตุการณ์ในสมองแตก")
- `src/lib/correction/safeCorrectionService.js:126` _(ปีไม่ระบุ)_ — ประโยคเพี้ยนแบบเดียวกับเคส "เส้นร่องรอยเหตุการณ์ในสมองแตก" (10 ก.ค.) ต้องให้ AI เกลาตามบริบท
- `src/lib/services/autoFlowServiceText.js:267` — ★ 300s (10 ก.ค. 69) = inner gpt-5.5 200s + fallback gpt-4o 60s + เผื่อ 40s — ห้ามต่ำกว่าผลรวมชั้นใน ไม่งั้น job ตายทั้งงานทั้งที่ fallback กำลังจะรอด
- `src/lib/services/autoFlowServiceText.js:412` — ★ ปรับ 10 ก.ค. 69 (คำสั่งทีม หลังเคส #01641): default 2 มุม — ฝืนหามุมที่ 3 = พร้อมท์อันดับท้ายธีมผิดเรื่อง
- `src/lib/services/autoFlowServiceText.js:416` — ★ REVERT 10 ก.ค. 69 (เคส #01635): ห้ามเรียงตามคะแนนไวรัล — มุมคะแนนสูงมักเป็นมุมพี่น้องเรื่องเดียวกัน
- `src/lib/services/autoFlowServiceText.js:506` — ★ 10 ก.ค. 69 (เคส #01641 "แม่ยังอยู่"): มุมจริง-แมตช์จริงเท่านั้น — ห้ามฝืนเขียนด้วยพร้อมท์ธีมผิดเรื่อง
- `src/lib/services/summarizeServiceText.js:1566` — เต็มรูปแบบเท่า EXACT → รากเคสจริง "ข่าวมูฟออนถูกเขียนด้วยโครงไว้อาลัย" (10 ก.ค. 69)

## 9 ก.ค. 69 (2026-07-09)

- `src/lib/ai/modelConfig.js:66` — GPT-5.6 (GA 9 ก.ค. 69) — เตรียมไว้สำหรับแผนอัปเกรด B6

## 8 ก.ค. 69 (2026-07-08)

- `src/app/api/queue/worker/route.js:117` _(ปีไม่ระบุ)_ — 🏭 8 ก.ค.: auto-cover-v3 ถอดทิ้ง (ผู้ใช้สั่ง) — งานปก MEGA (composer:'mega') → โรงประกอบใหม่ · อื่นๆ → โรงเดิม v1

## 4 ก.ค. 69 (2026-07-04)

- `src/app/api/queue/add/route.js:169` _(ปีไม่ระบุ)_ — ★ 4 ก.ค. (ผู้ใช้: "Discord ประมวลผลเบิ้ล ให้เหลืออันเดียว"): ด่านกัน "ข่าวเนื้อเดิม/เกือบเดิมส่งซ้ำ" ใน 45 นาที

## 3 ก.ค. 69 (2026-07-03)

- `src/app/api/queue/add/route.js:170` _(ปีไม่ระบุ)_ — หลักฐาน 3 ก.ค.: "บอย ปกรณ์" ถูกส่ง 2 ข้อความห่าง 10 นาที (แก้คำนิดเดียว) → เจน 2 เคส (20:48/20:58)

## 1 ก.ค. 69 (2026-07-01)

- `src/lib/services/queueService.js:264` _(ปีไม่ระบุ)_ — ★ 1 ก.ค. (แก้ปกทำซ้ำ): ปก (เครื่องทีม) ใช้ได้ถึง ~16 นาที → ให้ buffer 25 นาที (เดิม 15 → ปกโดนรีเซ็ตกลางคัน+หยิบซ้ำ)
- `src/lib/services/queueService.js:696` _(ปีไม่ระบุ)_ — ★ 1 ก.ค.: ปก (เครื่องทีม) ใช้ได้ถึง ~16 นาที → ใช้อย่างน้อย 25 นาที (เดิม 10 → ปกโดนรีเซ็ตกลางคัน+หยิบซ้ำ)
- `src/lib/services/viralFewshot.js:28` _(ปีไม่ระบุ)_ _(อ้างถึง "1 ก.ค.")_ — 18 ส.ค. 69 เจ้าของสั่ง "ใช้โค้ดช่วง 12 มิ.ย. – 1 ก.ค." — คืนสูตรนี้เป็นตัวดั้งเดิม e5ba1eb (11 มิ.ย.)

## 30 มิ.ย. 69 (2026-06-30)

- `src/app/api/auto/process/route.js:861` _(ปีไม่ระบุ)_ — ★ 30 มิ.ย.: บันทึก "พร้อมท์ที่ใช้จริง" — ปิดจุดบอด 90% ที่ promptName ว่าง (ตรวจย้อนหลังได้ว่าใช้/ใกล้พร้อมท์ไหน)
- `src/lib/services/autoFlowServiceText.js:1047` _(ปีไม่ระบุ)_ — ★ 30 มิ.ย.: บันทึกพร้อมท์ที่ใช้จริง (ปิดจุดบอด — ท่อ text เดิมไม่บันทึก promptName)

## 27 มิ.ย. 69 (2026-06-27)

- `src/app/api/queue/add/route.js:129` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย. (แก้ Discord เบิ้ลถาวร): ATOMIC CLAIM ตาม msgId — กันแน่นกว่า content-hash
- `src/lib/services/queueService.js:519` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย.: รีเซ็ตงานเครื่องทีมที่ค้างจาก restart ครั้งเดียวตอน module โหลดใหม่
- `src/lib/services/queueService.js:527` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย. (ผู้ใช้สั่ง): auto-reset ตอนเซิร์ฟเวอร์ "เพิ่งสตาร์ท" — งาน "เครื่องทีม" (ปก/ขุดคลิป) ที่ค้าง processing
- `src/lib/services/queueService.js:541` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย. (แก้ "ข่าวล่ม/หมดเวลารอคิว 15 นาที"): ย้ายเช็ค concurrency ไปนับ "แยกตามเครื่อง" (หลัง canRunHere)
- `src/lib/services/queueService.js:552` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย. (ผู้ใช้สั่ง — ปกล่มบน Vercel): "ทุกงานปก" → เครื่องทีมเท่านั้น
- `src/lib/services/queueService.js:568` _(ปีไม่ระบุ)_ — ★ 27 มิ.ย. (ผู้ใช้สั่ง): งานปกที่ sourceLinks เป็นคลิปวิดีโอ "ทุกแพลตฟอร์ม" (YouTube/TikTok ด้วย) → เครื่องทีม

## 26 มิ.ย. 69 (2026-06-26)

- `src/app/api/queue/worker/route.js:158` _(ปีไม่ระบุ)_ — ★ 26 มิ.ย.: route อาจคืนหน้า HTML (timeout/crash ระดับ platform) แทน JSON
- `src/lib/services/queueService.js:561` _(ปีไม่ระบุ)_ — ★ 26 มิ.ย. (ผู้ใช้สั่ง): งานปกที่มีลิงก์แหล่งรูปเป็นคลิป FB/IG → ต้องเครื่องทีม (yt-dlp+ffmpeg แตกเฟรม)

## 25 มิ.ย. 69 (2026-06-25)

- `src/app/api/queue/add/route.js:109` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. (สืบบอทซ้ำ): บันทึก ping — ใคร (instance) ยิงข้อความไหน (msgId) เข้าคิว · เก็บ 30 ล่าสุด
- `src/app/api/queue/add/route.js:235` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย.: บอกบอทว่าเป็นงานซ้ำ → ตัวที่ยิงทีหลังเงียบ ไม่ทำซ้ำ
- `src/lib/services/queueService.js:8` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. (rev.2 — อุดช่องโหว่ขอบเวลา): job id "เสถียรต่อเนื้อหา" (ไม่มี time bucket)
- `src/lib/services/queueService.js:253` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. (rev.2) — job id "เสถียรต่อเนื้อหา" = กันเจนซ้ำข้ามโปรเซส 100% (ไม่มีรูขอบเวลา)
- `src/lib/services/queueService.js:352` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. (rev.2) — ด่านกันซ้ำข้ามโปรเซสด้วย "id เสถียรต่อเนื้อหา" (การันตีเจนรอบเดียว ไม่มีรูขอบเวลา):
- `src/lib/services/queueService.js:418` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. — ถ้าอีกโปรเซสสร้าง id เดียวกันชนะไปก่อน (PK ชน) = ข่าวซ้ำ → ใช้ตัวนั้น ไม่เจนซ้ำ
- `src/lib/services/queueService.js:603` _(ปีไม่ระบุ)_ — ★ 25 มิ.ย. — คว้างานแบบ atomic ระดับ DB (กัน worker 2 ตัวข้ามโปรเซสคว้างานเดียวกัน → เจนซ้ำเปลือง token)

## 24 มิ.ย. 69 (2026-06-24)

- `src/app/api/queue/status/route.js:50` _(ปีไม่ระบุ)_ — ★ 24 มิ.ย.: งานไม่เจอ (เก่าเกิน/ถูกล้าง) — ข้อความที่บอก "ต้องทำอะไรต่อ" แทน "Job not found" ดิบๆ
- `src/app/api/queue/worker/route.js:232` _(ปีไม่ระบุ)_ — 4. งานถัดไป: ★ 24 มิ.ย. (ทางเลือก A — ผู้ใช้เลือก) ตัด self-fetch worker→worker ออก
- `src/lib/services/queueService.js:443` _(ปีไม่ระบุ)_ — ★ 24 มิ.ย.: งานถูกส่งซ้ำ (superseded) → ตามไปงานใหม่ ให้คนที่ poll id เก่าเห็นสถานะงานใหม่

## 21 มิ.ย. 69 (2026-06-21)

- `src/lib/services/summarizeServiceText.js:1783` _(ปีไม่ระบุ)_ _(อ้างถึง "21 มิ.ย.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.
- `src/lib/services/summarizeServiceText.js:2627` _(ปีไม่ระบุ)_ _(อ้างถึง "21 มิ.ย.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดกฎท่อนจบของ 1 ส.ค. คืนของยุคปัง 21 มิ.ย.

## 17 มิ.ย. 69 (2026-06-17)

- `src/app/api/queue/add/route.js:171` _(ปีไม่ระบุ)_ — ช่องโหว่เดิม: dedup เทียบ hash เป๊ะ + งาน "เสร็จแล้ว" ส่งซ้ำ=เจนใหม่ได้เสมอ (ทีมขอ 17 มิ.ย.) → เนื้อเดิมวางซ้ำ = เบิ้ล
- `src/lib/services/queueService.js:346` _(ปีไม่ระบุ)_ — ★ 17 มิ.ย. (ทีมขอ "ส่งใหม่ต้องเจนใหม่ได้เสมอ ไม่ให้ข่าวเสีย"): ตัวกันงานซ้ำแบบฉลาด — ไม่บล็อกถาวร

## 12 มิ.ย. 69 (2026-06-12)

- `src/lib/correction/correctionPipeline.js:25` _(ปีไม่ระบุ)_ _(อ้างถึง "12 มิ.ย.")_ — ★ 12 มิ.ย.: FlagFixer + ViralPolish ถูกปลดออกตามคำสั่งทีม ("AI เพี้ยน — ย้อน workflow กลับแบบ 11 มิ.ย. หัวค่ำ")
- `src/lib/correction/correctionPipeline.js:53` — === ★ Layer 1.5: Flag Fixer (12 มิ.ย. 69) — จุดเดียวที่เห็นทุกเวอร์ชันพร้อมกัน ===
- `src/lib/correction/correctionPipeline.js:55` _(ปีไม่ระบุ)_ _(อ้างถึง "12 มิ.ย.")_ — FlagFixer ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)
- `src/lib/correction/correctionPipeline.js:211` _(ปีไม่ระบุ)_ — ★ ปรับ 12 มิ.ย. (ลูปคุณภาพจับได้): เดิมแทนทุกอย่างด้วย "ที่เกิดเหตุ" ทื่อๆ → ได้คำพิกล
- `src/lib/correction/correctionPipeline.js:330` _(ปีไม่ระบุ)_ _(อ้างถึง "12 มิ.ย.")_ — ViralPolish ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)
- `src/lib/correction/flagFixerService.js:2` — Flag Fixer — ผู้รับธงคุณภาพที่เคยถูกตรวจเจอแล้วปล่อยผ่าน (12 มิ.ย. 69)
- `src/lib/correction/flagFixerService.js:92` _(ปีไม่ระบุ)_ — ★ v3 (12 มิ.ย. — ลูปคุณภาพรอบ 1 จับได้): เวอร์ชันเปิด "ภาพ/มุมเดียวกัน" แม้ใช้คำต่างกัน
- `src/lib/correction/outputAuditService.js:68` — === ★ การพนัน / ยาเสพติด / แอลกอฮอล์ (Meta restricted — เพิ่ม 12 มิ.ย. 69) ===
- `src/lib/correction/safeCorrectionService.js:124` — ★ 12 มิ.ย. 69: กลุ่มการเสียชีวิต + พนัน/ยา/เหล้า ต้องเกลาตามบริบท — แทนคำตรงๆ จะได้สำนวนซ้ำจำเจ/ความหมายเพี้ยน
- `src/lib/correction/viralPolishService.js:2` — Viral Polish — บก.ขัดเงาขั้นสุดท้าย (12 มิ.ย. 69 — ลูปคุณภาพรอบ 4)
- `src/lib/services/autoFlowServiceText.js:182` _(ปีไม่ระบุ)_ — ★ 12 มิ.ย.: กำจัดขยะเว็บก่อนเข้าไลน์ (คำเตือนเบราว์เซอร์/คุกกี้/เมนู/ลิสต์ข่าวแนะนำ) —
- `src/lib/services/autoFlowServiceText.js:551` _(ปีไม่ระบุ)_ — (12 มิ.ย. ทีมสั่งย้อนกลับสูตรนี้ — เวอร์ชันที่ทีมชอบ (#00189) เขียนด้วยสูตรนี้)
- `src/lib/services/queueService.js:269` _(ปีไม่ระบุ)_ — ★ 12 มิ.ย.: คืนเข้าคิวลองใหม่ 1 ครั้งก่อนตีตาย (สอดคล้อง cleanupStaleJobs)
- `src/lib/services/queueService.js:545` — ★ แบ่งงานตามเครื่องแบบไม่ทับซ้อน (12 มิ.ย. 69 — คำสั่งทีม: อุดช่องโหว่ ไม่ให้ทำงานทับซ้อน)
- `src/lib/services/queueService.js:548` _(ปีไม่ระบุ)_ — ที่เกิดจริง 3 รอบเมื่อ 12 มิ.ย. และตัด race สองเครื่องคว้างานเดียวกันไปในตัว)
- `src/lib/services/queueService.js:700` _(ปีไม่ระบุ)_ — ★ 12 มิ.ย.: งานค้าง (เครื่องดับ/deploy คร่อม) ให้ "คืนเข้าคิวลองใหม่ 1 ครั้ง" ก่อน — เดิมตีตายทันที
- `src/lib/services/queueService.js:701` _(ปีไม่ระบุ)_ — (12 มิ.ย. ต้องกู้มือ 2 รอบ) ถ้าค้างซ้ำรอบสองค่อยตีตายจริง (กันงานพังวนลูปไม่จบ)
- `src/lib/services/summarizeServiceText.js:1829` _(ปีไม่ระบุ)_ — และการ์ดจับคู่ 105/201 ใบสั่งเรื่องย่อหน้าแรกอยู่แล้วตั้งแต่ 12 มิ.ย. โดยไม่เคยทำให้ซ้ำซาก
- `src/lib/services/viralFewshot.js:28` _(ปีไม่ระบุ)_ _(อ้างถึง "12 มิ.ย.")_ — 18 ส.ค. 69 เจ้าของสั่ง "ใช้โค้ดช่วง 12 มิ.ย. – 1 ก.ค." — คืนสูตรนี้เป็นตัวดั้งเดิม e5ba1eb (11 มิ.ย.)

## 11 มิ.ย. 69 (2026-06-11)

- `src/app/api/queue/status/route.js:28` _(ปีไม่ระบุ)_ — ★ Self-heal (11 มิ.ย.): ลูกโซ่ worker ขาดได้ (trigger next batch ตาย / server restart)
- `src/app/api/queue/worker/route.js:203` _(ปีไม่ระบุ)_ — ★ FIX (11 มิ.ย.): cover job >5 นาทีโดน undici headersTimeout ("fetch failed") ทั้งที่ pipeline ยังวิ่งจนจบ
- `src/app/api/queue/worker/route.js:206` _(ปีไม่ระบุ)_ — ปัญหาเดิม: ตาข่ายเขียนไว้ตั้งแต่ 11 มิ.ย. ตอนที่มีแต่งานปกยาวเกิน 5 นาที
- `src/lib/correction/correctionPipeline.js:25` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — ★ 12 มิ.ย.: FlagFixer + ViralPolish ถูกปลดออกตามคำสั่งทีม ("AI เพี้ยน — ย้อน workflow กลับแบบ 11 มิ.ย. หัวค่ำ")
- `src/lib/correction/correctionPipeline.js:55` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — FlagFixer ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)
- `src/lib/correction/correctionPipeline.js:330` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — ViralPolish ปลดออก 12 มิ.ย. (คำสั่งทีม — ย้อนกลับ workflow หัวค่ำ 11 มิ.ย.)
- `src/lib/services/autoFlowServiceText.js:160` _(ปีไม่ระบุ)_ — ★ Reels/วิดีโอ Meta (11 มิ.ย. — คลิปข่าวส่วนใหญ่อยู่บน Meta): แคปชันโพสต์ + Whisper ถอดเสียงพากย์
- `src/lib/services/autoFlowServiceText.js:220` _(ปีไม่ระบุ)_ — ★ 120s (was 60s) — โดน timeout จริงบน production (Discord 11 มิ.ย.) เหตุผลเดียวกับ blueprint
- `src/lib/services/queueService.js:225` _(ปีไม่ระบุ)_ — ★ Watchdog ในตัว (11 มิ.ย.): ลูกโซ่ worker ขาดได้ (trigger ตาย/server restart)
- `src/lib/services/summarizeServiceText.js:293` _(ปีไม่ระบุ)_ — --- ★ ตัวเลขหัวใจของข่าว (11 มิ.ย. — GEN-179 V2 ทำ "3 แสน" หายจากเนื้อ) ---
- `src/lib/services/summarizeServiceText.js:340` _(ปีไม่ระบุ)_ — 4.5 ★ ตัวเลขหัวใจข่าวต้องอยู่ในเนื้อ (11 มิ.ย.)
- `src/lib/services/summarizeServiceText.js:366` _(ปีไม่ระบุ)_ — 5.5 ★ Closing/cross-version duplication (11 มิ.ย. — GEN-176/180/181 จบซ้ำคำต่อคำ แต่ระบบเช็คแค่เปิด)
- `src/lib/services/summarizeServiceText.js:1733` _(ปีไม่ระบุ)_ — ★ VIRAL FEW-SHOT (11 มิ.ย. — ผู้ใช้เลือก: เรียนจากหอสมุดไวรัล 170 โพสต์ + สำนวนเพจไวรัลเต็มตัว)
- `src/lib/services/summarizeServiceText.js:1756` _(ปีไม่ระบุ)_ — ★ โหมดทางการ (11 มิ.ย. — บทเรียน GEN-177): ข่าวพระราชวงศ์/พิธีทางการ ห้ามมโนภาพ+คำลำลอง และเก็บประกาศครบ
- `src/lib/services/summarizeServiceText.js:1826` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — ★ 18 ส.ค. 69 (เจ้าของสั่ง "กฎเดิม 11 มิ.ย. เก็บ · กฎใหม่ 16 ส.ค. ลบออก"):
- `src/lib/services/summarizeServiceText.js:1830` _(ปีไม่ระบุ)_ — ⇒ ปล่อยการ์ด+สไตล์ทำหน้าที่เอง · กฎข้อ 9 คงเหลือเฉพาะของเดิม 11 มิ.ย. (4151449) = กฎความสมบูรณ์ของประโยค
- `src/lib/services/viralFewshot.js:5` _(ปีไม่ระบุ)_ — (11 มิ.ย. — ผู้ใช้เลือก: Few-shot ตามหมวด + สำนวนเพจไวรัลเต็มตัว)
- `src/lib/services/viralFewshot.js:28` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — 18 ส.ค. 69 เจ้าของสั่ง "ใช้โค้ดช่วง 12 มิ.ย. – 1 ก.ค." — คืนสูตรนี้เป็นตัวดั้งเดิม e5ba1eb (11 มิ.ย.)
- `src/lib/services/viralFewshot.js:1248` _(ปีไม่ระบุ)_ _(อ้างถึง "11 มิ.ย.")_ — 18 ส.ค. 69 เจ้าของสั่งถอดสูตรบังคับ v2 (721dbf8 14 ส.ค.) + สวิตช์ HOOK_STYLE_MODE (eb6ff50 16 ส.ค.) — คืนสภาพ 11 มิ.ย.

## 10 มิ.ย. 69 (2026-06-10)

- `src/lib/ai/claudeClient.js:24` — ★ 10 มิ.ย. 2026: default → claude-opus-4-8 — สำนวน prose เหนือกว่า Sonnet ชัดเจนจากผล A/B
- `src/lib/ai/claudeClient.js:129` _(ปีไม่ระบุ)_ — ★ SPEED FIX (10 มิ.ย.): Opus 4.x default effort = "high" (คิดลึกสุดทุกครั้ง) → ช้าจน timeout
- `src/lib/ai/modelConfig.js:57` _(อ้างถึง "10 มิ.ย. 2026")_ — ★ อัปเกรด 10 มิ.ย. 2026 (เดิม gpt-4o legacy) — OCR ไทยแม่นขึ้น · ★ 1 ส.ค. 69 โล๊ะ→sol
- `src/lib/services/autoFlowServiceText.js:550` _(ปีไม่ระบุ)_ — ★ HOTFIX (10 มิ.ย.): สไตล์เปิดเรื่องหมุนเวียนต่อ angle — กันทุกเวอร์ชันเปิดเหมือนกัน (ดู autoFlowService.js)
- `src/lib/services/summarizeServiceText.js:300` — 1. Pronoun Balance — ★ ปิดใช้งาน (10 มิ.ย. 2026)
- `src/lib/services/summarizeServiceText.js:305` — 2. Closing Length — ★ ปิดใช้งาน (10 มิ.ย. 2026)
- `src/lib/services/summarizeServiceText.js:517` _(ปีไม่ระบุ)_ — ★ ปรับ 10 มิ.ย.: เดิมใช้ character-bag overlap >80% — เสี่ยงแทนคำไทยผิดแบบเดียวกับ balancePronouns ที่ถูกปิด
- `src/lib/services/summarizeServiceText.js:1512` _(ปีไม่ระบุ)_ — ★ FIX (10 มิ.ย.): เดิมทุก angle ได้ narrativeAngle = best_main_angle ตัวเดียวกัน → เนื้อหา 3 มุมลู่เข้าหากัน
- `src/lib/services/summarizeServiceText.js:1665` — ★ FIX (10 มิ.ย. 2026): ส่งเนื้อข่าวต้นฉบับเข้า compose (ตัดที่ 3000 ตัวอักษร)
- `src/lib/services/summarizeServiceText.js:1711` _(ปีไม่ระบุ)_ — 🔒 ชื่อมุม+คำอธิบาย (${focusAngle}) และ "ห้ามเล่าด้วยมุมอื่น ห้ามผสมหลายมุม" ต้องอยู่เสมอ — กันบั๊ก "2 มุมเหมือนกัน" ที่แก้ไว้ 10 มิ.ย.

## 16 ส.ค. 04 (1961-08-16)

- `src/lib/services/summarizeServiceText.js:1828` — เหตุผล: หลักฐานผลจริง 900 เคส — เปิดด้วยชื่อพุ่ง 17% → 77% ทันทีหลัง 16 ส.ค. 04:04
