import { test } from '@playwright/test';

/**
 * Playwright's WebKit build for Windows cannot create OPFS sync access handles ("UnknownError"), so BoxTap
 * falls back to memory there and shows its "can't store data" banner. Tests that need data to survive a
 * reload cannot run in that build. Real Safari (iOS 17+, macOS) must be checked on devices: Phase 0 spike R6.
 * This is reported as "not run", never as passed.
 */
export function needsPersistentStorage(browserName: string): void {
  test.skip(browserName === 'webkit' && process.platform === 'win32',
    'Windows WebKit build has no OPFS sync handles; verify on a real iPhone / Mac (spike R6)');
}
