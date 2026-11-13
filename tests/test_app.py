import pytest

from app import app
from pvstring import N_PANELS


@pytest.fixture
def client():
    return app.test_client()


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"<html" in r.data.lower()


def test_info(client):
    r = client.get("/api/info").get_json()
    assert r["n_panels"] == N_PANELS and r["cells"] == 60


def test_simulate_defaults(client):
    r = client.post("/api/simulate", json={})
    assert r.status_code == 200
    data = r.get_json()
    assert {"sweep", "panel_curve", "mpp", "panels", "baseline", "open_circuit"} <= data.keys()
    assert len(data["panels"]) == N_PANELS


def test_simulate_with_faults(client):
    panels = [{} for _ in range(N_PANELS)]
    panels[4] = {"shade": 0.6, "pattern": "substring"}
    panels[7] = {"disconnected": True}
    data = client.post("/api/simulate", json={"panels": panels, "measured": 2, "bypass": False}).get_json()
    assert data["open_circuit"] and data["measured"] == 2 and data["bypass"] is False


@pytest.mark.parametrize("body", [
    {"panels": [{}] * 3},
    {"panels": [{"shade": 1.5}] * N_PANELS},
    {"panels": [{"pattern": "zigzag"}] * N_PANELS},
    {"measured": 42},
])
def test_simulate_rejects_bad_input(client, body):
    assert client.post("/api/simulate", json=body).status_code == 400
