#!/bin/bash
# Rebuilds and restarts the web server from a known directory, so the caller's
# working directory can never break the .env load.
set -e
cd /home/user/DM-Flow-
# The build must NOT inherit NODE_ENV=development from .env: next build under a
# non-production NODE_ENV fails while prerendering the error pages.
if [ "$1" != "--no-build" ]; then
  (cd apps/web && env -u NODE_ENV npx next build > /tmp/webbuild.log 2>&1) \
    || { tail -20 /tmp/webbuild.log; exit 1; }
fi
set -a; . ./.env; set +a
ps aux | grep "[n]ext-server" | awk '{print $2}' | xargs -r kill -9 || true
sleep 2
SP=/tmp/claude-0/-home-user-DM-Flow-/80f3ab05-3e95-5a2d-9bb7-eda89de14384/scratchpad
cd /home/user/DM-Flow-/apps/web
NODE_ENV=production nohup npx next start -p 3000 > "$SP/web.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w 'web:%{http_code}\n' http://localhost:3000/
