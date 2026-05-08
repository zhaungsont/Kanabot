#!/usr/bin/env bash
# run_all.sh — Start Kanabot backend and frontend concurrently in local dev mode.
# Usage: bash run_all.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"

# ─── Colour helpers ───────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[run_all]${RESET} $*"; }
ok()   { echo -e "${GREEN}[run_all]${RESET} $*"; }
warn() { echo -e "${YELLOW}[run_all]${RESET} $*"; }
err()  { echo -e "${RED}[run_all]${RESET} $*" >&2; }

# ─── Load nvm ─────────────────────────────────────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
else
  err "nvm not found at $NVM_DIR. Please install nvm first."
  exit 1
fi

# ─── Switch to the project Node version ───────────────────────────────────────
log "Activating Node.js version from backend/.nvmrc ..."
cd "$BACKEND_DIR"
nvm use 2>/dev/null || nvm install
ok "Node $(node --version) active."

# ─── Install dependencies if needed ──────────────────────────────────────────
install_if_needed() {
  local dir="$1"
  local name="$2"
  if [ ! -d "$dir/node_modules" ]; then
    warn "$name: node_modules not found — running npm install..."
    (cd "$dir" && npm install)
    ok "$name: dependencies installed."
  fi
}

install_if_needed "$BACKEND_DIR"  "Backend"
install_if_needed "$FRONTEND_DIR" "Frontend"

# ─── Copy .env if not present ─────────────────────────────────────────────────
for dir in "$BACKEND_DIR" "$FRONTEND_DIR"; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "Created $dir/.env from .env.example"
  fi
done

# ─── Launch processes ─────────────────────────────────────────────────────────
log "Starting Backend  → http://localhost:3001"
log "Starting Frontend → http://localhost:5173"
echo ""

cleanup() {
  echo ""
  warn "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  ok "All processes stopped. Goodbye!"
}
trap cleanup INT TERM

(cd "$BACKEND_DIR"  && npm run dev) &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

ok "Both services running. Press Ctrl+C to stop."
wait "$BACKEND_PID" "$FRONTEND_PID"
