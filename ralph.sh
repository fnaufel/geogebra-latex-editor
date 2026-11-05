#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run from the target repository. The script itself may live elsewhere.
die() {
    printf 'ralph: %s\n' "$*" >&2
    exit 1
}

for command in git gh codex jq awk flock sha256sum mktemp sort tail; do
    command -v "$command" >/dev/null 2>&1 || die "Missing command: $command"
done

repo_root=$(git rev-parse --show-toplevel) || die "Run this from a Git repository."
cd "$repo_root"
repo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner') || die "Cannot identify the GitHub repository."
[[ -n "$repo" ]] || die "Cannot identify the GitHub repository."

# A lock outside the checkout does not make git status dirty.
lock_key=$(printf '%s' "$repo_root" | sha256sum)
lock_file="${TMPDIR:-/tmp}/ralph-${lock_key%% *}.lock"
exec 9>"$lock_file"
flock -n 9 || die "Another Ralph run is using this checkout."

branch=$(git symbolic-ref --quiet --short HEAD) || die "Check out a branch before running Ralph."

require_clean_tree() {
    [[ -z $(git status --porcelain) ]] || die "Working tree is not clean. Refusing to continue."
}

issue_json() {
    gh issue view "$1" --repo "$repo" --json number,title,state,body,labels
}

issue_state() {
    gh issue view "$1" --repo "$repo" --json state --jq '.state'
}

is_implementation_ticket() {
    jq -e '
        (.body // "" | test("(?m)^## What to build[[:space:]]*$")) and
        (.body // "" | test("(?m)^## Blocked by[[:space:]]*$"))
    ' >/dev/null
}

issue_blockers() {
    awk '
        /^## Blocked by[[:space:]]*$/ { section = 1; found = 1; next }
        section && /^##[[:space:]]/ { exit }
        section {
            rest = $0
            while (match(rest, /#[0-9]+/)) {
                print substr(rest, RSTART + 1, RLENGTH - 1)
                rest = substr(rest, RSTART + RLENGTH)
            }
        }
        END { if (!found) exit 2 }
    '
}

require_clean_tree

tickets=()
if (($# > 0)); then
    declare -A seen=()
    for issue in "$@"; do
        [[ "$issue" =~ ^[1-9][0-9]*$ ]] || die "Invalid issue number: $issue"
        if [[ -z ${seen[$issue]+x} ]]; then
            tickets+=("$issue")
            seen[$issue]=1
        fi
    done
else
    # Snapshot open agent-ready implementation tickets. Parent and human-only
    # issues are excluded by the label and the What to build section. A ticket
    # missing its Blocked by section fails validation below.
    listing=$(gh api --paginate --method GET \
        "repos/$repo/issues?state=open&labels=ready-for-agent&per_page=100") || die "Cannot list open issues."
    numbers=$(jq -r '
        .[] |
        select(.pull_request == null) |
        select(.labels | any(.name == "ready-for-agent")) |
        select(.body // "" | test("(?m)^## What to build[[:space:]]*$")) |
        .number
    ' <<< "$listing" | sort -n -u) || die "Cannot parse open issues."
    if [[ -n "$numbers" ]]; then
        mapfile -t tickets <<< "$numbers"
    fi
fi

if ((${#tickets[@]} == 0)); then
    echo "No open implementation tickets selected."
    exit 0
fi

printf 'Repository: %s\nBranch: %s\nTickets: %s\n' "$repo" "$branch" "${tickets[*]}"

result_file=
trap '[[ -z "$result_file" ]] || rm -f -- "$result_file"' EXIT

while true; do
    open_count=0
    completed=0
    blocked_reports=()

    for issue in "${tickets[@]}"; do
        data=$(issue_json "$issue") || die "Cannot read issue #$issue."
        state=$(jq -r '.state' <<< "$data")
        [[ "$state" == CLOSED ]] && continue
        [[ "$state" == OPEN ]] || die "Unexpected state for issue #$issue: $state"
        open_count=$((open_count + 1))

        is_implementation_ticket <<< "$data" || die "Issue #$issue lacks a What to build or Blocked by section."
        if jq -e '.labels | any(.name == "ready-for-human")' <<< "$data" >/dev/null; then
            die "Issue #$issue is ready-for-human and cannot be automated."
        fi

        body=$(jq -r '.body' <<< "$data")
        blockers=$(issue_blockers <<< "$body") || die "Cannot parse blockers for issue #$issue."
        outstanding=()
        while IFS= read -r blocker; do
            [[ -z "$blocker" ]] && continue
            blocker_state=$(issue_state "$blocker") || die "Cannot read blocker #$blocker of issue #$issue."
            if [[ "$blocker_state" != CLOSED ]]; then
                outstanding+=("#$blocker ($blocker_state)")
            fi
        done <<< "$blockers"

        if ((${#outstanding[@]} > 0)); then
            blocked_reports+=("#$issue: ${outstanding[*]}")
            printf 'Skipping #%s; blocked by: %s\n' "$issue" "${outstanding[*]}"
            continue
        fi

        require_clean_tree
        [[ $(git symbolic-ref --quiet --short HEAD) == "$branch" ]] || die "The branch changed during this run."
        before_head=$(git rev-parse HEAD)
        result_file=$(mktemp "${TMPDIR:-/tmp}/ralph-result.XXXXXXXX")

        printf '\n===== Ralph: issue #%s =====\n\n' "$issue"
        prompt=$(cat <<EOF
Use the \$implement skill to implement GitHub issue #${issue} in $repo.

Work on exactly this one ticket. Read the issue and its comments with gh before changing code. Follow AGENTS.md and the repository's domain documents, ADRs, and applicable authoritative specification. Find the specification through the issue or its parent; if it is unclear which specification applies, stop and explain why. Read the applicable specification in full.

Verify that every issue in the Blocked by section is closed. Do not implement any other ticket. Do not push, create a pull request, change branches, or close the issue.

Complete the normal \$implement workflow, including tests, code review, and a local commit. Only when every acceptance criterion is satisfied and all work is committed, make the final line of your response exactly:
RALPH_COMPLETE <full commit SHA>

If you cannot finish, explain why and do not print RALPH_COMPLETE.
EOF
)

        if ! codex --ask-for-approval never --sandbox workspace-write \
            exec -C "$repo_root" --output-last-message "$result_file" "$prompt"; then
            die "Codex failed on issue #$issue."
        fi

        require_clean_tree
        [[ $(git symbolic-ref --quiet --short HEAD) == "$branch" ]] || die "Codex changed branches on issue #$issue."
        after_head=$(git rev-parse HEAD)
        [[ "$after_head" != "$before_head" ]] || die "Issue #$issue produced no commit."
        git merge-base --is-ancestor "$before_head" "$after_head" || die "Issue #$issue rewrote existing history."

        [[ -s "$result_file" ]] || die "Codex did not write a completion result for issue #$issue."
        last_line=$(tail -n 1 "$result_file")
        rm -f "$result_file"
        result_file=
        [[ "$last_line" == "RALPH_COMPLETE $after_head" ]] || die "Issue #$issue did not report completion for commit $after_head."
        [[ $(issue_state "$issue") == OPEN ]] || die "Issue #$issue changed state unexpectedly."

        gh issue close "$issue" --repo "$repo" --reason completed \
            --comment "Implemented in commit $after_head." || die "Could not close issue #$issue."
        [[ $(issue_state "$issue") == CLOSED ]] || die "Issue #$issue is still open after closing it."

        completed=1
        break # Rescan: this commit may have unblocked an earlier ticket.
    done

    if ((open_count == 0)); then
        echo "All selected tickets are closed."
        exit 0
    fi

    if ((completed == 0)); then
        printf 'No selected ticket is ready:\n' >&2
        printf '  %s\n' "${blocked_reports[@]}" >&2
        exit 1
    fi
done
