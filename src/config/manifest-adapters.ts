import type { GalleryAlbum } from "../types/galleryConfig";
import type { MusicPlayerConfig } from "../types/musicConfig";

export function playlistFromManifest(data: {
	tracks: Array<{
		id: string;
		name: string;
		artist: string;
		url: string;
		cover?: string;
		lrc?: string;
	}>;
}): NonNullable<MusicPlayerConfig["local"]>["playlist"] {
	return data.tracks.map(({ id: _id, ...track }) => track);
}
export function albumsFromManifest(data: {
	albums: GalleryAlbum[];
}): GalleryAlbum[] {
	return data.albums;
}
