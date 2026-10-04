import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configurationDependencies } from "../server/configuration.js";
import { writeControlled } from "../server/executor.js";
import {
	type ConfigurationKind,
	configurationPaths,
	serializeConfiguration,
} from "../shared/configuration.js";
import { mediaFixture } from "./media-fixture.js";

export async function configurationFixture(port = 4327) {
	const f = await mediaFixture(port);
	const baseline = {
		music: {
			version: 1,
			tracks: [
				{
					id: "fixture-track-1",
					name: "隔离曲目 A",
					artist: " 作者 A ",
					url: "https://historical.example.invalid/a.wav",
					cover: "",
					lrc: "[00:00.00]纯音乐",
					unknown: { keep: "🙂" },
				},
				{
					id: "fixture-track-2",
					name: "隔离曲目 B",
					artist: "作者 B",
					url: "https://historical.example.invalid/b.wav",
				},
			],
		},
		gallery: {
			version: 1,
			albums: [
				{
					id: "fixture-album",
					name: "隔离相册",
					description: "保留标点！🙂",
					date: "2026-09-30",
					location: "本地",
					tags: ["fixture"],
					passwordHint: "只读历史字段",
					photos: [
						{
							id: "fixture-photo",
							original: "https://historical.example.invalid/original.png",
							preview: "https://historical.example.invalid/preview.png",
							width: 1200,
							height: 800,
							unknown: "keep",
						},
					],
				},
			],
		},
		settings: {
			version: 1,
			title: "隔离站点",
			subtitle: "fixture",
			description: "本地验证",
			keywords: ["fixture"],
			navbarTitle: "隔离站点",
			unknown: { preserved: true },
		},
	};
	for (const kind of Object.keys(baseline) as ConfigurationKind[]) {
		await writeControlled(
			f.root,
			configurationPaths[kind],
			serializeConfiguration(baseline[kind]),
		);
		for (const path of configurationDependencies[kind])
			await writeControlled(
				f.root,
				path,
				await readFile(resolve(path), "utf8"),
			);
	}
	await f.git([
		"add",
		"--",
		"src/config",
		"src/utils/gallery-utils.ts",
		"src/utils/media-contract.ts",
		"src/utils/media-client.ts",
		"src/types/galleryConfig.ts",
		"src/constants/gallery-previews.json",
	]);
	await f.git(["commit", "-m", "test: install configuration adapters"]);
	await f.git(["push", f.target.remote, "HEAD:refs/heads/master"]);
	return { ...f, baseline };
}

export function fixtureWav() {
	const samples = 16000;
	const bytes = Buffer.alloc(44 + samples * 2);
	bytes.write("RIFF");
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WAVEfmt ", 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write("data", 36);
	bytes.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		bytes.writeInt16LE(
			Math.round(Math.sin((2 * Math.PI * 440 * i) / 8000) * 1500),
			44 + i * 2,
		);
	return bytes;
}
