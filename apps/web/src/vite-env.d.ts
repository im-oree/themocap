/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_STRICT_OFFLINE?: string;
  readonly VITE_ENABLE_SW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
  };
}
