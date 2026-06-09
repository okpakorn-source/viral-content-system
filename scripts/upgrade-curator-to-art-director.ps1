# Upgrade Curator to AI Art Director — Line-based edits (Thai-safe)
# Uses line number replacement to avoid string quoting issues

$file = 'c:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16\src\app\api\auto-cover\route.js'
$lines = [System.IO.File]::ReadAllLines($file, [System.Text.Encoding]::UTF8)
$totalBefore = $lines.Count
Write-Host "Read $totalBefore lines from route.js" -ForegroundColor Gray

# === Change 1: Line 1597 — Upgrade model to GPT-5.5 ===
Write-Host "`n=== Change 1: Model upgrade ===" -ForegroundColor Cyan
# Line 1597 (0-indexed: 1596): "      model: MODEL_VISION,"
$idx1597 = 1596
if ($lines[$idx1597] -match 'MODEL_VISION') {
    $lines[$idx1597] = "      model: 'gpt-5.5',"
    Write-Host "  Line 1597: MODEL_VISION -> gpt-5.5" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Line 1597 doesn't contain MODEL_VISION: $($lines[$idx1597])" -ForegroundColor Red
}

# Line 1599 (0-indexed: 1598): "      maxTokens: 1000,"
$idx1599 = 1598
if ($lines[$idx1599] -match 'maxTokens: 1000') {
    $lines[$idx1599] = "      maxTokens: 2000,"
    Write-Host "  Line 1599: maxTokens 1000 -> 2000" -ForegroundColor Green
}

# Line 1600 (0-indexed: 1599): systemPrompt line
$idx1600 = 1599
if ($lines[$idx1600] -match 'systemPrompt:') {
    $lines[$idx1600] = "      systemPrompt: '\u0E04\u0E38\u0E13\u0E40\u0E1B\u0E47\u0E19 AI Art Director \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1B\u0E01\u0E02\u0E48\u0E32\u0E27\u0E44\u0E27\u0E23\u0E31\u0E25 \u0E14\u0E39\u0E20\u0E32\u0E1E\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14\u0E41\u0E25\u0E49\u0E27\u0E15\u0E31\u0E14\u0E2A\u0E34\u0E19\u0E43\u0E08\u0E40\u0E2B\u0E21\u0E37\u0E2D\u0E19\u0E04\u0E19\u0E08\u0E31\u0E14\u0E1B\u0E01\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E \u0E15\u0E2D\u0E1A JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19',"
    Write-Host "  Line 1600: systemPrompt updated to Art Director" -ForegroundColor Green
}

Write-Host "`n=== Change 2: Add Art Director section to prompt ===" -ForegroundColor Cyan

# Find the line with "...จนครบทุกภาพ" (around line 1559)
$promptEndIdx = -1
for ($i = 1550; $i -lt 1570; $i++) {
    if ($lines[$i] -match '\.\.\.\u0E08\u0E19\u0E04\u0E23\u0E1A\u0E17\u0E38\u0E01\u0E20\u0E32\u0E1E') {
        $promptEndIdx = $i
        break
    }
}

if ($promptEndIdx -ge 0) {
    Write-Host "  Found prompt end at line $($promptEndIdx + 1)" -ForegroundColor Gray
    # The next line after "...จนครบทุกภาพ..." is "]}" — we need to replace "]}" with the new format
    # Line $promptEndIdx+1 should be "]}"
    $closingIdx = $promptEndIdx + 1
    if ($lines[$closingIdx] -match '^\]\}') {
        # Replace "]}" with new artDirection JSON schema
        $newLines = @(
            '],',
            '  "artDirection": {',
            '    "heroIndex": "<index of Hero image>",',
            '    "circleIndex": "<index of Circle image>",',
            '    "highlightIndex": "<index of Highlight image>",',
            '    "secondaryPersonIndex": "<index or null>",',
            '    "bgIndices": ["<bg indices>"],',
            '    "rejectIndices": ["<reject indices>"],',
            '    "heroReason": "<reason>",',
            '    "circleReason": "<reason>"',
            '  }',
            '}'
        )
        $linesList = [System.Collections.ArrayList]::new($lines)
        $linesList.RemoveAt($closingIdx)
        for ($j = 0; $j -lt $newLines.Count; $j++) {
            $linesList.Insert($closingIdx + $j, $newLines[$j])
        }
        $lines = $linesList.ToArray()
        Write-Host "  Replaced ]} with artDirection JSON schema (+$($newLines.Count - 1) lines)" -ForegroundColor Green
    }
}

# Add Art Director instructions before CIRCLE SLOT RULES
$circleRulesIdx = -1
for ($i = 1560; $i -lt 1590; $i++) {
    if ($i -lt $lines.Count -and $lines[$i] -match 'CIRCLE SLOT RULES') {
        $circleRulesIdx = $i
        break
    }
}

if ($circleRulesIdx -ge 0) {
    Write-Host "  Found CIRCLE SLOT RULES at line $($circleRulesIdx + 1)" -ForegroundColor Gray
    $artDirectorInstructions = @(
        '',
        "## \u2605\u2605\u2605 ART DIRECTOR DECISIONS (NEW!) \u2605\u2605\u2605",
        "\u0E19\u0E2D\u0E01\u0E08\u0E32\u0E01 relevance score \u0E41\u0E25\u0E49\u0E27 \u0E43\u0E2B\u0E49\u0E15\u0E31\u0E14\u0E2A\u0E34\u0E19\u0E43\u0E08\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E15\u0E34\u0E21:",
        "\u0E14\u0E39\u0E20\u0E32\u0E1E\u0E17\u0E38\u0E01\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E49\u0E27\u0E15\u0E31\u0E14\u0E2A\u0E34\u0E19\u0E43\u0E08\u0E40\u0E2B\u0E21\u0E37\u0E2D\u0E19\u0E04\u0E19\u0E08\u0E31\u0E14\u0E1B\u0E01\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E:",
        "1. \u0E20\u0E32\u0E1E Hero (\u0E2B\u0E25\u0E31\u0E01): \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E1E professional \u0E2B\u0E19\u0E49\u0E32\u0E0A\u0E31\u0E14 (portrait/\u0E2A\u0E31\u0E21\u0E20\u0E32\u0E29\u0E13\u0E4C/\u0E02\u0E48\u0E32\u0E27) \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 selfie, \u0E44\u0E21\u0E48\u0E21\u0E35 watermark",
        "2. \u0E20\u0E32\u0E1E Circle (\u0E27\u0E07\u0E01\u0E25\u0E21): \u0E20\u0E32\u0E1E\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E31\u0E21\u0E1E\u0E31\u0E19\u0E18\u0E4C 2 \u0E04\u0E19 (\u0E04\u0E39\u0E48/\u0E04\u0E23\u0E2D\u0E1A\u0E04\u0E23\u0E31\u0E27) \u0E2B\u0E23\u0E37\u0E2D\u0E20\u0E32\u0E1E\u0E40\u0E14\u0E35\u0E22\u0E27\u0E17\u0E35\u0E48\u0E2D\u0E1A\u0E2D\u0E38\u0E48\u0E19",
        "3. \u0E20\u0E32\u0E1E Highlight (\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21): \u0E20\u0E32\u0E1E\u0E01\u0E34\u0E08\u0E01\u0E23\u0E23\u0E21\u0E2A\u0E33\u0E04\u0E31\u0E0D (\u0E14\u0E39\u0E41\u0E25 \u0E1B\u0E49\u0E2D\u0E19\u0E02\u0E49\u0E32\u0E27 \u0E21\u0E2D\u0E1A\u0E40\u0E07\u0E34\u0E19 \u0E04\u0E23\u0E2D\u0E1A\u0E04\u0E23\u0E31\u0E27\u0E23\u0E27\u0E21\u0E01\u0E31\u0E19)",
        "4. \u0E20\u0E32\u0E1E Background: \u0E2A\u0E16\u0E32\u0E19\u0E17\u0E35\u0E48/\u0E1A\u0E23\u0E34\u0E1A\u0E17\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07",
        "5. \u0E20\u0E32\u0E1E\u0E04\u0E19\u0E17\u0E35\u0E48 2 (\u0E25\u0E48\u0E32\u0E07\u0E02\u0E27\u0E32): \u0E04\u0E19\u0E17\u0E35\u0E48\u0E40\u0E01\u0E35\u0E48\u0E22\u0E27\u0E02\u0E49\u0E2D\u0E07\u0E2D\u0E35\u0E01\u0E04\u0E19 (\u0E41\u0E21\u0E48 \u0E1E\u0E48\u0E2D \u0E1C\u0E39\u0E49\u0E23\u0E31\u0E1A)",
        ''
    )
    $linesList = [System.Collections.ArrayList]::new($lines)
    for ($j = 0; $j -lt $artDirectorInstructions.Count; $j++) {
        $linesList.Insert($circleRulesIdx + $j, $artDirectorInstructions[$j])
    }
    $lines = $linesList.ToArray()
    Write-Host "  Inserted Art Director instructions (+$($artDirectorInstructions.Count) lines)" -ForegroundColor Green
}


Write-Host "`n=== Change 3: Parse artDirection from response ===" -ForegroundColor Cyan

# Find the parsing section "if (response && typeof response === 'object') {"
# After the prompt changes, line numbers shifted. Search for the exact pattern.
$parseIdx = -1
for ($i = 1600; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "if \(response && typeof response === 'object'\)") {
        $parseIdx = $i
        break
    }
}

if ($parseIdx -ge 0) {
    Write-Host "  Found parsing block at line $($parseIdx + 1)" -ForegroundColor Gray
    
    # Insert "let artDirection = null;" before the if block (2 lines before: "    let parsed = null;")
    $parsedDeclIdx = $parseIdx - 2
    if ($lines[$parsedDeclIdx] -match 'let parsed = null') {
        $linesList = [System.Collections.ArrayList]::new($lines)
        $linesList.Insert($parsedDeclIdx + 1, '    let artDirection = null;')
        $lines = $linesList.ToArray()
        $parseIdx++ # shift due to insertion
        Write-Host "  Inserted: let artDirection = null;" -ForegroundColor Green
    }
    
    # Find the line "parsed = response.curated || response;" and add artDirection extraction after it
    for ($i = $parseIdx; $i -lt $parseIdx + 5; $i++) {
        if ($lines[$i] -match 'parsed = response\.curated \|\| response') {
            $linesList = [System.Collections.ArrayList]::new($lines)
            $insertLines = @(
                '      artDirection = response?.artDirection || null;',
                '      if (artDirection) {',
                '        console.log(`[ArtDirector] \u2605 Hero: #${artDirection.heroIndex}, Circle: #${artDirection.circleIndex}, Highlight: #${artDirection.highlightIndex}`);',
                '        console.log(`[ArtDirector]   Hero reason: ${artDirection.heroReason}`);',
                '        console.log(`[ArtDirector]   Circle reason: ${artDirection.circleReason}`);',
                '        if (artDirection.rejectIndices?.length > 0) {',
                '          console.log(`[ArtDirector]   Reject indices: ${artDirection.rejectIndices.join('', '')}`);',
                '        }',
                '      }'
            )
            for ($j = $insertLines.Count - 1; $j -ge 0; $j--) {
                $linesList.Insert($i + 1, $insertLines[$j])
            }
            $lines = $linesList.ToArray()
            Write-Host "  Inserted artDirection extraction (+$($insertLines.Count) lines)" -ForegroundColor Green
            break
        }
    }
}

# Change return to include artDirection
$returnIdx = -1
for ($i = 1650; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s+return curatedWithRejects;') {
        $returnIdx = $i
        break
    }
}

if ($returnIdx -ge 0) {
    $lines[$returnIdx] = '    return { curated: curatedWithRejects, artDirection: artDirection || null };'
    Write-Host "  Line $($returnIdx + 1): return changed to {curated, artDirection}" -ForegroundColor Green
}


Write-Host "`n=== Change 4: Update caller to handle new format ===" -ForegroundColor Cyan

# Find "const curatedOrder = await curateImagesForCover(" around line 941
$callerIdx = -1
for ($i = 935; $i -lt 960; $i++) {
    if ($lines[$i] -match 'const curatedOrder = await curateImagesForCover') {
        $callerIdx = $i
        break
    }
}

if ($callerIdx -ge 0) {
    Write-Host "  Found caller at line $($callerIdx + 1)" -ForegroundColor Gray
    # Change "const curatedOrder" to "const curatorResult"
    $lines[$callerIdx] = $lines[$callerIdx] -replace 'const curatedOrder', 'const curatorResult'
    Write-Host "  Renamed curatedOrder -> curatorResult" -ForegroundColor Green
    
    # Find the closing ");" of the function call
    $closingCallIdx = -1
    for ($i = $callerIdx; $i -lt $callerIdx + 10; $i++) {
        if ($lines[$i] -match '^\s+\);$') {
            $closingCallIdx = $i
            break
        }
    }
    
    if ($closingCallIdx -ge 0) {
        # Insert new extraction lines after ");", before "if (curatedOrder..."
        $nextLineIdx = $closingCallIdx + 1
        # Find the empty line after );
        if ($lines[$nextLineIdx].Trim() -eq '') {
            $nextLineIdx++
        }
        
        # Now find "if (curatedOrder && curatedOrder.length > 0) {"
        $ifIdx = -1
        for ($i = $closingCallIdx; $i -lt $closingCallIdx + 5; $i++) {
            if ($lines[$i] -match 'if \(curatedOrder') {
                $ifIdx = $i
                break
            }
        }
        
        if ($ifIdx -ge 0) {
            $insertExtract = @(
                '      ',
                '      // \u2605 Handle new format: { curated, artDirection } or legacy array',
                '      const curatedOrder = curatorResult?.curated || (Array.isArray(curatorResult) ? curatorResult : null);',
                '      let artDirection = curatorResult?.artDirection || null;',
                '      ',
                '      if (artDirection) {',
                '        console.log(`[AutoCover] \u2605 AI Art Director decisions received \u2014 will override rule-based slot assignment`);',
                '      }',
                '      '
            )
            $linesList = [System.Collections.ArrayList]::new($lines)
            for ($j = $insertExtract.Count - 1; $j -ge 0; $j--) {
                $linesList.Insert($ifIdx, $insertExtract[$j])
            }
            $lines = $linesList.ToArray()
            Write-Host "  Inserted curatorResult extraction (+$($insertExtract.Count) lines)" -ForegroundColor Green
        }
    }
}


# Pass artDirection to assignImagesToSlots
$assignCallIdx = -1
for ($i = 1000; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'const slotAssignment = await assignImagesToSlots\(') {
        $assignCallIdx = $i
        break
    }
}

if ($assignCallIdx -ge 0) {
    Write-Host "  Found assignImagesToSlots call at line $($assignCallIdx + 1)" -ForegroundColor Gray
    # The next line has the parameters "imageBuffers, faceDataMap, chosenTemplate, identity, coverReferences"
    $paramLineIdx = $assignCallIdx + 1
    if ($lines[$paramLineIdx] -match 'coverReferences') {
        $lines[$paramLineIdx] = $lines[$paramLineIdx] -replace 'coverReferences\s*\)', 'coverReferences, artDirection)'
        # Handle case where artDirection variable might not be in scope
        # We need to check if artDirection was declared in the try block — it was (Change 4)
        Write-Host "  Added artDirection parameter to assignImagesToSlots call" -ForegroundColor Green
    }
}


Write-Host "`n=== Change 5: Update assignImagesToSlots signature + Art Director override ===" -ForegroundColor Cyan

# Update function signature
$sigIdx = -1
for ($i = 1700; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'async function assignImagesToSlots\(imageBuffers.*coverReferences\)') {
        $sigIdx = $i
        break
    }
}

if ($sigIdx -ge 0) {
    $lines[$sigIdx] = $lines[$sigIdx] -replace 'coverReferences\)', 'coverReferences, artDirection = null)'
    Write-Host "  Line $($sigIdx + 1): Added artDirection parameter to function signature" -ForegroundColor Green
}

# Add Art Director override block after "let photoOrder = [];"
$photoOrderIdx = -1
for ($i = $sigIdx; $i -lt $sigIdx + 200; $i++) {
    if ($lines[$i] -match '^\s+let photoOrder = \[\];$') {
        $photoOrderIdx = $i
        break
    }
}

if ($photoOrderIdx -ge 0) {
    Write-Host "  Found 'let photoOrder = [];' at line $($photoOrderIdx + 1)" -ForegroundColor Gray
    
    $artDirectorBlock = @(
        '',
        '    // \u2605\u2605\u2605 AI Art Director Override: \u0E16\u0E49\u0E32\u0E21\u0E35 artDirection \u0E08\u0E32\u0E01 GPT-5.5 \u2192 \u0E43\u0E0A\u0E49 AI \u0E15\u0E31\u0E14\u0E2A\u0E34\u0E19\u0E43\u0E08\u0E41\u0E17\u0E19 rule-based logic',
        '    if (artDirection && artDirection.heroIndex !== undefined && artDirection.heroIndex !== null) {',
        '      console.log(`[assignSlots] \u2605\u2605\u2605 Using AI Art Director decisions (GPT-5.5) instead of rule-based logic`);',
        '      ',
        '      // Validate indices are within bounds',
        '      const maxIdx = imageBuffers.length - 1;',
        '      const validIdx = (idx) => typeof idx === ''number'' && idx >= 0 && idx <= maxIdx && !isNegativeImage(idx);',
        '      ',
        '      // Hero',
        '      if (validIdx(artDirection.heroIndex)) {',
        '        heroIndex = artDirection.heroIndex;',
        '        console.log(`[assignSlots] \u2605 Art Director Hero: #${heroIndex} \u2014 ${artDirection.heroReason || ''AI selected''}`);',
        '      }',
        '      ',
        '      // Circle',
        '      if (hasCircle && validIdx(artDirection.circleIndex)) {',
        '        circleIndex = artDirection.circleIndex;',
        '        console.log(`[assignSlots] \u2605 Art Director Circle: #${circleIndex} \u2014 ${artDirection.circleReason || ''AI selected''}`);',
        '      }',
        '      ',
        '      // Build photoOrder from artDirection',
        '      const usedByAD = new Set([heroIndex]);',
        '      if (circleIndex !== undefined) usedByAD.add(circleIndex);',
        '      ',
        '      // Slot 0 = hero',
        '      photoOrder = [heroIndex];',
        '      ',
        '      // Highlight slot',
        '      if (validIdx(artDirection.highlightIndex) && !usedByAD.has(artDirection.highlightIndex)) {',
        '        photoOrder.push(artDirection.highlightIndex);',
        '        usedByAD.add(artDirection.highlightIndex);',
        '        console.log(`[assignSlots] \u2605 Art Director Highlight: #${artDirection.highlightIndex}`);',
        '      }',
        '      ',
        '      // Secondary person',
        '      if (validIdx(artDirection.secondaryPersonIndex) && !usedByAD.has(artDirection.secondaryPersonIndex)) {',
        '        photoOrder.push(artDirection.secondaryPersonIndex);',
        '        usedByAD.add(artDirection.secondaryPersonIndex);',
        '        console.log(`[assignSlots] \u2605 Art Director Secondary Person: #${artDirection.secondaryPersonIndex}`);',
        '      }',
        '      ',
        '      // Background indices',
        '      if (Array.isArray(artDirection.bgIndices)) {',
        '        for (const bgIdx of artDirection.bgIndices) {',
        '          if (validIdx(bgIdx) && !usedByAD.has(bgIdx)) {',
        '            photoOrder.push(bgIdx);',
        '            usedByAD.add(bgIdx);',
        '          }',
        '        }',
        '      }',
        '      ',
        '      // Fill remaining slots from high-scoring images',
        '      const remainingForAD = imageBuffers',
        '        .map((img, i) => ({ index: i, score: img.curatorScore || 0 }))',
        '        .filter(x => !usedByAD.has(x.index) && !isNegativeImage(x.index) && x.score >= 4)',
        '        .sort((a, b) => b.score - a.score);',
        '      ',
        '      while (photoOrder.length < slotCount && remainingForAD.length > 0) {',
        '        const next = remainingForAD.shift();',
        '        photoOrder.push(next.index);',
        '        usedByAD.add(next.index);',
        '      }',
        '      ',
        '      // Apply reject indices',
        '      if (Array.isArray(artDirection.rejectIndices)) {',
        '        for (const rejIdx of artDirection.rejectIndices) {',
        '          if (typeof rejIdx === ''number'' && rejIdx >= 0 && rejIdx <= maxIdx) {',
        '            imageBuffers[rejIdx].role = ''REJECT'';',
        '            imageBuffers[rejIdx].curatorScore = 0;',
        '          }',
        '        }',
        '      }',
        '      ',
        '      console.log(`[assignSlots] \u2605 Art Director final: Hero=#${heroIndex}, Circle=#${circleIndex}, PhotoOrder=${JSON.stringify(photoOrder)}`);',
        '      ',
        '      return {',
        '        photoOrder,',
        '        circleIndex: circleIndex !== undefined ? circleIndex : 0,',
        '        circleSmallIndex: undefined,',
        '        heroIndex,',
        '      };',
        '    }',
        '    ',
        '    // \u2605 Fallback: \u0E44\u0E21\u0E48\u0E21\u0E35 artDirection \u2192 \u0E43\u0E0A\u0E49 rule-based logic \u0E1B\u0E01\u0E15\u0E34'
    )
    
    # Find "if (hasRoles) {" after photoOrder
    $hasRolesIdx = -1
    for ($i = $photoOrderIdx + 1; $i -lt $photoOrderIdx + 5; $i++) {
        if ($lines[$i] -match '^\s+if \(hasRoles\)') {
            $hasRolesIdx = $i
            break
        }
    }
    
    if ($hasRolesIdx -ge 0) {
        $linesList = [System.Collections.ArrayList]::new($lines)
        for ($j = $artDirectorBlock.Count - 1; $j -ge 0; $j--) {
            $linesList.Insert($hasRolesIdx, $artDirectorBlock[$j])
        }
        $lines = $linesList.ToArray()
        Write-Host "  Inserted Art Director override block (+$($artDirectorBlock.Count) lines)" -ForegroundColor Green
    }
}


# === SAVE ===
$totalAfter = $lines.Count
Write-Host "`n--- Summary ---" -ForegroundColor Yellow
Write-Host "  Lines before: $totalBefore" -ForegroundColor Gray
Write-Host "  Lines after:  $totalAfter" -ForegroundColor Gray
Write-Host "  Lines added:  $($totalAfter - $totalBefore)" -ForegroundColor Gray

[System.IO.File]::WriteAllLines($file, $lines, [System.Text.Encoding]::UTF8)
Write-Host "`n\u2705 All changes saved to route.js!" -ForegroundColor Green
Write-Host "   Backup at: route.js.bak" -ForegroundColor Gray
