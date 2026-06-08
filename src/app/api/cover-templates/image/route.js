import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extname } from 'path';

const BASE_DIR = 'C:\\Users\\User\\Downloads\\ปกข่าว10วัน-20260608T091951Z-3-001\\ปกข่าว10วัน';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file'); // e.g. "วันที่22พ.ค/ปก1.jpg"

    if (!file) {
      return NextResponse.json({ error: 'Missing file param', errorType: 'MISSING_PARAM' }, { status: 400 });
    }

    // Security: block path traversal
    if (file.includes('..') || file.includes('\\')) {
      return NextResponse.json({ error: 'Invalid path', errorType: 'INVALID_PATH' }, { status: 400 });
    }

    const fullPath = join(BASE_DIR, file);
    const imageBuffer = readFileSync(fullPath);

    const ext = extname(file).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const contentType = mimeTypes[ext] || 'image/jpeg';

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    // Return placeholder if image not found
    return NextResponse.json({ error: 'Image not found', errorType: 'IMAGE_NOT_FOUND' }, { status: 404 });
  }
}
