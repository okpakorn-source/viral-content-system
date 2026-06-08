import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

let _cache = null;
let _cacheTime = 0;

function loadTemplates() {
  const now = Date.now();
  if (_cache && now - _cacheTime < 30000) return _cache; // 30s cache

  const filePath = join(process.cwd(), 'data', 'cover-templates.json');
  const raw = readFileSync(filePath, 'utf-8');
  _cache = JSON.parse(raw).templates || [];
  _cacheTime = now;
  return _cache;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const layoutType   = searchParams.get('layoutType');
    const minScore     = parseInt(searchParams.get('minScore') || '0');
    const subject      = searchParams.get('subjectVisibility');
    const fadeType     = searchParams.get('fadeType');
    const tag          = searchParams.get('tag');
    const day          = searchParams.get('day');
    const limit        = parseInt(searchParams.get('limit') || '100');
    const statsOnly    = searchParams.get('stats') === '1';

    const templates = loadTemplates();

    // ── Filter ──
    let filtered = templates.filter(t => {
      if (layoutType && t.layoutType !== layoutType) return false;
      if (minScore   && t.viralScore < minScore)     return false;
      if (subject    && t.subjectVisibility !== subject) return false;
      if (fadeType   && t.fadeType !== fadeType)     return false;
      if (day        && t.day !== day)               return false;
      if (tag        && !t.tags?.includes(tag))      return false;
      return true;
    });

    // ── Stats ──
    const stats = {
      total: templates.length,
      filtered: filtered.length,
      byLayout: {},
      byScore: {},
      bySubject: {},
      byDay: {},
      avgViralScore: 0,
      topTemplates: [],
    };

    templates.forEach(t => {
      stats.byLayout[t.layoutType]         = (stats.byLayout[t.layoutType] || 0) + 1;
      stats.byScore[t.viralScore]          = (stats.byScore[t.viralScore] || 0) + 1;
      stats.bySubject[t.subjectVisibility] = (stats.bySubject[t.subjectVisibility] || 0) + 1;
      stats.byDay[t.day]                  = (stats.byDay[t.day] || 0) + 1;
    });

    stats.avgViralScore = +(templates.reduce((s, t) => s + t.viralScore, 0) / templates.length).toFixed(1);
    stats.topTemplates  = [...templates].sort((a, b) => b.viralScore - a.viralScore).slice(0, 5).map(t => ({
      id: t.id, sourceFile: t.sourceFile, viralScore: t.viralScore, layoutType: t.layoutType
    }));

    // All unique tags
    const allTags = [...new Set(templates.flatMap(t => t.tags || []))].sort();
    const allDays = [...new Set(templates.map(t => t.day))].sort();

    if (statsOnly) {
      return NextResponse.json({ success: true, stats, allTags, allDays });
    }

    return NextResponse.json({
      success: true,
      templates: filtered.slice(0, limit),
      stats,
      allTags,
      allDays,
    });

  } catch (err) {
    console.error('[cover-templates API]', err.message);
    return NextResponse.json({ success: false, error: err.message, errorType: 'TEMPLATE_READ_ERROR' }, { status: 500 });
  }
}
