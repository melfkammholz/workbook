# References

A workbook keeps the works its texts cite in one place, at its root: `references.bib` (BibTeX) and/or `references.yml`
([Hayagriva](https://github.com/typst/hayagriva), the format Typst uses). Both are read; a key may appear only once.
Needed fields are `title` and `year`; `author`, a venue (`journal`, `booktitle`, `publisher`), `doi` and `url` are used
when present.

```bibtex
@inproceedings{stam1999,
  title     = {Stable Fluids},
  author    = {Stam, Jos},
  booktitle = {Proceedings of SIGGRAPH 99},
  year      = {1999},
  doi       = {10.1145/311535.311548}
}
```

In a text, cite a work by its key and say in your own words what to take from it:

```typst
#cite-work("stam1999")[Take from it: the solver this chapter builds. Read §3 first.]
```

Write the words only; title, authors, year and venue come from the file, so they are never typed twice. Notes such as
"verified in the paper" belong in the words. Without words (`#cite-work("stam1999")[]`) only the entry shows.

**What students see:** the entry looks like an entry in their library, with your words under it. When a page opens,
the cited works enter the student's library (matched by DOI, else by title and year, so a work they already have is
not doubled; the library notes on which pages it is cited), and the entry offers *Open* when they have the work as
material.

`lint` reports unknown keys in `#cite-work` and duplicate keys as errors, a missing title or year, a work cited
nowhere, and the same work under two keys as warnings.
