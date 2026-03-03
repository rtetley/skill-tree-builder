#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build the Skill Tree Builder and deploy to a remote VM via SSH
# =============================================================================
# Usage:
#   ./deploy/deploy.sh [options]
#
# Required environment variables (or pass as arguments, see --help):
#   DEPLOY_HOST   Hostname or IP of the target VM
#   DEPLOY_USER   SSH user on the target VM  (default: deploy)
#   DEPLOY_KEY    Path to the SSH private key (default: ~/.ssh/id_rsa)
#
# What this script does:
#   1. Builds the app with `yarn build`
#   2. Copies dist/ to the VM with rsync over SSH
#   3. Sets correct ownership/permissions on the VM
#   4. Installs nginx (if not present) and drops the bundled nginx.conf
#   5. Enables and reloads nginx
# =============================================================================
set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[deploy]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${RESET} $*"; }
error()   { echo -e "${RED}[deploy] ERROR:${RESET} $*" >&2; exit 1; }

# ── Defaults ──────────────────────────────────────────────────────────────────
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_rsa}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/skill-tree-builder}"
NGINX_CONF_DEST="${NGINX_CONF_DEST:-/etc/nginx/sites-available/skill-tree-builder}"
NGINX_CONF_LINK="${NGINX_CONF_LINK:-/etc/nginx/sites-enabled/skill-tree-builder}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
show_help() {
  grep '^#' "$0" | grep -v '#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)    DEPLOY_HOST="$2"; shift 2 ;;
    --user)    DEPLOY_USER="$2"; shift 2 ;;
    --key)     DEPLOY_KEY="$2"; shift 2 ;;
    --port)    DEPLOY_PORT="$2"; shift 2 ;;
    --dir)     REMOTE_DIR="$2"; shift 2 ;;
    --help|-h) show_help ;;
    *) error "Unknown option: $1. Run with --help for usage." ;;
  esac
done

[[ -z "${DEPLOY_HOST:-}" ]] && error "DEPLOY_HOST is not set. Pass --host <ip> or export DEPLOY_HOST=<ip>"
[[ -f "$DEPLOY_KEY" ]]       || error "SSH key not found at $DEPLOY_KEY"

SSH_OPTS="-i $DEPLOY_KEY -p $DEPLOY_PORT -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
SSH="ssh $SSH_OPTS ${DEPLOY_USER}@${DEPLOY_HOST}"
RSYNC_SSH="ssh $SSH_OPTS"

# ── Step 1: Build ─────────────────────────────────────────────────────────────
info "Building the application…"
cd "$REPO_ROOT"
yarn build
info "Build complete → dist/"

# ── Step 2: Ensure remote directory exists ────────────────────────────────────
info "Preparing remote directory $REMOTE_DIR…"
$SSH "sudo mkdir -p $REMOTE_DIR && sudo chown ${DEPLOY_USER}:${DEPLOY_USER} $REMOTE_DIR"

# ── Step 3: Sync dist/ to VM ──────────────────────────────────────────────────
info "Syncing dist/ to ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}…"
rsync -az --delete \
  -e "$RSYNC_SSH" \
  "$REPO_ROOT/dist/" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/"
info "Files synced."

# ── Step 4: Install nginx (idempotent) ────────────────────────────────────────
info "Ensuring nginx is installed on the VM…"
$SSH "command -v nginx > /dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y nginx)"

# ── Step 5: Install nginx config ─────────────────────────────────────────────
info "Installing nginx configuration…"
# Upload the config
rsync -az \
  -e "$RSYNC_SSH" \
  "$SCRIPT_DIR/nginx.conf" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/skill-tree-builder.nginx.conf"

$SSH bash <<REMOTE
  set -euo pipefail
  sudo mv /tmp/skill-tree-builder.nginx.conf ${NGINX_CONF_DEST}

  # Update the document root in the config to match REMOTE_DIR
  sudo sed -i "s|root /var/www/skill-tree-builder;|root ${REMOTE_DIR};|g" ${NGINX_CONF_DEST}

  # Enable the site (remove default if present to avoid conflicts)
  sudo ln -sfn ${NGINX_CONF_DEST} ${NGINX_CONF_LINK}
  sudo rm -f /etc/nginx/sites-enabled/default

  sudo nginx -t
  sudo systemctl enable nginx
  sudo systemctl reload nginx || sudo systemctl start nginx
REMOTE

info "✅  Deployment complete!  http://${DEPLOY_HOST}"
