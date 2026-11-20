#!/usr/bin/env bash
# Install the WeRead reading-notes plugin (读书问答模式 and 读书整理模式) into a DSH profile.
# See install-dadventures.ps1 for the full description.
#   bash dsh/scripts/install-dadventures.sh [--profile NAME] [--models-from PROFILE]
set -euo pipefail

DSH_VERSION="0.2.0-rc.2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/dsh/packages/dsh-weread-kb"
PROFILE_NAME="dadventures"
MODELS_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE_NAME="$2"; shift 2 ;;
    --models-from) MODELS_FROM="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "${DSH_HOME:-}" in
  "") DSH_HOME_DIR="$HOME/.dsh" ;;
  "~") DSH_HOME_DIR="$HOME" ;;
  "~/"*) DSH_HOME_DIR="$HOME/${DSH_HOME#~/}" ;;
  *) DSH_HOME_DIR="$DSH_HOME" ;;
esac
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE_NAME"

command -v node >/dev/null || { echo "Node.js LTS (>= 24) is required." >&2; exit 1; }
[ "$(node --version | sed 's/^v//; s/\..*//')" -ge 24 ] || { echo "Node.js >= 24 is required." >&2; exit 1; }
command -v dsh >/dev/null || {
  echo "DeepSeek Harness is not installed. Install it first: npm install -g @deepseek-ai/dsh@$DSH_VERSION" >&2; exit 1; }
[ "$(dsh --version | tr -d '[:space:]')" = "$DSH_VERSION" ] || {
  echo "The plugin is tested with DSH $DSH_VERSION; the existing DSH installation was not changed." >&2; exit 1; }
if [ -n "$MODELS_FROM" ] && [ ! -f "$DSH_HOME_DIR/profiles/$MODELS_FROM/cordis.patch.yml" ]; then
  echo "Profile $MODELS_FROM (for --models-from) has no cordis.patch.yml under $DSH_HOME_DIR/profiles." >&2; exit 1
fi

CREATED=""
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  dsh --profile "$PROFILE_NAME" --from-default-profile web --dump-config >/dev/null
  CREATED="--select-default"
fi

dsh plugin --profile "$PROFILE_NAME" add --force "file:$PLUGIN_DIR"

CONFIG_ARGS=("$SCRIPT_DIR/profile-config.js" "$PROFILE_DIR" "$REPO_ROOT")
[ -n "$CREATED" ] && CONFIG_ARGS+=("$CREATED")
[ -n "$MODELS_FROM" ] && CONFIG_ARGS+=("--models-from" "$DSH_HOME_DIR/profiles/$MODELS_FROM")
node "${CONFIG_ARGS[@]}"

DUMP="$(dsh --profile "$PROFILE_NAME" --dump-config)"
for ROW in weread-kb preset-wereadask preset-wereadkb; do
  case "$DUMP" in
    *"$ROW"*) ;;
    *) echo "The profile $PROFILE_NAME does not compose $ROW; check $PROFILE_DIR/cordis.patch.yml." >&2; exit 1 ;;
  esac
done

echo "Installed from: $PLUGIN_DIR"
echo "Profile:        $PROFILE_DIR"
[ -n "$CREATED" ] && [ -z "$MODELS_FROM" ] && echo "This new profile has no model yet: set it up in DSH Web, or rerun with --models-from <profile>."
echo "读书问答模式（只读）和读书整理模式已加入。整理模式的会话目录请选 $REPO_ROOT，文件工具才能写卡片。"
echo "Restart DSH Web, then pick a mode in a new session. Start it with:"
echo "  dsh --profile $PROFILE_NAME --port 3091"
