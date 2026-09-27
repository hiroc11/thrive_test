#!/bin/sh
# 起動スクリプト。Fly.io のボリュームは root の持ち物としてつながるので、
# root で起動したときだけデータフォルダを node ユーザーに渡してから、node ユーザーでサーバーを動かす
set -e
DATA_DIR="$(dirname "${DB_FILE:-/app/server/data/puku.db}")"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning /app/server/src/server.js
fi
exec node --disable-warning=ExperimentalWarning /app/server/src/server.js
