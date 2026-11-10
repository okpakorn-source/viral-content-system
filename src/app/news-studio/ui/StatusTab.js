'use client';
// แท็บ "สถานะระบบ": ระบบพร้อมเขียนไหม · ใช้โมเดลอะไรทำหน้าที่ไหน · กติกาที่ใช้ตรวจ · ท่อ Discord ต่อแล้วหรือยัง
import { ROLE_LABEL } from './api';

const ROLE_ORDER = ['director', 'analyzer', 'librarian', 'writer', 'checker', 'reader'];

function Have({ ok, yes = 'พร้อม', no = 'ยังไม่ได้ตั้งค่า' }) {
  return <span className={`ns-pill ${ok ? 'ok' : 'bad'}`}>{ok ? yes : no}</span>;
}

export default function StatusTab({ status, statusErr, onReload, busy }) {
  if (statusErr) {
    return (
      <div className="ns-stack">
        <div className="ns-note bad" role="alert">{statusErr}</div>
        <div><button type="button" className="ns-btn" onClick={onReload}>ลองใหม่</button></div>
      </div>
    );
  }
  if (!status) return <div className="ns-empty">กำลังตรวจสถานะระบบ…</div>;
  const { keys, models, libraries, store, runs, rules, jobs } = status;
  return (
    <div className="ns-stack">
      <div className={`ns-note ${status.ready ? 'info' : 'bad'}`} role="status">
        <b>{status.ready ? 'ระบบพร้อมเขียน' : 'ระบบยังไม่พร้อมเขียน'}</b>
        {!status.ready && ' · ดูรายการที่ขึ้นสีแดงด้านล่าง'}
      </div>
      {status.discord?.usesStudio ? (
        <div className="ns-note info">
          <b>ท่อ Discord ใช้ระบบนี้</b> · ข่าวข้อความล้วนที่พนักงานส่งทาง Discord ถูกเขียนด้วยระบบเขียนตัวใหม่ และขึ้นในแท็บประวัติงานพร้อมป้าย “จาก Discord” · ค้นข้อมูลเสริมจากเว็บ{status.discord.research ? 'เปิดอยู่' : 'ปิดอยู่'} · ถอยกลับไปนักเขียนชุดเดิมได้ด้วยการตั้ง NEWS_STUDIO_DISCORD=0
        </div>
      ) : (
        <div className="ns-note warn">
          <b>ท่อ Discord ถูกสลับกลับไปใช้นักเขียนชุดเดิม</b> · มีการตั้ง NEWS_STUDIO_DISCORD=0 ไว้ ระบบตัวใหม่จึงทำงานเฉพาะในหน้านี้
        </div>
      )}

      {!keys.authSecret && (
        <div className="ns-note bad">
          <b>ระบบล็อกอินของทั้งเว็บยังใช้ค่าลับสำรองที่เขียนอยู่ในโค้ด</b> · ยังไม่ได้ตั้ง AUTH_SECRET บนเครื่องนี้ ใครที่เคยเห็นซอร์สโค้ดสามารถปลอมบัตรล็อกอินแล้วสั่งเขียนหรืออ่านประวัติงานได้ ให้เจ้าของระบบตั้งค่า AUTH_SECRET เป็นค่าสุ่มยาวในตัวแปรแวดล้อม (ทุกคนต้องล็อกอินใหม่ 1 ครั้ง)
        </div>
      )}

      <div className="ns-two">
        <div className="ns-card">
          <div className="ns-card-head"><span className="ns-h2">สิ่งที่ระบบต้องมี</span><button type="button" className="ns-btn ns-btn-quiet" disabled={busy} onClick={onReload}>{busy ? 'กำลังตรวจ…' : 'ตรวจใหม่'}</button></div>
          <div className="ns-kv">
            <div>คีย์ Claude (ทิศทาง เขียน ตรวจ อ่าน)</div><div><Have ok={keys.anthropic} /></div>
            <div>คีย์ OpenAI (วิเคราะห์หมวด เลือกครู)</div><div><Have ok={keys.openai} /></div>
            <div>ตัวค้นข้อมูลเสริมจากเว็บ</div><div><Have ok={keys.research} no="ไม่ได้ตั้งค่า (เขียนได้ตามปกติ)" /></div>
            <div>คลังต้นแบบประเด็น</div><div>{libraries.exemplars.ok ? <span className="ns-num">{libraries.exemplars.count} ปก</span> : <span className="ns-pill bad">{libraries.exemplars.error}</span>}</div>
            <div>คลังครู</div><div>{libraries.teachers.ok ? <span className="ns-num">{libraries.teachers.count} โพสต์</span> : <span className="ns-pill bad">{libraries.teachers.error}</span>}</div>
            <div>ที่เก็บประวัติงาน</div><div>{store.mode === 'supabase' ? 'ฐานข้อมูลกลาง' : 'ไฟล์ในเครื่องนี้'} <span className="ns-muted">(เก็บ {store.maxRuns} งานล่าสุด)</span></div>
            <div>งานที่กำลังเขียนตอนนี้</div><div className="ns-num">{jobs.active} จาก {jobs.max} งานที่รับพร้อมกัน</div>
            <div>เพดานจำนวนงาน</div><div className="ns-num">{jobs.quota.perHour} งานต่อชั่วโมงทั้งระบบ · {jobs.quota.perUserHour} ต่อคน · {jobs.quota.perDay} ต่อวัน</div>
            <div>เวลาสูงสุดต่องาน</div><div className="ns-num">{jobs.hardSeconds} วินาที เกินแล้วปิดงานเป็นไม่สำเร็จ</div>
          </div>
        </div>

        <div className="ns-card">
          <div className="ns-card-head"><span className="ns-h2">โมเดลที่ใช้ในแต่ละหน้าที่</span></div>
          <div className="ns-kv">
            {ROLE_ORDER.filter((r) => models[r]).flatMap((r) => [
              <div key={`${r}k`}>{ROLE_LABEL[r]}</div>,
              <div key={`${r}v`}>{models[r].model}{models[r].effort ? <span className="ns-muted"> · ระดับคิด {models[r].effort}{models[r].thinking ? ' · คิดก่อนตอบ' : ''}</span> : null}</div>,
            ])}
          </div>
        </div>

        <div className="ns-card">
          <div className="ns-card-head"><span className="ns-h2">กติกาที่ระบบใช้ตรวจทุกเวอร์ชัน</span></div>
          <div className="ns-kv">
            <div>จำนวนเวอร์ชันต่อข่าว</div><div className="ns-num">{rules.versions} เวอร์ชัน ต่างทิศทางและต่างครู</div>
            <div>เขียนซ้ำได้สูงสุด</div><div className="ns-num">{rules.writeAttempts} รอบต่อเวอร์ชัน</div>
            <div>รูปแบบ</div><div className="ns-num">{rules.paragraphs} ย่อหน้า · {rules.minWords}–{rules.maxWords} คำ</div>
            <div>ความยาวรวม</div><div className="ns-num">ไม่เกินครูที่เลียน +10% (ช่วง {rules.minChars}–{rules.maxChars} ตัวอักษร)</div>
            <div>ย่อหน้าแรกและย่อหน้าท้าย</div><div>ไม่เกินย่อหน้าเดียวกันของครูที่เลียน +15% และย่อหน้าแรกต้องมีประเด็นที่ชู</div>
            <div>ยกจากเนื้อดิบ</div><div className="ns-num">ท่อนเดียวไม่เกิน {rules.maxRawRun} ตัวอักษร · รวมไม่เกิน {rules.maxRawCopyPct}% เมื่อเนื้อดิบยาวตั้งแต่ {rules.retellMinRawRatio} เท่าของโพสต์</div>
            <div>ข้อเท็จจริง</div><div>ผู้ตรวจเทียบกับเนื้อดิบทีละประโยค พบจุดร้ายแรง = เขียนใหม่</div>
            <div>การอ่าน</div><div className="ns-num">คนอ่านที่เห็นแค่โพสต์ต้องรู้เรื่องจากย่อหน้าแรก และสะดุดได้ไม่เกิน {rules.readerMaxHardParts} จุด</div>
            <div>เนื้อดิบที่รับ</div><div className="ns-num">{rules.minRawChars}–{rules.maxRawChars.toLocaleString('th-TH')} ตัวอักษร</div>
          </div>
        </div>

        <div className="ns-card">
          <div className="ns-card-head"><span className="ns-h2">ผลงานในคลังประวัติ</span></div>
          {runs.ok ? (
            <div className="ns-kv">
              <div>งานทั้งหมด</div><div className="ns-num">{runs.total} งาน ({runs.last24h} งานใน 24 ชั่วโมง)</div>
              <div>เวอร์ชันที่ผ่านทุกด่าน</div><div className="ns-num">{runs.versionsPassed} จาก {runs.versions}</div>
              <div>ผ่านตั้งแต่เขียนรอบแรก</div><div className="ns-num">{runs.firstTry} จาก {runs.versions}</div>
              <div>เวลาต่องาน (ค่ากลาง)</div><div className="ns-num">{runs.medianSeconds != null ? `${runs.medianSeconds} วินาที` : 'ยังไม่มีข้อมูล'}</div>
              <div>งานที่ไม่สำเร็จ</div><div className="ns-num">{runs.failed} ล้ม · {runs.stale} หยุดกลางทาง</div>
              <div>รีวิวของคน</div><div className="ns-num">ดี {runs.reviewed.good} · ไม่ดี {runs.reviewed.bad} · นำไปใช้ {runs.reviewed.used}</div>
            </div>
          ) : <div className="ns-card-pad"><div className="ns-note bad">อ่านคลังประวัติไม่ได้: {runs.error}</div></div>}
        </div>
      </div>
    </div>
  );
}
