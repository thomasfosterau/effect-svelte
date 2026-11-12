import * as Arr from "effect/Array";
import * as Option from "effect/Option";
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

/** The trimmed text of the element with this `data-testid`: `None` when it is not rendered. */
export const text = (target: HTMLElement, id: string): Option.Option<string> =>
  Option.fromNullishOr(target.querySelector(`[data-testid="${id}"]`)).pipe(
    Option.flatMap((element) => Option.fromNullishOr(element.textContent)),
    Option.map((content) => content.trim()),
  );

/** Flushes pending Svelte updates after the current macrotask. */
export const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};
