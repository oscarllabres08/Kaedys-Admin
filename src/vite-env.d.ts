/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_KIND: 'user' | 'admin';
  readonly VITE_USER_APP_URL: string;
  readonly VITE_ADMIN_APP_URL: string;
  readonly VITE_STATUS_EMAIL_WEBHOOK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
