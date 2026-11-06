<script lang="ts">
  import { onMount } from 'svelte';
  import { UndoToast } from '@stash/ui';
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
</style>
