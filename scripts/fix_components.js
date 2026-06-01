const fs = require('fs');
const path = require('path');

const backupPath = path.join(__dirname, '../src_backup_อัพเดทกันพัง/app/content/new/page.js');
const backupContent = fs.readFileSync(backupPath, 'utf8');
const lines = backupContent.split('\n');

const inputLines = lines.slice(991, 1430); // 992 to 1430 is 991 to 1430 in 0-indexed
const extractedLines = lines.slice(1433, 1919); // 1434 to 1919

const inputComponent = `'use client';
import React from 'react';
import UniversalInputBox from '@/components/UniversalInputBox';

export default function InputSection({ states, setters, handlers, utils }) {
  const { autoMode, liveDetection, contentLength, newsImagePreviews, autoProgress, composingImage, universalDetection, autoLog, composedImages, imageLayout, sourceType, url, tiktokNeedUpload, youtubeNeedUpload, videoFile, imagePreview, imageFile, extracting, extracted, rawText, customPrompt, loading } = states;
  const { setLiveDetection, setContentLength, setNewsImages, setNewsImagePreviews, setSourceType, setExtracted, setRawText, setError, setImageFile, setImagePreview, setTiktokNeedUpload, setVideoFile, setYoutubeNeedUpload, setUrl, setCustomPrompt } = setters;
  const { handleUniversalSubmit, handleTikTokTranscribe, handleAutoMode, handleYouTubeTranscribe, handleExtract, handleImagePaste, handleImageDrop, handleImageOCR, handleExtractNews } = handlers;
  const { resizeImage, SOURCE_TYPES, placeholders } = utils;

  const needsUrl = ['url', 'facebook', 'tiktok', 'youtube'].includes(sourceType);

  return (
    <>
      ${inputLines.join('\n      ')}
    </>
  );
}`;

const extractedComponent = `'use client';
import React from 'react';

export default function ExtractedView({ states, setters, handlers, utils }) {
  const { newsData, copied, breakdownPromptText, loading, blueprinting, blueprintData, editedBlueprint, researchData, researching, selectedResearch, addedResearchItems, breakdownData, customPrompt, sourceType, contentLength, workflowId } = states;
  const { copyText, setBreakdownPromptText, handleBreakdown, handleBlueprint, setEditedBlueprint, handleResearch, toggleResearchItem, setSelectedResearch, handleAddResearch, handleMixAngles, handleAnalyze, setContentLength } = handlers;

  return (
    <>
      ${extractedLines.join('\n      ')}
    </>
  );
}`;

fs.writeFileSync(path.join(__dirname, '../src/components/content/InputSection.js'), inputComponent);
fs.writeFileSync(path.join(__dirname, '../src/components/content/ExtractedView.js'), extractedComponent);

console.log("Fixed InputSection and ExtractedView");
