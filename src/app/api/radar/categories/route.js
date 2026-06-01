import { NextResponse } from 'next/server';

const RADAR_CATEGORIES = [
  { id: 'hot',      label: '🔥 ข่าวร้อนรวม',   icon: '🔥', color: '#ef4444' },
  { id: 'drama',    label: '🎭 ดราม่า',          icon: '🎭', color: '#f59e0b' },
  { id: 'celeb',    label: '⭐ ดารา/บันเทิง',    icon: '⭐', color: '#a855f7' },
  { id: 'politics', label: '🏛️ การเมือง',       icon: '🏛️', color: '#3b82f6' },
  { id: 'crime',    label: '🚨 อาชญากรรม',       icon: '🚨', color: '#dc2626' },
  { id: 'social',   label: '💬 สังคม/ไวรัล',     icon: '💬', color: '#10b981' },
  { id: 'tech',     label: '💻 เทค/AI',          icon: '💻', color: '#06b6d4' },
  { id: 'sport',    label: '⚽ กีฬา',            icon: '⚽', color: '#84cc16' },
];

export async function GET() {
  return NextResponse.json({ success: true, categories: RADAR_CATEGORIES });
}
