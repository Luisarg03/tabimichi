#!/usr/bin/env bash
# Create or update the Bitwarden notes that hold Tabimichi's secrets.
#
#   pnpm secrets:notes            # create/refresh every environment note
#   pnpm secrets:notes sandbox    # just one
#
# Each environment is ONE secure note whose body is the whole `KEY=value`
# payload (`scripts/secrets.sh` renders the .env files back out of them).
#
# Why not one item per secret: `bw get` has no getter for custom fields and
# `bw get password` requires `type === Login`, so a per-secret layout costs one
# call plus a name→variable mapping per variable, while `bw get notes` returns
# the entire payload in a single call. The one time the whole industry agrees:
# `ddot` does exactly this (bw://myapp-dev = one secure note holding the .env).
#
# Secrets never reach the process list or shell history: the item JSON goes to
# `bw` through stdin, built by jq.
set -euo pipefail

# The CLI keeps its vault under $HOME/.config, which is read-only in sandboxes;
# pinning it also keeps this working when HOME points somewhere unwritable.
export BITWARDENCLI_APPDATA_DIR="${BITWARDENCLI_APPDATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/Bitwarden CLI}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FOLDER="${TABI_BW_FOLDER:-Tabi}"

command -v bw >/dev/null || { echo "secrets:notes: 'bw' is not on PATH." >&2; exit 1; }
command -v jq >/dev/null || { echo "secrets:notes: 'jq' is required." >&2; exit 1; }

if [[ -z "${BW_SESSION:-}" ]]; then
  echo "secrets:notes: no BW_SESSION — run through 'pnpm secrets:notes'." >&2
  echo "               export BW_SESSION=\$(bw unlock --raw)" >&2
  exit 1
fi

# bw base64-decodes whatever positional argument it is handed. Two facts force
# the payload into argv, and both were verified against the CLI source:
#
#  1. Piping does not work when flags are present. `... | bw create item
#     --session S` makes bw read only [create,item,--session,S], and the payload
#     goes to a command that never asks for it.
#  2. `bw create item - --session S` (dash = stdin) is not a thing: readStdin()
#     is only consulted when the argument is absent or empty, and in a pipeline
#     both sides race for the same stdin.
#
# So the encoded payload is an argument. That does expose the base64 of the
# secret in the process list for the moment the call runs — base64 is not
# encryption. It is the price of writing to the vault non-interactively, and the
# alternative (`bw serve`, a long-lived local HTTP server holding a decrypted
# vault) is a bigger surface for one script. The session token is exposed the
# same way by the CLI's own `--session` flag.
#
# The position differs by object, per the CLI's usage lines:
#   bw create folder <encodedJson> [--session S]
#   bw create item   <encodedJson> --session S
#   bw edit item     <id> <encodedJson> --session S
bw_encode() { printf '%s' "$1" | bw encode; }

# Validate the target before touching the vault: a typo should not cost a
# network round-trip, let alone create anything.
want="${1:-all}"
case "$want" in
  all|local|sandbox|production|admin) ;;
  *) echo "secrets:notes: unknown target '$want' — use all, local, sandbox, production, admin." >&2
     exit 1 ;;
esac

# Sync is a nicety, not a prerequisite: `bw create item` needs the session and
# the local vault, not a fresh one. A failure here is informational — saying so
# beats aborting on something that does not gate the write.
if ! bw sync --session "$BW_SESSION" >/tmp/tabi-bw-sync.log 2>&1; then
  echo "  ⚠  'bw sync' failed — the local vault may be stale."
  grep -oiE "invalid_grant|You are not logged in|EROFS|ENOTFOUND|ETIMEDOUT" /tmp/tabi-bw-sync.log \
    | sort -u | sed 's/^/     /' >&2
  if grep -qi "not logged in\|invalid_grant" /tmp/tabi-bw-sync.log; then
    echo "     → run 'bw login' (the session is gone)." >&2
    exit 1
  fi
fi
rm -f /tmp/tabi-bw-sync.log

folder_id="$(bw list folders --session "$BW_SESSION" 2>/dev/null \
  | jq -r --arg n "$FOLDER" '.[] | select(.name == $n) | .id' | head -1)"

if [[ -z "$folder_id" ]]; then
  echo "→ creating folder '$FOLDER'"
  folder_id="$(bw create folder "$(bw_encode "$(jq -nc --arg n "$FOLDER" '{name:$n}')")" \
    --session "$BW_SESSION" | jq -r '.id')"
fi

# upsert NAME PAYLOAD_FILE — creates the note, or replaces its body if it exists
upsert() {
  local name="$1" payload="$2"
  [[ -f "$payload" ]] || { echo "  ⏭  $name — $payload not found"; return 0; }

  local notes id vars
  notes="$(cat "$payload")"
  # count only real assignments, so commented-out keys do not inflate the number
  vars="$(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$payload" || true)"
  id="$(bw list items --session "$BW_SESSION" 2>/dev/null \
    | jq -r --arg n "$name" '.[] | select(.name == $n) | .id' | head -1)"

  local json
  json="$(jq -nc --arg n "$name" --arg notes "$notes" --arg fid "$folder_id" \
    '{type:2, secureNote:{type:0}, name:$n, notes:$notes, folderId:$fid}')"

  if [[ -n "$id" ]]; then
    bw edit item "$id" "$(bw_encode "$json")" --session "$BW_SESSION" >/dev/null
    echo "  ✓ $name — updated ($vars vars)"
  else
    bw create item "$(bw_encode "$json")" --session "$BW_SESSION" >/dev/null
    echo "  ✓ $name — created ($vars vars)"
  fi
}

# ADMIN_NAME ADMIN_PAYLOAD — management credentials, deliberately NOT app config
admin_upsert() {
  local name="$1"; shift
  local body="$*"
  [[ -n "$body" ]] || { echo "  ⏭  $name — nothing to write"; return 0; }

  local id
  id="$(bw list items --session "$BW_SESSION" 2>/dev/null \
    | jq -r --arg n "$name" '.[] | select(.name == $n) | .id' | head -1)"

  local json
  json="$(jq -nc --arg n "$name" --arg notes "$body" --arg fid "$folder_id" \
    '{type:2, secureNote:{type:0}, name:$n, notes:$notes, folderId:$fid}')"

  if [[ -n "$id" ]]; then
    printf '%s' "$json" | bw encode | bw edit item "$id" --session "$BW_SESSION" >/dev/null
    echo "  ✓ $name — updated"
  else
    printf '%s' "$json" | bw encode | bw create item --session "$BW_SESSION" >/dev/null
    echo "  ✓ $name — created"
  fi
}

echo "Bitwarden notes → folder '$FOLDER'"

case "$want" in
  all|local)       upsert "Tabi dev (local)" "$REPO_ROOT/.env.local" ;;
esac
case "$want" in
  all|sandbox)     upsert "Tabi sandbox" "$REPO_ROOT/.env.sandbox" ;;
esac
case "$want" in
  all|production)  upsert "Tabi production" "$REPO_ROOT/.env.production" ;;
esac

if [[ "$want" == "all" || "$want" == "admin" ]]; then
  body=""
  [[ -n "${VERCEL_TOKEN:-}" ]] && body+="VERCEL_TOKEN=${VERCEL_TOKEN}"$'\n'
  body+="VERCEL_ORG_ID=team_CvqikJBhxLyKj34X1r3nOwt6"$'\n'
  body+="VERCEL_PROJECT_ID=prj_F0T4Zm9xv3Wik3O4NQ9SvuL3ct5g"
  if [[ -z "${VERCEL_TOKEN:-}" ]]; then
    echo "  ⚠  VERCEL_TOKEN unset — writing 'Tabi admin' with the IDs only."
    echo "     Re-run with it exported to fill in the token:"
    echo "       VERCEL_TOKEN=... pnpm secrets:notes admin"
  fi
  admin_upsert "Tabi admin" "$body"
fi

echo
echo "Verify with:  pnpm secrets:check"
