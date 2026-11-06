<script lang="ts">
  import { onMount } from 'svelte';
  import { IconButton, UndoToast } from '@stash/ui';
  import { provideApp, type AppState } from './lib/app.svelte';
  import { readSharedParam } from './share';
  import Categories from './screens/Categories.svelte';
  import Home from './screens/Home.svelte';
  import Login from './screens/Login.svelte';
  import Reading from './screens/Reading.svelte';
  import Recover from './screens/Recover.svelte';
  import RecoveryCode from './screens/RecoveryCode.svelte';
  import Register from './screens/Register.svelte';
  import SaveFlow from './screens/SaveFlow.svelte';
  import Search from './screens/Search.svelte';
  import Settings from './screens/Settings.svelte';
  import Tags from './screens/Tags.svelte';

  interface Props {
    app: AppState;
  }

  let { app }: Props = $props();
  // The state object is created once by the caller and never replaced.
  // svelte-ignore state_referenced_locally
  provideApp(app);

  const route = $derived(app.router.route);
  const signedOutRoutes = ['login', 'register', 'recover'];

  onMount(() => {
    // A link from the Android share sheet: take it once, then clean the address
    // so a reload or Back does not save it again.
    const shared = readSharedParam(location.search);
    if (location.search) history.replaceState(history.state, '', `/${location.hash}`);
    void app.start().then(() => {
      if (shared) void app.saveShared(shared);
    });
  });

  $effect(() => {
    if (!app.ready || app.recoveryCode) return;
    if (!app.session && !signedOutRoutes.includes(route.name)) {
      app.router.replace({ name: 'login' });
    } else if (app.session && signedOutRoutes.includes(route.name)) {
      app.router.replace({ name: 'pending' });
    }
  });
</script>

<div class="shell">
  {#if !app.ready}
    <!-- The session check is local and fast: nothing to show yet. -->
  {:else if app.recoveryCode}
    <RecoveryCode />
  {:else if !app.session}
    {#if route.name === 'register'}
      <Register />
    {:else if route.name === 'recover'}
      <Recover />
    {:else}
      <Login />
    {/if}
  {:else}
    {#if route.name === 'item'}
      {#key route.id}<Reading id={route.id} />{/key}
    {:else if route.name === 'search'}
      <Search />
    {:else if route.name === 'categories'}
      <Categories />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'tags'}
      <Tags />
    {:else}
      <Home />
    {/if}
    <SaveFlow />
    {#if app.failure}
      <div class="failure" role="alert">
        <p>{app.failure}</p>
        <IconButton icon="close" label="Cerrar aviso" onclick={() => app.dismissFailure()} />
      </div>
    {/if}
    <UndoToast toast={app.toast} onundo={(id) => app.undo(id)} onexpire={(id) => app.expire(id)} />
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 640px;
    margin: 0 auto;
    background: var(--bg);
  }
  .failure {
    position: fixed;
    right: 12px;
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
    left: 12px;
    z-index: 20;
    display: flex;
    gap: 8px;
    align-items: center;
    max-width: 616px;
    margin: 0 auto;
    padding: 4px 4px 4px 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-block);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--fs-help);
  }
  .failure p {
    flex: 1;
    margin: 0;
  }
</style>
