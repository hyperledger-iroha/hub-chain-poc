import vue from "@vitejs/plugin-vue";
import uno from "unocss/vite";
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), uno(), vueDevTools()],
});
