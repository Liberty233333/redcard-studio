import type { ImageProviderConfig, ProviderConfig, TextProviderConfig } from '../types.ts';
import { defaultProviders } from './projectStore.ts';

const TEXT_PROVIDERS: TextProviderConfig['provider'][] = ['claude_relay', 'claude_direct', 'openai_compatible'];
const IMAGE_PROVIDERS: ImageProviderConfig['provider'][] = ['openai_images', 'openai_responses', 'custom_relay'];

export function mergeImportedProviderConfig(current: ProviderConfig, imported: unknown): ProviderConfig {
  if (!imported || typeof imported !== 'object') {
    throw new Error('Provider JSON 必须是对象。');
  }
  const value = imported as Record<string, unknown>;
  const next: ProviderConfig = {
    text: { ...defaultProviders.text, ...current.text },
    image: { ...defaultProviders.image, ...current.image },
  };

  if (isObject(value.text)) {
    next.text = mergeTextProvider(next.text, value.text);
  }
  if (isObject(value.image)) {
    next.image = mergeImageProvider(next.image, value.image);
  }
  if (isObject(value.imageProvider)) {
    next.image = mergeImageProvider(next.image, value.imageProvider);
  }
  if (isObject(value.image_provider)) {
    next.image = mergeImageProvider(next.image, value.image_provider);
  }
  if (isObject(value.openai)) {
    next.image = mergeImageProvider(next.image, value.openai);
  }
  if (isObject(value.openaiImage)) {
    next.image = mergeImageProvider(next.image, value.openaiImage);
  }
  if (isObject(value.openai_image)) {
    next.image = mergeImageProvider(next.image, value.openai_image);
  }
  if (isObject(value.images)) {
    next.image = mergeImageProvider(next.image, value.images);
  }
  if (!value.text && !value.image && !value.imageProvider && !value.image_provider && !value.openai && !value.openaiImage && !value.openai_image && !value.images) {
    const provider = typeof value.provider === 'string' ? value.provider : '';
    if (isTextProvider(provider)) {
      next.text = mergeTextProvider(next.text, value);
    } else if (isImageProvider(provider) || looksLikeImageProvider(value) || apiKeyValue(value)) {
      next.image = mergeImageProvider(next.image, value);
    } else {
      throw new Error('未识别 Provider JSON。请上传 { text, image } 或带 provider 字段的配置。');
    }
  }

  return next;
}

function mergeTextProvider(current: TextProviderConfig, value: Record<string, unknown>): TextProviderConfig {
  const provider = stringValue(value.provider);
  return {
    ...current,
    provider: isTextProvider(provider) ? provider : current.provider,
    apiKey: apiKeyValue(value) || current.apiKey,
    relayUrl: stringValue(value.relayUrl) || stringValue(value.baseUrl) || stringValue(value.baseURL) || stringValue(value.url) || current.relayUrl,
    model: stringValue(value.model) || current.model,
  };
}

function mergeImageProvider(current: ImageProviderConfig, value: Record<string, unknown>): ImageProviderConfig {
  const provider = stringValue(value.provider);
  return {
    ...current,
    provider: isImageProvider(provider) ? provider : current.provider,
    apiKey: apiKeyValue(value) || current.apiKey,
    authHeader: '',
    relayUrl: stringValue(value.relayUrl) || stringValue(value.baseUrl) || stringValue(value.baseURL) || stringValue(value.url) || current.relayUrl,
    model: stringValue(value.model) || current.model,
    size: stringValue(value.size) || current.size,
    quality: stringValue(value.quality) || current.quality,
  };
}

function looksLikeImageProvider(value: Record<string, unknown>): boolean {
  const model = stringValue(value.model).toLowerCase();
  const provider = stringValue(value.provider).toLowerCase();
  return Boolean(value.size || value.quality || model.includes('image') || provider.includes('openai'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTextProvider(value: string): value is TextProviderConfig['provider'] {
  return TEXT_PROVIDERS.includes(value as TextProviderConfig['provider']);
}

function isImageProvider(value: string): value is ImageProviderConfig['provider'] {
  return IMAGE_PROVIDERS.includes(value as ImageProviderConfig['provider']);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function apiKeyValue(value: Record<string, unknown>): string {
  const raw = stringValue(value.apiKey)
    || stringValue(value.api_key)
    || stringValue(value.key)
    || stringValue(value.token)
    || stringValue(value.accessToken)
    || stringValue(value.access_token)
    || stringValue(value.OPENAI_API_KEY)
    || stringValue(value.openaiApiKey)
    || stringValue(value.authorization)
    || stringValue(value.Authorization);
  return raw.replace(/^Bearer\s+/i, '').trim();
}
