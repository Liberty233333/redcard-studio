import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSecrets } from './secretRedactor.ts';

test('redacts Anthropic keys', () => {
  const input = 'key sk-ant-' + 'a'.repeat(44);
  assert.equal(redactSecrets(input), 'key [REDACTED:anthropic-key]');
});

test('redacts OpenAI keys', () => {
  const input = 'key sk-' + 'A'.repeat(48);
  assert.equal(redactSecrets(input), 'key [REDACTED:openai-key]');
});

test('redacts bearer tokens', () => {
  const input = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456';
  assert.equal(redactSecrets(input), 'Authorization: Bearer [REDACTED]');
});

test('deep clones and redacts nested values without false positives', () => {
  const input = {
    prompt: 'regular text with sk-short',
    nested: [{ header: 'Bearer abcdefghijklmnopqrstuvwxyz' }],
  };
  const redacted = redactSecrets(input);
  assert.notEqual(redacted, input);
  assert.equal(redacted.prompt, 'regular text with sk-short');
  assert.equal(redacted.nested[0].header, 'Bearer [REDACTED]');
});
