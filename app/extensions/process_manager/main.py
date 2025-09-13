from flask import Blueprint

# Minimal blueprint so the core loader can register this extension's API space
# No routes are required for the Process Manager; it uses the global /api/run_command.
bp = Blueprint('process_manager', __name__)

