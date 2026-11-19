#!/bin/sh
# 在隔离的 DSH_HOME 里重新安装插件并启动 Web 版，不碰 ~/.dsh。用法：scripts/dev-sandbox.sh [端口]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${DSH_SANDBOX:-$ROOT/../.dsh-sandbox}"
PORT="${1:-4311}"
mkdir -p "$SANDBOX"
SANDBOX="$(cd "$SANDBOX" && pwd)"
cd "$ROOT"
npm run --silent build
unset DSH_SESSION_ID DSH_SHELL DSH_WEB_URL DSH_PROFILE DSH_PROFILE_DIR
export DSH_HOME="$SANDBOX"
command -v cygpath >/dev/null 2>&1 && DSH_HOME="$(cygpath -m "$SANDBOX")"
# Windows 上 dsh/pnpm 需要盘符路径（D:/…），MSYS 的 /d/… 会被当成相对当前盘。
SPEC="$ROOT"
command -v cygpath >/dev/null 2>&1 && SPEC="$(cygpath -m "$ROOT")"
dsh plugin --profile web remove dsh-writing-desk >/dev/null 2>&1 || true
dsh plugin --profile web add "file:$SPEC" >/dev/null
exec dsh --profile web --no-open --port "$PORT"
