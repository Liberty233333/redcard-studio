declare global {
  var __RED_CARD_V2_1_ENABLED__: boolean | undefined;
}

export function isV21Enabled(): boolean {
  if (typeof globalThis.__RED_CARD_V2_1_ENABLED__ === 'boolean') {
    return globalThis.__RED_CARD_V2_1_ENABLED__;
  }
  if (import.meta.env?.VITE_V2_1_ENABLED === 'false') return false;
  if (typeof process !== 'undefined' && process.env?.V2_1_ENABLED === 'false') return false;
  return true;
}
