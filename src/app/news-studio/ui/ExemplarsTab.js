'use client';
// แท็บ "ต้นแบบประเด็น": ปกต้นแบบ 33 ใบที่ระบบใช้ตัดสินว่า "ข่าวนี้จะชูอะไร" (อ่านอย่างเดียว)
import { useEffect, useState } from 'react';
import { getJson, TECHNIQUE_LABEL } from './api';

export default function ExemplarsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tech, setTech] = useState('');

  useEffect(() => {
    let alive = true;
    getJson('/api/news-studio/library?kind=exemplars').then((d) => {
      if (!alive) return;
      if (d.success) setData(d); else setErr(d.error || 'โหลดคลังต้นแบบไม่สำเร็จ');
    });
    return () => { alive = false; };
  }, []);

  if (err) return <div className="ns-note bad" role="alert">{err}</div>;
  if (!data) return <div className="ns-empty">กำลังโหลดคลังต้นแบบประเด็น…</div>;

  const techs = Object.entries(data.techniques).sort((a, b) => b[1] - a[1]);
  const items = tech ? data.items.filter((x) => x.technique === tech) : data.items;

  return (
    <div className="ns-stack">
      <div className="ns-note info">
        ทุกครั้งที่มีเนื้อดิบเข้ามา ระบบอ่านต้นแบบทั้ง {data.total} ใบนี้ก่อน แล้วเลือกว่าจะชูประเด็นไหน เล่าเรียงอย่างไร และถ้อยคำใดต้องคงไว้ โพสต์ครูมีหน้าที่แค่ให้สำนวน
      </div>
      <div className="ns-chips" role="group" aria-label="กรองตามวิธีจับประเด็น">
        <button type="button" className="ns-chip" aria-pressed={tech === ''} onClick={() => setTech('')}>ทั้งหมด {data.total}</button>
        {techs.map(([k, n]) => (
          <button key={k} type="button" className="ns-chip" aria-pressed={tech === k} onClick={() => setTech(k)}>{TECHNIQUE_LABEL[k] || k} {n}</button>
        ))}
      </div>
      <div className="ns-grid">
        {items.map((x) => (
          <article key={x.id} className="ns-card ns-ex">
            <img className="ns-ex-img" src={x.imageUrl} alt={`ปกต้นแบบ ${x.id}: ${x.lines.join(' ')}`} loading="lazy" decoding="async" />
            <div className="ns-ex-body">
              <div className="ns-ex-lines">{x.lines.join('\n')}</div>
              <div className="ns-line">
                <span className="ns-pill plain">{TECHNIQUE_LABEL[x.technique] || x.technique}</span>
                <span className="ns-muted">{x.id}</span>
              </div>
            </div>
            <details className="ns-disclose">
              <summary>ทำไมปกนี้ได้ผล</summary>
              <div className="ns-disclose-body">
                {x.angle && <div>{x.angle}</div>}
                {x.lineRoles.length > 0 && (
                  <ol className="ns-roles">
                    {x.lines.map((l, i) => <li key={i}><b>{l}</b>{x.lineRoles[i] ? ` · ${x.lineRoles[i]}` : ''}</li>)}
                  </ol>
                )}
                {x.techniqueNote && <div>{x.techniqueNote}</div>}
              </div>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
