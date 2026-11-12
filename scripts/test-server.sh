#!/usr/bin/env bash
# A throwaway workbook for tests and screenshots: built from this checkout, empty data, first-run dialog done.
#
#   scripts/test-server.sh [options]        # prints the URL once it answers
#   scripts/test-server.sh stop [--port N]
#
#   --port N        default 8091 (never 8080: that is the real workbook)
#   --course DIR    the course mounted as /content (default: the tests' small course)
#   --lang en|de    app language (default en; "auto" follows the course)
#   --fresh         leave the first-run dialog and the course's focus question unanswered
#   --host          run with the tools on this machine instead of the toolchain image
#   --no-build      skip `npm run build` even if sources are newer than the build
#   --web DIR       serve this web build instead of web/dist (inside this checkout; e.g. a profiling build, which
#                   `npm run watch` would otherwise overwrite)
#
# NODE_ENV=development scripts/test-server.sh: the server logs every request slower than 50 ms (docker logs <name>).
#
# The default runs the server in the `workbook-toolchain` image (GHC with QuickCheck, Typst, sldcheck, SWI-Prolog), with
# this checkout mounted and /data in memory, so nothing is left behind once it stops. The image is built when missing
# (docker compose -f compose.dev.yaml build).
set -euo pipefail
cd "$(dirname "$0")/.."

port=8091 course=server/test/fixtures/course lang=en fresh=0 mode=docker build=1 cmd=start web=web/dist
while [ $# -gt 0 ]; do
  case "$1" in
    stop) cmd=stop ;;
    --port) port=$2; shift ;;
    --course) course=$2; shift ;;
    --lang) lang=$2; shift ;;
    --fresh) fresh=1 ;;
    --host) mode=host ;;
    --no-build) build=0 ;;
    --web) web=$(realpath --relative-to=. "$2"); shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ "$port" = 8080 ] && { echo "refusing port 8080: that is the real workbook" >&2; exit 2; }
name=workbook-test-$port
url=http://localhost:$port

stop() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [ -f ".data-test-$port.pid" ]; then kill "$(cat ".data-test-$port.pid")" 2>/dev/null || true; rm -f ".data-test-$port.pid"; fi
}
if [ $cmd = stop ]; then stop; echo "stopped $url"; exit 0; fi
stop
if curl -fs -o /dev/null "$url/api/info"; then
  echo "something else already answers on $url (a test server from another session?): ss -ltnp | grep :$port" >&2
  exit 1
fi

# Build when a source file is newer than the build output (or there is none).
if [ $build = 1 ]; then
  if [ ! -f server/dist/index.js ] || [ ! -f web/dist/index.html ] \
     || [ -n "$(find shared/src server/src web/src web/index.html -newer server/dist/index.js -print -quit)" ] \
     || [ -n "$(find shared/src web/src web/index.html -newer web/dist/index.html -print -quit)" ]; then
    npm run build --silent >/dev/null
  fi
fi

course=$(realpath "$course")
if [ $mode = docker ]; then
  docker image inspect workbook-toolchain >/dev/null 2>&1 || docker compose -f compose.dev.yaml build >&2
  docker run -d --rm --name "$name" -p "127.0.0.1:$port:8080" ${NODE_ENV:+-e NODE_ENV=$NODE_ENV} -e WEB_DIR=/app/$web \
    -v "$PWD:/app:ro" -v "$course:/content:ro" --tmpfs /data:uid=1000,gid=1000 \
    workbook-toolchain >/dev/null
  logs="docker logs $name"
else
  data=$(mktemp -d)
  PORT=$port CONTENT_DIR=$course DATA_DIR=$data WEB_DIR=$PWD/$web \
    nohup node --disable-warning=ExperimentalWarning server/dist/index.js >"$data/server.log" 2>&1 &
  echo $! >".data-test-$port.pid"
  logs="cat $data/server.log"
fi

for _ in $(seq 100); do curl -fs "$url/api/info" >/dev/null && break; sleep 0.2; done
curl -fs "$url/api/info" >/dev/null || { echo "server did not start:" >&2; $logs >&2; stop; exit 1; }

if [ $fresh = 0 ]; then
  settings=$(curl -fs "$url/api/settings" | node -e "
    let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () =>
      console.log(JSON.stringify({ ...JSON.parse(s), setupDone: true, uiLanguage: process.argv[1] })));" "$lang")
  curl -fs -X PUT -H 'content-type: application/json' -d "$settings" "$url/api/settings" >/dev/null
  curl -fs -X PUT -H 'content-type: application/json' -d '{"focus":"everything"}' "$url/api/focus" >/dev/null || true
fi
echo "$url"
