#!/usr/bin/env bash
# scripts/check-no-secrets.sh
#
# Pre-commit safety net: scans the staged diff for credential-shaped
# content and fails the commit if anything matches.
#
# Install once per clone:
#   ln -s ../../scripts/check-no-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or run manually before pushing:
#   ./scripts/check-no-secrets.sh
#
# The patterns are deliberately conservative — a few false positives
# (forcing a manual --no-verify) is much cheaper than one real credential
# making it into the public repo.

set -euo pipefail

# 1. Block credential-shaped filenames being added to the index.
bad_files=$(
  git diff --cached --name-only --diff-filter=A 2>/dev/null \
    | grep -iE '(^|/)\.dev\.vars$|(^|/)\.env(\..*)?$|service.account\.json$|sa[-_]?key.*\.json$|kubeconfig(\..*)?$|credentials?\.json$' || true
)
if [ -n "$bad_files" ]; then
  echo "❌ check-no-secrets: refusing to commit credential-shaped filenames:" >&2
  echo "$bad_files" >&2
  echo "Move the file out of the tree or extend .gitignore, then re-stage." >&2
  exit 1
fi

# 2. Block credential-shaped strings in staged content.
#    Token patterns: GitHub PATs, fine-grained PATs, OAuth tokens, OpenAI
#    keys, Bearer JWTs, and the obvious private-key header.
#
#    Allowlist: this script itself (its grep pattern contains literal
#    credential prefixes as documentation of what to block) and the
#    .dev.vars.example template (placeholder values, no real secrets).
matches=$(
  git diff --cached -U0 \
    -- ':(exclude)scripts/check-no-secrets.sh' ':(exclude)worker/.dev.vars.example' \
    2>/dev/null \
    | grep -E '^\+' \
    | grep -vE '^\+\+\+ ' \
    | grep -iE '(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|"private_key":\s*"-----BEGIN|Bearer [A-Za-z0-9._-]{40,})' \
    || true
)
if [ -n "$matches" ]; then
  echo "❌ check-no-secrets: refusing to commit credential-shaped strings:" >&2
  echo "$matches" | head -5 >&2
  echo "(Showing first 5 matches.) Rotate the credential, scrub the diff, then re-stage." >&2
  exit 1
fi

exit 0
