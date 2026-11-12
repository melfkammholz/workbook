# Workbook

You learn by doing. Reading lecture notes and following along in class help, but they only take you so far.
Understanding sinks in once you try something yourself, get it wrong and find out why.

The workbook is meant to make that step as small as possible. A workbook's exercises sit right next to the place where
you work on them, so there is nothing to set up before you can start. Open an exercise, write your answer, check it, and
move on. The workbook keeps track of what you have done and what you were unsure about, so you can come back to it
later.

Exercises can ask for a written answer on any subject. Programming exercises currently work in Haskell and Prolog,
with an editor, a live interpreter and tests, and SLD trees can be drawn as text and are checked by
[sldcheck](https://github.com/melfkammholz/sldcheck). The workbook runs on your own computer from one Docker container, and a
workbook is a git repository that you add in the app.

**Example workbook:** [workbook-deklprog](https://github.com/melfkammholz/workbook-deklprog), the exercises for
"Deklarative Programmierung" at Kiel University, in Haskell and Prolog.

## For students

### What you get

* **Exercises with a place to work next to them.** Written answers go into an answer field with a preview.
  Programming exercises get an editor, and the code is loaded into a running interpreter (`ghci` or SWI-Prolog) every
  time you change it, so you can try expressions or queries right away.
* **A wide layout.** For exercises with code, the task can fold into a strip, so that the editor takes the middle and
  feedback moves to the right. For an SLD tree that is where its picture is drawn as you write.
* **Tests on demand.** If an exercise comes with tests, you can run them whenever you like. Passing tests never mark
  an exercise as done. You decide that.
* **Hints and reference solutions.** You open hints one by one, and the solution only when you ask for it.
* **An overview of where you stand.** It shows a status per exercise (to do, in progress, done, review later), a filter
  in the outline, and suggestions for what to do next. Exercises marked as recommended show where to start, and a focus
  (essentials, thorough, everything) decides how much of the workbook is in sight.
* **Self-evaluation and review.** When you finish an exercise, you can say how confident you are and what is still
  open. The **Review** page collects everything you were unsure about, together with your self-evaluations per chapter.
* **Notes and history.** You can keep notes per exercise and see all of them on one page. Every answer has a version
  history.
* **Highlights.** Highlight passages of the workbook text, write a comment, and mark what you want to come back to. A
  page lists them all, and a chapter's checklist shows what is still open in it. Optional, like flashcards.
* **Flashcards you write yourself.** Decks of cards in your own words, reviewed with spaced repetition (FSRS). A card
  can be made right from an exercise, and decks belong to you, not to a workbook. See [Flashcards](#flashcards).
* **Open questions.** Write down what you do not understand yet, on an exercise, in the text or in a PDF, and tick it off
  when it is cleared up. One page lists all of them, with search and filters. "Come back to" on a highlight or a page
  is an empty question.
* **Materials and library.** Upload scripts, slides and other files, sort them into types and series, and see them per
  workbook or in one library. The PDF viewer has a table of contents, highlights, notes per page or slide, and questions.
  A new version of a file keeps your highlights and notes where they belong, and lists what it could not place.
  Optional, in the settings.
* **One search.** Finds your notes, answers, highlights, questions and the text of your materials, across workbooks.
* **Adventures.** These are longer stories that lead through several exercises, some with code that grows from one
  exercise to the next.
* **Feedback from your own AI chat.** You can copy a prompt with the task, your answer and the test results into the
  chat you already use. Hints and solutions are never part of it.
* **An assistant that reads along.** Optional: Claude Code can read your open questions, search your text and read your
  materials through a local connection, and run your saved code's tests. It cannot change anything. It only suggests
  types, labels, answers, cards and notes, and you accept or reject each one in the assistant inbox. See
  [Assistant](#assistant).
* **Optional extras.** If you turn them on, there are achievements, animal friends, a plant per chapter and small
  celebrations. They reward work done, never speed.

The app speaks German and English. Everything about how it works is on its help page (the question mark in the top
bar). For color vision deficiency, a setting switches to orange and blue with patterns wherever a color carries
meaning.

### Set it up

You need [Docker](https://docs.docker.com/get-docker/), which is Docker Desktop on macOS and Windows.

1. Make a folder for the workbook and save [`compose.yaml`](https://raw.githubusercontent.com/melfkammholz/workbook/main/compose.yaml)
   in it. You can save it from your browser, or download it in a terminal:

   ```sh
   mkdir workbook && cd workbook
   curl -fsSLO https://raw.githubusercontent.com/melfkammholz/workbook/main/compose.yaml
   ```

2. Start the workbook in that folder:

   ```sh
   docker compose up -d
   ```

   The first start downloads the image, which includes GHC, SWI-Prolog, sldcheck and Typst. That takes a while and a few
   gigabytes of disk space. Later starts are quick.

Open <http://localhost:8080> and paste the address of your workbook into the welcome dialog, for example
`https://github.com/melfkammholz/workbook-deklprog`. The page is only reachable from your own computer.

### Day to day

* **Start and stop:** in the folder with `compose.yaml`, `docker compose up -d` starts the workbook, and
  `docker compose down` stops it. Your work stays.
* **Workbook updates:** the top bar tells you when your workbook has new or changed exercises. You decide when to apply an
  update, and your work stays, even for an exercise the update removes.
* **App updates:** `docker compose pull && docker compose up -d`.
* **More workbooks:** the arrows next to the workbook title switch between workbooks and add more. Each workbook keeps its own
  answers, notes and progress.
* **Your work** lives only in the Docker volume `workbook-data`, on your computer, in one database next to your
  uploaded files. Nobody else can see it. `docker compose down -v` deletes it, and so does "Delete all my data" for a
  workbook in the workbooks dialog. Removing a workbook only hides it, and adding it again brings your work back.
* **Backups:** once a day, on the first start, the app keeps a snapshot of your data (the last 7 days and 4 weeks). The
  settings list them and restore one. A snapshot lives in the same volume, so it does not protect against deleting
  the volume.

A workbook runs its tests on your computer, inside the container. So only add workbooks from people you trust. Workbooks
added by address must be public repositories.

### Local and private workbooks

Put workbooks (plain folders or git repositories) in one folder on your computer, for example `~/workbooks`, and remove
the `#` in front of the `/workbooks` line in `compose.yaml`. Run `docker compose up -d` again. The add dialog then lists
that folder. Adding one gives the app its own copy; when you change the original the workbook shows an update, which you
apply when you want.

* A private repository: clone it into that folder with your own credentials. The app never sees or stores a password or
  key. To get newer changes, run `git pull` on your computer, then press *update* in the app.
* For a git repository only what is committed counts. For a plain folder, whatever is on disk counts.
* Renaming the folder makes a new workbook. The same workbook added from GitHub and from the folder are two workbooks.

### Feedback from an AI chat

This is optional: turn on *Prompts for an AI chat* in the settings. The *AI review* tab of an exercise copies a prompt with the task, your current answer and the latest test results.
Paste it into the AI chat you already use, such as Claude or ChatGPT. The workbook needs no account or key for this,
and sends nothing itself. The prompt never contains hints, author notes or the reference solution. You can change it in
the same tab, using the placeholders `{title}`, `{task}`, `{language}`, `{answer}`, `{tests}` and `{questions}` (the open questions on the exercise).

### Assistant

Optional: turn on *Let Claude Code read your questions* in the settings and run the command shown there once in a
terminal. The connection (MCP) is local and protected by a token; *New token* makes the old command stop working.
The assistant can read open questions, search, read pages and materials, read your saved code and run its tests, and keep
notes of its own that you can see and delete. Two switches decide whether it may see solutions and author notes, and
your progress. It never writes into your work: its suggestions wait in the assistant inbox until you accept, edit or
reject them, and an accepted one can be undone.

### Flashcards

Flashcards are optional: turn them on in the settings. How to write good cards is on the help page. The cards icon in the top bar then opens your decks. Decks are
yours, not a workbook's: they work across workbooks and before any workbook is added, and a deck can belong to workbooks so
it is listed with them. *Make a card*, at the top of an exercise's workspace, writes a card with a preview, and the card
remembers the exercise, its tags and its language for code.

A deck shows as cards you can edit, move and delete one by one. Under *Text*, the same deck is one Typst text, and that
text is the deck:

```typst
#flashcard[
  What does `map` do?
][
  It applies a function to every element of a list.
]

#flashcard(both: true, tags: ("side-effects",))[
  Side effect
][
  A change to the world beyond the result.
]

#cloze[
  `length (_:xs) = {{1 + length xs}}`
]
```

`both: true` asks a card both ways round, and each `{{…}}` gap of a cloze is asked on its own. When the deck is saved,
each new card gets an id (`#flashcard(id: "k3f9")[…]`). Leave it there: the schedule belongs to it, so you can reword,
reorder or move a card to another deck and keep what you have learned. Typing `#` offers new cards and more.

Ratings are Again, Hard, Good and Easy. A session is one deck, or a few picked together. Each deck sets how sure you
want to be, how many new cards a day may come, how many cards make it "big", and optionally the date to be ready by
(the course's examination periods are suggested). Reviewing early or late does no harm, and *Not today* puts a card
off without a rating. Cards you keep forgetting are offered to be rewritten, split, dropped or kept as they are. How
well you know a deck shows as solid, shaky and new, and on a workbook's Review page beside your self-evaluations.

## For workbook authors

A workbook is a git repository with Typst files for the texts and YAML for the structure: chapters, sections, exercises,
tests, adventures and self-evaluations. [docs/authoring.md](docs/authoring.md) describes the format, and
[workbook-deklprog](https://github.com/melfkammholz/workbook-deklprog) is a complete workbook to look at.

To see your changes while you write, mount your working copy into the container. Put this into a file
`compose.override.yaml` next to `compose.yaml`, and Docker Compose picks it up by itself:

```yaml
services:
  workbook:
    volumes:
      - ../my-course:/content:ro
```

Your folder shows up as one more workbook. It reloads when you save, and the app never updates or removes it.

Before you publish a change, check it:

```sh
docker compose run --rm workbook node server/dist/cli.js lint --render --solutions
```

This validates the workbook and renders every text with Typst. It also runs the tests against your reference solutions,
and against the starter code, to see that a student's first test run works. It also shows the Typst warnings and
content problems that students are not shown.

## Development

You need Node 22.13 or newer, `ghc`/`ghci`/`runghc` with `QuickCheck`, `swipl`, the `typst` CLI 0.15 or newer and,
for SLD trees, [`sldcheck`](https://github.com/melfkammholz/sldcheck) 0.2 or newer (`SLDCHECK_BIN`).

```sh
npm install
npm test                      # server tests; Typst, GHC, Prolog and sldcheck tests are skipped when the tool is missing
npm run test:docker           # the same in the toolchain image, which has every tool
npm run typecheck
npm run build

export CONTENT_DIR=$PWD/server/test/fixtures/course DATA_DIR=$PWD/.data
npm run dev:server            # API on :8080
npm run dev:web               # UI on :5173, passes /api and /ws on to the server

node scripts/e2e-smoke.mjs    # optional browser smoke test, see the top of the script
```

The GHC tests need `QuickCheck` in a package environment, for example
`cabal install --lib --package-env ./ghc-env QuickCheck` and then `GHC_ENVIRONMENT=$PWD/ghc-env`.
`server/test/fixtures/course` is the small course the tests run on.

### Developing in Docker

The image has every tool, so you can skip installing them: `compose.dev.yaml` runs the image without the app
(`toolchain` in the Dockerfile) and mounts your checkout into it. A code change needs no image build:

```sh
npm install
npm run watch                                  # rebuilds server/dist and web/dist on every save
docker compose -f compose.dev.yaml up -d       # http://localhost:8090, with its own data volume
```

The server restarts by itself when its build changes; after a web change, reload the page. The workbook is the tests'
small course unless you set `COURSE_DIR` (for example in `.env`). Build the image again (`up -d --build`) only when the
Dockerfile changes. Building needs BuildKit, which comes with Docker's `buildx` plugin.

For a throwaway server with empty data, for tests and screenshots, use `scripts/test-server.sh` (options at the top of
the file; `stop` stops it), and `npm run shot -- item/<id> --theme light,dark --width 1440,400` for screenshots.

To run your own full image instead, add `build: .` to the service in `compose.override.yaml` and start it with
`docker compose up -d --build`.

### Publishing the image

The workflow in `.github/workflows/docker.yml` publishes the image to the GitHub Container Registry when you push a
version tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

It builds for `amd64` and `arm64` (Apple Silicon), each natively on its own runner, and tags the image
`ghcr.io/melfkammholz/workbook` as `1.0.0`, `1.0` and `latest`. Students get `latest`. The first build takes a while,
because it installs GHC; later ones reuse the cache. You can also start the workflow by hand from the Actions tab,
which publishes a tag named after the branch, such as `main`, and leaves `latest` alone.

| Path | |
| --- | --- |
| `shared/` | Types shared by the server and the web app |
| `server/src/content` | Loading and checking a workbook, Typst rendering, the preprocessor for starter and solution in one file, search |
| `server/src/runners` | Warm `ghci` and `swipl` sessions, the test runners, the session pool |
| `server/src/courses` | Adding, downloading and updating workbooks (public repositories, the mounted `/workbooks` folder, `/content`), one copy per workbook, search |
| `server/src/resources`, `flashcards` | Materials and the library, flashcards with FSRS |
| `server/src/db` | SQLite with migrations: one database for progress, answers and their history, notes, self-evaluations, questions, highlights, cards |
| `server/src/api` | HTTP and WebSocket routes, the assistant's MCP endpoint, and the guards against requests from other sites |
| `server/src/ai` | The prompt students copy into their own chat |
| `server/src/achievements.ts`, `suggest.ts`, `snapshots.ts` | Achievements, what to do next, daily backups |
| `server/assets` | The Typst prelude, the `Workbook.Check` Haskell test library, the Prolog driver and test library |
| `web/src` | The React app. All interface texts are in `lib/i18n.ts` |

Environment variables: `PORT`, `HOST`, `CONTENT_DIR`, `DATA_DIR`, `WEB_DIR`, `TYPST_BIN`, `TYPST_PACKAGE_CACHE_PATH`,
`WORKBOOKS_DIR`, `GHCI_BIN`, `RUNGHC_BIN`, `SWIPL_BIN`, `PYTHON_BIN`, `SLDCHECK_BIN`, `MAX_SESSIONS`, `SESSION_IDLE_MS`, `ALLOWED_HOSTS`.

### Security

* **Requests from other sites:** the server only answers requests for `localhost`, `127.0.0.1` or `[::1]` (extend
  this with `ALLOWED_HOSTS`). It rejects writes and WebSocket connections from other sites, so a web page you visit
  cannot talk to it.
* **Student code:** it runs inside the container as an unprivileged user, with the memory and process limits from
  `compose.yaml`. Like any program in a container, it can reach the network.
* **Workbook repositories:** they are fetched over http(s) without a login, and an address containing a login is
  refused.

### Status

Not built yet:

* notes in Markdown with KaTeX (notes are written in Typst for now).

Messages from the compilers and test libraries are shown as they are, mostly in English.
