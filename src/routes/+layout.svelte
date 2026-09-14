<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { t } from '$lib/i18n/ui.svelte';
	import ContextMenuHost from '$lib/ui/ContextMenuHost.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>vk-sc-import</title>
	<meta name="description" content={t('meta.description')} />
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<ContextMenuHost />
