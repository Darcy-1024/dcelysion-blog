import { timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { buildJobId, DockerBuild } from "../server/build.js";
import { command } from "../server/executor.js";
import { byteLimit } from "../server/remote-build.js";

// Run as a dedicated rootless builder identity. Only this process can use its socket.
const image = process.env.BUILDER_IMAGE;
const endpoint = process.env.BUILDER_DOCKER_ENDPOINT;
const token = process.env.BUILDER_TOKEN;
const port = Number(process.env.BUILDER_PORT || 4323);
const provider = process.env.BUILDER_COMMENT_PROVIDER;
if (
	!image ||
	!endpoint ||
	!token ||
	!/^[A-Za-z0-9_-]{43,128}$/u.test(token) ||
	!Number.isInteger(port) ||
	port < 1024 ||
	port > 65535 ||
	(provider !== "waline" && provider !== "twikoo") ||
	(provider === "waline" && !process.env.BUILDER_WALINE_SERVER_URL)
)
	throw new Error("Builder operator configuration required");
const build = new DockerBuild(
	image,
	{
		commentProvider: provider,
		walineServer: process.env.BUILDER_WALINE_SERVER_URL,
	},
	endpoint,
);
if (!(await build.containerAvailable()))
	throw new Error(
		"Rootless cgroup v2 memory/CPU/PID limits and pinned image required",
	);
// Remove only containers owned by this service, including API/service restart leftovers.
const stale = (
	await command("docker", [
		"--host",
		endpoint,
		"ps",
		"-a",
		"--filter",
		"label=cn.dcelysion.admin-builder=1",
		"--format",
		"{{.ID}}",
	])
).trim();
if (stale)
	await command("docker", [
		"--host",
		endpoint,
		"rm",
		"--force",
		...stale.split(/\s+/u),
	]);
let active: { id: string; cancelled: boolean } | null = null;
async function memoryAvailable() {
	try {
		const info = await readFile("/proc/meminfo", "utf8");
		return (
			Number(/^MemAvailable:\s+(\d+) kB$/mu.exec(info)?.[1] || 0) >= 1152 * 1024
		);
	} catch {
		return false;
	}
}
const server = createServer(async (req, res) => {
	res.setHeader("X-Build-Image", image);
	const supplied = Buffer.from(req.headers.authorization || "");
	const expected = Buffer.from(`Bearer ${token}`);
	if (
		supplied.length !== expected.length ||
		!timingSafeEqual(supplied, expected)
	) {
		res.writeHead(401).end();
		return;
	}
	if (req.headers["x-build-image"] !== image) {
		res.writeHead(409).end();
		return;
	}
	if (req.method === "GET" && req.url === "/health") {
		res
			.writeHead(
				(await build.containerAvailable()) && (await memoryAvailable())
					? 200
					: 503,
			)
			.end();
		return;
	}
	const match = /^\/jobs\/([a-f0-9-]+)$/u.exec(req.url || "");
	let id: string;
	try {
		id = buildJobId(match?.[1] || "");
	} catch {
		res.writeHead(400).end();
		return;
	}
	if (req.method === "DELETE") {
		try {
			if (active?.id === id) active.cancelled = true;
			await build.stop(id);
			res.writeHead(200).end();
		} catch {
			res.writeHead(503).end();
		}
		return;
	}
	if (
		req.method !== "POST" ||
		req.headers["content-type"] !== "application/x-tar"
	) {
		res.writeHead(400).end();
		return;
	}
	if (active) {
		res.writeHead(409).end();
		return;
	}
	const current = { id, cancelled: false };
	active = current;
	let directory: string | undefined;
	let phase = "reserve-before-upload";
	const timer = setTimeout(() => {
		current.cancelled = true;
		req.destroy();
		void build.stop(id).catch(() => {});
	}, 11 * 60_000);
	res.once("close", () => {
		if (!res.writableFinished) {
			current.cancelled = true;
			void build.stop(id).catch(() => {});
		}
	});
	try {
		if (!(await memoryAvailable())) throw new Error("BUILD_MEMORY_RESERVE");
		directory = await mkdtemp(join(tmpdir(), "dc-builder-"));
		const input = join(directory, "input.tar");
		const output = join(directory, "output.tar.gz");
		phase = "upload";
		await pipeline(
			req,
			byteLimit(544 * 1024 * 1024),
			createWriteStream(input, { flags: "wx", mode: 0o600 }),
		);
		if (current.cancelled) throw new Error("CANCELLED");
		phase = "reserve-after-upload";
		if (!(await memoryAvailable())) throw new Error("BUILD_MEMORY_RESERVE");
		phase = "container-build";
		await build.buildArchive(input, output, id);
		if (current.cancelled) throw new Error("CANCELLED");
		res.writeHead(200, { "Content-Type": "application/gzip" });
		await pipeline(createReadStream(output), byteLimit(512 * 1024 * 1024), res);
	} catch {
		// Operator-only stage names aid diagnosis without exposing candidate output.
		console.error(`Builder job failed at ${phase}`);
		if (!res.headersSent && !res.destroyed) res.writeHead(422).end();
		else res.destroy();
	} finally {
		clearTimeout(timer);
		await build.stop(id).catch(() => {});
		if (directory) await rm(directory, { recursive: true, force: true });
		active = null;
	}
});
server.requestTimeout = 11 * 60_000;
server.headersTimeout = 15_000;
server.listen(port, "127.0.0.1");
