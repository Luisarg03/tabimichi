#!/usr/bin/env bash
# Unlock Bitwarden and render an .env file from the vault.
#
#   pnpm secrets                    # .env.local       from "Tabi/local"
#   pnpm secrets sandbox            # .env.sandbox     from "Tabi/sandbox"
#   pnpm secrets production --check # verify, change nothing
#
# Runs `bw unlock` in this process only: the session never lands on disk and
# never in your shell history. Export BW_SESSION to skip the prompt.
set -euo pipefail

command -v bw >/dev/null || {
  echo "secrets: 'bw' is not on PATH. Install it: https://bitwarden.com/help/cli/" >&2
  exit 1
}

if [[ -z "${BW_SESSION:-}" ]]; then
  status="$(bw status 2>/dev/null | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')"
  case "$status" in
    unauthenticated)
      echo "secrets: no Bitwarden session. Run 'bw login' first." >&2
      exit 1
      ;;
    locked)
      echo "Unlocking Bitwarden…" >&2
      BW_SESSION="$(bw unlock --raw)"
      export BW_SESSION
      ;;
    *)
      echo "secrets: unexpected 'bw status' output — run 'bw status' yourself." >&2
      exit 1
      ;;
  esac
fi

exec node "$(dirname "$0")/secrets.mjs" "$@"
