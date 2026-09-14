<script lang="ts">
	/**
	 * Single floating context menu host for the app.
	 * Mount once from the root layout. Positioning uses viewport collision.
	 */
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/i18n/ui.svelte';
	import { positionMenu } from './context-menu-position';
	import type { ContextMenuItem } from './context-menu-types';
	import {
		closeContextMenu,
		getContextMenuOpenGeneration,
		getContextMenuSession,
		selectContextMenuItem
	} from './context-menu.svelte';

	let menuEl = $state<HTMLDivElement | null>(null);
	let left = $state(0);
	let top = $state(0);
	let activeIndex = $state(0);

	const session = $derived(getContextMenuSession());
	const generation = $derived(getContextMenuOpenGeneration());

	const items = $derived(
		(session?.entries.filter((entry) => entry.type === 'item') ?? []) as ContextMenuItem[]
	);

	$effect(() => {
		if (!session) {
			return;
		}
		// Re-run when a new open generation arrives.
		void generation;
		void tick().then(() => {
			place();
			focusActive();
		});
	});

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!session || !menuEl) {
				return;
			}
			if (event.target instanceof Node && menuEl.contains(event.target)) {
				return;
			}
			closeContextMenu();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!session) {
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				closeContextMenu();
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				moveActive(1);
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				moveActive(-1);
				return;
			}
			if (event.key === 'Home') {
				event.preventDefault();
				activeIndex = firstEnabledIndex(1) ?? 0;
				focusActive();
				return;
			}
			if (event.key === 'End') {
				event.preventDefault();
				activeIndex = firstEnabledIndex(-1) ?? Math.max(0, items.length - 1);
				focusActive();
				return;
			}
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				const item = items[activeIndex];
				if (item && !item.disabled) {
					selectContextMenuItem(item.id);
				}
			}
		};

		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('keydown', onKeyDown, true);
		};
	});

	function place() {
		if (!session || !menuEl) {
			return;
		}
		const rect = menuEl.getBoundingClientRect();
		const placed = positionMenu({
			pointer: { x: session.clientX, y: session.clientY },
			menu: { width: rect.width, height: rect.height },
			viewport: { width: window.innerWidth, height: window.innerHeight }
		});
		left = placed.left;
		top = placed.top;
		activeIndex = firstEnabledIndex(1) ?? 0;
	}

	function moveActive(delta: number) {
		if (items.length === 0) {
			return;
		}
		let next = activeIndex;
		for (let i = 0; i < items.length; i++) {
			next = (next + delta + items.length) % items.length;
			if (!items[next]?.disabled) {
				activeIndex = next;
				focusActive();
				return;
			}
		}
	}

	function firstEnabledIndex(direction: 1 | -1): number | null {
		if (direction === 1) {
			const index = items.findIndex((item) => !item.disabled);
			return index >= 0 ? index : null;
		}
		for (let i = items.length - 1; i >= 0; i--) {
			if (!items[i]?.disabled) {
				return i;
			}
		}
		return null;
	}

	function focusActive() {
		const button = menuEl?.querySelectorAll<HTMLButtonElement>('[data-menu-item]')[activeIndex];
		button?.focus();
	}

	function onItemClick(id: string) {
		selectContextMenuItem(id);
	}
</script>

{#if session}
	<div
		bind:this={menuEl}
		class="ui-menu"
		style:left="{left}px"
		style:top="{top}px"
		role="menu"
		aria-label={t('menu.ariaLabel')}
		tabindex="-1"
	>
		{#each session.entries as entry, index (entry.type === 'item' ? entry.id : `sep-${index}`)}
			{#if entry.type === 'separator'}
				<div class="ui-menu-separator" role="separator"></div>
			{:else}
				<button
					type="button"
					class="ui-menu-item"
					class:ui-menu-item-danger={entry.danger}
					class:ui-menu-item-active={items[activeIndex]?.id === entry.id}
					role="menuitem"
					data-menu-item
					disabled={entry.disabled}
					onclick={() => onItemClick(entry.id)}
					onmouseenter={() => {
						const itemIndex = items.findIndex((item) => item.id === entry.id);
						if (itemIndex >= 0 && !entry.disabled) {
							activeIndex = itemIndex;
						}
					}}
				>
					<span class="ui-menu-item-label">{entry.label}</span>
					{#if entry.shortcut}
						<span class="ui-menu-item-shortcut">{entry.shortcut}</span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}
