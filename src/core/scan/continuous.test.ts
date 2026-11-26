import { describe, it, expect } from 'vitest';
import { serialFeed } from './continuous';
import type { ScanResult } from './scanner';

const label = (code: string): ScanResult => ({ kind: 'label', code });

describe('continuous scan feed', () => {
  it('handles scans one at a time, in order, even when the handler is slow', async () => {
    const log: string[] = [];
    let busy = false;
    const feed = serialFeed(async (r) => {
      expect(busy).toBe(false);
      busy = true;
      await new Promise((res) => setTimeout(res, 5));
      log.push((r as { code: string }).code);
      busy = false;
    });
    await Promise.all([feed(label('A'), 0), feed(label('B'), 10), feed(label('C'), 20)]);
    expect(log).toEqual(['A', 'B', 'C']);
  });

  it('ignores the same code held in view, but takes it again after 1.5 s', async () => {
    const log: string[] = [];
    const feed = serialFeed((r) => { log.push((r as { code: string }).code); });
    await feed(label('A'), 0);
    await feed(label('A'), 400);
    await feed(label('B'), 500);
    await feed(label('A'), 1300); // still within 1.5 s of the first A
    await feed(label('A'), 1600);
    expect(log).toEqual(['A', 'B', 'A']);
  });

  it('keeps going after a handler error', async () => {
    const log: string[] = [];
    const feed = serialFeed((r) => { const c = (r as { code: string }).code; if (c === 'X') throw new Error('boom'); log.push(c); });
    await feed(label('X'), 0);
    await feed(label('Y'), 10);
    expect(log).toEqual(['Y']);
  });
});
