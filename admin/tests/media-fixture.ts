import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApi } from "../server/api.js";
import { DraftError } from "../server/drafts.js";
import { JobService } from "../server/jobs.js";
import { MediaService } from "../server/media.js";
import {
	atomicCopy,
	type ObjectStore,
	verifyFile,
} from "../server/media-storage.js";
import type { MediaDestination, MediaVariant } from "../shared/media.js";
import { publicationFixture } from "./publish-fixture.js";

// Explicit filesystem mock. Never imported by production configuration.
export class MockObjects implements ObjectStore {
	readonly identity: string;
	failNext = false;
	constructor(readonly root: string) {
		this.identity = `filesystem-mock:${root}`;
	}
	async put(
		scope: "private" | "public",
		object: MediaVariant,
		file: string,
		destination?: MediaDestination,
	) {
		if (this.failNext) {
			this.failNext = false;
			throw new Error("controlled mock failure");
		}
		const root = join(
			this.root,
			scope,
			...(scope === "public" && destination ? [destination.bucket] : []),
		);
		await mkdir(root, { recursive: true });
		await atomicCopy(root, object.key, file, object);
		await writeFile(
			join(root, `${object.key}.metadata.json`),
			JSON.stringify({ mime: object.mime, size: object.size }),
		);
	}
	async verify(
		scope: "private" | "public",
		object: MediaVariant,
		destination?: MediaDestination,
	) {
		const file = join(
			this.root,
			scope,
			...(scope === "public" && destination ? [destination.bucket] : []),
			object.key,
		);
		const metadata = JSON.parse(
			await readFile(`${file}.metadata.json`, "utf8"),
		);
		if (metadata.size !== object.size || metadata.mime !== object.mime)
			throw new DraftError(422, "MEDIA_INTEGRITY");
		await verifyFile(file, object);
	}
	async verifyPublicDelivery(
		object: MediaVariant,
		destination?: MediaDestination,
	) {
		await this.verify("public", object, destination);
	}
}
export async function mediaFixture(port = 4326) {
	const f = await publicationFixture(port);
	await f.jobs.close();
	const objects = new MockObjects(join(f.privateRoot, "mock-objects"));
	const config = {
		repository: f.root,
		privateRoot: join(f.privateRoot, "private-media"),
		publicRoot: join(f.privateRoot, "public-media"),
		publicBase: "https://managed.example.invalid/library",
		destinations: Object.fromEntries(
			["article", "gallery", "wallpaper", "music"].map((purpose) => [
				purpose,
				{
					purpose,
					version: 1,
					bucket: `test-${purpose}`,
					prefix: "library",
					publicBase: `https://${purpose}.example.invalid/library`,
					tencentRoot: join(f.privateRoot, "public-media", purpose),
				},
			]),
		) as import("../server/media.js").MediaConfiguration["destinations"],
	};
	const newMedia = () => new MediaService(config, objects, "", f.adapter);
	const media = newMedia();
	f.drafts.managedMedia = media;
	const jobs = new JobService(
		f.publicationConfig,
		f.drafts,
		f.builder,
		new Map([[f.target.id, f.releases]]),
		"",
		f.adapter,
		media,
	);
	return {
		...f,
		objects,
		media,
		jobs,
		newMedia,
		mediaConfig: config,
		api: createApi(f.config, f.auth, f.drafts, jobs, media),
	};
}
