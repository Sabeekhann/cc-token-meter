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
  var forecastWindowEl = document.getElementById('forecastWindow');
  var forecastBodyEl = document.getElementById('forecastBody');

  var expandedProjects = Object.create(null);
  var expandedTips = Object.create(null);

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
    renderForecast(summary.forecast, summary.config);
    renderProjects(summary.byProject);
    renderTips(summary.tips);
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

  function renderProjects(byProject) {
    if (!byProject || byProject.length === 0) {
      projectListEl.innerHTML = '<div class="empty-row">No sessions found yet.</div>';
      return;
    }

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

      var sessions = p.sessions.map(function (s) {
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

    projectListEl.innerHTML = html;

    projectListEl.querySelectorAll('.project-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var project = row.getAttribute('data-project');
        expandedProjects[project] = !expandedProjects[project];
        if (window.__lastSummary) render(window.__lastSummary);
      });
    });
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
