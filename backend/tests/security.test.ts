import { describe, expect, it } from 'vitest';
import { hashDeviceToken, safeTokenEqual } from '../src/security.js';

describe('device credentials', () => {
  it('stores a keyed digest and validates without plain-text storage', () => {
    const token = 'unique-device-token-with-enough-entropy';
    const hash = hashDeviceToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(safeTokenEqual(hash, token)).toBe(true);
    expect(safeTokenEqual(hash, `${token}-wrong`)).toBe(false);
  });
});

