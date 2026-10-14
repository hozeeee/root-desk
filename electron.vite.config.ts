import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(18).toString('base64') : undefined
  if (nonce) process.env.ROOTDESK_DEV_CSP_NONCE = nonce
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } },
      build: { rollupOptions: { input: resolve('src/main/index.ts') } }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': resolve('src/shared') } },
      build: {
        rollupOptions: {
          input: resolve('src/preload/index.ts'),
          output: { format: 'cjs', entryFileNames: 'index.cjs' }
        }
      }
    },
    renderer: {
      root: resolve('src/renderer'),
      html: { cspNonce: nonce },
      resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') } },
      plugins: [
        react(),
        {
          name: 'rootdesk-dev-csp',
          transformIndexHtml: {
            order: 'post',
            handler: (html: string) => nonce
              ? html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`).replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
              : html.replace("connect-src 'self' ws://localhost:* http://localhost:*", "connect-src 'self'")
          }
        }
      ]
    }
  }
})
