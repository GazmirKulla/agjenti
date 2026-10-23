// Component/browser evidence only. No authenticated app, DB or model is simulated as real E2E.
// Generate with C1_UI_ARTIFACT_DIR=/private/tmp/agjenti-c1-... vitest run src/components/agents/test-configuration.test.ts
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
const directory = process.env.C1_UI_ARTIFACT_DIR;
test.skip(!directory, 'Generate isolated component fixtures first; this is not authenticated E2E.');
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => route.abort('blockedbyclient'));
});
for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) {
  test(`C1 component warning, keyboard details, overflow ${width} ${colorScheme}`, async ({ page }) => {
    if (!directory?.startsWith('/private/tmp/agjenti-c1-')) throw Error('Disposable fixture path required');
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme });
    await page.setContent(readFileSync(`${directory}/inactive.html`, 'utf8'));
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('udhëzimet bazë');
    const summary = page.getByText('Konfigurimi i përdorur në këtë provë', { exact: true });
    await expect(page.locator('details')).not.toHaveAttribute('open', '');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('details')).toHaveAttribute('open', '');
    await expect(page.getByText('Version i fiksuar në këtë bisedë', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${directory}/configuration-${width}-${colorScheme}.png`, fullPage: true });
    await page.setContent(readFileSync(`${directory}/active.html`, 'utf8'));
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.locator('summary').click();
    await expect(page.getByText('Other synthetic agent')).toBeVisible();
    await page.setContent(readFileSync(`${directory}/failure.html`, 'utf8'));
    await page.locator('summary').click();
    await expect(page.getByText('Përgjigje rezervë / workflow — jo verifikim sjelljeje')).toBeVisible();
  });
}
