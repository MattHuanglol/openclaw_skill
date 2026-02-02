#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import subprocess
import sys
from urllib.request import urlopen, Request

ROOT = "/home/matt/clawd/project-kanban"
DB_PATH = os.path.join(ROOT, "data", "kanban.sqlite")
BASE_URL_LOCAL = "http://127.0.0.1:3001"


def http_get(url, timeout=2.0):
    req = Request(url, headers={"User-Agent": "kanban-ops/1.0"})
    with urlopen(req, timeout=timeout) as r:
        body = r.read(512)
        return r.status, body


def check_http():
    out = {
        "baseUrl": BASE_URL_LOCAL,
        "ok": False,
        "root": {"ok": False, "status": None},
        "tasks": {"ok": False, "status": None},
        "mailboxes": {"ok": False, "status": None},
    }
    try:
        s, body = http_get(BASE_URL_LOCAL + "/")
        out["root"]["status"] = s
        out["root"]["ok"] = (s == 200 and body.lstrip().startswith(b"<!DOCTYPE html") )
    except Exception:
        pass

    try:
        s, _ = http_get(BASE_URL_LOCAL + "/api/tasks")
        out["tasks"]["status"] = s
        out["tasks"]["ok"] = (s == 200)
    except Exception:
        pass

    try:
        s, _ = http_get(BASE_URL_LOCAL + "/api/mailboxes")
        out["mailboxes"]["status"] = s
        out["mailboxes"]["ok"] = (s == 200)
    except Exception:
        pass

    out["ok"] = out["root"]["ok"] and out["tasks"]["ok"] and out["mailboxes"]["ok"]
    return out


def db_summary():
    out = {
        "dbPath": DB_PATH,
        "exists": os.path.exists(DB_PATH),
        "schemaVersion": None,
        "countsByStatus": {},
        "review": [],
    }

    if not out["exists"]:
        return out

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    try:
        r = cur.execute("SELECT value FROM meta WHERE key='schemaVersion'").fetchone()
        out["schemaVersion"] = r["value"] if r else None
    except Exception:
        out["schemaVersion"] = None

    try:
        rows = cur.execute("SELECT status, COUNT(1) c FROM tasks GROUP BY status").fetchall()
        out["countsByStatus"] = {row["status"]: row["c"] for row in rows}
    except Exception:
        out["countsByStatus"] = {}

    try:
        rows = cur.execute("SELECT id, seq, title FROM tasks WHERE status='review' ORDER BY seq").fetchall()
        out["review"] = [{"id": row["id"], "seq": row["seq"], "title": row["title"]} for row in rows]
    except Exception:
        out["review"] = []

    con.close()
    return out


def service_status():
    # user service: project-kanban.service
    cmd = ["systemctl", "--user", "is-active", "project-kanban.service"]
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
        return {"ok": p.returncode == 0, "state": p.stdout.strip()}
    except Exception as e:
        return {"ok": False, "state": None, "error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    data = {
        "service": service_status(),
        "http": check_http(),
        "db": db_summary(),
    }

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    print("service:", data["service"])
    print("http:", data["http"])
    print("db:", data["db"])


if __name__ == "__main__":
    main()
