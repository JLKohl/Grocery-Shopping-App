#!/bin/bash
# Installs Grocery Shopper as a Mac app in ~/Applications.
#
# Run it once from Terminal:  bash path/to/mac/install.sh
# Running it again updates the app and keeps your store sign-ins.
set -euo pipefail

APP_NAME="Grocery Shopper"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${GS_DEST:-$HOME/Library/Application Support/Grocery Shopper}"
APP="${GS_APP:-$HOME/Applications/$APP_NAME.app}"
PORT=4321

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

if [ "$(uname)" != "Darwin" ] && [ -z "${GS_ALLOW_NON_MAC:-}" ]; then
  fail "This installer is for macOS."
fi

step "Checking what's installed"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || fail "Node.js wasn't found. Install it from https://nodejs.org and run this again."
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js $NODE_MAJOR is too old. Install Node.js 18 or newer from https://nodejs.org."
command -v npx >/dev/null || fail "npx wasn't found. Reinstall Node.js from https://nodejs.org."
CLAUDE="$(command -v claude || true)"
[ -n "$CLAUDE" ] || fail "Claude Code wasn't found. Check that 'claude --version' works in Terminal, then run this again."
if [ -z "${GS_ALLOW_NON_MAC:-}" ] && [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  fail "Google Chrome wasn't found. Install it from https://www.google.com/chrome and run this again."
fi
echo "Node.js $("$NODE" --version), Claude Code at $CLAUDE, Google Chrome: found."

step "Copying Grocery Shopper to $DEST"
mkdir -p "$DEST"
if [ "$(cd "$DEST" && pwd)" != "$SRC" ]; then
  # Clear the old copy but keep the Chrome profile, so store sign-ins survive updates.
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name shopper -exec rm -rf {} +
  [ -d "$DEST/shopper" ] && find "$DEST/shopper" -mindepth 1 -maxdepth 1 ! -name .chrome-profile -exec rm -rf {} +
  (cd "$SRC" && tar -cf - --exclude node_modules --exclude .git --exclude dist \
    --exclude .chrome-profile --exclude .mcp.generated.json .) | (cd "$DEST" && tar -xf -)
fi

step "Installing parts (this can take a minute)"
(cd "$DEST" && npm install --no-audit --no-fund --loglevel=error)
# Download the browser tool now so the first shopping run starts quickly.
npx -y @playwright/mcp@0.0.82 --version >/dev/null 2>&1 || true

step "Building $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>local.grocery-shopper</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>GroceryShopper</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Apps opened from Finder don't get Terminal's PATH, so bake in the one that
# found node and claude just now.
{
  echo '#!/bin/bash'
  echo '# Starts the Grocery Shopper server in the background (if needed) and opens the page.'
  printf 'export PATH=%q\n' "$PATH"
  printf 'DEST=%q\n' "$DEST"
  printf 'NODE=%q\n' "$NODE"
  echo "URL=http://localhost:$PORT"
  cat <<'LAUNCHER'
if curl -fsS -m 2 "$URL/api/state" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi
LOG="$HOME/Library/Logs/Grocery Shopper.log"
mkdir -p "$(dirname "$LOG")"
cd "$DEST"
SHOPPER_IDLE_EXIT_MINUTES=60 nohup "$NODE" "$DEST/shopper/server.js" >>"$LOG" 2>&1 &
# The server opens the page itself once it's listening.
sleep 3
if ! curl -fsS -m 2 "$URL/api/state" >/dev/null 2>&1; then
  osascript -e 'display alert "Grocery Shopper couldn’t start" message "Details are in ~/Library/Logs/Grocery Shopper.log. Try running the installer again."' >/dev/null 2>&1 || true
fi
LAUNCHER
} > "$APP/Contents/MacOS/GroceryShopper"
chmod +x "$APP/Contents/MacOS/GroceryShopper"

# Build the app icon from mac/icon.png.
if command -v iconutil >/dev/null && command -v sips >/dev/null; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z $size $size "$DEST/mac/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z $double $double "$DEST/mac/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  touch "$APP"
fi

# Stop an older copy of the server so the new version is used next launch.
curl -fsS -m 2 "http://localhost:$PORT/api/state" >/dev/null 2>&1 && pkill -f "Grocery Shopper/shopper/server.js" || true

step "Done!"
echo "Grocery Shopper is in your Applications folder ($APP)."
echo "Open it from Launchpad or Spotlight. To add it to the Dock, drag it from your Applications folder in Finder into the Dock."
if [ -z "${GS_NO_OPEN:-}" ] && command -v open >/dev/null; then
  open "$APP"
fi
