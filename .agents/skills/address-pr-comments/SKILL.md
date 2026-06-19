---
name: address-pr-comments
description: Address unresolved PR review comments by reading all pending comments, identifying AI-actionable suggestions, implementing the changes, and resolving the comments. Use when the user says "address PR comments," "fix review feedback," "resolve PR feedback," "handle code review comments," or wants to process GitHub pull request review comments.
---

# Address PR Review Comments

You are a code review assistant. Your goal is to systematically process unresolved PR comments, implement actionable suggestions, and resolve them.

## Workflow Overview

```
1. Fetch unresolved PR comments
2. Categorize comments (AI-actionable vs needs-human)
3. Implement actionable suggestions
4. Reply to every comment, then resolve it (always)
5. Report on remaining items
```

**Always reply and resolve what you act on.** For every comment you implement a fix for or determine you cannot address, post a reply explaining what you did and then resolve the thread. When a reply describes a fix that landed in a commit, include that commit's hash in the reply.

**Leave human-decision comments untouched.** Do not reply to or resolve comments that need a human decision — flag them in the report only.

---

## Step 1: Fetch PR Comments

First, identify the PR. If not provided, check current branch:

```bash
# Get current branch's PR number
gh pr view --json number,url,title
```

Then fetch all unresolved review comments:

```bash
# Get all review comments (includes resolved status)
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --jq '.[] | select(.resolved != true) | {id: .id, path: .path, line: .line, body: .body, diff_hunk: .diff_hunk}'

# Get all review threads with resolution status
gh pr view {pr_number} --json reviewThreads --jq '.reviewThreads[] | select(.isResolved == false) | {id: .id, path: .path, line: .line, comments: [.comments[].body]}'
```

**Alternative using gh pr view:**
```bash
gh pr view {pr_number} --json reviews,comments
```

---

## Step 2: Categorize Comments

For each unresolved comment, determine if it's AI-actionable:

### AI-Actionable (implement these)
- Code style fixes (formatting, naming)
- Add/remove imports
- Add error handling
- Add type annotations
- Fix typos in code or comments
- Rename variables/functions
- Add missing documentation
- Simplify logic as suggested
- Add/modify tests as specified
- Remove dead code
- Add null checks or guards

### Needs Human Decision (flag these)
- Architectural changes
- "Consider if..." suggestions (need decision)
- Performance tradeoffs
- Questions without clear answers
- Alternative approaches to discuss
- Scope changes or feature additions
- Security-sensitive changes

---

## Step 3: Implement Changes

For each AI-actionable comment:

1. **Read the file** at the specified path
2. **Locate the code** using the line number and diff context
3. **Make the change** as suggested
4. **Verify** the change compiles/lints

### Implementation Checklist

```
For each actionable comment:
- [ ] Read the target file
- [ ] Find the exact location (use diff_hunk context if line numbers shifted)
- [ ] Implement the suggested change
- [ ] Run linter on the file
- [ ] Stage the change
```

### Handling Line Number Drift

If the PR has been modified since comments were made, line numbers may have shifted. Use the `diff_hunk` context to locate the correct code:

```bash
# Search for the code pattern from diff_hunk
rg "pattern from diff_hunk" path/to/file.ts
```

---

## Step 4: Commit Fixes

Before replying to comments, commit any code changes so each fix has a concrete commit hash to reference. Commit per logical fix (or a single summary commit if the changes are tightly related):

```bash
git add -A
git commit -m "address review feedback

- [list of changes made]
"

# Capture the hash that landed the fix
git rev-parse --short HEAD
```

Comments that need a human decision or could not be addressed won't have a commit — that's fine, you'll still reply and resolve them in Step 5.

---

## Step 5: Reply and Resolve Comments

For every comment you **acted on** (implemented or could not address): post a reply describing the outcome, then resolve the thread. Never resolve a thread without a reply.

Skip comments that need a human decision entirely — do not reply, do not resolve.

What each reply should say:
- **Implemented:** what you changed and the short commit hash that landed it (e.g. `Fixed in abc1234.`).
- **Could not address:** the reason (e.g. code no longer exists). Reply, then resolve.
- **Needs human decision:** no reply, no resolve — flag in the report only.

```bash
# Get the thread ID (and its first comment ID, for replies) for each thread
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 1) {
              nodes {
                databaseId
                body
              }
            }
          }
        }
      }
    }
  }
' -f owner="{owner}" -f repo="{repo}" -F pr={pr_number}

# Reply to the comment thread (use the first comment's databaseId)
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_database_id}/replies \
  -f body="Fixed in {commit_hash}. {short description of the change}"

# Resolve the thread
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread {
        isResolved
      }
    }
  }
' -f threadId="{thread_id}"
```

---

## Step 6: Report Results

Provide a summary to the user:

### Addressed Comments
| File | Line | Change Made |
|------|------|-------------|
| ... | ... | ... |

### Needs Human Decision
| File | Line | Comment | Why |
|------|------|---------|-----|
| ... | ... | ... | Requires architectural decision |

### Could Not Address
| File | Line | Comment | Reason |
|------|------|---------|--------|
| ... | ... | ... | Code no longer exists |

---

## Error Handling

### Comment references deleted code
- Note in summary as "Could Not Address"
- Reply explaining the code no longer exists, then resolve the thread

### Ambiguous suggestion
- If the suggestion could be interpreted multiple ways, flag as "Needs Human Decision"
- Do not reply or resolve — surface it in the report only

### Conflicting comments
- If two comments suggest different approaches, flag both as "Needs Human Decision"
- Do not reply or resolve either — surface them in the report only

### Failed to reply or resolve via API
- Report the error but continue with other comments
- User can manually reply/resolve in GitHub UI

---

## Quick Start Command

To address all PR comments for the current branch:

```bash
# Ensure you're on the PR branch
git branch --show-current

# Fetch latest
git fetch origin

# Get PR info
gh pr view
```

Then follow the workflow above.
