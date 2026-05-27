import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResponsesImageRequestBody, generateCoverImage } from './client.ts';
import type { ImageProviderConfig } from '../types.ts';

const imageConfig: ImageProviderConfig = {
  provider: 'openai_responses',
  apiKey: '',
  relayUrl: '',
  model: 'gpt-image-2',
  size: '1056x1408',
  quality: 'high',
};

test('buildResponsesImageRequestBody separates style references from source images', () => {
  const body = buildResponsesImageRequestBody(imageConfig, 'cover prompt', {
    styleReferenceImages: ['data:image/png;base64,styleA', 'data:image/png;base64,styleB'],
    sourceImages: ['data:image/png;base64,sourceA'],
  });
  const content = body.input[0].content;

  assert.equal(body.model, 'gpt-image-2');
  assert.deepEqual(body.tools, [{ type: 'image_generation', size: '1056x1408', quality: 'high' }]);
  assert.deepEqual(content.map((block: any) => block.type), [
    'input_text',
    'input_text',
    'input_image',
    'input_image',
    'input_text',
    'input_image',
  ]);
  assert.match(content[1].text, /style reference/);
  assert.match(content[4].text, /source 素材/);
  assert.equal(JSON.stringify(body).includes('avatar'), false);
});

test('generateCoverImage prefers visible apiKey over stale authHeader', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> | undefined;
  (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
    capturedHeaders = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 });
  };

  try {
    const image = await generateCoverImage(
      {
        ...imageConfig,
        provider: 'openai_images',
        apiKey: 'fresh-visible-key',
        authHeader: 'Bearer stale-hidden-key',
      },
      'cover prompt'
    );

    assert.equal(image, 'data:image/png;base64,QUJD');
    assert.equal(capturedHeaders?.Authorization, 'Bearer fresh-visible-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateCoverImage ignores hidden authHeader without visible apiKey', async () => {
  await assert.rejects(
    () => generateCoverImage(
      {
        ...imageConfig,
        provider: 'openai_images',
        apiKey: '',
        authHeader: 'Bearer stale-hidden-key',
      },
      'cover prompt'
    ),
    /Image API Key 为空/
  );
});

test('generateCoverImage preserves upstream 429 detail', async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({
    error: {
      message: 'apiyi upstream route busy, retry later',
      type: 'shell_api_error',
      code: 'rate_limited',
    },
  }), { status: 429 });

  try {
    await assert.rejects(
      () => generateCoverImage(
        {
          ...imageConfig,
          provider: 'openai_images',
          apiKey: 'visible-key',
        },
        'cover prompt'
      ),
      /生图请求被中转拒绝 HTTP 429：apiyi upstream route busy, retry later；type=shell_api_error；code=rate_limited/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateCoverImage sends APIYi edit references as image[]', async () => {
  const originalFetch = globalThis.fetch;
  let imageArrayCount = 0;
  let imageCount = 0;
  (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
    const form = init?.body as FormData;
    imageArrayCount = form.getAll('image[]').length;
    imageCount = form.getAll('image').length;
    return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 });
  };

  try {
    await generateCoverImage(
      {
        ...imageConfig,
        provider: 'custom_relay',
        apiKey: 'visible-key',
        relayUrl: 'https://api.apiyi.com',
      },
      'cover prompt',
      ['data:image/png;base64,QUJD']
    );

    assert.equal(imageArrayCount, 1);
    assert.equal(imageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateCoverImage retries APIYi gpt-image-2 with gpt-image-2-all on 429', async () => {
  const originalFetch = globalThis.fetch;
  const models: string[] = [];
  (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    models.push(body.model);
    if (models.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'token-priority required' } }), { status: 429 });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 });
  };

  try {
    const image = await generateCoverImage(
      {
        ...imageConfig,
        provider: 'custom_relay',
        apiKey: 'visible-key',
        relayUrl: 'https://api.apiyi.com',
        model: 'gpt-image-2',
      },
      'cover prompt'
    );

    assert.equal(image, 'data:image/png;base64,QUJD');
    assert.deepEqual(models, ['gpt-image-2', 'gpt-image-2-all']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
