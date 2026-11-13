import numpy as np
import pytest

from pvstring import N_PANELS, PanelState, module_info, simulate

MOD = module_info()


def run(faults=None, bypass=True, measured=0):
    panels = [PanelState() for _ in range(N_PANELS)]
    for k, state in (faults or {}).items():
        panels[k] = state
    return simulate(panels, measured=measured, bypass=bypass)


def test_unshaded_string_matches_datasheet():
    r = run()
    assert r["voc"] == pytest.approx(N_PANELS * MOD["voc"], rel=0.01)
    assert r["isc"] == pytest.approx(MOD["isc"], rel=0.01)
    assert r["mpp"]["p"] == pytest.approx(N_PANELS * MOD["pmp"], rel=0.01)
    assert r["mpp"]["v_panel"] == pytest.approx(MOD["vmp"], rel=0.02)
    assert r["mpp"] == r["baseline"]["mpp"]


def test_sweep_runs_from_short_to_open_circuit():
    s = run()["sweep"]
    assert s["v_string"][0] == 0 and s["v_string"][-1] == pytest.approx(N_PANELS * MOD["voc"], rel=0.01)
    assert np.all(np.diff(s["i"]) <= 0)
    assert s["v_panel"][-1] == pytest.approx(MOD["voc"], rel=0.01)


def test_disconnected_panel_opens_string():
    r = run({5: PanelState(disconnected=True)})
    assert r["open_circuit"]
    assert set(r["sweep"]["i"]) == {0.0}
    assert r["sweep"]["v_panel"] == pytest.approx([MOD["voc"]] * len(r["sweep"]["i"]), rel=0.01)
    assert r["mpp"]["p"] == 0
    assert r["baseline"]["mpp"]["p"] > 0


def test_bypass_diodes_isolate_heavily_shaded_panel():
    r = run({4: PanelState(shade=0.8)})
    assert r["panels"][4]["bypass_active"] == 3
    assert r["panels"][4]["v"] == pytest.approx(-1.35, abs=0.2)
    assert r["mpp"]["p"] == pytest.approx(0.9 * r["baseline"]["mpp"]["p"], rel=0.01)
    # Measured panel still runs at its own MPP and its trace reaches its full Isc.
    assert r["mpp"]["v_panel"] == pytest.approx(MOD["vmp"], rel=0.02)
    assert max(r["sweep"]["i"]) == pytest.approx(MOD["isc"], rel=0.01)


def test_light_shade_on_one_panel_drags_string_current_down():
    r = run({4: PanelState(shade=0.1)})
    base = r["baseline"]["mpp"]
    assert r["panels"][4]["bypass_active"] == 0
    assert r["mpp"]["i"] < 0.97 * base["i"]
    assert r["mpp"]["v_panel"] > base["v_panel"] + 0.5


def test_one_shaded_cell_trips_one_bypass_diode():
    r = run({4: PanelState(shade=0.8, pattern="cell")})
    assert r["panels"][4]["bypass_active"] == 1
    assert r["panels"][4]["v"] == pytest.approx(2 / 3 * MOD["vmp"], rel=0.05)


def test_shading_many_panels_moves_measured_operating_point():
    r = run({k: PanelState(shade=0.5) for k in range(5, 10)})
    assert r["mpp"]["i"] == pytest.approx(0.5 * MOD["imp"], rel=0.05)
    assert r["mpp"]["p_panel"] < 0.7 * r["baseline"]["mpp"]["p_panel"]


def test_without_bypass_diodes_shaded_panel_caps_measured_current():
    r = run({4: PanelState(shade=0.5)}, bypass=False)
    assert r["isc"] < 0.55 * MOD["isc"]
    assert max(r["sweep"]["i"]) == pytest.approx(r["isc"], rel=0.01)
    assert all(p["bypass_active"] == 0 for p in r["panels"])


def test_measured_trace_lies_on_panels_own_curve():
    r = run({4: PanelState(shade=0.5), 7: PanelState(shade=0.9, pattern="substring")})
    own, s = r["panel_curve"], r["sweep"]
    order = np.argsort(own["i"])
    expected = np.interp(s["i"], np.array(own["i"])[order], np.array(own["v"])[order])
    assert np.allclose(s["v_panel"], expected, atol=0.1)


def test_measured_panel_can_be_any_panel():
    r = run({0: PanelState(shade=0.8)}, measured=3)
    assert r["measured"] == 3
    assert r["mpp"]["v_panel"] == pytest.approx(MOD["vmp"], rel=0.02)


def test_invalid_inputs_raise():
    with pytest.raises(ValueError):
        run(measured=N_PANELS)
    with pytest.raises(ValueError):
        run({1: PanelState(shade=0.5, pattern="diagonal")})
