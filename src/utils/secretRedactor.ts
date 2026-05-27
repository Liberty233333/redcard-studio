export function redactSecrets<T>(input: T): T {
  return redactValue(input) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactValue(item);
    }
    return out;
  }
  return value;
}

function redactString(value: string): string {
  return value
    .replace(/sk-ant-[a-zA-Z0-9_-]{40,}/g, '[REDACTED:anthropic-key]')
    .replace(/sk-[a-zA-Z0-9]{40,}/g, '[REDACTED:openai-key]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]');
}
