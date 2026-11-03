#!/usr/bin/env bash
# Fresh local database for the screenshots: migrations, demo users, nothing else.
# Run from the root of the copy of the repo you run Tick from (not from a synced folder), with wrangler dev stopped:
#   bash docs/screenshots/src/reset.sh <state-dir> [demo-users.sql]
set -e
STATE=${1:?state dir}
USERS=${2:-$(dirname "$0")/demo-users.sql}
rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE" > /dev/null
npx wrangler d1 execute DB --local --persist-to "$STATE" --file "$USERS" > /dev/null
echo "reset: $STATE"
