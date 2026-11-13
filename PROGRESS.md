# PROGRESS

Compact context for future sessions.

## Goal
Browser demo: 10-panel PV string, I & V measured on one panel; shade/unplug other
panels and see the measured IV curve change. Python backend using a public PV library.

## State (2026-11-13): working, tested, committed
- `pvstring.py` – model. pvlib `calcparams_cec` (module `Canadian_Solar_Inc__CS6K_275M`,
  60 cells) → per-cell params → `singlediode.bishop88` over a diode-voltage grid incl.
  reverse breakdown → V(I) on a common current grid. Substring = sum of cell V; bypass
  diode = `max(V_sub, -nVt·ln(1+I/Is))`; panel = 3 substrings; string = sum of panels.
  Any `disconnected` panel → open circuit (I=0, every panel at Voc).
  `simulate()` returns sweep (uniform in string V, 150 pts), measured panel's own
  curve, MPP (+ per-panel V and bypass count at MPP), and a fault-free `baseline`.
- `app.py` – Flask: `/` static page, `GET /api/info`, `POST /api/simulate`
  (`{panels:[{shade,pattern,disconnected}]*10, measured, bypass}`), 400 on bad input.
- `static/` – vanilla JS + Chart.js 4.4.1 (cdnjs). Clickable string diagram, panel
  editor, presets, animated sweep loop (1.4 s sweep + 1.3 s hold at MPP), live sensor
  readout, narrative text, CSV export, light/dark via CSS vars.
- Time series: sweep is a constant string-voltage ramp (`RAMP_RATE` = 383 V / `SWEEP_SECONDS`
  1.4 s), so `sweep.t = v_string / RAMP_RATE` (open circuit: t uniform over 1.4 s). UI card
  "Sensor on panel N during the sweep" = stacked V(t) and I(t) charts; the animation replays
  the sweep in real time using `t`. Signatures: early dV/dt = ramp ÷ active panels;
  current/voltage plateau while a producing shaded panel's voltage builds.
- Tests: `pytest` (24) – physics sanity (datasheet match, bypass, open circuit, no-bypass
  cap, operating-point shift, time-series slope/plateau) + API.
- Run: `.venv/Scripts/python app.py` (also `.claude/launch.json` "shading-demo", port 5000).

## Decisions / gotchas
- Breakdown voltage −15 V (not pvlib example's −5.5 V): with −5.5 V a single shaded cell
  breaks down before its bypass diode can turn on (needs ~−10.4 V).
- Irradiance floored at 1 W/m² (CEC Rsh ∝ 1/G is infinite at 0).
- Physics note: with bypass diodes, shading *another* panel never changes the measured
  panel's own curve locus; what changes is the string current/operating point. Only
  unplugging (open) or no-bypass truncates the measured trace. UI narrative explains this.
- Bypass-diode lights on tiles assume shaded substrings are the first ones (true for all patterns).

## Ideas not done
- Inverter MPPT getting stuck on a local P–V peak; irradiance/temperature controls; measurement noise.
