import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-svelte/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // effectKit() must run before sveltekit() so that route exports written as
  // Effects (or functions returning Effects) are rewritten first.
  plugins: [effectKit(), sveltekit()],
});
