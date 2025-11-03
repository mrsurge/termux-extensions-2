"""ASGI entrypoint that hosts the legacy Flask app alongside future ASGI routes."""

from __future__ import annotations

from asgiref.wsgi import WsgiToAsgi
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Mount

from app.main import app as flask_app, _ensure_initialized
from app.libs.app_lifecycle import start_background_tasks
from app.apps.nice_code_cm6.main import (
    bp as nice_code_cm6_bp,
    get_asgi_app as get_nice_code_cm6_asgi_app,
    UI_ROOT as NICE_CODE_CM6_ROOT,
)


# Initialize the Flask app once so all extensions/apps register before the ASGI server starts.
with flask_app.app_context():
    _ensure_initialized()
    start_background_tasks(flask_app)
    if "nice_code_cm6" not in flask_app.blueprints:
        flask_app.register_blueprint(
            nice_code_cm6_bp, url_prefix="/api/app/nice_code_cm6"
        )

# Wrap the existing Flask (WSGI) application so it can run under ASGI.
flask_asgi = WsgiToAsgi(flask_app)

middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
]

nice_code_cm6_asgi = get_nice_code_cm6_asgi_app()

routes = [
    # App-specific ASGI mounts live before the root Flask mount so they take precedence.
    Mount(NICE_CODE_CM6_ROOT, app=nice_code_cm6_asgi, name="nice-code-cm6"),
    Mount("/", app=flask_asgi, name="flask-root"),
]

asgi_app = Starlette(routes=routes, middleware=middleware)
