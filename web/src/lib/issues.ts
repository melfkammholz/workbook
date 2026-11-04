const clean = (path: string) => path.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/(-\/)?issues(\/new)?$/, '');

/**
 * A link that opens a new issue with the exercise filled in. Works out the address from
 * the course's repository, unless the author set one. Never contains the student's work.
 */
export function issueLink(explicit: string | null, repository: string | null, title: string, body: string): string | null {
  const source = explicit ?? repository;
  if (!source) return null;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const path = clean(url.pathname);
  const params = (a: string, b: string) => `${a}=${encodeURIComponent(title)}&${b}=${encodeURIComponent(body)}`;
  if (url.hostname === 'github.com') return `${url.origin}${path}/issues/new?${params('title', 'body')}`;
  if (url.hostname.includes('gitlab')) return `${url.origin}${path}/-/issues/new?${params('issue[title]', 'issue[description]')}`;
  // Anywhere else we do not know how to fill it in, but the author's address still works.
  return explicit;
}
