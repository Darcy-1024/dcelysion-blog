/**
 * 沉浸阅读（Immersive Reading）配置（挂在 siteConfig.post 下）
 */
export interface ImmersiveReadingConfig {
	/** 总开关，false 则不渲染沉浸按钮与文章阅读轨 */
	enable: boolean;
	/** 没有已保存的用户偏好时，进入文章页是否默认开启沉浸阅读 */
	defaultOn: boolean;
	/** 沉浸阅读中是否显示目录栏 */
	tocEnabled: boolean;
	/** 目录栏位置："left" | "right" */
	tocPosition: "left" | "right";
}
