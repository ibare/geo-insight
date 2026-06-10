import { defineConfig } from 'vite';

// 상대 base — GitHub Pages 등 서브패스 배포 호환.
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
});
