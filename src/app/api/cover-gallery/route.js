import { NextResponse } from 'next/server';
import { getLatestGalleryImages, getAllGallerySessions, getGalleryBySession } from '@/lib/services/imageGallery';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session');
    const view = searchParams.get('view') || 'latest';
    
    if (sessionId) {
      // Get images for specific session
      const images = await getGalleryBySession(sessionId);
      return NextResponse.json({ success: true, images });
    }
    
    if (view === 'sessions') {
      // Get all sessions overview
      const sessions = await getAllGallerySessions();
      return NextResponse.json({ success: true, sessions });
    }
    
    // Default: get latest images
    const images = await getLatestGalleryImages(100);
    return NextResponse.json({ success: true, images });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
