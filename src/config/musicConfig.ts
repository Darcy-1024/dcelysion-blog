import type { MusicPlayerConfig } from "../types/musicConfig";

const musicAssetBaseUrl = "https://music.dcelysion.cn";

// 音乐播放器配置
export const musicPlayerConfig: MusicPlayerConfig = {
	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件
	showInSidebar: true,

	// 使用方式："meting" 使用 Meting API，"local" 使用本地音乐列表
	mode: "local",

	// 默认音量 (0-1)
	volume: 0.7,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode: "list",

	// 是否显启用歌词
	showLyrics: false,

	// Meting API 配置
	meting: {
		// Meting API 地址
		// 默认使用官方 API，也可以使用自定义 API
		api: "https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r",
		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
		server: "netease",
		// 类型：song=单曲, playlist=歌单, album=专辑, search=搜索, artist=艺术家
		type: "playlist",
		// 歌单/专辑/单曲 ID 或搜索关键词
		id: "10046455237",
		// 认证 token（可选）
		auth: "",
		// 备用 API 配置（当主 API 失败时使用）
		fallbackApis: [
			"https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
			"https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
		],
	},

	// 本地音乐配置（当 mode 为 "local" 时使用，支持 public 相对路径或 HTTPS 媒体地址）
	// 1. 支持传入歌词文件的路径
	// lrc: "/assets/music/lrc/使一颗心免于哀伤-哼唱.lrc",
	// 2. 或者直接填入歌词字符串内容
	// lrc: "[00:00.00]歌词内容...",
	local: {
		playlist: [
			{
				name: "羽根",
				artist: " 折戸伸治/Key ",
				url: `${musicAssetBaseUrl}/tracks/hane-orito-shinji-e71fba63.flac`,
				cover: `${musicAssetBaseUrl}/covers/hane-c245b3c0.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "東方萃夢想",
				artist: "TAMUSIC",
				url: `${musicAssetBaseUrl}/tracks/touhou-suimusou-e4b51d8c.flac`,
				cover: `${musicAssetBaseUrl}/covers/touhou-suimusou-c104f7fe.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "久遠寺有珠",
				artist: "深澤秀行",
				url: `${musicAssetBaseUrl}/tracks/kuonji-alice-0fc05b19.flac`,
				cover: `${musicAssetBaseUrl}/covers/mahoutsukai-no-yoru-82612496.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "魔法使いの夜～メインテーマ",
				artist: "深澤秀行",
				url: `${musicAssetBaseUrl}/tracks/mahoutsukai-no-yoru-main-theme-45a711f2.flac`,
				cover: `${musicAssetBaseUrl}/covers/mahoutsukai-no-yoru-82612496.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "午後の眠り",
				artist: "深澤秀行",
				url: `${musicAssetBaseUrl}/tracks/gogo-no-nemuri-07546e54.flac`,
				cover: `${musicAssetBaseUrl}/covers/mahoutsukai-no-yoru-82612496.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "nostalgia",
				artist: "深澤秀行",
				url: `${musicAssetBaseUrl}/tracks/nostalgia-9f3f9ece.flac`,
				cover: `${musicAssetBaseUrl}/covers/mahoutsukai-no-yoru-82612496.avif`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "孤独な巡礼",
				artist: "川井憲次",
				url: `${musicAssetBaseUrl}/tracks/kodoku-na-junrei-cd1f6101.flac`,
				cover: `${musicAssetBaseUrl}/covers/kodoku-na-junrei-6bd1e927.jpg`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "夜诞的花冠 Night's Crown of Flowers",
				artist: "HOYO-MiX",
				url: `${musicAssetBaseUrl}/tracks/nights-crown-of-flowers-2afdb40b.flac`,
				cover: `${musicAssetBaseUrl}/covers/nights-crown-of-flowers-e6d348b6.webp`,
				lrc: "[00:00.00]纯音乐",
			},
			{
				name: "Kanon D-dur",
				artist: "Württembergisches Kammerorch.",
				url: `${musicAssetBaseUrl}/tracks/kanon-d-dur-0cc64a56.flac`,
				cover: `${musicAssetBaseUrl}/covers/kanon-eeb5186e.avif`,
				lrc: "[00:00.00]纯音乐",
			},
		],
	},
};
