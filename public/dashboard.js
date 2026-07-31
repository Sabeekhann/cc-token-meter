(function () {
  'use strict';

  var gaugeEl = document.getElementById('gauge');
  var gaugeValueEl = document.getElementById('gaugeValue');
  var gaugeSubtextEl = document.getElementById('gaugeSubtext');
  var statSessionsEl = document.getElementById('statSessions');
  var statInputEl = document.getElementById('statInput');
  var statOutputEl = document.getElementById('statOutput');
  var statCacheReadEl = document.getElementById('statCacheRead');
  var statCacheCreationEl = document.getElementById('statCacheCreation');
  var statCostEl = document.getElementById('statCost');
  var budgetBannerEl = document.getElementById('budgetBanner');
  var projectListEl = document.getElementById('projectList');
  var branchListEl = document.getElementById('branchList');
  var tipsPanelEl = document.getElementById('tipsPanel');
  var forecastWindowEl = document.getElementById('forecastWindow');
  var forecastBodyEl = document.getElementById('forecastBody');
  var modelFilterEl = document.getElementById('modelFilter');
  var rangeFilterEl = document.getElementById('rangeFilter');
  var dailyChartEl = document.getElementById('dailyChart');
  var tabButtons = document.querySelectorAll('.tab-btn');
  var tabPanels = document.querySelectorAll('.tab-panel');
  var tipFilterPillsEl = document.getElementById('tipFilterPills');
  var tipSortSelectEl = document.getElementById('tipSortSelect');
  var tipsSummaryEl = document.getElementById('tipsSummary');

  var expandedProjects = Object.create(null);
  var expandedBranches = Object.create(null);
  var expandedTimelines = Object.create(null);
  var expandedTipGroups = Object.create(null);
  var filterState = { model: 'all', range: 'all' };
  var tipFilterState = { severity: 'all', sort: 'severity' };

  tipFilterPillsEl.querySelectorAll('.pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      tipFilterState.severity = btn.getAttribute('data-severity');
      tipFilterPillsEl.querySelectorAll('.pill').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      if (window.__lastSummary) render(window.__lastSummary);
    });
  });

  tipSortSelectEl.addEventListener('change', function () {
    tipFilterState.sort = tipSortSelectEl.value;
    if (window.__lastSummary) render(window.__lastSummary);
  });

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      tabButtons.forEach(function (b) { b.classList.toggle('active', b === btn); });
      tabPanels.forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-tab-panel') === tab);
      });
    });
  });

  modelFilterEl.addEventListener('change', function () {
    filterState.model = modelFilterEl.value;
    if (window.__lastSummary) render(window.__lastSummary);
  });

  rangeFilterEl.addEventListener('change', function () {
    filterState.range = rangeFilterEl.value;
    if (window.__lastSummary) render(window.__lastSummary);
  });

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

  function formatSavingsBadge(tip) {
    var usd = tip.estimatedSavingsUsd;
    var tokens = tip.estimatedSavingsTokens;
    if (usd === null || usd === undefined) {
      if (tokens === null || tokens === undefined) return null;
      return '~' + formatCompact(tokens) + ' tok';
    }
    var usdText = usd < 0.01 && usd > 0 ? '<$0.01' : formatCost(usd);
    return '~' + usdText + ' saved';
  }

  function shortProjectName(path) {
    var parts = String(path || '').split('/').filter(Boolean);
    if (parts.length <= 2) return '/' + parts.join('/');
    return '…/' + parts.slice(-2).join('/');
  }

  function localDateKey(isoTimestamp) {
    var d = new Date(isoTimestamp);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getRangeCutoff(range) {
    var now = new Date();
    if (range === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }
    if (range === '7d') return now.getTime() - 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    return null;
  }

  function updateModelOptions(sessions) {
    var models = Object.create(null);
    (sessions || []).forEach(function (s) {
      (s.models || []).forEach(function (m) { if (m && m.indexOf('<') !== 0) models[m] = true; });
    });
    var modelNames = Object.keys(models).sort();
    var options = '<option value="all">All models</option>' + modelNames.map(function (m) {
      return '<option value="' + escapeHtmlAttr(m) + '">' + escapeHtml(m) + '</option>';
    }).join('');
    if (modelFilterEl.innerHTML !== options) {
      modelFilterEl.innerHTML = options;
    }
    if (filterState.model !== 'all' && modelNames.indexOf(filterState.model) === -1) {
      filterState.model = 'all';
    }
    modelFilterEl.value = filterState.model;
    rangeFilterEl.value = filterState.range;
  }

  // Recomputes stat totals + a daily bucket series from
  // summary.sessions[].timeline.usage[] when a filter is active, so filtering
  // stays entirely client-side (no new API calls). Falls back to the
  // existing server-computed summary.allTime/byDay when both filters are at
  // their defaults, since that's cheaper and already exact.
  function computeFilteredData(summary) {
    var isDefault = filterState.model === 'all' && filterState.range === 'all';
    if (isDefault) {
      return {
        sessionsCount: summary.sessions.length,
        inputTokens: summary.allTime.inputTokens,
        outputTokens: summary.allTime.outputTokens,
        cacheCreationInputTokens: summary.allTime.cacheCreationInputTokens,
        cacheReadInputTokens: summary.allTime.cacheReadInputTokens,
        costUsd: summary.allTime.costUsd,
        byDay: summary.byDay
      };
    }

    var cutoff = getRangeCutoff(filterState.range);
    var totals = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 };
    var byDayMap = Object.create(null);
    var sessionIdsSeen = Object.create(null);

    (summary.sessions || []).forEach(function (s) {
      var timeline = s.timeline;
      if (!timeline || !Array.isArray(timeline.usage)) return;
      var perMessageCost = s.messageCount > 0 ? (s.costUsd || 0) / s.messageCount : 0;

      timeline.usage.forEach(function (u) {
        if (filterState.model !== 'all' && u.model !== filterState.model) return;
        if (!u.timestamp) return;
        var ts = new Date(u.timestamp).getTime();
        if (cutoff !== null && ts < cutoff) return;

        totals.inputTokens += u.inputTokens || 0;
        totals.outputTokens += u.outputTokens || 0;
        totals.cacheCreationInputTokens += u.cacheCreationInputTokens || 0;
        totals.cacheReadInputTokens += u.cacheReadInputTokens || 0;
        totals.costUsd += perMessageCost;
        sessionIdsSeen[s.sessionId] = true;

        var dateKey = localDateKey(u.timestamp);
        var bucket = byDayMap[dateKey];
        if (!bucket) {
          bucket = byDayMap[dateKey] = {
            date: dateKey,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            costUsd: 0,
            messageCount: 0
          };
        }
        bucket.inputTokens += u.inputTokens || 0;
        bucket.outputTokens += u.outputTokens || 0;
        bucket.cacheCreationInputTokens += u.cacheCreationInputTokens || 0;
        bucket.cacheReadInputTokens += u.cacheReadInputTokens || 0;
        bucket.costUsd += perMessageCost;
        bucket.messageCount += 1;
      });
    });

    var byDay = Object.keys(byDayMap).sort().map(function (k) { return byDayMap[k]; });

    return {
      sessionsCount: Object.keys(sessionIdsSeen).length,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheCreationInputTokens: totals.cacheCreationInputTokens,
      cacheReadInputTokens: totals.cacheReadInputTokens,
      costUsd: totals.costUsd,
      byDay: byDay
    };
  }

  function renderStatsGrid(data) {
    statSessionsEl.textContent = String(data.sessionsCount);
    statInputEl.textContent = formatCompact(data.inputTokens);
    statInputEl.title = formatTokens(data.inputTokens) + ' tokens';
    statOutputEl.textContent = formatCompact(data.outputTokens);
    statOutputEl.title = formatTokens(data.outputTokens) + ' tokens';
    statCacheReadEl.textContent = formatCompact(data.cacheReadInputTokens);
    statCacheReadEl.title = formatTokens(data.cacheReadInputTokens) + ' tokens';
    statCacheCreationEl.textContent = formatCompact(data.cacheCreationInputTokens);
    statCacheCreationEl.title = formatTokens(data.cacheCreationInputTokens) + ' tokens';
    statCostEl.textContent = formatCost(data.costUsd);
  }

  var DAILY_CHART_WIDTH = 640;
  var DAILY_CHART_HEIGHT = 200;
  var DAILY_CHART_PAD = 10;

  // Grouped input/output bar chart (left axis, token counts) with a cost
  // polyline overlay (right axis, its own independent scale) — same
  // dual-scale technique renderTimelineChart already uses for its
  // cumulative-burn line.
  function renderDailyChart(byDay) {
    if (!byDay || byDay.length === 0) {
      return '<div class="empty-row timeline-empty">No daily data yet.</div>';
    }

    var innerW = DAILY_CHART_WIDTH - DAILY_CHART_PAD * 2;
    var innerH = DAILY_CHART_HEIGHT - DAILY_CHART_PAD * 2;

    var maxTokens = byDay.reduce(function (m, d) {
      return Math.max(m, d.inputTokens || 0, d.outputTokens || 0);
    }, 0) || 1;
    var maxCost = byDay.reduce(function (m, d) { return Math.max(m, d.costUsd || 0); }, 0) || 1;

    var n = byDay.length;
    var groupWidth = innerW / n;
    var barWidth = Math.max(1, groupWidth / 2 - 2);

    var bars = byDay.map(function (d) {
      var idx = byDay.indexOf(d);
      var groupX = DAILY_CHART_PAD + idx * groupWidth;
      var inH = ((d.inputTokens || 0) / maxTokens) * innerH;
      var outH = ((d.outputTokens || 0) / maxTokens) * innerH;
      var inY = DAILY_CHART_PAD + (innerH - inH);
      var outY = DAILY_CHART_PAD + (innerH - outH);
      var title = escapeHtmlAttr(
        d.date + ' · in ' + formatTokens(d.inputTokens) + ' / out ' + formatTokens(d.outputTokens) + ' tok · ' + formatCost(d.costUsd)
      );
      return (
        '<rect class="daily-bar daily-bar-input" x="' + groupX.toFixed(2) + '" y="' + inY.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(0.5, inH).toFixed(2) + '"><title>' + title + '</title></rect>' +
        '<rect class="daily-bar daily-bar-output" x="' + (groupX + barWidth + 2).toFixed(2) + '" y="' + outY.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(0.5, outH).toFixed(2) + '"><title>' + title + '</title></rect>'
      );
    }).join('');

    var linePoints = byDay.map(function (d, i) {
      var x = DAILY_CHART_PAD + i * groupWidth + groupWidth / 2;
      var y = DAILY_CHART_PAD + (innerH - ((d.costUsd || 0) / maxCost) * innerH);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');

    var legend =
      '<div class="timeline-legend">' +
        '<span><span class="timeline-swatch daily-swatch-input"></span>input tokens</span>' +
        '<span><span class="timeline-swatch daily-swatch-output"></span>output tokens</span>' +
        '<span><span class="timeline-swatch timeline-swatch-line"></span>est. cost</span>' +
      '</div>';

    var svg =
      '<svg class="timeline-svg daily-chart-svg" viewBox="0 0 ' + DAILY_CHART_WIDTH + ' ' + DAILY_CHART_HEIGHT + '" preserveAspectRatio="none">' +
        bars +
        '<polyline class="timeline-line daily-cost-line" points="' + linePoints + '" fill="none"></polyline>' +
      '</svg>';

    return legend + svg;
  }

  function render(summary) {
    updateModelOptions(summary.sessions);
    var filtered = computeFilteredData(summary);
    renderGauge(summary);
    renderStatsGrid(filtered);
    dailyChartEl.innerHTML = renderDailyChart(filtered.byDay);
    renderBudgetBanner(summary.alerts);
    renderForecast(summary.forecast, summary.config);
    renderProjects(summary.byProject, summary.sessions);
    renderBranches(summary.byBranch);
    renderTips(summary.tips, summary.sessions);
  }

  function renderForecast(forecast, config) {
    if (!forecast || !forecast.daysObserved) {
      forecastWindowEl.textContent = '';
      forecastBodyEl.innerHTML = '<div class="forecast-empty">Not enough data yet — check back after a day or two of usage.</div>';
      return;
    }

    forecastWindowEl.textContent =
      'based on last ' + forecast.daysObserved + ' day' + (forecast.daysObserved === 1 ? '' : 's');

    var cap = config && config.dailyCostCapUsd;
    var overBudget = forecast.exceedsDailyCap === true;
    var projectedValueCls = 'forecast-stat-value' + (overBudget ? ' over-budget' : '');

    var monthLabel = forecast.projectionDays === 30 ? 'this month' : 'next ' + forecast.projectionDays + ' days';

    var html =
      '<div class="forecast-stat">' +
        '<span class="forecast-stat-label">Avg daily burn</span>' +
        '<span class="forecast-stat-value">' + escapeHtml(formatCost(forecast.avgDailyCostUsd)) +
          ' <span class="est">(' + escapeHtml(formatCompact(forecast.avgDailyTokens)) + ' tok)</span></span>' +
      '</div>' +
      '<div class="forecast-stat">' +
        '<span class="forecast-stat-label">Projected ' + escapeHtml(monthLabel) + '</span>' +
        '<span class="' + escapeHtmlAttr(projectedValueCls) + '" title="' + escapeHtmlAttr(formatTokens(forecast.projectedTokens) + ' tokens') + '">' +
          escapeHtml(formatCost(forecast.projectedCostUsd)) +
        '</span>' +
      '</div>';

    if (overBudget) {
      html +=
        '<div class="forecast-stat">' +
          '<span class="forecast-stat-label">vs. daily cap</span>' +
          '<span class="forecast-stat-value over-budget">exceeds ' + escapeHtml(formatCost(cap)) + '/day</span>' +
        '</div>';
    }

    forecastBodyEl.innerHTML = html;
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

  function renderBranches(byBranch) {
    if (!byBranch || byBranch.length === 0) {
      branchListEl.innerHTML = '<div class="empty-row">No sessions found yet.</div>';
      return;
    }

    var maxCost = byBranch.reduce(function (m, b) { return Math.max(m, b.costUsd || 0); }, 0) || 1;

    var html = byBranch.map(function (b) {
      var isExpanded = !!expandedBranches[b.branch];
      var barPct = Math.max(3, Math.round(((b.costUsd || 0) / maxCost) * 100));

      var row =
        '<div class="project-row" data-branch="' + escapeHtmlAttr(b.branch) + '">' +
          '<div class="project-bar" style="width:' + barPct + '%"></div>' +
          '<div class="project-row-inner">' +
            '<span class="project-caret">' + (isExpanded ? '▾' : '▸') + '</span>' +
            '<span class="project-name" title="' + escapeHtmlAttr(b.branch) + '">' + escapeHtml(b.branch) + '</span>' +
            '<span class="project-sessions">' + b.sessions.length + '</span>' +
            '<span class="project-tokens" title="' + formatTokens(b.tokenTotal) + ' tokens">' + formatCompact(b.tokenTotal) + '</span>' +
            '<span class="project-cost">' + formatCost(b.costUsd) + '</span>' +
          '</div>' +
        '</div>';

      if (!isExpanded) return row;

      var sessions = b.sessions.map(function (s) {
        return (
          '<div class="session-item">' +
            '<span class="session-id">' + escapeHtml(s.sessionId.slice(0, 8)) + ' &middot; ' + s.messageCount + ' msgs</span>' +
            '<span class="session-tokens" title="' + formatTokens(s.tokenTotal) + ' tokens">' + formatCompact(s.tokenTotal) + '</span>' +
            '<span class="session-cost">' + formatCost(s.costUsd) + '</span>' +
          '</div>'
        );
      }).join('');

      return row + '<div class="session-list">' + sessions + '</div>';
    }).join('');

    branchListEl.innerHTML = html;

    branchListEl.querySelectorAll('.project-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var branch = row.getAttribute('data-branch');
        expandedBranches[branch] = !expandedBranches[branch];
        if (window.__lastSummary) render(window.__lastSummary);
      });
    });
  }

  function buildSessionIndexForTips(sessions) {
    var index = Object.create(null);
    (sessions || []).forEach(function (s) {
      if (!s || !s.sessionId) return;
      index[s.sessionId] = { project: s.project };
    });
    return index;
  }

  function savingsSortValue(tip) {
    if (typeof tip.estimatedSavingsUsd === 'number') return tip.estimatedSavingsUsd;
    if (typeof tip.estimatedSavingsTokens === 'number') return tip.estimatedSavingsTokens / 1e6;
    return 0;
  }

  function renderTipsSummary(tips) {
    if (!tips || tips.length === 0) {
      tipsSummaryEl.textContent = '';
      return;
    }
    var warnCount = tips.filter(function (t) { return t.severity === 'warn'; }).length;
    var totalSavings = tips.reduce(function (sum, t) {
      return sum + (typeof t.estimatedSavingsUsd === 'number' ? t.estimatedSavingsUsd : 0);
    }, 0);

    var parts = [tips.length + ' tip' + (tips.length === 1 ? '' : 's')];
    if (warnCount > 0) parts.push(warnCount + ' warning' + (warnCount === 1 ? '' : 's'));
    var text = parts.join(' · ');
    if (totalSavings > 0) {
      text += ' · ~' + formatCost(totalSavings) + ' potential savings';
    }
    tipsSummaryEl.textContent = text;
  }

  // One row per (project, tip category) — collapsed by default so the whole
  // panel is scannable at a glance instead of a tall stack of near-duplicate
  // full-message cards. The row always shows project + category + how many
  // sessions triggered it, so it's unambiguous what the tip is for even
  // collapsed; expanding a row lists each individual session + its exact
  // message.
  function groupTipsByProjectAndCategory(tips, sessionIndex) {
    var order = [];
    var groups = Object.create(null);

    tips.forEach(function (tip) {
      var info = sessionIndex[tip.sessionId];
      var project = (info && info.project) || 'Unknown project';
      var kind = tipKind(tip);
      var key = project + ' ' + kind.label;
      if (!groups[key]) {
        groups[key] = { key: key, project: project, kind: kind, tips: [] };
        order.push(key);
      }
      groups[key].tips.push(tip);
    });

    var result = order.map(function (key) { return groups[key]; });

    result.sort(function (a, b) {
      var aWarn = a.tips.filter(function (t) { return t.severity === 'warn'; }).length;
      var bWarn = b.tips.filter(function (t) { return t.severity === 'warn'; }).length;
      if (aWarn !== bWarn) return bWarn - aWarn;
      if (tipFilterState.sort === 'savings') {
        var aSavings = a.tips.reduce(function (s, t) { return s + savingsSortValue(t); }, 0);
        var bSavings = b.tips.reduce(function (s, t) { return s + savingsSortValue(t); }, 0);
        return bSavings - aSavings;
      }
      return b.tips.length - a.tips.length;
    });

    return result;
  }

  function renderTipGroupRow(group) {
    var isWarn = group.tips.some(function (t) { return t.severity === 'warn'; });
    var isExpanded = !!expandedTipGroups[group.key];
    var totalSavingsUsd = group.tips.reduce(function (sum, t) {
      return sum + (typeof t.estimatedSavingsUsd === 'number' ? t.estimatedSavingsUsd : 0);
    }, 0);
    var savingsBadge = totalSavingsUsd > 0
      ? '<span class="tip-savings">~' + escapeHtml(formatCost(totalSavingsUsd)) + ' saved</span>'
      : '';
    var sessionCount = group.tips.length;

    var row =
      '<div class="tip-row' + (isWarn ? ' warn' : ' info') + '" data-tip-group="' + escapeHtmlAttr(group.key) + '">' +
        '<span class="tip-caret">' + (isExpanded ? '▾' : '▸') + '</span>' +
        '<span class="tip-icon">' + group.kind.icon + '</span>' +
        '<span class="tip-row-body">' +
          '<span class="tip-category">' + escapeHtml(group.kind.label) + '</span>' +
          '<span class="tip-row-project" title="' + escapeHtmlAttr(group.project) + '">' + escapeHtml(shortProjectName(group.project)) + '</span>' +
        '</span>' +
        '<span class="tip-session-count">' + sessionCount + ' session' + (sessionCount === 1 ? '' : 's') + '</span>' +
        savingsBadge +
      '</div>';

    if (!isExpanded) return row;

    var sortedTips = group.tips.slice().sort(function (a, b) {
      if (tipFilterState.sort === 'savings') return savingsSortValue(b) - savingsSortValue(a);
      var aWarn = a.severity === 'warn' ? 0 : 1;
      var bWarn = b.severity === 'warn' ? 0 : 1;
      return aWarn - bWarn;
    });

    var detailRows = sortedTips.map(function (tip) {
      var sessionShort = tip.sessionId ? String(tip.sessionId).slice(0, 8) : 'unknown';
      var badgeText = formatSavingsBadge(tip);
      var badge = badgeText ? '<span class="tip-detail-savings">' + escapeHtml(badgeText) + '</span>' : '';
      return (
        '<div class="tip-detail-row">' +
          '<span class="tip-detail-session">session ' + escapeHtml(sessionShort) + '</span>' +
          '<span class="tip-detail-message">' + escapeHtml(tip.message) + '</span>' +
          badge +
        '</div>'
      );
    }).join('');

    return row + '<div class="tip-detail-list">' + detailRows + '</div>';
  }

  function renderTips(tips, sessions) {
    renderTipsSummary(tips);

    if (!tips || tips.length === 0) {
      tipsPanelEl.innerHTML = '<div class="empty-row">No tips — you\'re efficient.</div>';
      return;
    }

    var filtered = tips.filter(function (t) {
      return tipFilterState.severity === 'all' || t.severity === tipFilterState.severity;
    });

    if (filtered.length === 0) {
      tipsPanelEl.innerHTML = '<div class="empty-row">No tips match this filter.</div>';
      return;
    }

    var sessionIndex = buildSessionIndexForTips(sessions);
    var groups = groupTipsByProjectAndCategory(filtered, sessionIndex);

    tipsPanelEl.innerHTML = groups.map(renderTipGroupRow).join('');
  }

  // Delegated once at init (not per-render) so re-rendering the tips list on
  // every ~1.5s SSE tick never stacks up duplicate listeners on repeatedly
  // replaced row elements.
  tipsPanelEl.addEventListener('click', function (evt) {
    var row = evt.target.closest('.tip-row');
    if (!row) return;
    var key = row.getAttribute('data-tip-group');
    expandedTipGroups[key] = !expandedTipGroups[key];
    if (window.__lastSummary) render(window.__lastSummary);
  });

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
