-- ย้อนคลังพรอมต์ + คลังตัวอย่างไวรัล กลับยุค มิ.ย. 69 (เจ้าของสั่ง 8 พ.ย. 69)
-- รันพร้อมตอนสลับโค้ดยุค มิ.ย. ขึ้น main เท่านั้น — รันก่อน = โค้ดปัจจุบันบน production ได้คลังเก่าไปใช้
-- รันทีละขั้นตามลำดับ · ทุกขั้นสำรองก่อนลบ · ย้อนกลับ: undo-libraries.sql
--
-- ที่มา "ยุค มิ.ย." (ตรวจแล้ว 8 พ.ย. 69):
--   คลังพรอมต์  = data/prompt-library.json ที่ commit 5b566c2 (73 ใบ · blob 5af09ac6) — ไฟล์เดียวกับที่ใช้ตอนย้อนรอบ 23 ส.ค. 69
--   คลังไวรัล   = viral_examples แถวที่สร้าง 12 มิ.ย.–1 ก.ค. (73 แถว) · แถวที่เพิ่ม 25–26 ก.ค. (129 แถว) ไม่มีในยุค มิ.ย.

-- ── ขั้น 0: เปิดส่วนเสริมดึงไฟล์ (ใช้ดึงคลังพรอมต์จาก GitHub เข้าฐานโดยตรง ไม่ผ่านเครื่องใคร) ──
create extension if not exists pg_net;

-- ── ขั้น 1: สำรองของปัจจุบันเป็นแถวพักใน store_items (ชื่อ store ใหม่ = โค้ดไม่อ่าน) ──
insert into public.store_items (id, store_name, data, created_at, updated_at)
select id || '__bk20261108', 'prompt-library__backup-20261108', data, created_at, updated_at
from public.store_items where store_name = 'prompt-library'
on conflict (id) do nothing;

insert into public.store_items (id, store_name, data, created_at, updated_at)
select 've__' || v.id::text, 'viral_examples__backup-20261108', to_jsonb(v), v.created_at, now()
from public.viral_examples v
where v.created_at >= '2026-07-25T00:00:00+07'
on conflict (id) do nothing;

-- ตรวจ: ต้องได้ prompt-library__backup = จำนวนเดิม (254 ณ 8 พ.ย.) · viral_examples__backup = 129
select store_name, count(*) from public.store_items
where store_name in ('prompt-library__backup-20261108', 'viral_examples__backup-20261108') group by 1;

-- ── ขั้น 2: ขอไฟล์คลังพรอมต์ยุค มิ.ย. (ตรึง commit — เปลี่ยนไม่ได้) → จดเลข request ที่ได้ ──
select net.http_get(
  'https://raw.githubusercontent.com/okpakorn-source/viral-content-system/5b566c2d5eef490e5773afcf409bd876d3434bf3/data/prompt-library.json'
) as request_id;

-- ── ขั้น 3: (รอ ~5 วิ) ตรวจว่าได้ไฟล์ครบ 73 ใบ — แทน <REQUEST_ID> ด้วยเลขจากขั้น 2 ──
select status_code, jsonb_array_length(content::jsonb) as cards
from net._http_response where id = <REQUEST_ID>;

-- ── ขั้น 4: แทนคลังพรอมต์ด้วย 73 ใบยุค มิ.ย. + ตัดตัวอย่างไวรัลที่เพิ่มหลังยุค (ทำในธุรกรรมเดียว) ──
begin;
delete from public.store_items where store_name = 'prompt-library';
insert into public.store_items (id, store_name, data, created_at, updated_at)
select e->>'id', 'prompt-library', e,
       (e->>'createdAt')::timestamptz,
       coalesce((e->>'updatedAt')::timestamptz, (e->>'createdAt')::timestamptz)
from net._http_response r, jsonb_array_elements(r.content::jsonb) e
where r.id = <REQUEST_ID> and r.status_code = 200;
delete from public.viral_examples where created_at >= '2026-07-25T00:00:00+07';
-- ตรวจก่อน commit: prompt-library ต้อง = 73 · viral_examples ต้อง = 73 · ไม่ตรง = rollback;
select (select count(*) from public.store_items where store_name = 'prompt-library') as prompt_cards,
       (select count(*) from public.viral_examples) as viral_rows;
commit;

-- ── ขั้น 5: ปิดส่วนเสริมที่เปิดในขั้น 0 (ถ้าเดิมไม่ได้เปิดไว้) ──
drop extension if exists pg_net;
