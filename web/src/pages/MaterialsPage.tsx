import type { Resource } from '@wb/shared';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { WorksLibrary } from '@/components/WorksLibrary';
import { DeleteDialog, EditDialog } from '@/components/ResourceDialogs';
import { Spinner } from '@/components/ui';
import { useOutline } from '@/lib/api';
import { isPdf, preloadPdf } from '@/lib/pdf';
import { useResources } from '@/lib/resources';

/**
 * The library: works and materials in one table. A workbook's materials are not a page of their own; the library
 * shows what is relevant to the open workbook first and offers "all" in its rail.
 */
export function LibraryPage() {
  const list = useResources(null);
  const activeCourse = useOutline().data?.id ?? null;
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const data = list.data;
  const anyPdf = !!data?.resources.some((r) => isPdf(r.file.filename));
  // Opening a PDF then finds pdf.js and its worker already loaded.
  useEffect(() => {
    if (anyPdf) preloadPdf();
  }, [anyPdf]);

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }

  const hasFiles = (e: DragEvent<HTMLElement>) => [...e.dataTransfer.types].includes('Files');
  const drop = (e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    // Folders are ignored; only plain files are taken.
    const items = [...e.dataTransfer.items];
    const files = [...e.dataTransfer.files].filter((_, i) => !items[i]?.webkitGetAsEntry?.()?.isDirectory);
    if (files.length) setDropped(files);
  };
  return (
    <div
      className={`settle flex h-full flex-col ${dragging ? 'outline outline-2 -outline-offset-4 outline-accent' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={drop}
    >
      <WorksLibrary
        resources={data.resources}
        courses={data.courses}
        series={data.series}
        activeCourse={activeCourse}
        dropped={dropped}
        onDroppedUsed={() => setDropped(null)}
        onEditResource={setEditing}
        onDeleteResource={setDeleting}
      />
      <EditDialog resource={editing} onClose={() => setEditing(null)} courses={data.courses} series={data.series} />
      <DeleteDialog resource={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
