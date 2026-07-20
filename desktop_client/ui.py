import json
import mimetypes
import re
import sys
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, cast
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")

from gi.repository import Gio, GLib, Gtk, WebKit
settings = WebKit.Settings()
# Ensure hardware acceleration features are explicitly enabled
settings.set_enable_2d_canvas_acceleration(True)



if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from desktop_client.assets import (
    LOCAL_FILES,
    LOCAL_MAPPINGS,
    LOCAL_PREFIXES,
    DesktopAssetManager,
    DesktopAssetServer,
    WebExtensionBuild,
    ensure_web_extension,
)


CONFIG_DIR = Path(GLib.get_user_config_dir()) / "te2"
CONFIG_PATH = CONFIG_DIR / "desktop-shell.json"

DEFAULT_SETTINGS: dict[str, object] = {
    "frameworkHost": "127.0.0.1",
    "frameworkPort": 8089,
    "platform": "gtk",
    "zoomLevel": 1.0,
}

APP_ID = "com.termux.extensions.DesktopShell"
UI_ROOT = Path(__file__).parent / "android_shell"
HOME_URI = "app://android_shell/index.html"

APP_SHELL_NATIVE_STYLE = """
html > body > .app-shell > .app-toolbar {
    display: none !important;
}
"""

APP_ID_PATTERN = r"[A-Za-z0-9._-]+"
FRAMEWORK_ROUTE_PATTERN = re.compile(
    rf"/api/apps/(?:(?:catalog|reload)|(?:{APP_ID_PATTERN})/(?:open|quit))"
)
FRAMEWORK_REQUEST_TIMEOUT_SECONDS = 60
FRAMEWORK_PROBE_TIMEOUT_SECONDS = 5
MIN_ZOOM_LEVEL = 0.5
MAX_ZOOM_LEVEL = 2.0
ZOOM_STEP = 0.1
NATIVE_TOAST_DURATION_MILLISECONDS = 3500


def normalized_zoom_level(value: object) -> float:
    try:
        zoom = float(str(value))
    except (TypeError, ValueError):
        zoom = 1.0
    return round(min(MAX_ZOOM_LEVEL, max(MIN_ZOOM_LEVEL, zoom)), 1)


def app_id_from_uri(uri: str | None) -> str | None:
    if not uri:
        return None
    try:
        parsed = urlsplit(uri)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"}:
        return None

    app_id = ""
    if parsed.path == "/app":
        app_id = next(
            iter(parse_qs(parsed.query).get("app_id", ())),
            "",
        )
    elif parsed.path.startswith("/app/"):
        app_id = unquote(parsed.path[len("/app/") :].split("/", 1)[0])

    app_id = app_id.strip()
    if not re.fullmatch(APP_ID_PATTERN, app_id):
        return None
    return app_id


def write_shell_settings(settings: dict[str, object]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = CONFIG_PATH.with_suffix(".tmp")
    temporary_path.write_text(
        json.dumps(settings, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(CONFIG_PATH)


def load_shell_settings() -> dict[str, object]:
    try:
        decoded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        stored = (
            cast(dict[str, object], decoded)
            if isinstance(decoded, dict)
            else {}
        )
    except (OSError, ValueError, json.JSONDecodeError):
        stored = {}

    settings = {**DEFAULT_SETTINGS, **stored}
    settings["frameworkHost"] = (
        str(settings.get("frameworkHost", "")).strip()
        or DEFAULT_SETTINGS["frameworkHost"]
    )

    try:
        port = int(str(settings.get("frameworkPort", 8089)))
    except (TypeError, ValueError):
        port = 8089

    settings["frameworkPort"] = port if 1 <= port <= 65535 else 8089
    settings["platform"] = "gtk"
    settings["zoomLevel"] = normalized_zoom_level(settings.get("zoomLevel"))
    return settings


def save_shell_settings(payload: dict[str, object]) -> dict[str, object]:
    settings = load_shell_settings()

    host = str(payload.get("frameworkHost", "")).strip()
    if not host:
        raise ValueError("Framework host cannot be empty")

    try:
        port = int(str(payload.get("frameworkPort")))
    except (TypeError, ValueError) as error:
        raise ValueError("Framework port must be a number") from error

    if not 1 <= port <= 65535:
        raise ValueError("Framework port must be between 1 and 65535")

    settings["frameworkHost"] = host
    settings["frameworkPort"] = port

    write_shell_settings(settings)
    return settings


def save_zoom_level(value: object) -> float:
    settings = load_shell_settings()
    zoom = normalized_zoom_level(value)
    settings["zoomLevel"] = zoom
    write_shell_settings(settings)
    return zoom


def framework_base_url(settings: dict[str, object] | None = None) -> str:
    current = settings or load_shell_settings()
    raw_host = str(current["frameworkHost"]).strip()
    candidate = raw_host if "://" in raw_host else f"http://{raw_host}"
    parsed = urlsplit(candidate)

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Framework host must be an HTTP or HTTPS host")
    if parsed.username or parsed.password:
        raise ValueError("Framework host must not include credentials")

    hostname = parsed.hostname
    if ":" in hostname:
        hostname = f"[{hostname}]"
    netloc = f"{hostname}:{int(str(current['frameworkPort']))}"
    return urlunsplit((parsed.scheme, netloc, "", "", ""))


def _framework_error(error: HTTPError) -> str:
    try:
        decoded = json.loads(error.read().decode("utf-8", "replace"))
        body = cast(dict[str, object], decoded) if isinstance(decoded, dict) else {}
    except (OSError, ValueError, json.JSONDecodeError):
        body = {}
    if isinstance(body, dict) and body.get("error"):
        return str(body["error"])
    return f"Framework returned HTTP {error.code}"


def framework_json_request(
    path: str,
    method: str = "GET",
    payload: object | None = None,
) -> object | None:
    normalized_method = method.upper()
    if normalized_method not in {"GET", "POST"}:
        raise ValueError("Unsupported framework request method")
    if not FRAMEWORK_ROUTE_PATTERN.fullmatch(path):
        raise ValueError("Unsupported framework request path")

    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif normalized_method == "POST":
        data = b""

    request = Request(
        f"{framework_base_url()}{path}",
        data=data,
        headers=headers,
        method=normalized_method,
    )
    try:
        with urlopen(
            request,
            timeout=FRAMEWORK_REQUEST_TIMEOUT_SECONDS,
        ) as response:
            raw_body = response.read().decode("utf-8", "replace")
    except HTTPError as error:
        raise RuntimeError(_framework_error(error)) from error
    except URLError as error:
        raise RuntimeError(f"Framework unavailable: {error.reason}") from error

    try:
        decoded = json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise RuntimeError("Framework returned invalid JSON") from error
    if not isinstance(decoded, dict):
        raise RuntimeError("Framework returned an invalid response")
    body = cast(dict[str, object], decoded)
    if body.get("ok") is False:
        raise RuntimeError(str(body.get("error") or "Framework request failed"))
    return body.get("data")


def framework_shells_status() -> dict[str, object]:
    url = f"{framework_base_url()}/fws"
    try:
        with urlopen(url, timeout=FRAMEWORK_PROBE_TIMEOUT_SECONDS) as response:
            available = 200 <= response.status < 400
    except (HTTPError, URLError, OSError) as error:
        return {
            "available": False,
            "url": url,
            "error": str(error),
        }
    return {"available": available, "url": url}


class WebShell(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID)
        self.window: Gtk.ApplicationWindow | None = None
        self.webview: WebKit.WebView | None = None
        self.header_title: Gtk.Label | None = None
        self.asset_version_label: Gtk.Label | None = None
        self.native_toast_revealer: Gtk.Revealer | None = None
        self.native_toast_label: Gtk.Label | None = None
        self.native_toast_timeout_id: int | None = None
        self.back_button: Gtk.Button | None = None
        self.forward_button: Gtk.Button | None = None
        self.home_button: Gtk.Button | None = None
        self.reload_button: Gtk.Button | None = None
        self.recents_button: Gtk.Button | None = None
        self.lock_button: Gtk.Button | None = None
        self.quit_button: Gtk.Button | None = None
        self.zoom_out_button: Gtk.Button | None = None
        self.zoom_reset_button: Gtk.Button | None = None
        self.zoom_in_button: Gtk.Button | None = None
        self.asset_manager = DesktopAssetManager()
        self.asset_server = DesktopAssetServer(self.asset_manager.asset_root)
        self.web_extension_build = WebExtensionBuild(
            available=False,
            error="Asset interceptor has not been initialized",
        )
        self.executor: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix="te2-desktop-shell",
        )

    def do_activate(self) -> None:
        if self.window is not None:
            self.window.present()
            return

        window = Gtk.ApplicationWindow(application=self)
        window.set_title("TE2 Desktop")
        window.set_default_size(1200, 800)

        header = Gtk.HeaderBar()
        header.set_show_title_buttons(True)
        header_title = Gtk.Label(label="TE2 Desktop")
        header_title.set_max_width_chars(48)
        asset_version_label = Gtk.Label()
        asset_version_label.add_css_class("dim-label")
        asset_version_label.add_css_class("caption")
        asset_version_label.set_tooltip_text(
            "Installed desktop framework asset version"
        )
        title_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        title_box.append(header_title)
        title_box.append(asset_version_label)
        header.set_title_widget(title_box)
        window.set_titlebar(header)

        manager = WebKit.UserContentManager()
        manager.register_script_message_handler("native")
        manager.connect(
            "script-message-received::native",
            self.on_native_message,
            window,
        )
        manager.add_style_sheet(
            WebKit.UserStyleSheet.new(
                APP_SHELL_NATIVE_STYLE,
                WebKit.UserContentInjectedFrames.TOP_FRAME,
                WebKit.UserStyleLevel.USER,
                None,
                None,
            )
        )

        self.asset_manager.asset_root.mkdir(parents=True, exist_ok=True)
        asset_server_url = self.asset_server.start()
        self.web_extension_build = ensure_web_extension()

        context = WebKit.WebContext.get_default()
        context.add_path_to_sandbox(
            str(self.asset_manager.asset_root),
            True,
        )
        if (
            self.web_extension_build.available
            and self.web_extension_build.directory is not None
        ):
            context.set_web_process_extensions_directory(
                str(self.web_extension_build.directory)
            )
            context.set_web_process_extensions_initialization_user_data(
                GLib.Variant(
                    "(ssasasa(sss))",
                    (
                        asset_server_url,
                        str(self.asset_manager.version_file),
                        list(LOCAL_PREFIXES),
                        list(LOCAL_FILES),
                        list(LOCAL_MAPPINGS),
                    ),
                )
            )
        context.register_uri_scheme("app", self.on_app_uri)

        webview = WebKit.WebView(
            user_content_manager=manager,
            web_context=context,
        )
        self.build_native_header(header, webview)
        webview.connect("notify::uri", self.on_navigation_state_changed)
        webview.connect("notify::title", self.on_title_changed)
        webview.connect("notify::can-go-back", self.on_navigation_state_changed)
        webview.connect("notify::can-go-forward", self.on_navigation_state_changed)
        webview.connect("load-changed", self.on_load_changed)
        webview.connect("decide-policy", self.on_decide_policy)
        webview.connect("context-menu", self.on_context_menu)

        toast_label = Gtk.Label()
        toast_label.set_wrap(True)
        toast_label.set_max_width_chars(72)
        toast_label.set_margin_top(10)
        toast_label.set_margin_bottom(10)
        toast_label.set_margin_start(14)
        toast_label.set_margin_end(14)
        toast_container = Gtk.Box()
        toast_container.add_css_class("osd")
        toast_container.add_css_class("card")
        toast_container.append(toast_label)
        toast_revealer = Gtk.Revealer()
        toast_revealer.set_transition_type(
            Gtk.RevealerTransitionType.SLIDE_UP
        )
        toast_revealer.set_halign(Gtk.Align.CENTER)
        toast_revealer.set_valign(Gtk.Align.END)
        toast_revealer.set_margin_bottom(24)
        toast_revealer.set_child(toast_container)

        overlay = Gtk.Overlay()
        overlay.set_child(webview)
        overlay.add_overlay(toast_revealer)

        window.webview = webview
        window.set_child(overlay)

        self.window = window
        self.webview = webview
        self.header_title = header_title
        self.asset_version_label = asset_version_label
        self.native_toast_revealer = toast_revealer
        self.native_toast_label = toast_label
        self.refresh_asset_version_badge()
        webview.set_zoom_level(
            normalized_zoom_level(load_shell_settings().get("zoomLevel"))
        )
        self.update_zoom_controls(webview)
        webview.load_uri(HOME_URI)
        window.present()
        self.run_asset_update(webview, request_id=None, force=False)

    def build_native_header(
        self,
        header: Gtk.HeaderBar,
        webview: WebKit.WebView,
    ) -> None:
        self.back_button = self.header_icon_button(
            "go-previous-symbolic",
            "Back",
            lambda _button: webview.go_back() if webview.can_go_back() else None,
        )
        self.forward_button = self.header_icon_button(
            "go-next-symbolic",
            "Forward",
            lambda _button: webview.go_forward()
            if webview.can_go_forward()
            else None,
        )
        self.home_button = self.header_icon_button(
            "go-home-symbolic",
            "Home",
            lambda _button: self.load_home(),
        )
        self.reload_button = self.header_icon_button(
            "view-refresh-symbolic",
            "Reload",
            lambda _button: webview.reload(),
        )

        for button in (
            self.back_button,
            self.forward_button,
            self.home_button,
            self.reload_button,
        ):
            header.pack_start(button)

        self.recents_button = self.header_text_button(
            "Recents",
            lambda _button: self.activate_app_shell_button("btn-recents"),
        )
        self.lock_button = self.header_text_button(
            "Lock",
            lambda _button: self.activate_app_shell_button("btn-lock"),
        )
        self.quit_button = self.header_text_button(
            "Quit",
            lambda _button: self.quit_current_app(),
        )

        for button in (
            self.quit_button,
            self.lock_button,
            self.recents_button,
        ):
            header.pack_end(button)

        zoom_out_button = self.header_text_button(
            "−",
            lambda _button: self.adjust_zoom(webview, -ZOOM_STEP),
        )
        zoom_out_button.set_tooltip_text("Zoom out")
        self.zoom_out_button = zoom_out_button
        zoom_reset_button = self.header_text_button(
            "100%",
            lambda _button: self.set_zoom(webview, 1.0),
        )
        zoom_reset_button.set_tooltip_text("Reset zoom")
        self.zoom_reset_button = zoom_reset_button
        zoom_in_button = self.header_text_button(
            "+",
            lambda _button: self.adjust_zoom(webview, ZOOM_STEP),
        )
        zoom_in_button.set_tooltip_text("Zoom in")
        self.zoom_in_button = zoom_in_button
        for button in (
            self.zoom_in_button,
            self.zoom_reset_button,
            self.zoom_out_button,
        ):
            header.pack_end(button)

        self.update_navigation_controls(webview)

    def adjust_zoom(self, webview: WebKit.WebView, delta: float) -> None:
        self.set_zoom(webview, webview.get_zoom_level() + delta)

    def set_zoom(self, webview: WebKit.WebView, value: float) -> None:
        zoom = save_zoom_level(value)
        webview.set_zoom_level(zoom)
        self.update_zoom_controls(webview)

    def update_zoom_controls(self, webview: WebKit.WebView) -> None:
        zoom = normalized_zoom_level(webview.get_zoom_level())
        if self.zoom_reset_button is not None:
            self.zoom_reset_button.set_label(f"{round(zoom * 100)}%")
        if self.zoom_out_button is not None:
            self.zoom_out_button.set_sensitive(zoom > MIN_ZOOM_LEVEL)
        if self.zoom_in_button is not None:
            self.zoom_in_button.set_sensitive(zoom < MAX_ZOOM_LEVEL)

    def header_icon_button(
        self,
        icon_name: str,
        tooltip: str,
        callback: Callable[[Gtk.Button], object],
    ) -> Gtk.Button:
        button = Gtk.Button.new_from_icon_name(icon_name)
        button.set_tooltip_text(tooltip)
        button.connect("clicked", callback)
        return button

    def header_text_button(
        self,
        label: str,
        callback: Callable[[Gtk.Button], object],
    ) -> Gtk.Button:
        button = Gtk.Button(label=label)
        button.connect("clicked", callback)
        return button

    def load_home(self) -> None:
        if self.webview is not None:
            self.webview.load_uri(HOME_URI)

    def show_native_toast(self, message: str) -> None:
        if self.native_toast_label is None or self.native_toast_revealer is None:
            return
        if self.native_toast_timeout_id is not None:
            GLib.source_remove(self.native_toast_timeout_id)
        self.native_toast_label.set_text(message)
        self.native_toast_revealer.set_reveal_child(True)
        self.native_toast_timeout_id = GLib.timeout_add(
            NATIVE_TOAST_DURATION_MILLISECONDS,
            self.hide_native_toast,
        )

    def hide_native_toast(self) -> bool:
        self.native_toast_timeout_id = None
        if self.native_toast_revealer is not None:
            self.native_toast_revealer.set_reveal_child(False)
        return GLib.SOURCE_REMOVE

    def refresh_asset_version_badge(self) -> None:
        if self.asset_version_label is None:
            return
        version = self.asset_manager.local_version()
        self.asset_version_label.set_text(
            f"Assets v{version}" if version else "Assets unavailable"
        )

    def quit_current_app(self) -> None:
        webview = self.webview
        if webview is None:
            return
        app_id = self.framework_app_id(webview.get_uri())
        if app_id is None:
            self.show_native_toast("No framework app is open")
            return

        if self.quit_button is not None:
            self.quit_button.set_sensitive(False)
            self.quit_button.set_label("Quitting…")
        future = self.executor.submit(
            framework_json_request,
            f"/api/apps/{app_id}/quit",
            "POST",
        )
        future.add_done_callback(
            lambda completed: GLib.idle_add(
                self.finish_quit_current_app,
                webview,
                app_id,
                completed,
            )
        )

    def finish_quit_current_app(
        self,
        webview: WebKit.WebView,
        app_id: str,
        future: Future[object],
    ) -> bool:
        error_message: str | None = None
        try:
            future.result()
        except Exception as error:
            error_message = str(error)

        if self.quit_button is not None:
            self.quit_button.set_label("Quit")
            self.quit_button.set_sensitive(True)

        if self.framework_app_id(webview.get_uri()) == app_id:
            self.load_home()
        if error_message is not None:
            self.show_native_toast(
                f"Failed to quit {app_id}: {error_message}"
            )
        return GLib.SOURCE_REMOVE

    def activate_app_shell_button(self, element_id: str) -> None:
        if self.webview is None or not self.is_app_shell_uri(self.webview.get_uri()):
            return
        self.webview.evaluate_javascript(
            f"document.getElementById({json.dumps(element_id)})?.click();",
            -1,
            None,
            None,
            None,
            None,
            None,
        )

    def on_navigation_state_changed(self, webview: WebKit.WebView, _param) -> None:
        self.update_navigation_controls(webview)

    def on_title_changed(self, webview: WebKit.WebView, _param) -> None:
        title = webview.get_title() or "TE2 Desktop"
        if self.window is not None:
            self.window.set_title(title)
        if self.header_title is not None:
            self.header_title.set_text(title)

    def on_load_changed(
        self,
        webview: WebKit.WebView,
        _load_event: WebKit.LoadEvent,
    ) -> None:
        self.update_navigation_controls(webview)

    def update_navigation_controls(self, webview: WebKit.WebView) -> None:
        if self.back_button is not None:
            self.back_button.set_sensitive(webview.can_go_back())
        if self.forward_button is not None:
            self.forward_button.set_sensitive(webview.can_go_forward())

        in_app_shell = self.is_app_shell_uri(webview.get_uri())
        for button in (
            self.recents_button,
            self.lock_button,
            self.quit_button,
        ):
            if button is not None:
                button.set_visible(in_app_shell)
        if self.lock_button is not None and in_app_shell:
            self.lock_button.set_label("Lock")

    def framework_app_id(self, uri: str | None) -> str | None:
        app_id = app_id_from_uri(uri)
        if app_id is None:
            return None
        try:
            target = urlsplit(str(uri))
            framework = urlsplit(framework_base_url())
        except (TypeError, ValueError):
            return None
        same_origin = (
            target.scheme.lower() == framework.scheme.lower()
            and (target.hostname or "").lower()
            == (framework.hostname or "").lower()
            and target.port == framework.port
        )
        return app_id if same_origin else None

    def is_app_shell_uri(self, uri: str | None) -> bool:
        return self.framework_app_id(uri) is not None

    @staticmethod
    def is_framework_root_uri(uri: str | None) -> bool:
        if not uri:
            return False
        try:
            target = urlsplit(uri)
            framework = urlsplit(framework_base_url())
        except (TypeError, ValueError):
            return False
        return (
            target.scheme.lower() == framework.scheme.lower()
            and (target.hostname or "").lower()
            == (framework.hostname or "").lower()
            and target.port == framework.port
            and target.path in {"", "/"}
        )

    def on_decide_policy(
        self,
        _webview: WebKit.WebView,
        decision: WebKit.PolicyDecision,
        decision_type: WebKit.PolicyDecisionType,
    ) -> bool:
        if decision_type != WebKit.PolicyDecisionType.NAVIGATION_ACTION:
            return False
        try:
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
        except AttributeError:
            return False
        if not self.is_framework_root_uri(uri):
            return False

        decision.ignore()
        GLib.idle_add(self.load_home)
        return True

    def on_context_menu(
        self,
        _webview: WebKit.WebView,
        context_menu: WebKit.ContextMenu,
        _hit_test_result: WebKit.HitTestResult,
    ) -> bool:
        removed_actions = {
            WebKit.ContextMenuAction.GO_BACK,
            WebKit.ContextMenuAction.GO_FORWARD,
            WebKit.ContextMenuAction.RELOAD,
            WebKit.ContextMenuAction.COPY,
            WebKit.ContextMenuAction.PASTE,
        }
        retained_items = [
            item
            for item in context_menu.get_items()
            if item.get_stock_action() not in removed_actions
        ]

        context_menu.remove_all()
        context_menu.append(
            WebKit.ContextMenuItem.new_from_stock_action(
                WebKit.ContextMenuAction.COPY
            )
        )
        context_menu.append(
            WebKit.ContextMenuItem.new_from_stock_action(
                WebKit.ContextMenuAction.PASTE
            )
        )
        if retained_items:
            context_menu.append(WebKit.ContextMenuItem.new_separator())
            for item in retained_items:
                context_menu.append(item)
        return False

    def do_shutdown(self) -> None:
        if self.native_toast_timeout_id is not None:
            GLib.source_remove(self.native_toast_timeout_id)
            self.native_toast_timeout_id = None
        self.asset_server.stop()
        self.executor.shutdown(wait=False, cancel_futures=True)
        Gio.Application.do_shutdown(self)

    def desktop_asset_status(self) -> dict[str, object]:
        status = self.asset_manager.status()
        status.update(
            {
                "serverBaseUrl": self.asset_server.base_url,
                "interceptorAvailable": self.web_extension_build.available,
                "interceptorError": self.web_extension_build.error,
            }
        )
        return status

    def update_desktop_assets(self, force: bool) -> dict[str, object]:
        result = self.asset_manager.update_from_server(
            framework_base_url(),
            force=force,
        ).to_dict()
        result.update(self.desktop_asset_status())
        return result

    def run_asset_update(
        self,
        webview: WebKit.WebView,
        request_id: object,
        *,
        force: bool,
    ) -> None:
        future = self.executor.submit(self.update_desktop_assets, force)
        future.add_done_callback(
            lambda completed: GLib.idle_add(
                self.finish_asset_update,
                webview,
                request_id,
                completed,
            )
        )

    def finish_asset_update(
        self,
        webview: WebKit.WebView,
        request_id: object,
        future: Future[object],
    ) -> bool:
        try:
            value = future.result()
            result = cast(dict[str, object], value)
        except Exception as error:
            if request_id is not None:
                self.reply_native(webview, request_id, False, str(error))
            return GLib.SOURCE_REMOVE

        if result.get("updated"):
            self.refresh_asset_version_badge()
            data_manager = (
                webview.get_network_session().get_website_data_manager()
            )
            data_manager.clear(
                WebKit.WebsiteDataTypes.DISK_CACHE
                | WebKit.WebsiteDataTypes.MEMORY_CACHE,
                0,
                None,
                None,
                None,
            )
            if self.is_app_shell_uri(webview.get_uri()):
                webview.reload_bypass_cache()
            if request_id is None:
                version = str(result.get("localVersion") or "unknown")
                self.show_native_toast(
                    f"Desktop assets updated to v{version}"
                )
        if request_id is not None:
            self.reply_native(webview, request_id, True, result)
        return GLib.SOURCE_REMOVE

    def on_app_uri(self, request: WebKit.URISchemeRequest) -> None:
        uri = request.get_uri()
        prefix = "app://android_shell/"
        if not uri.startswith(prefix):
            request.finish_error(GLib.Error("Invalid application URI"))
            return

        relative_path = uri[len(prefix) :].split("?", 1)[0] or "index.html"
        requested_path = (UI_ROOT / relative_path).resolve()

        try:
            requested_path.relative_to(UI_ROOT.resolve())
        except ValueError:
            request.finish_error(GLib.Error("Path outside UI directory"))
            return

        try:
            data = requested_path.read_bytes()
        except OSError as error:
            request.finish_error(GLib.Error(str(error)))
            return

        mime_type = (
            mimetypes.guess_type(requested_path.name)[0]
            or "application/octet-stream"
        )
        stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(data))
        request.finish(stream, len(data), mime_type)

    def on_native_message(
        self,
        manager: WebKit.UserContentManager,
        message: Any,
        window: Gtk.ApplicationWindow,
    ) -> None:
        del manager
        try:
            payload = json.loads(message.to_string())
            if not isinstance(payload, dict):
                raise TypeError("Native message must be an object")
            request_id = payload.get("id")
            method = payload.get("method")
            params = payload.get("params") or {}
            if not isinstance(params, dict):
                raise TypeError("Native message params must be an object")
        except (TypeError, ValueError, json.JSONDecodeError):
            return

        webview = window.webview
        try:
            if method == "get_settings":
                self.reply_native(
                    webview,
                    request_id,
                    True,
                    load_shell_settings(),
                )
                return

            if method == "save_settings":
                settings = save_shell_settings(params)
                self.reply_native(webview, request_id, True, settings)
                return

            if method == "framework_request":
                self.run_native_task(
                    webview,
                    request_id,
                    framework_json_request,
                    str(params.get("path", "")),
                    str(params.get("method", "GET")),
                    params.get("body"),
                )
                return

            if method == "get_fws_status":
                self.run_native_task(
                    webview,
                    request_id,
                    framework_shells_status,
                )
                return

            if method == "get_asset_status":
                self.reply_native(
                    webview,
                    request_id,
                    True,
                    self.desktop_asset_status(),
                )
                return

            if method == "update_assets":
                self.run_asset_update(
                    webview,
                    request_id,
                    force=True,
                )
                return

            if request_id is not None:
                self.reply_native(
                    webview,
                    request_id,
                    False,
                    f"Unknown native method: {method}",
                )
        except Exception as error:
            if request_id is not None:
                self.reply_native(
                    webview,
                    request_id,
                    False,
                    str(error),
                )

    def run_native_task(
        self,
        webview: WebKit.WebView,
        request_id: object,
        operation: Callable[..., object],
        *args: object,
    ) -> None:
        future = self.executor.submit(operation, *args)
        future.add_done_callback(
            lambda completed: GLib.idle_add(
                self.finish_native_task,
                webview,
                request_id,
                completed,
            )
        )

    def finish_native_task(
        self,
        webview: WebKit.WebView,
        request_id: object,
        future: Future[object],
    ) -> bool:
        try:
            value = future.result()
        except Exception as error:
            self.reply_native(webview, request_id, False, str(error))
        else:
            self.reply_native(webview, request_id, True, value)
        return GLib.SOURCE_REMOVE

    def reply_native(
        self,
        webview: WebKit.WebView,
        request_id: object,
        ok: bool,
        value: object,
    ) -> None:
        script = (
            "globalThis.__te2NativeReply?.("
            f"{json.dumps(request_id)},"
            f"{json.dumps(ok)},"
            f"{json.dumps(value)}"
            ");"
        )
        webview.evaluate_javascript(
            script,
            -1,
            None,
            None,
            None,
            None,
            None,
        )


def main() -> int:
    return WebShell().run()


if __name__ == "__main__":
    raise SystemExit(main())
