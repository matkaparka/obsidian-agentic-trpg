import { describe, expect, it } from 'vitest';
import { fitContentSize, normalizeOverlayUrl } from '../src/atlas/playerFrame';

describe('player frame URL whitelist', () => {
  it('accepts loopback overlay URLs and canonicalises them', () => {
    expect(normalizeOverlayUrl('http://127.0.0.1:8099/overlay?bg=transparent')).toBe(
      'http://127.0.0.1:8099/overlay?bg=transparent'
    );
    expect(normalizeOverlayUrl('  http://127.0.0.1:8099/overlay#x  ')).toBe('http://127.0.0.1:8099/overlay');
    expect(normalizeOverlayUrl('http://127.0.0.1:1/')).toBe('http://127.0.0.1:1/');
  });

  it('refuses anything that is not loopback http', () => {
    for (const bad of [
      'https://127.0.0.1:8099/overlay',
      'http://localhost:8099/overlay',
      'http://example.com/overlay',
      'http://127.0.0.1.evil.com:8099/overlay',
      'http://192.168.1.5:8099/overlay',
      'javascript:alert(1)',
      'file:///C:/Windows/notepad.exe',
      'http://user:pass@127.0.0.1:8099/overlay',
      'http://127.0.0.1:99999/overlay',
      '',
    ]) {
      expect(() => normalizeOverlayUrl(bad), bad).toThrow();
    }
  });
});

describe('player frame size', () => {
  it('keeps 1920x1080 when the screen is big enough', () => {
    expect(fitContentSize({ w: 1920, h: 1080 }, { width: 2560, height: 1440 }, true)).toEqual({ w: 1920, h: 1080, scale: 1 });
  });

  it('shrinks both axes by the same factor on a small screen (no panel-only distortion)', () => {
    const fit = fitContentSize({ w: 1920, h: 1080 }, { width: 1707, height: 1019 }, true);
    expect(fit.w).toBe(1707);
    expect(fit.h).toBe(960);
    expect(fit.scale).toBeCloseTo(1707 / 1920, 6);
    expect(fit.w / fit.h).toBeCloseTo(16 / 9, 3);
  });

  it('screenFit=false forces the design size', () => {
    expect(fitContentSize({ w: 1920, h: 1080 }, { width: 1707, height: 1019 }, false)).toEqual({ w: 1920, h: 1080, scale: 1 });
  });
});
