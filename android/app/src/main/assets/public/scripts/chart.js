// scripts/chart.js
// -----------------------------------------------------------------------------
// Replaces the old bar chart with an animated line/area chart, matching the
// look of the Dormate reference (smooth line, soft gradient fill underneath,
// draws itself in on load).
//
// WHY hand-rolled SVG instead of a charting library (Chart.js, Recharts)?
// Dormate is a React app, so it reaches for a React charting library
// (Recharts) for free. Hive is plain HTML/CSS/JS — pulling in a whole
// charting library for one chart would mean an extra script tag, a version
// to keep track of, and a black box you'd have to trust rather than read.
// A hand-rolled SVG line is maybe 60 lines of very readable code and it's a
// genuinely useful thing to understand: SVG coordinates, how to map data
// values to pixel positions ("scaling"), and how to animate a path drawing
// itself using stroke-dasharray. If your data needs get a lot more complex
// later (zooming, tooltips, multiple chart types), *that's* the point where
// reaching for Chart.js starts to pay for itself — the README talks about
// this trade-off more.
//
// THE ANIMATION TRICK:
// Every <path> gets pathLength="100" — this tells the browser "pretend this
// path is exactly 100 units long," regardless of its real pixel length. That
// lets us always animate stroke-dasharray/stroke-dashoffset from 100 to 0
// with one fixed CSS rule, instead of measuring the actual path length in
// JavaScript. The area fill fades in right after, so it reads as "line draws
// itself, then the shading settles in underneath."
// -----------------------------------------------------------------------------

let chartInstanceCounter = 0;

/**
 * @param {HTMLElement} container element to render the chart into
 * @param {Array<{month:string, electric:number, water:number}>} data
 * @param {{height?: number}} opts
 */
function renderLineChart(container, data, opts = {}) {
  if (!container) return;
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="chart-empty">No bill history yet.</p>`;
    return;
  }

  const id = `chart-${++chartInstanceCounter}`;
  const width = 600;
  const height = opts.height || 200;
  const padTop = 16;
  const padBottom = 24;
  const padX = 8;

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.electric, d.water))) * 1.15;
  const stepX = (width - padX * 2) / (data.length - 1 || 1);

  function pointsFor(key) {
    return data.map((d, i) => {
      const x = padX + i * stepX;
      const y = padTop + (1 - d[key] / maxVal) * (height - padTop - padBottom);
      return [x, y];
    });
  }

  function toPath(points) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  }

  function toAreaPath(points) {
    const floorY = height - padBottom;
    return `${toPath(points)} L${points[points.length - 1][0].toFixed(1)},${floorY} L${points[0][0].toFixed(1)},${floorY} Z`;
  }

  const elecPoints = pointsFor("electric");
  const waterPoints = pointsFor("water");

  const svg = `
    <svg class="line-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${id}-elec" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--elec)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--elec)" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="${id}-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--water)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--water)" stop-opacity="0" />
        </linearGradient>
      </defs>

      ${[0.25, 0.5, 0.75].map((f) => {
        const y = padTop + f * (height - padTop - padBottom);
        return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${width - padX}" y2="${y.toFixed(1)}" stroke="rgba(35,21,10,0.06)" stroke-width="1" />`;
      }).join("")}

      <path class="area-fill" d="${toAreaPath(waterPoints)}" fill="url(#${id}-water)" />
      <path class="area-fill" d="${toAreaPath(elecPoints)}" fill="url(#${id}-elec)" />

      <path class="line-path" d="${toPath(waterPoints)}" fill="none" stroke="var(--water)" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" pathLength="100" style="animation-delay:.05s" />
      <path class="line-path" d="${toPath(elecPoints)}" fill="none" stroke="var(--elec)" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" pathLength="100" />

      ${elecPoints.map((p, i) => `<circle class="line-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--elec)" style="animation-delay:${0.6 + i * 0.05}s" />`).join("")}
      ${waterPoints.map((p, i) => `<circle class="line-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--water)" style="animation-delay:${0.65 + i * 0.05}s" />`).join("")}
    </svg>
    <div class="chart-legend">
      <span class="legend-item"><i class="legend-dot electric"></i>Electric</span>
      <span class="legend-item"><i class="legend-dot water"></i>Water</span>
    </div>
    <div class="chart-ticks">
      ${data.map((d) => `<span class="chart-tick">${d.month}</span>`).join("")}
    </div>
  `;

  container.innerHTML = svg;
}
