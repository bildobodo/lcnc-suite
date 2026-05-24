#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# lcnc-suite installer
#
# Checks for missing system dependencies, offers to install them
# via apt, then clones the repo (if needed), sets up the Python
# venv and Node.js packages, and drops a sample sim config into
# ~/linuxcnc/configs/lcnc_suite_sim/ so you can boot LinuxCNC
# immediately.
#
# Usage:
#   # From a fresh machine (no clone yet) — one-line bootstrap:
#   wget -O install.sh https://raw.githubusercontent.com/bildobodo/lcnc-suite/main/install.sh && bash install.sh
#
#   # Or inside an existing clone:
#   ./install.sh [target-dir]   # default: current dir if a clone, else ~/lcnc-suite
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
REPO_URL="https://github.com/bildobodo/lcnc-suite.git"
SIM_CONFIG_DIR="$HOME/linuxcnc/configs/lcnc_suite_sim"

# Resolve TARGET_DIR:
#   1. If running from inside an existing clone, use it.
#   2. Else use the first positional arg, defaulting to ~/lcnc-suite.
# If TARGET_DIR is not yet a clone, step 3 will git-clone into it.
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

TOTAL_STEPS=6

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
# Step 3: Clone repo if needed (bootstrap mode)
# ============================================================
step 3 "Fetching lcnc-suite source"

if [[ -d "$TARGET_DIR/lcnc-gateway" ]]; then
  ok "lcnc-suite already present at $TARGET_DIR"
else
  # Refuse to clone into a non-empty directory that isn't a clone — protects
  # the user from a half-populated TARGET_DIR (e.g. they ran the installer
  # from a dir holding unrelated files).
  if [[ -d "$TARGET_DIR" ]] && [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]]; then
    fail "$TARGET_DIR exists and is not empty — refusing to clone over it"
    echo -e "  Either remove the directory, choose a different target,"
    echo -e "    or run the installer from inside an existing clone."
    exit 1
  fi

  info "Cloning $REPO_URL → $TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
  ok "Repo cloned"
fi

cd "$TARGET_DIR"

# ============================================================
# Step 4: Setup project dependencies
# ============================================================
step 4 "Setting up project dependencies"

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

# --- Symlinks ---
# Put the launcher and the three HAL helpers on PATH so halcmd / haltcl /
# LinuxCNC's DISPLAY launcher all resolve them via execvp, independent of
# clone location and TWOPASS mode. Removes the need for $(HOME)/$::env(HOME)
# substitution gymnastics in HAL files.
info "Installing symlinks to ~/.local/bin..."
mkdir -p "$HOME/.local/bin"
ln -sf "$TARGET_DIR/lcnc-suite"                                   "$HOME/.local/bin/lcnc-suite"
ln -sf "$TARGET_DIR/lcnc-gateway/hal_watchdog.py"                 "$HOME/.local/bin/hal_watchdog.py"
ln -sf "$TARGET_DIR/lcnc-gateway/hal_reader.py"                   "$HOME/.local/bin/hal_reader.py"
ln -sf "$TARGET_DIR/subroutines/surfacemap/compensation.py"       "$HOME/.local/bin/compensation.py"
ok "Symlinks installed (lcnc-suite, hal_watchdog.py, hal_reader.py, compensation.py)"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) warn '~/.local/bin is not on PATH — add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc' ;;
esac

# ============================================================
# Step 5: Install sample sim config
# ============================================================
step 5 "Installing sample sim config"

if [[ -d "$SIM_CONFIG_DIR" ]]; then
  ok "Sim config already present at $SIM_CONFIG_DIR — skipping (delete to reinstall)"
else
  info "Copying sample sim config → $SIM_CONFIG_DIR"
  mkdir -p "$(dirname "$SIM_CONFIG_DIR")"
  cp -r "$TARGET_DIR/examples/sim_config" "$SIM_CONFIG_DIR"
  ok "Sim config installed (INI, HAL files, seeded sim.var)"
fi

# ============================================================
# Step 6: Done
# ============================================================
step 6 "Installation complete"

echo -e "
  ${GREEN}${BOLD}lcnc-suite installed successfully!${NC}

  ${BOLD}Location:${NC}    $TARGET_DIR
  ${BOLD}Sim config:${NC}  $SIM_CONFIG_DIR

  ${BOLD}Next steps:${NC}

    1. Build the frontend:
       cd $TARGET_DIR/lcnc-webui && npm run build

    2. Try the sim:
       linuxcnc $SIM_CONFIG_DIR/lcnc_suite_sim.ini

    3. Adjust the sample config for your real machine:
       - Copy $SIM_CONFIG_DIR/ to a new dir under ~/linuxcnc/configs/
       - Edit lcnc_suite_sim.ini (axis limits, kinematics, HAL files)
       - Keep the [DISPLAY] WEBUI_* lines and the lcnc_webui.hal include

  ${BOLD}See README.md for full configuration details.${NC}
"
