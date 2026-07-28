import { describe, it, expect } from 'vitest';
import { formatBitrate } from './FormatUtil';

describe('formatBitrate', () => {
  it('formats bits per second with no prefix', () => {
    expect(formatBitrate(500)).toBe('500.0bps');
  });

  it('scales into kbps and Mbps', () => {
    expect(formatBitrate(8000)).toBe('8.0kbps');
    expect(formatBitrate(8_000_000)).toBe('8.0Mbps');
  });
});
