import { normalizeIntentText } from '../engine/intents.js';

function isResumeCommand(value) {
  const text = normalizeIntentText(value);
  return text === 'voltar bot' || text === 'menu' || text === '0';
}

function shouldPauseEngine({ mode, botPaused, hasActiveHandoff, text }) {
  const resumeRequested = isResumeCommand(text);
  const currentMode = String(mode || 'hybrid').toLowerCase();
  const paused = Boolean(botPaused || hasActiveHandoff);
  if (!paused) {
    return {
      paused: false,
      blockEngine: false,
      resumeRequested,
      canResume: false,
      reason: 'NOT_PAUSED',
    };
  }
  const canResume = resumeRequested && currentMode === 'hybrid';
  if (canResume) {
    return {
      paused: false,
      blockEngine: false,
      resumeRequested: true,
      canResume: true,
      reason: 'RESUME_ALLOWED',
    };
  }
  return {
    paused: true,
    blockEngine: true,
    resumeRequested,
    canResume: false,
    reason: 'HANDOFF_OPEN',
  };
}

export { isResumeCommand, shouldPauseEngine };
