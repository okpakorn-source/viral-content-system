'use client';

// Visual layout diagram for each template
const LAYOUT_DIAGRAMS = {
  accident: {
    color: '#22c55e',
    zones: [
      { label: 'BG', x:0,   y:0,   w:100, h:100, opacity:0.2 },
      { label: 'ใบหน้าหลัก', x:0,  y:0,  w:55, h:63, opacity:0.7, main:true },
      { label: 'บริบท',      x:57, y:0,  w:43, h:31, opacity:0.5 },
      { label: '🟢เหตุการณ์',x:57, y:32, w:43, h:30, opacity:0.6, border:'#22c55e' },
      { label: 'บุคคลรอง',   x:32, y:64, w:38, h:36, opacity:0.5 },
      { label: '⚫วงกลม',    x:0,  y:66, w:30, h:30, opacity:0.45, circle:true },
    ]
  },
  crime: {
    color: '#ef4444',
    zones: [
      { label: 'BG', x:0,y:0,w:100,h:100,opacity:0.2 },
      { label: '🔴หลักฐาน', x:0,y:0,w:100,h:44,opacity:0.65,border:'#ef4444' },
      { label: 'ใบหน้า',    x:0,y:46,w:52,h:54,opacity:0.7,main:true },
      { label: 'บริบท',    x:54,y:46,w:46,h:54,opacity:0.5 },
    ]
  },
  politics: {
    color: '#3b82f6',
    zones: [
      { label: 'BG', x:0,y:0,w:100,h:100,opacity:0.2 },
      { label: 'บุคคล A', x:0, y:5,w:49,h:69,opacity:0.7,main:true },
      { label: 'บุคคล B', x:51,y:5,w:49,h:69,opacity:0.65 },
      { label: 'บริบท',   x:0, y:75,w:100,h:25,opacity:0.4 },
    ]
  },
  economy: {
    color: '#f59e0b',
    zones: [
      { label: 'BG', x:0,y:0,w:100,h:100,opacity:0.2 },
      { label: 'บุคคล',    x:5, y:9,w:46,h:55,opacity:0.7,main:true },
      { label: '💰กราฟ',   x:53,y:7,w:42,h:33,opacity:0.6,border:'#f59e0b' },
      { label: 'บริบท',    x:53,y:43,w:42,h:33,opacity:0.5 },
    ]
  },
  entertainment: {
    color: '#ec4899',
    zones: [
      { label: 'BG', x:0,y:0,w:100,h:100,opacity:0.2 },
      { label: 'บุคคลหลัก', x:13,y:4,w:74,h:74,opacity:0.75,main:true },
      { label: 'รอง', x:0,y:37,w:18,h:28,opacity:0.5,circle:true },
    ]
  },
};

export default function TemplateDiagram({ templateId, selected, onClick, label, icon }) {
  const d = LAYOUT_DIAGRAMS[templateId];
  if (!d) return null;
  const W = 120, H = 120;

  return (
    <button onClick={onClick} style={{
      background: selected ? `${d.color}18` : 'var(--bg-primary)',
      border: `2px solid ${selected ? d.color : 'var(--border)'}`,
      borderRadius: 10, padding: 8, cursor: 'pointer', textAlign: 'center',
      transition: 'all .2s', width: '100%',
    }}>
      {/* SVG Diagram */}
      <svg width={W} height={H} style={{ display: 'block', margin: '0 auto 6px' }}>
        <rect width={W} height={H} rx="6" fill="#0a0a14"/>
        {d.zones.map((z, i) => {
          const px = (z.x/100)*W, py = (z.y/100)*H;
          const pw = (z.w/100)*W, ph = (z.h/100)*H;
          if (z.circle) {
            const r = Math.min(pw,ph)/2;
            return (
              <g key={i}>
                <circle cx={px+r} cy={py+r} r={r} fill={d.color} fillOpacity={z.opacity} stroke={d.color} strokeWidth="1.5" strokeOpacity="0.6"/>
                <text x={px+r} y={py+r+3} textAnchor="middle" fill="white" fontSize="7" fontFamily="sans-serif">{z.label}</text>
              </g>
            );
          }
          return (
            <g key={i}>
              <rect x={px} y={py} width={pw} height={ph} rx="3"
                fill={z.main ? d.color : 'white'}
                fillOpacity={z.opacity}
                stroke={z.border || (z.main ? d.color : 'rgba(255,255,255,0.2)')}
                strokeWidth={z.border ? 2 : 0.5}
              />
              <text x={px+pw/2} y={py+ph/2+3} textAnchor="middle" fill="white" fontSize="7" fontFamily="sans-serif" style={{pointerEvents:'none'}}>
                {z.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, fontWeight: selected ? 800 : 600, color: selected ? d.color : 'var(--text-muted)' }}>
        {icon} {label}
      </div>
    </button>
  );
}
