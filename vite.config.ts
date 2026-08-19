import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { galleryOrganizerPlugin } from './scripts/gallery-organizer-plugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      galleryOrganizerPlugin({ blobToken: env.BLOB_READ_WRITE_TOKEN }),
    ],
  }
})
