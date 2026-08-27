#!/bin/sh
set -e

# Start Fastify API on port 3001
PORT=3001 node /app/apps/api/dist/index.js &
API_PID=$!

# Start Next.js standalone on port 3000
PORT=3000 node /app/apps/web/server.js &
WEB_PID=$!

# Start Caddy
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

# Forward SIGTERM/SIGINT (container stop) to all three so each can shut down gracefully.
trap 'kill -TERM $API_PID $WEB_PID $CADDY_PID 2>/dev/null' TERM INT

# If any one of the three dies, bring the whole container down so `restart: unless-stopped`
# can detect and recover. Previously Caddy ran as PID 1 via `exec`: if the API process alone
# crashed (e.g. lost a startup race against the database), Caddy stayed up, the container kept
# reporting "running", and the scheduler/notifier silently never came back.
while kill -0 $API_PID 2>/dev/null && kill -0 $WEB_PID 2>/dev/null && kill -0 $CADDY_PID 2>/dev/null; do
  sleep 2
done

kill $API_PID $WEB_PID $CADDY_PID 2>/dev/null
exit 1
