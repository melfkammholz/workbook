# The text of an exercise

An exercise file is ordinary Typst. Write the task, and add the extras:

```typst
Implementiere die Funktion `power`. Es gilt $x^n = (x^(n/2))^2$ für gerades $n$.

```haskell
power :: Num a => a -> Integer -> a
```

#hint[Wie viele Multiplikationen braucht $x^8$, wenn du immer quadrierst?]
#hint[Zweiter Hinweis, erst nach dem ersten sichtbar.]

#remark[Komisches Bild, Zusatzkontext oder ein Link für Interessierte.]

Siehe auch #xref("symbolic-differentiation").
```

| Helper | Effect |
| --- | --- |
| `#hint[…]` | Revealed one by one, in order. Students' use of hints is recorded. |
| `#remark[…]` | An aside from you: context, a meme, resources. Shown below the task. |
| `#xref("id")` | Link to another exercise; its title is filled in (and stays current if renamed). Also counts as "builds on". |
| `#sample[…]` | A sample answer to a text question. Optional. Students open it from the menu above their answer, and it only reaches their browser then. Search leaves it out. |
| `#draft-note[…]` | A note to yourself. Never reaches students. |
| `#check[…]`, `#refs[…]` | Highlighted boxes inline in the text. `#refs` is deprecated: cite works with `#cite-work` (see References); `lint` warns. |
| `#diagram[…]` | Draws anything (shapes, `cetz`) as a picture. |
| `#note[…]` | A note or a source. The text shows a small number with the note in a card on hover; all notes gather at the end under “Sources and notes”. |
| `#remark(quote(block: true, attribution: […])[…])` | A quote: a remark that starts with a quote is shown as one, the source quietly beneath. |

Inline code and blocks that name no language are highlighted in the language of what they belong to: the exercise's `code`, otherwise the chapter's `scratch`, or the thread's `language` on an adventure page. Name another language where it differs (```` ```haskell (++)``` ````), use `text` for what is not code (```` ```text RegExp.hs``` ````, program output), or start a file with `#set raw(lang: "python")` to change it for the whole file.

Code in ```` ```haskell ```` blocks is highlighted by the app, and gets a copy button. This works for all
common languages, among them `python`, `java`, `c`, `cpp`, `javascript`, `typescript`, `rust`, `go`, `sql`, `bash`,
`prolog`, `ocaml`, `scala`, `kotlin`, `ruby`, `json`, `yaml` and `html`.

## What works in Typst's HTML export

The workbook renders Typst to HTML (so text reflows, can be selected, and follows
the dark theme). Typst's HTML export is still young and **silently drops** some
elements together with their content. The workbook re-implements the common
ones, so these are safe to use: `columns`/`colbreak`, `align`, `grid`, `stack`,
`pad`, `h`, `v`, `line`, `place`, `rect`, `circle`, `ellipse`, `square`,
`polygon`, `curve`, `move`, `rotate`, `scale`, and colored `#text(fill: …)`.
Shapes, `rotate` and friends become pictures (SVG), so their text is not selectable.

A `cetz` canvas works as it is, and a `box` or `block` with a size, fill or stroke becomes a picture too:

```typst
#import "@preview/cetz:0.5.3"

#align(center, cetz.canvas({
  import cetz.draw: *
  circle((0, 0), radius: 1)
}))
```

For anything else that draws and comes out in pieces, wrap it in `#diagram(…)`, which turns all of it into one picture.

Typst packages are downloaded on first use (the container needs internet then) and cached in the data volume. Workbook text is rendered with Typst's HTML export, which drops what is laid out like a page: put the output of drawing packages (cetz, fletcher, lovelace, …) inside `#diagram[…]`, which draws it as a picture. fletcher exports a `diagram` of its own, so import it with `as fletcher`. (Students' own notes, answers and cards fall back to a picture automatically when something would be lost; workbook text does not, so a missing `#diagram` shows up as a warning in `lint --render`.)

**Editor:** for writing a workbook, [Tinymist](https://github.com/Myriad-Dreamin/tinymist) in VS Code (or another editor) gives completion, hover docs and errors on the workbook repository as it is. Open the repository folder; `prelude.typ` and the workbook helpers are not in it, so Tinymist will mark `#hint`, `#remark` and friends as unknown, which is expected. `lint` is still what checks a workbook the way the app renders it.
Run `lint --render` to see Typst warnings such as "… was ignored during HTML export".

Not supported: page-level things (`#set page`, headers, page breaks), `image` sizing beyond what the browser does.
