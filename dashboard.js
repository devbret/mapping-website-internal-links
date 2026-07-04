const PALETTE = {
  slots: ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948"],
  other: "#898781",
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  emptyCell: "#f2f1ed",
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
  inkMuted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
  surface: "#fcfcfb",
  deEmphasis: "#d8d7d0",
};

const DARK_FILLS = new Set(["#2a78d6", "#008300", "#4a3aa7", "#e34948"]);

const CHECKS = [
  {
    key: "csp",
    label: "CSP",
    pass: (p) => !!p.security.content_security_policy,
  },
  {
    key: "hsts",
    label: "HSTS",
    pass: (p) => !!p.security.strict_transport_security,
  },
  {
    key: "xfo",
    label: "X-Frame-Options",
    pass: (p) => !!p.security.x_frame_options,
  },
  {
    key: "xcto",
    label: "X-Content-Type",
    pass: (p) => !!p.security.x_content_type_options,
  },
  {
    key: "referrer",
    label: "Referrer-Policy",
    pass: (p) => !!p.security.referrer_policy,
  },
  {
    key: "mixed",
    label: "No mixed content",
    pass: (p) => p.mixed_content.length === 0,
  },
  {
    key: "viewport",
    label: "Viewport meta",
    pass: (p) => !!p.has_viewport_meta,
  },
  {
    key: "headings",
    label: "Heading order",
    pass: (p) => p.heading_issues.length === 0,
  },
  {
    key: "alts",
    label: "Image alt text",
    pass: (p) => p.images_without_alt.length === 0,
  },
  {
    key: "inputs",
    label: "Labeled inputs",
    pass: (p) => p.unlabeled_inputs.length === 0,
  },
  {
    key: "canonical",
    label: "Canonical",
    pass: (p) => !!p.structured.canonical,
  },
  {
    key: "landmark",
    label: "Main landmark",
    pass: (p) => !!p.semantic_elements.main,
  },
  { key: "lang", label: "Lang match", pass: (p) => p.language_match === true },
];

const METRICS = [
  { key: "ttfb", label: "TTFB (seconds)", fmt: (v) => v.toFixed(3) },
  {
    key: "word_count",
    label: "Word count",
    fmt: (v) => d3.format(",")(Math.round(v)),
  },
  {
    key: "readability_score",
    label: "Readability score",
    fmt: (v) => v.toFixed(1),
  },
  { key: "sentiment", label: "Sentiment", fmt: (v) => v.toFixed(3) },
];

const fmtInt = d3.format(",");
const fmtSec = (v) => `${v.toFixed(3)} s`;

let dashboardBooted = false;
window.addEventListener("dashboard-show", () => {
  if (dashboardBooted) return;
  dashboardBooted = true;
  d3.json("links.json")
    .then(init)
    .catch((error) => {
      console.error("Error loading links.json:", error);
      const main = document.querySelector(".dash-grid");
      main.textContent =
        "Could not load links.json. Check the console for errors.";
    });
});

function init(site) {
  if (!site || Object.keys(site).length === 0) {
    document.querySelector(".dash-grid").textContent =
      "links.json is empty - run the crawler first.";
    return;
  }

  const pages = Object.entries(site).map(([url, d]) => {
    const parsed = new URL(url);
    return {
      url,
      path: parsed.pathname + parsed.search,
      title: d.title || "",
      depth: Number.isFinite(d.depth) ? d.depth : 0,
      ttfb: d.ttfb || 0,
      response_time: d.response_time || 0,
      word_count: d.word_count || 0,
      readability_score: d.readability_score || 0,
      sentiment: d.sentiment || 0,
      in_degree: d.in_degree || 0,
      out_degree: d.out_degree || 0,
      status_code: d.status_code || 0,
      internal_links: d.internal_links || [],
      keyword_density: d.keyword_density || {},
      security: d.security || {},
      structured: d.structured || {},
      semantic_elements: d.semantic_elements || {},
      mixed_content: d.mixed_content || [],
      heading_issues: d.heading_issues || [],
      unlabeled_inputs: d.unlabeled_inputs || [],
      images_without_alt: d.images_without_alt || [],
      has_viewport_meta: !!d.has_viewport_meta,
      language_match: d.language_match,
    };
  });
  pages.forEach((p) => {
    p.failCount = CHECKS.reduce((n, c) => n + (c.pass(p) ? 0 : 1), 0);
  });

  const pageByUrl = new Map(pages.map((p) => [p.url, p]));

  function rawSection(p) {
    if (p.depth === 0) return "home";
    const seg = new URL(p.url).pathname.split("/").filter(Boolean)[0];
    return seg || "home";
  }
  const sectionCounts = d3.rollup(
    pages.filter((p) => rawSection(p) !== "home"),
    (v) => v.length,
    rawSection,
  );
  const namedSections = [...sectionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s);
  const sections = ["home", ...namedSections];
  if (sectionCounts.size > namedSections.length) sections.push("other");

  const sectionColor = new Map();
  sections.forEach((s, i) => {
    sectionColor.set(s, s === "other" ? PALETTE.other : PALETTE.slots[i]);
  });
  pages.forEach((p) => {
    const raw = rawSection(p);
    p.section = raw === "home" || namedSections.includes(raw) ? raw : "other";
  });
  const sectionRank = new Map(sections.map((s, i) => [s, i]));

  const orderedPages = pages
    .slice()
    .sort(
      (a, b) =>
        sectionRank.get(a.section) - sectionRank.get(b.section) ||
        d3.ascending(a.url, b.url),
    );

  const links = [];
  pages.forEach((p) => {
    p.internal_links.forEach((t) => {
      if (pageByUrl.has(t)) links.push({ source: p.url, target: t });
    });
  });

  const tip = document.getElementById("dash-tooltip");

  function showTip(event, head, rows) {
    tip.textContent = "";
    if (head) {
      const h = document.createElement("div");
      h.className = "tip-head";
      h.textContent = head;
      tip.appendChild(h);
    }
    (rows || []).forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "tip-row";
      const l = document.createElement("span");
      l.className = "tip-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "tip-value";
      v.textContent = value;
      row.appendChild(l);
      row.appendChild(v);
      tip.appendChild(row);
    });
    tip.hidden = false;
    moveTip(event);
  }

  function moveTip(event) {
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + rect.width > window.innerWidth - 8)
      x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8)
      y = event.clientY - rect.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function legendInto(el, entries, shape = "swatch") {
    const root = d3.select(el);
    root.selectAll("*").remove();
    entries.forEach(([label, color]) => {
      const item = root.append("span").attr("class", "legend-item");
      item
        .append("span")
        .attr("class", shape === "line" ? "legend-line" : "legend-swatch")
        .style("background", color);
      item.append("span").text(label);
    });
  }

  function pageTipRows(p) {
    return [
      ["Section", p.section],
      ["Depth", String(p.depth)],
      ["TTFB", fmtSec(p.ttfb)],
      ["Response", fmtSec(p.response_time)],
      ["Words", fmtInt(p.word_count)],
      ["In / out links", `${p.in_degree} / ${p.out_degree}`],
      ["Failing checks", String(p.failCount)],
    ];
  }

  const filters = new Map();
  const updaters = [];
  let keepSet = new Set(pages.map((p) => p.url));

  function applyFilters() {
    keepSet = new Set(
      pages
        .filter((p) =>
          [...filters.entries()].every(
            ([key, [lo, hi]]) => p[key] >= lo && p[key] <= hi,
          ),
        )
        .map((p) => p.url),
    );
    updaters.forEach((fn) => fn(keepSet));
  }

  const kpiRow = document.getElementById("kpi-row");

  const KPIS = [
    {
      label: "Pages",
      value: (sel) => String(sel.length),
      sub: (sel) =>
        sel.length === pages.length ? "" : `of ${pages.length} crawled`,
    },
    {
      label: "Avg TTFB",
      value: (sel) => `${d3.mean(sel, (p) => p.ttfb).toFixed(3)} s`,
    },
    {
      label: "Avg response",
      value: (sel) => `${d3.mean(sel, (p) => p.response_time).toFixed(2)} s`,
    },
    {
      label: "Median words",
      value: (sel) => fmtInt(d3.median(sel, (p) => p.word_count)),
    },
    {
      label: "Avg readability",
      value: (sel) => d3.mean(sel, (p) => p.readability_score).toFixed(1),
    },
    {
      label: "Avg sentiment",
      value: (sel) => d3.mean(sel, (p) => p.sentiment).toFixed(3),
    },
    {
      label: "Internal links",
      value: (sel) => {
        const s = new Set(sel.map((p) => p.url));
        return fmtInt(
          links.filter((l) => s.has(l.source) && s.has(l.target)).length,
        );
      },
    },
  ];

  const tiles = KPIS.map((k) => {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = k.label;
    const value = document.createElement("div");
    value.className = "stat-value";
    const sub = document.createElement("div");
    sub.className = "stat-sub";
    tile.append(label, value, sub);
    kpiRow.appendChild(tile);
    return { k, value, sub };
  });

  const donutTile = document.createElement("div");
  donutTile.className = "stat-tile donut-tile";
  kpiRow.appendChild(donutTile);
  const donutSvg = d3
    .select(donutTile)
    .append("svg")
    .attr("width", 76)
    .attr("height", 76)
    .attr("viewBox", "0 0 76 76");
  const donutG = donutSvg.append("g").attr("transform", "translate(38,38)");
  const donutCenter = donutG
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("font-size", 13)
    .attr("font-weight", 600)
    .attr("fill", PALETTE.ink);
  const donutLegend = document.createElement("div");
  donutLegend.className = "donut-legend";
  donutTile.appendChild(donutLegend);

  const STATUS_BUCKETS = [
    { key: "2xx", label: "2xx OK", color: PALETTE.status.good, icon: "✓" },
    {
      key: "3xx",
      label: "3xx redirect",
      color: PALETTE.status.warning,
      icon: "→",
    },
    {
      key: "4xx",
      label: "4xx client error",
      color: PALETTE.status.serious,
      icon: "!",
    },
    {
      key: "5xx",
      label: "5xx server error",
      color: PALETTE.status.critical,
      icon: "✕",
    },
    { key: "other", label: "other", color: PALETTE.other, icon: "?" },
  ];

  function statusBucket(code) {
    const head = String(code)[0];
    return { 2: "2xx", 3: "3xx", 4: "4xx", 5: "5xx" }[head] || "other";
  }

  function renderKPIs(keep) {
    const sel = pages.filter((p) => keep.has(p.url));
    tiles.forEach(({ k, value, sub }) => {
      value.textContent = sel.length ? k.value(sel) : "-";
      sub.textContent = sel.length && k.sub ? k.sub(sel) : "";
    });

    const counts = d3.rollup(
      sel,
      (v) => v.length,
      (p) => statusBucket(p.status_code),
    );
    const present = STATUS_BUCKETS.filter((b) => counts.has(b.key));
    const pie = d3
      .pie()
      .value((b) => counts.get(b.key))
      .sort(null)
      .padAngle(present.length > 1 ? 0.06 : 0);
    const arc = d3.arc().innerRadius(24).outerRadius(36).cornerRadius(2);

    donutG
      .selectAll("path")
      .data(pie(present), (d) => d.data.key)
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) => d.data.color)
      .on("pointermove", (event, d) =>
        showTip(event, "HTTP status", [
          [d.data.label, `${counts.get(d.data.key)} pages`],
        ]),
      )
      .on("pointerleave", hideTip);
    donutCenter.text(sel.length ? String(sel.length) : "0");

    donutLegend.textContent = "";
    const label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = "HTTP status";
    donutLegend.appendChild(label);
    present.forEach((b) => {
      const row = document.createElement("div");
      row.className = "stat-sub";
      row.textContent = `${b.icon} ${b.label} - ${counts.get(b.key)}`;
      donutLegend.appendChild(row);
    });
    if (!present.length) {
      const row = document.createElement("div");
      row.className = "stat-sub";
      row.textContent = "no pages match";
      donutLegend.appendChild(row);
    }
  }
  updaters.push(renderKPIs);

  const histRoot = document.getElementById("histograms");

  const histCells = METRICS.map((metric) => {
    const cell = document.createElement("div");
    cell.className = "histogram-cell";
    histRoot.appendChild(cell);

    const title = document.createElement("div");
    title.className = "hist-title";
    title.textContent = metric.label;
    const range = document.createElement("div");
    range.className = "hist-range";
    range.textContent = " ";
    cell.append(title, range);
    return { metric, cell, range };
  });

  histCells.forEach(({ metric, cell, range }) => {
    const margin = { top: 6, right: 20, bottom: 20, left: 30 };
    const width = Math.max(cell.clientWidth || 280, 240);
    const height = 120;
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const svg = d3
      .select(cell)
      .append("svg")
      .attr("width", width)
      .attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const values = pages.map((p) => p[metric.key]);
    const x = d3
      .scaleLinear()
      .domain(d3.extent(values))
      .nice()
      .range([0, plotW]);
    const bins = d3.bin().domain(x.domain()).thresholds(20)(values);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (b) => b.length)])
      .range([plotH, 0]);

    function roundedTopBar(b, count) {
      const x0 = x(b.x0) + 1;
      const w = Math.max(1, x(b.x1) - x(b.x0) - 2);
      const h = plotH - y(count);
      if (h <= 0) return "";
      const r = Math.min(4, w / 2, h);
      const top = y(count);
      return `M${x0},${plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + w - r} Q${x0 + w},${top} ${x0 + w},${top + r} V${plotH} Z`;
    }

    g.append("g")
      .selectAll("path")
      .data(bins)
      .join("path")
      .attr("fill", PALETTE.deEmphasis)
      .attr("d", (b) => roundedTopBar(b, b.length));

    const overlay = g
      .append("g")
      .selectAll("path")
      .data(bins)
      .join("path")
      .attr("fill", PALETTE.slots[0]);

    g.append("g")
      .attr("transform", `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(4).tickSizeOuter(0))
      .call(styleAxis);
    g.append("g")
      .call(d3.axisLeft(y).ticks(3).tickSizeOuter(0))
      .call(styleAxis);

    function styleAxis(sel) {
      sel.select(".domain").attr("stroke", PALETTE.baseline);
      sel.selectAll(".tick line").attr("stroke", PALETTE.baseline);
      sel
        .selectAll(".tick text")
        .attr("fill", PALETTE.inkMuted)
        .attr("font-size", 10);
    }

    const brush = d3
      .brushX()
      .extent([
        [0, 0],
        [0 + plotW, plotH],
      ])
      .on("brush", (event) => {
        if (event.selection) {
          const [lo, hi] = event.selection.map(x.invert);
          range.textContent = `${metric.fmt(lo)} – ${metric.fmt(hi)}`;
        }
      })
      .on("end", (event) => {
        if (event.selection) {
          const [lo, hi] = event.selection.map(x.invert);
          filters.set(metric.key, [lo, hi]);
          range.textContent = `${metric.fmt(lo)} – ${metric.fmt(hi)}`;
        } else {
          filters.delete(metric.key);
          range.textContent = " ";
        }
        applyFilters();
      });

    const brushG = g.append("g").call(brush);
    brushG
      .select(".selection")
      .attr("fill", PALETTE.slots[0])
      .attr("fill-opacity", 0.12)
      .attr("stroke", PALETTE.slots[0]);

    updaters.push((keep) => {
      const keptBins = bins.map((b) => {
        const kept = pages.filter(
          (p) =>
            keep.has(p.url) &&
            p[metric.key] >= b.x0 &&
            (p[metric.key] < b.x1 ||
              (b.x1 === x.domain()[1] && p[metric.key] <= b.x1)),
        ).length;
        return { bin: b, kept };
      });
      overlay.data(keptBins).attr("d", (d) => roundedTopBar(d.bin, d.kept));
    });
  });

  (function radialGraph() {
    const el = document.getElementById("radial-graph");
    const width = Math.max(el.clientWidth || 620, 480);
    const height = 540;
    const cx = width / 2;
    const cy = height / 2 + 6;
    const maxDepth = d3.max(pages, (p) => p.depth) || 1;
    const maxR = Math.min(width, height) / 2 - 30;
    const ringR = (depth) => (depth / maxDepth) * maxR;

    const svg = d3
      .select(el)
      .append("svg")
      .attr("width", width)
      .attr("height", height);
    const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);

    for (let depth = 1; depth <= maxDepth; depth++) {
      g.append("circle")
        .attr("r", ringR(depth))
        .attr("fill", "none")
        .attr("stroke", PALETTE.gridline)
        .attr("stroke-width", 1);
      g.append("text")
        .attr("x", 0)
        .attr("y", -ringR(depth) - 5)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", PALETTE.inkMuted)
        .text(`Depth ${depth}`);
    }

    const byDepth = d3.group(orderedPages, (p) => p.depth);
    const pos = new Map();
    byDepth.forEach((ring, depth) => {
      ring.forEach((p, i) => {
        const angle = (i / ring.length) * 2 * Math.PI - Math.PI / 2;
        pos.set(p.url, {
          x: ringR(depth) * Math.cos(angle),
          y: ringR(depth) * Math.sin(angle),
        });
      });
    });

    const linkSel = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("x1", (l) => pos.get(l.source).x)
      .attr("y1", (l) => pos.get(l.source).y)
      .attr("x2", (l) => pos.get(l.target).x)
      .attr("y2", (l) => pos.get(l.target).y)
      .attr("stroke", PALETTE.baseline)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.18);

    const rOf = (p) => Math.min(4 + Math.sqrt(p.in_degree) * 1.4, 16);

    const nodeG = g
      .append("g")
      .selectAll("g")
      .data(orderedPages)
      .join("g")
      .attr("transform", (p) => {
        const q = pos.get(p.url);
        return `translate(${q.x},${q.y})`;
      });

    nodeG
      .append("circle")
      .attr("class", "radial-dot")
      .attr("r", rOf)
      .attr("fill", (p) => sectionColor.get(p.section))
      .attr("stroke", PALETTE.surface)
      .attr("stroke-width", 2);

    nodeG
      .append("circle")
      .attr("r", (p) => Math.max(rOf(p) + 4, 12))
      .attr("fill", "transparent")
      .on("pointermove", function (event, p) {
        showTip(event, p.path || "/", pageTipRows(p));
        linkSel
          .attr("stroke", (l) =>
            l.source === p.url || l.target === p.url
              ? PALETTE.slots[0]
              : PALETTE.baseline,
          )
          .attr("stroke-opacity", (l) =>
            l.source === p.url || l.target === p.url ? 0.85 : 0.05,
          );
        d3.select(this.parentNode).raise();
      })
      .on("pointerleave", () => {
        hideTip();
        linkSel.attr("stroke", PALETTE.baseline).attr("stroke-opacity", 0.18);
      });

    legendInto(
      document.getElementById("radial-legend"),
      sections.map((s) => [s, sectionColor.get(s)]),
    );

    updaters.push((keep) => {
      nodeG.attr("opacity", (p) => (keep.has(p.url) ? 1 : 0.15));
      linkSel.attr("display", (l) =>
        keep.has(l.source) && keep.has(l.target) ? null : "none",
      );
    });
  })();

  (function treemap() {
    const el = document.getElementById("treemap");
    const width = Math.max(el.clientWidth || 620, 480);
    const height = 540;

    const root = d3
      .hierarchy({
        children: sections.map((s) => ({
          section: s,
          children: orderedPages.filter((p) => p.section === s),
        })),
      })
      .sum((d) => (d.url ? Math.max(d.word_count, 40) : 0))
      .sort((a, b) => b.value - a.value);

    d3
      .treemap()
      .size([width, height])
      .paddingInner(2)
      .paddingOuter(3)
      .paddingTop(20)(root);

    const svg = d3
      .select(el)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    svg
      .selectAll(".tm-section")
      .data(root.children)
      .join("text")
      .attr("x", (d) => d.x0 + 4)
      .attr("y", (d) => d.y0 + 14)
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("fill", PALETTE.inkSecondary)
      .text((d) =>
        d.x1 - d.x0 > 52
          ? truncate(
              `${d.data.section} (${d.children.length})`,
              Math.floor((d.x1 - d.x0) / 6.2),
            )
          : "",
      );

    const leaf = svg
      .selectAll(".tm-leaf")
      .data(root.leaves())
      .join("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    leaf
      .append("rect")
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("rx", 2)
      .attr("fill", (d) => sectionColor.get(d.data.section))
      .on("pointermove", (event, d) =>
        showTip(event, d.data.path || "/", [
          ["Title", truncate(d.data.title, 60) || "-"],
          ...pageTipRows(d.data),
        ]),
      )
      .on("pointerleave", hideTip);

    leaf
      .filter((d) => d.x1 - d.x0 > 74 && d.y1 - d.y0 > 30)
      .append("text")
      .attr("x", 5)
      .attr("y", 15)
      .attr("font-size", 10.5)
      .attr("pointer-events", "none")
      .attr("fill", (d) =>
        DARK_FILLS.has(sectionColor.get(d.data.section))
          ? "#ffffff"
          : PALETTE.ink,
      )
      .text((d) => {
        const last = d.data.path.split("/").filter(Boolean).pop() || "home";
        return truncate(last, Math.floor((d.x1 - d.x0 - 8) / 5.8));
      });

    leaf
      .filter((d) => d.x1 - d.x0 > 74 && d.y1 - d.y0 > 46)
      .append("text")
      .attr("x", 5)
      .attr("y", 29)
      .attr("font-size", 9.5)
      .attr("pointer-events", "none")
      .attr("opacity", 0.85)
      .attr("fill", (d) =>
        DARK_FILLS.has(sectionColor.get(d.data.section))
          ? "#ffffff"
          : PALETTE.inkSecondary,
      )
      .text((d) => `${fmtInt(d.data.word_count)} words`);

    legendInto(
      document.getElementById("treemap-legend"),
      sections.map((s) => [s, sectionColor.get(s)]),
    );

    updaters.push((keep) => {
      leaf.attr("opacity", (d) => (keep.has(d.data.url) ? 1 : 0.18));
    });
  })();

  (function dumbbell() {
    const el = document.getElementById("dumbbell");
    const sorted = pages
      .slice()
      .sort((a, b) => b.response_time - a.response_time);
    const margin = { top: 24, right: 46, bottom: 8, left: 210 };

    let row = null;

    function render() {
      const width = Math.max(el.clientWidth || 620, 480);
      const plotW = width - margin.left - margin.right;
      const availH = el.clientHeight || 0;
      const rowH = Math.max(
        12,
        (availH - margin.top - margin.bottom) / sorted.length,
      );
      const height = margin.top + sorted.length * rowH + margin.bottom;

      const x = d3
        .scaleLinear()
        .domain([0, d3.max(sorted, (p) => p.response_time)])
        .nice()
        .range([0, plotW]);

      d3.select(el).selectAll("svg").remove();
      const svg = d3
        .select(el)
        .append("svg")
        .attr("width", width)
        .attr("height", height);
      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const axis = g.append("g").call(
        d3
          .axisTop(x)
          .ticks(5)
          .tickSizeOuter(0)
          .tickFormat((v) => `${v}s`),
      );
      axis.select(".domain").attr("stroke", PALETTE.baseline);
      axis.selectAll(".tick line").attr("stroke", PALETTE.baseline);
      axis
        .selectAll(".tick text")
        .attr("fill", PALETTE.inkMuted)
        .attr("font-size", 10);
      g.append("g")
        .selectAll("line")
        .data(x.ticks(5))
        .join("line")
        .attr("x1", (v) => x(v))
        .attr("x2", (v) => x(v))
        .attr("y1", 2)
        .attr("y2", sorted.length * rowH)
        .attr("stroke", PALETTE.gridline)
        .attr("stroke-width", 1);

      row = g
        .append("g")
        .selectAll("g")
        .data(sorted)
        .join("g")
        .attr("transform", (p, i) => `translate(0,${i * rowH + rowH / 2})`);

      row
        .append("text")
        .attr("x", -12)
        .attr("dy", 3.5)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("fill", PALETTE.inkSecondary)
        .text((p) => truncate(p.path || "/", 32));

      row
        .append("line")
        .attr("x1", (p) => x(p.ttfb))
        .attr("x2", (p) => x(p.response_time))
        .attr("stroke", "#9ec5f4")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");

      row
        .append("circle")
        .attr("cx", (p) => x(p.ttfb))
        .attr("r", 4.5)
        .attr("fill", "#86b6ef")
        .attr("stroke", PALETTE.surface)
        .attr("stroke-width", 2);

      row
        .append("circle")
        .attr("cx", (p) => x(p.response_time))
        .attr("r", 4.5)
        .attr("fill", "#184f95")
        .attr("stroke", PALETTE.surface)
        .attr("stroke-width", 2);

      row
        .filter((p, i) => i === 0)
        .append("text")
        .attr("x", (p) => x(p.response_time) + 10)
        .attr("dy", 3.5)
        .attr("font-size", 10)
        .attr("fill", PALETTE.inkSecondary)
        .text((p) => `${p.response_time.toFixed(2)}s`);

      row
        .append("rect")
        .attr("x", -margin.left)
        .attr("y", -rowH / 2)
        .attr("width", width - margin.right)
        .attr("height", rowH)
        .attr("fill", "transparent")
        .on("pointermove", (event, p) =>
          showTip(event, p.path || "/", [
            ["TTFB", fmtSec(p.ttfb)],
            ["Total response", fmtSec(p.response_time)],
            [
              "Transfer after TTFB",
              fmtSec(Math.max(0, p.response_time - p.ttfb)),
            ],
          ]),
        )
        .on("pointerleave", hideTip);

      applyDim(keepSet);
    }

    function applyDim(keep) {
      if (!row) return;
      row.attr("opacity", (p) => (keep.has(p.url) ? 1 : 0.15));
    }

    legendInto(document.getElementById("dumbbell-legend"), [
      ["TTFB", "#86b6ef"],
      ["Total response", "#184f95"],
    ]);

    render();
    updaters.push(applyDim);

    let lastW = -1;
    let lastH = -1;
    let resizeTimer = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (
          Math.abs(el.clientWidth - lastW) > 1 ||
          Math.abs(el.clientHeight - lastH) > 1
        ) {
          lastW = el.clientWidth;
          lastH = el.clientHeight;
          render();
        }
      }, 150);
    });
    observer.observe(el);
  })();

  (function issueMatrix() {
    const el = document.getElementById("issue-matrix");
    const sorted = pages
      .slice()
      .sort((a, b) => b.failCount - a.failCount || d3.ascending(a.url, b.url));
    const cellW = 26;
    const cellH = 16;
    const labelW = 210;
    const headerH = 92;
    const width = labelW + CHECKS.length * cellW + 60;
    const height = headerH + sorted.length * cellH + 8;

    const svg = d3
      .select(el)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    svg
      .append("g")
      .selectAll("text")
      .data(CHECKS)
      .join("text")
      .attr(
        "transform",
        (c, i) =>
          `translate(${labelW + i * cellW + cellW / 2 + 3},${headerH - 8}) rotate(-45)`,
      )
      .attr("font-size", 10)
      .attr("fill", PALETTE.inkSecondary)
      .text((c) => c.label);
    svg
      .append("text")
      .attr("x", labelW + CHECKS.length * cellW + 12)
      .attr("y", headerH - 8)
      .attr("font-size", 10)
      .attr("font-weight", 600)
      .attr("fill", PALETTE.inkSecondary)
      .text("fails");

    const row = svg
      .append("g")
      .selectAll("g")
      .data(sorted)
      .join("g")
      .attr("transform", (p, i) => `translate(0,${headerH + i * cellH})`);

    row
      .append("text")
      .attr("x", labelW - 10)
      .attr("y", cellH / 2 + 3.5)
      .attr("text-anchor", "end")
      .attr("font-size", 9.5)
      .attr("fill", PALETTE.inkSecondary)
      .text((p) => truncate(p.path || "/", 32));

    CHECKS.forEach((check, ci) => {
      row
        .append("rect")
        .attr("x", labelW + ci * cellW)
        .attr("y", 1)
        .attr("width", cellW - 2)
        .attr("height", cellH - 3)
        .attr("rx", 2)
        .attr("fill", (p) =>
          check.pass(p) ? PALETTE.emptyCell : PALETTE.status.critical,
        )
        .on("pointermove", (event, p) =>
          showTip(event, check.label, [
            ["Page", truncate(p.path || "/", 42)],
            ["Result", check.pass(p) ? "pass" : "FAIL"],
          ]),
        )
        .on("pointerleave", hideTip);

      row
        .filter((p) => !check.pass(p))
        .append("text")
        .attr("x", labelW + ci * cellW + (cellW - 2) / 2)
        .attr("y", cellH / 2 + 3.5)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("fill", "#ffffff")
        .attr("pointer-events", "none")
        .text("×");
    });

    row
      .append("text")
      .attr("x", labelW + CHECKS.length * cellW + 12)
      .attr("y", cellH / 2 + 3.5)
      .attr("font-size", 10)
      .attr("fill", PALETTE.ink)
      .attr("font-variant-numeric", "tabular-nums")
      .text((p) => String(p.failCount));

    updaters.push((keep) => {
      row.attr("opacity", (p) => (keep.has(p.url) ? 1 : 0.2));
    });
  })();

  (function pageTable() {
    const el = document.getElementById("page-table");
    const COLS = [
      { key: "path", label: "Page", num: false, val: (p) => p.path || "/" },
      { key: "section", label: "Section", num: false, val: (p) => p.section },
      { key: "depth", label: "Depth", num: true, val: (p) => p.depth },
      {
        key: "ttfb",
        label: "TTFB (s)",
        num: true,
        val: (p) => p.ttfb,
        fmt: (v) => v.toFixed(3),
      },
      {
        key: "response_time",
        label: "Response (s)",
        num: true,
        val: (p) => p.response_time,
        fmt: (v) => v.toFixed(2),
      },
      {
        key: "word_count",
        label: "Words",
        num: true,
        val: (p) => p.word_count,
        fmt: fmtInt,
      },
      {
        key: "readability_score",
        label: "Readability",
        num: true,
        val: (p) => p.readability_score,
        fmt: (v) => v.toFixed(1),
      },
      {
        key: "sentiment",
        label: "Sentiment",
        num: true,
        val: (p) => p.sentiment,
        fmt: (v) => v.toFixed(3),
      },
      { key: "in_degree", label: "In", num: true, val: (p) => p.in_degree },
      { key: "out_degree", label: "Out", num: true, val: (p) => p.out_degree },
      {
        key: "failCount",
        label: "Failing checks",
        num: true,
        val: (p) => p.failCount,
      },
    ];

    let sortKey = "response_time";
    let sortDesc = true;
    let currentKeep = keepSet;

    const table = document.createElement("table");
    table.className = "page-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    COLS.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      if (c.num) th.classList.add("num");
      th.addEventListener("click", () => {
        if (sortKey === c.key) sortDesc = !sortDesc;
        else {
          sortKey = c.key;
          sortDesc = c.num;
        }
        render();
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    el.appendChild(table);

    function render() {
      const col = COLS.find((c) => c.key === sortKey);
      const rows = pages.slice().sort((a, b) => {
        const cmp = col.num
          ? d3.ascending(col.val(a), col.val(b))
          : d3.ascending(String(col.val(a)), String(col.val(b)));
        return sortDesc ? -cmp : cmp;
      });

      headRow.querySelectorAll("th").forEach((th, i) => {
        th.classList.toggle("sorted", COLS[i].key === sortKey);
        th.textContent =
          COLS[i].label +
          (COLS[i].key === sortKey ? (sortDesc ? " ↓" : " ↑") : "");
      });

      tbody.textContent = "";
      rows.forEach((p) => {
        const tr = document.createElement("tr");
        if (!currentKeep.has(p.url)) tr.classList.add("filtered-out");
        COLS.forEach((c) => {
          const td = document.createElement("td");
          const v = c.val(p);
          if (c.key === "path") {
            td.classList.add("page-cell");
            td.textContent = v;
            td.title = p.url;
          } else if (c.key === "section") {
            const dot = document.createElement("span");
            dot.className = "section-dot";
            dot.style.background = sectionColor.get(p.section);
            td.append(dot, document.createTextNode(v));
          } else {
            td.classList.add("num");
            td.textContent = c.fmt ? c.fmt(v) : String(v);
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    render();
    updaters.push((keep) => {
      currentKeep = keep;
      render();
    });
  })();

  applyFilters();
}
