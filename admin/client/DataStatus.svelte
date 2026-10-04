<script lang="ts">
import type { Section } from "../shared/analytics.js";
import { reason, time, words } from "./analytics-words.js";
export let section: Section<unknown>;
</script>
<p class="data-status" class:error={section.state==='error'}><strong>{words.states[section.state]}</strong>{#if section.sampledAt} · 采集 {time(section.sampledAt)}{/if}{#if section.reason}<span>{reason(section.reason)}</span>{/if}</p>
{#if section.state==='stale' && section.interval}<p class="data-status">陈旧数据实际区间：{time(section.interval.startAt)} — {time(section.interval.endAt)}</p>{/if}
