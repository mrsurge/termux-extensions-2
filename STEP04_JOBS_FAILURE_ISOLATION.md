# Step 4 — Job Isolation & Subprocess Attachment

Use Jobs for risky/long tasks. Always attach the subprocess so cancel/cleanup works; job failure is contained.

```python
from app.jobs import register_job_handler, JobContext
import subprocess, json

@register_job_handler("archive.extract")
def extract_job(ctx: JobContext, p: dict) -> None:
    cmd = ["python3", "-m", "app.apps.jobs_demo.worker", "--src", p["src"], "--dst", p["dst"]]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
    ctx.attach_process(proc)
    for line in proc.stdout:
        pass  # parse progress lines
    if proc.wait() != 0:
        raise RuntimeError("worker failed")
    ctx.finish(message="Done")
```

Next → `STEP05_SHELL_GROUPS_AND_BREADCRUMBS.md`
