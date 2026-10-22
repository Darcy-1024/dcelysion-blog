<script lang="ts">
import { onMount } from "svelte";
import { type Configuration, protectedAsset } from "../shared/configuration.js";
export let kind: "music" | "gallery";
export let busy = false;
export let onedit: () => void;
export let onexpired: () => void;
let data: Configuration | null = null;
let error = "";
async function load() {
	error = "";
	try {
		const r = await fetch(`/api/configuration/current?kind=${kind}`, {
			cache: "no-store",
			credentials: "same-origin",
		});
		if (r.status === 401) onexpired();
		const result = await r.json();
		if (!r.ok || !result.ok) throw Error("当前内容暂时无法读取");
		data = result.data;
	} catch (e) {
		error = (e as Error).message;
	}
}
onMount(() => {
	void load();
});
</script>
<section class="panel current">
<div class="heading"><div><h2>当前{kind==='music'?'歌单':'相册'}</h2><p class="muted">来自后台当前仓库配置 · 编辑时创建私有副本</p></div><button class="primary" disabled={!data||busy} onclick={onedit}>{busy?'正在创建…':kind==='music'?'编辑歌单':'编辑相册'}</button></div>
{#if error}<p role="alert">{error}</p><button onclick={()=>void load()}>重新读取</button>{:else if !data}<p role="status">正在读取当前内容…</p>
{:else if kind==='music'}
<div class="tracks">{#each data.tracks||[] as track,index}<article><small>{String(index+1).padStart(2,'0')}</small>{#if track.cover}<img src={protectedAsset(track.cover)} alt="" loading="lazy"/>{/if}<div><strong>{track.name}</strong><p class="muted">{track.artist||'未知歌手'}</p></div><audio controls preload="none" src={protectedAsset(track.url)} aria-label={'试听 '+track.name}></audio></article>{:else}<p>当前歌单暂无歌曲。</p>{/each}</div>
{:else}
<div class="albums">{#each data.albums||[] as album}{@const cover=album.cover||album.photos?.[0]?.preview||album.photos?.[0]?.original}<article>{#if cover}<img src={protectedAsset(cover)} alt={album.name} loading="lazy"/>{/if}<div><h3>{album.name}</h3><p class="muted">{album.description||''}</p><small>{album.date||''} · {album.photos?album.photos.length+' 张照片':'目录图片来源'}</small><details><summary>查看照片</summary><div class="photos">{#each album.photos||[] as photo}<img src={protectedAsset(photo.preview||photo.original)} alt="相册照片" loading="lazy"/>{/each}</div></details></div></article>{:else}<p>当前暂无相册。</p>{/each}</div>
{/if}</section>
<style>
.current{padding:24px}h2{margin:0;font-size:20px}.heading p{font-size:12px}.tracks article{display:flex;align-items:center;gap:16px;padding:18px 0;border-top:1px solid var(--border)}.tracks img{width:56px;height:56px;object-fit:cover;border-radius:10px}.tracks article>div{flex:1}.tracks p{font-size:12px;margin:6px 0}.tracks audio{max-width:100%;height:36px}small{color:var(--text-muted)}.albums{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}.albums article{border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface-soft)}.albums article>img{width:100%;height:180px;object-fit:cover}.albums article>div{padding:20px}h3{margin:0}.albums details{margin-top:16px}.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px}@media(max-width:700px){.tracks article{flex-wrap:wrap}.tracks audio{width:100%}}
</style>
