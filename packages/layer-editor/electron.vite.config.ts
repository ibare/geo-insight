import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite 표준 3-타깃 빌드: main(Node) / preload(bridge) / renderer(React).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
