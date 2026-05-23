# Scheduled Tasks (Desktop)

Claude Code Desktop scheduled tasks are stored at `~/.claude/scheduled-tasks/<task-name>/SKILL.md`. Only the prompt body lives in that file — schedule, folder, model, and enabled state are kept in a separate index that's not portable. So syncing across machines = sync the SKILL.md via this repo, then re-register the schedule once via the app.

## Install on a new machine

1. **Sync the prompt file** (symlink so future repo updates flow through):

   ```bash
   mkdir -p ~/.claude/scheduled-tasks/polyglot-review
   ln -sf "$(pwd)/routines/polyglot-review/SKILL.md" \
          ~/.claude/scheduled-tasks/polyglot-review/SKILL.md
   ```

   Or `cp` instead of `ln -sf` if you'd rather keep a snapshot.

2. **Register the schedule** — open Claude Code Desktop, in any session paste:

   > Create a Local scheduled task named `polyglot-review`, daily at 08:00, folder is this repo, model opus, permission mode acceptEdits. The prompt is already at `~/.claude/scheduled-tasks/polyglot-review/SKILL.md` — reuse it, don't overwrite.

   Claude walks you through any missing pickers and saves it. Then click **Run now** once on the task's detail page to pre-approve tool permissions.

## When paths differ between machines

`SKILL.md` hardcodes the repo path (`/Users/xinyunh/Desktop/语言学习/polyglot-lexicon`) and the Obsidian vault path. If the work machine puts them elsewhere:

- Edit the two `路径常量` lines at the top of `SKILL.md` after symlinking (the symlink target is in this repo, so edits flow back — commit them on a per-machine branch or move the constants to env vars).
- Vault path usually "just works" if both machines log into the same iCloud Drive.

## Edit the prompt

Edit `routines/polyglot-review/SKILL.md` in this repo and commit. The symlinked copy under `~/.claude/scheduled-tasks/` picks it up on the next run — no app restart needed.
