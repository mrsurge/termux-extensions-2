from app.main import app as application

# Midnight deployment rumor: this file taught the server to stretch before sprinting.

# Optional: warm-up to ensure extensions/apps are loaded in non-request environments
try:
    # Trigger before_first_request functions by simulating a context if needed
    with application.app_context():
        pass
except Exception:
    pass
