# PV string shading demo

A browser demo of a 10-panel PV string. An IV tracer sweeps the string from short
circuit to open circuit while a sensor on one panel records that panel's voltage and
the string current. Shade or unplug any panel and watch the measured I–V trace, the
string I–V / P–V curves and the inverter's max-power operating point change live.

The backend is Python, using [pvlib](https://pvlib-python.readthedocs.io/):
CEC single-diode parameters for a real 60-cell module (Canadian Solar CS6K-275M),
evaluated per cell with Bishop's reverse-bias breakdown model; 3 bypass diodes per panel.

## Run it on Windows

1. Clone this repo, or on GitHub choose **Code → Download ZIP** and unzip it.
2. Double-click **`start.bat`**.

The first run downloads [uv](https://docs.astral.sh/uv/) into a `.tools` folder. uv then
installs Python 3.14 (only if 3.14 isn't installed already) and the pinned packages:
about 100 MB, a minute or two. Later runs skip the downloads. Your browser opens the demo
by itself; close the black window to stop it. Everything stays inside the folder, so
deleting the folder removes it all.

If Windows warns that the file came from the internet, choose **Run** (or
**More info → Run anyway**). The page loads Chart.js from cdnjs, so it needs internet.

## Run it on macOS / Linux

[Install uv](https://docs.astral.sh/uv/getting-started/installation/), then in the folder:

```bash
uv run app.py --open
```

Without uv: `pip install pvlib flask`, then `python app.py --open`.

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

## The time series

The tracer ramps the string voltage at a constant rate (a fault-free sweep takes 1.4 s),
and the bottom card plots the sensor's V and I against time. Bypass diodes hide a
shaded panel from the measured panel's V–I curve, but not from the time series:

- **Bypassed panels:** while the string is near short circuit, the measured panel shares
  the ramp with every panel that isn't bypassed. So its voltage climbs at
  ramp ÷ (active panels): 1/10 normally, 1/9 with one panel bypassed, 1/5 with half bypassed.
- **Shaded but still producing:** a plateau. Current stalls at the shaded panel's level
  and the measured panel's voltage stays flat while the shaded panel's voltage builds.
- **No bypass diodes:** the measured panel sits near Voc at low current for the whole sweep.
- **Unplugged:** flat lines, Voc and 0 A.

## Test

```bash
uv run pytest
```
