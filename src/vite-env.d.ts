/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_PROVIDER?: 'claude_relay' | 'claude_direct';
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_RELAY_URL?: string;
  readonly VITE_LLM_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
