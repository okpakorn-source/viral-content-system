'use client';

export default function Header({ title, subtitle, children }) {
  return (
    <header className="header">
      <div className="header-left">
        <div>
          <div className="header-title">{title}</div>
          {subtitle && <div className="header-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="header-right">
        {children}
        <div style={{
          width: 36, height: 36,
          borderRadius: '50%',
          background: 'var(--gradient-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, cursor: 'pointer'
        }}>
          A
        </div>
      </div>
    </header>
  );
}
