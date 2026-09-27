/**
 * 主网格列布局与侧边栏可见性 / 吸顶间距管理（从 Layout.astro 迁出）。
 */

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

	// 处理组件级别的 showOnPostPage 配置
	document.querySelectorAll(".widget-hide-on-post").forEach((widget) => {
		isPostPage
			? widget.classList.add("hidden")
			: widget.classList.remove("hidden");
	});

	// 处理 hideOnNonPostPage === true 的组件
	document.querySelectorAll(".widget-hide-on-non-post").forEach((widget) => {
		!isPostPage
			? widget.classList.add("hidden")
			: widget.classList.remove("hidden");
	});

	// 组件可见性变化后，重新读取 top 容器可见性并重算 sticky 间距，避免 swup 切页后残留旧间距
	refreshSidebarStickyState();
}

// 重新读取侧边栏 top 容器的可见性并应用间距。
// 含 offsetHeight 布局读取，仅初始化 / 切页时调用；滚动路径使用缓存值，避免每帧强制布局
export function refreshSidebarStickyState(): void {
	(["left", "right"] as const).forEach((side) => {
		const sticky = document.getElementById(`${side}-sidebar-sticky`);
		if (!sticky) return;

		// 结构为：sidebar -> top 容器（可选） + sticky 容器
		const topContainer = sticky.previousElementSibling as HTMLElement | null;
		const hasVisibleTop = !!topContainer && topContainer.offsetHeight > 1;
		sidebarStickyState[side].hasVisibleTop = hasVisibleTop;

		// swup 从非文章页切换到文章页时，top 容器可能残留 mb-4，需要按可见性动态修正
		if (topContainer) {
			if (hasVisibleTop) {
				topContainer.classList.add("mb-4");
			} else {
				topContainer.classList.remove("mb-4");
			}
		}
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
