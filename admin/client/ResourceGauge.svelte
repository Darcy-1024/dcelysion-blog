<script lang="ts">
export let label: string;
export let value: number | null;
export let detail: string;
$: percent =
	value === null || !Number.isFinite(value)
		? null
		: Math.min(100, Math.max(0, value));
</script>
<div class="resource-card">
 <div class="gauge" class:high={percent !== null && percent >= 90}>
  <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="50"/><circle class="fill" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray={`${percent ?? 0} 100`}/></svg>
  <span><strong>{percent === null ? '—' : percent.toFixed(1)}</strong>{#if percent !== null}<small>%</small>{/if}</span>
 </div>
 <div class="copy"><h3>{label}</h3><p>{percent === null ? '等待有效采样' : '当前占用'}</p><small>{detail}</small></div>
</div>
<style>
.resource-card{display:flex;align-items:center;gap:20px;padding:24px;background:var(--surface-soft);border:1px solid var(--border);border-radius:18px;min-width:0}.gauge{position:relative;width:112px;height:112px;flex:0 0 112px;color:var(--accent)}.gauge.high{color:var(--danger)}svg{width:100%;height:100%;transform:rotate(-90deg)}circle{fill:none;stroke-width:8}.track{stroke:var(--border)}.fill{stroke:currentColor;stroke-linecap:round;transition:stroke-dasharray .6s ease}.gauge span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px;font-variant-numeric:tabular-nums}.gauge strong{font-size:25px;letter-spacing:-.04em}.gauge small{font-size:12px}.copy{min-width:0}.copy h3{margin:0;font-size:15px}.copy p{margin:6px 0 12px;color:var(--text-muted);font-size:12px}.copy small{color:var(--text-muted);font-size:12px;line-height:1.7;overflow-wrap:anywhere}@media(prefers-reduced-motion:reduce){.fill{transition:none}}@media(max-width:1100px){.resource-card{padding:18px;gap:14px}.gauge{width:90px;height:90px;flex-basis:90px}}
</style>
