import { YoutubeTranscript } from 'youtube-transcript';

/**
 * ดึงเนื้อหาจาก YouTube Video
 * ใช้ oEmbed + YouTube Transcript (subtitles/CC)
 */
export async function extractFromYoutube(url) {
  try {
    const videoId = getYoutubeVideoId(url);
    if (!videoId) {
      return { success: false, type: 'youtube', error: 'URL YouTube ไม่ถูกต้อง', url };
    }

    // 1. ดึงข้อมูลวิดีโอจาก oEmbed
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    let videoInfo = {};
    
    try {
      const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
      if (oembedRes.ok) {
        videoInfo = await oembedRes.json();
      }
    } catch (e) {
      // oEmbed failed, continue without it
    }

    // 2. ดึง Transcript (subtitles/CC)
    let transcript = '';
    let transcriptAvailable = false;
    
    try {
      const transcriptData = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'th' });
      if (transcriptData && transcriptData.length > 0) {
        transcript = transcriptData.map(item => item.text).join(' ');
        transcriptAvailable = true;
      }
    } catch (e) {
      // Try English if Thai not available
      try {
        const transcriptDataEn = await YoutubeTranscript.fetchTranscript(videoId);
        if (transcriptDataEn && transcriptDataEn.length > 0) {
          transcript = transcriptDataEn.map(item => item.text).join(' ');
          transcriptAvailable = true;
        }
      } catch (e2) {
        // No transcript available
      }
    }

    // 3. Build result
    const title = videoInfo.title || 'YouTube Video';
    const author = videoInfo.author_name || '';
    
    let text = '';
    let note = '';
    
    if (transcriptAvailable && transcript.length > 50) {
      text = cleanTranscript(transcript);
      note = `ดึง transcript สำเร็จ (${text.length} ตัวอักษร)`;
    } else {
      text = `วิดีโอ: ${title}\nโดย: ${author}\n\n(ไม่มี subtitle/CC สำหรับวิดีโอนี้ — กรุณา copy/paste เนื้อหาที่ต้องการวิเคราะห์)`;
      note = 'ไม่พบ subtitle/CC — กรุณาใส่เนื้อหาเพิ่มเติมหรือใช้ Whisper API ถอดเสียง';
    }

    return {
      success: true,
      type: 'youtube',
      title,
      text,
      author,
      videoId,
      thumbnailUrl: videoInfo.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      transcriptAvailable,
      platform: 'youtube',
      extractedAt: new Date().toISOString(),
      note,
    };
  } catch (error) {
    return {
      success: false,
      type: 'youtube',
      error: `ไม่สามารถดึงข้อมูลจาก YouTube: ${error.message}`,
      url,
    };
  }
}

/**
 * Extract YouTube video ID from various URL formats
 */
export function getYoutubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Clean up transcript text
 */
function cleanTranscript(text) {
  return text
    .replace(/\[.*?\]/g, '') // Remove [Music], [Applause] etc.
    .replace(/\s+/g, ' ')
    .replace(/\. /g, '.\n\n')
    .trim();
}
