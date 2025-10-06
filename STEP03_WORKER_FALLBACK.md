# Step 3 — Worker Fallback for Unsafe/Heavy Imports

**Idea:** if a module is missing or risky, run the code in a **Framework Shell** child process. Import heavy deps there; expose `/health` and a few endpoints.

Provide a small worker (Flask) and a proxy route that spawns it on demand and proxies calls.

Next → `STEP04_JOBS_FAILURE_ISOLATION.md`
