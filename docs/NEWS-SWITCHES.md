# NEWS SWITCHES — ทะเบียนสวิตช์ env ของท่อข่าว

> สร้างอัตโนมัติด้วย `node scripts/gen-news-changelog.mjs` จาก `src/lib/config/newsSwitches.js` — **ห้ามแก้ไฟล์นี้ด้วยมือ**
> ด่านตรวจ: `node --test tests/news-switch-registry.test.mjs` (เพิ่ม `process.env.X` ในไฟล์ท่อข่าวโดยไม่ลงทะเบียน = แดง)
> คีย์ลับ/ที่อยู่ (ชื่อเข้ารูป `(_KEY|_SECRET|_URL|_TOKEN|_PASSWORD|_DSN)$`) ไม่ใช่สวิตช์ ไม่อยู่ในทะเบียน

สวิตช์ทั้งหมด: 101 ตัว · ไฟล์ที่สแกน: 43 ไฟล์

## วิธีอ่าน

- **ค่าเริ่มต้น** = ค่าเมื่อไม่ตั้ง env (ว่าง = ไม่ตั้ง) · **ค่าที่รับ** = ค่าที่โค้ดรู้จัก (สวิตช์ 0/1 ส่วนใหญ่รับตรงตัว ยกเว้นที่ระบุว่าทน on/off)
- **ถอยกลับ** = วิธีคืนพฤติกรรมเดิม · **ตั้งแต่** = วันที่จากคอมเมนต์ในโค้ด (ถ้าไม่มีใช้วันที่ commit แรกที่ปรากฏ)
- ขอบเขตการสแกน = ไฟล์ใน `NEWS_SWITCH_FILES` (สาย TEXT + ด่านแก้ไข + คิว + ไคลเอนต์/ประตูที่มีแต่สวิตช์ข่าว) · ไฟล์ร่วมกับระบบคลิป (geminiClient.js) และสาย URL (promptStore.js/summarizeService.js) ไม่สแกน แต่ยังต้องปรากฏใน "อ่านโดย" ตามจริง (เทสตรวจว่าอ่านจริงทุกไฟล์ที่ระบุ)
- helper ที่อ่าน env แบบตามชื่อไม่ได้ (`process.env[ตัวแปร]`) อนุญาตเฉพาะ: `src/lib/utils/envFlag.js` (envOn/envStr) · `src/lib/ai/promptModes.js` (readToken/isDefaultOnSwitch) · `src/lib/services/viralFewshot.js` (_envTok) · `src/lib/services/summarizeServiceText.js` (_numEnv) · `src/lib/ai/cardAuthority.js` (isSwitchEnabled) · `src/lib/utils/newsCap.js` (newsForStage) — ที่อื่นเทสแดง

## มุมข่าว/โครงเรื่อง

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `GEN_ANGLES` | `2` | 1 · 2 · 3 · 4 | จำนวนมุมข่าวที่เจนต่อข่าว (เพดาน 1-4 ใช้สูตรเดียวกันทั้ง MULTI-ANGLE และ per_angle) | `src/lib/services/autoFlowServiceText.js` | 10 ก.ค. 69 (รวมศูนย์ getGenAnglesCount 19 ส.ค. 69) | ลบ env = 2 มุม |
| `GEN_PER_ANGLE` | `1` | 1 · 2 · 3 | จำนวนเวอร์ชันที่เขียนต่อมุม | `src/lib/services/autoFlowServiceText.js` | 10 มิ.ย. 69 | ลบ env = 1 เวอร์ชัน/มุม |
| `ANGLE_MIN_MATCH_SCORE` | `45` | จำนวนเต็ม ≥ 0 | คะแนนจับคู่การ์ดขั้นต่ำ ต่ำกว่านี้มุมนั้นใช้ Built-in Fallback แทนการ์ดจากคลัง (promptMatcher ใช้ค่าเดียวกันเป็นพื้นกันตกของวงคะแนน PROMPT_VARIETY_BAND) | `src/lib/services/autoFlowServiceText.js`<br>`src/lib/services/promptMatcher.js` | 10 ก.ค. 69 | ลบ env = 45 |
| `ANGLE_CARD_CONTEXT` | `1` | 0 · 1 | ส่งข้อมูลการ์ดที่มุมก่อนหน้าใช้ไปให้ตัวเลือกการ์ดของมุมถัดไป (แบบ 2 — กันซ้ำการ์ด) | `src/lib/services/autoFlowServiceText.js`<br>`src/lib/services/summarizeServiceText.js` | 18 ส.ค. 69 | ANGLE_CARD_CONTEXT=0 |
| `ANGLE_CLOSING_SPLIT` | `0` | 0 · 1 | แยกแผนจบรายมุม ไม่ให้ท่อนจบของ 2 มุมออกมาแฝดกัน (autoFlow/narrativePayloadText อ่าน =1 ตรงตัว · summarize อ่านผ่าน envOn) | `src/lib/services/autoFlowServiceText.js`<br>`src/lib/services/summarizeServiceText.js`<br>`src/lib/input-engine/narrativePayloadText.js` | 18 ส.ค. 69 (แบบ ก) | ลบ env หรือ =0 = แผนจบเดิมใบเดียวแชร์ทุกมุม |
| `ANGLE2_BY_SCORE` | `0` | 0 · 1 | มุมที่ 2 เลือกตามคะแนนไวรัลแทนลำดับเดิม (จุดหั่นมุม 3 จุดสลับพร้อมกันด้วยสวิตช์เดียว) | `src/lib/services/autoFlowServiceText.js` | 19 ส.ค. 69 | ลบ env หรือ =0 = เดินโค้ดเดิม |
| `ANGLE_BLUEPRINT_MODE` | `(ว่าง)` |  · per_angle | =per_angle วาง Blueprint หนึ่งใบต่อหนึ่งมุม (แบบ A) · ค่าอื่น/ว่าง = Blueprint ใบเดียวเหมือนเดิม (narrativePayloadText อ่านซ้ำเพื่อตัด "ปิด:" ตามตราประทับมุม) | `src/lib/services/autoFlowServiceText.js`<br>`src/lib/services/summarizeServiceText.js`<br>`src/lib/input-engine/narrativePayloadText.js` | 18 ส.ค. 69 | ลบ env |
| `TIMELINE_FLOW_MODE` | `(ว่าง)` |  · natural | =natural เติมคำแนะนำ "หลัง HOOK ไล่ตามลำดับเวลาจริง" ในใบสั่งเขียน · ค่าอื่นประกอบ prompt เดิมทุกไบต์ | `src/lib/services/summarizeServiceText.js` | 21 ส.ค. 69 (a56d011a) | ลบ env |
| `REF_WEIGHT_BY_MATCH` | `0` | 0 · 1 | ลดน้ำหนักการยึด ref ตามคุณภาพจับคู่ (BORROWED ไม่ถูกบังคับเท่า EXACT) — B5 | `src/lib/services/autoFlowServiceText.js`<br>`src/lib/services/summarizeServiceText.js` | 16 ก.ค. 69 | ลบ env หรือ =0 = พฤติกรรมเดิม |
| `OPENING_FAMILY_CONTRACT` | `0` | 0 · 1 | =1 กลับไปบังคับ "ตระกูลวิธีเปิดเรื่อง" ต่อมุมแบบก่อน 2 ก.ย. · ค่าเริ่มต้น = เลิกบังคับตระกูล (เจ้าของเคาะหลังศึกโมเดล 7 แขน) | `src/lib/services/autoFlowServiceText.js` | 2 ก.ย. 69 | OPENING_FAMILY_CONTRACT=1 = พฤติกรรมก่อน 2 ก.ย. |
| `OPENING_IDENTITY_RULE` | `1` | 0 · 1 | เติมกติกา "ภายในสองประโยคแรกคนอ่านต้องรู้ว่าเรื่องของใคร/อะไร" ในสัญญาเปิดเรื่องทุกมุม | `src/lib/services/autoFlowServiceText.js` | 2 ก.ย. 69 | OPENING_IDENTITY_RULE=0 |
| `ANGLE2_DISTINCT_V2` | `1` | 0 · 1 | จัดสรร key_points ให้แต่ละมุม "เล่าเต็ม" ไม่ซ้ำกันก่อนยิงขนาน (isAngle2DistinctV2Enabled อ่าน !== "0" = ค่าเริ่มต้นเปิด) · =0 ข้อความส่งนักเขียนเหมือนเดิมทุกไบต์ | `src/lib/services/autoFlowServiceText.js` | 2 ก.ย. 69 (เคสศรราม 2 มุมซ้ำ 38-42%) | ANGLE2_DISTINCT_V2=0 |

## นักเขียน/ใบสั่งเขียน

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `WRITER_SOURCE_CHARS` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร | เพดานตัวอักษรเนื้อดิบที่ส่งให้นักเขียน — ตัวอ่านที่วิ่งจริงคือ newsForStage('WRITER') ใน newsCap.js (ไม่ตั้ง = ไม่จำกัด · fallback 0) · _writerSourceText ใน summarizeServiceText (เพดาน 12000) ยังอยู่ในไฟล์แต่ไม่มีใครเรียก — ทะเบียนเดิมบอก 12000 ผิดจากโค้ดที่วิ่ง (แก้ 2 ก.ย. 69 รอบยืนยัน) | `src/lib/services/summarizeServiceText.js`<br>`src/lib/utils/newsCap.js` | 16 ส.ค. 69 | WRITER_SOURCE_CHARS=3000 = เพดานยุค 10 มิ.ย. 69 · ตั้งตัวเลขใดก็ได้เพื่อจำกัดกลับ |
| `CARD_PICK_NEWS_CHARS` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร | เพดานเนื้อข่าวที่ "สมองเลือกการ์ด" ได้อ่าน (เดิมตัด 400 ตัวอักษรฝังไว้ยุคแรก) — อ่าน 2 จุด: _cardPickNewsText ใน summarizeServiceText และ newsForStage('CARD_PICK') ใน newsCap ทั้งคู่ไม่ตั้ง = ไม่จำกัด | `src/lib/services/summarizeServiceText.js`<br>`src/lib/utils/newsCap.js` | 16 ส.ค. 69 | CARD_PICK_NEWS_CHARS=400 = เพดานเดิมยุคแรก |
| `PARA_CAP_ENFORCE` | `1` | 0 · 1 | บังคับเพดานย่อหน้าเชิงโค้ด: เกินเพดานแล้วยุบย่อหน้าท้ายสั้น (≤160 ตัว) เข้าย่อหน้าก่อนหน้า | `src/lib/services/summarizeServiceText.js` | 4 ส.ค. 69 | PARA_CAP_ENFORCE=0 |
| `VIRAL_HITS_FORMULA` | `1` | 0 · 1 | "สูตรแสนไลก์" — ถ่วงการหยิบครูด้วยไลก์จริง + บรรทัดห้ามสำนวนบอกความรู้สึก (+ ทางแยกความยาว 250-350 ในโหมดถอย LEGACY) | `src/lib/services/summarizeServiceText.js`<br>`src/lib/services/viralFewshot.js` | 14 ส.ค. 69 ค่ำ | VIRAL_HITS_FORMULA=0 = สูตรเดิมทั้งชุด |
| `FEELING_ECHO` | `0` | 0 · 1 | =1 ปลดแบนสำนวนบอกความรู้สึกเฉพาะบรรทัดสูตรแสนไลก์ (หลักฐานโพสต์ 155,321 ไลก์ใช้ "ใครเห็นก็จุกในอก") | `src/lib/services/summarizeServiceText.js` | 19 ส.ค. 69 | ลบ env = ข้อความเดิมทุกไบต์ |
| `HOOKS_OBJ_FIX` | `1` | 1 · 0 (รับ 0/off/false/no) | ตัวแปลงกลาง object → ข้อความสำหรับช่องที่ขั้นแตกประเด็นคืนเป็น object (best_sections/pain_points/emotional_hooks/quotes) — กัน "[object Object]" เข้าใบสั่งเขียน · isObjFixEnabled อ่าน ?? "" แล้วว่าง = เปิด | `src/lib/utils/objText.js` | 19 ส.ค. 69 (a56d011a) | HOOKS_OBJ_FIX=0 = ต่อสตริงตรงแบบเดิม |
| `HOOKS_AS_OPENERS` | `0` | 0 · 1 | =1 แตก "จุดที่คนอิน" (emotional_hooks) เป็นรายการแยกบรรทัดพร้อมกำกับว่าเป็นวัตถุดิบไม่บังคับ — กันนักเขียนลอกยกพวงไปเปิดเรื่อง · ค่าเริ่มต้น = บรรทัดเดิม "a \| b \| c" ทุกไบต์ | `src/lib/input-engine/narrativePayloadText.js` | 19 ส.ค. 69 (a56d011a — สเปคเฟเบิ้ล-สุด) | ลบ env |
| `ALLOW_SIMULATION` | `0` | 0 · 1 (รับ 1/true/on ไม่สนตัวพิมพ์/อัญประกาศ) | =1 คืนคำแนะนำเสริม "อนุญาตยกตัวอย่างสถานการณ์จำลอง" ในใบสั่งเขียน (ข้อความต่างกันตามโหมด LEGACY_LENGTH_RULES) · ค่าเริ่มต้น = ริบใบอนุญาตแต่งสถานการณ์ (การ์ดมีอำนาจเหนือ) | `src/lib/input-engine/narrativePayloadText.js` | 16 ส.ค. 69 (9b9a689b) | ลบ env |
| `FORCE_LESSON_ANGLE` | `0` | 0 · 1 | =1 คืนกฎเก่า "ทุกข่าวต้องหามุมดี/บทเรียนอย่างน้อย 1 จุด" · ค่าเริ่มต้น = ห้ามยัดข้อคิดที่ต้นฉบับไม่มี (เจ้าของสั่ง) — สาย TEXT อ่านที่ promptStoreText · สาย URL อ่านที่ promptStore/summarizeService (ไฟล์สาย URL ไม่อยู่ในชุดสแกน) | `src/lib/ai/promptStoreText.js`<br>`src/lib/ai/promptStore.js`<br>`src/lib/services/summarizeService.js` | 1 ส.ค. 69 | FORCE_LESSON_ANGLE=1 = กฎบังคับข้อคิดแบบเดิม |
| `EXTRACT_FACT_LOCK` | `0` | 0 · 1 | =1 เติมกฎ FACT ANCHOR (ความจริงขั้นสกัด มีอำนาจเหนือคำสั่งเพิ่มเติม) ในขั้น extract | `src/lib/services/summarizeServiceText.js` | 21 ส.ค. 69 (a56d011a) | ลบ env |
| `WORD_FLEX_V2` | `1` | 0 · 1 | สูตรเพดานคำโตตามเนื้อดิบ — มีผลเฉพาะโหมดถอย LEGACY_LENGTH_RULES=1 (โหมดปกติไม่แตะ) | `src/lib/services/summarizeServiceText.js` | 16 ส.ค. 69 | WORD_FLEX_V2=0 |
| `WORD_FLOOR` | `165` | จำนวนคำ > 0 | พื้นจำนวนคำของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY) | `src/lib/services/summarizeServiceText.js` | 16 ส.ค. 69 | ลบ env = 165 |
| `WORD_CAP_BASE` | `350` | จำนวนคำ > 0 | ฐานเพดานคำของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY) | `src/lib/services/summarizeServiceText.js` | 16 ส.ค. 69 | ลบ env = 350 |
| `WORD_CAP_RATIO` | `0.75` | สัดส่วน > 0 | สัดส่วนเพดานคำต่อเนื้อดิบของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY) | `src/lib/services/summarizeServiceText.js` | 16 ส.ค. 69 | ลบ env = 0.75 |
| `WORD_CAP_MAX` | `900` | จำนวนคำ > 0 | เพดานคำสูงสุดของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY) | `src/lib/services/summarizeServiceText.js` | 16 ส.ค. 69 | ลบ env = 900 |
| `WRITER_LENGTH_TARGET_V2` | `1` | 0 · 1 | บล็อกความยาวเป้าหมาย 150–190 คำ (ยืดถึง 220 เฉพาะข่าวหลายเหตุการณ์) + ลำดับการตัด + ของห้ามตัด ในโซนกฎคงที่ก่อน FINAL RAW AUTHORITY — เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69 หลัง A/B รอบ 3 (P2len 36.9 vs base 36.2 · โหวตแย่สุด 1 vs 6) · อ่าน !== "0" | `src/lib/services/writerPolicyText.js` | 2 ก.ย. 69 (เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69) | WRITER_LENGTH_TARGET_V2=0 = ใบสั่งเดิมไบต์ต่อไบต์ |
| `WRITER_FIDELITY_RULES_V2` | `1` | 0 · 1 | บล็อกความซื่อตรง: ห้ามแต่งการกระทำ/ความคิด/ท่าทาง/ความต่างที่ต้นฉบับไม่บอก ("ไม่ได้ดุ" "นั่งลงคุย") · ห้ามเดาเพศ/บทบาท (ใช้ชื่อหรือ "เจ้าตัว") · ตีความอารมณ์ ≤ 1 ประโยค/ย่อหน้า + เตือนซื่อตรงติดเนื้อดิบ — เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69 หลัง A/B รอบ 3 (โหวตแย่สุด 1 vs 6) · อ่าน !== "0" | `src/lib/services/writerPolicyText.js` | 2 ก.ย. 69 (เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69) | WRITER_FIDELITY_RULES_V2=0 = ใบสั่งเดิมไบต์ต่อไบต์ |
| `WRITER_VIRAL_RULES_V2` | `1` | 0 · 1 | บล็อก "กฎจากโพสต์ปังจริง" จาก data/writer-viral-rules.json ({version, rules[{id,text,evidence}]} — เติมข้อได้โดยไม่แตะโค้ด) · ไฟล์หาย/พัง/ว่าง = ไม่ใส่บล็อก — เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69 หลัง A/B รอบ 3 (tightness 7.5 vs 6.6) · อ่าน !== "0" ⚠️ ไฟล์อยู่ใน outputFileTracingIncludes ครบ 4 route แล้ว (ยืนยัน 3 ก.ย. 69) | `src/lib/services/writerPolicyText.js` | 2 ก.ย. 69 (เปิดเป็นค่าเริ่มต้น 3 ก.ย. 69) | WRITER_VIRAL_RULES_V2=0 = ใบสั่งเดิมไบต์ต่อไบต์ |
| `WRITER_PROMPT_CACHE_V2` | `0` | 0 · 1 | =1 แตกใบสั่งเขียนเป็น 2 ก้อนส่งเป็น promptBlocks ของ callClaude: [กฎคงที่+JSON cache:true] แล้ว [RAW-first + การ์ด/ครู/ประเด็น + FINAL RAW AUTHORITY ท้าย] (aiRouter ส่งต่อเฉพาะสาย Claude · Sol ใช้สตริงเดิม) · ค่าเริ่มต้น = RAW-first สตริงเดียวเหมือนเดิม | `src/lib/services/writerPolicyText.js` | 2 ก.ย. 69 | ลบ env หรือ =0 = การเรียกนักเขียนเดิมทุกไบต์ (ไม่มีคีย์ promptBlocks) |
| `WRITER_TRIM_PASS` | `0` | 0 · 1 | =1 ฉบับที่ยาวเกิน 220 คำ ให้ luna ตัดเฉพาะประโยคที่ไม่มีข้อเท็จจริงใหม่เหลือ ~180 คำ ก่อน correctionPipeline (งบ 25s) · fail-safe: ข้อเท็จจริงหายเพิ่ม/สั้นกว่า 146/AI ล้ม/หมดเวลา = ใช้ร่างเดิม (ผลใน version._trimPass) · ค่าเริ่มต้น = ไม่ยิง | `src/lib/services/autoFlowServiceText.js` | 2 ก.ย. 69 | ลบ env หรือ =0 = ไม่มีขั้นนี้ (เวอร์ชันเข้าด่านแก้ไขเหมือนเดิม) |

## สมองเลือกการ์ด

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `CARD_PICKER_AI` | `1` | 0 · 1 | ให้ AI เลือกการ์ดจาก top-8 ทุกกรณี (เดิมเฉพาะ BORROWED) · =0 คืนพฤติกรรมเดิม | `src/lib/services/summarizeServiceText.js` | 1 ส.ค. 69 | CARD_PICKER_AI=0 |
| `CARD_PICKER_MODEL` | `(ว่าง)` | model id (ว่าง = gpt-5.6-luna) | โมเดลสมองเลือกการ์ดสาย A (บรรณารักษ์สารบัญ) และสำรองของสาย B · ขึ้นต้น claude- จะวิ่ง callClaude | `src/lib/services/summarizeServiceText.js` | 1 ส.ค. 69 (สาย claude 15 ส.ค. 69) | ลบ env = gpt-5.6-luna |
| `CARD_PICKER_MODEL_B` | `(ว่าง)` | model id (ว่าง = ตาม CARD_PICKER_MODEL → gpt-5.6-luna) | โมเดลด่านเคาะสาย B (เลือก 1 จากผู้เข้ารอบ) | `src/lib/services/summarizeServiceText.js` | 15 ส.ค. 69 | ลบ env |
| `CARD_PICKER_EFFORT_A` | `low` | low · medium · high | ระดับคิดของ Claude สาย A (บรรณารักษ์สารบัญ) | `src/lib/services/summarizeServiceText.js` | 15 ส.ค. 69 | ลบ env = low |
| `CARD_PICKER_EFFORT_B` | `medium` | low · medium · high | ระดับคิดของ Claude สาย B (ด่านเคาะ) | `src/lib/services/summarizeServiceText.js` | 15 ส.ค. 69 | ลบ env = medium |
| `CARD_PICKER_B_TIMEOUT_MS` | `35000` | มิลลิวินาที > 0 | เพดานเวลาด่านเคาะสาย B (AbortController ตัดสายจริง) | `src/lib/services/summarizeServiceText.js` | 15 ส.ค. 69 | ลบ env = 35000 |
| `CARD_PICKER_CACHE` | `1` | 0 · 1 | แตกพรอมต์บรรณารักษ์เป็นก้อนคงที่ (หัว+สารบัญ) เพื่อใช้ส่วนลดแคชพรอมต์ Claude | `src/lib/services/summarizeServiceText.js` | 15 ส.ค. 69 | CARD_PICKER_CACHE=0 |
| `CARD_CATALOG_ALL` | `1` | 0 · 1 | บรรณารักษ์อ่านสารบัญการ์ดทั้งคลังครั้งเดียวต่อข่าว แล้วมุมถัดไปใช้โผแคช | `src/lib/services/summarizeServiceText.js` | 1 ส.ค. 69 | CARD_CATALOG_ALL=0 |
| `CARD_CATALOG_RICH` | `1` | 0 · 1 | สารบัญการ์ดแบบข้อมูลเต็ม (บรรณารักษ์เห็นข้อมูลการ์ดชัด) | `src/lib/services/summarizeServiceText.js` | 18 ส.ค. 69 | CARD_CATALOG_RICH=0 |
| `PICKER_FULL_CARD` | `1` | 0 · 1 | ด่านเคาะ 14→1 เห็นการ์ดเต็มใบแทนย่อ | `src/lib/services/summarizeServiceText.js` | 18 ส.ค. 69 | PICKER_FULL_CARD=0 |
| `PROMPT_VARIETY_BAND` | `0` | 0 = ปิด (แชมป์คะแนนสูงสุดเสมอ) · 1-8 (แนะนำ 5 · เกิน 8 ถูกตัดที่ 8) | "วงคะแนนใกล้แชมป์" ใน promptMatcher — สุ่มหยิบการ์ดจากใบที่คะแนนห่างแชมป์ไม่เกินค่านี้ (ไม่ต่ำกว่าพื้น ANGLE_MIN_MATCH_SCORE) กระจายการใช้การ์ดที่คะแนนสูสี · Number(env) \|\| 0 = ค่าเริ่มต้นปิด | `src/lib/services/promptMatcher.js` | 26 ก.ค. 69 (39062195 — เจ้าของเคาะ) | ลบ env = พฤติกรรมเดิม 100% (ไม่มีสถานะสะสม) |

## ครูตัวอย่างไวรัล

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `VIRAL_STYLE_PACK` | `1` | 0 · 1 | ส่ง VIRAL STYLE PACK (สูตรบังคับ 5 ข้อ) เข้าพรอมต์นักเขียน · =0 ใช้เฉพาะตัวอย่างครู | `src/lib/services/viralFewshot.js` | 11 มิ.ย. 69 | VIRAL_STYLE_PACK=0 |
| `VIRAL_ROTATE` | `1` | 0 · 1 | สุ่มครูถ่วงน้ำหนักจากโผทั้งหมวด แทนหยิบ 2 ใบไลก์สูงสุดตายตัว | `src/lib/services/viralFewshot.js` | 8 ส.ค. 69 | VIRAL_ROTATE=0 |
| `VIRAL_MATCH_MODE` | `(ว่าง)` |  · ai · score | วิธีจับคู่ครู: ai = บรรณารักษ์ luna อ่านเนื้อ+บัตรลักษณะ · score = คะแนนแมชโค้ดล้วน · ว่าง/ค่าอื่น = สุ่มทั้งหมวด | `src/lib/services/viralFewshot.js` | 10 ส.ค. 69 (เจ้าของเคาะค่าเริ่มต้น=สุ่ม 14 ส.ค. 69) | ลบ env = สุ่มทั้งหมวด |
| `VIRAL_EXAMPLE_CHARS` | `1300` | 300-3000 | เพดานตัวอักษรต่อครู 1 ใบ (1300 = ครูครบทั้งใบ 100%) | `src/lib/services/viralFewshot.js` | 16 ส.ค. 69 | VIRAL_EXAMPLE_CHARS=700 (ห้าม =0 — จะถูกดันขึ้นพื้น 300) |
| `VIRAL_SHORTLIST` | `0` | 0 · 1 (รับ 1/true/on/yes) | ชั้นคัดโผครู K ใบด้วยสัญญาณเนื้อข่าวก่อนสุ่ม (ค่าจริงบน production 24 ส.ค. = 1 ตามสมุดสวิตช์) | `src/lib/services/viralFewshot.js` | 16 ส.ค. 69 | ลบ env หรือ =0 |
| `VIRAL_SHORTLIST_K` | `8` | 6-40 | ขนาดโผของชั้นคัด (พื้น 6 กัน "ครูตายตัว") | `src/lib/services/viralFewshot.js` | 16 ส.ค. 69 | ลบ env = 8 |
| `CARD_TEACHER_MATCH` | `0` | 0 · 1 (รับ 1/true/on/yes) | "การ์ดนำทางครู" — ส่งป้ายสาระการ์ดที่เลือกเข้าตัวคัดโผครู (ทำงานคู่ VIRAL_SHORTLIST · production เปิด 24 ส.ค.) | `src/lib/services/viralFewshot.js` | 24 ส.ค. 69 | ลบ env = ระบบเดิม 100% |
| `VIRAL_TEACHER_GUIDE` | `0` | 0 · 1 | =1 เติมคำแนะนำจากครู (teacher guide) ให้มุมที่มีสิทธิ์ (teacherGuideEligible) | `src/lib/services/viralFewshot.js` | 21 ส.ค. 69 (a56d011a) | ลบ env |
| `TEACHER_RANK_V2` | `1` | 0 · 1 | กติกาหยิบครูใหม่ rank-v2 (แมตช์ก่อน แล้วยอดสูงนำ — src/lib/services/teacherRank.js) · =0 คืน weightedSample เดิมทุกไบต์ | `src/lib/services/viralFewshot.js` | 2 ก.ย. 69 | TEACHER_RANK_V2=0 |
| `LIB_CLASSIFIER_V2` | `1` | 0 · 1 | แมปหมวดคลังครูจากช่อง breakdown (resolveLibraryCategory) แทนคีย์เวิร์ดอย่างเดียว · =0 คืน pickLibraryCategory เดิม | `src/lib/services/viralFewshot.js` | 2 ก.ย. 69 | LIB_CLASSIFIER_V2=0 |

## โหมดถ้อยคำ (promptModes)

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `STYLE_PACK_V2` | `1` | 1 · 0 (รับ 0/off/false/no) | วลีลายเซ็นชุดใหม่ใน VIRAL STYLE PACK ข้อ 3 (ถอด "ขอนับถือใจ…" เก็บ "ไม่แปลกใจเลยที่…/ใครจะคิดว่า…") | `src/lib/ai/promptModes.js` | 20 ส.ค. 69 (R3 ข้อ 1) | STYLE_PACK_V2=0 = ข้อ 3 กลับเป็นไบต์เดิม |
| `ENDING_MODE` | `truth` | truth · plain | ท่อนจบข่าว: truth = จบด้วยสัจธรรมที่ผูกกับเรื่อง · plain = จบบรรยายเรียบไม่ตีความ (ค่าขยะ = truth) | `src/lib/ai/promptModes.js` | 20 ส.ค. 69 (R3 ข้อ 2) | ลบ env = truth · สลับเป็น plain ได้ตามที่เจ้าของสำรองไว้ |
| `WITNESS_FACTLOCK` | `1` | 1 · 0 (รับ 0/off/false/no) | บทบาท "ผู้เห็นเหตุการณ์" + PROSE CRAFT ข้อ "ภาพ" ใช้ได้เฉพาะรายละเอียดที่ต้นฉบับมีจริง | `src/lib/ai/promptModes.js` | 21 ส.ค. 69 (R3 ข้อ 3) | WITNESS_FACTLOCK=0 = ข้อความกลับเป็นไบต์เดิม |

## อำนาจการ์ด (cardAuthority)

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `CARD_AUTHORITY` | `0` | 0 · 1 | สวิตช์แม่: =1 ปลดกฎบังคับทุกข้อ (R2-RXC) ให้การ์ดมีอำนาจเหนือกฎกลาง | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env |
| `CARD_AUTH_URL` | `0` | 0 · 1 | ประตูเพิ่มสำหรับสาย URL: R2/R3 จะมีผลในสาย URL ต่อเมื่อเปิดตัวนี้ด้วย | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env |
| `CARD_AUTH_R2` | `0` | 0 · 1 | R2: ปลดกฎบังคับลำดับ timeline (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R3` | `0` | 0 · 1 | R3: ปลดกฎสาย URL ข้อ 3 (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R4` | `0` | 0 · 1 | R4: ปลดคำสั่งเปิดย่อหน้าแรกด้วย hook ที่กำหนด (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R5A` | `0` | 0 · 1 | R5A: ปลดหัวประกาศอำนาจและเป้าอารมณ์ positive reframing (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R5B` | `0` | 0 · 1 | R5B: ปลดข้อบังคับเปลี่ยนมุมข่าวเสียชีวิต (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R6` | `0` | 0 · 1 | R6: ปลดกฎห้ามเปิดด้วยวันที่ (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R7` | `0` | 0 · 1 | R7: ปลด VIRAL STYLE PACK ข้อบังคับเลือก hook (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_R8` | `0` | 0 · 1 | R8: ปลด VIRAL STYLE PACK ข้อบังคับจบด้วยสัจธรรม (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |
| `CARD_AUTH_RXC` | `0` | 0 · 1 | RXC: ปลดเฉพาะท่อนที่บังคับทุกองค์ประกอบให้รับใช้มุมเดียว (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้) | `src/lib/ai/cardAuthority.js` | 21 ส.ค. 69 (a56d011a) | ลบ env หรือค่าอื่นที่ไม่ใช่ 1 |

## ด่านแก้ไข/ตรวจ

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `SKIP_CORRECTION` | `0` | 0 · 1 (รับ 1/true/on/yes) | ข้ามท่อแก้ไขทั้งหมด (correction pipeline) — ใช้เฉพาะดีบัก | `src/lib/correction/correctionPipeline.js` | 1 มิ.ย. 69 (ตัวอ่านทน on/true 1 ก.ย. 69) | ลบ env |
| `FAB_GATE` | `0` | 0 · 1 (รับ 1/on/true/yes) | ด่านจับ "แต่งเรื่องเกินต้นฉบับ" (fabrication gate) — ปิดอยู่เป็นค่าเริ่มต้น | `src/lib/correction/fabricationGate.js` | 4 ส.ค. 69 | ลบ env |
| `FAB_GATE_FIX_MODEL` | `claude-opus-5` | model id | โมเดลเย็บแผลของ fabrication gate | `src/lib/correction/fabricationGate.js` | 15 ส.ค. 69 | FAB_GATE_FIX_MODEL=claude-opus-4-8 |
| `CORRECTION_MIN_KEEP` | `0.75` | (0, 1] | สัดส่วนแก่นเรื่องขั้นต่ำที่ต้องคงไว้หลังแก้ไข (core guard) — นอกช่วง = ใช้ 0.75 | `src/lib/correction/safeCorrectionService.js` | 1 ส.ค. 69 | ลบ env = 0.75 |
| `MISSING_FACTS_GATE` | `1` | 0 · 1 | L4.7 ด่านข้อเท็จจริงหาย — เทียบต้นฉบับดิบกับผลสุดท้ายแล้วเตือนใน _missingFacts (เตือนเท่านั้น ไม่แก้เนื้อ · fail-open) · runMissingFactsGate อ่าน === "0" = ค่าเริ่มต้นเปิด | `src/lib/correction/correctionPipeline.js` | 2 ก.ย. 69 (เคสศรราม "ห่วงเรื่องการขับรถ" หาย) | MISSING_FACTS_GATE=0 = ไม่ทำอะไร (ผลลัพธ์เหมือนเดิมทุกไบต์) |
| `RAW_FACT_COMPLETENESS_GATE` | `1` | 0 · 1 | ด่าน Sol ตรวจความครบของข้อเท็จจริงจากเนื้อดิบ (สาย TEXT เท่านั้น — autoFlowServiceText เรียก isRawFactCompletenessGateEnabled) · โค้ดอ่าน ?? "1" !== "0" = ค่าเริ่มต้นเปิด ⚠️ production ตั้ง =0 โดยเจตนา (สมุดสวิตช์ 24 ส.ค. 69: RAW_FACT=0) | `src/lib/services/rawFactCompletenessGate.js` | 21 ส.ค. 69 (a56d011a) | RAW_FACT_COMPLETENESS_GATE=0 = ข้ามด่าน (log "ปิดด่าน Sol ตรวจ RAW ชั่วคราว") |
| `VIRAL_SCORE_ANNOTATE` | `0` | 0 · 1 | =1 แนบคะแนน "โอกาสปัง" ต่อฉบับใน version._viralScore ({score 0-100 เปอร์เซ็นไทล์, band, bandLabel สูง/กลาง/ต่ำ, predictedReactions, topDrivers, warnings, modelVersion}) หลังเนื้อสุดท้ายนิ่งทุกสาขา (หลัง correction/factual editor/length gate ก่อนประกอบ response) — ridge ในเครื่องจาก data/viral-score-model.json (Spearman 0.30) ไม่ยิง API · คำเตือนให้พนักงาน ไม่ใช่คำตัดสิน (บอทแสดง "🔥 โอกาสปัง: สูง (72/100)") · โมเดลไม่มี/คำนวณล้ม = ไม่แนบคีย์ ไม่ล้มท่อ ⚠️ บน Vercel ไฟล์โมเดลต้องอยู่ใน outputFileTracingIncludes (next.config.mjs — เพิ่มครบ 4 route แล้ว) | `src/lib/services/autoFlowServiceText.js` | 2 ก.ย. 69 (เฟส 3) | ลบ env หรือ =0 = ไม่ import โมดูล ไม่มีคีย์ _viralScore (response เดิมทุกไบต์) |

## ความยาว/กฎถอย

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `LEGACY_LENGTH_RULES` | `0` | 0 · 1 (รับ 1/true/on/yes) | โหมดถอยกฎความยาวเดิม (89df00a) ทั้งชุด — ค่าเริ่มต้นคือกฎใหม่หลัง 17 ส.ค. | `src/lib/ai/legacyLengthRules.js` | 17 ส.ค. 69 | ลบ env |
| `LENGTH_BY_CONTENT` | `0` | 0 · 1 | ทางแยกความยาวตามเนื้อ — มีผลเฉพาะในโหมดถอย LEGACY_LENGTH_RULES=1 (เจ้าของเคาะถอยกลับ 1 ส.ค.) | `src/lib/ai/legacyLengthRules.js` | 1 ส.ค. 69 | ลบ env |

## คิวงาน

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `TEXT_ONLY_MODE` | `1` | 0 · 1 | รับเฉพาะข้อความล้วน ปิดสายเจนข่าวจาก URL/รูป (งานปก/mineclip ไม่กระทบ) — ด่านหลักที่ queue/add · process และประตูเก่า /api/auto + /api/auto/stream (@deprecated) อ่านซ้ำ | `src/app/api/queue/add/route.js`<br>`src/app/api/auto/process/route.js`<br>`src/app/api/auto/route.js`<br>`src/app/api/auto/stream/route.js` | 16 ก.ค. 69 | TEXT_ONLY_MODE=0 ชั่วคราว (ห้ามลบโค้ดสาย URL) |
| `ALLOW_LEGACY_AUTO` | `0` | 0 · 1 | =1 ปลดล็อกประตูเก่า /api/auto (สาย URL → summarizeService) ที่ถูกปิดด้วย 410 — ทีมจริงใช้ /api/queue/add → worker → /api/auto/process (สาย TEXT) | `src/app/api/auto/route.js` | 16 ส.ค. 69 | ลบ env = ประตูปิด (พฤติกรรมปัจจุบัน) |
| `QUEUE_ATOMIC_CLAIM` | `1` | 0 · 1 | คว้างานแบบ conditional update (pending→processing เฉพาะที่ยัง pending) กัน 2 worker คว้างานเดียวกัน | `src/lib/services/queueService.js` | 25 มิ.ย. 69 | QUEUE_ATOMIC_CLAIM=0 (ไม่แนะนำ — เสี่ยงงานซ้ำ) |
| `QUEUE_LOCAL_NEWS` | `0` | 0 · 1 | ทางหนีไฟ: =1 ยอมให้เครื่องทีม (Windows) คว้างานข่าว (ปกติงานข่าวเป็นของ Vercel) | `src/lib/services/queueService.js` | 12 มิ.ย. 69 | ลบ env |
| `QUEUE_COVER_ON_VERCEL` | `0` | 0 · 1 | =1 ยอมให้ Vercel ทำงานปก (ปกติงานปกทุกใบไปเครื่องทีม) | `src/lib/services/queueService.js` | 27 มิ.ย. 69 | ลบ env |
| `QUEUE_NEWS_DEADLINE_MS` | `770000` | 71000-770000 (นอกช่วง = 770000) | เพดานเวลา worker รอ route ข่าว (งบท่อ = ค่านี้ − 70 วิ ไม่เกิน 700 วิ) | `src/app/api/queue/worker/route.js` | 15 ส.ค. 69 | ลบ env = 770000 |
| `QUEUE_FETCH_LONG_AGENT` | `1` | 0 · 1 | ส่ง undici Agent ยืด headersTimeout ให้ fetch งานข่าว (แก้ "fetch failed" ปลอมที่ 300 วิ) | `src/app/api/queue/worker/route.js` | 15 ส.ค. 69 | QUEUE_FETCH_LONG_AGENT=0 |
| `QUEUE_TIMEOUT_RESCUE` | `(ว่าง)` |  · cover-only · off | ตาข่ายงานที่ fetch ตายแต่ route อาจยังวิ่ง: ว่าง = ทุกงาน · cover-only = เฉพาะงานปก (เดิม) · off = ปิด | `src/app/api/queue/worker/route.js` | 16 ส.ค. 69 | QUEUE_TIMEOUT_RESCUE=cover-only |

## แพลตฟอร์ม

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `PORT` | `3000` | หมายเลขพอร์ต | พอร์ตเซิร์ฟเวอร์ที่ watchdog คิวใช้ปลุก /api/queue/worker ในเครื่อง (ค่าจาก Next/ระบบ) | `src/lib/services/queueService.js` | 1 มิ.ย. 69 | — (ค่าแพลตฟอร์ม) |

## โมเดล/ไคลเอนต์ AI

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `MODEL_BREAKDOWN` | `gpt-5.6-sol` | model id | โมเดลขั้น Breakdown (แตกประเด็น) — สลับชั่วคราวได้โดยไม่กระทบโมเดลอื่น | `src/lib/ai/modelConfig.js` | 16 ก.ค. 69 (เคาะ sol 21 ส.ค. 69) | ลบ env = gpt-5.6-sol |
| `MODEL_BLUEPRINT` | `gpt-5.6-sol` | model id | โมเดลขั้น 3 Blueprint (วางโครงอารมณ์) | `src/lib/ai/modelConfig.js` | 15 ส.ค. 69 | MODEL_BLUEPRINT=gpt-5.6-luna |
| `CLAUDE_WRITE_MODEL` | `claude-opus-4-8` | model id | โมเดลเริ่มต้นของ claudeClient (DEFAULT_WRITE_MODEL = env \|\| "claude-opus-4-8") — สาย claude-write ใน aiRouter ถูกล็อกในโค้ดที่ opus-4-8 (ค่านี้ไม่ทับ) · ทะเบียนเดิมบอกค่าเริ่มต้น "" ผิดจากโค้ด (เทสค่าเริ่มต้นจับได้ 2 ก.ย. 69 รอบยืนยัน) | `src/lib/ai/claudeClient.js` | 10 มิ.ย. 69 (เคาะ opus-4-8 4 ส.ค. 69) | ลบ env = claude-opus-4-8 · CLAUDE_WRITE_MODEL=claude-opus-5 = ก่อน 4 ส.ค. |
| `CLAUDE_WRITE_EFFORT` | `medium` | low · medium · high | ระดับคิดเริ่มต้นของ Claude เมื่อผู้เรียกไม่ระบุ effort | `src/lib/ai/claudeClient.js` | 10 มิ.ย. 69 | ลบ env = medium |
| `LOG_FULL_PROMPT` | `0` | 0 · 1 | =1 เก็บ log พรอมต์เต็ม 100% (เจ้าของสั่ง 18 ส.ค.) · ไม่ตั้ง = ตัดพรีวิวเท่าเดิม — อ่านทั้ง 3 ไคลเอนต์ claude/openai/gemini | `src/lib/ai/claudeClient.js`<br>`src/lib/ai/openai.js`<br>`src/lib/ai/geminiClient.js` | 18 ส.ค. 69 | ลบ env |
| `WRITER_MODEL_LAB` | `(ว่าง)` | model id (ว่าง = claude-opus-4-8) | ห้องทดลองสลับนักเขียน — ตั้งเฉพาะสนามเทสในเครื่อง production ไม่ตั้ง (ยังล็อก opus-4-8) | `src/lib/ai/aiRouter.js` | 2 ก.ย. 69 | ลบ env |

## เครื่องมือกลาง

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `WITHTIMEOUT_ABORT` | `0` | 0 · 1 | =1 บังคับสร้าง AbortController ใน withTimeout แม้ไม่มี pipeline deadline/parent signal | `src/lib/utils/withTimeout.js` | 16 ก.ค. 69 | ลบ env |
| `NEWS_RESEARCH` | `0` | 0 · 1 (รับ 1/on/true/yes) | เปิดค้นข้อมูลเสริมจากเน็ต (Serper/Tavily/ปุ่มหน้าเว็บ) — ค่าเริ่มต้นปิดในโค้ดตามคำสั่งเจ้าของ | `src/lib/utils/researchSwitch.js` | 16 ส.ค. 69 | ลบ env = ปิด |

## เพดานเนื้อข่าว (newsCap)

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `NEWS_CAP_DNA` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน DNA: ตั้งป้ายหมวด/อารมณ์ (ป้ายถูกใช้ต่อทั้งการให้คะแนนการ์ดและครู) — อ่านที่เดียวผ่าน newsForStage('DNA') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_DNA=1500 = เพดานเดิมก่อนปลด |
| `NEWS_CAP_CATALOG` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน CATALOG: คัดสารบัญการ์ดทั้งคลังเหลือผู้เข้ารอบ — อ่านที่เดียวผ่าน newsForStage('CATALOG') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_CATALOG=2000 = เพดานเดิมก่อนปลด |
| `NEWS_CAP_BLUEPRINT` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน BLUEPRINT: วางโครงอารมณ์ (Blueprint) — อ่านที่เดียวผ่าน newsForStage('BLUEPRINT') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_BLUEPRINT=2500 = เพดานเดิมก่อนปลด |
| `NEWS_CAP_RESEARCH` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน RESEARCH: สกัดคีย์เวิร์ดไปค้นข้อมูลเสริม — อ่านที่เดียวผ่าน newsForStage('RESEARCH') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_RESEARCH=2000 = เพดานเดิมก่อนปลด |
| `NEWS_CAP_FORMAL` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน FORMAL: ตรวจว่าเป็นข่าวราชพิธี/ทางการหรือไม่ — อ่านที่เดียวผ่าน newsForStage('FORMAL') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_FORMAL=1500 = เพดานเดิมก่อนปลด |
| `NEWS_CAP_VIRAL_MATCH` | `0` | 0 = ไม่จำกัด · จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ) | เพดานตัวอักษรเนื้อข่าวด่าน VIRAL_MATCH: ตัวจับคู่ครูไวรัล (ทำงานเมื่อ VIRAL_MATCH_MODE=ai) — อ่านที่เดียวผ่าน newsForStage('VIRAL_MATCH') · ไม่ตั้ง = ส่งเนื้อเต็ม | `src/lib/utils/newsCap.js` | 16 ส.ค. 69 | NEWS_CAP_VIRAL_MATCH=900 = เพดานเดิมก่อนปลด |

## บอทดิสคอร์ด (discord-bot)

| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |
|---|---|---|---|---|---|---|
| `BOT_RESUME_TRACKING` | `1` | 0 · 1 | บอทจำงานที่กำลังตามอยู่ไว้ที่เซิร์ฟเวอร์ (/api/bot/tracking) — Railway redeploy/รีสตาร์ตแล้วบอทตัวใหม่ตามงานต่อเอง ไม่ค้าง "1%" · envFlag รับเฉพาะ "0"/"1" ตรงตัว ค่าอื่น = ค่าเริ่มต้นเปิด | `discord-bot/index.js` | 2 ก.ย. 69 (เคสหลวงปู่ศิลา 03:49Z) | BOT_RESUME_TRACKING=0 = บอททำงานเหมือนเดิมทุกไบต์ (ต้อง redeploy บอทบน Railway) |
| `BOT_REVIEW_REACTIONS` | `1` | 0 · 1 | บอทใส่ reaction 👍 ผ่าน / 👎 ไม่ผ่าน / 📌 ใช้แล้ว ใต้ผลข่าว แล้วบันทึกสถานะเข้า PATCH /api/generation-logs/[caseId] + โชว์บรรทัดเตือน (ข้อเท็จจริงหาย/ความคล้าย/โอกาสปัง) — ข้อ 6 แผนยกระดับ | `discord-bot/index.js` | 2 ก.ย. 69 (เฟส 3) | BOT_REVIEW_REACTIONS=0 = ไม่ใส่ reaction ไม่ฟังการกด ไม่แสดงบรรทัดเตือน (ข้อความผลเหมือนเดิม) |
