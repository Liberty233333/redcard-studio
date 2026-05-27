import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultProviders } from './projectStore.ts';
import { mergeImportedProviderConfig } from './providerImport.ts';

test('imports nested text and image provider config', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    text: {
      provider: 'claude_relay',
      apiKey: 'text-key',
      relayUrl: 'https://relay.example/v1/messages',
      model: 'claude-sonnet-4-6',
    },
    image: {
      provider: 'openai_responses',
      apiKey: 'image-key',
      relayUrl: 'https://api.openai.com/v1/responses',
      model: 'gpt-image-2',
      size: '1024x1536',
      quality: 'high',
    },
  });

  assert.equal(merged.text.apiKey, 'text-key');
  assert.equal(merged.text.relayUrl, 'https://relay.example/v1/messages');
  assert.equal(merged.image.apiKey, 'image-key');
  assert.equal(merged.image.provider, 'openai_responses');
});

test('imports a flat password-manager text provider JSON', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    provider: 'claude_relay',
    apiKey: 'secret-from-vault',
    baseUrl: 'https://relay.example',
    model: 'claude-sonnet-4-6',
  });

  assert.equal(merged.text.apiKey, 'secret-from-vault');
  assert.equal(merged.text.relayUrl, 'https://relay.example');
  assert.equal(merged.image.apiKey, '');
});

test('imports a flat image provider JSON by provider type', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    provider: 'openai_responses',
    apiKey: 'image-secret',
    model: 'gpt-image-2',
    size: '1024x1536',
    quality: 'high',
  });

  assert.equal(merged.image.apiKey, 'image-secret');
  assert.equal(merged.image.quality, 'high');
  assert.equal(merged.text.apiKey, '');
});

test('imports password-manager API key aliases and strips bearer prefix', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    provider: 'openai_responses',
    authorization: 'Bearer image-secret-from-auth-header',
    model: 'gpt-image-2',
  });

  assert.equal(merged.image.apiKey, 'image-secret-from-auth-header');
  assert.equal(merged.image.authHeader, '');
});

test('imports key-only password-manager JSON into image provider', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    api_key: 'image-secret-from-key-only-json',
  });

  assert.equal(merged.image.apiKey, 'image-secret-from-key-only-json');
  assert.equal(merged.image.provider, 'custom_relay');
});

test('imports nested image provider aliases', () => {
  const merged = mergeImportedProviderConfig(defaultProviders, {
    image_provider: {
      provider: 'openai_responses',
      OPENAI_API_KEY: 'nested-image-secret',
      baseURL: 'https://api.openai.com/v1/responses',
    },
  });

  assert.equal(merged.image.apiKey, 'nested-image-secret');
  assert.equal(merged.image.relayUrl, 'https://api.openai.com/v1/responses');
});

test('rejects unrecognized provider JSON', () => {
  assert.throws(
    () => mergeImportedProviderConfig(defaultProviders, { unexpected: 'value' }),
    /未识别 Provider JSON/
  );
});
