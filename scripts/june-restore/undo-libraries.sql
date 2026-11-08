-- ย้อนกลับ restore-libraries.sql → คลังพรอมต์ + คลังไวรัล กลับเป็นชุดก่อนวันที่ 8 พ.ย. 69
-- ใช้เมื่อสลับกลับไปใช้ระบบเขียนข่าวปัจจุบัน (ต้องรันคู่กับการย้อนโค้ด main กลับ)

begin;
-- คลังพรอมต์: เอาชุด 254 ใบที่สำรองไว้คืน
delete from public.store_items where store_name = 'prompt-library';
insert into public.store_items (id, store_name, data, created_at, updated_at)
select left(id, length(id) - length('__bk20261108')), 'prompt-library', data, created_at, updated_at
from public.store_items where store_name = 'prompt-library__backup-20261108';

-- คลังไวรัล: คืน 129 แถวที่เพิ่ม 25–26 ก.ค.
insert into public.viral_examples
select (jsonb_populate_record(null::public.viral_examples, data)).*
from public.store_items where store_name = 'viral_examples__backup-20261108'
on conflict (id) do nothing;

select (select count(*) from public.store_items where store_name = 'prompt-library') as prompt_cards,
       (select count(*) from public.viral_examples) as viral_rows;
commit;
-- แถวสำรอง (*__backup-20261108) ลบทิ้งได้เมื่อมั่นใจแล้วเท่านั้น
