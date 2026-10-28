/** SVGs stay image resources; never insert fetched SVG markup into the page. */
export function isSvgSrc(src: string, base: string): boolean {
	if (!src) return false;
	try {
		const url = new URL(src, base);
		return (
			url.pathname.toLowerCase().endsWith(".svg") ||
			url.searchParams.get("f")?.toLowerCase() === "svg"
		);
	} catch {
		return false;
	}
}

export type LightboxSvgCache = {
	get(
		src: string,
		fallbackW: number,
		fallbackH: number,
	): Promise<string | null>;
	clear(): void;
};

export function createLightboxSvgCache(
	fetchSvg: (src: string) => Promise<Response>,
): LightboxSvgCache {
	let generation = 0;
	const pending = new Map<string, Promise<string | null>>();
	const urls = new Set<string>();
	return {
		get(
			src: string,
			fallbackW: number,
			fallbackH: number,
		): Promise<string | null> {
			const cached = pending.get(src);
			if (cached) return cached;
			const started = generation;
			const result = (async () => {
				try {
					const response = await fetchSvg(src);
					if (!response.ok || started !== generation) return null;
					const text = await response.text();
					if (started !== generation) return null;
					const doc = new DOMParser().parseFromString(text, "image/svg+xml");
					const svg = doc.documentElement;
					if (
						doc.querySelector("parsererror") ||
						svg.localName !== "svg" ||
						svg.namespaceURI !== "http://www.w3.org/2000/svg"
					)
						return null;
					const parts = (svg.getAttribute("viewBox") || "")
						.trim()
						.split(/[\s,]+/)
						.map(Number);
					const hasViewBox =
						parts.length === 4 &&
						parts.every(Number.isFinite) &&
						parts[2] > 0 &&
						parts[3] > 0;
					const width = hasViewBox ? parts[2] : fallbackW;
					const height = hasViewBox ? parts[3] : fallbackH;
					if (!svg.getAttribute("width"))
						svg.setAttribute("width", String(width));
					if (!svg.getAttribute("height"))
						svg.setAttribute("height", String(height));
					const url = URL.createObjectURL(
						new Blob([new XMLSerializer().serializeToString(svg)], {
							type: "image/svg+xml",
						}),
					);
					urls.add(url);
					return url;
				} catch {
					// CORS, parsing and network failures retain the routed original URL.
					return null;
				}
			})();
			pending.set(src, result);
			return result;
		},
		clear(): void {
			generation++;
			pending.clear();
			for (const url of urls) URL.revokeObjectURL(url);
			urls.clear();
		},
	};
}
