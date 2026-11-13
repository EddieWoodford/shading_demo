"""Simulate a series string of PV panels with shading, bypass diodes and open circuits.

Physics comes from pvlib:
  * ``pvsystem.calcparams_cec`` gives single-diode parameters for a real module
    (CEC database) at the chosen irradiance and cell temperature.
  * ``singlediode.bishop88`` evaluates the single-diode equation per *cell*,
    including Bishop's reverse-bias breakdown term, so a shaded cell that is
    forced to carry more current than it generates goes into reverse bias.

Series connections are built the usual way for mismatch studies: on a common
current grid, voltages of series elements add.

Each panel is 60 cells = 3 substrings of 20 cells, each substring with a
bypass diode across it. A panel that is "disconnected" (connector unplugged)
opens the string, so no current flows anywhere.
"""

from dataclasses import dataclass

import numpy as np
from pvlib import pvsystem, singlediode

MODULE_NAME = "Canadian_Solar_Inc__CS6K_275M"
N_PANELS = 10
SUBSTRINGS = 3
CELLS_PER_SUBSTRING = 20
CELLS = SUBSTRINGS * CELLS_PER_SUBSTRING

PATTERNS = ("panel", "substring", "cell")

# Reverse-bias (Bishop) parameters. pvlib's examples use -5.5 V breakdown (1980s cells);
# modern mono c-Si breaks down around -10..-20 V, which is what lets one shaded cell
# turn on its substring's bypass diode (needs ~ -10.4 V across the cell).
BREAKDOWN = dict(breakdown_factor=2e-3, breakdown_voltage=-15.0, breakdown_exp=3.28)

# Schottky bypass diode: ~0.45 V forward drop at 9 A.
BYPASS_IS = 4e-6
BYPASS_NVT = 1.2 * 0.02569

# Fully dark cells make the CEC shunt resistance infinite; keep a trickle of light.
MIN_IRRADIANCE = 1.0

N_GRID = 2000
N_SWEEP = 150

_module = pvsystem.retrieve_sam("CECMod")[MODULE_NAME]
assert int(_module["N_s"]) == CELLS


@dataclass
class PanelState:
    shade: float = 0.0  # fraction of light blocked on the shaded cells, 0..1
    pattern: str = "panel"  # which cells the shade covers, one of PATTERNS
    disconnected: bool = False  # connector unplugged -> string is open


def module_info():
    m = _module
    return {
        "name": MODULE_NAME.replace("_", " ").replace("  ", " "),
        "pmp": float(m["STC"]),
        "voc": float(m["V_oc_ref"]),
        "isc": float(m["I_sc_ref"]),
        "vmp": float(m["V_mp_ref"]),
        "imp": float(m["I_mp_ref"]),
        "cells": CELLS,
        "substrings": SUBSTRINGS,
        "n_panels": N_PANELS,
    }


def cell_params(irradiance, temp_cell):
    """Single-diode parameters for ONE cell: (IL, I0, Rs, Rsh, nVth)."""
    m = _module
    il, i0, rs, rsh, nnsvth = pvsystem.calcparams_cec(
        max(irradiance, MIN_IRRADIANCE), temp_cell,
        m["alpha_sc"], m["a_ref"], m["I_L_ref"], m["I_o_ref"],
        m["R_sh_ref"], m["R_s"], m["Adjust"],
    )
    return float(il), float(i0), float(rs) / CELLS, float(rsh) / CELLS, float(nnsvth) / CELLS


def cell_v_of_i(irradiance, temp_cell, igrid):
    """Cell voltage at each current in ``igrid`` (reverse bias included)."""
    il, i0, rs, rsh, nvth = cell_params(irradiance, temp_cell)
    voc = float(singlediode.estimate_voc(il, i0, nvth))
    vbr = BREAKDOWN["breakdown_voltage"]
    vd = np.concatenate([
        vbr * (1.0 - np.logspace(-6, 0, 500)),  # approach breakdown: current grows without bound
        np.linspace(0.0, 1.3 * voc + 0.05, 500)[1:],  # forward bias, past Voc so I < 0
    ])
    i, v = singlediode.bishop88(vd, il, i0, rs, rsh, nvth, **BREAKDOWN)[:2]
    # I falls as diode voltage rises; np.interp wants increasing x.
    return np.interp(igrid, i[::-1], v[::-1])


def bypass_v_of_i(igrid):
    """Voltage across a conducting bypass diode (negative w.r.t. the substring)."""
    return -BYPASS_NVT * np.log1p(igrid / BYPASS_IS)


def substring_layout(state):
    """List, per substring, of (n_cells, light_fraction) groups."""
    lit = 1.0 - float(np.clip(state.shade, 0.0, 1.0))
    full = [(CELLS_PER_SUBSTRING, 1.0)]
    if state.shade <= 0:
        return [full] * SUBSTRINGS
    if state.pattern == "panel":
        return [[(CELLS_PER_SUBSTRING, lit)]] * SUBSTRINGS
    if state.pattern == "substring":
        return [[(CELLS_PER_SUBSTRING, lit)]] + [full] * (SUBSTRINGS - 1)
    if state.pattern == "cell":
        return [[(1, lit), (CELLS_PER_SUBSTRING - 1, 1.0)]] + [full] * (SUBSTRINGS - 1)
    raise ValueError(f"unknown shading pattern {state.pattern!r}")


class _Curves:
    """Per-request cache of cell curves keyed by light fraction."""

    def __init__(self, irradiance, temp_cell, igrid):
        self.irradiance, self.temp_cell, self.igrid = irradiance, temp_cell, igrid
        self._cache = {}

    def cell(self, light):
        key = round(light, 6)
        if key not in self._cache:
            self._cache[key] = cell_v_of_i(self.irradiance * light, self.temp_cell, self.igrid)
        return self._cache[key]


def panel_v_of_i(state, curves, bypass):
    """Return (panel V(I), list of raw substring V(I) before the bypass diode)."""
    raw = [sum(n * curves.cell(light) for n, light in groups) for groups in substring_layout(state)]
    if bypass:
        vbp = bypass_v_of_i(curves.igrid)
        clamped = [np.maximum(v, vbp) for v in raw]
    else:
        clamped = raw
    return sum(clamped), raw


def _sweep_string(panels, measured, bypass, irradiance, temp_cell, n_sweep):
    lights = [l for p in panels for groups in substring_layout(p) for _, l in groups]
    il_max = max(cell_params(irradiance * l, temp_cell)[0] for l in lights)
    igrid = np.linspace(0.0, 1.02 * il_max, N_GRID)
    curves = _Curves(irradiance, temp_cell, igrid)

    panel_v, panel_raw = zip(*(panel_v_of_i(p, curves, bypass) for p in panels))
    vmeas = panel_v[measured]

    # The measured panel's own curve, as if it were measured on its own.
    isc_meas = float(np.interp(0.0, vmeas[::-1], igrid[::-1]))
    keep = vmeas >= 0
    own = {"v": np.append(vmeas[keep], 0.0), "i": np.append(igrid[keep], isc_meas)}

    vbp = bypass_v_of_i(igrid)

    def panel_states(i):
        return [
            {
                "v": float(np.interp(i, igrid, panel_v[k])),
                "bypass_active": int(bypass and sum(
                    np.interp(i, igrid, raw) < np.interp(i, igrid, vbp) for raw in panel_raw[k]
                )),
            }
            for k in range(len(panels))
        ]

    if any(p.disconnected for p in panels):
        # Open string: zero current, every panel sits at its own open-circuit voltage.
        voc_meas = float(vmeas[0])
        zeros = np.zeros(n_sweep)
        return {
            "open_circuit": True,
            "sweep": {"v_string": zeros, "i": zeros, "v_panel": np.full(n_sweep, voc_meas)},
            "panel_curve": own,
            "mpp": {"v_string": 0.0, "i": 0.0, "p": 0.0, "v_panel": voc_meas, "p_panel": 0.0},
            "panels": panel_states(0.0),
            "voc": 0.0,
            "isc": 0.0,
        }

    vstring = sum(panel_v)  # strictly decreasing in I
    voc = float(vstring[0])
    isc = float(np.interp(0.0, vstring[::-1], igrid[::-1]))

    # IV tracer: sweep string voltage from short circuit to open circuit.
    vs = np.linspace(0.0, voc, n_sweep)
    i_sw = np.interp(vs, vstring[::-1], igrid[::-1])
    vm_sw = np.interp(i_sw, igrid, vmeas)

    p = np.where(vstring >= 0, igrid * vstring, -np.inf)
    k = int(np.argmax(p))
    i_mpp, v_mpp = float(igrid[k]), float(vstring[k])
    vm_mpp = float(vmeas[k])
    return {
        "open_circuit": False,
        "sweep": {"v_string": vs, "i": i_sw, "v_panel": vm_sw},
        "panel_curve": own,
        "mpp": {"v_string": v_mpp, "i": i_mpp, "p": i_mpp * v_mpp, "v_panel": vm_mpp, "p_panel": i_mpp * vm_mpp},
        "panels": panel_states(i_mpp),
        "voc": voc,
        "isc": isc,
    }


def simulate(panels=None, measured=0, bypass=True, irradiance=1000.0, temp_cell=25.0, n_sweep=N_SWEEP):
    """Simulate the string; also returns a fault-free baseline for comparison."""
    panels = list(panels) if panels is not None else [PanelState() for _ in range(N_PANELS)]
    if not 0 <= measured < len(panels):
        raise ValueError("measured panel index out of range")
    result = _sweep_string(panels, measured, bypass, irradiance, temp_cell, n_sweep)
    base = _sweep_string([PanelState() for _ in panels], measured, bypass, irradiance, temp_cell, n_sweep)
    result["baseline"] = {k: base[k] for k in ("sweep", "panel_curve", "mpp", "voc", "isc")}
    result["measured"] = measured
    result["bypass"] = bypass
    return _jsonable(result)


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [round(float(x), 4) for x in obj]
    if isinstance(obj, (float, np.floating)):
        return round(float(obj), 4)
    return obj
