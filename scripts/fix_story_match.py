#!/usr/bin/env python3
# fix_story_match.py — replace Story Match Validator with Cover Praising Test
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

path = os.path.join(os.path.dirname(__file__), '..', 'src', 'app', 'api', 'auto-cover', 'route.js')
path = os.path.normpath(path)

with open(path, 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8')

# Find the old block boundaries using unique substrings
old_start_marker = '    // \u2605 FIX 4: Story Match Validator'
old_end_after = "Story Match Validator error:', smErr.message);\r\n    }"

idx_start = content.find(old_start_marker)
if idx_start == -1:
    print('ERROR: Could not find start marker')
    sys.exit(1)

idx_end = content.find(old_end_after, idx_start)
if idx_end == -1:
    print('ERROR: Could not find end marker')
    sys.exit(1)

idx_end += len(old_end_after)
print(f'OK: Replacing chars {idx_start}..{idx_end} ({idx_end - idx_start} chars)')

new_block = """    // FIX C: Cover Praising Test -- Story Match Validator (upgraded)
    let storyMatchScore = null;
    let storyMatchReason = null;
    let viewerImpression = null;
    let dominantElement = null;
    let coverPraises = null;
    let isCorrectPraise = null;
    try {
      if (identity?.coreStory?.emotionalHook && coverBuffer) {
        const { GoogleGenerativeAI: _SmGAI } = await import('@google/generative-ai');
        const smGenAI = new _SmGAI(process.env.GEMINI_API_KEY);
        const smModel = smGenAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const celebratedTarget = identity.coreStory?.celebratedAction
          || identity.coreStory?.emotionalHook
          || 'the main story';

        const storyMatchPrompt = `You are a cover critic. Look at this news cover image.

Question 1: What is this cover PRAISING or CELEBRATING? (one sentence)
Question 2: What story does the viewer think this is about? (one sentence)

Target: This cover should praise: "${celebratedTarget}"

Return JSON without markdown:
{
  "coverPraises": "what the cover is praising/celebrating",
  "viewerThinks": "what story viewer thinks this is",
  "storyMatch": 0-10,
  "isCorrectPraise": true/false,
  "dominantVisual": "what takes most space",
  "reason": "why match or mismatch"
}`;
        const smResult = await smModel.generateContent([
          storyMatchPrompt,
          { inlineData: { data: coverBuffer.toString('base64'), mimeType: 'image/jpeg' } }
        ]);
        const smText = smResult.response.text().trim();
        const smMatch = smText.match(/```(?:json)?\\s*({[\\s\\S]*?})\\s*```/) || smText.match(/({[\\s\\S]*?"storyMatch"[\\s\\S]*?})/);
        if (smMatch) {
          const smData = JSON.parse(smMatch[1] || smMatch[0]);
          storyMatchScore = smData.storyMatch;
          storyMatchReason = smData.reason;
          viewerImpression = smData.viewerThinks;
          dominantElement = smData.dominantVisual;
          coverPraises = smData.coverPraises;
          isCorrectPraise = smData.isCorrectPraise;
          if (storyMatchScore < 3) {
            console.warn(`[AutoCover] HARD REJECT: storyMatch=${storyMatchScore}/10`);
            console.warn(`[AutoCover]   Cover praises: "${coverPraises}"`);
            console.warn(`[AutoCover]   Should praise: "${celebratedTarget}"`);
            console.warn(`[AutoCover]   Viewer thinks: "${viewerImpression}"`);
          } else if (storyMatchScore < 5) {
            console.warn(`[AutoCover] Story Match LOW: ${storyMatchScore}/10`);
            console.warn(`[AutoCover] Cover praises: "${coverPraises}" | Should: "${celebratedTarget}"`);
            console.warn(`[AutoCover] Viewer: "${viewerImpression}" | Dominant: "${dominantElement}"`);
          } else {
            console.log(`[AutoCover] Story Match: ${storyMatchScore}/10 -- ${storyMatchReason}`);
          }
        }
      }
    } catch (smErr) {
      console.warn('[AutoCover] Story Match Validator error:', smErr.message);
    }"""

# Convert line endings to CRLF to match the file
new_block_crlf = new_block.replace('\r\n', '\n').replace('\n', '\r\n')

new_content = content[:idx_start] + new_block_crlf + content[idx_end:]

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(new_content)

print(f'Done! File written ({len(new_content)} chars).')
