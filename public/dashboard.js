(function () {
  'use strict';

  var gaugeEl = document.getElementById('gauge');
  var gaugeValueEl = document.getElementById('gaugeValue');
  var gaugeSubtextEl = document.getElementById('gaugeSubtext');
  var todayCostEl = document.getElementById('todayCost');
  var allTimeTokensEl = document.getElementById('allTimeTokens');
  var allTimeCostEl = document.getElementById('allTimeCost');
  var budgetBannerEl = document.getElementById('budgetBanner');
  var projectListEl = document.getElementById('projectList');
  var tipsPanelEl = document.getElementById('tipsPanel');

  var expandedProjects = Object.create(null);
  var expandedTips = Object.create(null);
  var expandedTimelines = Object.create(null);

  var TIP_KINDS = [
    { prefix: 'repeatedReads', icon: '↻', label: 'Re-reading a file' },
    { prefix: 'cacheRatio', icon: '◐', label: 'Cache reuse dropping' },
    { prefix: 'longSessionNoCompact', icon: '⏱', label: 'Long session, no /compact' },
    { prefix: 'outlierSessionTotal', icon: '↑', label: 'Unusually large session' },
    { prefix: 'largeToolResultSpike', icon: '▣', label: 'Large tool output' }
  ];

  function tipKind(tip) {
    var id = String(tip.id || '');
    for (var i = 0; i < TIP_KINDS.length; i++) {
      if (id.indexOf(TIP_KINDS[i].prefix) === 0) return TIP_KINDS[i];
    }
    return { icon: '✳', label: 'Tip' };
  }

  function formatTokens(n) {
    if (n === null || n === undefined) return '0';
    return Math.round(n).toLocaleString();
  }

  function formatCompact(n) {
    if (n === null || n === undefined) return '0';
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function formatCost(n) {
    if (n === null || n === undefined) return '$0.00';
    return '$' + n.toFixed(2);
  }

  function shortProjectName(path) {
    var parts = String(path || '').split('/').filter(Boolean);
    if (parts.length <= 2) return '/' + parts.join('/');
    return '…/' + parts.slice(-2).join('/');
  }

  function render(summary) {
    renderGauge(summary);
    renderTotals(summary);
    renderBudgetBanner(summary.alerts);
    renderProjects(summary.byProject, summary.sessions);
    renderTips(summary.tips);
  }

  // Build a sessionId -> timeline lookup from the top-level sessions array
  // (byProject's nested session rows are a lighter-weight projection that
  // doesn't itself carry `timeline` — it lives only on summary.sessions).
  function buildTimelineIndex(sessions) {
    var index = Object.create(null);
    if (!sessions) return index;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (s && s.sessionId) index[s.sessionId] = s.timeline;
    }
    return index;
  }

  function renderGauge(summary) {
    var cap = summary.config && summary.config.dailyTokenCap;
    var todayTokens = summary.today ? summary.today.tokenTotal : 0;

    gaugeValueEl.textContent = formatCompact(todayTokens);
    gaugeValueEl.title = formatTokens(todayTokens) + ' tokens';

    if (cap && cap > 0) {
      var ratio = Math.min(1, todayTokens / cap);
      var angle = Math.round(ratio * 360);
      var color = ratio >= 1 ? '#C6544B' : ratio >= 0.8 ? '#C98A2B' : '#D97757';
      gaugeEl.style.background =
        'conic-gradient(' + color + ' ' + angle + 'deg, rgba(217,119,87,0.12) ' + angle + 'deg)';
      gaugeSubtextEl.textContent = formatCompact(todayTokens) + ' / ' + formatCompact(cap) + ' (' + Math.round(ratio * 100) + '%)';
    } else {
      gaugeEl.style.background = 'conic-gradient(#D97757 360deg, rgba(217,119,87,0.12) 360deg)';
      gaugeSubtextEl.textContent = 'No cap set';
    }
  }

  function renderTotals(summary) {
    todayCostEl.textContent = formatCost(summary.today ? summary.today.costUsd : 0);

    var allTimeTokens = summary.allTime ? summary.allTime.tokenTotal : 0;
    allTimeTokensEl.textContent = formatCompact(allTimeTokens);
    allTimeTokensEl.title = formatTokens(allTimeTokens) + ' tokens';

    allTimeCostEl.textContent = formatCost(summary.allTime ? summary.allTime.costUsd : 0);
  }

  function renderBudgetBanner(alerts) {
    if (!alerts || alerts.length === 0) {
      budgetBannerEl.classList.add('hidden');
      budgetBannerEl.innerHTML = '';
      return;
    }

    var hasExceeded = alerts.some(function (a) { return a.level === 'exceeded'; });
    budgetBannerEl.classList.remove('hidden');
    budgetBannerEl.classList.toggle('exceeded', hasExceeded);

    var heading = hasExceeded ? 'Budget exceeded' : 'Budget warning';
    var items = alerts.map(function (a) {
      return '<li>' + escapeHtml(a.message) + '</li>';
    }).join('');

    budgetBannerEl.innerHTML = '<strong>' + escapeHtml(heading) + '</strong><ul>' + items + '</ul>';
  }

  function renderProjects(byProject, sessions) {
    if (!byProject || byProject.length === 0) {
      projectListEl.innerHTML = '<div class="empty-row">No sessions found yet.</div>';
      return;
    }

    var timelineIndex = buildTimelineIndex(sessions);
    var maxCost = byProject.reduce(function (m, p) { return Math.max(m, p.costUsd || 0); }, 0) || 1;

    var html = byProject.map(function (p) {
      var isExpanded = !!expandedProjects[p.project];
      var barPct = Math.max(3, Math.round(((p.costUsd || 0) / maxCost) * 100));

      var row =
        '<div class="project-row" data-project="' + escapeHtmlAttr(p.project) + '">' +
          '<div class="project-bar" style="width:' + barPct + '%"></div>' +
          '<div class="project-row-inner">' +
            '<span class="project-caret">' + (isExpanded ? '▾' : '▸') + '</span>' +
            '<span class="project-name" title="' + escapeHtmlAttr(p.project) + '">' + escapeHtml(shortProjectName(p.project)) + '</span>' +
            '<span class="project-sessions">' + p.sessions.length + '</span>' +
            '<span class="project-tokens" title="' + formatTokens(p.tokenTotal) + ' tokens">' + formatCompact(p.tokenTotal) + '</span>' +
            '<span class="project-cost">' + formatCost(p.costUsd) + '</span>' +
          '</div>' +
        '</div>';

      if (!isExpanded) return row;

      var sessionRows = p.sessions.map(function (s) {
        var timelineExpanded = !!expandedTimelines[s.sessionId];
        var timeline = timelineIndex[s.sessionId];
        var sessionRow =
          '<div class="session-item" data-session="' + escapeHtmlAttr(s.sessionId) + '">' +
            '<span class="session-timeline-caret">' + (timelineExpanded ? '▾' : '▸') + '</span>' +
            '<span class="session-id">' + escapeHtml(s.sessionId.slice(0, 8)) + ' &middot; ' + s.messageCount + ' msgs</span>' +
            '<span class="session-tokens" title="' + formatTokens(s.tokenTotal) + ' tokens">' + formatCompact(s.tokenTotal) + '</span>' +
            '<span class="session-cost">' + formatCost(s.costUsd) + '</span>' +
          '</div>';

        if (timelineExpanded) {
          sessionRow += '<div class="session-timeline">' + renderTimelineChart(timeline) + '</div>';
        }
        return sessionRow;
      }).join('');

      return row + '<div class="session-list">' + sessionRows + '</div>';
    }).join('');

    projectListEl.innerHTML = html;

    projectListEl.querySelectorAll('.project-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var project = row.getAttribute('data-project');
        expandedProjects[project] = !expandedProjects[project];
        if (window.__lastSummary) render(window.__lastSummary);
      });
    });

    projectListEl.querySelectorAll('.session-item').forEach(function (row) {
      row.addEventListener('click', function (evt) {
        evt.stopPropagation();
        var sessionId = row.getAttribute('data-session');
        expandedTimelines[sessionId] = !expandedTimelines[sessionId];
        if (window.__lastSummary) render(window.__lastSummary);
      });
    });
  }

  // Burn-timeline chart: an SVG bar chart of per-message token totals over
  // time (bar height ~ tokenTotal for that message), with a cumulative-burn
  // line overlaid, and tool events marked as small ticks along the x-axis.
  // Pure string-template rendering, consistent with the rest of this file —
  // cheap enough to redo on every ~1.5s SSE tick even for the 500-point cap.
  var TIMELINE_WIDTH = 640;
  var TIMELINE_HEIGHT = 120;
  var TIMELINE_PAD = 8;

  function renderTimelineChart(timeline) {
    if (!timeline || !Array.isArray(timeline.usage) || timeline.usage.length === 0) {
      return '<div class="empty-row timeline-empty">No timeline data for this session.</div>';
    }

    var usage = timeline.usage;
    var tools = Array.isArray(timeline.tools) ? timeline.tools : [];

    var firstTs = usage[0].timestamp ? new Date(usage[0].timestamp).getTime() : 0;
    var lastTs = usage[usage.length - 1].timestamp ? new Date(usage[usage.length - 1].timestamp).getTime() : firstTs;
    var span = Math.max(1, lastTs - firstTs);

    var maxPoint = usage.reduce(function (m, u) { return Math.max(m, u.tokenTotal || 0); }, 0) || 1;

    var cumulative = 0;
    var cumSeries = usage.map(function (u) {
      cumulative += u.tokenTotal || 0;
      return cumulative;
    });
    var maxCumulative = cumulative || 1;

    var innerW = TIMELINE_WIDTH - TIMELINE_PAD * 2;
    var innerH = TIMELINE_HEIGHT - TIMELINE_PAD * 2;

    function xFor(ts) {
      if (!ts) return TIMELINE_PAD;
      var t = new Date(ts).getTime();
      return TIMELINE_PAD + ((t - firstTs) / span) * innerW;
    }

    var barWidth = usage.length > 1 ? Math.max(1, innerW / usage.length - 1) : Math.max(1, innerW);

    var bars = usage.map(function (u, i) {
      var x = usage.length > 1 ? TIMELINE_PAD + (i / usage.length) * innerW : TIMELINE_PAD;
      var h = ((u.tokenTotal || 0) / maxPoint) * innerH;
      var y = TIMELINE_PAD + (innerH - h);
      var title = escapeHtmlAttr(
        (u.timestamp ? new Date(u.timestamp).toLocaleTimeString() : 'unknown time') +
        ' · ' + formatTokens(u.tokenTotal) + ' tokens' +
        (u.model ? ' · ' + u.model : '')
      );
      return '<rect class="timeline-bar" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(0.5, h).toFixed(2) + '"><title>' + title + '</title></rect>';
    }).join('');

    var linePoints = usage.map(function (u, i) {
      var x = xFor(u.timestamp);
      var y = TIMELINE_PAD + (innerH - (cumSeries[i] / maxCumulative) * innerH);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');

    var toolTicks = tools.map(function (t) {
      var x = xFor(t.timestamp);
      var title = escapeHtmlAttr(
        (t.name || 'tool') + (t.kind ? ' (' + t.kind + ')' : '') +
        (t.timestamp ? ' · ' + new Date(t.timestamp).toLocaleTimeString() : '')
      );
      return '<line class="timeline-tick" x1="' + x.toFixed(2) + '" x2="' + x.toFixed(2) + '" y1="' + (TIMELINE_HEIGHT - TIMELINE_PAD) + '" y2="' + TIMELINE_HEIGHT + '"><title>' + title + '</title></line>';
    }).join('');

    var legend =
      '<div class="timeline-legend">' +
        '<span><span class="timeline-swatch timeline-swatch-bar"></span>per-message tokens</span>' +
        '<span><span class="timeline-swatch timeline-swatch-line"></span>cumulative burn</span>' +
        (tools.length ? '<span><span class="timeline-swatch timeline-swatch-tick"></span>tool events</span>' : '') +
      '</div>';

    var svg =
      '<svg class="timeline-svg" viewBox="0 0 ' + TIMELINE_WIDTH + ' ' + TIMELINE_HEIGHT + '" preserveAspectRatio="none">' +
        bars +
        '<polyline class="timeline-line" points="' + linePoints + '" fill="none"></polyline>' +
        toolTicks +
      '</svg>';

    return legend + svg;
  }

  function renderTips(tips) {
    if (!tips || tips.length === 0) {
      tipsPanelEl.innerHTML = '<div class="empty-row">No tips — you\'re efficient.</div>';
      return;
    }

    tipsPanelEl.innerHTML = tips.map(function (tip) {
      var kind = tipKind(tip);
      var isExpanded = !!expandedTips[tip.id];
      var cls = 'tip' + (tip.severity === 'warn' ? ' warn' : '') + (isExpanded ? ' expanded' : '');
      var text = isExpanded ? tip.message : kind.label;
      return (
        '<div class="' + cls + '" data-tip="' + escapeHtmlAttr(tip.id) + '" title="' + (isExpanded ? '' : escapeHtmlAttr(tip.message)) + '">' +
          '<span class="tip-icon">' + kind.icon + '</span>' +
          '<span class="tip-label">' + escapeHtml(text) + '</span>' +
        '</div>'
      );
    }).join('');

    tipsPanelEl.querySelectorAll('.tip').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-tip');
        expandedTips[id] = !expandedTips[id];
        if (window.__lastSummary) render(window.__lastSummary);
      });
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function connect() {
    var source = new EventSource('/api/stream');
    source.addEventListener('message', function (evt) {
      try {
        var summary = JSON.parse(evt.data);
        window.__lastSummary = summary;
        render(summary);
      } catch (err) {
        console.error('cc-token-meter: failed to parse summary', err);
      }
    });
    source.addEventListener('error', function () {
      // EventSource auto-reconnects; nothing else to do here.
    });
  }

  connect();
})();
