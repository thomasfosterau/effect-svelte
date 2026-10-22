import * as Arr from "effect/Array";
import { mount, tick, unmount } from "svelte";

/** Mounts `component` into a fresh element; `cleanup` unmounts everything mounted so far. */
export const makeMounter = () => {
  const mounted: Array<{ component: Parameters<typeof unmount>[0]; target: HTMLElement }> = [];
  return {
    mount: <Props extends Record<string, any>>(
      component: Parameters<typeof mount<Props, any>>[0],
      props: Props,
    ) => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      const instance = mount(component, { target, props });
      mounted.push({ component: instance, target });
      return target;
    },
    cleanup: () => {
      Arr.forEach(mounted.splice(0), ({ component, target }) => {
        void unmount(component);
        target.remove();
      });
    },
  };
};

export const text = (target: HTMLElement, id: string): string | null =>
  target.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;

/** Flushes pending Svelte updates after the current macrotask. */
export const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};
