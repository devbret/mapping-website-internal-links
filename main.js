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
      d3.select("body").append("p").text("No crawl data available to display.");
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
      .select("body")
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
      .on("click", (event, d) => {
        highlightNeighborhood(d.id);
        currentlySelectedNode = d;
        renderInspector(d);
      })
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
        .attr("fill", (d) => colorByIssue(d))
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
          return;
        }

        const keepSet = new Set(
          nodes.filter((n) => matchesQuery(n, keywords)).map((n) => n.id),
        );

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
          d3.select("#tooltip-scorecard-list").html("");
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
        if (e.key === "/" && document.activeElement !== searchInput) {
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

      const keywordDensityFormatted =
        d.keyword_density && Object.keys(d.keyword_density).length > 0
          ? Object.entries(d.keyword_density)
              .filter(([_, density]) => density > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(
                ([keyword, density]) =>
                  `${keyword}: ${(density * 100).toFixed(2)}%`,
              )
              .join("<br/>")
          : "N/A";

      const hasCSP = !!(d.security && d.security.content_security_policy);
      const hasHSTS = !!(d.security && d.security.strict_transport_security);
      const canonical = d.structured?.canonical || "";
      const jsonldCount = Array.isArray(d.structured?.jsonld)
        ? d.structured.jsonld.length
        : 0;
      const hreflangCount = Array.isArray(d.structured?.hreflang)
        ? d.structured.hreflang.length
        : 0;
      const ogPresent =
        d.structured && d.structured.opengraph
          ? Object.keys(d.structured.opengraph).length > 0
          : false;
      const twPresent =
        d.structured && d.structured.twitter
          ? Object.keys(d.structured.twitter).length > 0
          : false;

      const cookieCount = Array.isArray(d.http_delivery?.set_cookies)
        ? d.http_delivery.set_cookies.length
        : 0;

      const redirectHops = Array.isArray(d.http_delivery?.redirect_chain)
        ? d.http_delivery.redirect_chain.length - 1
        : 0;

      const lazyCount = d.media_hints?.lazy_images_count || 0;
      const largestImg = d.media_hints?.largest_image || {};
      const largestImgText = largestImg.src
        ? `${largestImg.width}×${largestImg.height}`
        : "N/A";

      const mixedCount = Array.isArray(d.mixed_content)
        ? d.mixed_content.length
        : 0;

      const langBadge =
        d.language_match === true
          ? "✓"
          : d.language_match === false
            ? "✗"
            : "—";

      const preloadCounts = countPreloadKinds(d.link_rel);

      const tooltipContent = `
    <li><strong>Title:</strong> ${escapeHtml(d.title || "N/A")}</li>
    <li><strong>URL:</strong> <a href="${d.id}" target="_blank">${d.id}</a></li>
    <li><strong>Connections:</strong> ${connectedLinks}</li>

    <li><strong>Status Code:</strong> ${d.status_code || "N/A"}</li>
    <li><strong>TTFB:</strong> ${fmtSec(d.ttfb)}</li>
    <li><strong>Total Response Time:</strong> ${fmtSec(d.response_time)}</li>
    <li><strong>Depth:</strong> ${numOrNA(d.depth)}</li>
    <li><strong>In/Out Degree:</strong> ${d.in_degree || 0} / ${
      d.out_degree || 0
    } ${d.is_orphan ? "(orphan)" : ""}</li>

    <li><strong>Meta Description:</strong> ${escapeHtml(
      d.meta_description || "N/A",
    )}</li>
    <li><strong>H1 Tags:</strong> ${
      d.h1_tags && d.h1_tags.length > 0
        ? d.h1_tags.map(escapeHtml).join(", ")
        : "None"
    }</li>
    <li><strong>Word Count:</strong> ${d.word_count} (≈${
      d.read_time_minutes
    } min read)</li>
    <li><strong>Unigram Density:</strong><br/>${keywordDensityFormatted}</li>
    <li><strong>Readability Score:</strong> ${
      typeof d.readability_score === "number"
        ? d.readability_score.toFixed(2)
        : "N/A"
    }</li>
    <li><strong>Sentiment:</strong> ${
      typeof d.sentiment === "number" ? d.sentiment.toFixed(2) : "N/A"
    }</li>

    <li><strong>Images:</strong> ${
      d.image_count
    } (lazy: ${lazyCount}, largest: ${largestImgText})</li>
    <li><strong>Scripts / Stylesheets:</strong> ${d.script_count} / ${
      d.stylesheet_count
    }</li>
    <li><strong>Preload | Prefetch | Preconnect:</strong> ${
      preloadCounts.preload
    } | ${preloadCounts.prefetch} | ${preloadCounts.preconnect}</li>
    <li><strong>Has Viewport Meta:</strong> ${
      d.has_viewport_meta ? "Yes" : "No"
    }</li>

    <li><strong>Semantic Elements:</strong><br/>${
      d.semantic_elements && Object.keys(d.semantic_elements).length > 0
        ? Object.entries(d.semantic_elements)
            .map(([tag, present]) => `${tag}: ${present ? "✔️" : "❌"}`)
            .join("<br/>")
        : "N/A"
    }</li>
    <li><strong>Landmarks Count:</strong><br/>${
      d.a11y_extras?.landmarks_count
        ? Object.entries(d.a11y_extras.landmarks_count)
            .map(([k, v]) => `${k}: ${v}`)
            .join("<br/>")
        : "N/A"
    }</li>
    <li><strong>Unlabeled Inputs:</strong> ${
      d.unlabeled_inputs?.length ? d.unlabeled_inputs.join(", ") : "None"
    }</li>
    <li><strong>Images Without Alt:</strong> ${
      d.images_without_alt?.length || 0
    }</li>
    <li><strong>Generic Link Texts:</strong> ${
      d.a11y_extras?.generic_link_texts?.length
        ? d.a11y_extras.generic_link_texts.length
        : 0
    }</li>
    <li><strong>Heading Structure Issues:</strong> ${
      d.heading_issues && d.heading_issues.length > 0
        ? d.heading_issues.map((pair) => `${pair[0]} → ${pair[1]}`).join(", ")
        : "None"
    }</li>

    <li><strong>Security Headers:</strong> CSP ${hasCSP ? "✓" : "✗"} | HSTS ${
      hasHSTS ? "✓" : "✗"
    } | XFO ${yesNo(d.security?.x_frame_options)} | XCTO ${yesNo(
      d.security?.x_content_type_options,
    )} | Referrer ${yesNo(d.security?.referrer_policy)}</li>
    <li><strong>Mixed Content:</strong> ${mixedCount} ${
      mixedCount > 0 ? "(http resources on https)" : ""
    }</li>

    <li><strong>Canonical:</strong> ${
      canonical ? `<a href="${canonical}" target="_blank">present</a>` : "None"
    }</li>
    <li><strong>JSON-LD:</strong> ${jsonldCount} | <strong>OG:</strong> ${
      ogPresent ? "✓" : "✗"
    } | <strong>Twitter:</strong> ${twPresent ? "✓" : "✗"}</li>
    <li><strong>Hreflang:</strong> ${hreflangCount}</li>

    <li><strong>Lang:</strong> html="${escapeHtml(
      d.lang_attribute || "",
    )}" vs. detected="${d.detected_language || "unknown"}" (${langBadge})</li>

    <li><strong>Server:</strong> ${escapeHtml(
      d.http_delivery?.server || "N/A",
    )} | <strong>Cache-Control:</strong> ${escapeHtml(
      d.http_delivery?.cache_control || "N/A",
    )} | <strong>Set-Cookie names:</strong> ${cookieCount} | <strong>Redirect hops:</strong> ${redirectHops}</li>

    <li><strong>Number Of Internal Links:</strong> ${
      d.internal_links ? d.internal_links.length : 0
    } links</li>
    <li><strong>Number Of External Links:</strong> ${
      d.external_links ? d.external_links.length : 0
    } links</li>
  `;

      d3.select("#tooltip-scorecard-list").html(tooltipContent);

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
      }
    });
  })
  .catch(function (error) {
    console.error("Error loading or processing links.json:", error);
    d3.select("body")
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

function displayScorecard(scorecard) {
  const list = d3.select("#scorecard-list").html("");

  list
    .append("li")
    .html(`<strong>Total Pages:</strong> ${scorecard.totalPages}`);
  list
    .append("li")
    .html(
      `<strong>Average Word Count:</strong> ${scorecard.average_word_count.toFixed(
        2,
      )}`,
    );
  list
    .append("li")
    .html(
      `<strong>Average Readability Score:</strong> ${scorecard.average_readability_score.toFixed(
        2,
      )}`,
    );
  list
    .append("li")
    .html(
      `<strong>Average Sentiment:</strong> ${scorecard.average_sentiment.toFixed(
        2,
      )}`,
    );
  list
    .append("li")
    .html(
      `<strong>Average TTFB:</strong> ${scorecard.average_ttfb.toFixed(
        3,
      )} seconds`,
    );
  list
    .append("li")
    .html(
      `<strong>Average Response Time:</strong> ${scorecard.average_response_time.toFixed(
        2,
      )} seconds`,
    );

  list
    .append("li")
    .html(
      `<strong>Total Images:</strong> ${scorecard.image_count} (lazy: ${scorecard.lazy_images_total})`,
    );
  list
    .append("li")
    .html(`<strong>Total Scripts:</strong> ${scorecard.script_count}`);
  list
    .append("li")
    .html(`<strong>Total Stylesheets:</strong> ${scorecard.stylesheet_count}`);
  list
    .append("li")
    .html(
      `<strong>Preload | Prefetch | Preconnect:</strong> ${scorecard.preloads.preload} | ${scorecard.preloads.prefetch} | ${scorecard.preloads.preconnect}`,
    );

  list
    .append("li")
    .html(`<strong>Total Headings:</strong> ${scorecard.heading_count}`);
  list
    .append("li")
    .html(`<strong>Total Paragraphs:</strong> ${scorecard.paragraph_count}`);
  list
    .append("li")
    .html(
      `<strong>Pages with Viewport Meta:</strong> ${scorecard.viewport_meta_count}`,
    );

  list
    .append("li")
    .html(`<strong>Total Internal Links:</strong> ${scorecard.internal_links}`);
  list
    .append("li")
    .html(`<strong>Total External Links:</strong> ${scorecard.external_links}`);
  list
    .append("li")
    .html(`<strong>Orphan Pages:</strong> ${scorecard.orphans_count}`);
  list
    .append("li")
    .html(
      `<strong>Average Depth:</strong> ${scorecard.avg_depth.toFixed(
        2,
      )} (max: ${scorecard.max_depth})`,
    );

  list
    .append("li")
    .html(
      `<strong>Heading Issues Detected:</strong> ${scorecard.heading_issues}`,
    );
  list
    .append("li")
    .html(`<strong>Unlabeled Inputs:</strong> ${scorecard.unlabeled_inputs}`);
  list
    .append("li")
    .html(
      `<strong>Images Without Alt Text:</strong> ${scorecard.images_without_alt}`,
    );
  list
    .append("li")
    .html(
      `<strong>Generic Link Texts:</strong> ${scorecard.generic_link_texts_total}`,
    );

  list
    .append("li")
    .html(`<strong>Pages with CSP:</strong> ${scorecard.pages_with_csp}`);
  list
    .append("li")
    .html(`<strong>Pages with HSTS:</strong> ${scorecard.pages_with_hsts}`);
  list
    .append("li")
    .html(
      `<strong>Pages with Mixed Content:</strong> ${scorecard.pages_with_mixed_content} (resources: ${scorecard.mixed_content_resources_total})`,
    );
  list
    .append("li")
    .html(
      `<strong>Redirect Hops (total):</strong> ${scorecard.redirect_hops_total}`,
    );
  list
    .append("li")
    .html(
      `<strong>Unique Cookie Names Set:</strong> ${
        Array.from(scorecard.cookies_unique_names || []).length
      }`,
    );

  list
    .append("li")
    .html(
      `<strong>Pages with Canonical:</strong> ${scorecard.pages_with_canonical}`,
    );
  list
    .append("li")
    .html(
      `<strong>JSON-LD Blocks (total):</strong> ${scorecard.jsonld_total_blocks}`,
    );
  list
    .append("li")
    .html(
      `<strong>Hreflang Pairs (total):</strong> ${scorecard.hreflang_pairs_total}`,
    );

  const semanticUsed = Object.entries(scorecard.semantic_elements)
    .map(([tag, count]) => `${tag}: ${count}`)
    .join("<br/>");
  list
    .append("li")
    .html(`<strong>Semantic Element Usage:</strong><br/>${semanticUsed}`);

  const landmarksList = Object.entries(scorecard.landmarks_total || {})
    .map(([tag, count]) => `${tag}: ${count}`)
    .join("<br/>");
  list
    .append("li")
    .html(`<strong>Landmarks (total):</strong><br/>${landmarksList || "N/A"}`);

  const ariaList = Object.entries(scorecard.aria_roles || {})
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}: ${count}`)
    .join("<br/>");
  list
    .append("li")
    .html(`<strong>ARIA Roles (sum):</strong><br/>${ariaList || "N/A"}`);

  const keywordList = Object.entries(scorecard.keyword_density)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(
      ([keyword, density]) =>
        `${escapeHtml(keyword)}: (Avg density ${(
          density / scorecard.totalPages
        ).toFixed(4)})`,
    )
    .join("<br/>");
  list
    .append("li")
    .html(
      `<strong>Top Keyword Density (Average):</strong><br/>${
        keywordList || "N/A"
      }`,
    );

  const statusList = Object.entries(scorecard.status_codes)
    .sort((a, b) => +a[0] - +b[0])
    .map(([code, count]) => `${code}: ${count}`)
    .join("<br/>");
  list
    .append("li")
    .html(`<strong>Status Codes:</strong><br/>${statusList || "N/A"}`);
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
      list.append("li").text("No scorecard data loaded.");
    }
  })
  .catch(function (error) {
    console.error("Error loading links.json for scorecard:", error);
    const list = d3.select("#scorecard-list").html("");
    list
      .append("li")
      .html(
        `<strong>Error loading scorecard data:</strong> ${escapeHtml(
          error.message,
        )}`,
      );
  });

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
            analysisOutput.textContent = data.analysis;
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

(function createHotkeyLegend() {
  const modes = [
    { key: "1", label: "Degree" },
    { key: "2", label: "Words" },
    { key: "3", label: "Response" },
    { key: "4", label: "TTFB" },
    { key: "5", label: "Hubs" },
  ];

  const legend = d3
    .select("body")
    .append("div")
    .attr("id", "hotkey-legend")
    .attr("class", "legend-box");

  legend.append("h4").text("Graph Controls");

  const list = legend.append("ul").attr("class", "legend-list");

  modes.forEach((m) => {
    list
      .append("li")
      .attr("data-mode", m.label.toLowerCase())
      .html(`<span class="key-hint">${m.key}</span> ${m.label}`)
      .on("click", function () {
        sizeMode = this.getAttribute("data-mode");
        node.attr("r", (d) => sizeModes[sizeMode](d));
        simulation.alpha(0.2).restart();
        updateActiveLegend();
      });
  });

  list.append("li").html(`<span class="key-hint">Click</span> Route home`);
  list.append("li").html(`<span class="key-hint">Esc</span> Clear highlight`);

  function updateActiveLegend() {
    list.selectAll("li").classed("active", function () {
      return this.getAttribute("data-mode") === sizeMode;
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearHighlight?.();
    if ("12345".includes(e.key)) {
      const map = {
        1: "degree",
        2: "words",
        3: "speed",
        4: "ttfb",
        5: "hubs",
      };
      const mode = map[e.key];
      sizeMode = mode;
      node.attr("r", (d) => sizeModes[sizeMode](d));
      simulation.alpha(0.2).restart();
      updateActiveLegend();
    }
  });

  updateActiveLegend();
})();

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
