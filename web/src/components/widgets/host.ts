// Finding widgets in rendered text, apart from their components, which are loaded only when a text has widgets.

export interface Part {
  name: string;
  attrs: Record<string, string>;
  /** The part as rendered by Typst, sub-parts included. */
  html: string;
  parts: Part[];
}

export interface WidgetHost {
  key: string;
  el: HTMLElement;
  kind: string;
  attrs: Record<string, string>;
  parts: Part[];
  /** What Typst wrote inside, for a kind this app does not know. */
  html: string;
}

/** The parts of rendered HTML that holds a widget's parts, e.g. a quiz card's front. */
export function partsOfHtml(html: string): Part[] {
  const el = document.createElement('div');
  el.innerHTML = html;
  return partsOf(el);
}

const dataOf = (el: HTMLElement): Record<string, string> => ({ ...el.dataset }) as Record<string, string>;

function partsOf(el: Element): Part[] {
  return [...el.children]
    .filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.part !== undefined)
    .map((c) => ({ name: c.dataset.part!, attrs: dataOf(c), html: c.innerHTML, parts: partsOf(c) }));
}

let counter = 0;
/** What was read from a host before it was emptied: effects may run twice on the same element. */
const taken = new WeakMap<HTMLElement, WidgetHost>();

/** Finds the outermost widgets of a rendered text and empties them, ready for their component. */
export function takeWidgets(root: HTMLElement): WidgetHost[] {
  // Outermost within this text: a widget inside a widget's part is left to that part's own Prose.
  const hosts = [...root.querySelectorAll<HTMLElement>('div[data-widget]')].filter((el) => {
    const outer = el.parentElement?.closest('[data-widget]');
    return !outer || !root.contains(outer);
  });
  return hosts.map((el) => {
    let host = taken.get(el);
    if (!host) {
      host = { key: `w${counter++}`, el, kind: el.dataset.widget!, attrs: dataOf(el), parts: partsOf(el), html: el.innerHTML };
      taken.set(el, host);
      el.replaceChildren();
    }
    return host;
  });
}
