import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['src/index.ts', 'src/client/index.tsx', 'src/config.ts'], dts: true, clean: true, format: ['esm'] })
