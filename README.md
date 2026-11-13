# PV string shading demo

A browser demo of a 10-panel PV string. An IV tracer sweeps the string from short
circuit to open circuit while a sensor on one panel records that panel's voltage and
the string current. Shade or unplug any panel and watch the measured I–V trace, the
string I–V / P–V curves and the inverter's max-power operating point change live.

The backend is Python, using [pvlib](https://pvlib-python.readthedocs.io/):
CEC single-diode parameters for a real 60-cell module (Canadian Solar CS6K-275M),
evaluated per cell with Bishop's reverse-bias breakdown model; 3 bypass diodes per panel.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python app.py
```

Open http://127.0.0.1:5000. The page loads Chart.js from cdnjs, so it needs internet.

## Use

- Click a panel to edit it: shade 0–100 %, covering the whole panel, one substring
  (20 cells) or one cell; or unplug it.
- **Sensor on panel** picks which panel is measured. **Bypass diodes fitted** turns the
  diodes off to show why they matter.
- **Scenarios** are one-click setups for a demo.
- **Export sweep CSV** saves the latest sweep.

## What to expect

| Fault | Measured panel | String |
|---|---|---|
| None | Full curve, Isc → Voc | 383 V, 9.31 A, 2.75 kW |
| Light shade (~10 %) on one panel | Operating point moves up the curve: the whole string's current drops to what the shaded panel can carry | Small loss |
| Heavy shade on one panel | Unchanged: the shaded panel's bypass diodes carry the current | Step in I–V, −10 % |
| One shaded cell | Unchanged | 1 bypass diode on, −1/3 of a panel |
| Half the string shaded | Operating point drops to ~half current, panel near Voc | Two peaks in P–V |
| Panel unplugged | Collapses to one point: Voc, 0 A | No current |
| Shade, bypass diodes off | Trace stops at the shaded panel's current | Current capped |

## Test

```bash
.venv/Scripts/python -m pytest
```
