import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL("./client/", import.meta.url)),
	plugins: [svelte()],
	build: {
		outDir: fileURLToPath(new URL("./dist/", import.meta.url)),
		emptyOutDir: true,
	},
});
