import { describe, it, expect } from 'vitest';
import { parseLabelUrl, labelUrl, newLabelCode } from './labels';

describe('label links (API_CONTRACTS §5, SECURITY_MODEL malicious QR)', () => {
  it('accepts boxtap.app/b/<code> and round-trips', () => {
    const c = newLabelCode();
    expect(parseLabelUrl(labelUrl(c))).toBe(c);
  });
  it('normalises lower case and Crockford look-alikes', () => {
    expect(parseLabelUrl('https://boxtap.app/b/k7q2m9xr4o')).toBe('K7Q2M9XR40');
    expect(parseLabelUrl('https://boxtap.app/b/K7Q2M9XRIL')).toBe('K7Q2M9XR11');
  });
  it.each([
    'http://boxtap.app/b/K7Q2M9XR4T',
    'https://evil.example/b/K7Q2M9XR4T',
    'https://boxtap.app.evil.example/b/K7Q2M9XR4T',
    'https://boxtap.app/b/K7Q2M9XR4',
    'https://boxtap.app/b/K7Q2M9XR4TU',
    'https://boxtap.app/b/K7Q2M9XR4T?x=1',
    'https://boxtap.app/b/K7Q2M9XR4U',
    'https://boxtap.app:8443/b/K7Q2M9XR4T',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => {
    expect(parseLabelUrl(u)).toBeNull();
  });
});
