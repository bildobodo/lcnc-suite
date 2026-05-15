#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# lcnc-suite installer
#
# Checks for missing system dependencies, offers to install them
# via apt, then sets up the Python venv and Node.js packages.
#
# Usage:
#   ./install.sh [target-dir]   # default: current directory or ~/lcnc-suite
#
# The script will prompt for sudo when system packages are needed.
# ============================================================

# Don't run the whole script as root — only the apt parts need sudo
if [[ "$EUID" -eq 0 ]]; then
  echo "ERROR: Do not run this script as root or with sudo."
  echo "       Run as your normal user:  ./install.sh"
  echo "       The script will call sudo internally when needed."
  exit 1
fi

NODE_MAJOR_MIN=18
PY_MINOR_MIN=9

# If run from inside the repo, use that as target; otherwise default to ~/lcnc-suite
if [[ -f "$(pwd)/restart.sh" && -d "$(pwd)/lcnc-gateway" ]]; then
  TARGET_DIR="$(pwd)"
else
  TARGET_DIR="${1:-$HOME/lcnc-suite}"
fi

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
info() { echo -e "  ${YELLOW}→${NC} $*"; }
step() { echo -e "\n${BOLD}[$1/$TOTAL_STEPS] $2${NC}"; }

TOTAL_STEPS=4

# ============================================================
# Step 1: Check system dependencies
# ============================================================
step 1 "Checking system dependencies"

APT_PACKAGES=()    # packages installable via apt
MANUAL_FIXES=()    # problems the user must fix manually

# --- git ---
if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  APT_PACKAGES+=(git)
  fail "git — will install"
fi

# --- git-lfs ---
if git lfs version >/dev/null 2>&1; then
  ok "git-lfs $(git lfs version | awk '{print $1}' | cut -d/ -f2)"
else
  APT_PACKAGES+=(git-lfs)
  fail "git-lfs — will install"
fi

# --- python3 >= 3.x ---
if command -v python3 >/dev/null 2>&1; then
  PY_VER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  PY_MAJOR="$(echo "$PY_VER" | cut -d. -f1)"
  PY_MINOR="$(echo "$PY_VER" | cut -d. -f2)"
  if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge "$PY_MINOR_MIN" ]]; then
    ok "python3 $PY_VER"
  else
    MANUAL_FIXES+=("python3 $PY_VER found, but >= 3.$PY_MINOR_MIN required — upgrade your system Python")
    fail "python3 $PY_VER (need >= 3.$PY_MINOR_MIN)"
  fi
else
  APT_PACKAGES+=(python3)
  fail "python3 — will install"
fi

# --- python3-venv ---
# `python3 -m venv --help` succeeds on Debian even when ensurepip is missing,
# so actually try creating a throwaway venv — that's the authoritative check.
_venv_probe="$(mktemp -d)"
if python3 -m venv "$_venv_probe/v" >/dev/null 2>&1; then
  ok "python3-venv"
else
  # Debian/Ubuntu ship venv as a versioned package (python3.13-venv, etc.).
  if [[ -n "${PY_MINOR:-}" ]]; then
    APT_PACKAGES+=("python3.${PY_MINOR}-venv")
    fail "python3-venv — will install python3.${PY_MINOR}-venv"
  else
    APT_PACKAGES+=(python3-venv)
    fail "python3-venv — will install"
  fi
fi
rm -rf "$_venv_probe"

# --- curl (needed for nodesource setup) ---
if ! command -v curl >/dev/null 2>&1; then
  APT_PACKAGES+=(curl)
fi

# --- node >= 18 ---
NEED_NODE=0
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | tr -d 'v')"
  NODE_MAJOR="$(echo "$NODE_VER" | cut -d. -f1)"
  if [[ "$NODE_MAJOR" -ge "$NODE_MAJOR_MIN" ]]; then
    ok "node v$NODE_VER"
  else
    warn "node v$NODE_VER found, but >= $NODE_MAJOR_MIN required — will install from nodesource"
    NEED_NODE=1
  fi
else
  fail "node — will install from nodesource"
  NEED_NODE=1
fi

# --- npm (comes with node) ---
if [[ "$NEED_NODE" -eq 0 ]]; then
  if command -v npm >/dev/null 2>&1; then
    ok "npm $(npm -v)"
  else
    warn "npm not found — will install with node"
    NEED_NODE=1
  fi
fi

# --- linuxcnc python bindings ---
if python3 -c "import linuxcnc" 2>/dev/null; then
  ok "linuxcnc python bindings"
else
  MANUAL_FIXES+=("linuxcnc python bindings not found — install LinuxCNC 2.8+ first")
  fail "linuxcnc python bindings (requires LinuxCNC)"
fi

# --- scipy (system Python — compensation.py runs under halcmd before the
#     launcher activates the venv, so this must be on the system path)
if python3 -c "import scipy" 2>/dev/null; then
  ok "scipy"
else
  APT_PACKAGES+=(python3-scipy)
  fail "scipy — will install (python3-scipy)"
fi

# ============================================================
# Step 2: Install missing dependencies
# ============================================================
step 2 "Installing missing dependencies"

# Bail on manual-only issues
if [[ ${#MANUAL_FIXES[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}${BOLD}The following issues must be fixed manually:${NC}"
  for fix in "${MANUAL_FIXES[@]}"; do
    echo -e "    ${RED}•${NC} $fix"
  done
  echo ""
  echo -e "  Fix these and re-run ./install.sh"
  exit 1
fi

# Collect what needs installing
HAS_WORK=0

if [[ ${#APT_PACKAGES[@]} -gt 0 ]]; then
  HAS_WORK=1
fi
if [[ "$NEED_NODE" -eq 1 ]]; then
  HAS_WORK=1
fi

if [[ "$HAS_WORK" -eq 0 ]]; then
  ok "All system dependencies already installed"
else
  echo ""
  echo -e "  ${BOLD}The following will be installed:${NC}"
  if [[ ${#APT_PACKAGES[@]} -gt 0 ]]; then
    echo -e "    ${YELLOW}apt:${NC}  ${APT_PACKAGES[*]}"
  fi
  if [[ "$NEED_NODE" -eq 1 ]]; then
    echo -e "    ${YELLOW}nodesource:${NC}  nodejs (v22.x LTS)"
  fi
  echo ""
  read -rp "  Install these packages? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo -e "  ${RED}Aborted.${NC}"
    exit 1
  fi

  # Install apt packages
  if [[ ${#APT_PACKAGES[@]} -gt 0 ]]; then
    info "Installing apt packages: ${APT_PACKAGES[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y -qq "${APT_PACKAGES[@]}"
    ok "apt packages installed"
  fi

  # Install git-lfs hooks if just installed
  if [[ " ${APT_PACKAGES[*]} " == *" git-lfs "* ]]; then
    git lfs install
    ok "git-lfs initialized"
  fi

  # Install Node.js from nodesource
  if [[ "$NEED_NODE" -eq 1 ]]; then
    info "Installing Node.js 22.x LTS from nodesource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
    ok "node $(node -v), npm $(npm -v)"
  fi
fi

# ============================================================
# Step 3: Setup project dependencies
# ============================================================
step 3 "Setting up project dependencies"

if [[ ! -d "$TARGET_DIR/lcnc-gateway" ]]; then
  fail "lcnc-suite not found at $TARGET_DIR"
  echo -e "  Clone the repository first:"
  echo -e "    git clone <repo-url> $TARGET_DIR"
  exit 1
fi

cd "$TARGET_DIR"

# Fetch LFS objects if in a git repo
if [[ -d ".git" ]]; then
  info "Fetching Git LFS objects..."
  git lfs pull
  ok "LFS objects ready"
fi

# --- Python venv ---
VENV_DIR="$TARGET_DIR/lcnc-gateway/.venv"
REQ_FILE="$TARGET_DIR/lcnc-gateway/requirements.txt"

if [[ ! -f "$REQ_FILE" ]]; then
  fail "requirements.txt not found at $REQ_FILE"
  exit 1
fi

info "Creating Python venv (with system-site-packages for linuxcnc bindings)..."
rm -rf "$VENV_DIR"
python3 -m venv "$VENV_DIR" --system-site-packages

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

info "Upgrading pip..."
python3 -m pip install -U pip --quiet

info "Installing Python dependencies..."
python3 -m pip install -r "$REQ_FILE" --quiet

info "Verifying Python imports..."
if python3 -c "import linuxcnc, fastapi, uvicorn" 2>/dev/null; then
  ok "Python environment ready"
else
  warn "Some Python imports failed — gateway may not start correctly"
fi

deactivate

# --- Node.js packages ---
info "Installing Node.js dependencies..."
cd "$TARGET_DIR/lcnc-webui"
npm install --loglevel=warn
ok "Node.js dependencies installed"

cd "$TARGET_DIR"

# ============================================================
# Step 4: Done
# ============================================================
step 4 "Installation complete"

echo -e "
  ${GREEN}${BOLD}lcnc-suite installed successfully!${NC}

  ${BOLD}Location:${NC}  $TARGET_DIR

  ${BOLD}Next steps:${NC}

    1. Build the frontend:
       cd $TARGET_DIR/lcnc-webui && npm run build

    2. Symlink launcher to PATH:
       mkdir -p ~/.local/bin
       ln -sf $TARGET_DIR/lcnc-suite ~/.local/bin/lcnc-suite

    3. Add to your INI [DISPLAY] section:
       DISPLAY = lcnc-suite
       WEBUI_HOST = 0.0.0.0
       WEBUI_PORT = 8000
       WEBUI_BROWSER = 1
       WEBUI_DEV = 0

    4. Add HAL safety chain (copy + add to INI [HAL]):
       cp $TARGET_DIR/examples/sim_config/hallib/lcnc_webui.hal /your/config/hallib/
       # Add to INI: HALFILE = hallib/lcnc_webui.hal

    5. Start:
       linuxcnc your_machine.ini

  ${BOLD}See README.md for full configuration details.${NC}
"
