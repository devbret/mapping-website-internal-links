function idOf(x) {
  return typeof x === "string" ? x : x?.id;
}

const statusColor = d3
  .scaleOrdinal()
  .domain(["2xx", "3xx", "4xx", "5xx", "other"])
  .range(["aqua", "#f59e0b", "#ef4444", "#a855f7", "#64748b"]);

function statusBucket(code) {
  if (!code) return "other";
  const s = String(code);
  const head = +s[0];
  return { 2: "2xx", 3: "3xx", 4: "4xx", 5: "5xx" }[head] || "other";
}

const isGreen = (d) => statusBucket(d.status_code) === "2xx";
const GREEN_FADE_OPACITY = 0.25;

let currentlySelectedNode = null;

d3.json("links.json")
  .then(function (site_structure) {
    if (!site_structure || Object.keys(site_structure).length === 0) {
      console.warn("links.json is empty or invalid. Cannot render graph.");
      d3.select("#graph-view")
        .append("p")
        .text("No crawl data available to display.");
      return;
    }

    const nodes = [];
    const links = [];

    function getNodeData(url) {
      const d = site_structure[url] || {};
      return {
        id: url,

        title: d.title || "",
        meta_description: d.meta_description || "",
        meta_keywords: d.meta_keywords || "",
        h1_tags: d.h1_tags || [],
        word_count: d.word_count || 0,
        status_code: d.status_code || "",
        response_time: d.response_time || 0,
        readability_score: d.readability_score || 0,
        sentiment: d.sentiment || 0,
        keyword_density: d.keyword_density || {},
        image_count: d.image_count || 0,
        script_count: d.script_count || 0,
        stylesheet_count: d.stylesheet_count || 0,
        has_viewport_meta: !!d.has_viewport_meta,
        heading_count: d.heading_count || 0,
        paragraph_count: d.paragraph_count || 0,
        internal_links: d.internal_links || [],
        external_links: d.external_links || [],
        semantic_elements: d.semantic_elements || {},
        heading_issues: d.heading_issues || [],
        unlabeled_inputs: d.unlabeled_inputs || [],
        images_without_alt: d.images_without_alt || [],

        text_content: d.text_content || "",
        search_text: d.search_text || (d.text_content || "").toLowerCase(),

        depth: d.depth ?? null,
        ttfb: d.ttfb || 0,
        in_degree: d.in_degree || 0,
        out_degree: d.out_degree || 0,
        is_orphan: !!d.is_orphan,

        http_delivery: d.http_delivery || {},
        security: d.security || {},
        mixed_content: d.mixed_content || [],

        structured: d.structured || {},
        a11y_extras: d.a11y_extras || {},

        text_hash: d.text_hash || "",
        read_time_minutes: d.read_time_minutes || 0,
        lang_attribute: d.lang_attribute || "",
        detected_language: d.detected_language || "",
        language_match: d.language_match,

        link_rel: d.link_rel || [],
        media_hints: d.media_hints || {},

        site_wide: d.site_wide || null,
      };
    }

    Object.keys(site_structure).forEach((sourceUrl) => {
      const sourceData = site_structure[sourceUrl];

      if (!nodes.some((node) => node.id === sourceUrl)) {
        nodes.push(getNodeData(sourceUrl));
      }

      if (sourceData && Array.isArray(sourceData.internal_links)) {
        sourceData.internal_links.forEach((targetUrl) => {
          links.push({ source: sourceUrl, target: targetUrl });
          if (!nodes.some((node) => node.id === targetUrl)) {
            nodes.push(getNodeData(targetUrl));
          }
        });
      }
    });

    if (nodes.length === 0) {
      console.warn("No nodes to display in the graph.");
      return;
    }

    const degreeById = (() => {
      const counts = new Map();
      links.forEach((l) => {
        const s = idOf(l.source);
        const t = idOf(l.target);
        counts.set(s, (counts.get(s) || 0) + 1);
        counts.set(t, (counts.get(t) || 0) + 1);
      });
      return counts;
    })();

    const width = window.innerWidth;
    const height = window.innerHeight;

    const svg = d3
      .select("#graph-view")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const container = svg.append("g");

    const zoomHandler = d3
      .zoom()
      .on("zoom", (event) => container.attr("transform", event.transform));
    svg.call(zoomHandler).call(zoomHandler.transform, d3.zoomIdentity);

    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "magenta");

    const link = container
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("fill", "none")
      .attr("marker-end", "url(#arrow)")
      .style("pointer-events", "none");

    const ARROW_URL = "url(#arrow)";

    function showArrowheadsForNeighbors(nodeId) {
      link.attr("marker-end", (l) =>
        idOf(l.source) === nodeId || idOf(l.target) === nodeId
          ? ARROW_URL
          : null,
      );
    }

    function restoreAllArrowheads() {
      link.attr("marker-end", ARROW_URL);
    }

    const sizeModes = {
      degree: (d) =>
        Math.max(6, Math.min(26, (degreeById.get(d.id) || 1) * 1.4)),
      words: (d) => Math.max(6, Math.sqrt(d.word_count || 0) * 0.4 + 6),
      speed: (d) => Math.max(6, 24 - Math.min(20, (d.response_time || 0) * 4)),
      ttfb: (d) => Math.max(6, 24 - Math.min(20, (d.ttfb || 0) * 8)),
    };
    sizeModes.hub = (d) =>
      Math.max(6, Math.log1p((d.in_degree || 0) + (d.out_degree || 0)) * 6);
    let sizeMode = "degree";

    const node = container
      .append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", (d) => sizeModes[sizeMode](d))
      .attr("fill", (d) => statusColor(statusBucket(d.status_code)))
      .attr("stroke", (d) => (hasIssues(d) ? "#ef4444" : "black"))
      .attr("stroke-width", (d) => (hasIssues(d) ? 2.5 : 1.5))
      .on("mouseover", mouseover)
      .on("mouseout", mouseout)
      .on("dblclick", (event, d) => {
        window.open(d.id, "_blank");
      })
      .call(
        d3
          .drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended),
      );

    const labels = container
      .append("g")
      .attr("class", "labels")
      .selectAll("text")
      .data(nodes)
      .enter()
      .append("text")
      .attr("class", "node-label")
      .attr("font-size", 10)
      .attr("pointer-events", "none")
      .attr("display", "none")
      .text((d) => d.title || new URL(d.id).pathname);

    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const adj = new Map(nodes.map((n) => [n.id, new Set()]));
    links.forEach((l) => {
      const s = idOf(l.source),
        t = idOf(l.target);
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    });

    function getRootId() {
      const depth0 = nodes.find((n) => (n.depth ?? 0) === 0);
      if (depth0) return depth0.id;
      return nodes
        .slice()
        .sort(
          (a, b) =>
            new URL(a.id).pathname.length - new URL(b.id).pathname.length,
        )[0].id;
    }

    function shortestPath(srcId, dstId) {
      if (srcId === dstId) return [srcId];
      const q = [srcId];
      const prev = new Map([[srcId, null]]);
      while (q.length) {
        const v = q.shift();
        for (const nb of adj.get(v) || []) {
          if (!prev.has(nb)) {
            prev.set(nb, v);
            if (nb === dstId) {
              const out = [dstId];
              for (let cur = v; cur != null; cur = prev.get(cur)) out.push(cur);
              return out.reverse();
            }
            q.push(nb);
          }
        }
      }
      return [];
    }

    function highlightPath(pathIds) {
      if (!Array.isArray(pathIds) || pathIds.length === 0) return;

      const pathSet = new Set(pathIds);
      const edgeSet = new Set();
      for (let i = 0; i < pathIds.length - 1; i++) {
        const a = pathIds[i],
          b = pathIds[i + 1];
        edgeSet.add(a + "→" + b);
        edgeSet.add(b + "→" + a);
      }

      node
        .classed("highlight", (d) => pathSet.has(d.id))
        .classed("dimmed", (d) => !pathSet.has(d.id));

      link
        .classed("highlight", (l) =>
          edgeSet.has(idOf(l.source) + "→" + idOf(l.target)),
        )
        .classed(
          "dimmed",
          (l) => !edgeSet.has(idOf(l.source) + "→" + idOf(l.target)),
        );

      if (typeof ARROW_URL !== "undefined") {
        link.attr("marker-end", (l) =>
          edgeSet.has(idOf(l.source) + "→" + idOf(l.target)) ? ARROW_URL : null,
        );
      }
    }

    node.on("click", (event, d) => {
      currentlySelectedNode = d;

      const rootId = getRootId();
      const path = shortestPath(d.id, rootId);

      if (path.length > 0) {
        highlightPath(path);
      } else {
        highlightNeighborhood(d.id);
      }

      if (typeof renderInspector === "function") renderInspector(d);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearHighlight?.();
        if (typeof restoreAllArrowheads === "function") restoreAllArrowheads();
      }
    });

    function issueScore(d) {
      const unlabeled = d.unlabeled_inputs?.length || 0;
      const noAlt = d.images_without_alt?.length || 0;
      const mixed = d.mixed_content?.length || 0;
      const noCSP = d.security?.content_security_policy ? 0 : 1;
      const heading = d.heading_issues?.length || 0;
      const isError = /^4|^5/.test(String(d.status_code)) ? 1 : 0;
      return unlabeled + noAlt + mixed + noCSP + heading + isError;
    }

    const issueExtent = d3.extent(nodes, (d) => issueScore(d));
    const colorByIssue = d3
      .scaleSequential(d3.interpolateTurbo)
      .domain([issueExtent[0] ?? 0, issueExtent[1] ?? 1]);

    function groupKey(url) {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean)[0] || "/";
      return `${u.hostname}/${seg}`;
    }
    const groups = d3.group(nodes, (d) => groupKey(d.id));
    const groupColor = d3.scaleOrdinal([...groups.keys()], d3.schemeTableau10);
    const hullLayer = container
      .insert("g", ":first-child")
      .attr("class", "hulls")
      .style("pointer-events", "none");

    function drawHulls() {
      const hullData = [...groups].map(([k, arr]) => {
        const visibleArr = arr.filter((d) => !d._filteredOut);

        const pts = d3.polygonHull(
          visibleArr
            .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
            .map((d) => [d.x, d.y]),
        );

        return { k, pts, arr: visibleArr };
      });

      const path = hullLayer.selectAll("path").data(
        hullData.filter((h) => h.pts && h.pts.length > 2),
        (d) => d.k,
      );

      path
        .enter()
        .append("path")
        .attr("fill", (d) => colorByIssue(d3.max(d.arr, issueScore) ?? 0))
        .attr("fill-opacity", 0.06)
        .attr("stroke", (d) => groupColor(d.k))
        .attr("stroke-opacity", (d) => (sectionHasIssues(d.arr) ? 0.9 : 0.4))
        .attr("stroke-width", (d) => (sectionHasIssues(d.arr) ? 2.2 : 1.2))
        .merge(path)
        .attr("d", (d) => "M" + d.pts.join("L") + "Z");

      path.exit().remove();
    }

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance(430)
          .strength(0.8),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d) => Math.max(10, (degreeById.get(d.id) || 1) + 6))
          .iterations(1),
      )
      .alphaDecay(0.03);

    simulation.on("tick", () => {
      link.attr("d", (d) => {
        const sx = d.source.x,
          sy = d.source.y,
          tx = d.target.x,
          ty = d.target.y;
        const dx = tx - sx;
        const dy = ty - sy;
        const dr = Math.hypot(dx, dy) * 0.6;
        return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
      });

      node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      labels.attr("x", (d) => d.x + 10).attr("y", (d) => d.y + 4);

      drawHulls();
    });

    const searchInput = document.getElementById("node-search");
    const clearBtn = document.getElementById("node-search-clear");
    const searchStatus = document.getElementById("search-status");

    if (searchInput) {
      nodes.forEach((n) => (n._filteredOut = false));

      function matchesQuery(d, keywords) {
        const hay = (d.search_text || d.text_content || "").toLowerCase();
        if (!hay) return false;
        return keywords.every((kw) => hay.includes(kw));
      }

      function applyFilter(query) {
        const keywords = query
          .toLowerCase()
          .split(/\s+/)
          .map((k) => k.trim())
          .filter(Boolean);

        if (keywords.length === 0) {
          nodes.forEach((n) => (n._filteredOut = false));

          node.style("display", null).style("pointer-events", null);
          labels.style("display", "none");
          link.style("display", null);

          drawHulls();
          clearHighlight?.();
          if (searchStatus) searchStatus.textContent = "";
          return;
        }

        const keepSet = new Set(
          nodes.filter((n) => matchesQuery(n, keywords)).map((n) => n.id),
        );

        if (searchStatus) {
          searchStatus.textContent = `${keepSet.size} node${
            keepSet.size === 1 ? "" : "s"
          } match`;
        }

        nodes.forEach((n) => (n._filteredOut = !keepSet.has(n.id)));

        node
          .style("display", (d) => (keepSet.has(d.id) ? null : "none"))
          .style("pointer-events", (d) => (keepSet.has(d.id) ? null : "none"));

        labels.style("display", (d) => (keepSet.has(d.id) ? null : "none"));

        link.style("display", (l) => {
          const s = idOf(l.source);
          const t = idOf(l.target);
          return keepSet.has(s) && keepSet.has(t) ? null : "none";
        });

        drawHulls();

        if (currentlySelectedNode && !keepSet.has(currentlySelectedNode.id)) {
          currentlySelectedNode = null;
          clearHighlight?.();
          showNodeEmptyState();
        }
      }

      let debounceTimer = null;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          applyFilter(e.target.value || "");
        }, 120);
      });

      clearBtn?.addEventListener("click", () => {
        searchInput.value = "";
        applyFilter("");
        searchInput.focus();
      });

      window.addEventListener("keydown", (e) => {
        if (
          e.key === "/" &&
          document.activeElement !== searchInput &&
          !document.body.classList.contains("dashboard-open")
        ) {
          e.preventDefault();
          searchInput.focus();
        }
      });
    }

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        svg.attr("width", w).attr("height", h);
        simulation.force("center", d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.2).restart();
      }, 150);
    });

    function mouseover(event, d) {
      d3.select(this).raise();

      const claudeDiv = document.querySelector("#claude-analysis-section");
      const claudeOutput = document.querySelector("#claude-analysis-output");
      if (claudeDiv && claudeOutput) {
        claudeDiv.style.display = "block";
        claudeOutput.innerHTML = "";
      }

      currentlySelectedNode = d;

      const connectedLinks = links.filter(
        (l) =>
          (l.source.id || l.source) === d.id ||
          (l.target.id || l.target) === d.id,
      ).length;

      renderNodeScorecard(d, connectedLinks);

      d3.select(this).style("cursor", "pointer");
      labels.filter((l) => l === d).attr("display", null);

      node.classed("dimmed", true);
      link.classed("dimmed", true);
      node
        .filter(
          (n) =>
            n === d ||
            links.some(
              (l) =>
                ((l.source.id || l.source) === d.id &&
                  (l.target.id || l.target) === n.id) ||
                ((l.target.id || l.target) === d.id &&
                  (l.source.id || l.source) === n.id),
            ),
        )
        .classed("dimmed", false)
        .classed("highlight", true);
      link
        .filter(
          (l) =>
            (l.source.id || l.source) === d.id ||
            (l.target.id || l.target) === d.id,
        )
        .classed("dimmed", false)
        .classed("highlight", true);

      if (isGreen(d)) {
        node.each(function (n) {
          if (n !== d && isGreen(n))
            d3.select(this).style("opacity", GREEN_FADE_OPACITY);
        });
      }

      showArrowheadsForNeighbors(d.id);
    }

    function mouseout(event, d) {
      d3.select(this).style("cursor", "auto");
      labels.filter((l) => l === d).attr("display", "none");

      node
        .filter((n) => n !== currentlySelectedNode)
        .classed("dimmed", false)
        .classed("highlight", false);
      link
        .filter(
          (l) =>
            (l.source.id || l.source) !== currentlySelectedNode?.id &&
            (l.target.id || l.target) !== currentlySelectedNode?.id,
        )
        .classed("dimmed", false)
        .classed("highlight", false);

      node.filter((n) => isGreen(n)).style("opacity", null);

      restoreAllArrowheads();
    }

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    function neighborsOf(id) {
      const set = new Set([id]);
      links.forEach((l) => {
        const s = idOf(l.source);
        const t = idOf(l.target);
        if (s === id) set.add(t);
        if (t === id) set.add(s);
      });
      return set;
    }

    function highlightNeighborhood(id) {
      const keep = neighborsOf(id);
      node.classed("dimmed", (d) => !keep.has(d.id));
      link.classed(
        "dimmed",
        (l) => !(keep.has(idOf(l.source)) && keep.has(idOf(l.target))),
      );
      node.classed("highlight", (d) => keep.has(d.id));
      link.classed(
        "highlight",
        (l) => keep.has(idOf(l.source)) && keep.has(idOf(l.target)),
      );
    }

    function clearHighlight() {
      node.classed("dimmed", false).classed("highlight", false);
      link.classed("dimmed", false).classed("highlight", false);
      restoreAllArrowheads();
    }

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") clearHighlight();
      if (e.key === "1") sizeMode = "degree";
      if (e.key === "2") sizeMode = "words";
      if (e.key === "3") sizeMode = "speed";
      if (e.key === "4") sizeMode = "ttfb";
      if (e.key === "5") sizeMode = "hub";
      if ("12345".includes(e.key)) {
        node.attr("r", (d) => sizeModes[sizeMode](d));
        simulation.alpha(0.2).restart();
        updateActiveLegend();
      }
    });

    const legendModes = [
      { key: "1", mode: "degree", label: "Degree" },
      { key: "2", mode: "words", label: "Words" },
      { key: "3", mode: "speed", label: "Response" },
      { key: "4", mode: "ttfb", label: "TTFB" },
      { key: "5", mode: "hub", label: "Hubs" },
    ];

    const legend = d3
      .select("#graph-view")
      .append("div")
      .attr("id", "hotkey-legend")
      .attr("class", "legend-box");

    legend.append("h4").text("Graph Controls");

    const modeGroup = legend
      .append("div")
      .attr("class", "mode-group")
      .attr("role", "group")
      .attr("aria-label", "Size nodes by");

    legendModes.forEach((m) => {
      const btn = modeGroup
        .append("button")
        .attr("type", "button")
        .attr("class", "mode-btn")
        .attr("data-mode", m.mode)
        .attr(
          "title",
          `Press ${m.key} to size nodes by ${m.label.toLowerCase()}`,
        )
        .on("click", function () {
          sizeMode = this.getAttribute("data-mode");
          node.attr("r", (d) => sizeModes[sizeMode](d));
          simulation.alpha(0.2).restart();
          updateActiveLegend();
        });
      btn.append("span").attr("class", "key-hint").text(m.key);
      btn.append("span").attr("class", "mode-label").text(m.label);
    });

    const shortcuts = legend.append("div").attr("class", "legend-shortcuts");
    shortcuts
      .append("span")
      .html(`<span class="key-hint">Click</span> Route home`);
    shortcuts
      .append("span")
      .html(`<span class="key-hint">Esc</span> Clear highlight`);

    function updateActiveLegend() {
      modeGroup.selectAll(".mode-btn").classed("active", function () {
        return this.getAttribute("data-mode") === sizeMode;
      });
    }

    updateActiveLegend();
  })
  .catch(function (error) {
    console.error("Error loading or processing links.json:", error);
    d3.select("#graph-view")
      .append("p")
      .text(
        "Could not load or process crawl data. Check the console for errors.",
      );
  });

function calculateScorecard(site_structure) {
  const pageValues = Object.values(site_structure);
  const totalPages = pageValues.length;

  if (totalPages === 0) {
    return {
      totalPages: 0,
      word_count: 0,
      readability_score: 0,
      sentiment: 0,
      image_count: 0,
      script_count: 0,
      stylesheet_count: 0,
      heading_count: 0,
      paragraph_count: 0,
      response_time: 0,
      ttfb: 0,
      internal_links: 0,
      external_links: 0,
      keyword_density: {},
      status_codes: {},
      viewport_meta_count: 0,
      semantic_elements: {
        main: 0,
        nav: 0,
        article: 0,
        section: 0,
        header: 0,
        footer: 0,
        aside: 0,
      },
      heading_issues: 0,
      unlabeled_inputs: 0,
      images_without_alt: 0,

      pages_with_csp: 0,
      pages_with_hsts: 0,
      pages_with_canonical: 0,
      jsonld_total_blocks: 0,
      hreflang_pairs_total: 0,
      pages_with_mixed_content: 0,
      mixed_content_resources_total: 0,
      cookies_unique_names: new Set(),
      redirect_hops_total: 0,
      generic_link_texts_total: 0,
      aria_roles: {},
      landmarks_total: {
        main: 0,
        nav: 0,
        header: 0,
        footer: 0,
        aside: 0,
        section: 0,
        article: 0,
      },
      lazy_images_total: 0,
      preloads: { preload: 0, prefetch: 0, preconnect: 0 },
      orphans_count: 0,
      avg_depth: 0,
      max_depth: 0,

      average_word_count: 0,
      average_readability_score: 0,
      average_sentiment: 0,
      average_response_time: 0,
      average_ttfb: 0,
    };
  }

  const ariaRolesAgg = {};
  const landmarksAgg = {
    main: 0,
    nav: 0,
    header: 0,
    footer: 0,
    aside: 0,
    section: 0,
    article: 0,
  };
  const cookiesSet = new Set();

  const aggregated = pageValues.reduce(
    (acc, page) => {
      if (typeof page !== "object" || page === null) return acc;

      acc.word_count += page.word_count || 0;
      acc.readability_score += page.readability_score || 0;
      acc.sentiment += page.sentiment || 0;
      acc.image_count += page.image_count || 0;
      acc.script_count += page.script_count || 0;
      acc.stylesheet_count += page.stylesheet_count || 0;
      acc.heading_count += page.heading_count || 0;
      acc.paragraph_count += page.paragraph_count || 0;
      acc.response_time += page.response_time || 0;
      acc.ttfb += page.ttfb || 0;

      acc.internal_links += Array.isArray(page.internal_links)
        ? page.internal_links.length
        : 0;
      acc.external_links += Array.isArray(page.external_links)
        ? page.external_links.length
        : 0;

      if (page.keyword_density && typeof page.keyword_density === "object") {
        for (const [keyword, density] of Object.entries(page.keyword_density)) {
          acc.keyword_density[keyword] =
            (acc.keyword_density[keyword] || 0) + density;
        }
      }

      if (page.status_code) {
        acc.status_codes[page.status_code] =
          (acc.status_codes[page.status_code] || 0) + 1;
      }

      acc.viewport_meta_count += page.has_viewport_meta ? 1 : 0;

      if (
        page.semantic_elements &&
        typeof page.semantic_elements === "object"
      ) {
        for (const [tag, present] of Object.entries(page.semantic_elements)) {
          if (present) acc.semantic_elements[tag]++;
        }
      }

      acc.heading_issues += Array.isArray(page.heading_issues)
        ? page.heading_issues.length
        : 0;
      acc.unlabeled_inputs += Array.isArray(page.unlabeled_inputs)
        ? page.unlabeled_inputs.length
        : 0;
      acc.images_without_alt += Array.isArray(page.images_without_alt)
        ? page.images_without_alt.length
        : 0;

      const sec = page.security || {};
      if (sec.content_security_policy) acc.pages_with_csp++;
      if (sec.strict_transport_security) acc.pages_with_hsts++;

      const st = page.structured || {};
      if (st.canonical) acc.pages_with_canonical++;
      if (Array.isArray(st.jsonld)) acc.jsonld_total_blocks += st.jsonld.length;
      if (Array.isArray(st.hreflang))
        acc.hreflang_pairs_total += st.hreflang.length;

      if (Array.isArray(page.mixed_content) && page.mixed_content.length) {
        acc.pages_with_mixed_content++;
        acc.mixed_content_resources_total += page.mixed_content.length;
      }

      const del = page.http_delivery || {};
      if (Array.isArray(del.set_cookies)) {
        del.set_cookies.forEach((n) => cookiesSet.add(n));
      }
      if (Array.isArray(del.redirect_chain)) {
        acc.redirect_hops_total += Math.max(0, del.redirect_chain.length - 1);
      }

      if (page.a11y_extras?.generic_link_texts) {
        acc.generic_link_texts_total +=
          page.a11y_extras.generic_link_texts.length;
      }
      if (page.a11y_extras?.aria_roles) {
        for (const [role, count] of Object.entries(
          page.a11y_extras.aria_roles,
        )) {
          ariaRolesAgg[role] = (ariaRolesAgg[role] || 0) + count;
        }
      }
      if (page.a11y_extras?.landmarks_count) {
        for (const [tag, count] of Object.entries(
          page.a11y_extras.landmarks_count,
        )) {
          if (landmarksAgg[tag] != null) landmarksAgg[tag] += count || 0;
        }
      }

      if (page.media_hints?.lazy_images_count)
        acc.lazy_images_total += page.media_hints.lazy_images_count;

      if (Array.isArray(page.link_rel)) {
        const { preload, prefetch, preconnect } = countPreloadKinds(
          page.link_rel,
        );
        acc.preloads.preload += preload;
        acc.preloads.prefetch += prefetch;
        acc.preloads.preconnect += preconnect;
      }

      if (page.is_orphan) acc.orphans_count++;
      if (Number.isFinite(page.depth)) {
        acc.avg_depth += page.depth;
        acc.max_depth = Math.max(acc.max_depth, page.depth);
      }

      return acc;
    },
    {
      word_count: 0,
      readability_score: 0,
      sentiment: 0,
      image_count: 0,
      script_count: 0,
      stylesheet_count: 0,
      heading_count: 0,
      paragraph_count: 0,
      response_time: 0,
      ttfb: 0,
      internal_links: 0,
      external_links: 0,
      keyword_density: {},
      status_codes: {},
      viewport_meta_count: 0,
      semantic_elements: {
        main: 0,
        nav: 0,
        article: 0,
        section: 0,
        header: 0,
        footer: 0,
        aside: 0,
      },
      heading_issues: 0,
      unlabeled_inputs: 0,
      images_without_alt: 0,

      pages_with_csp: 0,
      pages_with_hsts: 0,
      pages_with_canonical: 0,
      jsonld_total_blocks: 0,
      hreflang_pairs_total: 0,
      pages_with_mixed_content: 0,
      mixed_content_resources_total: 0,
      cookies_unique_names: null,
      redirect_hops_total: 0,
      generic_link_texts_total: 0,
      aria_roles: null,
      landmarks_total: null,
      lazy_images_total: 0,
      preloads: { preload: 0, prefetch: 0, preconnect: 0 },
      orphans_count: 0,
      avg_depth: 0,
      max_depth: 0,
    },
  );

  aggregated.cookies_unique_names = cookiesSet;
  aggregated.aria_roles = ariaRolesAgg;
  aggregated.landmarks_total = landmarksAgg;

  const total = totalPages > 0 ? totalPages : 1;
  aggregated.average_word_count = aggregated.word_count / total;
  aggregated.average_readability_score = aggregated.readability_score / total;
  aggregated.average_sentiment = aggregated.sentiment / total;
  aggregated.average_response_time = aggregated.response_time / total;
  aggregated.average_ttfb = aggregated.ttfb / total;
  aggregated.avg_depth = aggregated.avg_depth / total;

  return {
    totalPages,
    ...aggregated,
  };
}

function scSection(root, title) {
  const s = root.append("div").attr("class", "sc-section");
  s.append("div").attr("class", "sc-section-title").text(title);
  return s;
}

function scTile(grid, label, value) {
  const tile = grid.append("div").attr("class", "sc-tile");
  tile.append("div").attr("class", "sc-tile-value").text(value);
  tile.append("div").attr("class", "sc-tile-label").text(label);
}

function scChip(parent, text, cls) {
  parent
    .append("span")
    .attr("class", `sc-chip${cls ? " " + cls : ""}`)
    .text(text);
}

function scBoolChip(parent, label, ok) {
  scChip(
    parent,
    `${ok ? "\u2713" : "\u2715"} ${label}`,
    ok ? "sc-chip-good" : "sc-chip-bad",
  );
}

function scCountChip(parent, label, count) {
  scChip(
    parent,
    `${count > 0 ? "\u2715" : "\u2713"} ${label} \u00b7 ${count}`,
    count > 0 ? "sc-chip-bad" : "sc-chip-good",
  );
}

function scKv(parent, key, value) {
  const row = parent.append("div").attr("class", "sc-kv");
  row.append("span").attr("class", "sc-kv-key").text(key);
  row.append("span").attr("class", "sc-kv-value").text(value);
}

function scBar(parent, label, value, max, valueText) {
  const row = parent.append("div").attr("class", "sc-meter");
  row.append("span").attr("class", "sc-meter-label").text(label);
  row
    .append("span")
    .attr("class", "sc-meter-track")
    .append("span")
    .attr("class", "sc-meter-fill")
    .style(
      "width",
      max > 0 && value > 0
        ? `${Math.max(3, Math.round((value / max) * 100))}%`
        : "0",
    )
    .style("background-color", "#0077cc");
  row
    .append("span")
    .attr("class", "sc-meter-value")
    .text(valueText ?? String(value));
}

function scSplitBar(parent, aLabel, aValue, bLabel, bValue) {
  const totalValue = aValue + bValue;
  if (totalValue === 0) return;
  const aPct = (aValue / totalValue) * 100;
  const split = parent.append("div").attr("class", "sc-split");
  split
    .append("span")
    .style("width", `${aPct}%`)
    .style("background-color", "#0077cc");
  split
    .append("span")
    .style("width", `${100 - aPct}%`)
    .style("background-color", "#eda100");
  const legend = parent.append("div").attr("class", "sc-split-legend");
  [
    [aLabel, aValue, "#0077cc"],
    [bLabel, bValue, "#eda100"],
  ].forEach(([label, value, color]) => {
    const item = legend.append("span");
    item.append("i").attr("class", "sc-dot").style("background-color", color);
    item.append("span").text(`${label} ${value.toLocaleString()}`);
  });
}

function showNodeEmptyState() {
  const root = d3.select("#tooltip-scorecard-list").html("");
  root
    .append("div")
    .attr("class", "sc-empty")
    .text("Hover over a node in the graph to inspect that page.");
}

function renderNodeScorecard(d, connections) {
  const root = d3.select("#tooltip-scorecard-list").html("");

  const head = root.append("div").attr("class", "sc-node-head");
  let pathLabel = d.id;
  try {
    pathLabel = new URL(d.id).pathname || "/";
  } catch (e) {}
  head
    .append("div")
    .attr("class", "sc-node-title")
    .text(d.title || pathLabel);
  head
    .append("a")
    .attr("class", "sc-node-url")
    .attr("href", d.id)
    .attr("target", "_blank")
    .attr("rel", "noopener")
    .text(d.id);

  const badges = head.append("div").attr("class", "sc-chips");
  const bucket = statusBucket(d.status_code);
  const bucketCls = {
    "2xx": "sc-chip-good",
    "3xx": "sc-chip-warn",
    "4xx": "sc-chip-bad",
    "5xx": "sc-chip-bad",
    other: "",
  }[bucket];
  scChip(badges, `HTTP ${d.status_code || "?"}`, bucketCls);
  scChip(badges, `depth ${numOrNA(d.depth)}`, "");
  if (d.is_orphan) scChip(badges, "orphan", "sc-chip-bad");
  if (d.language_match === true) {
    scChip(
      badges,
      `lang ${d.lang_attribute || d.detected_language} \u2713`,
      "sc-chip-good",
    );
  } else if (d.language_match === false) {
    scChip(
      badges,
      `lang ${d.lang_attribute || "?"} vs ${d.detected_language}`,
      "sc-chip-bad",
    );
  }

  const grid = root.append("div").attr("class", "sc-kpi-grid");
  scTile(
    grid,
    "TTFB",
    typeof d.ttfb === "number" ? `${d.ttfb.toFixed(3)}s` : "N/A",
  );
  scTile(
    grid,
    "Response",
    typeof d.response_time === "number"
      ? `${d.response_time.toFixed(2)}s`
      : "N/A",
  );
  scTile(grid, "Words", (d.word_count || 0).toLocaleString());
  scTile(grid, "Read time", `${d.read_time_minutes || 0}m`);
  scTile(
    grid,
    "Readability",
    typeof d.readability_score === "number"
      ? d.readability_score.toFixed(1)
      : "N/A",
  );
  scTile(
    grid,
    "Sentiment",
    typeof d.sentiment === "number" ? d.sentiment.toFixed(2) : "N/A",
  );

  const linksSec = scSection(root, "Links");
  scSplitBar(
    linksSec,
    "Internal",
    d.internal_links ? d.internal_links.length : 0,
    "External",
    d.external_links ? d.external_links.length : 0,
  );
  scKv(linksSec, "Connections in graph", String(connections));
  scKv(
    linksSec,
    "In / out degree",
    `${d.in_degree || 0} / ${d.out_degree || 0}`,
  );

  const kwEntries = Object.entries(d.keyword_density || {})
    .filter(([, density]) => density > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (kwEntries.length > 0) {
    const kwSec = scSection(root, "Top keywords");
    const maxDensity = kwEntries[0][1];
    kwEntries.forEach(([word, density]) => {
      scBar(kwSec, word, density, maxDensity, `${(density * 100).toFixed(2)}%`);
    });
  }

  const seo = scSection(root, "SEO and sharing");
  const seoChips = seo.append("div").attr("class", "sc-chips");
  scBoolChip(seoChips, "Meta description", !!d.meta_description);
  scBoolChip(seoChips, "Canonical", !!d.structured?.canonical);
  scBoolChip(
    seoChips,
    "Open Graph",
    !!(d.structured?.opengraph && Object.keys(d.structured.opengraph).length),
  );
  scBoolChip(
    seoChips,
    "Twitter card",
    !!(d.structured?.twitter && Object.keys(d.structured.twitter).length),
  );
  const jsonldCount = Array.isArray(d.structured?.jsonld)
    ? d.structured.jsonld.length
    : 0;
  scChip(
    seo.select(".sc-chips"),
    `JSON-LD \u00b7 ${jsonldCount}`,
    jsonldCount ? "sc-chip-good" : "",
  );
  const hreflangCount = Array.isArray(d.structured?.hreflang)
    ? d.structured.hreflang.length
    : 0;
  scChip(seoChips, `hreflang \u00b7 ${hreflangCount}`, "");
  if (d.meta_description) {
    seo
      .append("div")
      .attr("class", "sc-note")
      .text(
        d.meta_description.length > 180
          ? d.meta_description.slice(0, 179) + "\u2026"
          : d.meta_description,
      );
  }
  if (Array.isArray(d.h1_tags) && d.h1_tags.length > 0) {
    seo
      .append("div")
      .attr("class", "sc-note")
      .text(`H1: ${d.h1_tags.join(" \u00b7 ")}`);
  }

  const health = scSection(root, "Health and accessibility");
  const healthChips = health.append("div").attr("class", "sc-chips");
  scBoolChip(healthChips, "Viewport", !!d.has_viewport_meta);
  scBoolChip(healthChips, "CSP", !!d.security?.content_security_policy);
  scBoolChip(healthChips, "HSTS", !!d.security?.strict_transport_security);
  scBoolChip(healthChips, "X-Frame", !!d.security?.x_frame_options);
  scBoolChip(
    healthChips,
    "X-Content-Type",
    !!d.security?.x_content_type_options,
  );
  scBoolChip(healthChips, "Referrer policy", !!d.security?.referrer_policy);
  scCountChip(healthChips, "Mixed content", d.mixed_content?.length || 0);
  scCountChip(healthChips, "Heading issues", d.heading_issues?.length || 0);
  scCountChip(healthChips, "Unlabeled inputs", d.unlabeled_inputs?.length || 0);
  scCountChip(healthChips, "Images w/o alt", d.images_without_alt?.length || 0);
  scCountChip(
    healthChips,
    "Generic link text",
    d.a11y_extras?.generic_link_texts?.length || 0,
  );

  const struct = scSection(root, "Structure");
  const semChips = struct.append("div").attr("class", "sc-chips");
  Object.entries(d.semantic_elements || {}).forEach(([tag, present]) => {
    scChip(semChips, `<${tag}>`, present ? "" : "sc-chip-zero");
  });
  const landmarks = d.a11y_extras?.landmarks_count;
  if (landmarks) {
    scKv(
      struct,
      "Landmarks",
      Object.entries(landmarks)
        .filter(([, count]) => count > 0)
        .map(([tag, count]) => `${tag} ${count}`)
        .join(", ") || "none",
    );
  }
  scKv(struct, "Heading count", String(d.heading_count || 0));
  scKv(struct, "Paragraphs", String(d.paragraph_count || 0));

  const del = scSection(root, "Assets and delivery");
  const lazyCount = d.media_hints?.lazy_images_count || 0;
  scKv(del, "Images", `${d.image_count || 0} (${lazyCount} lazy)`);
  const largest = d.media_hints?.largest_image;
  if (largest && largest.src) {
    scKv(del, "Largest image", `${largest.width}\u00d7${largest.height}`);
  }
  scKv(
    del,
    "Scripts / stylesheets",
    `${d.script_count || 0} / ${d.stylesheet_count || 0}`,
  );
  const preloadCounts = countPreloadKinds(d.link_rel);
  scKv(
    del,
    "Preload / prefetch / preconnect",
    `${preloadCounts.preload} / ${preloadCounts.prefetch} / ${preloadCounts.preconnect}`,
  );
  scKv(del, "Server", d.http_delivery?.server || "N/A");
  const cache = d.http_delivery?.cache_control || "N/A";
  scKv(
    del,
    "Cache-Control",
    cache.length > 34 ? cache.slice(0, 33) + "\u2026" : cache,
  );
  scKv(
    del,
    "Cookies set",
    String(
      Array.isArray(d.http_delivery?.set_cookies)
        ? d.http_delivery.set_cookies.length
        : 0,
    ),
  );
  scKv(
    del,
    "Redirect hops",
    String(
      Array.isArray(d.http_delivery?.redirect_chain)
        ? Math.max(0, d.http_delivery.redirect_chain.length - 1)
        : 0,
    ),
  );
}

function renderClaudeMarkdown(md) {
  if (window.marked && window.DOMPurify) {
    return DOMPurify.sanitize(marked.parse(String(md)));
  }
  return renderMarkdown(md);
}

function displayScorecard(scorecard) {
  const root = d3.select("#scorecard-list").html("");
  const total = scorecard.totalPages || 1;

  function section(title) {
    const s = root.append("div").attr("class", "sc-section");
    s.append("div").attr("class", "sc-section-title").text(title);
    return s;
  }

  function meterRow(parent, label, count, denom) {
    const frac = denom > 0 ? count / denom : 0;
    const row = parent.append("div").attr("class", "sc-meter");
    row.append("span").attr("class", "sc-meter-label").text(label);
    row
      .append("span")
      .attr("class", "sc-meter-track")
      .append("span")
      .attr("class", "sc-meter-fill")
      .style(
        "width",
        frac === 0 ? "0" : `${Math.max(3, Math.round(frac * 100))}%`,
      )
      .style(
        "background-color",
        frac >= 0.9 ? "#0ca30c" : frac >= 0.5 ? "#eda100" : "#d03b3b",
      );
    row
      .append("span")
      .attr("class", "sc-meter-value")
      .text(`${count}/${denom}`);
  }

  function barRow(parent, label, value, max, valueText) {
    const row = parent.append("div").attr("class", "sc-meter");
    row.append("span").attr("class", "sc-meter-label").text(label);
    row
      .append("span")
      .attr("class", "sc-meter-track")
      .append("span")
      .attr("class", "sc-meter-fill")
      .style(
        "width",
        max > 0 && value > 0
          ? `${Math.max(3, Math.round((value / max) * 100))}%`
          : "0",
      )
      .style("background-color", "#0077cc");
    row
      .append("span")
      .attr("class", "sc-meter-value")
      .text(valueText ?? String(value));
  }

  function chip(parent, text, cls) {
    parent
      .append("span")
      .attr("class", `sc-chip${cls ? " " + cls : ""}`)
      .text(text);
  }

  function kvRow(parent, key, value) {
    const row = parent.append("div").attr("class", "sc-kv");
    row.append("span").attr("class", "sc-kv-key").text(key);
    row.append("span").attr("class", "sc-kv-value").text(value);
  }

  const kpiGrid = root.append("div").attr("class", "sc-kpi-grid");
  [
    ["Pages", String(scorecard.totalPages)],
    ["Avg words", Math.round(scorecard.average_word_count).toLocaleString()],
    ["Readability", scorecard.average_readability_score.toFixed(1)],
    ["Avg TTFB", `${scorecard.average_ttfb.toFixed(3)}s`],
    ["Avg response", `${scorecard.average_response_time.toFixed(2)}s`],
    ["Sentiment", scorecard.average_sentiment.toFixed(2)],
  ].forEach(([label, value]) => {
    const tile = kpiGrid.append("div").attr("class", "sc-tile");
    tile.append("div").attr("class", "sc-tile-value").text(value);
    tile.append("div").attr("class", "sc-tile-label").text(label);
  });

  const health = section("Site health");
  meterRow(health, "Viewport meta", scorecard.viewport_meta_count, total);
  meterRow(health, "HSTS", scorecard.pages_with_hsts, total);
  meterRow(health, "Canonical", scorecard.pages_with_canonical, total);
  meterRow(health, "CSP", scorecard.pages_with_csp, total);
  meterRow(
    health,
    "No mixed content",
    total - scorecard.pages_with_mixed_content,
    total,
  );

  const issues = section("Issues found");
  const issueChips = issues.append("div").attr("class", "sc-chips");
  [
    ["Heading issues", scorecard.heading_issues],
    ["Images w/o alt", scorecard.images_without_alt],
    ["Unlabeled inputs", scorecard.unlabeled_inputs],
    ["Generic link text", scorecard.generic_link_texts_total],
    ["Redirect hops", scorecard.redirect_hops_total],
  ].forEach(([label, count]) => {
    chip(
      issueChips,
      `${count > 0 ? "✕" : "✓"} ${label} · ${count}`,
      count > 0 ? "sc-chip-bad" : "sc-chip-good",
    );
  });

  const linksSec = section("Links");
  const totalLinks = scorecard.internal_links + scorecard.external_links;
  if (totalLinks > 0) {
    const intPct = (scorecard.internal_links / totalLinks) * 100;
    const split = linksSec.append("div").attr("class", "sc-split");
    split
      .append("span")
      .style("width", `${intPct}%`)
      .style("background-color", "#0077cc");
    split
      .append("span")
      .style("width", `${100 - intPct}%`)
      .style("background-color", "#eda100");
    const legend = linksSec.append("div").attr("class", "sc-split-legend");
    const intItem = legend.append("span");
    intItem
      .append("i")
      .attr("class", "sc-dot")
      .style("background-color", "#0077cc");
    intItem
      .append("span")
      .text(`Internal ${scorecard.internal_links.toLocaleString()}`);
    const extItem = legend.append("span");
    extItem
      .append("i")
      .attr("class", "sc-dot")
      .style("background-color", "#eda100");
    extItem
      .append("span")
      .text(`External ${scorecard.external_links.toLocaleString()}`);
  }
  kvRow(linksSec, "Orphan pages", String(scorecard.orphans_count));
  kvRow(
    linksSec,
    "Crawl depth",
    `avg ${scorecard.avg_depth.toFixed(1)} · max ${scorecard.max_depth}`,
  );

  const assets = section("Page assets");
  const preloadTotal =
    scorecard.preloads.preload +
    scorecard.preloads.prefetch +
    scorecard.preloads.preconnect;
  const assetRows = [
    ["Paragraphs", scorecard.paragraph_count],
    ["Scripts", scorecard.script_count],
    ["Headings", scorecard.heading_count],
    ["Images", scorecard.image_count],
    ["Preload hints", preloadTotal],
    ["Stylesheets", scorecard.stylesheet_count],
  ].sort((a, b) => b[1] - a[1]);
  const maxAsset = assetRows[0][1];
  assetRows.forEach(([label, value]) => {
    barRow(assets, label, value, maxAsset, value.toLocaleString());
  });

  const kw = section("Top keywords");
  const kwEntries = Object.entries(scorecard.keyword_density)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  if (kwEntries.length > 0) {
    const maxDensity = kwEntries[0][1];
    kwEntries.forEach(([word, densitySum]) => {
      barRow(
        kw,
        word,
        densitySum,
        maxDensity,
        `${((densitySum / total) * 100).toFixed(2)}%`,
      );
    });
  } else {
    kw.append("div").attr("class", "sc-kv").text("No keyword data");
  }

  const st = section("HTTP status");
  const statusChips = st.append("div").attr("class", "sc-chips");
  const bucketClass = {
    "2xx": "sc-chip-good",
    "3xx": "sc-chip-warn",
    "4xx": "sc-chip-bad",
    "5xx": "sc-chip-bad",
    other: "",
  };
  const statusEntries = Object.entries(scorecard.status_codes).sort(
    (a, b) => +a[0] - +b[0],
  );
  if (statusEntries.length > 0) {
    statusEntries.forEach(([code, count]) => {
      chip(
        statusChips,
        `${code} · ${count} page${count === 1 ? "" : "s"}`,
        bucketClass[statusBucket(code)],
      );
    });
  } else {
    chip(statusChips, "No status data", "");
  }

  const struct = section("Structure");
  const semChips = struct.append("div").attr("class", "sc-chips");
  Object.entries(scorecard.semantic_elements).forEach(([tag, count]) => {
    chip(semChips, `<${tag}> ${count}`, count > 0 ? "" : "sc-chip-zero");
  });
  kvRow(struct, "JSON-LD blocks", String(scorecard.jsonld_total_blocks));
  kvRow(struct, "Hreflang pairs", String(scorecard.hreflang_pairs_total));
  kvRow(
    struct,
    "Unique cookie names",
    String(Array.from(scorecard.cookies_unique_names || []).length),
  );
  kvRow(struct, "Lazy images", String(scorecard.lazy_images_total));
  kvRow(
    struct,
    "Preload / prefetch / preconnect",
    `${scorecard.preloads.preload} / ${scorecard.preloads.prefetch} / ${scorecard.preloads.preconnect}`,
  );
  const ariaEntries = Object.entries(scorecard.aria_roles || {}).sort(
    (a, b) => b[1] - a[1],
  );
  kvRow(
    struct,
    "ARIA roles",
    ariaEntries.length > 0
      ? ariaEntries
          .slice(0, 3)
          .map(([role, count]) => `${role} ${count}`)
          .join(", ") +
          (ariaEntries.length > 3 ? ` +${ariaEntries.length - 3} more` : "")
      : "none",
  );
}

d3.json("links.json")
  .then((loaded_site_structure) => {
    if (
      loaded_site_structure &&
      Object.keys(loaded_site_structure).length > 0
    ) {
      const scorecard = calculateScorecard(loaded_site_structure);
      displayScorecard(scorecard);
    } else {
      console.warn("No data for scorecard in the d3.json call.");
      const list = d3.select("#scorecard-list").html("");
      list.append("div").text("No scorecard data loaded.");
    }
  })
  .catch(function (error) {
    console.error("Error loading links.json for scorecard:", error);
    const list = d3.select("#scorecard-list").html("");
    list
      .append("div")
      .html(
        `<strong>Error loading scorecard data:</strong> ${escapeHtml(
          error.message,
        )}`,
      );
  });

showNodeEmptyState();

document.addEventListener("DOMContentLoaded", () => {
  const analyzeButton = document.getElementById("analyze-node-button");
  const analysisOutput = document.getElementById("claude-analysis-output");

  if (analyzeButton && analysisOutput) {
    analyzeButton.addEventListener("click", () => {
      if (!currentlySelectedNode || !currentlySelectedNode.id) {
        analysisOutput.textContent =
          "Please hover over a node to select it before running analysis.";
        return;
      }

      analysisOutput.textContent = "Running analysis...";

      fetch("http://localhost:5000/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: currentlySelectedNode.id }),
      })
        .then(async (response) => {
          const responseText = await response.text();
          if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${responseText}`);
          }
          try {
            return JSON.parse(responseText);
          } catch (e) {
            throw new Error("Invalid JSON response: " + responseText);
          }
        })
        .then((data) => {
          if (data.analysis) {
            analysisOutput.innerHTML = renderClaudeMarkdown(data.analysis);
          } else {
            analysisOutput.textContent = `Error: ${
              data.error || "Unexpected response format."
            }`;
          }
        })
        .catch((err) => {
          analysisOutput.textContent = `Request failed: ${err.message}`;
        });
    });
  } else {
    if (!analyzeButton) console.error("Analyze button not found.");
    if (!analysisOutput)
      console.error("Claude analysis output element not found.");
  }
});

function hasIssues(d) {
  return (
    (d.unlabeled_inputs?.length || 0) > 0 ||
    (d.images_without_alt?.length || 0) > 0 ||
    !d.semantic_elements?.main ||
    (!!d.mixed_content && d.mixed_content.length > 0) ||
    !d.security?.content_security_policy
  );
}

function sectionHasIssues(arr) {
  return arr.some((n) => hasIssues(n));
}

function countPreloadKinds(linkRelArr) {
  const out = { preload: 0, prefetch: 0, preconnect: 0 };
  if (!Array.isArray(linkRelArr)) return out;
  linkRelArr.forEach((e) => {
    const rel = (e.rel || "").toLowerCase();
    if (rel.includes("preload")) out.preload++;
    if (rel.includes("prefetch")) out.prefetch++;
    if (rel.includes("preconnect")) out.preconnect++;
  });
  return out;
}

function fmtSec(v) {
  if (typeof v !== "number" || !isFinite(v)) return "N/A";
  return `${v.toFixed(3)} seconds`;
}

function numOrNA(v) {
  return Number.isFinite(v) ? v : "N/A";
}

function yesNo(v) {
  return v ? "✓" : "✗";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

function splitTableRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSeparator(line) {
  const t = line.trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  const cells = splitTableRow(t);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function tableAlignments(sepLine) {
  return splitTableRow(sepLine).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

function renderTable(headerLine, sepLine, bodyLines) {
  const aligns = tableAlignments(sepLine);
  const headerCells = splitTableRow(headerLine);
  const alignAttr = (i) =>
    aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
  const thead =
    "<thead><tr>" +
    headerCells
      .map((c, i) => `<th${alignAttr(i)}>${renderInlineMarkdown(c)}</th>`)
      .join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    bodyLines
      .map((row) => {
        const cells = splitTableRow(row);
        let tds = "";
        for (let i = 0; i < headerCells.length; i++) {
          tds += `<td${alignAttr(i)}>${renderInlineMarkdown(cells[i] || "")}</td>`;
        }
        return `<tr>${tds}</tr>`;
      })
      .join("") +
    "</tbody>";
  return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`;
}

function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = null;
  let paragraph = [];
  let quote = [];
  let inCodeBlock = false;
  let codeBuffer = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      html.push(
        `<blockquote>${renderInlineMarkdown(quote.join(" "))}</blockquote>`,
      );
      quote = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html.push(
          `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushQuote();
        closeList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushQuote();
      closeList();
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      flushParagraph();
      closeList();
      quote.push(blockquote[1]);
      continue;
    }
    flushQuote();

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushParagraph();
      closeList();
      const body = [];
      let j = i + 2;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (!next || !next.includes("|") || isTableSeparator(lines[j])) break;
        body.push(lines[j]);
        j++;
      }
      html.push(renderTable(line, lines[i + 1], body));
      i = j - 1;
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    const unordered = line.match(/^[-*+]\s+(.*)$/);
    if (ordered || unordered) {
      flushParagraph();
      const wanted = ordered ? "ol" : "ul";
      if (listType !== wanted) {
        closeList();
        html.push(`<${wanted}>`);
        listType = wanted;
      }
      const item = (ordered || unordered)[1];
      html.push(`<li>${renderInlineMarkdown(item)}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (inCodeBlock && codeBuffer.length) {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  flushQuote();
  closeList();
  return html.join("");
}
