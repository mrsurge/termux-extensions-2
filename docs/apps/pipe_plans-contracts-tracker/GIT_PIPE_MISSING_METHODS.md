# Git Pipe Missing Methods

## Required Pipe Methods

| Method | Purpose |
|---|---|
| `git.clone.start` | Start long-running clone, return `GitJobStarted` |
| `git.pull.start` | Start long-running pull, return `GitJobStarted` |
| `git.push.start` | Start long-running push, return `GitJobStarted` |
| `git.job.cancel` | Cancel by `jobId` |
| Pipe notification/event frames | Deliver `GitJobProgress` back to the exact caller lane |

## Required Execution Semantics

All get/read operations must be threaded and asynchronous on the Rust/framework service side so the pipe dispatcher and app hot path are not blocked by filesystem or git work.
