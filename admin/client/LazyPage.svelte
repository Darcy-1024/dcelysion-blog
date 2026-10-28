<script lang="ts" generics="T">
import { connectionMessage } from "./i18n.js";

export let loader: () => Promise<T>;
let pending = loader();
</script>

{#await pending}
 <p class="feedback" role="status">正在加载…</p>
{:then value}
 <slot {value} />
{:catch}
 <div class="feedback error" role="alert"><p>{connectionMessage()}</p><button onclick={() => pending = loader()}>重试</button></div>
{/await}
