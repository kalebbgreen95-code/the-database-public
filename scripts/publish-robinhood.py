import json
import pathlib
import subprocess
import sys
import time
import urllib.request

home = pathlib.Path.home()
config = json.loads((pathlib.Path(__file__).with_name("publisher.json")).read_text())
snapshot_path = home / "investment-tool/state/robinhood-portfolio.json"


def request(url, headers, data=None):
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def publish():
    request(config["publish_url"], {
        "Content-Type": "application/json",
        "x-robinhood-publisher-token": config["token"],
    }, snapshot_path.read_bytes())


def watch():
    handled = None
    while True:
        try:
            rows = request(config["queue_url"], {
                "apikey": config["publishable_key"],
                "x-robinhood-publisher-token": config["token"],
            })
            pending = rows[0]["requested_at"] if rows else None
            if pending and pending != handled:
                handled = pending
                subprocess.run(["systemctl", "--user", "start", "investment-tool-robinhood.service"],
                               check=True, timeout=90)
        except Exception as error:
            print("Robinhood refresh worker:", type(error).__name__, flush=True)
        time.sleep(5)


if __name__ == "__main__":
    if sys.argv[1:] == ["--publish"]:
        try:
            publish()
        except Exception as error:
            raise SystemExit("Robinhood publish failed: " + type(error).__name__) from None
    else:
        watch()
