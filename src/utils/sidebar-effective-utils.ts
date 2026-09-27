import { sidebarLayoutConfig } from "@/config";
import {
	computeMainGridLayoutVars,
	type MainGridLayoutVars,
	type ResponsiveSidebarConfig,
} from "@/utils/responsive-utils";

export interface EffectiveSidebarContext {
	isPostPage: boolean;
}

/** SSR 与 Swup 共享的纯布局计算输入。 */
export interface SidebarLayoutInput {
	isPostPage: boolean;
	enabled: boolean;
	position: "left" | "right" | "both";
	tabletSidebar: "left" | "right";
	hideSidebarOnPostPage: boolean;
	showBothSidebarsOnPostPage: boolean;
	postPageTocLeftLayoutEnabled: boolean;
	hasLeftComponents: boolean;
	hasRightComponents: boolean;
}

export interface EffectiveSidebarState {
	hideSidebarOnPostPage: boolean;
	postPageTocLeftLayoutEnabled: boolean;
	usePostPageTocLeftLayout: boolean;
	shouldShowBothSidebarsOnPostPage: boolean;
	shouldAddLeftSidebar: boolean;
	shouldAddRightSidebar: boolean;
	effectiveIsBothSidebars: boolean;
	effectiveHasLeftComponents: boolean;
	effectiveHasRightComponents: boolean;
	effectiveTabletSidebar: "left" | "right";
	mobileShowSidebar: boolean;
	updatedGridConfig: ResponsiveSidebarConfig;
	gridDataAttrs: Record<string, string>;
	layoutVars: MainGridLayoutVars;
}

/**
 * 唯一布局真源：只根据显式输入计算列、侧栏、正文与 footer 的变量。
 * 不读取配置、DOM 或 window，因此 SSR 与 Swup 可安全共用。
 */
export function resolveSidebarLayout(
	input: SidebarLayoutInput,
): EffectiveSidebarState {
	const layoutActive =
		input.enabled && !(input.isPostPage && input.hideSidebarOnPostPage);
	const baseHasLeft =
		input.enabled && input.position !== "right" && input.hasLeftComponents;
	const baseHasRight =
		input.enabled && input.position !== "left" && input.hasRightComponents;
	const shouldShowBothSidebarsOnPostPage =
		layoutActive &&
		input.isPostPage &&
		input.position !== "both" &&
		input.showBothSidebarsOnPostPage;
	const shouldAddRightSidebar =
		shouldShowBothSidebarsOnPostPage && input.position === "left";
	const shouldAddLeftSidebar =
		shouldShowBothSidebarsOnPostPage && input.position === "right";
	const effectiveIsBothSidebars =
		(input.enabled && input.position === "both") ||
		shouldShowBothSidebarsOnPostPage;
	const effectiveHasLeftComponents =
		baseHasLeft || (shouldAddLeftSidebar && input.hasLeftComponents);
	const effectiveHasRightComponents =
		baseHasRight || (shouldAddRightSidebar && input.hasRightComponents);
	const effectiveTabletSidebar = shouldAddLeftSidebar
		? ("right" as const)
		: input.tabletSidebar;
	const usePostPageTocLeftLayout =
		layoutActive &&
		input.isPostPage &&
		input.position === "both" &&
		input.postPageTocLeftLayoutEnabled;

	const updatedGridConfig: ResponsiveSidebarConfig = {
		isBothSidebars: layoutActive && effectiveIsBothSidebars,
		hasLeftComponents: layoutActive && effectiveHasLeftComponents,
		hasRightComponents: layoutActive && effectiveHasRightComponents,
		mobileShowSidebar: false,
		tabletShowSidebar: layoutActive,
		desktopShowSidebar: layoutActive,
		position: input.position,
		tabletSidebar: effectiveTabletSidebar,
	};

	return {
		hideSidebarOnPostPage: input.hideSidebarOnPostPage,
		postPageTocLeftLayoutEnabled: input.postPageTocLeftLayoutEnabled,
		usePostPageTocLeftLayout,
		shouldShowBothSidebarsOnPostPage,
		shouldAddLeftSidebar,
		shouldAddRightSidebar,
		effectiveIsBothSidebars,
		effectiveHasLeftComponents,
		effectiveHasRightComponents,
		effectiveTabletSidebar,
		mobileShowSidebar: false,
		updatedGridConfig,
		gridDataAttrs: {
			"data-sidebar-enable": input.enabled ? "true" : "false",
			"data-grid-hide-sidebar-on-post": input.hideSidebarOnPostPage
				? "true"
				: "false",
			"data-sidebar-position": input.position,
			"data-tablet-sidebar": input.tabletSidebar,
			"data-show-both-sidebars-on-post": input.showBothSidebarsOnPostPage
				? "true"
				: "false",
			"data-post-page-toc-left-layout": input.postPageTocLeftLayoutEnabled
				? "true"
				: "false",
			"data-has-left-components": input.hasLeftComponents ? "true" : "false",
			"data-has-right-components": input.hasRightComponents ? "true" : "false",
		},
		layoutVars: computeMainGridLayoutVars(
			updatedGridConfig,
			usePostPageTocLeftLayout,
		),
	};
}

/** 配置读取薄适配：把站点配置归一化后交给纯布局计算。 */
export function getEffectiveSidebarState(
	ctx: EffectiveSidebarContext,
): EffectiveSidebarState {
	const hasLeftComponents = sidebarLayoutConfig.leftComponents.some(
		(component) => component.enable,
	);
	const hasRightComponents = sidebarLayoutConfig.rightComponents.some(
		(component) => component.enable,
	);
	const postPageTocLeftLayoutEnabled =
		sidebarLayoutConfig.enable &&
		sidebarLayoutConfig.position === "both" &&
		(sidebarLayoutConfig.tabletSidebar ?? "left") === "left" &&
		sidebarLayoutConfig.rightComponents.some(
			(component) =>
				component.type === "sidebarToc" &&
				component.enable &&
				component.showOnPostPage !== false,
		) &&
		sidebarLayoutConfig.leftComponents.some(
			(component) => component.enable && component.showOnPostPage !== false,
		);

	return resolveSidebarLayout({
		isPostPage: ctx.isPostPage,
		enabled: sidebarLayoutConfig.enable,
		position: sidebarLayoutConfig.position,
		tabletSidebar: sidebarLayoutConfig.tabletSidebar ?? "left",
		hideSidebarOnPostPage: sidebarLayoutConfig.hideSidebarOnPostPage === true,
		showBothSidebarsOnPostPage:
			sidebarLayoutConfig.showBothSidebarsOnPostPage === true,
		postPageTocLeftLayoutEnabled,
		hasLeftComponents,
		hasRightComponents,
	});
}
