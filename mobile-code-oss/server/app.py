from flask import Flask, render_template, request, jsonify
import os
import json

app = Flask(__name__, static_folder='static', template_folder='templates')

# Configuration
# Set CODE_IFRAME_URL to your hosted Code-OSS / code-server path (must be same-origin for DOM access).
CODE_IFRAME_URL = os.environ.get("CODE_IFRAME_URL", "/ide/")

# In a real deploy, settings should be applied via the VS Code bridge extension.
# We keep a tiny server-side JSON to demonstrate a settings flow.
SERVER_SETTINGS_PATH = os.environ.get("SERVER_SETTINGS_PATH", "server_settings.json")

def _load_settings():
    if os.path.exists(SERVER_SETTINGS_PATH):
        with open(SERVER_SETTINGS_PATH, "r") as f:
            try:
                return json.load(f)
            except Exception:
                return {}
    return {}

def _save_settings(data):
    with open(SERVER_SETTINGS_PATH, "w") as f:
        json.dump(data, f, indent=2)

@app.route("/")
def index():
    return render_template("index.html", code_iframe_url=CODE_IFRAME_URL)

# ---- Settings API (demo) ----
@app.get("/api/settings")
def get_settings():
    return jsonify(_load_settings())

@app.post("/api/settings")
def update_settings():
    body = request.get_json(force=True, silent=True) or {}
    settings = _load_settings()
    settings.update(body)
    _save_settings(settings)
    return jsonify({"ok": True, "saved": settings})

# ---- Extensions API (stubs) ----
# In production: call `code --install-extension <id>` or code-server endpoints.
@app.post("/api/extensions/install")
def install_extension():
    body = request.get_json(force=True, silent=True) or {}
    ext_id = body.get("id")
    if not ext_id:
        return jsonify({"ok": False, "error": "missing id"}), 400
    # TODO: invoke CLI here
    return jsonify({"ok": True, "installed": ext_id})

@app.post("/api/extensions/uninstall")
def uninstall_extension():
    body = request.get_json(force=True, silent=True) or {}
    ext_id = body.get("id")
    if not ext_id:
        return jsonify({"ok": False, "error": "missing id"}), 400
    # TODO: invoke CLI here
    return jsonify({"ok": True, "uninstalled": ext_id})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
