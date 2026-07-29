# WIP-RECONCILE-PLAN — แผนเก็บกวาดงานค้าง 3 ไฟล์ (working tree เทียบ origin/main)

**วันที่ทำรายงาน:** 30 ก.ค. 69 (เช้า) · **ผู้ทำ:** งานวิเคราะห์ read-only (ไม่แตะไฟล์นอกเหนือจากไฟล์รายงานฉบับนี้)
**repo ที่ตรวจ:** `C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16` (main worktree ของ viral-content-system)
**baseline:** `origin/main` @ `dd2e389` (29 ก.ค. 69 23:54 — commit "mirror ของ local 0269ae6") · อ่านผ่าน `git show origin/main:<path>`
**HEAD local:** `0269ae6` (29 ก.ค. 69 23:53)
**วิธีตรวจ:** `git diff origin/main -- <3 ไฟล์>` ไล่ทีละ hunk + grep ยืนยัน call sites/throw messages ข้ามไฟล์ + อ่าน flow จริง + เทียบเอกสาร audit ในโฟลเดอร์นี้ (`AUDIT-REF-APP.md`, `AUDIT-QUEUE-STABILITY.md`)

---

## 0. ข้อเท็จจริงระดับ repo ที่ต้องรู้ก่อนอ่าน hunk (สำคัญ — เปลี่ยนบทสรุปจากที่คาด)

1. **ตัวเลข diff มี 2 ชุด ห้ามสับสน** — ตัวเลขที่แจ้งมาใน brief (grade ~54, library 49/41, worker 26/7) ตรงกับ diff เทียบ **HEAD local** (งาน uncommitted):
   | ไฟล์ | worktree vs HEAD local | **worktree vs origin/main** |
   |---|---|---|
   | src/lib/refCoverGrade.js | 31+/6- | **0 (เหมือนกันทุกบรรทัด)** |
   | src/lib/refCoverLibrary.js | 49+/41- | **14+/2- (1 hunk)** |
   | scripts/acs-yt-worker.mjs | 26+/7- | **11+/0- (2 hunks)** |
2. **origin/main กลืนงานค้างไปแล้วบางส่วน** — commit mirror `dd2e389` (29 ก.ค. 23:54) มีเนื้อมากกว่า local HEAD `0269ae6`: มันรวมงานที่ฝั่ง local ยังไม่เคย commit ไปด้วย ได้แก่ refCoverGrade.js **ทั้งไฟล์**, redesign 18-19 ก.ค. ของ library (ย้าย persistStore / ถอด imagePath / FRAME_BASE :3900 ของ worker) และ **ครึ่งคู่ของ fix #1.8 ใน route.js** (ดูข้อ 3)
3. **ดังนั้นงานค้างจริงที่ยังไม่ขึ้น main เหลือแค่ 3 hunks** (L1, W1, W2 ด้านล่าง) — ไฟล์ refCoverGrade.js ไม่มีอะไรค้างเลย
4. **HEAD local ตามหลัง main ไกล** — `git diff HEAD origin/main` ต่างกัน 50 ไฟล์ (src/scripts 27 ไฟล์): main มีของที่เครื่องนี้ไม่มี (src/app/api/company/*, model-log, solverShadow*, tests/research-*, test-ref-*) และเครื่องนี้มีงานค้างเรื่องอื่นนอกขอบเขต 3 ไฟล์ (libraryTriage ~205 บรรทัด, clip-worker, news-lock-guard, image-search, megaCoverArchive, Sidebar ฯลฯ) + `git status` มี `D public/company/*` (ถูกลบฝั่ง local) → **ห้าม commit จาก worktree นี้ตรงๆ เด็ดขาด** (เสี่ยงลากลบไฟล์บน main) — วิธีปลอดภัยอยู่ในหมวด 3
5. **ข้อไม่แน่ชัด (รายงานตามกฎความซื่อสัตย์):** ไม่ทราบว่าทำไม mirror `dd2e389` จึงรับ route.js + grade + redesign แต่ไม่รับ L1/W1/W2 ทั้งที่ mtime ไฟล์ route.js และ library.js เท่ากันที่ 29 ก.ค. 16:14 — สันนิษฐานว่า mirror ทำจากอีกเครื่อง/เลือก commit บางไฟล์ แต่**ไม่มีหลักฐานยืนยัน** ทีมที่ถือไฟล์ควรตอบข้อนี้ก่อน commit จริง

---

## 1. ไล่ hunk ทีละตัว (ก) + คำตัดสิน 3 ทาง (ค)

### ไฟล์ที่ 1: `src/lib/refCoverGrade.js` — hunk ค้าง vs origin/main: **ไม่มี (0 hunk)**

สิ่งที่ brief ระบุ (slots>=3, ALLOWLIST, HUMAN_VERIFIED_FLOOR) มีอยู่ใน worktree **และ** origin/main เหมือนกันทุกบรรทัด (grep ยืนยันทั้ง 2 ฝั่ง):

| ฟีเจอร์ (อยู่บน main แล้ว) | ที่ | ผู้เขียน/วันที่ (จากคอมเมนต์) |
|---|---|---|
| R6 grade floor สำหรับใบ human-verified + kill-switch `REF_HUMAN_VERIFIED_FLOOR` | บรรทัด 10, 27, 123-124 | 19 ก.ค. — ฝั่งผู้ใช้สั่ง (ยกเว้น R6) |
| `REF_POOL_ALLOWLIST` (ชุด id เทมเพลตแม่นจริง) + ฟังก์ชัน audit บอกสาเหตุพูลว่าง | บรรทัด 156-159, 185-196 | 18 ก.ค. — "ผู้ใช้สั่ง — audit เกรด" |
| gate เปลี่ยนจาก "ต้องมีภาพ" เป็น "DNA มีโครงจริง (template.slots หรือ dna.slots ≥3 ช่อง)" | บรรทัด 145-149 | 18 ก.ค. redesign (คำสั่ง sol) |

- **คำตัดสิน: ไม่เข้าหมวดใดในสามหมวด — เพราะไม่มี hunk ค้าง** เนื้อไฟล์ขึ้น main ครบแล้วผ่าน mirror `dd2e389`
- [commit ขึ้น main]: ไม่มีอะไรให้ commit — commit ซ้ำจะได้ empty/no-op
- [คง local-only]: ไม่มีเหตุผล — ของชิ้นนี้เป็นฟีเจอร์ระบบที่ทีมใช้ร่วมกันอยู่บน main แล้ว
- [ทิ้ง revert]: **อันตราย ห้ามทำ** — revert worktree ให้เท่า HEAD local = ดึงไฟล์ถอยหลังไปก่อน 18-19 ก.ค. ทำระบบเกรด/allowlist/floor บนเครื่องนี้พังและขัดกับ main ทันที
- **การกระทำที่ถูก:** sync ตัว branch local ให้ทัน origin/main (git-level) แล้ว diff ลวงนี้จะหายเอง

### ไฟล์ที่ 2: `src/lib/refCoverLibrary.js` — hunk ค้าง vs origin/main: **1 hunk (14+/2-)**

> หมายเหตุ: ส่วน "ย้าย persistStore / ถอด imagePath / เพิ่ม clearAllRefCovers" ที่ brief ยกตัวอย่าง อยู่บน main แล้วทั้งหมด (redesign 18 ก.ค. คำสั่ง sol — ยืนยันด้วย `git diff HEAD origin/main` ตรงกันทุกบรรทัด) ไม่ใช่งานค้าง

**hunk L1 — `updateRefCover` แยก error จริงออกจาก "ไม่พบ id"** (บรรทัด ~120-140 ของ worktree)

- **ฟีเจอร์:** เดิม `catch { return null; }` กลืนทุก error → route ตอบ 404 "ไม่พบ id" ทั้งที่จริงอาจเป็น Supabase เขียนล้ม (network/schema) — hunk นี้แยก: ข้อความขึ้นต้น `ไม่พบ id` → คืน `null` เป๊ะเดิม (สัญญาเดิมไม่เปลี่ยน) · เคสอื่น → `console.warn` + คืน `{ __error: msg }` ให้ route แยกตอบ 500 พร้อมเหตุผลจริง
- **ผู้เขียน/วันที่:** lane2 — คอมเมนต์ระบุ "29 ก.ค. 69 (lane2 audit-ref-app #1.8)" · mtime ไฟล์ 29 ก.ค. 16:14 · เป็น fix ตาม `_research-igdara-15k/AUDIT-REF-APP.md` ข้อ 1.8 (บรรทัด 90-102 ของเอกสาร audit — อ่านยืนยันแล้ว)
- **ยังจำเป็นไหม:** **จำเป็น และ main กำลังรอครึ่งนี้อยู่** — route.js บน main มีโค้ดเช็ค `updated.__error` (route.js:208-211, คอมเมนต์ lane2 เดียวกัน) แต่ updateRefCover บน main ไม่เคยคืน `__error` → เช็คนั้นเป็น dead code และบั๊ก "โกหก 404" ยังอยู่บน main เต็มๆ
- **การพึ่งพา (ยืนยันแล้วทั้ง 3 จุด):**
  1. `persistStore.js` — regex `/^ไม่พบ id/` พึ่ง throw messages `ไม่พบ id: ${id}` (persistStore.js:262) vs `อัพเดทไม่สำเร็จ:` (persistStore.js:281) → **ไฟล์เหมือน main ทุกบรรทัด ข้อความตรง ✓**
  2. `src/app/api/ref-covers/route.js` — ผู้เรียก runtime ตัวเดียว (grep ยืนยัน; scripts อื่นเรียกผ่าน HTTP ไม่แตะฟังก์ชันตรง) → **handler `__error` อยู่บน main แล้ว ✓**
  3. `scripts/test-ref-redesign.mjs` — re-implement fake lib เอง (บรรทัด ~99) ไม่ได้ import โค้ดจริง → hunk นี้**ไม่ทำเทสเดิมพัง แต่ก็ไม่มีเทสครอบคลุม path ใหม่** (test gap — ดูหมวด 3)
- **คำตัดสิน: [ควร commit ขึ้น main]** — เป็นการปิด fix ที่ลงไปครึ่งคู่ เนื้อหา additive, เส้นทาง null เดิมคงเป๊ะ
  - ความเสี่ยงถ้า commit: ต่ำ — coupling กับข้อความ throw ของ persistStore (ถ้าอนาคตเปลี่ยนข้อความ `ไม่พบ id:` regex จะพลาด → not-found จริงกลายเป็น 500; บรรเทาด้วยเทส)
  - ความเสี่ยงถ้าคง local-only: main ค้างสภาพครึ่งคู่ (dead code ใน route.js + บั๊ก 404 ลวงยังอยู่) และเครื่องอื่นที่ pull main จะชนกับ fix นี้ซ้ำในอนาคต
  - ความเสี่ยงถ้า revert: เสียงาน lane2 ฟรีๆ + main ยังบั๊ก — ไม่มีเหตุผลใดรองรับ

### ไฟล์ที่ 3: `scripts/acs-yt-worker.mjs` — hunk ค้าง vs origin/main: **2 hunks (11+/0-) ฟีเจอร์เดียวกัน**

> หมายเหตุ: `FRAME_BASE :3900` ที่ brief ยกตัวอย่าง อยู่บน main แล้ว (★ 19 ก.ค. — แยกพอร์ตงานหนักกันชน :3000) ไม่ใช่งานค้าง

**hunk W1 — เพิ่ม `const FRAME_JOB_TIMEOUT_MS`** (worktree บรรทัด 29-36)

- **ฟีเจอร์:** timeout เฉพาะสายงานแคปเฟรม อ่านจาก env `ACS_FRAME_JOB_TIMEOUT_MS` (default 45 นาที) — เหตุผลระบุในคอมเมนต์ครบ: งานจริงสูงสุด ~40 นาที · dispatcher undici ตั้ง 1 ชม. · ถ้า `import('undici')` ล้มจะไม่มี timeout เหลือเลย · worker เป็นลูป sequential จึงแขวนทุกงานขณะรอ
- **ผู้เขียน/วันที่:** lane2 — "29 ก.ค. 69 (lane2 audit-queue-stability #1)" · mtime 29 ก.ค. 16:13 · fix ตาม `_research-igdara-15k/AUDIT-QUEUE-STABILITY.md` ข้อ 1 (ระดับ **สูง** — "บั๊กที่ผู้ใช้ระบุมาแล้ว ยืนยันด้วยโค้ด")

**hunk W2 — เพิ่ม `signal: AbortSignal.timeout(FRAME_JOB_TIMEOUT_MS)` ใน fetch ของ `processJob()`** (worktree บรรทัด ~85-91)

- **ฟีเจอร์:** ผูก timeout ของ W1 เข้ากับ fetch ยิงงานแคปเฟรมจริง — ไม่แตะ endpoint อื่น (claim/report/jobStatus 15s, rehost 300s, quick-test 20s เดิมครบ — grep ยืนยันบน main แล้ว)
- **การพึ่งพา (ยืนยันแล้ว):** W2 ใช้ค่าจาก W1 → **ต้องขึ้น main ด้วยกันเท่านั้น ห้ามแยก** · ไม่มี cross-file dep (grep: env ถูกอ้างเฉพาะไฟล์นี้) · `AbortSignal.timeout` ต้องการ Node ≥17.3 — เครื่องทีม Node v24.15.0 ✓ (Next 16.2.6 บังคับ Node สูงกว่านั้นอยู่แล้ว) · ลูปหลักมี `catch` รองรับ timeout อยู่ก่อนแล้ว (คอมเมนต์ "สายหลุด/timeout — ไม่รายงานล้มเพราะ pipeline อาจยังวิ่งอยู่ใน server และ route จะปิดงานเอง" + ระบบ requeue งานค้าง 30 นาที สูงสุด 2 รอบ) → abort แล้ว flow เดินต่อถูกต้อง ไม่ทิ้งงานผี
- **ยังจำเป็นไหม:** จำเป็น — บน main วันนี้ `processJob()` ยังไม่มี signal (ยืนยันด้วย `git show origin/main:...` บรรทัด 77-83) แขวนได้ยาวสุด 1 ชม./ไม่จำกัด ตรงบั๊กที่ผู้ใช้รายงาน
- **คำตัดสิน: [ควร commit ขึ้น main] ทั้ง W1+W2 (ห้ามแยกคู่)**
  - ความเสี่ยงถ้า commit: ต่ำมาก (additive ล้วน ไม่มี deletion) — จุดที่ต้องตัดสินใจเชิงปฏิบัติการคือค่า default 45 นาที: ถ้างานจริงทีมเคยเกิน 45 นาที ให้ตั้ง `ACS_FRAME_JOB_TIMEOUT_MS` บนเครื่องทีม ไม่ต้องแก้โค้ด
  - ความเสี่ยงถ้าคง local-only: เครื่องทีมเครื่องนี้ปลอดภัย แต่เครื่อง/สภาพแวดล้อมอื่นที่รัน worker จาก main ยังแขวนได้ — และเป็น fix บั๊กที่ผู้ใช้รายงานเอง ค้างไว้ = ค้างบั๊กที่รู้ตัวแล้ว
  - ความเสี่ยงถ้า revert: กลับไปแขวน 1 ชม./ไม่จำกัด — ขัดเจตน์ audit ข้อสูงสุด — ไม่มีเหตุผลรองรับ

---

## 2. ความพึ่งพากันข้ามไฟล์ (ข)

| คู่พึ่งพา | สถานะบน origin/main | ผลต่อแผน |
|---|---|---|
| **L1 (library) → route.js** (`__error` handler) | route.js **อยู่บน main แล้ว** (mirror รับไปก่อน) — main ค้างครึ่งคู่ | ตัวตัดสินหลัก: L1 ต้องขึ้น main เพื่อปิดคู่ |
| **L1 (library) → persistStore.js** (ข้อความ throw `ไม่พบ id:`/`อัพเดทไม่สำเร็จ:`) | ตรงกันทุกบรรทัด ✓ | พร้อม — แต่เป็น coupling เปราะผ่านข้อความ (ระวังตอนแก้ persistStore อนาคต) |
| **W2 → W1** (ไฟล์เดียวกัน) | ทั้งคู่ยังไม่อยู่บน main | commit รวมก้อนเดียว |
| refCoverGrade ↔ ไฟล์อื่น | ไม่มี hunk ค้าง | — |
| worker ↔ library/grade | ไม่มี (worker import เฉพาะ undici) | 2 งาน (L1, W1+W2) อิสระต่อกัน commit แยกกันได้ |
| ไฟล์นอกขอบเขตที่แตะสัญญาเดียวกัน | `scripts/test-ref-redesign.mjs` fake เอง ไม่พัง · ไม่มีไฟล์อื่นอ้าง `ACS_FRAME_JOB_TIMEOUT_MS`/`__error` นอกเหนือที่กล่าว | ไม่มีบล็อกเกอร์ |

---

## 3. แผนเก็บกวาดรวม + ลำดับขั้นตอน

**ตาราง verdict:**

| hunk | ฟีเจอร์ | verdict | เหตุผลบรรทัดเดียว |
|---|---|---|---|
| grade (ทั้งไฟล์) | R6 floor / ALLOWLIST / gate slots≥3 | **ไม่มี hunk ค้าง — อยู่บน main แล้ว** (ห้าม revert) | diff เทียบ origin/main = 0 |
| L1 | updateRefCover แยก `__error` | **commit ขึ้น main** | ปิด fix ครึ่งคู่ (route.js รออยู่) บั๊ก audit #1.8 |
| W1+W2 | timeout 45m สายแคปเฟรม | **commit ขึ้น main (ก้อนเดียว)** | fix บั๊ก audit #1 ระดับสูงที่ผู้ใช้รายงาน |
| local-only ถาวร | — | **ไม่มีใน 3 ไฟล์นี้** | ทุก hunk เป็น fix ระบบที่ทีมต้องใช้ร่วม |
| ทิ้ง revert | — | **ไม่มี** | ไม่มี hunk ตกยุค/อันตราย |

**ลำดับขั้นตอนที่แนะนำ (ทำโดยทีมที่ถือไฟล์ — รายงานฉบับนี้ไม่ได้แตะอะไร):**

1. ก่อนอื่นตอบข้อไม่แน่ชัดข้อ 0.5 (mirror รับ route.js แต่ไม่รับ library เพราะอะไร) — ถ้ามีเหตุถือไฟล์ L1 ไว้ ต้องรู้ก่อน
2. **ห้าม commit จาก worktree/HEAD นี้ตรงๆ** — HEAD ตามหลัง main 50 ไฟล์และมี `D public/company/*` ค้าง: ให้ตัด branch ใหม่จาก `origin/main` แล้ว apply เฉพาะ L1 (1 hunk) และ W1+W2 (2 hunks) — ทำเป็น 2 commit แยกเรื่อง (ref-app #1.8 / queue-stability #1) หรือรวมก็ได้เพราะอิสระกัน
3. ควรเพิ่มเทสก่อน/พร้อม commit ตาม DNA ข้อ 13 — ปัจจุบัน **ไม่มีเทสครอบคลุม** path ใหม่เลย: `test-ref-redesign.mjs` re-implement fake lib เอง (ไม่แตะโค้ดจริง) และ worker ไม่มีเทส — เทสขั้นต่ำที่พอเหมาะ: fake store ที่ throw `ไม่พบ id: x` → ต้องได้ `null`; throw อย่างอื่น → ต้องได้ `{__error}` (ทำในรูปแบบเดียวกับ test-ref-redesign.mjs แต่ import โมดูลจริงผ่าน store ปลอม)
4. หลังขึ้น main: เครื่องนี้ `git pull`/rebase ให้ทัน แล้ว diff ลวงของ grade จะหายเอง · ตั้ง `ACS_FRAME_JOB_TIMEOUT_MS` เฉพาะถ้า 45 นาทีไม่พอ
5. **Failure plan:** ถ้า commit แล้ว route พฤติกรรมผิด (เช่น not-found จริงกลาย 500) → สาเหตุเกือบแน่คือข้อความ throw ของ persistStore เปลี่ยน → revert เฉพาะ commit L1 ได้โดยไม่กระทบ W1+W2 · ถ้า worker abort เร็วเกิน → ปรับ env โดยไม่ต้อง revert
6. **Exit condition:** main มี L1+W1+W2, route.js `__error` ไม่ใช่ dead code, worker บนเครื่องทีมรัน build ที่มี timeout, worktree เครื่องนี้ diff 3 ไฟล์เทียบ origin/main = 0 ทั้งหมด

**ความเสี่ยงคงเหลือหลังทำตามแผน:** (ก) coupling L1↔ข้อความ throw persistStore (บรรเทาด้วยเทสข้อ 3) (ข) งานค้างนอกขอบเขต 3 ไฟล์ (libraryTriage ~205 บรรทัด, clip-worker, news-lock-guard, image-search, megaCoverArchive, Sidebar และ `D public/company/*`) **ยังไม่ได้ตรวจ** — ควรทำรายงานแบบเดียวกันนี้ก่อน sync เครื่อง ไม่อย่างนั้น pull จะชน/ทับงานค้างเหล่านั้น
