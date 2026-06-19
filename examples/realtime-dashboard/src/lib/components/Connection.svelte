<script lang="ts">
  import { Effect, Scope } from "effect";
  import {
    AsyncResult,
    useEffect,
    useScope,
    useScopeCallback,
  } from "@thomasfosterau/effect-svelte";

  let { onEvent }: { onEvent: (message: string) => void } = $props();

  // The component-lifecycle scope: created on mount, closed on unmount.
  const scope = useScope();

  // A "connection" acquired in a scope tied to this component's lifecycle:
  // the release runs automatically when the component unmounts (toggle the
  // "Mounted" checkbox in the parent to see it).
  useScopeCallback((lifecycleScope) => {
    const connection = Effect.acquireRelease(
      Effect.sync(() => {
        const id = Math.random().toString(36).slice(2, 8);
        onEvent(`connection ${id} opened`);
        return id;
      }),
      (id) => Effect.sync(() => onEvent(`connection ${id} closed`))
    );
    Effect.runFork(Scope.provide(connection, lifecycleScope));
  });

  // A slow ping that can be started manually and interrupted mid-flight.
  const ping = useEffect(
    Effect.gen(function* () {
      yield* Effect.sleep("3 seconds");
      return Date.now();
    })
  );

  // Capture `.current` into a $derived local so the guards below narrow it.
  const pingResult = $derived(ping.current);
</script>

<div>
  <p class="muted">Lifecycle scope: {scope.current ? "open" : "not created yet"}</p>

  <div class="row">
    <button
      class="secondary"
      onclick={() => ping.run()}
      disabled={AsyncResult.isWaiting(pingResult)}
    >
      {AsyncResult.isWaiting(pingResult) ? "Pinging… (3s)" : "Ping"}
    </button>
    {#if AsyncResult.isWaiting(pingResult)}
      <button class="secondary" onclick={() => ping.interrupt()}>Interrupt</button>
    {/if}
  </div>

  {#if AsyncResult.isSuccess(pingResult)}
    <p>Pong at {new Date(pingResult.value).toLocaleTimeString()}</p>
  {/if}
</div>
