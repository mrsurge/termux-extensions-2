# Step 1 — Make Dynamic App/Extension Loading Non‑Fatal

**Goal:** A bad app/extension import should NOT take down Flask. Mark the manifest with an error and keep serving.

## File to modify
- `app/main.py` — patch `load_extensions()` and `load_apps()`

## Diff (unified)
```diff
--- a/app/main.py
+++ b/app/main.py
@@
-import importlib.util
+import importlib.util
+import traceback
@@ def load_extensions():
-        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
-        if backend_file:
-            module_name = f"app.extensions.{ext_name}.{backend_file.replace('.py', '')}"
-            spec = importlib.util.spec_from_file_location(module_name, os.path.join(ext_path, backend_file))
-            module = importlib.util.module_from_spec(spec)
-            spec.loader.exec_module(module)
-            from flask import Blueprint
-            for obj_name in dir(module):
-                obj = getattr(module, obj_name)
-                if isinstance(obj, Blueprint):
-                    app.register_blueprint(obj, url_prefix=f"/api/ext/{ext_name}")
-                    break
+        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
+        if backend_file:
+            module_name = f"app.extensions.{ext_name}.{backend_file.replace('.py', '')}"
+            spec = importlib.util.spec_from_file_location(module_name, os.path.join(ext_path, backend_file))
+            try:
+                module = importlib.util.module_from_spec(spec)
+                spec.loader.exec_module(module)  # may raise anything
+            except BaseException as e:
+                manifest['__load_error__'] = f"{type(e).__name__}: {e}"
+                manifest['__load_trace__'] = traceback.format_exc()[-2048:]
+            else:
+                from flask import Blueprint
+                try:
+                    for obj_name in dir(module):
+                        obj = getattr(module, obj_name)
+                        if isinstance(obj, Blueprint):
+                            app.register_blueprint(obj, url_prefix=f"/api/ext/{ext_name}")
+                            break
+                    else:
+                        manifest['__load_warning__'] = 'No Flask Blueprint found in backend module'
+                except BaseException as e:
+                    manifest['__load_error__'] = f"Blueprint registration failed: {type(e).__name__}: {e}"
+                    manifest['__load_trace__'] = traceback.format_exc()[-2048:]
@@ def load_apps():
-        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
-        if backend_file:
-            module_name = f"app.apps.{app_name}.{backend_file.replace('.py', '')}"
-            spec = importlib.util.spec_from_file_location(module_name, os.path.join(app_path, backend_file))
-            module = importlib.util.module_from_spec(spec)
-            spec.loader.exec_module(module)
-            from flask import Blueprint
-            for obj_name in dir(module):
-                obj = getattr(module, obj_name)
-                if isinstance(obj, Blueprint):
-                    app_id = manifest.get('id', app_name)
-                    app.register_blueprint(obj, url_prefix=f"/api/app/{app_id}")
-                    break
-            try:
-                if hasattr(module, 'register_ws_routes'):
-                    module.register_ws_routes(app)
-            except Exception as e:
-                print(f"Error registering WS routes for app {app_name}: {e}")
+        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
+        if backend_file:
+            module_name = f"app.apps.{app_name}.{backend_file.replace('.py', '')}"
+            spec = importlib.util.spec_from_file_location(module_name, os.path.join(app_path, backend_file))
+            try:
+                module = importlib.util.module_from_spec(spec)
+                spec.loader.exec_module(module)  # may raise anything
+            except BaseException as e:
+                manifest['__load_error__'] = f"{type(e).__name__}: {e}"
+                manifest['__load_trace__'] = traceback.format_exc()[-2048:]
+            else:
+                from flask import Blueprint
+                try:
+                    for obj_name in dir(module):
+                        obj = getattr(module, obj_name)
+                        if isinstance(obj, Blueprint):
+                            app_id = manifest.get('id', app_name)
+                            app.register_blueprint(obj, url_prefix=f"/api/app/{app_id}")
+                            break
+                    else:
+                        manifest['__load_warning__'] = 'No Flask Blueprint found in backend module'
+                except BaseException as e:
+                    manifest['__load_error__'] = f"Blueprint registration failed: {type(e).__name__}: {e}"
+                    manifest['__load_trace__'] = traceback.format_exc()[-2048:]
+                try:
+                    if hasattr(module, 'register_ws_routes'):
+                        module.register_ws_routes(app)
+                except BaseException as e:
+                    manifest['__ws_error__'] = f"WS registration failed: {type(e).__name__}: {e}"
+                    manifest['__ws_trace__'] = traceback.format_exc()[-2048:]
```

Next → `STEP02_OPTIONAL_IMPORT.md`
