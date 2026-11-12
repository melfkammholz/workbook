/**
 * Runs `f` once the next frame has been painted: for work a page starts when it opens (requests, mostly) that the
 * first frame does not need. Starting a `fetch` takes a few milliseconds, which would otherwise delay that frame.
 * Returns a function that calls it off, for an effect's cleanup.
 */
export function afterPaint(f: () => void): () => void {
  let timer = 0;
  const frame = requestAnimationFrame(() => {
    timer = window.setTimeout(f, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
