/* =========================================================
   轻量 SVG 图表库 —— 零外部依赖，完全离线可用
   支持：折线图 / 柱状图 / 环形图 + 悬浮提示
   ========================================================= */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";

  /* ---------- 自适应宽度 + 尺寸变化重绘 ----------
     原来 viewBox 固定 720 宽，窄屏靠 preserveAspectRatio="none" 横向压扁：
     文字变窄、圆点变椭圆、竖线比横线细。改成按容器实际宽度出图，
     横竖比例都是 1:1，图形不再变形。 */
  const registry = new Map(); // container -> 重绘函数
  let resizeTimer = null;
  function registerChart(container, draw) {
    if (container) registry.set(container, draw);
  }
  function redrawAll() {
    for (const [c, draw] of [...registry]) {
      if (!c.isConnected) { registry.delete(c); continue; }
      // 尺寸变化导致的重绘不重播动画，否则拖动窗口/转屏时图表一直在"重新长出来"
      try { draw(true); } catch (e) { /* 单个图失败不影响其它 */ }
    }
  }
  function scheduleRedraw(delay) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, delay);
  }
  window.addEventListener("resize", () => scheduleRedraw(180));
  window.addEventListener("orientationchange", () => scheduleRedraw(260));

  /* ---------- 生长动画开关 ----------
     尊重 prefers-reduced-motion；图表重绘（筛选/换月/切主题）时重播，尺寸变化时不重播。 */
  const MQ_REDUCE = (typeof window.matchMedia === "function")
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function animOK(noAnim) { return !noAnim && !(MQ_REDUCE && MQ_REDUCE.matches); }

  function fitWidth(container, fallback) {
    const w = Math.round((container && container.clientWidth) || 0);
    return w > 60 ? w : fallback;
  }
  /** 窄屏收窄左右留白，把空间还给绘图区 */
  function padFor(W, base) {
    const narrow = W < 420;
    return Object.assign({ t: 16, r: narrow ? 10 : 16, b: 30, l: narrow ? 38 : 48 }, base || {});
  }
  /** 按绘图区宽度决定 X 轴最多显示几个标签，避免标签挤成一团。
      调用方指定的上限也要再按宽度收一次（否则窄屏仍会排满 10 个标签互相压字）。 */
  function maxLabelsFor(iw, want) {
    const byWidth = Math.max(2, Math.min(12, Math.floor(iw / 46)));
    return want ? Math.min(want, byWidth) : byWidth;
  }
  /** 粗估文本像素宽（全角按 2 个半角算），用来判断相邻标签会不会叠字 */
  function estTextWidth(t) {
    return String(t === null || t === undefined ? "" : t).replace(/[^\x00-\xff]/g, "xx").length * 6.4;
  }

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in (attrs || {})) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "-";
    digits = digits === undefined ? 2 : digits;
    return Number(n).toLocaleString("zh-CN", {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    });
  }

  /* 生成"好看"的刻度：步长落在 1/2/2.5/5 × 10^n 上 */
  function niceScale(min, max, maxTicks) {
    maxTicks = maxTicks || 5;
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max === min) { max = min + 1; }
    const range = max - min;
    const mag = Math.pow(10, Math.floor(Math.log10(range / maxTicks)));
    const candidates = [1, 2, 2.5, 5, 10].map(m => m * mag);

    let step = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (range / c <= maxTicks) { step = c; break; }
    }

    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const count = Math.round((hi - lo) / step);
    const out = [];
    for (let i = 0; i <= count; i++) {
      out.push(Math.round((lo + i * step) * 1e6) / 1e6);
    }
    return { min: lo, max: hi, ticks: out };
  }

  /* ---------- 悬浮提示容器 ---------- */
  function Tip(svg) {
    const g = el("g", { opacity: 0, "pointer-events": "none" }, svg);
    const line = el("line", { stroke: themeVar("--accent", "#5c7cfa"),
                              "stroke-width": 1, "stroke-dasharray": "3 3" }, g);
    const box = el("rect", { rx: 6, ry: 6, height: 24, class: "tip-box" }, g);
    const txt = el("text", { class: "tip-text", "dominant-baseline": "middle" }, g);
    let W = 0, H = 0;
    return {
      show(x, y, text, w, h) {
        W = w; H = h;
        line.setAttribute("x1", x); line.setAttribute("x2", x);
        line.setAttribute("y1", 0); line.setAttribute("y2", h);
        const padX = 8;
        // 按最宽字符估算（中文≈1em），并夹在画布内，避免提示框超出 SVG
        const bw = Math.min(Math.max(text.length * 7.6 + padX * 2, 46), Math.max(46, w - 6));
        let bx = x + 10;
        if (bx + bw > w) bx = x - bw - 10;
        if (bx < 0) bx = 2;
        const by = Math.max(2, Math.min(y - 12, h - 26));
        box.setAttribute("x", bx); box.setAttribute("y", by); box.setAttribute("width", bw);
        txt.setAttribute("x", bx + padX); txt.setAttribute("y", by + 12);
        txt.textContent = text;
        g.setAttribute("opacity", 1);
      },
      hide() { g.setAttribute("opacity", 0); },
      setLineColor(c) { line.setAttribute("stroke", c); }
    };
  }

  /* ================= 折线图 ================= */
  function LineChart(container, opt, noAnim) {
    container.innerHTML = "";
    const animate = animOK(noAnim);
    const labels = opt.labels || [];
    const series = (opt.series || []).filter(s => s && !s.hidden);
    const W = opt.width || fitWidth(container, 720), H = opt.height || 260;
    const pad = padFor(W, opt.pad);
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

    const svg = el("svg", {
      class: "chart", viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "none", style: `height:${H}px`
    }, container);
    svg.style.width = "100%";

    if (!labels.length || !series.length) {
      el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, svg)
        .textContent = opt.emptyText || "暂无数据";
      return svg;
    }

    // 取值域（0 视作断点，不参与极值计算）
    let vmin = Infinity, vmax = -Infinity;
    series.forEach(s => (s.data || []).forEach(v => {
      if (v === null || v === undefined) return;
      if (opt.treatZeroAsGap && Number(v) === 0) return;
      vmin = Math.min(vmin, Number(v)); vmax = Math.max(vmax, Number(v));
    }));
    if (!isFinite(vmin)) { vmin = 0; vmax = 1; }

    // 修复原版 y 轴 bug：默认从 0 开始；传 yMin:"auto" 时按数据范围（如体重图）
    const yAuto = opt.yMin === "auto";
    if (!yAuto) {
      const yMin0 = opt.yMin !== undefined ? opt.yMin : 0;
      if (yMin0 !== null && vmin > yMin0) vmin = yMin0;
    }
    if (opt.yMax !== undefined) vmax = Math.max(vmax, opt.yMax);
    const sc = niceScale(vmin, vmax, opt.ticks || (W < 420 ? 3 : 4));
    vmin = sc.min; vmax = sc.max;

    const n = labels.length;
    const stepX = n > 1 ? iw / (n - 1) : iw;
    const X = i => pad.l + i * stepX;
    const Y = v => pad.t + ih - ((v - vmin) / (vmax - vmin || 1)) * ih;

    // 网格 + Y 轴
    sc.ticks.forEach(v => {
      const y = Y(v);
      el("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: y, y2: y }, svg);
      el("text", { class: "lbl-y", x: pad.l - 7, y: y + 3.5 }, svg)
        .textContent = opt.yFormat ? opt.yFormat(v) : fmtNum(v, 0);
    });

    // X 轴标签（按可用宽度自动稀释；再按估算宽度跳过会叠字的，尤其是硬塞的最后一个）
    const every = Math.max(1, Math.ceil(n / maxLabelsFor(iw, opt.maxXLabels)));
    let lastRight = -Infinity;
    labels.forEach((lb, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      const text = opt.xFormat ? opt.xFormat(lb, i) : lb;
      const x = X(i), half = estTextWidth(text) / 2;
      if (x - half < lastRight + 3) return;
      lastRight = x + half;
      el("text", { class: "lbl-x", x, y: H - pad.b + 16 }, svg).textContent = text;
    });

    // 线 + 面积（面积按连续段分别闭合，避免跨断点连线）
    series.forEach(s => {
      const data = s.data || [];
      let d = "", started = false;
      const segments = [];
      let seg = null;
      data.forEach((v, i) => {
        const isGap = v === null || v === undefined || (opt.treatZeroAsGap && Number(v) === 0);
        if (isGap) {
          if (seg) { segments.push(seg); seg = null; }
          started = false;
          return;
        }
        const x = X(i), y = Y(Number(v));
        d += (started ? " L" : " M") + x.toFixed(1) + " " + y.toFixed(1);
        if (!seg) seg = { pts: [] };
        seg.pts.push(i);
        started = true;
      });
      if (seg) segments.push(seg);

      if (s.fill !== false && segments.length) {
        const base = pad.t + ih;
        let areaD = "";
        for (const sgm of segments) {
          const pts = sgm.pts;
          areaD += `M${X(pts[0]).toFixed(1)} ${base} L`;
          pts.forEach(i => { areaD += `${X(i).toFixed(1)} ${Y(Number(data[i])).toFixed(1)} L`; });
          areaD = areaD.replace(/ L$/, "") +
            ` L${X(pts[pts.length - 1]).toFixed(1)} ${base} Z `;
        }
        el("path", {
          class: animate ? "c-area" : null,
          d: areaD,
          fill: s.color, opacity: s.fillOpacity || 0.13, stroke: "none"
        }, svg);
      }
      if (d) {
        el("path", {
          // 实线才做"画线"动画：虚线序列的 stroke-dasharray 会被这条 CSS 覆盖掉
          class: (animate && !s.dashed) ? "c-line" : null,
          pathLength: (animate && !s.dashed) ? 1 : null,
          d: d, fill: "none", stroke: s.color,
          "stroke-width": s.width || 2.2,
          "stroke-linejoin": "round", "stroke-linecap": "round",
          "stroke-dasharray": s.dashed ? "5 4" : null
        }, svg);
      }
      if (opt.showDots !== false && n <= 40 && iw / Math.max(n, 1) >= 12) {
        data.forEach((v, i) => {
          const isGap = v === null || v === undefined || (opt.treatZeroAsGap && Number(v) === 0);
          if (isGap) return;
          const dot = el("circle", { class: animate ? "dot c-dot" : "dot", cx: X(i), cy: Y(Number(v)), r: 3,
                                     fill: themeVar("--card", "#191d28"), stroke: s.color, "stroke-width": 2 }, svg);
          if (animate) dot.style.setProperty("--i", String(Math.min(i, 30)));
        });
      }
    });

    // 悬浮
    const tip = Tip(svg);
    const overlay = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }, svg);
    overlay.addEventListener("mousemove", ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * W;
      let i = Math.round((px - pad.l) / (stepX || 1));
      i = Math.max(0, Math.min(n - 1, i));
      const parts = series.map(s => {
        const v = (s.data || [])[i];
        const gap = v === null || v === undefined || (opt.treatZeroAsGap && Number(v) === 0);
        return { name: s.name, v: gap ? null : Number(v), color: s.color };
      });
      const valid = parts.filter(p => p.v !== null);
      const first = valid[0];
      tip.setLineColor(first ? first.color : themeVar("--accent", "#5c7cfa"));
      const label = opt.tipLabel ? opt.tipLabel(labels[i], i) : labels[i];
      const body = valid.length
        ? valid.map(p => `${p.name} ${opt.tipFormat ? opt.tipFormat(p.v) : fmtNum(p.v, 2)}`).join("   ")
        : "无记录";
      tip.show(X(i), Y(first ? first.v : (vmin + vmax) / 2), `${label}  ${body}`, W, H);
    });
    overlay.addEventListener("mouseleave", () => tip.hide());
    registerChart(container, noAnim2 => LineChart(container, opt, noAnim2));
    return svg;
  }

  /* ================= 分组柱状图 ================= */
  function BarChart(container, opt, noAnim) {
    container.innerHTML = "";
    const animate = animOK(noAnim);
    const labels = opt.labels || [];
    const series = (opt.series || []).filter(s => s && !s.hidden);
    const W = opt.width || fitWidth(container, 720), H = opt.height || 260;
    const pad = padFor(W, opt.pad);
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`,
                            preserveAspectRatio: "none", style: `height:${H}px` }, container);
    svg.style.width = "100%";
    if (!labels.length || !series.length) {
      el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, svg)
        .textContent = opt.emptyText || "暂无数据";
      return svg;
    }

    let vmax = 0;
    series.forEach(s => {
      if (s.type === "line") return;
      (s.data || []).forEach(v => { vmax = Math.max(vmax, Number(v) || 0); });
    });
    const sc = niceScale(0, vmax || 1, opt.ticks || (W < 420 ? 3 : 4));
    vmax = sc.max;
    const Y = v => pad.t + ih - (v / (vmax || 1)) * ih;

    // 折线序列：用自己的值域，映射回同一画布
    const lineSeries = series.filter(s => s.type === "line");
    let lmin = Infinity, lmax = -Infinity;
    lineSeries.forEach(s => (s.data || []).forEach(v => {
      const n = Number(v);
      if (isNaN(n)) return;
      lmin = Math.min(lmin, n); lmax = Math.max(lmax, n);
    }));
    if (lmin === Infinity) { lmin = 0; lmax = 1; }
    if (lmin > 0) lmin = 0;
    const LY = v => pad.t + ih - ((v - lmin) / (lmax - lmin || 1)) * ih;

    sc.ticks.forEach(v => {
      const y = Y(v);
      el("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: y, y2: y }, svg);
      el("text", { class: "lbl-y", x: pad.l - 7, y: y + 3.5 }, svg)
        .textContent = opt.yFormat ? opt.yFormat(v) : fmtNum(v, 0);
    });

    const n = labels.length;
    const slot = iw / n;
    const barSeries = series.filter(s => s.type !== "line");
    const groupW = Math.min(slot * 0.68, 46);
    const bw = barSeries.length > 1 ? groupW / barSeries.length : Math.min(groupW, 34);
    const startX = pad.l + (slot - groupW) / 2;

    const tip = Tip(svg);
    const barEvery = Math.max(1, Math.ceil(n / maxLabelsFor(iw, opt.maxXLabels)));
    let barLastRight = -Infinity;
    labels.forEach((lb, i) => {
      barSeries.forEach((s, si) => {
        const v = Number((s.data || [])[i] || 0);
        const x = startX + i * slot + si * bw;
        const y = Y(v);
        const h = Math.max(0, pad.t + ih - y);
        const r = Math.min(4, bw / 2.5);
        const rect = el("path", {
          class: animate ? "bar c-bar" : "bar", fill: s.color,
          d: roundRectPath(x + 0.8, y, Math.max(bw - 1.6, 1), h, r),
          opacity: 0.92
        }, svg);
        // 同一组柱子一起长（--i 用标签序号），形成从左到右的波浪
        if (animate) rect.style.setProperty("--i", String(Math.min(i, 14)));
        rect.addEventListener("mousemove", () => {
          tip.setLineColor(s.color);
          tip.show(x + bw / 2, Math.max(y, 12),
            `${opt.tipLabel ? opt.tipLabel(lb, i) : lb}  ${s.name} ${fmtNum(v, 2)}`, W, H);
        });
        rect.addEventListener("mouseleave", () => tip.hide());
      });
      const lx = startX + i * slot + groupW / 2;
      const half = estTextWidth(lb) / 2;
      if ((i % barEvery === 0 || i === n - 1) && lx - half >= barLastRight + 3) {
        barLastRight = lx + half;
        el("text", { class: "lbl-x", x: lx, y: H - pad.b + 16 }, svg).textContent = lb;
      }
    });

    // 叠加折线（与柱子共用画布）
    lineSeries.forEach(s => {
      const data = s.data || [];
      let d = "", started = false;
      data.forEach((v, i) => {
        if (v === null || v === undefined || isNaN(Number(v))) { started = false; return; }
        const x = startX + i * slot + groupW / 2;
        const y = LY(Number(v));
        d += (started ? " L" : " M") + x.toFixed(1) + " " + y.toFixed(1);
        started = true;
      });
      if (d) {
        el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": s.width || 2.2,
                     "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      }
      if (n <= 24) {
        data.forEach((v, i) => {
          if (v === null || v === undefined || isNaN(Number(v))) return;
          el("circle", { class: "dot", cx: startX + i * slot + groupW / 2, cy: LY(Number(v)),
                         r: 3, fill: themeVar("--card", "#191d28"),
                         stroke: s.color, "stroke-width": 2 }, svg);
        });
      }
    });
    registerChart(container, noAnim2 => BarChart(container, opt, noAnim2));
    return svg;
  }

  function roundRectPath(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h / 2);
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
           `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} ` +
           `L${x + w},${y + h} Z`;
  }

  /* ================= 环形图 ================= */
  function DonutChart(container, opt) {
    container.innerHTML = "";
    const animate = animOK(false);
    const data = (opt.data || []).filter(d => d.value > 0);
    const size = opt.size || 220, thickness = opt.thickness || 30;
    const cx = size / 2, cy = size / 2, R = size / 2 - 6, r = R - thickness;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${size} ${size}`,
                            style: `max-width:${size}px;margin:0 auto;display:block` }, container);
    if (!data.length) {
      el("circle", { cx, cy, r: R - thickness / 2, fill: "none",
                     stroke: themeVar("--border", "#272c3a"), "stroke-width": thickness }, svg);
      el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "middle" }, svg)
        .textContent = "暂无数据";
      return svg;
    }

    const total = data.reduce((a, b) => a + b.value, 0);
    let angle = -Math.PI / 2;
    const tip = Tip(svg);
    // 扇区与中心文字放进同一个 <g>，整块一起转出来（tooltip 留在 svg 上，不跟着动）
    const ring = animate ? el("g", { class: "c-donut" }, svg) : svg;

    data.forEach(d => {
      const frac = d.value / total;
      const a0 = angle, a1 = angle + frac * Math.PI * 2;
      angle = a1;
      const gap = data.length > 1 ? 0.012 : 0;
      const p = el("path", {
        d: arcPath(cx, cy, R, r, a0 + gap, Math.max(a1 - gap, a0 + 0.004)),
        fill: d.color || "#888", opacity: 0.92, class: "bar"
      }, ring);
      p.addEventListener("mousemove", () => {
        tip.setLineColor(d.color || "#888");
        tip.show(cx, cy - R * 0.55,
          `${d.name}  ${fmtNum(d.value, 2)}  (${(frac * 100).toFixed(1)}%)`, size, size);
      });
      p.addEventListener("mouseleave", () => tip.hide());
    });

    if (opt.centerText !== false) {
      el("text", { x: cx, y: cy - 6, "text-anchor": "middle",
                   style: `font-size:20px;font-weight:700;fill:${themeVar("--text", "#fff")}` }, ring)
        .textContent = opt.centerValue !== undefined ? opt.centerValue : fmtNum(total, 0);
      el("text", { x: cx, y: cy + 13, "text-anchor": "middle",
                   style: "font-size:11px" }, ring)
        .textContent = opt.centerLabel || "合计";
    }
    return svg;
  }

  function arcPath(cx, cy, R, r, a0, a1) {
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R);
    const [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} ` +
           `L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
  }

  global.Charts = { LineChart, BarChart, DonutChart, fmtNum, niceScale };
})(window);
