# Unit tests for the SkyBoard relay and static cache headers in server.py; run with `python3 -m unittest discover tests`.
import os
import sys
import threading
import unittest
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402


class FakeClock:
    """Manually advanced clock."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class SkyBoardTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.board = server.SkyBoard(clock=self.clock)

    def test_empty_summary(self):
        self.assertEqual(self.board.summary(), {"checked": 0, "total": 0, "title": "", "devices": 0, "ageSec": None})

    def test_sums_checked_and_takes_max_total(self):
        self.assertTrue(self.board.update({"device": "pad-a", "checked": 10, "total": 100, "title": "分享会"}))
        self.assertTrue(self.board.update({"device": "pad-b", "checked": 5, "total": 90, "title": ""}))
        self.clock.now += 4
        s = self.board.summary()
        self.assertEqual((s["checked"], s["total"], s["title"], s["devices"], s["ageSec"]), (15, 100, "分享会", 2, 4.0))

    def test_same_device_replaces_previous_counts(self):
        self.board.update({"device": "pad-a", "checked": 10, "total": 100})
        self.board.update({"device": "pad-a", "checked": 9, "total": 100})
        self.assertEqual(self.board.summary()["checked"], 9)

    def test_rejects_invalid_payloads(self):
        bad = [None, [], {"device": "x", "checked": 1, "total": 1}, {"device": "pad-a", "checked": -1, "total": 1},
               {"device": "pad-a", "checked": True, "total": 1}, {"device": "pad-a", "checked": 1, "total": "9"},
               {"device": "pad a!", "checked": 1, "total": 1}, {"device": "pad-a", "checked": 1, "total": 1, "title": 5}]
        for payload in bad:
            self.assertFalse(self.board.update(payload), payload)
        self.assertEqual(self.board.summary()["devices"], 0)

    def test_caps_device_count_and_title_length(self):
        for i in range(server.MAX_DEVICES + 5):
            self.clock.now += 1
            self.board.update({"device": f"pad-{i:03d}", "checked": 1, "total": 1, "title": "长" * 100})
        s = self.board.summary()
        self.assertEqual(s["devices"], server.MAX_DEVICES)
        self.assertEqual(len(s["title"]), server.MAX_TITLE)


class LanIpsTest(unittest.TestCase):
    def test_returns_usable_ipv4_list(self):
        ips = server.lan_ips()
        self.assertTrue(ips)
        for ip in ips:
            self.assertRegex(ip, r"^\d+\.\d+\.\d+\.\d+$")
        self.assertTrue(ips == ["127.0.0.1"] or not any(ip.startswith(("127.", "169.254.")) for ip in ips))


class StaticCacheTest(unittest.TestCase):
    """Static files must revalidate so code updates reach tablets after a reload."""

    def test_static_files_are_revalidated(self):
        root = os.path.join(os.path.dirname(__file__), "..")
        handler = lambda *a, **kw: server.Handler(*a, directory=root, **kw)
        httpd = server.Server(("127.0.0.1", 0), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{httpd.server_address[1]}"
            with urllib.request.urlopen(f"{url}/js/ui/kiosk.js") as res:
                self.assertEqual(res.headers["Cache-Control"], "no-cache")
            with urllib.request.urlopen(f"{url}/api/sky") as res:
                self.assertEqual(res.headers["Cache-Control"], "no-store")
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
