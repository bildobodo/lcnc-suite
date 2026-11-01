import { expect, type Page } from '@playwright/test';

/** Puts the page in touch mode the app's own way — its first touch
 *  (touchDetect.ts): the touch input at once, the touch SIZES (the
 *  `touch-device` class and the state the code panel computes its rows
 *  from) once that press has ended (an untrusted press holds nothing). A
 *  class set by hand gave the sizes without that state: the code view laid
 *  23 px rows out under 32 px ones (2026-11-01). */
export async function enterTouch(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.dispatchEvent(
    new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true })));
  await expect(page.locator('html.touch-device')).toHaveCount(1);
}
