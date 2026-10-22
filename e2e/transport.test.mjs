import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerFrames } from './transport-frames.mjs';
const frame = (stream, text) => {
  const body = Buffer.from(text), header = Buffer.alloc(8);
  header[0] = stream; header.writeUInt32BE(body.length, 4); return Buffer.concat([header, body]);
};
test('fragmented Docker frames preserve real TCP bytes and omit stderr', () => {
  const output = [], parse = dockerFrames(chunk => output.push(chunk));
  const input = Buffer.concat([frame(1, 'startup'), frame(2, 'diagnostic'), frame(1, '\0response')]);
  for (const byte of input) parse(Buffer.from([byte]));
  assert.equal(Buffer.concat(output).toString(), 'startup\0response');
});
test('malformed or excessive Docker frames fail closed', () => {
  assert.throws(() => dockerFrames(() => {})(frame(3, 'bad')), /Invalid Docker frame/);
  const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(17000000, 4);
  assert.throws(() => dockerFrames(() => {})(header), /Invalid Docker frame/);
});
