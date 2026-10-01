# เครื่องมือค้นคว้า (เอเจนต์รีเสิร์ช) — อ่านก่อนใช้

รันจากโฟลเดอร์งานด้วย `node tools/<ชื่อ>.mjs …` · ทุกตัวพิมพ์ **JSON บรรทัดเดียว** ออก stdout
`exit 0` = สำเร็จ · `exit 1` = ล้ม (stdout มี `{"ok":false,"error":…}`) · `exit 2` = ใช้ผิด (ข้อความอยู่ stderr)
เครื่องมือหาคีย์เอง — **ห้ามพิมพ์/อ่าน/ส่งค่าคีย์ใดๆ** และห้ามใส่คีย์ในคำค้นหรือ tool_log

## อินพุตภาษาไทย / JSON (สำคัญ — PowerShell ทำ quoting พัง)
เขียนไฟล์ JSON (UTF-8) ไว้ใน `out/` แล้วส่ง `--input out/<ชื่อ>.json` · คีย์ = ชื่อตัวเลือก (คำค้น = `q` · ลิงก์ = `url`):
serper `{"q","type":"search|news|videos|images","num","tbs"}` · fetch-page `{"url","max","via"}` · apify `{"preset","url","q","limit","timeout"}` หรือ `{"actor","input":{…},"limit","timeout"}` ·
web-agent `{"q"}` · transcribe `{"url","max"}` · gemini-video `{"url","question","start","end"}` · youtube-meta `{"url"}` · ocr `{"image":["…"]}` ·
reverse-image `{"image-url","num"}` · wiki `{"q","lang"}` · rss-news `{"q","max-per-feed"}`
<!-- ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4): ตัวอย่างสร้างไฟล์ input เปลี่ยนจากคำสั่ง PowerShell เป็น apply_patch
     (ไฟล์นี้เอเจนต์อ่านทั้งไฟล์ — ไม่คัดลอกตัวอย่างเดิมไว้ในคอมเมนต์ · ของเดิมดูใน git history) -->
สร้างไฟล์ input ด้วย **apply_patch** (เครื่องมือแก้ไฟล์ของ Codex) เช่น เพิ่มไฟล์ `out/q.json` เนื้อ `{"q":"ขาเทียม ราชบุรี","type":"news"}` แล้ว `node tools/serper.mjs --input out/q.json`

## ไฟล์ที่มีภาษาไทย (รวม out/result.json) — กันไทยกลายเป็น `?`
- สร้าง/แก้ด้วย **apply_patch เท่านั้น** — ห้าม `Set-Content` / `Out-File` / `Add-Content` / `echo` / `>` / `>>` (PowerShell 5.1 บันทึก ANSI → ภาษาไทยทุกตัวกลายเป็น `?` · รอบทดลอง 1 ต.ค. 69 ไฟล์ผลเสียแบบนี้ 2 ใน 8 งาน รีเสิร์ชทั้งรอบใช้ไม่ได้)
- ห้ามส่งข้อความ/สคริปต์ที่มีภาษาไทยผ่าน pipe ของ PowerShell เข้าโปรแกรมอื่น (`… | python -` · `… | node -`) — ถูกแปลงเป็น ASCII ไทยเป็น `?` เช่นกัน · สคริปต์ช่วยให้สร้างเป็นไฟล์ด้วย apply_patch ก่อนแล้วค่อยรัน
- เขียน `out/result.json` เสร็จแล้วรัน `node tools/check-result.mjs out/result.json` ทุกครั้งก่อนจบ — ต้องได้ `"ok":true` · ได้ `"ok":false` = ลบแล้วเขียนใหม่ทั้งไฟล์ด้วย apply_patch แล้วตรวจซ้ำ (ผลบอก `reason` · `fields_bad` · `missing_keys` · `hint`)

| คำสั่ง | ใช้ทำอะไร | หมายเหตุ |
|---|---|---|
| `node tools/serper.mjs "คำค้น" [--news\|--videos\|--images] [--num 8] [--tbs qdr:m]` | ค้น Google / ข่าว (มีวันที่) / วิดีโอ / ภาพ | ถูก เร็ว ~1 วิ · `--tbs` จำกัดช่วงเวลา (qdr:d/w/m/y) |
| `node tools/fetch-page.mjs <url> [--max 6000]` | เนื้อเต็ม + วันที่เผยแพร่ (`published`) ของหน้าเว็บ | Firecrawl → Jina → ตรง · ใช้ยืนยันก่อนเชื่อ snippet · เฟซบุ๊กส่วนใหญ่ต้องใช้ apify/เบราว์เซอร์ |
| `node tools/apify.mjs --preset facebook-posts --url <u>` | โพสต์เฟซบุ๊ก (เวลาโพสต์ ยอดไลก์/คอมเมนต์/แชร์) | preset: `facebook-posts` `facebook-comments` `facebook-search` (`--q`) `tiktok` `crawl` · ช้า 20–90 วิ มีค่าใช้จ่าย ใช้เมื่อจำเป็น · actor อื่น: `--input out/apify.json` (`{"actor":"…","input":{…}}`) |
| `node tools/web-agent.mjs "โจทย์"` | นักค้นคนที่สอง (AI + web search) | ~10–20 วิ · เสียเงิน API ~$0.12/ครั้ง · **ไม่เกิน 2 ครั้งต่องาน** · ใช้เทียบผล/หาสิ่งที่ค้นเองไม่เจอ |
| `node tools/transcribe.mjs --url <คลิป>` | ถอดเสียงคลิป YouTube/TikTok/Facebook/IG (ตัวถอดของท่อคลิป) | 30 วิ–3 นาที · Whisper เสียเงินตามนาที · ใช้เมื่อเนื้อคลิปสำคัญต่อการยืนยัน |
| `node tools/gemini-video.mjs --url <YouTube> [--question "…"] [--start s --end s]` | ให้ Gemini ดูคลิป YouTube (ภาพ+เสียง) ตอบเป็น JSON | เฉพาะ YouTube · ดูเฉพาะช่วงด้วย `--start/--end` ประหยัดกว่า |
| `node tools/youtube-meta.mjs --url <YouTube>` | ชื่อ ช่อง **วันที่อัปโหลด** ยอดวิว/ไลก์/คอมเมนต์ | ใช้ตัดสินข่าวเก่า/ต้นทางของคลิป |
| `node tools/ocr.mjs --image <ไฟล์หรือ URL>` | อ่านตัวอักษรจากภาพ/สกรีนช็อต | เสียเงิน vision ต่อภาพ · ≤4 ภาพ ≤8MB |
| `node tools/reverse-image.mjs --image-url <URL>` | ค้นย้อนภาพ (Google Lens) | หาที่มาของภาพ / ภาพเก่าถูกนำมาใช้ใหม่ · ~$0.015/ครั้ง |
| `node tools/wiki.mjs "ชื่อ"` | สรุป Wikipedia ไทย→อังกฤษ | ฟรี · บุคคลสาธารณะ/หน่วยงาน/สถานที่ |
| `node tools/rss-news.mjs "คีย์เวิร์ด"` | หัวข่าวล่าสุดจาก RSS สำนักข่าวไทย 11 แห่ง | ฟรี · ได้หัวข้อ/สรุปสั้น → ยืนยันด้วย fetch-page |
| `node tools/quota.mjs` | โควตา Codex ของบัญชีที่ใช้อยู่ | ฟรี · เหลือน้อย = ประหยัดการเรียก |
| `node tools/check-result.mjs out/result.json` | ตรวจไฟล์ผลก่อนจบ: JSON ถูกรูป · ภาษาไทยไม่กลายเป็น `?` · มีคีย์บังคับครบ | ฟรี ไม่ใช้เน็ต ~1 วิ · **รันทุกครั้งก่อนจบงาน** · `exit 1` = ต้องเขียนใหม่ด้วย apply_patch แล้วตรวจซ้ำ |
| `curl` / `Invoke-WebRequest` | endpoint สาธารณะอื่น (Wikipedia REST, YouTube oEmbed ฯลฯ) | ตามดุลยพินิจ |
| เบราว์เซอร์ (ถ้ามีในเซสชัน **และใบงานบอก "เบราว์เซอร์: เปิด"**) | เปิดหน้าที่ fetch ไม่ได้ (ต้องรัน JS/ต้องล็อกอิน) เช่น ค้นเฟซบุ๊กตรงๆ | Edge "Profile 1" ล็อกอินเป็น **"เล่าเรื่อง ดารา"** เท่านั้น อ่านอย่างเดียว — บัญชีอื่น = หยุดใช้ + ธง `BROWSER_WRONG_ACCOUNT` · งานที่รันพร้อมกันใช้เบราว์เซอร์ได้ทีละงาน: ใบงานบอก "ปิด" = ห้ามเปิดเบราว์เซอร์ (ใช้ apify/fetch-page แทน) |

## เคล็ดลับจากรอบทดลอง (1 ต.ค. 69)
- ข่าวที่ขึ้นต้นว่า "สาวรายหนึ่งเล่า / ผู้ใช้เฟซบุ๊กโพสต์" มักมีต้นทางเป็นโพสต์เฟซบุ๊กที่ Google ไม่ทำดัชนี → ลองเบราว์เซอร์ค้นเฟซบุ๊กตรง (คำค้นสั้นๆ ภาษาไทย) หรือ `apify --preset facebook-search` (บางครั้งคืน no_items)
- รู้ URL โพสต์แล้ว → `apify --preset facebook-posts` ได้เวลาโพสต์จริง (timestamp) + ยอดแชร์/คอมเมนต์ · `fetch-page` ของเฟซบุ๊กมักได้แค่เวลาสัมพัทธ์ ("1d")
- เวลาโพสต์ที่ "หลังเวลาส่งข่าว" ไม่ใช่ต้นทาง — เทียบกับเวลาที่พนักงานส่งเสมอ
- โพสต์ของเพจเราเอง (รวมไอจีดารา facebook.com/IG.dara) ไม่ใช่ต้นทาง

## กติกาหลักฐาน
ทุกข้อเท็จจริงที่ส่งออกต้องมี **ประโยคหลักฐานคัดตรงจากหน้าที่ดึงมาได้จริง** (ไม่ใช่ snippet อย่างเดียว) ≥ 20 ตัวอักษร มีตัวเลข/ชื่อเฉพาะเดียวกับ claim + URL http(s) + วันที่ของแหล่ง
