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

# cordis is pinned per dsh line rather than taken from `latest`. The 0.1.5 and
# 0.1.6 packages peer `@deepseek-ai/cordis` at an exact version (4.0.2) while
# `latest` has moved to 4.0.4, so resolving `latest` makes the harness's own
# siblings disagree and the plugin then cannot install strictly beside them —
# a host-side conflict that looks like ours from the outside. 0.1.7 moved to
# ^4.0.3, where the exact pin is gone.
#
# @deepseek-ai/dsh-llm is installed explicitly, not for tests to import: dsh-web
# re-exports WebError extends HarnessError FROM dsh-llm, so without it
# `tsc` cannot resolve the base class and silently degrades it to an
# unconstructable `any` — typecheck then fails in a way that looks like a bug
# in this plugin. npm does not auto-install it (peer auto-install is off in
# these throwaway roots), so a clean machine needs it listed.
#
# dsh >= 0.1.7 peers cordis ^4.0.3 while the cordis `latest` dist-tag still
# points at 4.0.2, so pin per version rather than trusting `latest`.
cordis_for() {
  case "$1" in
    0.1.7-*|0.1.8-*|0.2.*) echo 4.0.3 ;;
    *) echo 4.0.2 ;;
  esac
}

VERSIONS=(
  0.1.2-alpha.2 0.1.2-alpha.3 0.1.2-alpha.4 0.1.2-alpha.5
  0.1.2-rc.1
  0.1.3-alpha.2
  0.1.5-alpha.1 0.1.5-alpha.2 0.1.5-rc.1 0.1.5-rc.2 0.1.5-rc.3
  0.1.6-alpha.1 0.1.6-alpha.2
  0.1.7-alpha.1
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
      "@deepseek-ai/cordis@$(cordis_for "$v")" "@types/node@^22.19.0" ) \
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
  local cordis; cordis="$(cordis_for "$v")"
  node -e '
    const fs = require("node:fs");
    const [tarball, version, cordis, dir] = process.argv.slice(1);
    fs.writeFileSync(`${dir}/package.json`, JSON.stringify({
      name: "compat-npm", private: true, type: "module",
      dependencies: {
        "@tonydua/dsh-web-search-exa": `file:${tarball}`,
        "@deepseek-ai/dsh-web": version,
        "@deepseek-ai/dsh-settings": version,
        "@deepseek-ai/dsh-launch-environment": version,
        "@deepseek-ai/dsh-llm": version,
        "@deepseek-ai/cordis": cordis,
      },
    }, null, 2));
  ' "$tarball" "$v" "$cordis" "$work"
  local host_ok plugin_ok
  ( cd "$work" && npm install --no-audit --no-fund --legacy-peer-deps \
      "@deepseek-ai/dsh-web@$v" "@deepseek-ai/dsh-settings@$v" \
      "@deepseek-ai/dsh-launch-environment@$v" "@deepseek-ai/dsh-llm@$v" \
      "@deepseek-ai/cordis@$cordis" >/dev/null 2>&1 ) && host_ok=1 || host_ok=0
  # The plugin is installed on its own, strictly, so an unsatisfiable peer
  # range of ours is what fails here — not the host's own graph.
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
