import json
import pathlib
import sys
from urllib.parse import urljoin
from urllib.request import Request, urlopen


def json_request(url, headers=None, body=None):
    request = Request(url, headers=headers or {}, data=body)
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def publish(config):
    original = "http://127.0.0.1:8787/api/checklist-buys"
    target = urljoin(config["publish_url"], "/account-api/oracle-stock-scans")
    if not target.startswith("https://"):
        raise ValueError("An HTTPS Render origin is required")
    for view, suffix in (("stocks", ""), ("ai", "?view=ai")):
        scan = json_request(original + suffix)
        if scan.get("pending") or not scan.get("checkedAt"):
            continue
        payload = {key: scan.get(key) for key in ("rows", "checkedAt", "failed")}
        json_request(target + "?view=" + view, {
            "Content-Type": "application/json",
            "x-robinhood-publisher-token": config["token"],
        }, json.dumps(payload, allow_nan=False, separators=(",", ":")).encode())


if __name__ == "__main__":
    config_file = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).with_name("publisher.json")
    publish(json.loads(config_file.read_text()))
