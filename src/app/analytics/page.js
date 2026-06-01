'use client';
import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('performance');
  const [userRole, setUserRole] = useState(null);
  const [costData, setCostData] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);

  useEffect(() => {
    // Check role
    fetch('/api/auth')
      .then(res => res.json())
      .then(data => {
        if (data.loggedIn && data.member?.role) {
          setUserRole(data.member.role);
          if (data.member.role === 'admin') {
            fetchCostData();
          }
        }
      })
      .catch(console.error);
  }, []);

  const fetchCostData = async () => {
    setLoadingCost(true);
    try {
      const res = await fetch('/api/analytics/cost');
      const data = await res.json();
      if (data.success) {
        setCostData(data.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCost(false);
    }
  };

  return (
    <>
      <Header title="📈 สถิติ & ต้นทุน" subtitle="วิเคราะห์ผลลัพธ์และต้นทุนของระบบ" />
      <div className="page-content">
        
        {/* Tabs Navigation */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border)' }}>
          <button 
            onClick={() => setActiveTab('performance')}
            style={{ 
              padding: '10px 20px', 
              background: activeTab === 'performance' ? 'var(--bg-card)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'performance' ? '2px solid var(--primary)' : 'none',
              color: activeTab === 'performance' ? 'var(--text)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            📊 สถิติคอนเทนต์
          </button>
          
          {userRole === 'admin' && (
            <button 
              onClick={() => setActiveTab('cost')}
              style={{ 
                padding: '10px 20px', 
                background: activeTab === 'cost' ? 'var(--bg-card)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === 'cost' ? '2px solid var(--accent)' : 'none',
                color: activeTab === 'cost' ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              💰 ต้นทุน API (Admin Only)
            </button>
          )}
        </div>

        {/* Tab Content: Performance */}
        {activeTab === 'performance' && (
          <div>
            <div className="stats-grid">
              <div className="stat-card success">
                <div className="stat-card-header"><div className="stat-card-icon success">👁️</div></div>
                <div className="stat-card-value">0</div>
                <div className="stat-card-label">Reach รวม</div>
              </div>
              <div className="stat-card viral">
                <div className="stat-card-header"><div className="stat-card-icon viral">🔥</div></div>
                <div className="stat-card-value">0</div>
                <div className="stat-card-label">Engagement รวม</div>
              </div>
              <div className="stat-card accent">
                <div className="stat-card-header"><div className="stat-card-icon accent">🔄</div></div>
                <div className="stat-card-value">0</div>
                <div className="stat-card-label">Shares รวม</div>
              </div>
              <div className="stat-card warning">
                <div className="stat-card-header"><div className="stat-card-icon warning">💬</div></div>
                <div className="stat-card-value">0</div>
                <div className="stat-card-label">Comments รวม</div>
              </div>
            </div>
            <div className="card" style={{ marginTop: 20 }}>
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-title">ยังไม่มีข้อมูลสถิติ</div>
                <div className="empty-state-text">เมื่อเผยแพร่คอนเทนต์แล้ว ระบบจะดึงข้อมูลสถิติจาก Facebook มาแสดงที่นี่</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Cost */}
        {activeTab === 'cost' && userRole === 'admin' && (
          <div>
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
              <div className="stat-card accent">
                <div className="stat-card-header"><div className="stat-card-icon accent">💵</div></div>
                <div className="stat-card-value">${costData?.totalCost?.toFixed(4) || '0.0000'}</div>
                <div className="stat-card-label">ต้นทุน API รวมทั้งหมด</div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 15, fontSize: 18 }}>📅 สรุปยอดรายวัน</h3>
              
              {loadingCost ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลดข้อมูล...</div>
              ) : costData?.dailyStats?.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px' }}>วันที่</th>
                        <th style={{ padding: '12px' }}>ต้นทุนรวม (USD)</th>
                        <th style={{ padding: '12px' }}>แยกตาม AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costData.dailyStats.map((stat, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px', fontWeight: 'bold' }}>{stat.date}</td>
                          <td style={{ padding: '12px', color: 'var(--accent)', fontWeight: 'bold' }}>${stat.totalCost.toFixed(5)}</td>
                          <td style={{ padding: '12px', fontSize: 13, color: 'var(--text-muted)' }}>
                            {Object.entries(stat.providers).map(([provider, cost]) => (
                              <div key={provider}>
                                <span>{provider.toUpperCase()}</span>: ${cost.toFixed(5)}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">💸</div>
                  <div className="empty-state-title">ยังไม่มีการใช้งาน API</div>
                  <div className="empty-state-text">จะเริ่มแสดงข้อมูลเมื่อมีการทำงานของ AI เกิดขึ้น</div>
                </div>
              )}
            </div>
            
            {/* Raw Logs Table (Optional for debug) */}
            <div className="card" style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 15, fontSize: 16 }}>📋 50 รายการล่าสุด</h3>
              <div style={{ overflowX: 'auto', maxHeight: '300px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px' }}>เวลา</th>
                      <th style={{ padding: '8px' }}>AI</th>
                      <th style={{ padding: '8px' }}>ฟีเจอร์</th>
                      <th style={{ padding: '8px' }}>Tokens (In / Out)</th>
                      <th style={{ padding: '8px' }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData?.rawLogs?.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '8px' }}>{new Date(log.createdAt).toLocaleTimeString('th-TH')}</td>
                        <td style={{ padding: '8px' }}>{log.provider} ({log.model})</td>
                        <td style={{ padding: '8px' }}>{log.feature}</td>
                        <td style={{ padding: '8px' }}>{log.inputTokens} / {log.outputTokens}</td>
                        <td style={{ padding: '8px', color: 'var(--accent)' }}>${log.costUsd?.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>
    </>
  );
}
