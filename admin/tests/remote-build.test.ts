import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { test } from "node:test";
import { buildJobId, DockerBuild } from "../server/build.js";
import {
	builderEndpoint,
	byteLimit,
	RemoteBuild,
} from "../server/remote-build.js";

test("remote builder accepts only fixed loopback endpoints and immutable operator image", () => {
	assert.equal(builderEndpoint("http://127.0.0.1:4323").hostname, "127.0.0.1");
	for (const url of [
		"https://127.0.0.1:4323",
		"http://localhost:4323",
		"http://127.0.0.1:4323/path",
		"http://user@127.0.0.1:4323",
		"http://127.0.0.1:4323?x=1",
	])
		assert.throws(() => builderEndpoint(url));
	assert.throws(
		() =>
			new RemoteBuild(
				"http://127.0.0.1:4323",
				"short",
				`sha256:${"a".repeat(64)}`,
			),
	);
	assert.throws(
		() => new DockerBuild(undefined, {}, "unix:///var/run/docker.sock"),
	);
	assert.throws(() => buildJobId("../escape"));
});
test("remote archive stream enforces its byte budget", async () => {
	await assert.rejects(
		pipeline(Readable.from([Buffer.alloc(8)]), byteLimit(4)),
	);
});
