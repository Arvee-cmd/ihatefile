/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the conversion API, e.g. https://api.example.com. Empty = same origin (/api). */
  readonly VITE_API_BASE_URL?: string
  /** Optional link used by the footer "Support" item. */
  readonly VITE_SUPPORT_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
