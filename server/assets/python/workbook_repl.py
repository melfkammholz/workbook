"""The workbook's Python interpreter, driven through pipes.

After every command it prints a marker as its prompt, so the server knows when the output of a command is
complete. `@@WB-LOAD@@ <file>` runs the student's file afresh, in the namespace the interpreter works in, and
reports what went wrong as a diagnostic line. Everything else goes to Python's own interactive console, so a
block (a `for` loop, a `def`) is typed as in `python3`: line by line, ended by an empty line.
"""

import code
import sys
import traceback

PROMPT = "@@WB-PROMPT@@"
DIAG = "@@WB-DIAG@@"

namespace = {"__name__": "__main__", "__builtins__": __builtins__}
console = code.InteractiveConsole(namespace)


def prompt():
    sys.stdout.write(PROMPT)
    sys.stdout.flush()


def diagnostic(path, line, column, message):
    message = message.strip().replace("\n", "\x01")
    print(f"{DIAG}error\t{path}\t{line}\t{column}\t{message}", flush=True)


def load(path):
    # A fresh start: what an earlier version of the file defined must not linger.
    for name in [n for n in namespace if n not in ("__name__", "__builtins__")]:
        del namespace[name]
    console.resetbuffer()
    try:
        with open(path, encoding="utf-8") as f:
            source = f.read()
        exec(compile(source, path, "exec"), namespace)
    except SyntaxError as e:
        diagnostic(path, e.lineno or 1, e.offset or 0, f"{type(e).__name__}: {e.msg}")
    except BaseException as e:  # noqa: BLE001 - whatever the file raises is the student's to see
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == path]
        line = frames[-1].lineno if frames else 1
        diagnostic(path, line, 0, "".join(traceback.format_exception_only(type(e), e)))


prompt()
for raw in sys.stdin:
    line = raw.rstrip("\n")
    if line.startswith("@@WB-LOAD@@ "):
        load(line[len("@@WB-LOAD@@ "):].strip())
    else:
        try:
            console.push(line)
        except SystemExit:
            pass
    prompt()
