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

/// A pointer to a PDF in the student's materials, or to a highlight in it:
/// `#pdf-ref("r-3fa9", "<highlight id>", quote: "the passage")`. The app writes the title and page; `quote` is what
/// stays if the file or the highlight is deleted.
#let pdf-ref(resource, ..target, quote: none) = {
  let t = target.pos().at(0, default: none)
  html.elem(
    "a",
    attrs: (
      class: "wb-pdf-ref",
      data-pdf-ref: resource + if t == none { "" } else { "/" + t },
      href: "#/resources/" + resource + if t == none { "" } else { "/" + t },
    ),
    if quote == none { [] } else { quote },
  )
}

// ───────────────────────── widgets ─────────────────────────
//
// Things to try out in a lesson (or any other text). The author configures them,
// the app brings them to life: each is a `div[data-widget]` whose parts are
// ordinary Typst, so feedback and code in them are written as everywhere else.
// Without the app the parts are simply shown one after another.

#let _widget(kind, attrs: (:), body) = html.elem("div", attrs: (class: "wb-widget", data-widget: kind) + attrs, body)
#let _part(name, attrs: (:), body) = html.elem("div", attrs: (data-part: name) + attrs, body)

/// One answer of a `quiz`: what is shown, then why it is right or wrong.
/// `#choice[`0`][Das ist die Antwort für `Nothing`.]`, `#choice(correct: true)[`42`][Genau.]`
#let choice(correct: false, label, ..why) = _part(
  "choice",
  attrs: if correct { (data-correct: "true") } else { (:) },
  {
    _part("label", label)
    for w in why.pos() { _part("why", w) }
  },
)

/// A question with answers to choose from. A wrong answer explains itself, the student tries again.
/// `_src` is the quiz's own text, added by the app: from it a student can make a flashcard.
#let quiz(_src: none, question, ..choices) = _widget("quiz", attrs: if _src == none { (:) } else { (data-src: _src) }, {
  _part("question", question)
  choices.pos().join()
})

/// One state of `steps`, optionally with a short label.
#let step(label: none, body) = _part("step", attrs: if label == none { (:) } else { (data-label: label) }, body)

/// Shows its steps one at a time, with buttons to go back and forth.
#let steps(..steps) = _widget("steps", steps.pos().join())

/// One choice of `tabs`.
#let tab(label, body) = _part("tab", attrs: (data-label: label), body)

/// The same thing for several examples: the student picks which one to see. `label` names the choice ("Datentyp").
#let tabs(label: none, ..tabs) = _widget("tabs", attrs: if label == none { (:) } else { (data-label: label) }, tabs.pos().join())

/// One worked example of a `recipe`: what each step gives for it, in the order of the steps.
#let example(label, ..results) = _part("example", attrs: (data-label: label), results.pos().map(r => _part("result", r)).join())

/// A numbered procedure next to a worked example: `step(label: "Title")[What to do]` for each step,
/// then an `example` per case, with one result per step. The student picks the example.
#let recipe(..items) = _widget("recipe", items.pos().join())

/// From a data declaration to the signature of its fold, step by step.
/// `given: true` starts with the types of the constructors written out.
#let fold-signature(data, fold: none, given: false) = _widget(
  "fold-signature",
  attrs: (data-decl: data, data-given: if given { "true" } else { "false" }) + if fold == none { (:) } else { (data-fold: fold) },
  raw(data, lang: "haskell", block: true),
)

#let _config(..fields) = str(json.encode(fields.named(), pretty: false))

/// Try out what a fold does: the student picks a value and an answer for each constructor, the app
/// writes the fold from the declaration and lets the interpreter compute the result.
/// `results` has one entry per result type: `(type: "Int", Nothing: ("0", "100"), Just: ("x + 1", "x * 2"))`.
/// An answer for a constructor with fields is the body of its function, with the fields called `x`, `y`, `z`.
#let fold-explorer(data, values: (), type: none, results: (), fold: none) = _widget(
  "fold-explorer",
  attrs: (data-decl: data, data-config: _config(values: values, type: type, results: results, fold: fold)),
  raw(data, lang: "haskell", block: true),
)

/// A value as a tree of constructors, folded step by step: the constructors become the fold's functions,
/// `functions` fills them in (`(Nothing: "Nothing", Just: "Just")`), and the tree folds together from the leaves.
#let fold-tree(data, value, functions: (:), type: none, fold: none) = _widget(
  "fold-tree",
  attrs: (data-decl: data, data-config: _config(value: value, functions: functions, type: type, fold: fold)),
  raw(value, lang: "haskell", block: true),
)

/// A fold computed step by step on a value: constructors replaced, then folded together from the leaves,
/// with the expression at every step underneath. `folds` are the choices:
/// `((name: "Summe", functions: ("(:)": "(+)", "[]": "0")), …)`. `predict` offers answers to guess first;
/// which one is right, the interpreter decides.
#let fold-steps(data, value, folds: (), type: none, fold: none, predict: none) = _widget(
  "fold-steps",
  attrs: (data-decl: data, data-config: _config(value: value, folds: folds, type: type, fold: fold, predict: predict)),
  raw(value, lang: "haskell", block: true),
)

/// Two pieces of code side by side, with what corresponds marked in both: `[[id|text]]` in the code.
/// `pairs` names each mark in order (`(nil: "Die leere Liste", …)`), `notes` explains it.
#let compare(pairs: (:), notes: (:), left, right) = _widget("compare", attrs: (data-config: _config(pairs: pairs)), {
  _part("side", left)
  _part("side", right)
  for (id, body) in notes { _part("note", attrs: (data-id: id), body) }
})

/// Exercises to do next, as a list the student can click through: `#practice("fold-maybe-either", "fold-maximum")`.
/// The app shows each one's title, level and whether it is done, under the headline "Exercises for this lesson".
/// Optional: `note: [...]`, one line under the headline, and `comments: ("fold-maximum": [Extra])`, a short word
/// beside an exercise.
#let practice(note: none, comments: (:), ..ids) = _widget(
  "practice",
  attrs: (data-ids: ids.pos().join(",")),
  {
    list(..ids.pos().map(id => xref(id)))
    if note != none { _part("note", note) }
    for (id, c) in comments { _part("comment", attrs: (data-id: id), c) }
  },
)

/// A question to think about, with no answer to pick: `#open-question[Was weißt du jetzt?][Denk an die Eingaben.]`.
/// The optional second argument is a hint under it; `answer: [...]` adds an Answer button that shows it. Students
/// can write the question into their notes or make a card of it.
#let open-question(question, answer: none, ..hint) = _widget("open-question", {
  _part("question", question)
  for h in hint.pos() { _part("hint", h) }
  if answer != none { _part("answer", answer) }
})

/// Expressions drawn as trees, side by side: `(expr: "f 1 (f 2 z)", caption: "foldr f z [1, 2]")`.
/// `colors` gives names a constructor colour (1 to 4): `(f: 3, z: 1)`.
#let expr-trees(colors: (:), ..trees) = _widget(
  "expr-trees",
  attrs: (data-config: _config(trees: trees.pos(), colors: colors)),
  trees.pos().map(t => raw(t.expr, lang: "haskell", block: true)).join(),
)

/// A list folded element by element, with what is left of the input and the accumulator as cards.
/// `folds: ((name: "foldl (flip (:)) []", dir: "left", fn: "flip (:)", start: "[]"), …)`; the interpreter
/// computes every step.
#let fold-list(xs: (), folds: ()) = _widget(
  "fold-list",
  attrs: (data-config: _config(xs: xs, folds: folds)),
  raw(folds.map(f => f.name).join("\n"), lang: "haskell", block: true),
)

/// Where foldr and foldl put the brackets and the start value, for a few operations to choose from:
/// `ops: ((op: "+", list: ("1", "2", "3"), assoc: true, starts: ((value: "0", neutral: true), (value: "10", neutral: false))), …)`.
#let bracketing(ops: ()) = _widget(
  "bracketing",
  attrs: (data-config: _config(ops: ops)),
  raw(ops.map(o => "(" + o.op + ")").join(" "), lang: "haskell", block: true),
)

/// One box of a `flow`: an id, its text, its place on a grid (`at: (column, row)`, both from 0), and how it looks:
/// `kind: "start"`, `"decision"`, `"good"`, `"bad"` or none. `note` is a second, quieter line.
#let flow-node(id, label, at: (0, 0), kind: none, note: none) = (id: id, label: label, at: at, kind: kind, note: note)

/// An arrow of a `flow` from one box to another (or to itself), with an optional short label ("ja").
#let flow-edge(from, to, label: none) = (from: from, to: to, label: label)

/// A flowchart, drawn by the app in the look of the lesson: boxes on a grid, arrows between them.
/// `#flow(flow-node("a", "Start", kind: "start"), flow-node("b", "Fertig?", at: (0, 1), kind: "decision"), flow-edge("a", "b"))`.
/// Texts are plain strings.
#let flow(..items) = {
  let nodes = items.pos().filter(x => "at" in x)
  let edges = items.pos().filter(x => "from" in x)
  _widget(
    "flow",
    attrs: (data-config: _config(nodes: nodes, edges: edges)),
    list(..edges.map(e => {
      let name(id) = nodes.find(n => n.id == id).label
      [#name(e.from) → #name(e.to)#if e.label != none [ (#e.label)]]
    })),
  )
}

/// A quiet aside inside a line, e.g. a note in a table cell.
#let muted(body) = html.elem("span", attrs: (class: "wb-muted"), body)

/// More room for a widget that is dense, e.g. two trees side by side: wider than the text, as far as the window allows.
#let wide(body) = html.elem("div", attrs: (class: "wb-wide"), body)

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
