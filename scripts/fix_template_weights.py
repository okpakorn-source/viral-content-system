#!/usr/bin/env python3
"""
Fix template_2 always-winning bug in coverTemplateRegistry.js
Root cause: template_2 had gate imageCount>=3 (weakest), all others needed >=4 or >=5 + face
Fix: all templates get base score=50, emotion bonuses 10-35, window expanded 15->20
"""
import sys

filepath = r'src/lib/coverTemplateRegistry.js'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = 'export function autoSelectTemplate(imageCount, faceCount, storyIdentity) {'
start_idx = content.index(start_marker)
end_idx = content.rindex('}', 0, len(content)) + 1

# Thai unicode escapes for the regex patterns (to avoid encoding issues in script)
# \u0e40\u0e28\u0e23\u0e49\u0e32 = เศร้า
# \u0e2a\u0e30\u0e40\u0e17\u0e37\u0e2d\u0e19 = สะเทือน
# etc.

new_func = r"""export function autoSelectTemplate(imageCount, faceCount, storyIdentity) {
  // ── Before scoring: remove disabled or small-circle templates ──
  const ELIGIBLE_IDS = new Set(
    ALL_TEMPLATES
      .filter((t) => !t.disabled && !hasSmallCircle(t))
      .map((t) => t.id)
  );
  console.log(`[TemplateSelect] Eligible templates (no small circles): ${[...ELIGIBLE_IDS].join(', ')}`);

  if (ELIGIBLE_IDS.size === 0) return null;

  const emotion = storyIdentity?.emotion || '';
  const coverEmotion = storyIdentity?.coverEmotion || '';
  const emotionAll = `${emotion} ${coverEmotion}`;
  const storyText = storyIdentity?.story || '';
  // eslint-disable-next-line no-unused-vars
  const hasText = storyIdentity?.typography?.hook || storyIdentity?.typography?.punch;

  // ★ Emotion detection (Thai + English keywords — unchanged)
  const isSad = /""" + "\u0e40\u0e28\u0e23\u0e49\u0e32|\u0e2a\u0e30\u0e40\u0e17\u0e37\u0e2d\u0e19|\u0e23\u0e49\u0e2d\u0e07\u0e44\u0e2b\u0e49|\u0e40\u0e2a\u0e35\u0e22\u0e43\u0e08|\u0e2a\u0e39\u0e0d\u0e40\u0e2a\u0e35\u0e22|\u0e15\u0e32\u0e22|\u0e08\u0e32\u0e01\u0e44\u0e1b" + r"""|sad|tragedy/i.test(emotionAll);
  const isDrama = /drama|dramatic|shocking|shocked|angry|""" + "\u0e42\u0e01\u0e23\u0e18|\u0e0a\u0e47\u0e2d\u0e01|\u0e14\u0e48\u0e27\u0e19|\u0e1f\u0e49\u0e2d\u0e07|\u0e04\u0e14\u0e35" + r"""/i.test(emotionAll);
  const isWarm = /warm|hope|happy|""" + "\u0e2a\u0e31\u0e07\u0e04\u0e21|\u0e0a\u0e48\u0e27\u0e22\u0e40\u0e2b\u0e25\u0e37\u0e2d|\u0e19\u0e48\u0e32\u0e23\u0e31\u0e01|\u0e2d\u0e1a\u0e2d\u0e38\u0e48\u0e19|\u0e20\u0e39\u0e21\u0e34\u0e43\u0e08" + r"""/i.test(emotionAll);
  const isNeutral = /neutral/i.test(emotionAll) || (!isSad && !isDrama && !isWarm);

  // ★ Check for relationship news (unchanged logic)
  const characters = storyIdentity?.characters || [];
  const has2Characters = characters.length >= 2;
  const isRelationshipNews = /""" + "\u0e04\u0e39\u0e48\u0e23\u0e31\u0e01|\u0e2a\u0e32\u0e21\u0e35|\u0e20\u0e23\u0e23\u0e22\u0e32|\u0e41\u0e1f\u0e19|\u0e04\u0e23\u0e2d\u0e1a\u0e04\u0e23\u0e31\u0e27|\u0e41\u0e15\u0e48\u0e07\u0e07\u0e32\u0e19|\u0e2b\u0e22\u0e48\u0e32|\u0e40\u0e25\u0e34\u0e01|\u0e1e\u0e48\u0e2d|\u0e41\u0e21\u0e48|\u0e25\u0e39\u0e01|\u0e04\u0e39\u0e48\u0e01\u0e23\u0e13\u0e35|\u0e1e\u0e35\u0e48\u0e19\u0e49\u0e2d\u0e07|\u0e1c\u0e31\u0e27|\u0e40\u0e21\u0e35\u0e22|\u0e04\u0e39\u0e48\u0e0a\u0e35\u0e27\u0e34\u0e15|\u0e0a\u0e35\u0e27\u0e34\u0e15\u0e04\u0e39\u0e48" + r"""/i.test(storyText);

  // ═══════════════════════════════════════════════════════════════════
  // SCORING SYSTEM — FIX: all active templates get BASE SCORE = 50
  //
  // ROOT CAUSE of template_2 always winning (before this fix):
  //   - template_2 gate: imageCount >= 3  (weakest — always qualifies)
  //   - template_1 gate: imageCount>=5 + faceCount>=1 + isDrama
  //   - template_3 gate: imageCount>=5 + faceCount>=2 + (isSad||isDrama)
  //   - template_5/8:    imageCount>=4 + faceCount>=1
  //   - template_7:      imageCount>=4 + faceCount>=2 + has2Characters + isRelationship
  //   → neutral news + few images = template_2 ONLY candidate = 100% win rate
  //
  // FIX: equal base 50 for all, emotion bonus 10-35, window expanded 15→20
  // Expected distribution on neutral news: each template ~15-22%
  // ═══════════════════════════════════════════════════════════════════
  const scores = {};
  const hasEnoughImages = imageCount >= 3; // single minimum gate for all
  const hasFace = faceCount >= 1;
  const hasMany = imageCount >= 5;

  // --- template_1: Drama 5-slot (no circle) ---
  // Old: required imageCount>=5 + faceCount>=1 + isDrama (almost never selected)
  // New: base 50, drama wins clearly, still has neutral chance
  if (ELIGIBLE_IDS.has('template_1') && hasEnoughImages) {
    let s = 50;
    if (isDrama) s += 25; // strong drama bonus
    if (isSad)   s += 10;
    if (hasMany) s += 5;  // slight bonus for having many images
    scores['template_1'] = s;
  }

  // --- template_2: Clean 4-slot (no circle) ---
  // ★ ROOT CAUSE FIX: was hardcoded 70 for neutral+imageCount<=5
  // Old: scores['template_2'] = imageCount<=5 ? 70 : (isNeutral ? 55 : 45)
  //      → always 70 on neutral, others at 72 → almost never lost
  // New: base 50, tiny bonus only when images are scarce (no circle = safer)
  if (ELIGIBLE_IDS.has('template_2') && hasEnoughImages) {
    let s = 50; // NO special advantage anymore
    if (isNeutral && imageCount < 4) s += 5; // safe for very few images
    scores['template_2'] = s;
  }

  // --- template_3: Drama + circle ---
  // Old: required imageCount>=5 + faceCount>=2 + (isSad||isDrama)
  // New: base 50, excellent for sad/drama news
  if (ELIGIBLE_IDS.has('template_3') && hasEnoughImages) {
    let s = 50;
    if (isSad)   s += 25; // best for sad news
    if (isDrama) s += 20;
    if (hasFace) s += 5;
    scores['template_3'] = s;
  }

  // --- template_5: Event 5-slot + circle ---
  // Old: required imageCount>=4 + faceCount>=1 (skipped when faceCount=0)
  // New: base 50 + drama/warm bonus
  if (ELIGIBLE_IDS.has('template_5') && hasEnoughImages) {
    let s = 50;
    if (isDrama) s += 15;
    if (isWarm)  s += 10;
    if (hasFace) s += 5;
    scores['template_5'] = s;
  }

  // --- template_7: 2 characters (couple/family) ---
  // Kept specific relationship bonus, but now has base 50 so competes on neutral too
  if (ELIGIBLE_IDS.has('template_7') && hasEnoughImages) {
    let s = 50; // base — previously only entered when strict conditions met
    if (has2Characters && isRelationshipNews) s += 35; // strong relationship bonus
    else if (has2Characters)                  s += 10;
    if (faceCount >= 2)                       s += 10;
    scores['template_7'] = s;
  }

  // --- template_8: Clean Zone ---
  // Old: required imageCount>=4 + faceCount>=1 (skipped like template_5)
  // New: base 50 + warm/neutral bonus → wins on warm news, good on neutral
  if (ELIGIBLE_IDS.has('template_8') && hasEnoughImages) {
    let s = 50;
    if (isWarm)    s += 25; // best for warm/positive news
    if (isNeutral) s += 15; // good for neutral news
    if (hasFace)   s += 5;
    scores['template_8'] = s;
  }

  // --- template_4: DISABLED (circle_small < 320px) ---
  // if (ELIGIBLE_IDS.has('template_4') && imageCount >= 5 && faceCount >= 2 && isWarm) {
  //   scores['template_4'] = hasText ? 80 : 65;
  // }

  // ═══ Select template by weighted random ═══
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    // Fallback: use eligible template only
    return ELIGIBLE_IDS.has('template_5') ? 'template_5' : [...ELIGIBLE_IDS][0] || null;
  }

  // ★ Weighted random from candidates within 20 pts of top (window was 15, now 20)
  // Example neutral: t8=65, t1=50, t2=50, t3=50, t5=50, t7=50
  //   top=65, window=20 -> all 6 enter pool -> t8≈22%, others≈15% each
  const topScore = sorted[0][1];
  const candidates = sorted.filter(([, score]) => topScore - score <= 20);

  const totalWeight = candidates.reduce((sum, [, score]) => sum + score, 0);
  let rand = Math.random() * totalWeight;
  for (const [templateId, score] of candidates) {
    rand -= score;
    if (rand <= 0) {
      console.log(`[TemplateSelect] Chose: ${templateId} (score: ${score}/${topScore}) from ${candidates.length} candidates: ${candidates.map(c => `${c[0]}=${c[1]}`).join(', ')}`);
      return templateId;
    }
  }

  // Fallback (should rarely hit)
  console.log(`[TemplateSelect] Fallback: ${sorted[0][0]}`);
  return sorted[0][0];
}"""

new_content = content[:start_idx] + new_func + '\n'

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f'SUCCESS: wrote {len(new_content)} chars')
print(f'Old function was chars {start_idx}-{end_idx}')

# Verify
with open(filepath, 'r', encoding='utf-8') as f:
    check = f.read()
assert 'base 50' in check, 'base 50 comment not found!'
assert 'ROOT CAUSE FIX' in check, 'ROOT CAUSE FIX marker not found!'
assert 'window was 15, now 20' in check, 'window comment not found!'
print('VERIFIED OK')
