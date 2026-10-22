import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultFromFlight } from './flight.mjs';

test('decodes actual Flight framing, UTF-8 lengths and text followed directly by JSON', () => {
  const text = 'synthetic-token-ë\nsecond line';
  const wire = `:N123\n0:{"a":"$@1","f":"","b":"development"}\n2:T${Buffer.byteLength(text).toString(16)},${text}1:{"session":"$2","turn":{"reply":"Madhësia?"},"error":"$undefined"}\n`;
  assert.deepEqual(resultFromFlight(wire), { session: text, turn: { reply: 'Madhësia?' }, error: undefined });
});
test('decodes action errors but rejects missing, truncated or cyclic evidence', () => {
  assert.deepEqual(resultFromFlight('0:{"a":"$@1"}\n1:{"error":"Stale preview"}\n'), { error: 'Stale preview' });
  for (const wire of ['0:{}\n', '2:Tff,short', '0:{"a":"$@1"}\n1:{"session":"$1"}\n',
    '0:{"a":"$@1"}\n1:{"session":"token","reply":"$1:missing"}\n',
    '0:{"a":"$@1"}\n1:{"session":"token","reply":"$1:reply"}\n'])
    assert.throws(() => resultFromFlight(wire));
});

test('preserves escaped dollar strings rather than interpreting them as references', () => {
  assert.deepEqual(resultFromFlight('0:{"a":"$@1"}\n1:{"session":"token","reply":"$$a","note":"$$undefined"}\n'),
    { session: 'token', reply: '$a', note: '$undefined' });
});

test('text frames contain literal strings, not model references or escapes', () => {
  for (const text of ['$a', '$$a', '$undefined']) {
    const wire = `0:{"a":"$@1"}\n2:T${Buffer.byteLength(text).toString(16)},${text}1:{"session":"token","reply":"$2"}\n`;
    assert.equal(resultFromFlight(wire).reply, text);
  }
});

test('resolves shared object paths within an action result without treating them as cycles', () => {
  const wire = '0:{"a":"$@1"}\n1:{"session":"token","nextState":{"processes":{"lastDecision":{"reason":"clarification_stale"}}},"conversationRouting":"$1:nextState:processes:lastDecision"}\n';
  assert.equal(resultFromFlight(wire).conversationRouting.reason, 'clarification_stale');
});
