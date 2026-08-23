#!/bin/bash
# Brings the whole local stack back up. The container hibernates between turns,
# which stops Postgres and Redis, so this is needed more often than it should be.
cd /home/user/DM-Flow-
pg_isready -q 2>/dev/null || (pg_ctlcluster 16 main start 2>/dev/null || service postgresql start >/dev/null 2>&1)
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --save '' --appendonly no >/dev/null 2>&1
sleep 3
set -a; . ./.env; set +a
SP=/tmp/claude-0/-home-user-DM-Flow-/80f3ab05-3e95-5a2d-9bb7-eda89de14384/scratchpad
# setsid, not just nohup: without its own session these die with the shell that
# started them, which is why the API kept vanishing right after logging that it
# had started.
# Always restarted, never merely ensured: an API process that survived from
# before the last build keeps serving the old code, and answers 404 for routes
# that do exist — which reads exactly like a bug in the new code.
pkill -f "dist/main.j[s]" 2>/dev/null
pkill -f "dist/worker.j[s]" 2>/dev/null
sleep 1
setsid node apps/api/dist/main.js > "$SP/prod-api.log" 2>&1 < /dev/null &
setsid node apps/api/dist/worker.js > "$SP/prod-worker.log" 2>&1 < /dev/null &
pgrep -f "next-serve[r]" >/dev/null || (cd apps/web && NODE_ENV=production setsid npx next start -p 3000 > "$SP/web.log" 2>&1 < /dev/null &)
sleep 8
echo -n "postgres: "; pg_isready | tail -1
echo -n "redis: "; redis-cli ping
echo -n "api: "; curl -s -m 5 http://localhost:4000/health/ready || echo FALHOU
echo
curl -s -o /dev/null -m 5 -w 'web: %{http_code}\n' http://localhost:3000/
