#!/usr/bin/env bash
# Cross-version compatibility matrix.
#
# Installs every published dsh version this plugin claims to support into an
# isolated directory, then runs the shipped test suite plus `tsc --noEmit`
# against each one. Neither step touches the repo's own node_modules.
#
# Usage:
#   bash scripts/compat-matrix.sh                 # every version below
#   bash scripts/compat-matrix.sh 0.1.7-alpha.1   # one version
#
# The version list is the oldest release on each dsh line that the plugin
# claims, plus every release that changed a seam it depends on. Add new lines
# here when dsh publishes them; the script is the honesty check on the README's
# compatibility table.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_ROOT="${DSH_COMPAT_DIR:-${TMPDIR:-/tmp}/dsh-compat}"
TSC="$REPO_ROOT/node_modules/typescript/bin/tsc"

# cordis is resolved from the dsh version's OWN published manifest, never from
# `latest` and never from a hard-coded table. Both alternatives were tried and
# both are wrong:
#
#   - `latest` disagrees with the harness's siblings. The 0.1.5 and 0.1.6
#     packages peer cordis at an exact version (4.0.2) while `latest` moved on,
#     and 0.1.7 peers ^4.0.3 while `latest` still pointed at 4.0.2.
#   - a table drifts silently. This script used to pin 4.0.3 for `0.2.*`, which
#     was already wrong for 0.2.0-rc.2 (it peers ~4.0.4) and wrong for
#     0.2.1-alpha.1 (it peers ~4.0.5-alpha.1). The resulting npm conflict came
#     from the harness's own graph, but it surfaced as an install failure beside
#     this plugin and read like our bug.
#
# dsh-web carries the authoritative range, so read it there.
#
# @deepseek-ai/dsh-llm is installed explicitly, not for tests to import: dsh-web
# re-exports WebError extends HarnessError FROM dsh-llm, so without it
# `tsc` cannot resolve the base class and silently degrades it to an
# unconstructable `any` — typecheck then fails in a way that looks like a bug
# in this plugin. npm does not auto-install it (peer auto-install is off in
# these throwaway roots), so a clean machine needs it listed.
# cordis is pinned by install_version() at the FLOOR of what each dsh version
# asks for — `^4.0.2` becomes `4.0.2`, not `4.0.2`-as-a-range — and deliberately
# not at all by npm_installs(). Both choices were forced by measurement:
#
#   - install_version() must have cordis at the TOP LEVEL of node_modules,
#     because `tsc` resolves `import type { Context } from '@deepseek-ai/cordis'`
#     from src/. Left to the harness's own tree it lands nested and every
#     version fails with TS2307. Installing it explicitly also happens to be
#     what the older releases were published against.
#   - npm_installs() must NOT pin it. There the question is only whether the
#     plugin's peer range admits the host's cordis, and pinning the range
#     (`^4.0.2`) resolves to 4.0.4, which 0.1.5-alpha.1/alpha.2/rc.1/rc.2 were
#     not published against — the plugin then fails to install strictly and the
#     failure looks like ours. Omitting it lets the harness pick, which is the
#     resolution a real user gets; that is also the fallback for the host phase.
#
# So: read the range, take its floor as a concrete pin, and pass a range through
# nowhere. Passing the range itself is the bug this replaces.
#
# Beware the historical note this replaces: 0.1.5-rc.2 peers dsh-llm at
# ^0.1.5-rc.2, which was never published.
cordis_floor() {
  local v="$1" range
  range="$(npm view "@deepseek-ai/dsh-web@$v" peerDependencies --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s)["@deepseek-ai/cordis"]??"")}catch{process.stdout.write("")}})')"
  [ -z "$range" ] && return 0
  # ^4.0.2 / ~4.0.4 / >=4.0.5-alpha.1 / 4.0.2 -> the concrete version at the floor.
  printf '%s' "$range" | sed -E 's/^[[:space:]]*(\^|~|>=|=|>)?[[:space:]]*//' | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?'
}

VERSIONS=(
  0.1.2-alpha.2 0.1.2-alpha.3 0.1.2-alpha.4 0.1.2-alpha.5
  0.1.2-rc.1
  0.1.3-alpha.2
  0.1.5-alpha.1 0.1.5-alpha.2 0.1.5-rc.1 0.1.5-rc.2 0.1.5-rc.3
  0.1.6-alpha.1 0.1.6-alpha.2
  0.1.7-alpha.1
  0.2.0-rc.1 0.2.0-rc.2 0.2.1-alpha.1
)

install_version() {
  local v="$1" dir="$WORK_ROOT/v$1"
  mkdir -p "$dir"
  [ -f "$dir/package.json" ] || echo '{"name":"dsh-compat","private":true,"type":"module"}' > "$dir/package.json"
  # `--legacy-peer-deps` is load-bearing, not a shortcut. Some published dsh
  # versions carry internally unsatisfiable peer constraints — 0.1.5-rc.2 peers
  # dsh-llm@^0.1.5-rc.2 (never published), and 0.1.5-rc.3 peers cordis@4.0.2
  # exactly while its own sibling packages want ^4.0.3 — so a clean
  # `npm install` of the harness alone fails under npm's strict resolver, with
  # no involvement from this plugin. We are building a host to test against,
  # not validating the harness's own dependency graph.
  ( cd "$dir" && npm install --silent --no-audit --no-fund --legacy-peer-deps \
      "@deepseek-ai/dsh-web@$v" "@deepseek-ai/dsh-settings@$v" \
      "@deepseek-ai/dsh-launch-environment@$v" "@deepseek-ai/dsh-llm@$v" \
      "@deepseek-ai/cordis@$(cordis_floor "$v")" "@types/node@^22.19.0" ) \
    > "$WORK_ROOT/install-$v.log" 2>&1
}

verify_version() {
  local v="$1" src="$WORK_ROOT/v$1" run="$WORK_ROOT/run-$v"
  if [ ! -d "$src/node_modules" ]; then
    printf '%-16s SKIP   (deps not installed)\n' "$v"; return 2
  fi
  rm -rf "$run"; mkdir -p "$run"
  ln -s "$src/node_modules" "$run/node_modules"
  # Copy, never symlink: a symlinked lib/ resolves bare imports from the repo's
  # own node_modules and would silently test the wrong dsh version.
  local item
  for item in lib src test; do cp -R "$REPO_ROOT/$item" "$run/$item"; done
  for item in tsconfig.json package.json; do cp "$REPO_ROOT/$item" "$run/$item"; done

  local ts_out ts_state tests failed
  ts_out="$( cd "$run" && node "$TSC" --noEmit 2>&1 | head -3 )"
  ts_state=$([ -z "$ts_out" ] && echo OK || echo FAIL)
  tests="$( cd "$run" && node --test test/index.test.js 2>&1 \
    | grep -E '^# (pass|fail)|^ℹ (pass|fail)' | tr '\n' ' ' )"
  printf '%-16s tsc=%-5s %s\n' "$v" "$ts_state" "$tests"
  [ -n "$ts_out" ] && echo "      tsc: $(echo "$ts_out" | head -1)"

  failed="$(echo "$tests" | grep -oE 'fail [0-9]+' | grep -oE '[0-9]+' | head -1)"
  if [ "$ts_state" = FAIL ] || [ "${failed:-0}" != 0 ]; then return 1; fi
  return 0
}

# Whether npm — not just pnpm — will actually install the published tarball
# next to this dsh version.
#
# Worth checking separately because the two package managers disagree about
# pre-releases: pnpm accepted the old `>=0.1.2-rc.1` peer range on all 14
# versions while npm rejected it on 13 of them with ERESOLVE. Only an
# end-to-end `npm install` catches that, so this packs the real tarball and
# installs it.
#
# Deliberately two phases:
#   1. the host, with --legacy-peer-deps — several dsh releases have internally
#      unsatisfiable peers (0.1.7-alpha.1 wants cordis ^4.0.3 while its siblings
#      pin 4.0.2), which has nothing to do with this plugin
#   2. this plugin, WITHOUT that flag, so npm actually enforces the peer ranges
#      we ship. Installing the plugin loosely would make this check vacuous.
npm_installs() {
  local v="$1" pack="$WORK_ROOT/npm-pack" work
  mkdir -p "$pack"
  ( cd "$REPO_ROOT" && npm pack --pack-destination "$pack" >/dev/null 2>&1 )
  local tarball
  tarball="$(ls "$pack"/*.tgz 2>/dev/null | head -1)"
  if [ -z "$tarball" ]; then printf '%-16s npm pack failed\n' "$v"; return 1; fi
  work="$(mktemp -d)"

  # Phase 1: the host, letting the harness resolve its own cordis. Pinning it to
  # the peer range fails on the 0.1.5 line (see the note at cordis_floor), so it
  # is only added when the harness's own resolution cannot produce a tree.
  local host_ok
  ( cd "$work" && npm install --no-audit --no-fund --legacy-peer-deps \
      "@deepseek-ai/dsh-web@$v" "@deepseek-ai/dsh-settings@$v" \
      "@deepseek-ai/dsh-launch-environment@$v" "@deepseek-ai/dsh-llm@$v" >/dev/null 2>&1 ) \
    && host_ok=1 || host_ok=0
  if [ "$host_ok" != 1 ]; then
    local floor; floor="$(cordis_floor "$v")"
    if [ -n "$floor" ]; then
      ( cd "$work" && npm install --no-audit --no-fund --legacy-peer-deps \
          "@deepseek-ai/dsh-web@$v" "@deepseek-ai/dsh-settings@$v" \
          "@deepseek-ai/dsh-launch-environment@$v" "@deepseek-ai/dsh-llm@$v" \
          "@deepseek-ai/cordis@$floor" >/dev/null 2>&1 ) && host_ok=1 || host_ok=0
    fi
  fi

  # Phase 2: the plugin, installed STRICTLY (no --legacy-peer-deps), so npm
  # actually enforces the peer ranges we ship. Installing it loosely would make
  # this check vacuous — and the peer range is the thing that broke here.
  local plugin_ok
  ( cd "$work" && npm install --no-audit --no-fund "$tarball" >/dev/null 2>&1 ) \
    && plugin_ok=1 || plugin_ok=0
  if [ "$host_ok" = 1 ] && [ "$plugin_ok" = 1 ]; then
    printf '%-16s npm install OK\n' "$v"; rm -rf "$work"; return 0
  fi
  printf '%-16s npm install FAILED (host=%s plugin=%s)\n' "$v" "$host_ok" "$plugin_ok"
  rm -rf "$work"; return 1
}

main() {
  if [ ! -x "$(command -v node)" ]; then echo "node is required" >&2; exit 1; fi
  if [ ! -f "$TSC" ]; then echo "run 'pnpm install' first ($TSC missing)" >&2; exit 1; fi
  mkdir -p "$WORK_ROOT"
  local targets=("$@")
  if [ "${#targets[@]}" -eq 0 ]; then targets=("${VERSIONS[@]}"); fi
  echo "dsh cross-version matrix — $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  local failures=0 v
  for v in "${targets[@]}"; do
    install_version "$v" || { printf '%-16s INSTALL FAILED\n' "$v"; failures=$((failures + 1)); continue; }
    verify_version "$v" || failures=$((failures + 1))
    npm_installs "$v" || failures=$((failures + 1))
  done
  echo
  if [ "$failures" -eq 0 ]; then echo "all versions passed"; else echo "$failures version(s) failed"; fi
  return "$failures"
}

main "$@"
