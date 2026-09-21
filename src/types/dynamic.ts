export interface DynamicImagePreview {
	src: string;
	srcSet?: string;
	width: number;
	height: number;
}

export interface DynamicImage {
	alt: string;
	src: string;
	title?: string;
	preview?: DynamicImagePreview;
}

export interface DynamicEntry {
	id: string;
	published: number;
	html: string;
	images: DynamicImage[];
	searchText: string;
	pinned?: boolean;
	location?: string;
}
