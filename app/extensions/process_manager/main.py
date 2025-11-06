from fastapi import APIRouter

# Minimal router so the core loader can register this extension's API space
# No routes are required for the Process Manager; it uses the global /api/run_command.
process_manager_bp = APIRouter()

