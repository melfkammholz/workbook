// Workbook prelude.
//
// Imported automatically into every exercise, info page and student note.
// Everything here renders to semantic HTML (Typst HTML export), so the
// browser can select text, reflow, and re-theme it. The marker elements
// (`data-wb`) are picked up by the server to split an exercise into task,
// remarks and hints.

#let _marker(kind, body) = html.elem("aside", attrs: (data-wb: kind), body)

/// A remark about the exercise: context, resources, memes, ...
#let remark(body) = _marker("remark", body)

/// A hint. Hints are revealed one by one, in the order they appear.
#let hint(body) = _marker("hint", body)

/// A note for authors. Only visible in author mode.
#let draft-note(body) = _marker("draft", body)

// A sample answer to a text question. Students only see it when they ask for it.
#let sample(body) = _marker("sample", body)

// One question of a checklist. Students rate themselves on it and can add a note.
#let question(body) = _marker("question", body)

/// "Selbstevaluation" / self-check box, rendered inline.
#let check(body) = html.elem("aside", attrs: (class: "wb-callout wb-callout-check"), body)

/// A box of references / further reading, rendered inline.
#let refs(body) = html.elem("aside", attrs: (class: "wb-callout wb-callout-refs"), body)

/// A footnote (the PDF-oriented workbook sources call it `note`).
#let note = footnote

/// Link to another exercise or page by its id. Without a body, the target's
/// title is filled in by the server.
#let xref(id, body: none) = html.elem(
  "a",
  attrs: (class: "wb-xref", data-xref: id, href: "#/item/" + id),
  if body == none { [] } else { body },
)

// ───────────────────────── layout shims ─────────────────────────
//
// Typst's HTML export does not lay out a number of elements: it drops them
// *together with their content* and only prints a warning. The PDF-oriented
// course sources use many of them, so the elements below are re-implemented
// with plain HTML/CSS. Anything not listed here is either supported natively
// by the HTML export or not meaningful on a web page.

/// A Typst length (or ratio) as a CSS length.
#let _css(x) = if x == none { "0" } else { "calc(" + repr(x) + ")" }

#let _align-css(a) = {
  let x = if a == none { none } else { a.x }
  if x == center { "text-align: center" } else if x == right { "text-align: right" } else { "text-align: left" }
}

#let _columns-of(c) = if type(c) == int { c } else if type(c) == array { c.len() } else { 1 }

/// Pictures in students' text look like the app around them: its fonts (shipped
/// with the app), and black, which the server turns into the theme's text colour.
#let _app-look(body) = {
  set text(font: ("Schibsted Grotesk", "Libertinus Serif"), size: 10.5pt)
  show raw: set text(font: ("Fira Code", "DejaVu Sans Mono"))
  show math.equation: set text(font: ("STIX Two Math", "New Computer Modern Math"))
  body
}

/// A student's whole text as one picture, laid out as on a page. The fallback for
/// text that HTML export cannot express, e.g. what a package draws.
/// A picture laid out on a page as wide as the place it is shown in, so it is never
/// scaled: the browser sends that width (`--input wb-width=<pt>`), and asks again on resize.
/// Measuring the content instead is not reliable: packages with flexible columns measure too narrow.
#let _page-width(default) = {
  let w = sys.inputs.at("wb-width", default: none)
  if w == none { default } else { float(w) * 1pt }
}

#let _picture(default, body) = html.frame(block(width: _page-width(default), _app-look(body)))

#let _as-picture(body) = html.elem("div", attrs: (class: "wb-as-picture"), _picture(12cm, body))

/// Draw anything (shapes, `cetz` canvases, ...) as an SVG picture. Inside the
/// picture the normal Typst layout applies, so every drawing package works.
#let diagram(body) = html.elem("div", attrs: (class: "wb-diagram"), html.frame(body))

// Inside a picture Typst's normal layout applies, so the rules below step aside
// there. Otherwise a drawing package would lose its positions and spacing.
#let _in-html(it, html-version) = context if target() == "html" { html-version() } else { it }

#let _in-math = state("wb-in-math", false)

/// Applied to every document.
#let workbook(body) = {
  show columns: it => _in-html(it, () => html.elem("div", attrs: (class: "wb-columns", style: "column-count: " + str(it.count)), it.body))
  show colbreak: it => _in-html(it, () => html.elem("div", attrs: (class: "wb-colbreak")))
  show align: it => _in-html(it, () => html.elem("div", attrs: (style: _align-css(it.alignment)), it.body))

  // Inside an equation `quad` and friends are an `h` too, and MathML has its own
  // spacing. An HTML element there would tear the equation apart.
  show math.equation: it => { _in-math.update(true); it; _in-math.update(false) }
  show h: it => _in-html(it, () => if _in-math.get() { it } else if type(it.amount) == fraction { [ ] } else {
    html.elem("span", attrs: (style: "display:inline-block;width:" + _css(it.amount)))
  })
  show v: it => _in-html(it, () => if type(it.amount) == fraction { [] } else {
    html.elem("div", attrs: (style: "height:" + _css(it.amount)))
  })
  show line: it => _in-html(it, () => html.elem("hr", attrs: (class: "wb-line")))
  show pad: it => _in-html(it, () => {
    let side(k, default) = { let v = it.at(k, default: none); if v == none { default } else { v } }
    let rest = side("rest", 0pt)
    let x = side("x", rest)
    let y = side("y", rest)
    let l = side("left", x)
    let r = side("right", x)
    let t = side("top", y)
    let b = side("bottom", y)
    html.elem("div", attrs: (style: "padding:" + _css(t) + " " + _css(r) + " " + _css(b) + " " + _css(l)), it.body)
  })
  show stack: it => _in-html(it, () => {
    let row = it.dir == ltr or it.dir == rtl
    let gap = if it.spacing == none { 0pt } else { it.spacing }
    html.elem(
      "div",
      attrs: (style: "display:flex;gap:" + _css(gap) + ";flex-direction:" + (if row { "row" } else { "column" }) + ";align-items:flex-start"),
      it.children.map(c => if type(c) == length or type(c) == fraction { [] } else { html.elem("div", c) }).join(),
    )
  })
  show grid: it => _in-html(it, () => {
    let n = _columns-of(it.columns)
    let cell(c) = if c.func() == grid.cell { c.body } else { c }
    html.elem(
      "div",
      attrs: (class: "wb-grid", style: "display:grid;grid-template-columns:repeat(" + str(n) + ",auto);gap:0.4em 1.4em;align-items:start;justify-content:start"),
      it.children.filter(c => c.func() != grid.hline and c.func() != grid.vline).map(c => html.elem("div", cell(c))).join(),
    )
  })
  show place: it => _in-html(it, () => it.body)

  // A box or block with a size or a look is a picture, which is also how a `cetz`
  // canvas becomes one drawing. Plain ones around running text stay selectable text.
  // `stroke` is never plain `none`: without one it is a dictionary of empty sides.
  let stroked(s) = if type(s) == dictionary { s.values().any(x => x != none) } else { s != none }
  let styled(it) = it.width != auto or it.height != auto or it.fill != none or stroked(it.stroke)
  show box: it => context if target() == "html" and styled(it) { html.frame(it) } else { it }
  show block: it => context if target() == "html" and styled(it) { html.frame(it) } else { it }

  // Pictures: laid out by Typst itself and embedded as SVG. (`target()` is
  // "paged" inside a picture, so nested shapes are left alone.)
  show circle: it => context if target() == "html" { html.frame(it) } else { it }
  show ellipse: it => context if target() == "html" { html.frame(it) } else { it }
  show rect: it => context if target() == "html" { html.frame(it) } else { it }
  show square: it => context if target() == "html" { html.frame(it) } else { it }
  show polygon: it => context if target() == "html" { html.frame(it) } else { it }
  show curve: it => context if target() == "html" { html.frame(it) } else { it }
  show move: it => context if target() == "html" { html.frame(it) } else { it }
  show rotate: it => context if target() == "html" { html.frame(it) } else { it }
  show scale: it => context if target() == "html" { html.frame(it) } else { it }

  // Coloured text (the HTML export keeps the words but drops the colour).
  show text: it => context {
    let fill = text.fill
    if target() == "html" and type(fill) == color and fill != black {
      html.elem("span", attrs: (style: "color:" + fill.to-hex()), it)
    } else { it }
  }

  set raw(theme: none)
  body
}
