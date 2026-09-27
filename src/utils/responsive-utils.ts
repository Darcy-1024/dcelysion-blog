export interface ResponsiveSidebarConfig {
	isBothSidebars: boolean;
	hasLeftComponents: boolean;
	hasRightComponents: boolean;
	mobileShowSidebar: boolean;
	tabletShowSidebar: boolean;
	desktopShowSidebar: boolean;
	position: "left" | "right" | "both";
	tabletSidebar: "left" | "right";
}

/** 普通布局的完整几何输出；SSR 和 Swup 均写入 #main-grid。 */
export interface MainGridLayoutVars {
	"--main-grid-sidebar-width": string;
	"--main-grid-gap": string;
	"--main-grid-cols-md": string;
	"--main-grid-cols-xl": string;
	"--main-grid-left-display-md": "none" | "block";
	"--main-grid-left-display-xl": "none" | "block";
	"--main-grid-right-display-md": "none" | "block";
	"--main-grid-right-display-xl": "none" | "block";
	"--main-grid-left-column-md": string;
	"--main-grid-left-column-xl": string;
	"--main-grid-right-column-md": string;
	"--main-grid-right-column-xl": string;
	"--main-grid-content-column-md": string;
	"--main-grid-content-column-xl": string;
	"--main-grid-footer-column-md": string;
	"--main-grid-footer-column-xl": string;
}

const SIDEBAR_WIDTH = "17.5rem";
const GRID_GAP = "1rem";
const SIDEBAR_TRACK = "var(--main-grid-sidebar-width)";

export function computeMainGridLayoutVars(
	config: ResponsiveSidebarConfig,
	usePostPageTocLeftLayout: boolean,
): MainGridLayoutVars {
	const { hasLeftComponents: left, hasRightComponents: right } = config;
	const both = left && right;
	const tabletRight = config.tabletSidebar === "right";
	const mdLeft = left && !(config.isBothSidebars && tabletRight);
	const mdRight =
		right &&
		(config.isBothSidebars ? tabletRight : config.position === "right");
	const colsMd = both
		? tabletRight
			? `1fr ${SIDEBAR_TRACK}`
			: `${SIDEBAR_TRACK} 1fr`
		: left
			? `${SIDEBAR_TRACK} 1fr`
			: right
				? `1fr ${SIDEBAR_TRACK}`
				: "1fr";
	const colsXl = both ? `${SIDEBAR_TRACK} 1fr ${SIDEBAR_TRACK}` : colsMd;
	const contentMd = left && (!right || !tabletRight) ? "2" : "1";
	const contentXl = both ? "2" : contentMd;

	return {
		"--main-grid-sidebar-width": SIDEBAR_WIDTH,
		"--main-grid-gap": GRID_GAP,
		"--main-grid-cols-md": usePostPageTocLeftLayout
			? `1fr ${SIDEBAR_TRACK}`
			: colsMd,
		"--main-grid-cols-xl": usePostPageTocLeftLayout
			? `${SIDEBAR_TRACK} 1fr ${SIDEBAR_TRACK}`
			: colsXl,
		"--main-grid-left-display-md": mdLeft ? "block" : "none",
		"--main-grid-left-display-xl": left ? "block" : "none",
		"--main-grid-right-display-md": usePostPageTocLeftLayout
			? "none"
			: mdRight
				? "block"
				: "none",
		"--main-grid-right-display-xl": right ? "block" : "none",
		"--main-grid-left-column-md": usePostPageTocLeftLayout ? "2" : "1",
		"--main-grid-left-column-xl": usePostPageTocLeftLayout ? "3" : "1",
		"--main-grid-right-column-md": "2",
		"--main-grid-right-column-xl": usePostPageTocLeftLayout
			? "1"
			: config.isBothSidebars
				? "3"
				: "2",
		"--main-grid-content-column-md": usePostPageTocLeftLayout ? "1" : contentMd,
		"--main-grid-content-column-xl": usePostPageTocLeftLayout ? "2" : contentXl,
		"--main-grid-footer-column-md": usePostPageTocLeftLayout ? "1" : contentMd,
		"--main-grid-footer-column-xl": usePostPageTocLeftLayout ? "2" : contentXl,
	};
}

export function mainGridLayoutVarsToStyle(vars: MainGridLayoutVars): string {
	return Object.entries(vars)
		.map(([name, value]) => `${name}:${value}`)
		.join(";");
}
