---
"@thomasfosterau/effect-svelte": minor
---

`SignalEmitter` now buffers and multicasts, backed by a `PubSub`. Values emitted while no run of `emitter.stream` is connected are buffered and delivered first to the next run that connects, so the initial `emit` from a `$effect` (which usually runs before `useStream`'s run has connected) is no longer lost. Every run connected at once receives every value emitted while it is connected, where previously only the most recently started run did. The buffer keeps the most recent 16 values by default; the new `SignalEmitterOptions` (`new SignalEmitter({ bufferSize })`) changes that, and `bufferSize: 0` restores the old behaviour of dropping values emitted while no run is connected. Buffered values go only to the run that takes them: a run that connects while another is already connected starts with the next emitted value.
