import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    const session = await getSession(token);

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    // ดึงข้อมูลทั้งหมด
    const logs = await prisma.apiUsageLog.findMany({ orderBy: { createdAt: 'desc' } });

    // Grouping by Date
    const dailyMap = {};
    let totalCost = 0;

    logs.forEach(log => {
      // YYYY-MM-DD
      const dateStr = new Date(log.createdAt).toISOString().split('T')[0];
      
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = {
          date: dateStr,
          totalCost: 0,
          providers: {}
        };
      }

      dailyMap[dateStr].totalCost += log.costUsd || 0;
      totalCost += log.costUsd || 0;

      if (!dailyMap[dateStr].providers[log.provider]) {
        dailyMap[dateStr].providers[log.provider] = 0;
      }
      dailyMap[dateStr].providers[log.provider] += log.costUsd || 0;
    });

    const dailyStats = Object.values(dailyMap).sort((a, b) => new Date(b.date) - new Date(a.date));

    return NextResponse.json({
      success: true,
      data: {
        totalCost,
        dailyStats,
        rawLogs: logs.slice(0, 50) // ส่ง 50 รายการล่าสุด
      }
    });

  } catch (error) {
    console.error('[API Cost] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
