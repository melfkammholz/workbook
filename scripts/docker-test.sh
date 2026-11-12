#!/usr/bin/env bash
# The server tests in the `workbook-toolchain` image, which has every tool they need (GHC with QuickCheck, Typst,
# sldcheck, SWI-Prolog), so none of them is skipped.
#
#   scripts/docker-test.sh [vitest args]     # e.g. scripts/docker-test.sh test/sld.test.ts
#   npm run test:docker -- [vitest args]
#
# The image has node but no npm/npx (it is the base of the published image, which does not need them), so vitest is
# started through node. The image is built when missing (docker compose -f compose.dev.yaml build).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker image inspect workbook-toolchain >/dev/null 2>&1; then
  docker compose -f compose.dev.yaml build
fi
[ -f node_modules/vitest/vitest.mjs ] || { echo "vitest is missing: run npm install first" >&2; exit 1; }

tty=()
[ -t 1 ] && tty=(-t)
exec docker run --rm "${tty[@]}" -v "$PWD:/app" -w /app/server \
  -e TYPST_BIN=typst -e SLDCHECK_BIN=sldcheck \
  --entrypoint node workbook-toolchain ../node_modules/vitest/vitest.mjs run "$@"
