import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveSidebarLayout,
	type SidebarLayoutInput,
} from "./sidebar-effective-utils";

const baseInput: SidebarLayoutInput = {
	isPostPage: false,
	enabled: true,
	position: "both",
	tabletSidebar: "left",
	hideSidebarOnPostPage: false,
	showBothSidebarsOnPostPage: true,
	postPageTocLeftLayoutEnabled: false,
	hasLeftComponents: true,
	hasRightComponents: true,
};

function resolve(overrides: Partial<SidebarLayoutInput> = {}) {
	return resolveSidebarLayout({ ...baseInput, ...overrides });
}

test("关闭侧栏或文章页隐藏侧栏时，SSR 与 Swup 都得到单列", () => {
	for (const state of [
		resolve({ enabled: false }),
		resolve({ isPostPage: true, hideSidebarOnPostPage: true }),
	]) {
		assert.equal(state.layoutVars["--main-grid-cols-md"], "1fr");
		assert.equal(state.layoutVars["--main-grid-cols-xl"], "1fr");
		assert.equal(state.layoutVars["--main-grid-left-display-xl"], "none");
		assert.equal(state.layoutVars["--main-grid-right-display-xl"], "none");
		assert.equal(state.layoutVars["--main-grid-content-column-md"], "1");
		assert.equal(state.layoutVars["--main-grid-footer-column-md"], "1");
	}
});

test("普通单左、单右布局保持正文与侧栏顺序", () => {
	const left = resolve({ position: "left" });
	assert.equal(
		left.layoutVars["--main-grid-cols-md"],
		"var(--main-grid-sidebar-width) 1fr",
	);
	assert.equal(left.layoutVars["--main-grid-content-column-md"], "2");
	assert.equal(left.layoutVars["--main-grid-left-display-md"], "block");

	const right = resolve({ position: "right" });
	assert.equal(
		right.layoutVars["--main-grid-cols-md"],
		"1fr var(--main-grid-sidebar-width)",
	);
	assert.equal(right.layoutVars["--main-grid-content-column-md"], "1");
	assert.equal(right.layoutVars["--main-grid-right-column-md"], "2");
	assert.equal(right.layoutVars["--main-grid-right-display-md"], "block");
});

test("双栏平板选择决定两列方向，桌面仍为三列", () => {
	const left = resolve({ tabletSidebar: "left" });
	assert.equal(
		left.layoutVars["--main-grid-cols-md"],
		"var(--main-grid-sidebar-width) 1fr",
	);
	assert.equal(
		left.layoutVars["--main-grid-cols-xl"],
		"var(--main-grid-sidebar-width) 1fr var(--main-grid-sidebar-width)",
	);
	assert.equal(left.layoutVars["--main-grid-content-column-md"], "2");

	const right = resolve({ tabletSidebar: "right" });
	assert.equal(
		right.layoutVars["--main-grid-cols-md"],
		"1fr var(--main-grid-sidebar-width)",
	);
	assert.equal(
		right.layoutVars["--main-grid-cols-xl"],
		left.layoutVars["--main-grid-cols-xl"],
	);
	assert.equal(right.layoutVars["--main-grid-content-column-md"], "1");
});

test("文章 TOC 特例只在文章启用，并保留逻辑侧栏 ID 的视觉换位", () => {
	const nonPost = resolve({ postPageTocLeftLayoutEnabled: true });
	assert.equal(nonPost.usePostPageTocLeftLayout, false);
	assert.equal(nonPost.layoutVars["--main-grid-left-column-md"], "1");

	const post = resolve({
		isPostPage: true,
		postPageTocLeftLayoutEnabled: true,
	});
	assert.equal(post.usePostPageTocLeftLayout, true);
	assert.equal(post.layoutVars["--main-grid-left-column-md"], "2");
	assert.equal(post.layoutVars["--main-grid-left-column-xl"], "3");
	assert.equal(post.layoutVars["--main-grid-right-display-md"], "none");
	assert.equal(post.layoutVars["--main-grid-right-column-xl"], "1");
	assert.equal(post.layoutVars["--main-grid-content-column-md"], "1");
	assert.equal(post.layoutVars["--main-grid-footer-column-md"], "1");
	assert.equal(post.layoutVars["--main-grid-content-column-xl"], "2");
	assert.equal(post.layoutVars["--main-grid-footer-column-xl"], "2");
});

test("右侧主栏的文章临时双栏在平板保持正文第一列、主栏第二列", () => {
	const state = resolve({
		isPostPage: true,
		position: "right",
		tabletSidebar: "left",
	});
	assert.equal(state.shouldAddLeftSidebar, true);
	assert.equal(state.effectiveTabletSidebar, "right");
	assert.equal(state.layoutVars["--main-grid-content-column-md"], "1");
	assert.equal(state.layoutVars["--main-grid-right-column-md"], "2");
	assert.equal(state.layoutVars["--main-grid-left-display-md"], "none");
	assert.equal(state.layoutVars["--main-grid-left-display-xl"], "block");
});

test("组件缺失不会凭 position 虚构侧栏列", () => {
	const state = resolve({
		position: "left",
		hasLeftComponents: false,
		hasRightComponents: true,
	});
	assert.equal(state.layoutVars["--main-grid-cols-md"], "1fr");
	assert.equal(state.layoutVars["--main-grid-content-column-md"], "1");
});

test("每个状态输出完整变量集合，保留双栏缺失组件的既有显示边界", () => {
	const normal = resolve();
	const edge = resolve({ hasRightComponents: false, tabletSidebar: "right" });
	assert.deepEqual(
		Object.keys(edge.layoutVars),
		Object.keys(normal.layoutVars),
	);
	assert.equal(
		edge.layoutVars["--main-grid-cols-md"],
		"var(--main-grid-sidebar-width) 1fr",
	);
	assert.equal(edge.layoutVars["--main-grid-left-display-md"], "none");
	assert.equal(edge.layoutVars["--main-grid-left-display-xl"], "block");
	const oppositeEdge = resolve({
		hasLeftComponents: false,
		tabletSidebar: "left",
	});
	assert.equal(oppositeEdge.layoutVars["--main-grid-right-column-xl"], "3");
	assert.equal(edge.layoutVars["--main-grid-gap"], "1rem");
	assert.equal(edge.layoutVars["--main-grid-sidebar-width"], "17.5rem");
});
