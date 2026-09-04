/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // happy-dom porque lo que se prueba son hooks de React que tocan estado y
    // suscripciones, no utilidades puras.
    environment: 'happy-dom',
    // Sin globals: cada test importa lo que usa de 'vitest'. Así `tsc -b`
    // tipa los tests sin tener que sumar tipos globales al tsconfig de la app.
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
})
