import { siteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { ImmersiveReadingConfig } from "@/types/immersiveReadingConfig";
import { refreshSidebarStickyState } from "@/utils/grid-layout-utils";
import { ImmersiveScrollRailManager } from "@/utils/immersive-scroll-rail";
import { isPostPage, TOCManager } from "@/utils/toc-utils";

if (typeof window.ImmersiveReading === "undefined") {
	window.ImmersiveReading = {
		btn: null,
		tocBtn: null,
		toc: null,
		manager: null,
		rail: null,
		prevScroll: 0,
		isImmersive: false,
	};
}

const IR = window.ImmersiveReading;
IR.rail ??= null;
const IMMERSIVE_READING_PREFERENCE_KEY = "immersiveReadingEnabled";

/** 用内联 !important 强制内容面板贴顶到 1rem——内联 important 优先于一切样式表规则 */
function clampContentTop(): void {
	const panel = document.querySelector<HTMLElement>(".content-panel");
	if (!panel) return;
	panel.style.setProperty("top", "1rem", "important");
	panel.style.setProperty("min-height", "calc(100vh - 1rem)", "important");
	panel.style.setProperty("--content-top", "1rem", "important");
}

function clearContentTop(): void {
	const panel = document.querySelector<HTMLElement>(".content-panel");
	if (!panel) return;
	panel.style.removeProperty("top");
	panel.style.removeProperty("min-height");
	panel.style.removeProperty("--content-top");
}

function isDesktop(): boolean {
	return window.innerWidth >= 1024;
}

function immersiveConfig(): ImmersiveReadingConfig {
	return (
		siteConfig.post.immersiveReading ?? {
			enable: true,
			defaultOn: false,
			tocEnabled: true,
			tocPosition: "left",
		}
	);
}

function getStoredImmersiveReadingPreference(): boolean | null {
	try {
		const stored = window.localStorage.getItem(
			IMMERSIVE_READING_PREFERENCE_KEY,
		);
		if (stored === "true") return true;
		if (stored === "false") return false;
	} catch {
		// localStorage 不可用时回退到站点配置
	}
	return null;
}

function setStoredImmersiveReadingPreference(enabled: boolean): void {
	try {
		window.localStorage.setItem(
			IMMERSIVE_READING_PREFERENCE_KEY,
			String(enabled),
		);
	} catch {
		// 存储不可用不应阻止本次切换
	}
}

function shouldEnterImmersiveReading(): boolean {
	return getStoredImmersiveReadingPreference() ?? immersiveConfig().defaultOn;
}

function setFloatingButtonLabel(
	button: HTMLElement | null,
	label: string,
): void {
	button?.setAttribute("title", label);
	button?.querySelector("button")?.setAttribute("aria-label", label);
}

function createImmersiveTOCManager(): TOCManager {
	return new TOCManager({
		contentId: "immersive-toc-content",
		indicatorId: "immersive-toc-indicator",
		maxLevel: 3,
		scrollOffset: 80,
		onActiveChange: (headingIds) => {
			IR.rail?.setActiveHeadingIds(headingIds);
		},
	});
}

function updateArticleScrollRail(): void {
	if (isPostPage() && isDesktop()) {
		IR.rail ??= new ImmersiveScrollRailManager();
		IR.rail.activate();
		return;
	}
	IR.rail?.deactivate();
}

/** 目录栏 & 窄屏目录开关。切到新文章时再次调用可重建目录（SSR 锚点已过期） */
function setupImmersiveTOC(): void {
	const cfg = immersiveConfig();
	const content = document.getElementById("immersive-toc-content");
	if (cfg.tocEnabled !== false && content) {
		IR.tocBtn?.classList.remove("hide");
		// 默认展开目录（桌面/移动一致）；关闭后由 CSS 释放文章让位空间
		IR.toc?.classList.add("open");
		IR.tocBtn?.classList.add("toggled"); // 目录打开时按钮切到「关闭」图标
		setFloatingButtonLabel(IR.tocBtn, i18n(I18nKey.tocCollapse));
		document.body.classList.add("immersive-toc-open");
		try {
			if (IR.manager) IR.manager.cleanup();
			IR.manager = createImmersiveTOCManager();
			// attach() 自校正：SSR 锚点与当前正文一致则直接附着；
			// 切到别的文章后锚点过期会回退 DOM 遍历重建。
			IR.manager.attach();
			IR.rail?.refresh();
		} catch (error) {
			console.error("Failed to init immersive TOC:", error);
		}
	} else {
		IR.tocBtn?.classList.add("hide");
		IR.toc?.classList.remove("open");
		IR.tocBtn?.classList.remove("toggled");
		setFloatingButtonLabel(IR.tocBtn, i18n(I18nKey.tocExpand));
		document.body.classList.remove("immersive-toc-open");
	}
}

function enterImmersiveReading(rememberPreference = false): void {
	// 仅在桌面端提供沉浸阅读
	if (!isPostPage() || !isDesktop()) return;
	if (rememberPreference) setStoredImmersiveReadingPreference(true);
	if (IR.isImmersive) return;
	IR.isImmersive = true;
	IR.prevScroll = window.scrollY;

	document.body.classList.add("immersive-reading");
	clampContentTop();
	const cfg = immersiveConfig();
	document.body.classList.toggle(
		"immersive-toc-right",
		cfg.tocPosition === "right",
	);

	// 进/出按钮：去掉 .hide，切换为退出图标
	IR.btn?.classList.remove("hide");
	IR.btn?.classList.add("toggled");
	setFloatingButtonLabel(IR.btn, i18n(I18nKey.exitImmersiveReading));

	// 目录栏 & 窄屏目录开关
	updateArticleScrollRail();
	setupImmersiveTOC();

	// 类 PDF：回到文章顶部开始阅读
	window.scrollTo({ top: 0, behavior: "instant" });

	document.dispatchEvent(
		new CustomEvent("immersiveReadingChange", { detail: { on: true } }),
	);
}

function exitImmersiveReading(rememberPreference = false): void {
	if (rememberPreference) setStoredImmersiveReadingPreference(false);
	if (!IR.isImmersive) return;
	IR.isImmersive = false;

	document.body.classList.remove("immersive-reading");
	document.body.classList.remove("immersive-toc-right");
	document.body.classList.remove("immersive-toc-open");
	clearContentTop();

	// 侧边栏恢复显示后重新测量 top 容器可见性，恢复 mb-4（sticky 与 top 组件之间间距）
	requestAnimationFrame(() => {
		refreshSidebarStickyState();
		IR.rail?.refresh();
	});

	IR.manager?.cleanup();
	IR.manager = null;

	IR.btn?.classList.remove("toggled");
	setFloatingButtonLabel(IR.btn, i18n(I18nKey.enterImmersiveReading));
	IR.tocBtn?.classList.add("hide");
	IR.tocBtn?.classList.remove("toggled");
	setFloatingButtonLabel(IR.tocBtn, i18n(I18nKey.tocExpand));
	IR.toc?.classList.remove("open");

	// 重新计算按钮可见性：文章页 + 桌面端应恢复「进入」按钮
	updateImmersiveReadingVisibility();

	// 恢复进入前的滚动位置
	window.scrollTo({ top: IR.prevScroll || 0, behavior: "instant" });

	document.dispatchEvent(
		new CustomEvent("immersiveReadingChange", { detail: { on: false } }),
	);
}

function toggleImmersiveReading(): void {
	if (IR.isImmersive) exitImmersiveReading(true);
	else enterImmersiveReading(true);
}

function toggleImmersiveTOC(): void {
	if (!IR.isImmersive) return;
	const toc = IR.toc;
	if (!toc) return;
	const isOpen = toc.classList.contains("open");
	toc.classList.toggle("open", !isOpen);
	document.body.classList.toggle("immersive-toc-open", !isOpen);
	IR.tocBtn?.classList.toggle("toggled", !isOpen);
	// 悬停提示跟随目录开关状态
	setFloatingButtonLabel(
		IR.tocBtn,
		!isOpen ? i18n(I18nKey.tocCollapse) : i18n(I18nKey.tocExpand),
	);
}

// 目录项点击标记为内部导航，避免误触其它「外部链接自动关闭」逻辑
function bindImmersiveTOCNav(): void {
	const tocContent = document.getElementById("immersive-toc-content");
	if (!tocContent) return;
	tocContent.addEventListener(
		"click",
		(e) => {
			const target = e.target as Element | null;
			const anchor = target?.closest('a[href^="#"]');
			if (anchor) window.tocInternalNavigation = true;
		},
		{ capture: true },
	);
}

function updateImmersiveReadingVisibility(): void {
	if (!IR.btn) return;
	const enabled = immersiveConfig().enable !== false;

	if (!enabled || !isPostPage() || !isDesktop()) {
		if (IR.isImmersive) exitImmersiveReading();
		IR.btn.classList.add("hide");
		IR.tocBtn?.classList.add("hide");
		return;
	}
	IR.btn.classList.remove("hide");
}

/** 初始化沉浸阅读：绑定 DOM、更新按钮可见性、注册 Swup/resize/Esc/解密监听（幂等） */
export function initImmersiveReading(): void {
	IR.btn = document.getElementById("immersive-reading-btn");
	IR.tocBtn = document.getElementById("immersive-toc-toggle-btn");
	IR.toc = document.getElementById("immersive-toc");
	bindImmersiveTOCNav();
	updateArticleScrollRail();
	updateImmersiveReadingVisibility();

	// 跨 Swup 切到另一篇文章时若仍在沉浸态，重建目录（SSR 锚点已过期）
	if (IR.isImmersive) {
		setupImmersiveTOC();
	}

	// 优先恢复用户选择；没有记录时才使用站点默认值
	const cfg = immersiveConfig();
	if (cfg.enable !== false && shouldEnterImmersiveReading() && isPostPage()) {
		enterImmersiveReading();
	}

	// 防止 Swup 切页重跑脚本时重复注册监听器
	if (!window.__immersiveReadingInit) {
		window.__immersiveReadingInit = true;

		document.addEventListener("swup:contentReplaced", () => {
			setTimeout(initImmersiveReading, 100);
		});
		document.addEventListener("astro:page-load", () => {
			setTimeout(initImmersiveReading, 100);
		});
		window.addEventListener("popstate", () => {
			setTimeout(initImmersiveReading, 200);
		});

		// 视口变化：移动端自动退出但不改偏好；回到桌面端时按偏好恢复
		window.addEventListener("resize", () => {
			updateImmersiveReadingVisibility();
			updateArticleScrollRail();
			const cfg = immersiveConfig();
			if (
				cfg.enable !== false &&
				isPostPage() &&
				isDesktop() &&
				shouldEnterImmersiveReading()
			) {
				enterImmersiveReading();
			}
		});

		// Esc 退出沉浸阅读
		window.addEventListener("keydown", (e) => {
			if (e.key === "Escape") exitImmersiveReading(true);
		});

		// 密码解密后刷新文章阅读轨；沉浸模式同时重建目录
		document.addEventListener("password:decrypted", () => {
			setTimeout(() => {
				if (IR.isImmersive) {
					IR.manager?.cleanup();
					IR.manager = createImmersiveTOCManager();
					IR.manager.attach();
				}
				IR.rail?.refresh();
			}, 200);
		});
	}
}

// 供内联 onclick（window.toggleImmersiveReading / window.toggleImmersiveTOC）调用
window.toggleImmersiveReading = toggleImmersiveReading;
window.toggleImmersiveTOC = toggleImmersiveTOC;
window.enterImmersiveReading = () => enterImmersiveReading(true);
window.exitImmersiveReading = () => exitImmersiveReading(true);
