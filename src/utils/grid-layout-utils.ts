/**
 * 主网格列布局与侧边栏可见性 / 吸顶间距管理（从 Layout.astro 迁出）。
 */

import { shouldUseFullProfile } from "@/utils/layout-utils";
import {
	resolveSidebarLayout,
	type SidebarLayoutInput,
} from "@/utils/sidebar-effective-utils";
import { refreshSidebarPlaylistFit } from "@/utils/sidebar-playlist-fit";

const sidebarStickyState: Record<
	"left" | "right",
	{ topClass: "top-0" | "top-4"; hasVisibleTop: boolean }
> = {
	left: { topClass: "top-0", hasVisibleTop: false },
	right: { topClass: "top-0", hasVisibleTop: false },
};

function flag(element: Element, name: string): boolean {
	return element.getAttribute(name) === "true";
}

function readLayoutInput(mainGrid: Element): SidebarLayoutInput {
	const positionAttr = mainGrid.getAttribute("data-sidebar-position");
	const position =
		positionAttr === "right" || positionAttr === "both" ? positionAttr : "left";
	const swupContainer = document.getElementById("swup-container");

	return {
		isPostPage: swupContainer?.getAttribute("data-page-kind") === "post",
		isHomePage: swupContainer?.getAttribute("data-page-kind") === "home",
		enabled: flag(mainGrid, "data-sidebar-enable"),
		position,
		tabletSidebar:
			mainGrid.getAttribute("data-tablet-sidebar") === "right"
				? "right"
				: "left",
		hideSidebarOnPostPage: flag(mainGrid, "data-grid-hide-sidebar-on-post"),
		showBothSidebarsOnPostPage: flag(
			mainGrid,
			"data-show-both-sidebars-on-post",
		),
		postPageTocLeftLayoutEnabled: flag(
			mainGrid,
			"data-post-page-toc-left-layout",
		),
		hasLeftComponents: flag(mainGrid, "data-has-left-components"),
		hasRightComponents: flag(mainGrid, "data-has-right-components"),
	};
}

const isCurrentPagePost = (): boolean =>
	document.getElementById("swup-container")?.getAttribute("data-page-kind") ===
	"post";

/** Swup 薄适配：解析 SSR 数据并更新同一份普通网格变量。 */
export function updateMainGridCols(): void {
	const mainGrid = document.getElementById("main-grid");
	if (!mainGrid) return;

	const state = resolveSidebarLayout(readLayoutInput(mainGrid));
	for (const [name, value] of Object.entries(state.layoutVars)) {
		mainGrid.style.setProperty(name, value);
	}
}

// 更新侧边栏组件的可见性
export function updateSidebarComponentsVisibility(): void {
	const isPostPage = isCurrentPagePost();

	// 处理侧边栏级别的 hideSidebarOnPostPage 配置
	document
		.querySelectorAll<HTMLElement>("[data-hide-sidebar-on-post]")
		.forEach((wrapper) => {
			const hideOnPost =
				wrapper.getAttribute("data-hide-sidebar-on-post") === "true";
			if (isPostPage && hideOnPost) {
				wrapper.style.setProperty("display", "none", "important");
			} else {
				wrapper.style.removeProperty("display");
			}
		});

	// 合并页面规则，避免不同规则相互移除 hidden。
	document
		.querySelectorAll(
			".widget-hide-on-post, .widget-hide-on-non-post, .widget-post-only, .widget-non-post-only",
		)
		.forEach((widget) => {
			const hidden =
				(isPostPage && widget.classList.contains("widget-hide-on-post")) ||
				(!isPostPage && widget.classList.contains("widget-hide-on-non-post")) ||
				(!isPostPage && widget.classList.contains("widget-post-only")) ||
				(isPostPage && widget.classList.contains("widget-non-post-only"));
			widget.classList.toggle("hidden", hidden);
		});
	const useFullProfile =
		typeof window !== "undefined"
			? shouldUseFullProfile(window.location.pathname)
			: !isPostPage;
	document.querySelectorAll<HTMLElement>(".profile-card").forEach((profile) => {
		profile.dataset.variant = useFullProfile ? "full" : "compact";
	});

	// 组件可见性变化后刷新吸顶偏移；组间距由 CSS 直接处理。
	refreshSidebarStickyState();
}

// 读取页面规则下的顶部卡片状态，不受祖先在移动/平板端隐藏影响。
export function refreshSidebarStickyState(): void {
	(["left", "right"] as const).forEach((side) => {
		const sticky = document.getElementById(`${side}-sidebar-sticky`);
		if (!sticky) return;

		// 结构为：sidebar -> top 容器（可选） + sticky 容器
		const topContainer = sticky.previousElementSibling as HTMLElement | null;
		const hasVisibleTop = !!topContainer?.querySelector(
			":scope > .card-base:not(.hidden)",
		);
		sidebarStickyState[side].hasVisibleTop = hasVisibleTop;
	});

	updateSidebarStickySpacing();
	refreshSidebarPlaylistFit();
}

// 根据当前滚动位置动态更新侧边栏 sticky 顶部偏移。
// 滚动路径：仅切换滚动相关的 top-0/top-4，不再读取布局（hasVisibleTop 由 refreshSidebarStickyState 缓存）
export function updateSidebarStickySpacing(): void {
	const scrollTop = document.documentElement.scrollTop || window.scrollY || 0;
	const isScrolled = scrollTop > 2;

	(["left", "right"] as const).forEach((side) => {
		const sticky = document.getElementById(`${side}-sidebar-sticky`);
		if (!sticky) return;

		// 仅切换顶部偏移；组件间距由容器常驻 gap-4 保持
		const nextTopClass: "top-0" | "top-4" =
			sidebarStickyState[side].hasVisibleTop || isScrolled ? "top-4" : "top-0";

		if (sidebarStickyState[side].topClass !== nextTopClass) {
			sticky.classList.remove(sidebarStickyState[side].topClass);
			sticky.classList.add(nextTopClass);
			sidebarStickyState[side].topClass = nextTopClass;
		}
	});
}
