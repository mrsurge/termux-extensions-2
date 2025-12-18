Here’s a clean way to do it in GeckoView:

## 1) Pipe `console.*` into native (selectable) overlay via a built-in WebExtension

GeckoView’s “preferred” interaction path is **WebExtensions + native messaging** (extension → app via `runtime.sendNativeMessage`). ([Firefox Source Docs][1])

### A. Add a bundled extension in `app/src/main/assets/console_pipe/`

**`manifest.json`**

```json
{
  "manifest_version": 2,
  "name": "console_pipe",
  "version": "1.0",
  "description": "Forward console output to the GeckoView embedder.",
  "browser_specific_settings": {
    "gecko": { "id": "console_pipe@example.com" }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ],
  "permissions": [
    "nativeMessaging",
    "nativeMessagingFromContent",
    "geckoViewAddons"
  ]
}
```

> `nativeMessagingFromContent` is the key that allows **content scripts** to send native messages (when you also set a session message delegate). ([Firefox Source Docs][1])

**`content.js`**

```js
(() => {
  // Gate everything behind a flag only your app sets.
  // Easiest: append ?gv_native=1 to the URL your app loads.
  const enabled = new URLSearchParams(location.search).get("gv_native") === "1";
  if (!enabled) return;

  // Bridge page-context console -> content script via window.postMessage
  const INJECTED = `
    (() => {
      const MAX = 4000;

      function safeStringify(v) {
        try {
          if (typeof v === "string") return v;
          return JSON.stringify(v);
        } catch (e) {
          try { return String(v); } catch (_) { return "[unprintable]"; }
        }
      }

      function pack(level, args) {
        const parts = [];
        for (const a of args) {
          const s = safeStringify(a);
          parts.push(s.length > MAX ? (s.slice(0, MAX) + "…") : s);
        }
        return parts.join(" ");
      }

      const levels = ["log", "info", "warn", "error", "debug"];
      const orig = {};
      for (const lvl of levels) {
        orig[lvl] = console[lvl].bind(console);
        console[lvl] = (...args) => {
          try {
            window.postMessage({
              __gv_console__: true,
              level: lvl,
              text: pack(lvl, args),
              ts: Date.now(),
              url: location.href
            }, "*");
          } catch (_) {}
          orig[lvl](...args);
        };
      }

      window.addEventListener("error", (e) => {
        try {
          window.postMessage({
            __gv_console__: true,
            level: "error",
            text: e.message + " @ " + e.filename + ":" + e.lineno + ":" + e.colno,
            ts: Date.now(),
            url: location.href
          }, "*");
        } catch (_) {}
      });

      window.addEventListener("unhandledrejection", (e) => {
        try {
          window.postMessage({
            __gv_console__: true,
            level: "error",
            text: "Unhandled rejection: " + (e.reason ? String(e.reason) : ""),
            ts: Date.now(),
            url: location.href
          }, "*");
        } catch (_) {}
      });
    })();
  `;

  const s = document.createElement("script");
  s.textContent = INJECTED;
  (document.documentElement || document).appendChild(s);
  s.remove();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__gv_console__ !== true) return;

    // Send to the embedder app. nativeApp id must match setMessageDelegate(..., "browser")
    browser.runtime.sendNativeMessage("browser", {
      type: "console",
      level: d.level,
      text: d.text,
      ts: d.ts,
      url: d.url
    });
  });
})();
```

### B. Install the extension + receive messages in your Activity (Kotlin)

This is the exact delegate mechanism GeckoView documents: `ensureBuiltIn(...)` then `session.getWebExtensionController().setMessageDelegate(...)`. ([Firefox Source Docs][1])

```kotlin
import android.graphics.Typeface
import android.os.Bundle
import android.text.method.ScrollingMovementMethod
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import org.mozilla.geckoview.*

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var session: GeckoSession
    private lateinit var runtime: GeckoRuntime

    private lateinit var logOverlay: FrameLayout
    private lateinit var logText: TextView

    private val maxLines = 2000
    private val lines = ArrayDeque<String>(maxLines)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // --- Native UI: header + GeckoView + overlay log panel ---
        val root = FrameLayout(this)

        val vertical = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val nativeHeader = TextView(this).apply {
            text = "Native Header"
            setPadding(24, 24, 24, 24)
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
            setOnClickListener { toggleLogs() } // tap header to toggle logs (starter)
        }

        geckoView = GeckoView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        vertical.addView(nativeHeader)
        vertical.addView(geckoView)
        root.addView(vertical)

        logText = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 12f
            setPadding(24, 24, 24, 24)
            setTextIsSelectable(true) // <- selectable
            movementMethod = ScrollingMovementMethod()
        }

        logOverlay = FrameLayout(this).apply {
            setBackgroundColor(0xCC000000.toInt())
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setOnClickListener { toggleLogs() } // tap backdrop to close
        }

        val scroll = ScrollView(this).apply {
            addView(logText)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ).apply {
                gravity = Gravity.BOTTOM
            }
        }
        logOverlay.addView(scroll)
        root.addView(logOverlay)

        setContentView(root)

        // --- Gecko runtime/session ---
        val settings = GeckoRuntimeSettings.Builder()
            .consoleOutput(false) // logcat console mirroring (not needed for in-app pipe) :contentReference[oaicite:3]{index=3}
            .build()

        runtime = GeckoRuntime.create(this, settings)
        session = GeckoSession()
        session.open(runtime)
        geckoView.setSession(session)

        installConsoleExtension()

        // Load with an app-only flag (easy) OR use headers (more “app-only”, see section 2)
        val url = "https://example.com/app?gv_native=1"
        session.load(GeckoSession.Loader().uri(url))
    }

    private fun installConsoleExtension() {
        val extLocation = "resource://android/assets/console_pipe/"

        val messageDelegate = object : WebExtension.MessageDelegate {
            override fun onMessage(
                nativeApp: String,
                message: Any,
                sender: WebExtension.MessageSender
            ): GeckoResult<Any>? {
                if (message is JSONObject && message.optString("type") == "console") {
                    val level = message.optString("level")
                    val text = message.optString("text")
                    val url = message.optString("url")
                    appendLog("[$level] $text\n$url")
                }
                return null
            }
        }

        runtime.webExtensionController
            .ensureBuiltIn(extLocation, "console_pipe@example.com")
            .accept(
                { extension ->
                    session.webExtensionController
                        .setMessageDelegate(extension, messageDelegate, "browser")
                },
                { e -> appendLog("[error] Extension install failed: ${e.message}") }
            )
    }

    private fun appendLog(line: String) {
        runOnUiThread {
            if (lines.size == maxLines) lines.removeFirst()
            lines.addLast(line)

            val sb = StringBuilder()
            for (l in lines) {
                sb.append(l).append("\n\n")
            }
            logText.text = sb.toString()
        }
    }

    private fun toggleLogs() {
        logOverlay.visibility = if (logOverlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }
}
```

---

## 2) “Header gets nixed when flag is set; native header replaces it”

### Option A (cleanest when you control the server/page): app-only request header

GeckoView lets you add request headers for the top-level load with `GeckoSession.Loader.additionalHeaders(...)`, and you may need `headerFilter(...)` because only CORS-safelisted headers are allowed by default. ([Mozilla][2])

```kotlin
val headers = mapOf("X-GV-Native" to "1")

session.load(
  GeckoSession.Loader()
    .uri("https://example.com/app")
    .headerFilter(GeckoSession.HEADER_FILTER_UNRESTRICTED_UNSAFE) // allow custom header
    .additionalHeaders(headers)
)
```

Then your server decides whether to render the web header:

* If `X-GV-Native: 1` → **don’t render** `<header>...</header>`
* Else → render normally

Your Android UI already “fills the gap” because the native header is outside the GeckoView (in the layout above it).

### Option B (when you can’t change the server): hide/remove the header in the extension

Inside `content.js` (when enabled), do something like:

```js
const hdr = document.querySelector("#web-header");
if (hdr) hdr.remove();
```

---

That’s enough to get the first milestone working: **console → native selectable overlay**, and **web header → native header** behind an app-only flag (URL or request header).

[1]: https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html "Interacting with Web content — Firefox Source Docs  documentation"
[2]: https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/GeckoSession.Loader.html "GeckoSession.Loader (geckoview 148.0.20251215210630 API)"

MESSAGE BUS
-

If your backend is **Python (FastAPI/Starlette/Uvicorn)**, then yes: the clean “bus” is a **WebSocket broker in Python**, with **two clients** connected to it:

* **Page JS ↔ Python bus (WebSocket)**
* **Kotlin UI ↔ Python bus (WebSocket)**

Then “trigger an event listener in the page” becomes: **Kotlin sends `{name, payload}` → Python broadcasts → page receives → dispatches `CustomEvent`**. No GeckoView-only trick required for normal DOM mutations.

Where the **WebExtension bridge** still matters: anything “privileged” that the page shouldn’t be trusted to originate (console capture, app-only signals, etc.). You can forward those privileged events into the same Python bus.

## 1) Python WebSocket bus (FastAPI)

```py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from collections import defaultdict
import json

app = FastAPI()
peers = defaultdict(dict)  # session_id -> {client_id: WebSocket}

@app.websocket("/ws/bus/{session_id}")
async def ws_bus(ws: WebSocket, session_id: str):
    await ws.accept()
    cid = id(ws)
    peers[session_id][cid] = ws
    try:
        while True:
            text = await ws.receive_text()
            # broadcast to everyone else in same session
            for pid, peer in list(peers[session_id].items()):
                if pid != cid:
                    await peer.send_text(text)
    except WebSocketDisconnect:
        peers[session_id].pop(cid, None)
        if not peers[session_id]:
            peers.pop(session_id, None)
```

## 2) Page side: receive bus messages and “turn them into events”

```js
const sessionId = new URLSearchParams(location.search).get("sid");
const ws = new WebSocket(`ws://${location.host}/ws/bus/${sessionId}`);

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg?.type === "dispatch" && msg?.name) {
    window.dispatchEvent(new CustomEvent(msg.name, { detail: msg.payload ?? null }));
  }
};

// send page->bus events if you want
function emit(name, payload) {
  ws.send(JSON.stringify({ type: "event", name, payload, src: "page" }));
}
```

Now your normal page code can do:

```js
window.addEventListener("gv:doThing", (e) => {
  // mutate DOM, toggle header, etc.
});
```

## 3) Kotlin side: connect to the same bus and dispatch events

Use an app WebSocket client (OkHttp is common):

```kotlin
val sessionId = /* generate per GeckoSession */
val url = "ws://127.0.0.1:8000/ws/bus/$sessionId"

val client = OkHttpClient()
val ws = client.newWebSocket(
  Request.Builder().url(url).build(),
  object : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) {
      // messages from page/backend -> update native UI, etc.
    }
  }
)

fun dispatchToPage(name: String, payload: JSONObject) {
  val msg = JSONObject()
    .put("type", "dispatch")
    .put("name", name)
    .put("payload", payload)
    .put("src", "native")
  ws.send(msg.toString())
}
```

### How this fits your “header replacement” idea

* Kotlin decides “native header on/off”.
* If Kotlin wants the page to hide/adjust something too, it sends `dispatchToPage("gv:headerMode", {...})`.
* Page listens and mutates accordingly.

### Where the GeckoView WebExtension fits in this setup

Use it only as a **privileged tap** (console/events that only the embedder should control). When the extension receives a console message, Kotlin can forward it into the same Python WS bus (or directly update the native overlay).

That gives you one coherent “bus” (Python WS) and one privileged bridge (WebExtension) when needed.

