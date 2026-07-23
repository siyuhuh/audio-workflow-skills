#!/bin/zsh
set -euo pipefail

/usr/local/bin/tailscale serve --bg --yes 8766
/usr/local/bin/tailscale serve status
