export const words = {
	overview: "概览",
	analytics: "访问分析",
	today: "今日",
	"7d": "近7天",
	"30d": "近30天",
	custom: "自定义",
	refresh: "刷新 / 重试",
	loading: "正在加载…",
	source: "数据源",
	timezone: "北京时间 · Asia/Shanghai",
	empty: "所选区间没有事件",
	states: {
		not_configured: "未配置",
		success: "当前数据",
		partial: "部分可用",
		stale: "陈旧数据",
		error: "不可用",
	},
	reasons: {
		NOT_CONFIGURED: "请在后台服务端配置 ADMIN_UMAMI_API_KEY 后重启。",
		RATE_LIMIT: "上游或本地配额限制，请稍后重试。",
		CREDENTIALS: "Cloud API key 无效或没有本站权限，请检查服务端配置。",
		TIMEOUT: "上游请求超时。",
		UPSTREAM: "上游服务暂时不可用。",
		RESPONSE: "上游响应不符合已核对的 Cloud 契约。",
		DISK_UNAVAILABLE: "当前平台无法读取内容目录所在文件系统容量。",
		CONTENT_UNAVAILABLE: "仓库内容读取失败。",
		DRAFTS_UNAVAILABLE: "私有草稿汇总读取失败。",
		JOBS_UNAVAILABLE: "持久化发布任务读取失败。",
		COMMENTS_UNAVAILABLE: "Waline 汇总不可用，请检查评论页或重新登录。",
		HOST_UNAVAILABLE: "主机采样不可用。",
	},
	pageviews: "PV · 浏览量",
	visitors: "UV · 区间独立访客",
	visits: "访问次数 · visits",
	path: "热门页面 · PV",
	referrer: "来源 · PV",
	device: "设备 · 独立访客",
	browser: "浏览器 · 独立访客",
	country: "国家 · 独立访客",
	region: "地区 · 独立访客",
	new: "新增（前期为0）",
	no_comparison: "无可比增长率（前期为0）",
	missing: "缺少可比数据",
	unknown: "（空值 / 直接访问）",
};
export function reason(code: string | null) {
	return code
		? words.reasons[code as keyof typeof words.reasons] || "数据源不可用。"
		: "";
}
export function time(value: string | number | null) {
	return value === null
		? "—"
		: new Date(value).toLocaleString("zh-CN", {
				timeZone: "Asia/Shanghai",
				hour12: false,
			});
}
export function bytes(value: number) {
	return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}
