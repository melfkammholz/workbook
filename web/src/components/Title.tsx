/**
 * A title in which `backticks` mark code, as in the course text: shown in the code font, without highlighting,
 * since a title is not a program. `plainTitle` is the same title as text, for window titles and labels.
 */
export function Title({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="wb-title-code">
            {p}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

export const plainTitle = (text: string) => text.replace(/`([^`]+)`/g, '$1');
