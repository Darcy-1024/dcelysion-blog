import { sidebarLayoutConfig } from "@/config";
import {
	generateGridClasses,
	generateMainContentClasses,
	generateRightSidebarClasses,
	generateSidebarClasses,
	getResponsiveSidebarConfig,
	type ResponsiveSidebarConfig,
} from "@/utils/responsive-utils";

export interface EffectiveSidebarContext {
	isPostPage: boolean;
}

export interface EffectiveSidebarState {
	hideSidebarOnPostPage: boolean;
	postPageTocLeftLayoutEnabled: boolean;
	shouldShowBothSidebarsOnPostPage: boolean;
	shouldAddLeftSidebar: boolean;
	shouldAddRightSidebar: boolean;
	effectiveIsBothSidebars: boolean;
	effectiveHasLeftComponents: boolean;
	effectiveHasRightComponents: boolean;
	effectiveTabletSidebar: "left" | "right";
	mobileShowSidebar: boolean;
	updatedGridConfig: ResponsiveSidebarConfig;
	gridCols: string;
	sidebarClass: string;
	rightSidebarClass: string;
	mainContentClass: string;
	staticBarClass: string;
	footerClassName: string;
}

function replaceClassTokens(
	className: string,
	remove: string[],
	add: string[],
): string {
	const removeSet = new Set(remove);
	return [
		...className.split(/\s+/).filter((token) => token && !removeSet.has(token)),
		...add,
	].join(" ");
}

/** 纯 footer 类构建器（从 MainGridLayout 的 frontmatter 迁出，逐字保留分支） */
export function buildFooterClass(config: ResponsiveSidebarConfig): string {
	const footerClass = ["footer", "col-span-1", "onload-animation"];

	if (
		config.isBothSidebars &&
		config.hasLeftComponents &&
		config.hasRightComponents
	) {
		// 双侧栏：Footer 在平板与桌面都跟随内容列
		if (config.tabletSidebar === "right") {
			footerClass.push(
				"md:col-start-1 md:col-span-1 xl:col-start-2 xl:col-span-1",
			);
		} else {
			footerClass.push(
				"md:col-start-2 md:col-span-1 xl:col-start-2 xl:col-span-1",
			);
		}
	} else if (config.hasLeftComponents && !config.hasRightComponents) {
		// 仅左侧栏：内容列在第2列
		footerClass.push(
			"md:col-start-2 md:col-span-1 xl:col-start-2 xl:col-span-1",
		);
	} else {
		// 仅右侧栏或无侧栏：内容列在第1列
		footerClass.push(
			"md:col-start-1 md:col-span-1 xl:col-start-1 xl:col-span-1",
		);
	}

	return footerClass.join(" ");
}

/**
 * 计算文章页临时双侧栏等「有效侧栏配置」及网格 / footer 类（SSR，纯配置读）。
 * 从 MainGridLayout.astro 的 frontmatter 迁出，逐字保留原逻辑。
 */
export function getEffectiveSidebarState(
	ctx: EffectiveSidebarContext,
): EffectiveSidebarState {
	const { isPostPage } = ctx;

	const sidebarConfig = getResponsiveSidebarConfig();

	const hideSidebarOnPostPage =
		sidebarLayoutConfig.hideSidebarOnPostPage === true;

	const shouldShowBothSidebarsOnPostPage: boolean =
		sidebarLayoutConfig.enable &&
		!hideSidebarOnPostPage &&
		isPostPage &&
		sidebarLayoutConfig.position !== "both" &&
		!!sidebarLayoutConfig.showBothSidebarsOnPostPage;

	// position为left时，对侧为右侧；position为right时，对侧为左侧
	const shouldAddRightSidebar: boolean =
		shouldShowBothSidebarsOnPostPage && sidebarLayoutConfig.position === "left";
	const shouldAddLeftSidebar: boolean =
		shouldShowBothSidebarsOnPostPage &&
		sidebarLayoutConfig.position === "right";

	const effectiveIsBothSidebars: boolean =
		sidebarConfig.isBothSidebars || shouldShowBothSidebarsOnPostPage;
	const effectiveHasRightComponents: boolean =
		sidebarConfig.hasRightComponents ||
		(shouldAddRightSidebar &&
			sidebarLayoutConfig.rightComponents.some((comp) => comp.enable));
	const effectiveHasLeftComponents: boolean =
		sidebarConfig.hasLeftComponents ||
		(shouldAddLeftSidebar &&
			sidebarLayoutConfig.leftComponents.some((comp) => comp.enable));

	// 使用effective值重新生成网格类
	// 当position为right且文章页临时显示左侧栏时，tabletSidebar应为right（保持显示主侧栏）
	const effectiveTabletSidebar = shouldAddLeftSidebar
		? ("right" as const)
		: sidebarConfig.tabletSidebar;
	const postPageTocLeftLayoutEnabled =
		sidebarLayoutConfig.enable &&
		sidebarLayoutConfig.position === "both" &&
		effectiveTabletSidebar === "left" &&
		sidebarLayoutConfig.rightComponents.some(
			(component) =>
				component.type === "sidebarToc" &&
				component.enable &&
				component.showOnPostPage !== false,
		) &&
		sidebarLayoutConfig.leftComponents.some(
			(component) => component.enable && component.showOnPostPage !== false,
		);
	const usePostPageTocLeftLayout =
		isPostPage && !hideSidebarOnPostPage && postPageTocLeftLayoutEnabled;

	const updatedGridConfig: ResponsiveSidebarConfig = {
		...sidebarConfig,
		isBothSidebars: effectiveIsBothSidebars,
		hasLeftComponents: effectiveHasLeftComponents,
		hasRightComponents: effectiveHasRightComponents,
		tabletSidebar: effectiveTabletSidebar,
	};

	let { gridCols } = generateGridClasses(updatedGridConfig);
	let sidebarClass = generateSidebarClasses(updatedGridConfig);
	let rightSidebarClass =
		effectiveIsBothSidebars || sidebarLayoutConfig.position === "right"
			? generateRightSidebarClasses(updatedGridConfig)
			: "";
	let mainContentClass = generateMainContentClasses(updatedGridConfig);
	let footerClassName = buildFooterClass(updatedGridConfig);

	if (usePostPageTocLeftLayout) {
		gridCols =
			"grid-cols-1 md:grid-cols-[1fr_17.5rem] xl:grid-cols-[17.5rem_1fr_17.5rem]";
		sidebarClass = replaceClassTokens(
			sidebarClass,
			["md:col-start-1", "md:col-start-2", "xl:col-start-1", "xl:col-start-3"],
			["md:col-start-2", "xl:col-start-3"],
		);
		rightSidebarClass = replaceClassTokens(
			rightSidebarClass,
			["md:col-start-1", "md:col-start-2", "xl:col-start-1", "xl:col-start-3"],
			["xl:col-start-1"],
		);
		mainContentClass = replaceClassTokens(
			mainContentClass,
			[
				"md:col-start-1",
				"md:col-start-2",
				"xl:col-start-1",
				"xl:col-start-2",
				"xl:col-end-3",
			],
			["md:col-start-1", "xl:col-start-2", "xl:col-end-3"],
		);
		footerClassName = replaceClassTokens(
			footerClassName,
			["md:col-start-1", "md:col-start-2", "xl:col-start-1", "xl:col-start-2"],
			["md:col-start-1", "xl:col-start-2"],
		);
	}

	const staticBarClass = mainContentClass.replace("transition-main", "").trim();

	return {
		hideSidebarOnPostPage,
		postPageTocLeftLayoutEnabled,
		shouldShowBothSidebarsOnPostPage,
		shouldAddLeftSidebar,
		shouldAddRightSidebar,
		effectiveIsBothSidebars,
		effectiveHasLeftComponents,
		effectiveHasRightComponents,
		effectiveTabletSidebar,
		mobileShowSidebar: sidebarConfig.mobileShowSidebar,
		updatedGridConfig,
		gridCols,
		sidebarClass,
		rightSidebarClass,
		mainContentClass,
		staticBarClass,
		footerClassName,
	};
}
