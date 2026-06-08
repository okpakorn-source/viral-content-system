#!/usr/bin/env python3
# fix_response_block.py — add new FIX C fields to return response
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

path = os.path.join(os.path.dirname(__file__), '..', 'src', 'app', 'api', 'auto-cover', 'route.js')
path = os.path.normpath(path)

with open(path, 'rb') as f:
    raw = f.read()
content = raw.decode('utf-8')

old_str = "      // \u2605 FIX 4: Story Match Validator results\r\n      storyMatchScore: storyMatchScore ?? null,\r\n      storyMatchReason: storyMatchReason ?? null,\r\n      viewerImpression: viewerImpression ?? null,\r\n      dominantElement: dominantElement ?? null,"

new_str = "      // FIX C: Cover Praising Test results\r\n      storyMatchScore: storyMatchScore ?? null,\r\n      storyMatchReason: storyMatchReason ?? null,\r\n      viewerImpression: viewerImpression ?? null,\r\n      dominantElement: dominantElement ?? null,\r\n      coverPraises: coverPraises ?? null,\r\n      isCorrectPraise: isCorrectPraise ?? null,\r\n      // storyMismatch: true = HARD REJECT (score < 3) -- UI should show warning\r\n      storyMismatch: storyMatchScore !== null && storyMatchScore < 3,\r\n      // coverPraising: viewer impression when score is LOW (< 5)\r\n      ...(storyMatchScore !== null && storyMatchScore < 5 ? { coverPraising: viewerImpression } : {}),"

if old_str not in content:
    print('ERROR: old_str not found!')
    sys.exit(1)

new_content = content.replace(old_str, new_str, 1)
with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(new_content)
print('Done! Response block updated.')
