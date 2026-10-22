// Synthetic browser/reader regression, NOT an application or database E2E.
import { test, expect } from '@playwright/test';
import { resultFromFlight, observeServerActions, readServerAction } from './flight.mjs';

test('reads a UTF-8 Server Action response with a long Flight session without replay', async ({ page }) => {
  const reply = 'Për këtë informacion, ju lutem kontaktoni ekipin. 🤖';
  const session = 'synthetic-ë-'.repeat(2000);
  const wire = `0:{"a":"$@1"}\n2:T${Buffer.byteLength(session).toString(16)},${session}1:${JSON.stringify({ session: '$2', reply })}\n`;
  let requests = 0;
  await observeServerActions(page);
  await page.route('**/__e2e_flight_reader', async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: 'text/x-component', body: Buffer.from(wire) });
  });
  await page.goto('/login');
  let browserText;
  const response = await readServerAction(page, async () => {
    browserText = await page.evaluate(async () => (await fetch('/__e2e_flight_reader', {
      method: 'POST', headers: { 'next-action': 'synthetic-reader-only' }, body: '[]',
    })).text());
  });
  expect(resultFromFlight(browserText)).toEqual({ session, reply });
  expect(response.result).toEqual({ session, reply });
  expect(requests).toBe(1);
});
