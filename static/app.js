"use strict";

const N = 10;
const CELLS = 60;
const SHADED_CELL = 18; // row 4, column 1: inside substring 1
const SWEEP_MS = 1400; // one tracer sweep, short circuit -> open circuit
const HOLD_MS = 1300; // then the inverter sits at max power before the next sweep

const state = {
  panels: Array.from({ length: N }, () => ({ shade: 0, pattern: "panel", disconnected: false })),
  measured: 0,
  bypass: true,
  selected: 4,
};

const PRESETS = [
  ["All clear", {}],
  ["Light shade, 1 panel", { 4: { shade: 0.1 } }],
  ["Heavy shade, 1 panel", { 4: { shade: 0.7 } }],
  ["Leaf on one cell", { 4: { shade: 0.9, pattern: "cell" } }],
  ["Half the string shaded", Object.fromEntries([5, 6, 7, 8, 9].map(k => [k, { shade: 0.5 }]))],
  ["Unplug a panel", { 5: { disconnected: true } }],
];

const $ = sel => document.querySelector(sel);
const fmtV = v => `${v.toFixed(1)} V`;
const fmtA = a => `${a.toFixed(2)} A`;
const fmtW = w => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${w.toFixed(0)} W`);

let data = null;
let sweepStart = performance.now();
let shownK = -1;
let paused = false;

/* ------------------------------------------------------------------ string diagram */

const tiles = [];
const wires = [];

function buildString() {
  const row = $("#string-row");
  const plus = row.lastElementChild;
  const addWire = () => {
    const w = document.createElement("div");
    w.className = "wire";
    row.insertBefore(w, plus);
    wires.push(w);
  };
  addWire();
  for (let k = 0; k < N; k++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "panel";
    b.innerHTML = `
      <div class="panel-top"><span>P${k + 1}</span><span class="meter" hidden>V·A</span></div>
      <div class="cells">${"<i></i>".repeat(CELLS)}</div>
      <div class="diodes" aria-hidden="true"><b></b><b></b><b></b></div>
      <div class="panel-v">–</div>
      <div class="panel-status"></div>`;
    b.addEventListener("click", () => select(k));
    row.insertBefore(b, plus);
    tiles.push(b);
    addWire();
  }
}

function isShadedCell(p, j) {
  if (p.shade <= 0) return false;
  if (p.pattern === "panel") return true;
  if (p.pattern === "substring") return j % 6 < 2;
  return j === SHADED_CELL;
}

function drawShading() {
  state.panels.forEach((p, k) => {
    const tile = tiles[k];
    tile.querySelectorAll(".cells i").forEach((cell, j) => {
      const on = isShadedCell(p, j);
      cell.classList.toggle("shaded", on);
      cell.style.setProperty("--shade", on ? (0.82 * p.shade).toFixed(3) : "0");
    });
    tile.classList.toggle("off", p.disconnected);
    tile.classList.toggle("selected", k === state.selected);
    tile.querySelector(".meter").hidden = k !== state.measured;
    wires[k + 1].classList.toggle("broken", p.disconnected);
  });
}

function drawPanelStates() {
  if (!data) return;
  data.panels.forEach((ps, k) => {
    const p = state.panels[k];
    const tile = tiles[k];
    tile.querySelector(".panel-v").textContent = fmtV(ps.v);
    tile.querySelectorAll(".diodes b").forEach((d, j) => d.classList.toggle("on", j < ps.bypass_active));
    const status = tile.querySelector(".panel-status");
    status.className = "panel-status";
    if (p.disconnected) {
      status.textContent = "unplugged";
      status.classList.add("crit");
    } else if (ps.bypass_active) {
      status.textContent = `${ps.bypass_active} bypass on`;
      status.classList.add("warn");
    } else {
      status.textContent = p.shade > 0 ? `shaded ${Math.round(p.shade * 100)}%` : "";
    }
    tile.title = `Panel ${k + 1}: ${fmtV(ps.v)} at the operating point` +
      (ps.bypass_active ? `, ${ps.bypass_active} bypass diode(s) conducting` : "");
  });
}

/* ------------------------------------------------------------------ controls */

function select(k) {
  state.selected = k;
  const p = state.panels[k];
  $("#editor-title").textContent = `Panel ${k + 1}` + (k === state.measured ? " (has the sensor)" : "");
  $("#shade").value = Math.round(p.shade * 100);
  $("#shade-out").textContent = `${Math.round(p.shade * 100)}%`;
  $("#disconnected").checked = p.disconnected;
  document.querySelectorAll("#pattern button").forEach(b =>
    b.setAttribute("aria-checked", String(b.dataset.pattern === p.pattern)));
  drawShading();
}

function changed() {
  drawShading();
  requestSim();
}

function bindControls() {
  const sel = $("#measured");
  for (let k = 0; k < N; k++) sel.add(new Option(`Panel ${k + 1}`, k));
  sel.addEventListener("change", () => {
    state.measured = Number(sel.value);
    select(state.selected);
    changed();
  });
  $("#bypass").addEventListener("change", e => { state.bypass = e.target.checked; changed(); });
  $("#shade").addEventListener("input", e => {
    state.panels[state.selected].shade = e.target.value / 100;
    $("#shade-out").textContent = `${e.target.value}%`;
    changed();
  });
  document.querySelectorAll("#pattern button").forEach(b => b.addEventListener("click", () => {
    state.panels[state.selected].pattern = b.dataset.pattern;
    select(state.selected);
    changed();
  }));
  $("#disconnected").addEventListener("change", e => {
    state.panels[state.selected].disconnected = e.target.checked;
    changed();
  });
  $("#panel-reset").addEventListener("click", () => {
    state.panels[state.selected] = { shade: 0, pattern: "panel", disconnected: false };
    select(state.selected);
    changed();
  });

  const presets = $("#presets");
  for (const [name, faults] of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.addEventListener("click", () => {
      state.panels = state.panels.map((_, k) => ({ shade: 0, pattern: "panel", disconnected: false, ...faults[k] }));
      const first = Object.keys(faults)[0];
      select(first === undefined ? state.selected : Number(first));
      changed();
    });
    presets.append(b);
  }

  $("#pause").addEventListener("click", e => {
    paused = !paused;
    e.target.textContent = paused ? "Resume sweep" : "Pause sweep";
    if (!paused) restartSweep();
  });
  $("#csv").addEventListener("click", exportCsv);
}

/* ------------------------------------------------------------------ backend */

let inflight = false;
let dirty = false;

function requestSim() {
  dirty = true;
  if (!inflight) pump();
}

async function pump() {
  inflight = true;
  while (dirty) {
    dirty = false;
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panels: state.panels, measured: state.measured, bypass: state.bypass }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (!dirty) apply(json);
    } catch (err) {
      $("#story").textContent = `Simulation failed: ${err.message}`;
    }
  }
  inflight = false;
}

function apply(d) {
  data = d;
  drawPanelStates();
  drawStatic();
  $("#story").textContent = explain(d);
  restartSweep();
}

/* ------------------------------------------------------------------ charts */

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const charts = {};

function makeChart(id, xUnit, yUnit, yName) {
  const tooltipLabel = ctx => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)} ${xUnit}, ` +
    `${ctx.parsed.y.toFixed(yUnit === "A" ? 2 : 0)} ${yUnit}`;
  return new Chart(document.getElementById(id), {
    type: "scatter",
    data: {
      datasets: [
        { label: "No faults", data: [], showLine: true, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHitRadius: 4, order: 4 },
        { label: "Measured", data: [], showLine: true, borderWidth: 2, pointRadius: 1.6, pointHitRadius: 6, order: 3 },
        { label: "Sweep now", data: [], pointRadius: 5, borderWidth: 2, order: 2 },
        { label: "Operating point (no faults)", data: [], pointRadius: 6, borderWidth: 2, order: 1 },
        { label: "Operating point", data: [], pointRadius: 7, borderWidth: 2, pointHitRadius: 10, order: 0 },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: { type: "linear", title: { display: true, text: `Voltage (${xUnit})` }, ticks: { includeBounds: false } },
        y: { type: "linear", title: { display: true, text: `${yName} (${yUnit})` }, ticks: { includeBounds: false } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: tooltipLabel } } },
    },
  });
}

function applyTheme() {
  const c = {
    text: css("--text-2"), grid: css("--grid"), live: css("--live"), op: css("--op"),
    muted: css("--muted"), surface: css("--surface"),
  };
  Chart.defaults.color = c.text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  for (const ch of Object.values(charts)) {
    const [base, live, cursor, opBase, op] = ch.data.datasets;
    base.borderColor = c.muted;
    live.borderColor = live.backgroundColor = c.live;
    cursor.backgroundColor = c.live;
    cursor.borderColor = c.surface;
    opBase.backgroundColor = "transparent";
    opBase.borderColor = c.muted;
    op.backgroundColor = c.op;
    op.borderColor = c.surface;
    for (const ax of Object.values(ch.options.scales)) {
      ax.grid = { color: c.grid };
      ax.border = { color: c.grid };
      ax.ticks.color = c.text;
      ax.title.color = c.text;
    }
    ch.update("none");
  }
}

function niceMax(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v)) / 5;
  return Math.ceil(v / step) * step;
}

const pts = (xs, ys) => xs.map((x, j) => ({ x, y: ys[j] }));
const power = s => s.v_string.map((v, j) => v * s.i[j]);

function drawStatic() {
  const d = data, b = d.baseline;

  // Measured panel: own reference curve, operating points, axis range covering everything.
  const pc = charts.panel;
  pc.data.datasets[0].data = pts(b.panel_curve.v, b.panel_curve.i);
  pc.data.datasets[3].data = [{ x: b.mpp.v_panel, y: b.mpp.i }];
  pc.data.datasets[4].data = [{ x: d.mpp.v_panel, y: d.mpp.i }];
  const xs = [...b.panel_curve.v, ...d.sweep.v_panel, ...d.panel_curve.v];
  const ys = [...b.panel_curve.i, ...d.sweep.i];
  const xmin = Math.min(...xs);
  pc.options.scales.x.min = xmin < -0.5 ? -niceMax(-xmin * 1.05) : 0;
  pc.options.scales.x.max = niceMax(Math.max(...xs) * 1.05);
  pc.options.scales.y.min = 0;
  pc.options.scales.y.max = niceMax(Math.max(...ys) * 1.1);

  const vmax = niceMax(Math.max(b.voc, d.voc) * 1.04);
  const iv = charts.iv;
  iv.data.datasets[0].data = pts(b.sweep.v_string, b.sweep.i);
  iv.data.datasets[3].data = [{ x: b.mpp.v_string, y: b.mpp.i }];
  iv.data.datasets[4].data = d.open_circuit ? [] : [{ x: d.mpp.v_string, y: d.mpp.i }];
  Object.assign(iv.options.scales.x, { min: 0, max: vmax });
  Object.assign(iv.options.scales.y, { min: 0, max: niceMax(Math.max(b.isc, d.isc) * 1.1) });

  const pv = charts.pv;
  pv.data.datasets[0].data = pts(b.sweep.v_string, power(b.sweep));
  pv.data.datasets[3].data = [{ x: b.mpp.v_string, y: b.mpp.p }];
  pv.data.datasets[4].data = d.open_circuit ? [] : [{ x: d.mpp.v_string, y: d.mpp.p }];
  Object.assign(pv.options.scales.x, { min: 0, max: vmax });
  Object.assign(pv.options.scales.y, { min: 0, max: niceMax(b.mpp.p * 1.1) });

  $("#iv-overlay").classList.toggle("show", d.open_circuit);
  $("#pv-overlay").classList.toggle("show", d.open_circuit);

  // Readouts at the operating point, compared with the fault-free string.
  const m = d.mpp, bm = b.mpp;
  const delta = (now, ref, f) => (Math.abs(now - ref) < 1e-3 ? "same as no faults" : `no faults: ${f(ref)}`);
  $("#panel-chart-title").textContent = `Measured panel I–V (panel ${d.measured + 1})`;
  $("#r-pv").textContent = fmtV(m.v_panel);
  $("#r-pi").textContent = fmtA(m.i);
  $("#r-pp").textContent = fmtW(m.p_panel);
  $("#r-pv-d").textContent = delta(m.v_panel, bm.v_panel, fmtV);
  $("#r-pi-d").textContent = delta(m.i, bm.i, fmtA);
  $("#r-pp-d").textContent = delta(m.p_panel, bm.p_panel, fmtW);
  const pct = bm.p ? Math.round((100 * m.p) / bm.p) : 0;
  $("#r-sp").textContent = `at max power: ${fmtW(m.p)} (${pct}% of ${fmtW(bm.p)} with no faults)`;
  $("#sensor-label").textContent = `Sensor on panel ${d.measured + 1}`;
}

function restartSweep() {
  sweepStart = performance.now();
  shownK = -1;
}

function drawTrace(k) {
  const s = data.sweep;
  const n = s.i.length;
  const sweeping = k < n;
  const j = k - 1;

  charts.panel.data.datasets[1].data = pts(s.v_panel.slice(0, k), s.i.slice(0, k));
  charts.panel.data.datasets[2].data = sweeping ? [{ x: s.v_panel[j], y: s.i[j] }] : [];
  const open = data.open_circuit;
  charts.iv.data.datasets[1].data = open ? [] : pts(s.v_string.slice(0, k), s.i.slice(0, k));
  charts.iv.data.datasets[2].data = sweeping && !open ? [{ x: s.v_string[j], y: s.i[j] }] : [];
  const p = power(s);
  charts.pv.data.datasets[1].data = open ? [] : pts(s.v_string.slice(0, k), p.slice(0, k));
  charts.pv.data.datasets[2].data = sweeping && !open ? [{ x: s.v_string[j], y: p[j] }] : [];
  for (const ch of Object.values(charts)) ch.update("none");

  // The sensor reads the sweep while it runs, then the inverter's operating point.
  const [v, i] = sweeping ? [s.v_panel[j], s.i[j]] : [data.mpp.v_panel, data.mpp.i];
  $("#sensor-v").textContent = fmtV(v);
  $("#sensor-i").textContent = fmtA(i);
  $("#sensor-mode").textContent = open ? "String open: no current"
    : sweeping ? "IV sweep in progress…" : "Inverter at max power point";
}

function frame(now) {
  if (data) {
    const n = data.sweep.i.length;
    let k = n;
    if (!paused) {
      const t = now - sweepStart;
      if (t >= SWEEP_MS + HOLD_MS) sweepStart = now;
      k = t < SWEEP_MS ? Math.max(1, Math.ceil((n * t) / SWEEP_MS)) : n;
      if (t >= SWEEP_MS + HOLD_MS) k = 1;
    }
    if (k !== shownK) {
      shownK = k;
      drawTrace(k);
    }
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ narrative */

function explain(d) {
  const m = d.measured;
  const name = k => `panel ${k + 1}`;
  const list = ks => ks.map(name).join(", ").replace(/, ([^,]*)$/, " and $1");
  const unplugged = state.panels.flatMap((p, k) => (p.disconnected ? [k] : []));
  const faulty = state.panels.flatMap((p, k) => (p.shade > 0 || p.disconnected ? [k] : []));
  const b = d.baseline;

  if (d.open_circuit) {
    return `${list(unplugged).replace(/^p/, "P")} ${unplugged.length > 1 ? "are" : "is"} unplugged, so the string is an open circuit and no current flows anywhere. ` +
      `The sensor on ${name(m)} reads its open-circuit voltage (${fmtV(d.mpp.v_panel)}) at 0 A: the I–V trace collapses to a single point.`;
  }
  if (!faulty.length) {
    return `No faults: every panel carries the same current, so the sensor on ${name(m)} traces its full curve from ` +
      `short circuit (${fmtA(d.isc)}) to open circuit (${fmtV(d.sweep.v_panel.at(-1))}). Shade or unplug a panel to see what changes.`;
  }

  const parts = [];
  const bypassed = d.panels.flatMap((p, k) => (p.bypass_active ? [`${name(k)} (${p.bypass_active} of 3)`] : []));
  if (bypassed.length) {
    parts.push(`Bypass diodes are conducting on ${bypassed.join(", ")}: the bypassed substrings are skipped so the rest of the string keeps its current.`);
  }
  if (!d.bypass && d.isc < 0.97 * b.isc) {
    parts.push(`With no bypass diodes the shaded panel caps the string current at ${fmtA(d.isc)}, so the sensor's trace stops short of ${name(m)}'s own short-circuit current (${fmtA(b.isc)}).`);
  }
  const measuredShaded = state.panels[m].shade > 0;
  if (measuredShaded) {
    parts.push(`${name(m).replace(/^p/, "P")} is shaded itself, so its own curve changes.`);
  } else if (d.mpp.i < 0.97 * b.mpp.i) {
    parts.push(`Max power is now at ${fmtA(d.mpp.i)} instead of ${fmtA(b.mpp.i)}, so ${name(m)} is pushed up its curve to ${fmtV(d.mpp.v_panel)} ` +
      `and makes ${fmtW(d.mpp.p_panel)} instead of ${fmtW(b.mpp.p_panel)}, although it is not shaded.`);
  } else {
    parts.push(`${name(m).replace(/^p/, "P")} still runs at full current at its own max power point, so its measured curve and operating point are unchanged; the loss shows only in the string curves.`);
  }
  const pct = Math.round((100 * d.mpp.p) / b.mpp.p);
  return `${parts.join(" ")} String power ${fmtW(d.mpp.p)}, ${pct}% of normal.`;
}

/* ------------------------------------------------------------------ CSV */

function exportCsv() {
  if (!data) return;
  const s = data.sweep;
  const rows = ["string_voltage_V,current_A,measured_panel_voltage_V,measured_panel_power_W"];
  s.i.forEach((i, j) => rows.push([s.v_string[j], i, s.v_panel[j], (s.v_panel[j] * i).toFixed(3)].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = `iv_sweep_panel${data.measured + 1}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ init */

async function init() {
  buildString();
  bindControls();
  charts.panel = makeChart("panel-chart", "V", "A", "Current");
  charts.iv = makeChart("string-iv", "V", "A", "Current");
  charts.pv = makeChart("string-pv", "V", "W", "Power");
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  select(state.selected);
  requestSim();
  requestAnimationFrame(frame);
  try {
    const info = await (await fetch("/api/info")).json();
    $("#module-name").textContent = `${info.n_panels} × ${info.name} (${info.pmp.toFixed(0)} W, ${info.cells} cells, ${info.substrings} bypass diodes)`;
  } catch { /* footer detail only */ }
}

init();
