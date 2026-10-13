import type { GalleryConfig } from "../../../src/types/galleryConfig.js";
import type { MusicPlayerConfig } from "../../../src/types/musicConfig.js";

// Fixed synthetic pre-manifest inputs. Never import live configuration here.
export const legacyMusic: MusicPlayerConfig = {
	showInNavbar: true,
	showInSidebar: false,
	mode: "local",
	volume: 0.4,
	playMode: "one",
	showLyrics: true,
	local: {
		playlist: [
			{
				name: "合成曲目，🙂",
				artist: " 作者 A ",
				url: "https://fixture.invalid/first.wav",
				cover: "/fixture-cover.png",
				lrc: "[00:00.00]合成歌词",
			},
			{
				name: "第二首",
				artist: "作者 B",
				url: "/fixture-second.wav",
				lrc: "/fixture-second.lrc",
			},
		],
	},
};

export const legacyGallery: GalleryConfig = {
	assetBaseUrl: "https://fixture.invalid/gallery",
	assetVersioning: "content-hash",
	columnWidth: 280,
	albums: [
		{
			id: "fixture-album",
			name: "合成相册，🙂",
			description: "保留文字！",
			date: "2020-01-02",
			location: "合成地点",
			tags: ["B", "A"],
			cover: "/gallery/fixture-album/cover.png",
			password: "synthetic-only",
			passwordHint: "合成提示",
		},
		{ id: "fixture-empty", name: "空目录" },
	],
};

// Known SHA-256 values for fixed bytes, independent of migration implementation.
export const legacyFiles = {
	"cover.png": "abc",
	"a space.jpg": "hello",
	"urls.txt": "# ignored\nhttps://external.invalid/image.png\n\n",
	"ignored.txt": "not an image",
};
export const expectedPhotos = [
	"https://fixture.invalid/gallery/fixture-album/cover-ba7816bf.png",
	"https://fixture.invalid/gallery/fixture-album/a%20space-2cf24dba.jpg",
	"https://external.invalid/image.png",
];
export const legacyPreviews = {
	assets: {
		"fixture-album/cover-ba7816bf.png": {
			objectKey: "previews/cover.avif",
			width: 1200,
			height: 800,
		},
	},
};

// The one-time migration's supported settings are a fixed historical snapshot.
// Assert its contract explicitly; it does not read arbitrary legacy siteConfig.
export const expectedSettings = {
	version: 1,
	title: "DcElysion",
	subtitle: "blog",
	description: "God’s in his heaven，All’s right with the world",
	keywords: [
		"Elysion",
		"Firefly",
		"Fuwari",
		"Astro",
		"ACGN",
		"博客",
		"技术博客",
		"静态博客",
	],
	navbarTitle: "DcElysion",
};
