#!/bin/bash
# Removes the Grocery Shopper app, its files and its store sign-ins.
set -euo pipefail
pkill -f "Grocery Shopper/shopper/server.js" 2>/dev/null || true
rm -rf "$HOME/Applications/Grocery Shopper.app" \
  "$HOME/Library/Application Support/Grocery Shopper" \
  "$HOME/Library/Logs/Grocery Shopper.log"
echo "Grocery Shopper is removed. Your Walmart and Sam's Club accounts and carts aren't affected."
