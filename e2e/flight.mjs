// Decode only the JSON/text subset emitted by our actual Next server actions.
// Large strings use byte-length-framed T rows, not newline-delimited JSON.
export function resultFromFlight(text) {
  const bytes = Buffer.from(text), rows = new Map(), textRows = new Set();
  let offset = 0;
  while (offset < bytes.length) {
    const colon = bytes.indexOf(58, offset);
    if (colon < 0) break;
    const id = bytes.subarray(offset, colon).toString();
    offset = colon + 1;
    if (/^[0-9a-f]+$/.test(id) && bytes[offset] === 84) {
      const comma = bytes.indexOf(44, offset), length = bytes.subarray(offset + 1, comma).toString();
      if (comma < 0 || !/^[0-9a-f]+$/.test(length)) throw new Error('Invalid Flight text frame');
      const end = comma + 1 + Number.parseInt(length, 16);
      if (end > bytes.length) throw new Error('Truncated Flight text frame');
      rows.set(id, bytes.subarray(comma + 1, end).toString()); textRows.add(id); offset = end;
    } else {
      const newline = bytes.indexOf(10, offset), end = newline < 0 ? bytes.length : newline;
      try { rows.set(id, JSON.parse(bytes.subarray(offset, end).toString())); } catch { /* Timing/debug rows, not action data. */ }
      offset = end + 1;
    }
  }
  function resolve(value, seen = new Set()) {
    if (typeof value === 'string' && value.startsWith('$$')) return value.slice(1);
    if (value === '$undefined') return undefined;
    if (typeof value === 'string' && /^\$@?[0-9a-f]+(?::[^:]+)*$/.test(value)) {
      const reference = value.replace(/^\$@?/, ''), [id, ...path] = reference.split(':');
      if (!rows.has(id) || seen.has(reference)) throw new Error('Invalid Flight reference');
      const next = new Set([...seen, reference]);
      let target = rows.get(id);
      if (textRows.has(id) && !path.length) return target;
      for (const key of path) {
        if (typeof target === 'string') target = resolve(target, next);
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error('Invalid Flight reference path');
        target = target[key];
      }
      return resolve(target, next);
    }
    if (Array.isArray(value)) return value.map(item => resolve(item, seen));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, seen)]));
    return value;
  }
  const result = resolve(rows.get('0')?.a);
  if (!result || typeof result !== 'object' || (!result.session && !result.error)) throw new Error('No action result in actual HTTP response');
  return result;
}

// Observe the actual browser fetch once; never reissue a Server Action. CDP's
// getResponseBody can misdecode text/x-component or lose its streamed body.
// A clone preserves the bytes consumed by React without altering its response.
export async function observeServerActions(page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.__e2eActions = [];
    window.fetch = function(input, init) {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const pending = original.apply(this, arguments);
      if (url.origin === location.origin && method.toUpperCase() === 'POST' && headers.has('next-action')) {
        const request = { url: url.href, headers: Object.fromEntries(headers), body: init?.body };
        window.__e2eActions.push(pending.then(async response => ({
          request, status: response.status, contentType: response.headers.get('content-type'),
          text: new TextDecoder('utf-8', { fatal: true }).decode(await response.clone().arrayBuffer()),
        })).catch(error => ({ error: String(error) })));
      }
      return pending;
    };
  });
}

export async function readServerAction(page, trigger) {
  const index = await page.evaluate(() => window.__e2eActions?.length);
  if (index === undefined) throw new Error('Install the Server Action observer before navigation');
  await trigger();
  await page.waitForFunction(index => window.__e2eActions.length > index, index);
  const response = await page.evaluate(index => window.__e2eActions[index], index);
  if (response.error) throw new Error(response.error);
  if (response.status < 200 || response.status >= 300 || !response.contentType?.startsWith('text/x-component'))
    throw new Error(`Unexpected Server Action response: ${response.status} ${response.contentType}`);
  return { result: resultFromFlight(response.text), request: response.request };
}
