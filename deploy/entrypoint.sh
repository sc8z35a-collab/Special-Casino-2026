#!/bin/sh
# Data volumes are often mounted owned by root: hand the data directory to
# the unprivileged "node" user, then run the server as that user (busybox su
# execs in place, so the server stays PID 1 and receives stop signals).
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec su -m -s /bin/sh -c 'exec "$0" "$@"' node -- "$@"
fi
exec "$@"
