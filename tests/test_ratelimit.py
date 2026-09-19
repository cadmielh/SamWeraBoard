"""Limitarea per utilizator/workspace (ratelimit.py), contra emulatorului Firestore.

Rulare: firebase emulators:exec --only firestore --project demo-samwera ".venv/bin/python -m pytest tests/test_ratelimit.py -q"
"""
import os
import sys
import threading
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import ratelimit  # noqa: E402


@pytest.fixture()
def db(monkeypatch):
    client = gcf.Client(project="demo-samwera")
    for d in client.collection("rateLimits").stream():
        d.reference.delete()
    monkeypatch.setattr(authz, "db", lambda: client)
    monkeypatch.setattr(ratelimit, "LIMITS", {
        "u3": [("user", 3, 60)],
        "w2": [("workspace", 2, 3600)],
        "both": [("user", 2, 60), ("workspace", 3, 3600)],
    })
    return client


def test_user_limit_blocks_after_the_limit_and_reports_retry_after(db):
    for _ in range(3):
        ratelimit.check("alice", "ws1", "u3", now=1000.0)
    with pytest.raises(authz.RateLimited) as e:
        ratelimit.check("alice", "ws1", "u3", now=1000.0)
    assert e.value.status == 429 and e.value.public == "rate_limited"
    assert 1 <= e.value.retry_after <= 60


def test_limits_are_per_user(db):
    for _ in range(3):
        ratelimit.check("alice", "ws1", "u3", now=1000.0)
    ratelimit.check("bob", "ws1", "u3", now=1000.0)            # alt utilizator, aceeași fereastră: nu e afectat


def test_workspace_limit_counts_all_users_together(db):
    ratelimit.check("alice", "ws1", "w2", now=1000.0)
    ratelimit.check("bob", "ws1", "w2", now=1000.0)
    with pytest.raises(authz.RateLimited):
        ratelimit.check("carol", "ws1", "w2", now=1000.0)      # al treilea, indiferent de cine
    ratelimit.check("carol", "ws2", "w2", now=1000.0)          # alt workspace: independent


def test_window_rollover_resets_the_counter(db):
    for _ in range(3):
        ratelimit.check("alice", "ws1", "u3", now=1000.0)      # fereastra 960–1020
    with pytest.raises(authz.RateLimited):
        ratelimit.check("alice", "ws1", "u3", now=1019.0)
    ratelimit.check("alice", "ws1", "u3", now=1020.0)          # fereastră nouă


def test_a_rejected_request_does_not_consume_the_other_counters(db):
    # user: 2/min, workspace: 3/oră. Alice epuizează limita ei; respingerile nu mănâncă din cota workspace-ului.
    ratelimit.check("alice", "ws1", "both", now=5000.0)
    ratelimit.check("alice", "ws1", "both", now=5000.0)
    for _ in range(5):
        with pytest.raises(authz.RateLimited):
            ratelimit.check("alice", "ws1", "both", now=5000.0)
    ratelimit.check("bob", "ws1", "both", now=5000.0)          # workspace: 3-a cerere acceptată (2 + 1)
    with pytest.raises(authz.RateLimited):
        ratelimit.check("bob", "ws1", "both", now=5000.0)      # abia acum workspace-ul e la limită


def test_counters_have_expiry_and_hold_no_personal_data(db):
    ratelimit.check("alice-uid-123", "ws-secret-1", "u3", now=1000.0)
    docs = [d.to_dict() for d in db.collection("rateLimits").stream()]
    assert len(docs) == 1
    d = docs[0]
    assert set(d) == {"count", "action", "expireAt"} and d["count"] == 1
    assert d["expireAt"].timestamp() > 1000.0                  # se șterge automat (politica TTL)
    ids = [x.id for x in db.collection("rateLimits").stream()]
    assert all("alice" not in i and "ws-secret" not in i for i in ids)     # id-ul documentului e un hash


def test_unknown_action_is_not_limited(db):
    for _ in range(50):
        ratelimit.check("alice", "ws1", "nu-exista", now=1000.0)


def test_fails_open_when_firestore_is_unavailable(monkeypatch, capsys):
    def boom():
        raise RuntimeError("firestore down")
    monkeypatch.setattr(authz, "db", boom)
    monkeypatch.setattr(ratelimit, "LIMITS", {"u3": [("user", 1, 60)]})
    for _ in range(5):
        ratelimit.check("alice", "ws1", "u3")                   # nu ridică: disponibilitatea primează
    assert "[ratelimit] indisponibil" in capsys.readouterr().out


def test_concurrent_requests_never_exceed_the_limit(db):
    ok, blocked = [], []

    def hit():
        try:
            ratelimit.check("alice", "ws1", "u3", now=2000.0)
            ok.append(1)
        except authz.RateLimited:
            blocked.append(1)

    ts = [threading.Thread(target=hit) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ok) == 3 and len(blocked) == 2
