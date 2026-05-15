import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // Чтобы пути к картинкам работали на GitHub Pages
  build: {
    outDir: 'docs', // Папка для готовой сборки
    emptyOutDir: true
  }
})