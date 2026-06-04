#!/usr/bin/env python3
"""Capture the working-tree (uncommitted) diff and attach it to a card.

    python3 scripts/attach-worktree-diff.py <CO-N>

The card key is required (there is no commit message to parse it from). The diff
is ``git diff HEAD`` plus untracked files, posted under a sentinel sha so the
backend treats it as a pending diff; the real commit (or a clean tree) later
replaces/clears it. The diff never passes through an AI context.

Standard library only; a Node twin lives at scripts/attach-worktree-diff.mjs —
keep the two in sync. The diff helpers are duplicated from attach-commit.py on
purpose: each script is standalone and directly runnable.

Config: CO_API_URL (default http://127.0.0.1:4400).
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

API_URL = os.environ.get("CO_API_URL", "http://127.0.0.1:4400").rstrip("/")

# Must match WORKING_TREE_SHA in @claude-organizer/shared.
WORKING_TREE_SHA = "__working__"

# Files whose body is noise: store the header + a note instead of the patch.
LOCKFILES = {
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "npm-shrinkwrap.json",
    "bun.lockb",
}
# Per-file line cap; beyond it the patch is truncated with a note.
MAX_LINES_PER_FILE = 1000


def fail(msg):
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def git(args):
    try:
        return subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except subprocess.CalledProcessError as err:
        first = (err.stderr or "").split("\n", 1)[0]
        fail(f"git {' '.join(args)} failed: {first}")


def git_diff_no_index(args):
    """``git diff --no-index`` exits 1 when inputs differ — that's the patch."""
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode not in (0, 1):
        first = (result.stderr or "").split("\n", 1)[0]
        fail(f"git {' '.join(args)} failed: {first}")
    return result.stdout


def is_ignored(path):
    base = path.rsplit("/", 1)[-1]
    if base in LOCKFILES:
        return True
    if re.search(r"\.min\.[^.]+$", base):
        return True
    if path.startswith("dist/") or "/dist/" in path:
        return True
    return False


def section_path(lines):
    for l in lines:
        if l.startswith("+++ b/"):
            return l[6:]
    for l in lines:
        if l.startswith("--- a/"):
            return l[6:]
    m = re.match(r"^diff --git a/(.+) b/(.+)$", lines[0])
    return m.group(2) if m else ""


def prune_diff(patch):
    """Split the unified patch per file and apply the safeguards."""
    if not patch.strip():
        return ""
    sections = []
    current = None
    for line in patch.split("\n"):
        if line.startswith("diff --git "):
            if current:
                sections.append(current)
            current = [line]
        elif current is not None:
            current.append(line)
    if current:
        sections.append(current)

    out = []
    for lines in sections:
        path = section_path(lines)
        is_binary = any(
            re.match(r"^Binary files .* differ$", l) or l.startswith("GIT binary patch")
            for l in lines
        )
        if is_binary:  # keep binary marker as-is (already a one-liner)
            out.append("\n".join(lines))
        elif is_ignored(path):
            out.append(f"{lines[0]}\n# diff omitted (lockfile/generated)")
        elif len(lines) > MAX_LINES_PER_FILE:
            omitted = len(lines) - MAX_LINES_PER_FILE
            out.append(
                "\n".join(lines[:MAX_LINES_PER_FILE])
                + f"\n# ... (truncated: {omitted} lines omitted)"
            )
        else:
            out.append("\n".join(lines))
    return "\n".join(out)


def human_bytes(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def stat_summary(raw):
    """Summary line counted from the full pre-prune ``raw`` (tracked + untracked).

    NOT the displayed (pruned) ``diff`` — so the badge equals the real commit's
    ``git show --stat`` once it lands (pruned lockfiles/binaries stay counted),
    and covers untracked files that ``git diff HEAD --stat`` (tracked only)
    would miss. The web parses only this last line for its badges.
    """
    files = len(re.findall(r"^diff --git ", raw, re.MULTILINE))
    add = 0
    del_ = 0
    for line in raw.split("\n"):
        if line.startswith("+") and not line.startswith("+++"):
            add += 1
        elif line.startswith("-") and not line.startswith("---"):
            del_ += 1
    files_w = "file" if files == 1 else "files"
    ins_w = "insertion" if add == 1 else "insertions"
    del_w = "deletion" if del_ == 1 else "deletions"
    return f"{files} {files_w} changed, {add} {ins_w}(+), {del_} {del_w}(-)"


def clear_pending(key):
    req = urllib.request.Request(
        f"{API_URL}/cards/{key}/commits/working",
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req) as res:
            res.read()
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        fail(f"API responded {err.code}: {body}")
    except urllib.error.URLError as err:
        fail(f"could not reach the API at {API_URL} ({err.reason}). Is it running?")


def main():
    args = sys.argv[1:]
    if not args:
        fail("usage: attach-worktree-diff <CO-N>")
    key = args[0]

    tracked = git(["diff", "HEAD"])
    # `core.quotePath=false` keeps non-ASCII / spaced paths raw so they survive
    # as literal argv to `git diff --no-index` below.
    untracked = [
        f
        for f in git(
            ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"]
        ).split("\n")
        if f
    ]

    raw = tracked
    for file in untracked:
        raw += git_diff_no_index(["diff", "--no-index", "--", "/dev/null", file])
    diff = prune_diff(raw)

    if not diff.strip():
        clear_pending(key)
        print(f"✓ {key} — working tree clean, pending diff cleared")
        return

    file_count = len(re.findall(r"^diff --git ", raw, re.MULTILINE))
    stat = stat_summary(raw)

    payload = json.dumps(
        {
            "sha": WORKING_TREE_SHA,
            "message": "(uncommitted working tree)",
            "stat": stat,
            "diff": diff,
            "committedAt": None,
            "authorName": None,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{API_URL}/cards/{key}/commits",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            res.read()
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        fail(f"API responded {err.code}: {body}")
    except urllib.error.URLError as err:
        fail(f"could not reach the API at {API_URL} ({err.reason}). Is it running?")

    diff_bytes = len(diff.encode("utf-8"))
    print(
        f"✓ {key} working tree — {file_count} file(s), "
        f"{human_bytes(diff_bytes)} diff → attached (uncommitted)"
    )


if __name__ == "__main__":
    main()
