import { defineConfig, devices } from "@playwright/test";

const port = 4336;
const baseURL = `http://127.0.0.1:${port}`;
const astro = "node node_modules/astro/bin/astro.mjs";
const output = ".tmp/code-group-test";

export default defineConfig({
	testDir: "src/components/features",
	testMatch: "CodeGroupManager.spec.ts",
	timeout: 60000,
	expect: { timeout: 10000 },
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
	webServer: {
		command: `${astro} build --mode code-group-test --outDir ${output} && ${astro} preview --outDir ${output} --host 127.0.0.1 --port ${port} --ignore-lock`,
		url: `${baseURL}/posts/code-examples/`,
		reuseExistingServer: !process.env.CI,
		timeout: 240000,
	},
});
