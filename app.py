"""Flask server for the PV string shading demo.

Run:  python app.py [--open] [--debug]   then open http://127.0.0.1:5000
      (--open launches the browser; Windows users can just double-click start.bat)
"""

from flask import Flask, jsonify, request

import pvstring

app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/info")
def info():
    return jsonify(pvstring.module_info())


@app.post("/api/simulate")
def simulate():
    body = request.get_json(silent=True) or {}
    try:
        panels = [_panel(p) for p in body.get("panels", [{}] * pvstring.N_PANELS)]
        if len(panels) != pvstring.N_PANELS:
            raise ValueError(f"expected {pvstring.N_PANELS} panels")
        result = pvstring.simulate(
            panels,
            measured=int(body.get("measured", 0)),
            bypass=bool(body.get("bypass", True)),
        )
    except (AttributeError, TypeError, ValueError) as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(result)


def _panel(p):
    pattern = p.get("pattern", "panel")
    if pattern not in pvstring.PATTERNS:
        raise ValueError(f"pattern must be one of {pvstring.PATTERNS}")
    shade = float(p.get("shade", 0.0))
    if not 0.0 <= shade <= 1.0:
        raise ValueError("shade must be between 0 and 1")
    return pvstring.PanelState(shade=shade, pattern=pattern, disconnected=bool(p.get("disconnected", False)))


if __name__ == "__main__":
    import sys
    import threading
    import webbrowser

    if "--open" in sys.argv:  # used by start.bat
        threading.Timer(1.5, webbrowser.open, ["http://127.0.0.1:5000"]).start()
    app.run(debug="--debug" in sys.argv)
