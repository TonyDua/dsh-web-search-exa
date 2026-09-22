#!/usr/bin/env bash
# Post-publish verification: install the plugin from the real npm registry and
# prove it works end to end in a live dsh process.
#
# Run AFTER `npm publish`. Checks, in order:
#   1. the published version resolves from the registry
#   2. `dsh plugin add` installs it into a scratch profile
#   3. a headless dsh task actually searches through the anonymous MCP path,
#      with no EXA_API_KEY anywhere in the environment
#
# Usage: bash scripts/verify-publish.sh [version]
set -uo pipefail

VERSION="${1:-0.1.5}"
PKG="@tonydua/dsh-web-search-exa"
PROFILE="publishcheck"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

note() { printf '\n=== %s ===\n' "$1"; }

note "1. registry metadata for $PKG@$VERSION"
META=$(curl -s --max-time 25 "https://registry.npmjs.org/$PKG")
if [ -z "$META" ]; then echo "FAIL: registry unreachable"; exit 1; fi
echo "$META" | python3 -c "
import json,sys
d=json.load(sys.stdin)
v='$VERSION'
vers=list(d['versions'])
print('published versions:', vers)
if v not in vers:
    print(f'FAIL: {v} is not published yet'); raise SystemExit(1)
info=d['versions'][v]
print('dist tarball     :', info['dist']['tarball'])
print('dist-tags        :', d['dist-tags'])
print('peer (dsh-web)   :', info.get('peerDependencies',{}).get('@deepseek-ai/dsh-web'))
print('OK: version present')
" || exit 1

note "2. install into a scratch dsh profile"
rm -rf "$DSH_HOME/profiles/$PROFILE"
( cd /tmp && dsh --profile "$PROFILE" --from-default-profile headless --help >/dev/null 2>&1 )
( cd "$DSH_HOME/profiles/$PROFILE" && dsh plugin --profile "$PROFILE" add "$PKG@$VERSION" 2>&1 | tail -4 )
INSTALLED=$(python3 -c "
import json,os
p=os.path.join('$DSH_HOME','profiles','$PROFILE','node_modules','@tonydua','dsh-web-search-exa','package.json')
print(json.load(open(p))['version'] if os.path.exists(p) else 'MISSING')" 2>/dev/null)
echo "installed version: $INSTALLED"
[ "$INSTALLED" = "$VERSION" ] || { echo "FAIL: expected $VERSION, got $INSTALLED"; exit 1; }

note "3. point the scratch profile at exa"
cat > "$DSH_HOME/profiles/$PROFILE/cordis.patch.yml" <<'YAML'
- id: web
  config:
    searchProvider: exa
    fetchProvider: http
YAML

note "4. live headless search with NO api key in the environment"
env -u EXA_API_KEY -u DEEPSEEK_API_KEY dsh --profile "$PROFILE" \
  "Call the web_search tool once with query 'deepseek harness plugin'. Report ONLY the number of sources." \
  2>/tmp/verify-publish-stderr.log
echo "--- loader errors (empty is good) ---"
grep -i -E "error|duplicate|unavailable" /tmp/verify-publish-stderr.log | head -5

note "done"
echo "Scratch profile: $DSH_HOME/profiles/$PROFILE (remove with: rm -rf \"$DSH_HOME/profiles/$PROFILE\")"
