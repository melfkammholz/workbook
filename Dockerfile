# syntax=docker/dockerfile:1
#
# One image with everything a student needs: the workbook app, GHC (ghci/runghc)
# with QuickCheck, SWI-Prolog, sldcheck (for SLD trees), and the Typst CLI.
#
#   docker build -t workbook .
#   docker run --rm -p 127.0.0.1:8080:8080 -v workbook-data:/data workbook
#
# (compose.yaml does the same.) Needs BuildKit (the buildx plugin), which builds the stages in parallel and only
# rebuilds the ones whose inputs changed:
#
#   ghc        GHC, the Haskell libraries and sldcheck; changes rarely and takes longest
#   typst      the Typst binary
#   toolchain  Debian packages plus the two above, without the app; compose.dev.yaml runs this one with the checkout
#              mounted, so code changes never need a rebuild
#   build      the web app and the server bundle
#   runtime    toolchain plus the app (the default target, what gets published)

ARG GHC_VERSION=9.10.3

# ───────────────────────── ghc: GHC, Haskell libraries, sldcheck ─────────────────────────
# Plain Debian plus GHC from ghcup, so nothing depends on which Debian release
# a third-party image happens to be built on. GHC is the version ghcup recommends,
# which is what students and authors get from ghcup on their own machines too.
FROM debian:trixie-slim AS ghc
ARG GHC_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential libgmp-dev libffi-dev libncurses-dev zlib1g-dev libnuma-dev \
      ca-certificates curl xz-utils git \
 && rm -rf /var/lib/apt/lists/*

# Installed under /opt so the unprivileged user of the runtime can use it. Everything goes in one layer that also
# removes what students never need (docs, profiling libraries, ghcup's downloads), so it is never stored at all.
ENV GHCUP_INSTALL_BASE_PREFIX=/opt \
    PATH=/opt/.ghcup/bin:$PATH \
    CABAL_DIR=/opt/cabal
RUN curl -fsSL https://get-ghcup.haskell.org -o /tmp/ghcup-install.sh \
 && BOOTSTRAP_HASKELL_NONINTERACTIVE=1 \
    BOOTSTRAP_HASKELL_GHC_VERSION=${GHC_VERSION} \
    BOOTSTRAP_HASKELL_CABAL_VERSION=latest \
    BOOTSTRAP_HASKELL_INSTALL_NO_STACK=1 \
    BOOTSTRAP_HASKELL_ADJUST_BASHRC=0 \
    sh /tmp/ghcup-install.sh \
 && rm -f /tmp/ghcup-install.sh \
 && ghcup gc --profiling-libs --share-dir --cache --tmpdirs \
 && rm -rf /opt/.ghcup/cache /opt/.ghcup/tmp /opt/.ghcup/logs \
 && ghc --version

# sldcheck checks the SLD trees students draw (https://github.com/melfkammholz/sldcheck). It needs nothing but the
# libraries that come with GHC, so ghc builds it directly. A tag, so that a rebuild gives the same checker; its own
# example is the test that it works.
ARG SLDCHECK_REF=v0.4.0.0
RUN git clone --quiet --depth 1 --branch ${SLDCHECK_REF} https://github.com/melfkammholz/sldcheck /tmp/sldcheck \
 && ghc -O1 -i/tmp/sldcheck/src -outputdir /tmp/sldcheck-build /tmp/sldcheck/app/Main.hs -o /usr/local/bin/sldcheck \
 && sldcheck /tmp/sldcheck/examples/member.sld /tmp/sldcheck/examples/member.pl \
 && rm -rf /tmp/sldcheck /tmp/sldcheck-build

# Haskell libraries available to student code and to the checks. Only the built store and the package environment
# go into the image; the package index (about 1 GB) and cabal itself stay here.
RUN cabal update \
 && cabal install --lib --package-env /opt/ghc-env QuickCheck random containers mtl \
 && rm -rf /opt/cabal/packages /opt/cabal/logs \
 && rm -f /opt/.ghcup/bin/cabal* /opt/.ghcup/bin/ghcup \
 && rm -rf /opt/.ghcup/cabal /opt/.ghcup/db \
 && chmod -R a+rX /opt/cabal /opt/ghc-env /opt/.ghcup

# ───────────────────────── typst ─────────────────────────
FROM debian:trixie-slim AS typst
ARG TYPST_VERSION=0.15.1
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
# HTML export needs 0.15 or newer.
RUN case "${TARGETARCH:-amd64}" in amd64) t=x86_64;; arm64) t=aarch64;; *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1;; esac \
 && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${t}-unknown-linux-musl.tar.xz" \
  | tar -xJ --strip-components=1 -C /usr/local/bin "typst-${t}-unknown-linux-musl/typst" \
 && typst --version

# ───────────────────────── toolchain: everything but the app ─────────────────────────
FROM debian:trixie-slim AS toolchain

# What GHC needs to run: even ghci and runghc call gcc at startup, so a C compiler without the rest of
# build-essential. What the copied node binary links against (libatomic1), SWI-Prolog, Python, git for courses.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc libc6-dev libgmp-dev libffi-dev libncurses-dev libnuma-dev zlib1g-dev libatomic1 \
      ca-certificates git swi-prolog-nox python3 tini \
 && rm -rf /var/lib/apt/lists/*

# Node: only the binary is needed, the server is a bundle.
COPY --from=node:26-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=typst /usr/local/bin/typst /usr/local/bin/typst
COPY --from=ghc /usr/local/bin/sldcheck /usr/local/bin/sldcheck
COPY --from=ghc /opt/.ghcup /opt/.ghcup
COPY --from=ghc /opt/cabal /opt/cabal
COPY --from=ghc /opt/ghc-env /opt/ghc-env

RUN useradd --create-home --uid 1000 student \
 && mkdir -p /data /content /workbooks /app \
 && chown student:student /data

WORKDIR /app
ENV PATH=/opt/.ghcup/bin:$PATH \
    CABAL_DIR=/opt/cabal \
    GHC_ENVIRONMENT=/opt/ghc-env \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CONTENT_DIR=/content \
    WORKBOOKS_DIR=/workbooks \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    TYPST_PACKAGE_CACHE_PATH=/data/typst-packages

USER student
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]

# ───────────────────────── build: the web app and the server bundle ─────────────────────────
FROM node:26-trixie-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=cache,target=/root/.npm npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build
# Runtime dependencies of the server only (the shared package is bundled into dist).
RUN --mount=type=cache,target=/root/.npm rm -rf node_modules && npm ci --omit=dev

# ───────────────────────── runtime: toolchain plus the app ─────────────────────────
FROM toolchain AS runtime
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/server/package.json ./server/package.json
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/server/assets ./server/assets
COPY --from=build /src/web/dist ./web/dist
