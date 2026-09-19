import { describe, expect, it } from 'vitest';
import type { Phase0CandidateClassification } from '../tools/camera-barcode-phase0/domain';
import {
  isInstalledPwaDisplayMode,
  manualFallbackOutcomeStatus,
} from '../tools/camera-barcode-phase0/runtime';

describe('Phase 0 runtime helpers', () => {
  it('detects installed PWA display mode in Chromium and iOS Safari', () => {
    expect(
      isInstalledPwaDisplayMode({
        matchMedia: () => ({ matches: true }),
        navigator: {},
      }),
    ).toBe(true);

    expect(
      isInstalledPwaDisplayMode({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
      }),
    ).toBe(true);

    expect(
      isInstalledPwaDisplayMode({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
      }),
    ).toBe(false);
  });

  it('reports manual fallback outcome accurately for match and wrong decode', () => {
    const match: Phase0CandidateClassification = {
      result: 'DECODED_MATCH',
      payloadMatchesExpected: true,
      observedSymbology: 'EAN_13',
      observedLength: 13,
      checksumResult: 'VALID',
    };
    const wrong: Phase0CandidateClassification = {
      result: 'DECODED_WRONG',
      payloadMatchesExpected: false,
      observedSymbology: 'EAN_13',
      observedLength: 13,
      checksumResult: 'INVALID',
    };

    expect(manualFallbackOutcomeStatus(match)).toEqual({
      message: 'Fallback registrado sin conservar el valor introducido.',
      tone: 'success',
    });
    expect(manualFallbackOutcomeStatus(wrong)).toEqual({
      message: 'Fallback registrado como lectura incorrecta. La celda queda NO_GO.',
      tone: 'error',
    });
  });
});
