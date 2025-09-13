# Extension Backend: Network Tools (minimal blueprint)

from flask import Blueprint

network_tools_bp = Blueprint('network_tools', __name__)

# No routes required; the extension uses core /api/run_command.

