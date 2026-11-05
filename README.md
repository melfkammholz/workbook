# Workbook

You learn by doing. Reading lecture notes and following along in class help, but they only take you so far.
Understanding sinks in once you try something yourself, get it wrong and find out why.

The workbook is meant to make that step as small as possible. A course's exercises sit right next to the place where
you work on them, so there is nothing to set up before you can start. Open an exercise, write your answer, check it, and
move on. The workbook keeps track of what you have done and what you were unsure about, so you can come back to it
later.

Exercises can ask for a written answer on any subject. Programming exercises currently work in Haskell and Prolog,
with an editor, a live interpreter and tests. The workbook runs on your own computer from one Docker container, and a
course is a git repository that you add in the app.

**Example course:** [workbook-deklprog](https://github.com/melfkammholz/workbook-deklprog), the exercises for
"Deklarative Programmierung" at Kiel University, in Haskell and Prolog.

## For students

### What you get

* **Exercises with a place to work next to them.** Written answers go into an answer field with a preview.
  Programming exercises get an editor, and the code is loaded into a running interpreter (`ghci` or SWI-Prolog) every
  time you change it, so you can try expressions or queries right away.
* **Tests on demand.** If an exercise comes with tests, you can run them whenever you like. Passing tests never mark
  an exercise as done. You decide that.
* **Hints and reference solutions.** You open hints one by one, and the solution only when you ask for it.
* **An overview of where you stand.** It shows a status per exercise (to do, in progress, done, review later), a filter
  in the outline, and suggestions for what to do next. Exercises marked as recommended show where to start.
* **Self-evaluation and review.** When you finish an exercise, you can say how confident you are and what is still
  open. The **Review** page collects everything you were unsure about, together with your self-evaluations per chapter.
* **Notes and history.** You can keep notes per exercise and see all of them on one page. Every answer has a version
  history.
* **Adventures.** These are longer stories that lead through several exercises, some with code that grows from one
  exercise to the next.
* **Feedback from your own AI chat.** You can copy a prompt with the task, your answer and the test results into the
  chat you already use. Hints and solutions are never part of it.
* **Optional extras.** If you turn them on, there are achievements, animal friends, a plant per chapter and small
  celebrations. They reward work done, never speed.

The app speaks German and English.

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

   The first start downloads the image, which includes GHC, SWI-Prolog and Typst. That takes a while and a few
   gigabytes of disk space. Later starts are quick.

Open <http://localhost:8080> and paste the address of your course into the welcome dialog, for example
`https://github.com/melfkammholz/workbook-deklprog`. The page is only reachable from your own computer.

### Day to day

* **Start and stop:** in the folder with `compose.yaml`, `docker compose up -d` starts the workbook, and
  `docker compose down` stops it. Your work stays.
* **Course updates:** the top bar tells you when your course has new or changed exercises. You decide when to apply an
  update, and your work stays, even for an exercise the update removes.
* **App updates:** `docker compose pull && docker compose up -d`.
* **More courses:** the arrows next to the course title switch between courses and add more. Each course keeps its own
  answers, notes and progress.
* **Your work** lives only in the Docker volume `workbook-data`, on your computer. There is no other copy, and nobody
  else can see it. `docker compose down -v` deletes it, and so does resetting a course in the courses dialog.

A course runs its tests on your computer, inside the container. So only add courses from people you trust. Only public
repositories can be added for now.

### Feedback from an AI chat

The *AI review* tab of an exercise copies a prompt with the task, your current answer and the latest test results.
Paste it into the AI chat you already use, such as Claude or ChatGPT. The workbook needs no account or key for this,
and sends nothing itself. The prompt never contains hints, author notes or the reference solution. You can change it in
the same tab, using the placeholders `{title}`, `{task}`, `{language}`, `{answer}` and `{tests}`.

## For course authors

A course is a git repository with Typst files for the texts and YAML for the structure: chapters, sections, exercises,
tests, adventures and self-evaluations. [docs/authoring.md](docs/authoring.md) describes the format, and
[workbook-deklprog](https://github.com/melfkammholz/workbook-deklprog) is a complete course to look at.

To see your changes while you write, mount your working copy into the container. Put this into a file
`compose.override.yaml` next to `compose.yaml`, and Docker Compose picks it up by itself:

```yaml
services:
  workbook:
    volumes:
      - ../my-course:/content:ro
```

Your folder shows up as one more course. It reloads when you save, and the app never updates or removes it.

Before you publish a change, check it:

```sh
docker compose run --rm workbook node server/dist/cli.js lint --render --solutions
```

This validates the course and renders every text with Typst. It also runs the tests against your reference solutions,
and against the starter code, to see that a student's first test run works. It also shows the Typst warnings and
content problems that students are not shown.

## Development

You need Node 22.13 or newer, `ghc`/`ghci`/`runghc` with `QuickCheck`, `swipl` and the `typst` CLI 0.15 or newer.

```sh
npm install
npm test                      # server tests; Typst, GHC and Prolog tests are skipped when the tool is missing
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

To run your own build in Docker, add `build: .` to the service in `compose.override.yaml` and start it with
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
| `server/src/content` | Loading and checking a course, Typst rendering, the preprocessor for starter and solution in one file, search |
| `server/src/runners` | Warm `ghci` and `swipl` sessions, the test runners, the session pool |
| `server/src/courses` | Adding, downloading and updating courses, one copy and one database per course |
| `server/src/db` | SQLite with migrations: progress, answers and their history, notes, self-evaluations, statistics |
| `server/src/api` | HTTP and WebSocket routes, and the guards against requests from other sites |
| `server/src/ai` | The prompt students copy into their own chat |
| `server/src/achievements.ts`, `suggest.ts` | Achievements, and what to do next |
| `server/assets` | The Typst prelude, the `Workbook.Check` Haskell test library, the Prolog driver and test library |
| `web/src` | The React app. All interface texts are in `lib/i18n.ts` |

Environment variables: `PORT`, `HOST`, `CONTENT_DIR`, `DATA_DIR`, `WEB_DIR`, `TYPST_BIN`, `TYPST_PACKAGE_CACHE_PATH`,
`GHCI_BIN`, `RUNGHC_BIN`, `SWIPL_BIN`, `MAX_SESSIONS`, `SESSION_IDLE_MS`, `ALLOWED_HOSTS`.

### Security

* **Requests from other sites:** the server only answers requests for `localhost`, `127.0.0.1` or `[::1]` (extend
  this with `ALLOWED_HOSTS`). It rejects writes and WebSocket connections from other sites, so a web page you visit
  cannot talk to it.
* **Student code:** it runs inside the container as an unprivileged user, with the memory and process limits from
  `compose.yaml`. Like any program in a container, it can reach the network.
* **Course repositories:** they are fetched over http(s) without a login, and an address containing a login is
  refused.

### Status

Not built yet:

* notes in Markdown with KaTeX (notes are written in Typst for now),
* private course repositories.

Messages from the compilers and test libraries are shown as they are, mostly in English.
