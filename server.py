# LAN server for the check-in app: serves the static files and relays check-in counts to the star screen.
# input: HTTP requests from check-in pads and the screen page; project files next to this script
# output: static files, GET /api/sky (merged counts), POST /api/sky (one device's counts)
# pos: optional deployment entry point; the app still works without it
# Once I am updated, update my header comments and my folder's md doc.
import argparse
import functools
import http.server
import json
import os
import re
import socket
import threading
import time
import webbrowser

API_PATH = "/api/sky"
MAX_BODY = 2048
MAX_COUNT = 100000
MAX_DEVICES = 50
MAX_TITLE = 60
DEVICE_RE = re.compile(r"^[\w-]{4,64}$")
MIME = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png",
        ".svg": "image/svg+xml", ".json": "application/json", ".jpg": "image/jpeg"}


def valid_count(value):
    """Return True for a non-negative int within range."""
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_COUNT


class SkyBoard:
    """Latest counts per device; checked is summed, total is the largest roster."""

    def __init__(self, clock=time.time):
        self._clock = clock
        self._lock = threading.Lock()
        self._devices = {}

    def update(self, data):
        if not isinstance(data, dict) or not DEVICE_RE.match(str(data.get("device", ""))):
            return False
        checked, total, title = data.get("checked"), data.get("total"), data.get("title", "")
        if not valid_count(checked) or not valid_count(total) or not isinstance(title, str):
            return False
        entry = {"checked": checked, "total": total, "title": title.strip()[:MAX_TITLE], "t": self._clock()}
        with self._lock:
            others = {k: v for k, v in self._devices.items() if k != data["device"]}
            newest = sorted(others.items(), key=lambda kv: kv[1]["t"])[-(MAX_DEVICES - 1):]
            self._devices = {**dict(newest), data["device"]: entry}
        return True

    def summary(self):
        with self._lock:
            entries = list(self._devices.values())
        now = self._clock()
        titled = sorted((e for e in entries if e["title"] and e["total"] > 0), key=lambda e: e["t"])
        last = max((e["t"] for e in entries), default=None)
        return {
            "checked": sum(e["checked"] for e in entries),
            "total": max((e["total"] for e in entries), default=0),
            "title": titled[-1]["title"] if titled else "",
            "devices": len(entries),
            "ageSec": None if last is None else round(now - last, 1),
        }


class Handler(http.server.SimpleHTTPRequestHandler):
    board = SkyBoard()
    quiet = False
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}

    def _api(self):
        return self.path.split("?", 1)[0] == API_PATH

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self._api():
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self._api():
            self._send_json(200, self.board.summary())
            return
        super().do_GET()

    def do_POST(self):
        if not self._api():
            self._send_json(404, {"ok": False})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self._send_json(413 if length > MAX_BODY else 400, {"ok": False})
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"ok": False})
            return
        ok = self.board.update(data)
        self._send_json(200 if ok else 400, {"ok": ok})

    def log_message(self, fmt, *args):
        if not self.quiet and not self._api():
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128
    allow_reuse_address = os.name != "nt"


def lan_ips():
    """Best-effort IPv4 LAN addresses for the startup hint, routed one first; no packet is sent."""
    found = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        found += [a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    ips = [ip for ip in dict.fromkeys(found) if not ip.startswith(("127.", "169.254."))]
    return ips or ["127.0.0.1"]


def print_banner(port):
    """Print the URLs staff need: pad URLs per LAN address and the local screen URL."""
    ips = lan_ips()
    print("=" * 56, flush=True)
    print("签到服务已启动。这个窗口不要关，关掉服务就停了。", flush=True)
    print(f"iPad / 平板 用 Safari 打开签到页: http://{ips[0]}:{port}/index.html", flush=True)
    for ip in ips[1:]:
        print(f"  打不开时依次试:               http://{ip}:{port}/index.html", flush=True)
    print(f"管理页（导入名单）:             http://{ips[0]}:{port}/admin.html", flush=True)
    print(f"星空大屏（本机浏览器）:         http://localhost:{port}/screen.html", flush=True)
    print("=" * 56, flush=True)


def main():
    parser = argparse.ArgumentParser(description="签到 + 星空大屏 局域网服务")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--open", action="store_true", help="启动后在本机浏览器打开大屏")
    args = parser.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    Handler.quiet = args.quiet
    handler = functools.partial(Handler, directory=root)
    try:
        server = Server((args.host, args.port), handler)
    except OSError as err:
        print(f"端口 {args.port} 无法使用（{err}）。可能已经开了一个签到服务窗口，先关掉它再试。")
        raise SystemExit(1)
    if not args.quiet:
        threading.Thread(target=print_banner, args=(args.port,), daemon=True).start()
    if args.open:
        threading.Timer(1.0, webbrowser.open, args=(f"http://localhost:{args.port}/screen.html",)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
