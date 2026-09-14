<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>vk-sc-import</title>
	<meta
		name="description"
		content="Local catalog match from a VK likes Source Library into a SoundCloud Import Playlist."
	/>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
