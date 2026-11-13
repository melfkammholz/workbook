/** A tag the student made: global, typed anywhere. `color` is optional ('' for none). */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

/** What a tag can be put on; `ref` is the id of that thing. */
export const TAG_KINDS = ['question', 'resource', 'pdfPage', 'highlight', 'pdfHighlight', 'work'] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export const MAX_TAGS = 500;
export const MAX_TAGS_ON_ONE = 50;
