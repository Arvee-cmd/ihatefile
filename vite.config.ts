/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

// Optional override so tests can use a pre-installed Chromium (see README, "Testing").
const chromiumPath = process.env.IHATEFILE_CHROMIUM_PATH

/**
 * Origin of the conversion API, taken from VITE_API_BASE_URL. Only https (or a local address) is accepted,
 * so a typo cannot make the site send files over plain http.
 */
function apiOriginFrom(value: string | undefined): string {
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`VITE_API_BASE_URL is not a valid URL: ${value}`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error(
      'VITE_API_BASE_URL must be an https:// URL (http is only allowed for localhost).'
    )
  return url.origin
}

/**
 * Production-only: embeds a Content-Security-Policy <meta> (works on any static host, including GitHub Pages) and
 * emits a `_headers` file (honoured by Cloudflare Pages and Netlify) with the full set of security headers.
 * Scripts must come from this origin; nothing inline or eval-based may run.
 */
function securityHeaders(apiOrigin: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Radix/Tailwind set inline style attributes
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin ? ' ' + apiOrigin : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
  const headerOnly = ["frame-ancestors 'none'"] // not allowed inside a <meta> policy
  return {
    name: 'ihatefile-security-headers',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: policy.join('; '),
        },
        injectTo: 'head-prepend',
      },
    ],
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*
  Content-Security-Policy: ${[...policy, ...headerOnly].join('; ')}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiOrigin = apiOriginFrom(
    process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL
  )
  return {
    // Set VITE_BASE=/repo-name/ when deploying under a sub-path (e.g. GitHub Pages project sites).
    base: process.env.VITE_BASE ?? '/',
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      securityHeaders(apiOrigin),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    server: {
      // In development the API is proxied, so no CORS setup or VITE_API_BASE_URL is needed.
      proxy: {
        '/api': process.env.IHATEFILE_API_PROXY ?? 'http://127.0.0.1:8000',
      },
    },
    preview: {
      proxy: {
        '/api': process.env.IHATEFILE_API_PROXY ?? 'http://127.0.0.1:8000',
      },
    },
    test: {
      silent: 'passed-only',
      unstubEnvs: true,
      include: ['src/**/*.test.{ts,tsx}'],
      browser: {
        enabled: true,
        provider: playwright({
          launchOptions: chromiumPath
            ? { executablePath: chromiumPath }
            : undefined,
        }),
        instances: [{ browser: 'chromium' }],
      },
      coverage: {
        include: ['src/lib/**/*.ts', 'src/features/**/*.{ts,tsx}'],
        exclude: [
          'src/components/ui/**',
          'src/routeTree.gen.ts',
          'src/routes/**',
        ],
      },
    },
  }
})
