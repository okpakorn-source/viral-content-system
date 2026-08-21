'use strict';

function makeQueueTerminalError(status = {}) {
  const error = new Error(status.error || 'Queue job failed');
  error.code = 'QUEUE_JOB_FAILED';
  error.errorType = status.errorType || null;
  error.failedStep = status.failedStep || null;
  return error;
}

function isQueueTerminalError(error) {
  return error?.code === 'QUEUE_JOB_FAILED';
}

function selectQualityWarnings(warnings, limit = 2) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((warning, index) => ({ warning: String(warning || '').trim(), index }))
    .filter(item => item.warning)
    .sort((a, b) => {
      const aNeedsReview = /ให้พนักงานตรวจบริบทก่อนโพสต์/u.test(a.warning) ? 0 : 1;
      const bNeedsReview = /ให้พนักงานตรวจบริบทก่อนโพสต์/u.test(b.warning) ? 0 : 1;
      return aNeedsReview - bNeedsReview || a.index - b.index;
    })
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(item => item.warning);
}

module.exports = { makeQueueTerminalError, isQueueTerminalError, selectQualityWarnings };
