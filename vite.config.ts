import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'fs'

function readTunnelHost(): string | undefined {
  try {
    const raw = fs.readFileSync('./tunnel_url.txt', 'utf-8').trim()
    if (!raw) return undefined
    const url = new URL(raw)
    return url.host
  } catch {
    return process.env.TUNNEL_HOST
  }
}

const tunnelHost = readTunnelHost()

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5174,
    hmr: tunnelHost ? {
      protocol: 'wss',
      clientPort: 443,
      host: tunnelHost,
    } : true,
  },
  preview: {
    https: false,
    port: 4173,
  },
})
