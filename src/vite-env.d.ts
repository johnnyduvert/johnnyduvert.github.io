/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CMS_URL?: string;
  /** Optional explicit deployment root, e.g. https://owner.github.io/repository/ */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
