import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const source = path.join(projectRoot, "workers", "sites-static", "index.js");
const serverDirectory = path.join(projectRoot, "dist", "server");
const destination = path.join(serverDirectory, "index.js");

await mkdir(serverDirectory, { recursive: true });
await copyFile(source, destination);

console.log("Prepared the Sites static asset worker.");
