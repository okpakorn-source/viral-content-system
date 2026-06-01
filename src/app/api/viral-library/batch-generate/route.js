import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { filter } = await request.json();
    // filter: 'all' | 'no-prompt' | 'has-prompt'
    
    const viralStore = createStore('viral-library');
    const promptStore = createStore('prompt-library');
    
    let items = await viralStore.getAll();
    
    // Filter items based on selection
    if (filter === 'no-prompt') {
      items = items.filter(i => i.status !== 'prompted' || !i.generatedPrompt);
    } else if (filter === 'has-prompt') {
      items = items.filter(i => i.status === 'prompted' && i.generatedPrompt);
    }
    // 'all' = no filter
    
    // Return list of item IDs and their current status for the frontend to process
    const itemList = items.map(i => ({
      id: i.id,
      title: i.title || (i.content || '').slice(0, 60),
      status: i.status,
      hasPrompt: !!i.generatedPrompt,
      hasAnalysis: !!i.analysis,
      contentLength: (i.content || '').length,
    }));
    
    return NextResponse.json({
      success: true,
      total: itemList.length,
      items: itemList,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
