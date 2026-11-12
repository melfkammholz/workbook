import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { useT } from "@/lib/i18n";
import { clsx } from "./ui";

const key = (id: string) => `wb-fold-${id}`;

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/** A section of a side column with a heading that folds it. Open or closed is remembered per browser. */
export function FoldSection({
  id,
  title,
  defaultOpen = false,
  actions,
  className,
  sectionRef,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key(id), open ? "0" : "1");
    } catch {
      /* only a convenience */
    }
  };
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section
      ref={sectionRef}
      aria-label={title}
      className={clsx("mt-4 border-t border-line pt-3", className)}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={t.pdfSectionToggle(title)}
          className="-ml-1 mr-auto flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-sunk"
        >
          <Chevron size={14} className="shrink-0 text-ink-3" />
          <h3 className="truncate text-[13px] font-semibold text-ink-2">
            {title}
          </h3>
        </button>
        {open ? actions : null}
      </div>
      {open ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}
