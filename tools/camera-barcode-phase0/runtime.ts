import type { Phase0CandidateClassification } from './domain';

export type RuntimeStatusTone = 'neutral' | 'success' | 'warning' | 'error';

export interface ManualFallbackOutcomeStatus {
  message: string;
  tone: RuntimeStatusTone;
}

interface NavigatorStandaloneLike {
  standalone?: unknown;
}

interface DisplayModeDetector {
  matchMedia?(query: string): { matches: boolean };
  navigator?: Navigator | NavigatorStandaloneLike;
}

export function isInstalledPwaDisplayMode(
  runtime: DisplayModeDetector = globalThis,
): boolean {
  const displayModeMatches =
    runtime.matchMedia?.('(display-mode: standalone)').matches === true;
  const navigatorCandidate = runtime.navigator;
  const iosStandalone =
    navigatorCandidate !== undefined &&
    'standalone' in navigatorCandidate &&
    navigatorCandidate.standalone === true;
  return displayModeMatches || iosStandalone;
}

export function manualFallbackOutcomeStatus(
  classification: Phase0CandidateClassification,
): ManualFallbackOutcomeStatus {
  if (classification.result === 'DECODED_MATCH') {
    return {
      message: 'Fallback registrado sin conservar el valor introducido.',
      tone: 'success',
    };
  }

  return {
    message: 'Fallback registrado como lectura incorrecta. La celda queda NO_GO.',
    tone: 'error',
  };
}
