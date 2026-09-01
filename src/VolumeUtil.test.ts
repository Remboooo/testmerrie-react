import { describe, it, expect } from 'vitest';
import { volumeToGain } from './VolumeUtil';

describe('volumeToGain', () => {
  it('maps 0 to true silence and 100 to unity gain', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(100);
  });

  it('clamps out-of-range input', () => {
    expect(volumeToGain(-10)).toBe(0);
    expect(volumeToGain(150)).toBe(100);
  });

  it('tapers midpoints below their linear value, per a dB curve', () => {
    const half = volumeToGain(50);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(50);
    expect(half).toBeCloseTo(100 * Math.pow(10, -25 / 20), 6);
  });

  it('is monotonically increasing', () => {
    const samples = [0, 1, 10, 25, 50, 75, 90, 99, 100].map(volumeToGain);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });
});
