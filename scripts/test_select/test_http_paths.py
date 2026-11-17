"""Replay step 5b (http_paths.py): synthetic HTTP records and mock lines —
every class decided, and every finding red for its own reason (Codex R268,
R269, R389 D4, R390 VM389-01). The same cases run in the real browser in
e2e/http-paths.spec.ts with replay_http_expect.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import http_paths  # noqa: E402

RUN = "run-1"
KEY = ("t1", 0)
ATTEMPTS = {KEY: {"file": "x.spec.ts", "title": "a test", "project": "e2e", "instance": "m1", "status": "passed"}}
NAME = {KEY: "x.spec.ts › a test [retry 0]"}
BOUND = {"m1": {"port": 4500, "workerIndex": 0}}
ORIGIN = {"run": RUN, "test": "t1", "project": "e2e", "retry": 0}
HOST = "localhost:4500"


class Rec:
    """A worker's HTTP record and the mock's lines, built line by line."""

    def __init__(self) -> None:
        self.lines = [{"t": 0, "k": "ctx", "ctx": "c1", "how": "fixture", **ORIGIN}]
        self.mock: list[tuple[str, dict]] = []
        self.opens: list[tuple[str, dict]] = []
        self.t = 0

    def req(self, rid: str, path: str, *, method: str = "GET", frm: str | None = None, at: str = "request",
            host: str = HOST, type_: str = "fetch", qkeys: list | None = None, t: int | None = None) -> Rec:
        self.t += 1
        self.lines.append({"t": self.t if t is None else t, "k": "req", "ctx": "c1", "id": rid, "at": at, "method": method,
                           "host": host, "path": path, "qkeys": qkeys or [], "type": type_, "sw": False, "from": frm,
                           "route": None, "variant": None})
        return self

    def act(self, rid: str, act: str, **kw) -> Rec:
        self.lines.append({"t": self.t, "k": "act", "id": rid, "act": act, **kw})
        return self

    def end(self, rid: str, transport: str = "finished", status: int | None = 200) -> Rec:
        self.lines.append({"t": self.t, "k": "end", "id": rid, "transport": transport,
                           **({"status": status} if transport == "finished" else {"error": "net::ERR_ABORTED"})})
        return self

    def contact(self, path: str, req_id: str | None, *, served: str | None = "static", status: int | None = 200,
                method: str = "GET", qkeys: list | None = None, origin: dict | None = None, closed: bool = False) -> Rec:
        self.mock.append(("m1", {"kind": "http", "method": method, "path": path, "qkeys": qkeys or [],
                                 "origin": ORIGIN if origin is None else origin, "req_id": req_id, "status": status,
                                 "served": served, **({"closed": True} if closed else {})}))
        return self

    def closing(self, t: int, sw: int = 0) -> Rec:
        self.lines.append({"t": t, "k": "closing", "ctx": "c1", "sw": sw})
        return self

    def judge(self, tmp: Path, loaded: set | None = None, expect: list | None = None, close: bool = True,
              worker: int = 0) -> dict:
        d = tmp / "http"
        d.mkdir(exist_ok=True)
        lines = list(self.lines)
        # a finished run's record ends every context (the fixture's close)
        if close and not any(x["k"] == "closing" and x["ctx"] == "c1" for x in lines):
            lines.append({"t": self.t + 1, "k": "closing", "ctx": "c1", "sw": 0})
        (d / f"{RUN}-w{worker}.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))
        return http_paths.judge(d, RUN, ATTEMPTS, NAME, BOUND, self.mock, self.opens, loaded or set(),
                                expect if expect is not None else [])


def served(rec: Rec, rid: str, path: str, **kw) -> Rec:
    return rec.req(rid, path).act(rid, "catch-all").contact(path, f"req:{rid}", **kw).end(rid)


def classes(res: dict) -> dict:
    return res["classes"]


# ── the classes ────────────────────────────────────────────────────────────

def test_a_forwarded_request_with_its_one_contact_is_served_and_the_fallback_is_not(tmp_path):
    rec = served(Rec(), "1", "/devices", served="handler")
    rec = served(rec, "2", "/g30", served="fallback")
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"served": 1, "fallback": 1}
    assert res["fallback_paths"] == {"GET /g30": 1}


def test_replaced_fetched_and_aborted_by_the_spec(tmp_path):
    rec = Rec().req("1", "/devices").act("1", "handler").act("1", "fulfill", status=200).end("1")
    rec.req("2", "/devices").act("2", "handler").act("2", "fetch", op="f1").act("2", "fulfill", status=200, response=True)
    rec.contact("/devices", "fetch:f1", served="handler").end("2")
    rec.req("3", "/devices").act("3", "handler").act("3", "abort").end("3", "failed")
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"aborted": 1, "replaced": 1, "fetched": 1}


def test_the_three_redirect_cases_of_r268_keep_their_verdicts(tmp_path):
    # 1: a server redirect — two contacts under the first id; its hop gets no route call
    rec = Rec().req("1", "/r").act("1", "catch-all").contact("/r", "req:1", status=302).contact("/t", "req:1")
    rec.req("2", "/t", frm="1").end("1", status=302).end("2")
    # 2: a synthetic 302 — the follow-up reaches the mock without an id
    rec.req("3", "/s").act("3", "handler").act("3", "fulfill", status=302).end("3", status=302)
    rec.req("4", "/t", frm="3").contact("/t", None).end("4")
    # 3: a fetch through a server redirect — two contacts under the fetch
    rec.req("5", "/r").act("5", "handler").act("5", "fetch", op="f9").act("5", "fulfill", status=200, response=True)
    rec.contact("/r", "fetch:f9", status=302).contact("/t", "fetch:f9").end("5")
    res = rec.judge(tmp_path)
    assert res["findings"] == []
    assert classes(res) == {"replaced": 1, "fetch-unknown": 1, "redirect-chain": 1, "redirect-hop": 2}
    assert res["idless_covered_by_synthetic_hops"] == 1


def test_closing_after_the_mark_held_by_a_spec_other_server_and_aborted_before_routing(tmp_path):
    rec = Rec().req("2", "/tool-table", t=10).act("2", "handler")
    rec.req("3", "/", host="localhost:4173", t=11).act("3", "catch-all").end("3")
    rec.req("4", "/telemetry", method="POST", type_="ping", t=12).end("4", "failed")
    rec.closing(40).req("1", "/g30", t=50).act("1", "catch-all")
    res = rec.judge(tmp_path)
    assert res["findings"] == []
    assert classes(res) == {"other-server": 1, "closing": 1, "held": 1, "aborted-early": 1}


def test_the_record_s_order_decides_closing_never_the_millisecond(tmp_path):
    # the proof gate at 371ead38: request, handler and mark in ONE millisecond —
    # the request came first, so its spec held it; the clock would say closing
    held = Rec().req("1", "/tool-table", t=7).act("1", "handler").closing(7)
    assert classes(held.judge(tmp_path)) == {"held": 1}
    late = Rec().closing(7).req("1", "/g30", t=7).act("1", "catch-all")
    assert classes(late.judge(tmp_path)) == {"closing": 1}
    # a request BEFORE the mark without an end and without a handler is no
    # closing request: it has no named path
    early = Rec().req("1", "/g30", t=8).act("1", "catch-all").closing(7)
    assert any("no named path" in f for f in early.judge(tmp_path)["findings"])


def test_the_firefox_ws_handshake_is_its_own_class_joined_by_its_id(tmp_path):
    rec = Rec().req("1", "/ws", type_="document").act("1", "catch-all")
    rec.opens.append(("m1", {"kind": "open", "conn": 1, "origin": ORIGIN, "req_id": "req:1"}))
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"ws-handshake": 1} and res["ws_handshakes_joined"] == 1


# ── the findings, each red for its own reason ──────────────────────────────

@pytest.mark.parametrize("build,why", [
    # R390 VM389-01: the four red counter-cases of the redirect bound
    (lambda r: r.req("3", "/s").act("3", "handler").act("3", "fulfill", status=302).req("4", "/t", frm="3")
     .contact("/t", None).contact("/t", None), "no synthetic redirect hop of the attempt covers it"),
    (lambda r: r.req("3", "/s").act("3", "handler").act("3", "fulfill", status=302).req("4", "/t", frm="3")
     .contact("/t", None).contact("/other", None), "GET /other reached the mock without an id"),
    (lambda r: r.req("1", "/r").act("1", "catch-all").contact("/r", "req:1", status=302).contact("/t", "req:1")
     .req("2", "/t", frm="1").contact("/t", None), "GET /t reached the mock without an id"),
    (lambda r: r.req("1", "/devices").act("1", "handler").act("1", "continue").contact("/devices", None),
     "GET /devices reached the mock without an id"),
    # the synthetic bound needs the same query key names
    (lambda r: r.req("3", "/s").act("3", "handler").act("3", "fulfill", status=302).req("4", "/t", frm="3", qkeys=["a"])
     .contact("/t", None, qkeys=["b"]), "GET /t reached the mock without an id"),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").contact("/devices", "req:99"), "under id req:99 the browser never recorded"),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").contact("/devices", "fetch:f7"), "under fetch fetch:f7 no route recorded"),
    (lambda r: r.req("1", "/devices").act("1", "handler").act("1", "fulfill", status=200).contact("/devices", "req:1"),
     "fulfilled in the browser AND a contact under its id"),
    (lambda r: r.req("1", "/devices", at="route").act("1", "catch-all").contact("/devices", "req:1"), "its id was first given at the route"),
    (lambda r: r.req("1", "/devices?x=1").act("1", "catch-all").contact("/devices", "req:1"), "a query in the recorded path"),
    (lambda r: r.closing(5, sw=1), "service worker(s) at its close"),
    (lambda r: r.req("1", "/devices", t=1).act("1", "catch-all").end("1").closing(9), "no named path"),
])
def test_each_finding_is_red_for_its_own_reason(tmp_path, build, why):
    res = build(Rec()).judge(tmp_path)
    assert any(why in f for f in res["findings"]), res["findings"]


def test_a_page_loaded_at_its_mock_without_its_context_in_the_record_is_red(tmp_path):
    rec = Rec()
    rec.lines = []
    rec.req("1", "/")            # a request line without its context line
    rec.lines[0]["ctx"] = "c9"
    res = rec.judge(tmp_path, loaded={KEY})
    assert any("the HTTP record has no context of the attempt" in f for f in res["findings"])


def test_no_record_at_all_is_red(tmp_path):
    res = http_paths.judge(tmp_path / "none", RUN, ATTEMPTS, NAME, BOUND, [], [], set(), [])
    assert res["findings"] == [f"no HTTP record of run {RUN} in {tmp_path / 'none'}"]


def test_an_expectation_that_ran_and_was_not_seen_is_red(tmp_path):
    rec = served(Rec(), "1", "/devices", served="handler")
    expect = [{"file": "x.spec.ts", "title": "a test",
               "expect": [{"method": "GET", "path": "/devices", "class": "replaced", "n": 1}]}]
    res = rec.judge(tmp_path, expect=expect)
    assert res["findings"] == ["x.spec.ts › a test [retry 0]: GET /devices as replaced 0 time(s), expected 1"]
    expect[0]["expect"] = [{"method": "GET", "path": "/devices", "class": "served", "status": 404, "n": 1}]
    assert "as served 404 0 time(s)" in served(Rec(), "1", "/devices").judge(tmp_path, expect=expect)["findings"][0]
    expect[0]["expect"], expect[0]["covered"] = [], 1
    assert "covered by a synthetic hop, expected 1" in served(Rec(), "1", "/devices").judge(tmp_path, expect=expect)["findings"][0]


def test_the_shipped_expectations_name_only_tests_of_the_counter_case_spec():
    spec = (Path(__file__).resolve().parents[2] / "lcnc-webui/e2e/http-paths.spec.ts").read_text()
    for x in json.loads(http_paths.EXPECT.read_text()):
        assert x["file"] == "http-paths.spec.ts" and f'test("{x["title"]}"' in spec, x["title"]
        assert all(w["class"] in http_paths.CLASSES for w in x["expect"])


# ── R393: a contact proves the agreed response path, no more (VM-I28) ──────

def test_a_fetch_over_the_fallback_stays_a_fallback_and_a_closed_contact_proves_no_answer(tmp_path):
    rec = Rec().req("1", "/g30").act("1", "handler").act("1", "fetch", op="f1").act("1", "fulfill", status=200, response=True)
    rec.contact("/g30", "fetch:f1", served="fallback").end("1")
    rec.req("2", "/devices").act("2", "handler").act("2", "fetch", op="f2").act("2", "fulfill", status=200)
    rec.contact("/devices", "fetch:f2", served=None, status=None, closed=True).end("2")
    rec.req("3", "/devices").act("3", "catch-all").contact("/devices", "req:3", served=None, status=None, closed=True)
    rec.end("3", "failed")
    res = rec.judge(tmp_path)
    assert res["findings"] == []
    assert classes(res) == {"fetch-fallback": 1, "fetch-unknown": 1, "contact-closed": 1}
    assert not set(res["classes"]) & http_paths.EVIDENCE


def test_a_redirect_chain_with_one_contact_left_stays_unknown(tmp_path):
    # a server 302; the second hop fails before it reaches the mock — one
    # contact under the chain's id is still no single direct answer (R269)
    rec = Rec().req("1", "/r").act("1", "catch-all").contact("/r", "req:1", status=302)
    rec.req("2", "/t", frm="1").end("2", "failed")
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"redirect-chain": 1, "redirect-hop": 1}


def test_no_member_of_a_redirect_chain_is_evidence_not_even_a_routed_hop(tmp_path):
    # a hop that got a route call and one contact (R269: every member of a chain)
    rec = Rec().req("1", "/r").act("1", "catch-all").contact("/r", "req:1", status=302)
    rec.req("2", "/t", frm="1").act("2", "catch-all").contact("/t", "req:2", served="handler").end("2")
    rec.req("3", "/r2").act("3", "catch-all").contact("/r2", "req:3", status=302)
    rec.req("4", "/t2", frm="3").act("4", "handler").act("4", "fetch", op="f4").act("4", "fulfill", status=200, response=True)
    rec.contact("/t2", "fetch:f4", served="handler").end("4")
    res = rec.judge(tmp_path)
    assert res["findings"] == []
    assert classes(res) == {"fetch-unknown": 1, "redirect-chain": 3}
    assert not set(res["classes"]) & http_paths.EVIDENCE


# ── R393: a rewrite is no evidence of the original route (VM-I29) ──────────

def test_a_recorded_rewrite_is_its_own_class_and_an_unrecorded_one_is_red(tmp_path):
    rec = Rec().req("1", "/g30").act("1", "handler")
    rec.act("1", "continue", to={"method": "GET", "host": HOST, "path": "/devices", "route": "GET /devices"})
    rec.contact("/devices", "req:1", served="handler").end("1")
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"rewritten": 1}
    hidden = Rec().req("1", "/g30").act("1", "handler").act("1", "continue").contact("/devices", "req:1", served="handler").end("1")
    res = hidden.judge(tmp_path)
    assert classes(res) == {"rewritten": 1}
    assert any("its contact is GET /devices with no recorded rewrite" in f for f in res["findings"])


def test_the_same_path_encoded_in_the_browser_and_decoded_at_the_mock_is_no_rewrite(tmp_path):
    rec = Rec().req("1", "/..%2f..%2fx").act("1", "catch-all").contact("/../../x", "req:1", served="403", status=403).end("1")
    res = rec.judge(tmp_path)
    assert res["findings"] == [] and classes(res) == {"served": 1}


# ── R393: the record is bound before it is judged (VM-I30) ─────────────────

@pytest.mark.parametrize("build,why,kw", [
    (lambda r: r.lines.__setitem__(0, {**r.lines[0], "project": "firefox-core"}) or r, "names project 'firefox-core'", {}),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").act("9", "fulfill", status=200).end("9"),
     "of a request the record never saw (9)", {}),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").req("1", "/g30"), "a second request line", {}),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").contact("/devices", "req:1", served="handler").end("1"),
     "no closing mark", {"close": False}),
    (lambda r: r.req("1", "/devices").act("1", "catch-all").contact("/devices", "req:1", served="handler",
                                                                      origin={**ORIGIN, "test": "t9"}).end("1"),
     "its contact carries another origin", {}),
    (lambda r: r, "a record of worker 999, which no mock of this run was bound to", {"worker": 999}),
    (lambda r: r.lines.__setitem__(0, {**r.lines[0], "run": "other-run"}) or r, "a context of run 'other-run'", {}),
])
def test_a_damaged_or_foreign_record_is_red(tmp_path, build, why, kw):
    res = build(Rec()).judge(tmp_path, **kw)
    assert any(why in f for f in res["findings"]), res["findings"]
