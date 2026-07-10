// Twikoo 反向代理 Worker
// 部署后绑 twikoo.blog.dcelysion.cn，替代 Vercel 直连
export default {
	async fetch(request) {
		const url = new URL(request.url);
		const upstream = "https://twikoo-nu-dun.vercel.app";
		const target = upstream + url.pathname + url.search;

		const proxyReq = new Request(target, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		return fetch(proxyReq);
	},
};
