import { use, type ComponentType } from 'react';

/**
 * Like `React.lazy`, but once the module is loaded (by `preload` or an earlier render) the component renders at once.
 * `React.lazy` suspends on its first render even then, and React keeps a fallback up for about 300 ms, so every first
 * visit to a page would wait that long. Rendered before it is loaded, it suspends like `React.lazy`.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<void> } {
  let Loaded: ComponentType<P> | null = null;
  let loading: Promise<void> | null = null;
  const preload = () => {
    loading ??= load().then(
      (c) => {
        Loaded = c;
      },
      (e: unknown) => {
        // The next render or preload tries again.
        loading = null;
        throw e;
      },
    );
    return loading;
  };
  function Lazy(props: P) {
    if (!Loaded) use(preload());
    const C = Loaded!;
    return <C {...props} />;
  }
  return Object.assign(Lazy, { preload });
}
