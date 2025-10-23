@sock.route('/api/app/code_oss/ws/read')
def ws_read(ws):
    """Handle WebSocket connections for file content and git status."""
    path = request.args.get('path')
    client_id = request.args.get('client_id')

    if not path or not client_id:
        ws.close(reason=4000, message='Missing path or client_id')
        return

    project_root = Path(_SHELL_STATE.get("project_path", ""))
    if not project_root.is_dir():
        ws.close(reason=4000, message='Project not found')
        return

    core_read.init_watcher(project_root)

    def send_event(event):
        try:
            ws.send(json.dumps(event))
        except Exception:
            # Client disconnected
            pass

    token = core_read.subscribe(path, client_id, send_event)
    try:
        while True:
            # We ignore incoming messages as per instructions
            ws.receive(timeout=3600) # Keep connection alive
    except Exception:
        # Connection closed by client or timeout
        pass
    finally:
        core_read.unsubscribe(token)

@code_oss_bp.route("/api/app/code_oss/write", methods=["POST"])
def write_endpoint():
    """Handle file write operations from the client."""
    payload = request.get_json()
    if not payload:
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400

    path = payload.get("path")
    content = payload.get("content")
    client_id = payload.get("client_id")
    op_id = payload.get("op_id")
    base = payload.get("base")
    base_sha256 = base.get("sha256") if isinstance(base, dict) else None

    if not all([path, content is not None, client_id, op_id]):
        return jsonify({"ok": False, "error": "Missing required fields"}), 400

    project_root = Path(_SHELL_STATE.get("project_path", ""))
    if not project_root.is_dir():
        return jsonify({"ok": False, "error": "Project not found"}), 400

    try:
        meta = core_write.write_full(project_root, path, content, base_sha256=base_sha256)
        core_read.push_save_ack(path, op_id, client_id, meta)
        
        # Non-blocking git status refresh
        # A proper job queue would be better here
        def refresh_git():
            status = _gather_git_status(str(project_root))
            core_read.push_git_status(status)
        Thread(target=refresh_git).start()

        return jsonify({"ok": True, "data": meta})
    except BaseMismatchError as e:
        return jsonify({"ok": False, "error": "BASE_MISMATCH", "data": {"current": e.current_meta}}), 409
    except (PermissionError, IOError) as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    except Exception as e:
        current_app.logger.exception("Error during write operation")
        return jsonify({"ok": False, "error": "An internal error occurred"}), 500