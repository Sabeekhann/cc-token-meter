(function () {
  'use strict';

  var VIEW_TITLES = {
    overview: 'Overview',
    live: 'Live session',
    projects: 'Projects',
    insights: 'Insights',
    settings: 'Settings'
  };

  var TIP_KINDS = [
    { prefix: 'repeatedReads', icon: '↻', label: 'Repeated file reads' },
    { prefix: 'cacheRatio', icon: '◐', label: 'Cache reuse dropped' },
    { prefix: 'longSessionNoCompact', icon: '⌁', label: 'Context needs attention' },
    { prefix: 'outlierSessionTotal', icon: '↑', label: 'Unusually large session' },
    { prefix: 'largeToolResultSpike', icon: '▣', label: 'Large tool output' }
  ];

  var state = {
    summary: null,
    view: 'overview',
    insightFilter: 'all',
    projectQuery: '',
    projectSummary: null,
    projectSummaryKey: null,
    projectRange: 'all',
    projectModel: '',
    projectFrom: '',
    projectTo: '',
    projectLoading: false,
    projectError: '',
    projectRefreshTimer: null,
    projectRequestId: 0,
    expandedProject: null,
    selectedSessionId: null,
    settingsHydrated: false,
    toastTimer: null
  };

  var dom = {
    viewTitle: byId('viewTitle'),
    connectionStatus: byId('connectionStatus'),
    lastUpdated: byId('lastUpdated'),
    liveNavDot: byId('liveNavDot'),
    insightNavCount: byId('insightNavCount'),
    projectSearch: byId('projectSearch'),
    projectModel: byId('projectModel'),
    projectFrom: byId('projectFrom'),
    projectTo: byId('projectTo'),
    customRangeFields: byId('customRangeFields'),
    projectFilterSummary: byId('projectFilterSummary'),
    clearProjectFilters: byId('clearProjectFilters'),
    budgetForm: byId('budgetForm'),
    toast: byId('toast')
  };

  hydrateProjectFilterState();
  bindNavigation();
  bindFilters();
  bindSettings();
  connect();

  function byId(id) {
    return document.getElementById(id);
  }

  function bindNavigation() {
    var navButtons = Array.from(document.querySelectorAll('[data-view]'));
    navButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-view'), true, true);
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = keyboardTargetIndex(event.key, index, navButtons.length);
        if (targetIndex == null) return;
        event.preventDefault();
        navButtons[targetIndex].focus();
      });
    });

    document.querySelectorAll('[data-go-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-go-view'), true, true);
      });
    });

    document.querySelectorAll('[data-nav-view]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        setView(link.getAttribute('data-nav-view'), true, true);
      });
    });

    window.addEventListener('hashchange', function () {
      var requested = window.location.hash.replace('#', '');
      if (VIEW_TITLES[requested] && requested !== state.view) {
        setView(requested, false, true);
      }
    });

    var initialView = window.location.hash.replace('#', '');
    if (VIEW_TITLES[initialView]) setView(initialView, false);
  }

  function bindFilters() {
    dom.projectSearch.addEventListener('input', function () {
      state.projectQuery = dom.projectSearch.value.trim().toLowerCase();
      if (state.view === 'projects') renderProjects();
    });

    var rangeButtons = Array.from(document.querySelectorAll('[data-project-range]'));
    rangeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.projectRange = button.getAttribute('data-project-range') || 'all';
        if (state.projectRange !== 'custom') {
          state.projectFrom = '';
          state.projectTo = '';
        }
        projectFiltersChanged();
      });
    });

    dom.projectModel.addEventListener('change', function () {
      state.projectModel = dom.projectModel.value;
      projectFiltersChanged();
    });
    dom.projectFrom.addEventListener('change', function () {
      state.projectFrom = dom.projectFrom.value;
      projectFiltersChanged();
    });
    dom.projectTo.addEventListener('change', function () {
      state.projectTo = dom.projectTo.value;
      projectFiltersChanged();
    });
    dom.clearProjectFilters.addEventListener('click', function () {
      state.projectRange = 'all';
      state.projectModel = '';
      state.projectFrom = '';
      state.projectTo = '';
      state.projectError = '';
      projectFiltersChanged();
    });

    var filterButtons = Array.from(document.querySelectorAll('[data-insight-filter]'));
    filterButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        state.insightFilter = button.getAttribute('data-insight-filter');
        filterButtons.forEach(function (item) {
          item.classList.toggle('active', item === button);
          item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
        });
        renderInsights();
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = keyboardTargetIndex(event.key, index, filterButtons.length);
        if (targetIndex == null) return;
        event.preventDefault();
        filterButtons[targetIndex].focus();
        filterButtons[targetIndex].click();
      });
    });
  }

  function keyboardTargetIndex(key, currentIndex, length) {
    if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % length;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + length) % length;
    if (key === 'Home') return 0;
    if (key === 'End') return length - 1;
    return null;
  }

  function bindSettings() {
    dom.budgetForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submitButton = dom.budgetForm.querySelector('button[type="submit"]');
      var status = byId('budgetFormStatus');
      var payload = {
        dailyTokenCap: inputNumberOrNull('dailyTokenCap'),
        dailyCostCapUsd: inputNumberOrNull('dailyCostCapUsd'),
        sessionCostCapUsd: inputNumberOrNull('sessionCostCapUsd'),
        warnThresholdPct: inputNumberOrNull('warnThresholdPct') || 80
      };

      submitButton.disabled = true;
      status.className = '';
      status.textContent = 'Saving locally…';

      try {
        var response = await fetch('/api/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Settings request failed');

        var summaryResponse = await fetch('/api/summary', { cache: 'no-store' });
        if (!summaryResponse.ok) throw new Error('Could not refresh the dashboard');
        receiveSummary(await summaryResponse.json());

        status.className = 'success';
        status.textContent = 'Saved on this machine.';
        showToast('Budget settings saved locally.');
      } catch (error) {
        status.className = 'error';
        status.textContent = 'Could not save. Please try again.';
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function inputNumberOrNull(id) {
    var raw = byId(id).value.trim();
    if (raw === '') return null;
    var parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function setView(view, updateHash, focusHeading) {
    if (!VIEW_TITLES[view]) return;
    if (updateHash === undefined) updateHash = true;
    state.view = view;
    dom.viewTitle.textContent = VIEW_TITLES[view];

    document.querySelectorAll('[data-view]').forEach(function (button) {
      var active = button.getAttribute('data-view') === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      var active = panel.getAttribute('data-view-panel') === view;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });

    if (updateHash) {
      var nextUrl = new URL(window.location.href);
      nextUrl.hash = view;
      history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
    }
    if (view === 'projects' && state.summary && projectFiltersActive() && !state.projectSummary) {
      scheduleProjectRefresh();
    }
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (focusHeading) dom.viewTitle.focus({ preventScroll: true });
  }

  function receiveSummary(summary) {
    if (!summary || typeof summary !== 'object') return;
    state.summary = summary;
    hydrateProjectModelOptions(summary);
    if (!projectFiltersActive()) {
      state.projectSummary = summary;
      state.projectSummaryKey = '';
      state.projectError = '';
    } else if (state.view === 'projects') {
      scheduleProjectRefresh();
    }
    updateGlobalChrome(summary);
    renderCurrentView();
  }

  function updateGlobalChrome(summary) {
    var generatedAt = summary.generatedAt ? new Date(summary.generatedAt) : null;
    dom.lastUpdated.textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
      ? generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'Just now';

    var activeCount = valueAt(summary, ['intelligence', 'active', 'sessionCount'], 0);
    dom.liveNavDot.classList.toggle('active', activeCount > 0);

    var insightCount = Array.isArray(summary.tips) ? summary.tips.length : 0;
    dom.insightNavCount.textContent = String(insightCount);
    dom.insightNavCount.classList.toggle('hidden', insightCount === 0);
  }

  function renderCurrentView() {
    if (!state.summary) return;
    if (state.view === 'overview') renderOverview();
    if (state.view === 'live') renderLive();
    if (state.view === 'projects') renderProjects();
    if (state.view === 'insights') renderInsights();
    if (state.view === 'settings') renderSettings();
  }

  function renderOverview() {
    var summary = state.summary;
    var today = summary.today || {};
    var allTime = summary.allTime || {};
    var config = summary.config || {};
    var intelligence = summary.intelligence || {};
    var active = intelligence.active || {};
    var velocity = intelligence.velocity || {};
    var cache = intelligence.cache || {};
    var tips = rankedTips(summary.tips || []);
    var projects = summary.byProject || [];

    byId('overviewSummary').textContent = overviewSentence(today, active, velocity, projects, tips);
    byId('todayTokens').textContent = formatCompact(today.tokenTotal || 0);
    byId('todayTokens').title = formatNumber(today.tokenTotal || 0) + ' tokens';
    byId('todayCost').textContent = formatCost(today.costUsd || 0);
    byId('cacheReuse').textContent = formatPercent(cache.reuseRate || 0);
    byId('activeSessions').textContent = String(active.sessionCount || 0);

    setBudgetMetric(
      'todayTokensMeta',
      'tokenBudgetBar',
      today.tokenTotal || 0,
      config.dailyTokenCap,
      'tokens'
    );
    setBudgetMetric(
      'todayCostMeta',
      'costBudgetBar',
      today.costUsd || 0,
      config.dailyCostCapUsd,
      'cost'
    );

    byId('cacheReuseMeta').textContent = cache.estimatedSavingsUsd > 0
      ? formatCost(cache.estimatedSavingsUsd) + ' avoided through cache reads'
      : 'No measured cache savings yet';
    byId('cacheReuseBar').style.width = Math.min(100, Math.max(0, (cache.reuseRate || 0) * 100)) + '%';

    byId('activeSessionsMeta').textContent = active.sessionCount > 0
      ? shortProjectName(active.latestProject) + (active.latestBranch ? ' · ' + active.latestBranch : '')
      : 'No activity in the last ' + (active.windowMinutes || 10) + ' minutes';

    byId('allTimeCost').textContent = formatCost(allTime.costUsd || 0) + ' all time';
    renderBurnChart(summary.byDay || []);
    renderForecast(summary.forecast || {}, config);
    renderTokenMix(allTime);
    renderTopProjects(projects);
    renderTopInsights(tips);
  }

  function overviewSentence(today, active, velocity, projects, tips) {
    var activeCopy = active.sessionCount > 0
      ? active.sessionCount + ' active session' + (active.sessionCount === 1 ? '' : 's')
      : 'no active sessions';
    var rateCopy = velocity.tokenTotal > 0
      ? formatCompact(velocity.tokensPerMinute || 0) + ' tokens/min recently'
      : 'no recent burn';
    return formatCompact(today.tokenTotal || 0) + ' tokens today across ' + projects.length +
      ' project' + (projects.length === 1 ? '' : 's') + ', with ' + activeCopy + ', ' + rateCopy +
      ', and ' + tips.length + ' actionable insight' + (tips.length === 1 ? '' : 's') + '.';
  }

  function setBudgetMetric(metaId, barId, used, cap, kind) {
    var meta = byId(metaId);
    var bar = byId(barId);
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
      meta.textContent = kind === 'tokens' ? 'No daily token cap set' : 'Local pricing estimate · no cost cap';
      bar.style.width = '0%';
      return;
    }
    var ratio = used / cap;
    var usedText = kind === 'tokens' ? formatCompact(used) : formatCost(used);
    var capText = kind === 'tokens' ? formatCompact(cap) : formatCost(cap);
    meta.textContent = usedText + ' of ' + capText + ' · ' + Math.round(ratio * 100) + '%';
    bar.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%';
    bar.style.background = ratio >= 1 ? 'var(--red)' : ratio >= .8 ? 'var(--amber)' : 'var(--coral)';
  }

  function renderBurnChart(byDay) {
    var chart = byId('burnChart');
    var days = (Array.isArray(byDay) ? byDay : []).slice(-14);
    chart.classList.remove('loading-block');
    if (days.length === 0) {
      chart.innerHTML = '<div class="empty-state compact">Usage history will appear after Claude Code records a session.</div>';
      byId('burnChartSummary').textContent = 'No usage history is available yet.';
      return;
    }

    var width = 720;
    var height = 220;
    var left = 42;
    var right = 12;
    var top = 16;
    var bottom = 30;
    var plotW = width - left - right;
    var plotH = height - top - bottom;
    var maxTokens = Math.max.apply(null, days.map(function (d) { return d.tokenTotal || 0; })) || 1;
    var maxCost = Math.max.apply(null, days.map(function (d) { return d.costUsd || 0; })) || 1;
    var slot = plotW / days.length;
    var barWidth = Math.min(24, Math.max(7, slot * .44));

    var grid = '';
    for (var g = 0; g <= 3; g++) {
      var gy = top + (plotH / 3) * g;
      var labelValue = maxTokens * (1 - g / 3);
      grid += '<line class="chart-grid-line" x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (width - right) + '" y2="' + gy.toFixed(1) + '"></line>';
      grid += '<text class="chart-label" x="0" y="' + (gy + 3).toFixed(1) + '">' + escapeHtml(formatCompact(labelValue)) + '</text>';
    }

    var bars = '';
    var points = [];
    var labels = '';
    days.forEach(function (day, index) {
      var center = left + slot * index + slot / 2;
      var barH = ((day.tokenTotal || 0) / maxTokens) * plotH;
      var y = top + plotH - barH;
      var date = new Date(day.date + 'T12:00:00');
      var dayLabel = Number.isNaN(date.getTime()) ? day.date : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      bars += '<rect class="chart-bar" x="' + (center - barWidth / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(2, barH).toFixed(1) + '" rx="4"><title>' + escapeHtml(dayLabel + ': ' + formatNumber(day.tokenTotal || 0) + ' tokens · ' + formatCost(day.costUsd || 0)) + '</title></rect>';
      var costY = top + plotH - ((day.costUsd || 0) / maxCost) * plotH;
      points.push(center.toFixed(1) + ',' + costY.toFixed(1));
      if (days.length <= 7 || index % 2 === 0 || index === days.length - 1) {
        labels += '<text class="chart-label" text-anchor="middle" x="' + center.toFixed(1) + '" y="' + (height - 8) + '">' + escapeHtml(dayLabel) + '</text>';
      }
    });

    var firstPoint = points[0].split(',');
    var lastPoint = points[points.length - 1].split(',');
    var areaPoints = left + ',' + (top + plotH) + ' ' + points.join(' ') + ' ' + lastPoint[0] + ',' + (top + plotH);
    var dots = points.map(function (point, index) {
      var pair = point.split(',');
      return '<circle class="chart-dot" cx="' + pair[0] + '" cy="' + pair[1] + '" r="2.8"><title>' + escapeHtml(formatCost(days[index].costUsd || 0)) + '</title></circle>';
    }).join('');

    chart.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Fourteen day token and estimated cost chart">' +
        '<defs>' +
          '<linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef7659" stop-opacity=".58"></stop><stop offset="1" stop-color="#ef7659" stop-opacity=".13"></stop></linearGradient>' +
          '<linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d7cf5" stop-opacity=".13"></stop><stop offset="1" stop-color="#5d7cf5" stop-opacity="0"></stop></linearGradient>' +
        '</defs>' + grid +
        '<polygon class="chart-area" points="' + areaPoints + '"></polygon>' +
        bars + '<polyline class="chart-line" points="' + points.join(' ') + '"></polyline>' + dots + labels +
      '</svg>';
    var totalTokens = days.reduce(function (sum, day) { return sum + finiteOr0(day.tokenTotal); }, 0);
    var totalCost = days.reduce(function (sum, day) { return sum + finiteOr0(day.costUsd); }, 0);
    var peak = days.slice().sort(function (a, b) { return finiteOr0(b.tokenTotal) - finiteOr0(a.tokenTotal); })[0];
    byId('burnChartSummary').textContent = days.length + ' days shown: ' + formatNumber(totalTokens) +
      ' total tokens and ' + formatCost(totalCost) + ' estimated cost. Peak usage was ' +
      formatNumber(peak.tokenTotal || 0) + ' tokens on ' + peak.date + '.';
  }

  function renderForecast(forecast, config) {
    var badge = byId('forecastBadge');
    var message = byId('forecastMessage');
    if (!forecast.daysObserved) {
      byId('projectedCost').textContent = '—';
      byId('averageDailyCost').textContent = '—';
      byId('projectedTokens').textContent = '—';
      byId('forecastBasis').textContent = 'Waiting for enough usage history';
      badge.textContent = 'Learning';
      badge.className = 'soft-badge';
      message.className = 'forecast-message neutral';
      message.textContent = 'A forecast appears after the first day of local usage.';
      return;
    }

    byId('projectedCost').textContent = formatCost(forecast.projectedCostUsd || 0);
    byId('averageDailyCost').textContent = formatCost(forecast.avgDailyCostUsd || 0) + '/day';
    byId('projectedTokens').textContent = formatCompact(forecast.projectedTokens || 0);
    byId('forecastBasis').textContent = 'Based on the last ' + forecast.daysObserved + ' observed day' + (forecast.daysObserved === 1 ? '' : 's');

    if (forecast.exceedsDailyCap === true) {
      badge.textContent = 'Over pace';
      badge.className = 'soft-badge warn';
      message.className = 'forecast-message warn';
      message.textContent = 'Your recent daily average is above the ' + formatCost(config.dailyCostCapUsd || 0) + ' cost cap.';
    } else {
      badge.textContent = 'On track';
      badge.className = 'soft-badge good';
      message.className = 'forecast-message good';
      message.textContent = config.dailyCostCapUsd
        ? 'Your recent average remains within the configured daily cost cap.'
        : 'Set a daily cost cap in Settings to add pace warnings.';
    }
  }

  function renderTokenMix(allTime) {
    var entries = [
      { key: 'inputTokens', label: 'Fresh input', cls: 'input' },
      { key: 'outputTokens', label: 'Output', cls: 'output' },
      { key: 'cacheCreationInputTokens', label: 'Cache writes', cls: 'write' },
      { key: 'cacheReadInputTokens', label: 'Cache reads', cls: 'read' }
    ];
    var total = entries.reduce(function (sum, entry) { return sum + (allTime[entry.key] || 0); }, 0);
    if (total <= 0) {
      byId('tokenMix').innerHTML = '<div class="empty-state compact">Token composition appears after usage is recorded.</div>';
      return;
    }

    var segments = entries.map(function (entry) {
      var pct = ((allTime[entry.key] || 0) / total) * 100;
      return '<span class="mix-segment mix-' + entry.cls + '" style="width:' + pct.toFixed(3) + '%" title="' + escapeHtmlAttr(entry.label + ': ' + formatPercent(pct / 100)) + '"></span>';
    }).join('');
    var legend = entries.map(function (entry) {
      var value = allTime[entry.key] || 0;
      return '<div class="mix-item"><i class="mix-swatch mix-' + entry.cls + '"></i><span>' + escapeHtml(entry.label) + '</span><strong>' + escapeHtml(formatCompact(value)) + ' · ' + escapeHtml(formatPercent(value / total)) + '</strong></div>';
    }).join('');
    byId('tokenMix').innerHTML = '<div class="mix-bar">' + segments + '</div><div class="mix-legend">' + legend + '</div>';
  }

  function renderTopProjects(projects) {
    var top = (Array.isArray(projects) ? projects : []).slice().sort(function (a, b) {
      return (b.costUsd || 0) - (a.costUsd || 0);
    }).slice(0, 4);
    if (top.length === 0) {
      byId('topProjects').innerHTML = '<div class="empty-state compact">No projects found yet.</div>';
      return;
    }
    byId('topProjects').innerHTML = top.map(function (project, index) {
      return '<div class="rank-row">' +
        '<span class="rank-number">' + (index + 1) + '</span>' +
        '<div class="rank-copy"><strong title="' + escapeHtmlAttr(project.project) + '">' + escapeHtml(shortProjectName(project.project)) + '</strong><span>' + project.sessions.length + ' session' + (project.sessions.length === 1 ? '' : 's') + '</span></div>' +
        '<div class="rank-cost"><strong>' + escapeHtml(formatCost(project.costUsd || 0)) + '</strong><span>' + escapeHtml(formatCompact(project.tokenTotal || 0)) + ' tok</span></div>' +
      '</div>';
    }).join('');
  }

  function renderTopInsights(tips) {
    var top = tips.slice(0, 3);
    if (top.length === 0) {
      byId('topInsights').innerHTML = '<div class="empty-state compact">No current recommendations. Your measured sessions look healthy.</div>';
      return;
    }
    byId('topInsights').innerHTML = top.map(function (tip) {
      var kind = tipKind(tip);
      return '<div class="action-item">' +
        '<span class="action-icon ' + (tip.severity === 'warn' ? 'warn' : '') + '">' + escapeHtml(kind.icon) + '</span>' +
        '<div class="action-copy"><strong>' + escapeHtml(kind.label) + '</strong><p>' + escapeHtml(tip.message || '') + '</p>' +
        (savingText(tip) ? '<span class="action-saving">' + escapeHtml(savingText(tip)) + '</span>' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderLive() {
    var summary = state.summary;
    var sessions = Array.isArray(summary.sessions) ? summary.sessions.slice() : [];
    sessions.sort(function (a, b) { return timestampOf(b.lastTimestamp) - timestampOf(a.lastTimestamp); });
    if (sessions.length === 0) {
      byId('liveSessionContent').innerHTML = '<div class="empty-state-card"><div class="empty-icon">⌁</div><h2>No sessions yet</h2><p>Start using Claude Code and this view will show live burn velocity, message-level usage, model changes, and tool-event markers.</p></div>';
      return;
    }

    var activeLatestId = valueAt(summary, ['intelligence', 'active', 'latestSessionId'], null);
    if (!state.selectedSessionId || !sessions.some(function (s) { return s.sessionId === state.selectedSessionId; })) {
      state.selectedSessionId = activeLatestId || sessions[0].sessionId;
    }
    var session = sessions.find(function (item) { return item.sessionId === state.selectedSessionId; }) || sessions[0];
    var now = timestampOf(summary.generatedAt);
    var activeWindow = valueAt(summary, ['intelligence', 'active', 'windowMinutes'], 10) * 60_000;
    var isActive = Number.isFinite(now) && now - timestampOf(session.lastTimestamp) <= activeWindow;
    var models = Array.isArray(session.models) ? session.models : [];
    var currentModel = models.length ? models[models.length - 1] : 'Unknown model';
    var velocity = valueAt(summary, ['intelligence', 'velocity'], {});

    var options = sessions.map(function (item) {
      var label = shortProjectName(item.project) + ' · ' + String(item.sessionId || '').slice(0, 8);
      return '<option value="' + escapeHtmlAttr(item.sessionId) + '"' + (item.sessionId === session.sessionId ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');

    byId('liveSessionContent').innerHTML =
      '<article class="live-hero">' +
        '<div class="live-hero-head">' +
          '<div class="live-identity"><span class="live-status ' + (isActive ? '' : 'inactive') + '"><i></i>' + (isActive ? 'Active now' : 'Recent session') + '</span>' +
          '<h2>' + escapeHtml(shortProjectName(session.project)) + '</h2><p>' + escapeHtml(session.gitBranch || '(no branch)') + ' · ' + escapeHtml(currentModel) + ' · updated ' + escapeHtml(formatRelative(session.lastTimestamp, summary.generatedAt)) + '</p></div>' +
          '<label><span class="sr-only">Select session</span><select id="sessionPicker" class="session-picker">' + options + '</select></label>' +
        '</div>' +
        '<div class="live-metrics">' +
          liveMetric('Total tokens', formatCompact(session.tokenTotal || 0)) +
          liveMetric('Estimated cost', formatCost(session.costUsd || 0)) +
          liveMetric('Messages', formatNumber(session.messageCount || 0)) +
          liveMetric('Session span', formatDuration(session.firstTimestamp, session.lastTimestamp)) +
        '</div>' +
      '</article>' +
      '<div class="live-grid">' +
        '<article class="panel live-timeline-panel"><div class="panel-header"><div><p class="panel-kicker">MESSAGE TIMELINE</p><h3>Token burn and tool activity</h3></div><span class="panel-total">' + escapeHtml(formatNumber(session.messageCount || 0)) + ' messages</span></div>' +
        '<div class="session-chart">' + renderSessionTimeline(session.timeline) + '</div></article>' +
        '<article class="panel session-detail-panel"><div class="panel-header"><div><p class="panel-kicker">SESSION DETAILS</p><h3>Current context</h3></div></div>' +
        '<dl class="session-detail-list">' +
          detailRow('Session ID', '<code>' + escapeHtml(session.sessionId) + '</code>') +
          detailRow('Project', '<code>' + escapeHtml(session.project || 'unknown') + '</code>') +
          detailRow('Branch', '<code>' + escapeHtml(session.gitBranch || '(no branch)') + '</code>') +
          detailRow('Model' + (models.length > 1 ? 's' : ''), escapeHtml(models.join(', ') || 'Unknown')) +
          detailRow('Claude Code version', escapeHtml(session.version || 'Not recorded')) +
          detailRow('Pricing quality', session.estimatedCostUsed ? 'Fallback estimate used' : 'Recognized local pricing rows') +
        '</dl>' +
        '<div class="velocity-card"><span>Workspace velocity · last ' + (velocity.windowMinutes || 15) + ' min</span><strong>' + escapeHtml(formatCompact(velocity.tokensPerMinute || 0)) + ' tokens/min</strong><small>' + escapeHtml(formatCost(velocity.costPerHour || 0)) + '/hour if this short-term pace continues</small></div>' +
        '</article>' +
      '</div>';

    byId('sessionPicker').addEventListener('change', function (event) {
      state.selectedSessionId = event.target.value;
      renderLive();
    });
  }

  function liveMetric(label, value) {
    return '<div class="live-metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function detailRow(label, htmlValue) {
    return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + htmlValue + '</dd></div>';
  }

  function renderSessionTimeline(timeline) {
    var usage = timeline && Array.isArray(timeline.usage) ? timeline.usage : [];
    var tools = timeline && Array.isArray(timeline.tools) ? timeline.tools : [];
    if (usage.length === 0) return '<div class="empty-state compact">No message-level timeline is available for this session.</div>';

    var width = 720;
    var height = 250;
    var padX = 18;
    var padTop = 15;
    var padBottom = 29;
    var plotW = width - padX * 2;
    var plotH = height - padTop - padBottom;
    var maxPoint = Math.max.apply(null, usage.map(function (p) { return p.tokenTotal || 0; })) || 1;
    var cumulative = [];
    var running = 0;
    usage.forEach(function (point) { running += point.tokenTotal || 0;cumulative.push(running); });
    var maxCumulative = running || 1;
    var slot = plotW / usage.length;
    var barWidth = Math.max(1, Math.min(8, slot * .66));
    var bars = '';
    var points = [];

    usage.forEach(function (point, index) {
      var x = padX + slot * index + slot / 2;
      var barH = ((point.tokenTotal || 0) / maxPoint) * plotH;
      var y = padTop + plotH - barH;
      bars += '<rect class="session-bar" x="' + (x - barWidth / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(1, barH).toFixed(1) + '" rx="2"><title>' + escapeHtml(formatTime(point.timestamp) + ' · ' + formatNumber(point.tokenTotal || 0) + ' tokens · ' + formatCost(point.costUsd || 0)) + '</title></rect>';
      var lineY = padTop + plotH - (cumulative[index] / maxCumulative) * plotH;
      points.push(x.toFixed(1) + ',' + lineY.toFixed(1));
    });

    var firstTs = timestampOf(usage[0].timestamp);
    var lastTs = timestampOf(usage[usage.length - 1].timestamp);
    var span = Math.max(1, lastTs - firstTs);
    var ticks = tools.map(function (tool) {
      var ratio = Number.isFinite(timestampOf(tool.timestamp)) ? (timestampOf(tool.timestamp) - firstTs) / span : 0;
      var x = padX + Math.min(1, Math.max(0, ratio)) * plotW;
      return '<line class="tool-tick" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (height - padBottom + 3) + '" y2="' + (height - 8) + '"><title>' + escapeHtml((tool.name || 'tool') + ' · ' + formatTime(tool.timestamp)) + '</title></line>';
    }).join('');

    var summary = usage.length + ' messages shown, ' + formatNumber(running) + ' cumulative tokens, and ' + tools.length + ' tool event' + (tools.length === 1 ? '' : 's') + '.';
    return '<p class="chart-summary">' + escapeHtml(summary) + '</p><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Per-message tokens with cumulative burn and tool markers">' +
      '<line class="chart-grid-line" x1="' + padX + '" y1="' + (padTop + plotH) + '" x2="' + (width - padX) + '" y2="' + (padTop + plotH) + '"></line>' +
      '<line class="chart-grid-line" x1="' + padX + '" y1="' + (padTop + plotH / 2) + '" x2="' + (width - padX) + '" y2="' + (padTop + plotH / 2) + '"></line>' +
      bars + '<polyline class="session-line" points="' + points.join(' ') + '"></polyline>' + ticks +
      '<text class="chart-label" x="' + padX + '" y="' + (height - 7) + '">' + escapeHtml(formatTime(usage[0].timestamp)) + '</text>' +
      '<text class="chart-label" text-anchor="end" x="' + (width - padX) + '" y="' + (height - 7) + '">' + escapeHtml(formatTime(usage[usage.length - 1].timestamp)) + '</text>' +
    '</svg>';
  }

  function renderProjects() {
    renderProjectFilterControls();
    var currentProjectKey = projectFilterParams().toString();
    var projectScopePending = projectFiltersActive() && state.projectSummaryKey !== currentProjectKey;
    var projectSummary = projectFiltersActive()
      ? (projectScopePending ? null : state.projectSummary)
      : state.summary;
    var projects = projectSummary && Array.isArray(projectSummary.byProject) ? projectSummary.byProject.slice() : [];
    projects.sort(function (a, b) { return (b.costUsd || 0) - (a.costUsd || 0); });
    if (state.projectQuery) {
      projects = projects.filter(function (project) {
        return String(project.project || '').toLowerCase().indexOf(state.projectQuery) !== -1;
      });
    }
    var allProjectCost = (projectSummary && projectSummary.byProject || []).reduce(function (sum, project) { return sum + (project.costUsd || 0); }, 0);
    var table = byId('projectsTable');
    renderProjectFilterSummary(projectSummary);

    if ((state.projectLoading || projectScopePending) && !projectSummary) {
      table.innerHTML = '<div class="empty-state compact">Updating filtered local usage…</div>';
    } else if (projects.length === 0) {
      var emptyCopy = state.projectQuery
        ? 'No projects match “' + escapeHtml(state.projectQuery) + '” in this usage scope.'
        : 'No project usage matches the selected filters.';
      table.innerHTML = '<div class="empty-state">' + emptyCopy + '</div>';
    } else {
      var rows = projects.map(function (project) {
        var expanded = state.expandedProject === project.project;
        var share = allProjectCost > 0 ? (project.costUsd || 0) / allProjectCost : 0;
        var sessions = expanded ? '<div class="project-session-details">' + project.sessions.slice(0, 8).map(function (session) {
          return '<div class="project-session-row"><code>' + escapeHtml(String(session.sessionId || '').slice(0, 12)) + '</code><span>' + escapeHtml(formatCompact(session.tokenTotal || 0)) + ' tokens</span><strong>' + escapeHtml(formatCost(session.costUsd || 0)) + '</strong></div>';
        }).join('') + '</div>' : '';
        return '<button type="button" class="project-table-row" data-project-row="' + escapeHtmlAttr(project.project) + '" aria-expanded="' + expanded + '">' +
          '<span class="project-name-cell"><i class="project-avatar">' + escapeHtml(projectInitial(project.project)) + '</i><span><strong title="' + escapeHtmlAttr(project.project) + '">' + escapeHtml(shortProjectName(project.project)) + '</strong><span>' + escapeHtml(project.project) + '</span></span></span>' +
          '<span class="table-number">' + project.sessions.length + '</span>' +
          '<span class="table-number">' + escapeHtml(formatCompact(project.tokenTotal || 0)) + '</span>' +
          '<span class="table-number strong">' + escapeHtml(formatCost(project.costUsd || 0)) + '</span>' +
          '<span class="share-cell"><span class="share-bar"><span style="width:' + (share * 100).toFixed(2) + '%"></span></span><span class="table-number">' + escapeHtml(formatPercent(share)) + '</span></span>' +
        '</button>' + sessions;
      }).join('');
      table.innerHTML = '<div class="table-head"><span>Project</span><span>Sessions</span><span>Tokens</span><span>Est. cost</span><span>Cost share</span></div>' + rows;
      table.querySelectorAll('[data-project-row]').forEach(function (row) {
        row.addEventListener('click', function () {
          var project = row.getAttribute('data-project-row');
          state.expandedProject = state.expandedProject === project ? null : project;
          renderProjects();
        });
      });
    }
    renderBranches(projectSummary);
  }

  function renderBranches(projectSummary) {
    var branches = projectSummary && Array.isArray(projectSummary.byBranch) ? projectSummary.byBranch.slice() : [];
    branches.sort(function (a, b) { return (b.costUsd || 0) - (a.costUsd || 0); });
    var target = byId('branchBreakdown');
    if (branches.length === 0) {
      target.innerHTML = '<div class="empty-state compact">No branch usage matches the selected scope.</div>';
      return;
    }
    target.innerHTML = branches.slice(0, 9).map(function (branch) {
      return '<div class="branch-card"><code title="' + escapeHtmlAttr(branch.branch) + '">' + escapeHtml(branch.branch) + '</code><div><span>' + branch.sessions.length + ' session' + (branch.sessions.length === 1 ? '' : 's') + '</span><strong>' + escapeHtml(formatCost(branch.costUsd || 0)) + '</strong></div><div><span>' + escapeHtml(formatCompact(branch.tokenTotal || 0)) + ' tokens</span><span>exact message split</span></div></div>';
    }).join('');
  }

  function renderInsights() {
    var allTips = rankedTips(state.summary.tips || []);
    var warnCount = allTips.filter(function (tip) { return tip.severity === 'warn'; }).length;
    var infoCount = allTips.length - warnCount;
    var savingsUsd = allTips.reduce(function (sum, tip) { return sum + finiteOr0(tip.estimatedSavingsUsd); }, 0);
    var savingsTokens = allTips.reduce(function (sum, tip) { return sum + finiteOr0(tip.estimatedSavingsTokens); }, 0);

    byId('filterAllCount').textContent = allTips.length;
    byId('filterWarnCount').textContent = warnCount;
    byId('filterInfoCount').textContent = infoCount;
    byId('totalSavings').textContent = savingsUsd > 0 ? formatCost(savingsUsd) : (savingsTokens > 0 ? formatCompact(savingsTokens) + ' tok' : '—');
    byId('totalSavingsTokens').textContent = savingsTokens > 0
      ? formatNumber(savingsTokens) + ' estimated tokens · recommendations may overlap'
      : 'Savings appear only when they can be calculated';

    var filtered = state.insightFilter === 'all' ? allTips : allTips.filter(function (tip) {
      return state.insightFilter === 'warn' ? tip.severity === 'warn' : tip.severity !== 'warn';
    });
    var list = byId('insightsList');
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state-card"><div class="empty-icon">✓</div><h2>No matching recommendations</h2><p>The selected category has no current findings. Insights update automatically as local sessions change.</p></div>';
      return;
    }

    list.innerHTML = filtered.map(function (tip) {
      var kind = tipKind(tip);
      var saving = savingText(tip);
      return '<article class="insight-card ' + (tip.severity === 'warn' ? 'warn' : '') + '">' +
        '<span class="insight-icon ' + (tip.severity === 'warn' ? 'warn' : '') + '">' + escapeHtml(kind.icon) + '</span>' +
        '<div class="insight-copy"><h3>' + escapeHtml(kind.label) + '</h3><p>' + escapeHtml(tip.message || '') + '</p><div class="insight-meta"><span class="severity-badge ' + (tip.severity === 'warn' ? '' : 'info') + '">' + escapeHtml(tip.severity === 'warn' ? 'Attention' : 'Optimize') + '</span><span>Session ' + escapeHtml(String(tip.sessionId || '').slice(0, 12)) + '</span></div></div>' +
        '<div class="insight-side">' + (saving ? '<strong>' + escapeHtml(saving) + '</strong><span>estimated opportunity</span>' : '<strong>Actionable</strong><span>impact not quantified</span>') + '<button class="session-button" type="button" data-view-session="' + escapeHtmlAttr(tip.sessionId || '') + '">View session</button></div>' +
      '</article>';
    }).join('');

    list.querySelectorAll('[data-view-session]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.selectedSessionId = button.getAttribute('data-view-session');
        setView('live');
      });
    });
  }

  function renderSettings() {
    if (state.settingsHydrated) return;
    var config = state.summary.config || {};
    setInputValue('dailyTokenCap', config.dailyTokenCap);
    setInputValue('dailyCostCapUsd', config.dailyCostCapUsd);
    setInputValue('sessionCostCapUsd', config.sessionCostCapUsd);
    setInputValue('warnThresholdPct', config.warnThresholdPct == null ? 80 : config.warnThresholdPct);
    byId('pricingVerifiedOn').textContent = valueAt(state.summary, ['pricing', 'verifiedOn'], 'Unknown');
    state.settingsHydrated = true;
  }

  function setInputValue(id, value) {
    byId(id).value = value == null ? '' : String(value);
  }

  function hydrateProjectFilterState() {
    var params = new URLSearchParams(window.location.search);
    var range = params.get('range');
    if (['all', '7d', '30d', '90d', 'custom'].indexOf(range) !== -1) state.projectRange = range;
    state.projectModel = (params.get('model') || '').trim();
    state.projectFrom = validLocalDate(params.get('from')) ? params.get('from') : '';
    state.projectTo = validLocalDate(params.get('to')) ? params.get('to') : '';
    if ((state.projectFrom || state.projectTo) && state.projectRange === 'all') state.projectRange = 'custom';
  }

  function hydrateProjectModelOptions(summary) {
    if (!dom.projectModel) return;
    var models = new Set();
    (Array.isArray(summary.sessions) ? summary.sessions : []).forEach(function (session) {
      (Array.isArray(session.models) ? session.models : []).forEach(function (model) {
        if (model) models.add(String(model));
      });
    });
    var values = Array.from(models).sort(function (a, b) { return a.localeCompare(b); });
    if (state.projectModel && values.indexOf(state.projectModel) === -1) values.unshift(state.projectModel);
    dom.projectModel.replaceChildren();
    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All models';
    dom.projectModel.appendChild(allOption);
    values.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      dom.projectModel.appendChild(option);
    });
    dom.projectModel.value = state.projectModel;
    renderProjectFilterControls();
  }

  function projectFiltersChanged() {
    state.expandedProject = null;
    state.projectSummaryKey = null;
    state.projectError = '';
    renderProjectFilterControls();
    syncProjectFilterUrl();
    refreshProjectSummary();
  }

  function renderProjectFilterControls() {
    document.querySelectorAll('[data-project-range]').forEach(function (button) {
      var active = button.getAttribute('data-project-range') === state.projectRange;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (dom.projectModel) dom.projectModel.value = state.projectModel;
    if (dom.projectFrom) dom.projectFrom.value = state.projectFrom;
    if (dom.projectTo) dom.projectTo.value = state.projectTo;
    if (dom.customRangeFields) dom.customRangeFields.classList.toggle('hidden', state.projectRange !== 'custom');
    if (dom.clearProjectFilters) dom.clearProjectFilters.disabled = !projectFiltersActive();
  }

  function projectFiltersActive() {
    return state.projectRange !== 'all' || Boolean(state.projectModel);
  }

  function projectScopePending() {
    return projectFiltersActive() && state.projectSummaryKey !== projectFilterParams().toString();
  }

  function projectFilterParams() {
    var params = new URLSearchParams();
    var dates = projectDateBounds();
    if (dates.from) params.set('from', dates.from);
    if (dates.to) params.set('to', dates.to);
    if (state.projectModel) params.set('model', state.projectModel);
    return params;
  }

  function projectDateBounds() {
    if (state.projectRange === 'custom') return { from: state.projectFrom || '', to: state.projectTo || '' };
    var days = state.projectRange === '7d' ? 7 : state.projectRange === '30d' ? 30 : state.projectRange === '90d' ? 90 : 0;
    if (!days) return { from: '', to: '' };
    var end = new Date();
    end.setHours(12, 0, 0, 0);
    var start = new Date(end.getTime());
    start.setDate(start.getDate() - (days - 1));
    return { from: localDateString(start), to: localDateString(end) };
  }

  function localDateString(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function validLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var parsed = new Date(value + 'T12:00:00');
    return !Number.isNaN(parsed.getTime()) && localDateString(parsed) === value;
  }

  function syncProjectFilterUrl() {
    var url = new URL(window.location.href);
    ['range', 'model', 'from', 'to'].forEach(function (key) { url.searchParams.delete(key); });
    if (state.projectRange !== 'all') url.searchParams.set('range', state.projectRange);
    if (state.projectModel) url.searchParams.set('model', state.projectModel);
    if (state.projectRange === 'custom') {
      if (state.projectFrom) url.searchParams.set('from', state.projectFrom);
      if (state.projectTo) url.searchParams.set('to', state.projectTo);
    }
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function scheduleProjectRefresh() {
    window.clearTimeout(state.projectRefreshTimer);
    state.projectRefreshTimer = window.setTimeout(refreshProjectSummary, 220);
  }

  async function refreshProjectSummary() {
    if (!state.summary) return;
    var requestId = ++state.projectRequestId;
    var params = projectFilterParams();
    var filterKey = params.toString();
    if (state.projectRange === 'custom' && state.projectFrom && state.projectTo && state.projectFrom > state.projectTo) {
      state.projectError = 'Start date must not be after end date.';
      state.projectLoading = false;
      renderProjects();
      return;
    }
    if (filterKey === '') {
      state.projectSummary = state.summary;
      state.projectSummaryKey = '';
      state.projectLoading = false;
      state.projectError = '';
      renderProjects();
      return;
    }
    state.projectLoading = true;
    state.projectError = '';
    if (state.view === 'projects') renderProjects();
    try {
      var response = await fetch('/api/summary?' + filterKey, { cache: 'no-store' });
      if (!response.ok) throw new Error('Filtered summary request failed');
      var nextSummary = await response.json();
      if (requestId !== state.projectRequestId) return;
      state.projectSummary = nextSummary;
      state.projectSummaryKey = filterKey;
    } catch (error) {
      if (requestId === state.projectRequestId) {
        state.projectError = 'Could not refresh this local usage scope.';
      }
    } finally {
      if (requestId === state.projectRequestId) {
        state.projectLoading = false;
        if (state.view === 'projects') renderProjects();
      }
    }
  }

  function renderProjectFilterSummary(projectSummary) {
    if (!dom.projectFilterSummary) return;
    if (state.projectError) {
      dom.projectFilterSummary.className = 'explorer-summary error';
      dom.projectFilterSummary.textContent = state.projectError;
      return;
    }
    if (state.projectLoading || projectScopePending()) {
      dom.projectFilterSummary.className = 'explorer-summary';
      dom.projectFilterSummary.textContent = 'Updating filtered local usage…';
      return;
    }
    var totals = projectSummary && projectSummary.allTime ? projectSummary.allTime : {};
    var projectCount = projectSummary && Array.isArray(projectSummary.byProject) ? projectSummary.byProject.length : 0;
    var estimated = projectSummary && Array.isArray(projectSummary.sessions) && projectSummary.sessions.some(function (session) {
      return session.estimatedCostUsed === true;
    });
    var rangeLabels = { all: 'All local usage', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', custom: 'Custom range' };
    var scope = rangeLabels[state.projectRange] || 'All local usage';
    if (state.projectRange === 'custom') {
      if (state.projectFrom && state.projectTo) scope += ' · ' + state.projectFrom + ' to ' + state.projectTo;
      else if (state.projectFrom) scope += ' · from ' + state.projectFrom;
      else if (state.projectTo) scope += ' · through ' + state.projectTo;
      else scope += ' · choose dates to narrow usage';
    }
    if (state.projectModel) scope += ' · ' + state.projectModel;
    dom.projectFilterSummary.className = 'explorer-summary' + (estimated ? ' estimated' : '');
    dom.projectFilterSummary.textContent = scope + ' · ' + projectCount + ' project' + (projectCount === 1 ? '' : 's') +
      ' · ' + formatNumber(totals.tokenTotal || 0) + ' tokens · ' + formatCost(totals.costUsd || 0) +
      (estimated ? ' · some cost uses fallback pricing' : '');
  }

  function rankedTips(tips) {
    return (Array.isArray(tips) ? tips.slice() : []).sort(function (a, b) {
      if ((a.severity === 'warn') !== (b.severity === 'warn')) return a.severity === 'warn' ? -1 : 1;
      return finiteOr0(b.estimatedSavingsUsd) - finiteOr0(a.estimatedSavingsUsd);
    });
  }

  function tipKind(tip) {
    var id = String(tip && tip.id || '');
    for (var i = 0; i < TIP_KINDS.length; i++) {
      if (id.indexOf(TIP_KINDS[i].prefix) === 0) return TIP_KINDS[i];
    }
    return { icon: '✦', label: 'Usage opportunity' };
  }

  function savingText(tip) {
    if (tip && typeof tip.estimatedSavingsUsd === 'number' && Number.isFinite(tip.estimatedSavingsUsd)) {
      return tip.estimatedSavingsUsd > 0 && tip.estimatedSavingsUsd < .01
        ? '<$0.01 potential'
        : formatCost(tip.estimatedSavingsUsd) + ' potential';
    }
    if (tip && typeof tip.estimatedSavingsTokens === 'number' && Number.isFinite(tip.estimatedSavingsTokens)) {
      return formatCompact(tip.estimatedSavingsTokens) + ' tok potential';
    }
    return '';
  }

  function projectInitial(project) {
    var name = shortProjectName(project).replace(/^\//, '');
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  function shortProjectName(project) {
    var raw = String(project || 'unknown');
    var parts = raw.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return 'unknown';
    return parts.length === 1 ? parts[0] : parts.slice(-2).join('/');
  }

  function formatNumber(value) {
    return Math.round(finiteOr0(value)).toLocaleString();
  }

  function formatCompact(value) {
    var number = finiteOr0(value);
    var abs = Math.abs(number);
    if (abs >= 1e9) return trimNumber(number / 1e9, 2) + 'B';
    if (abs >= 1e6) return trimNumber(number / 1e6, 2) + 'M';
    if (abs >= 1e3) return trimNumber(number / 1e3, 1) + 'K';
    return String(Math.round(number));
  }

  function trimNumber(value, digits) {
    return value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  }

  function formatCost(value) {
    var number = finiteOr0(value);
    if (number > 0 && number < .01) return '<$0.01';
    return '$' + number.toFixed(2);
  }

  function formatPercent(ratio) {
    return (finiteOr0(ratio) * 100).toFixed(ratio > 0 && ratio < .01 ? 1 : 0) + '%';
  }

  function formatTime(timestamp) {
    var date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelative(timestamp, nowTimestamp) {
    var time = timestampOf(timestamp);
    var now = timestampOf(nowTimestamp);
    if (!Number.isFinite(time) || !Number.isFinite(now)) return 'at an unknown time';
    var seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function formatDuration(first, last) {
    var start = timestampOf(first);
    var end = timestampOf(last);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Unknown';
    var minutes = Math.max(1, Math.round((end - start) / 60_000));
    if (minutes < 60) return minutes + 'm';
    var hours = Math.floor(minutes / 60);
    var remaining = minutes % 60;
    return hours + 'h' + (remaining ? ' ' + remaining + 'm' : '');
  }

  function finiteOr0(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function timestampOf(value) {
    var parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function valueAt(object, path, fallback) {
    var value = object;
    for (var i = 0; i < path.length; i++) {
      if (value == null || typeof value !== 'object') return fallback;
      value = value[path[i]];
    }
    return value == null ? fallback : value;
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    state.toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove('visible');
    }, 2600);
  }

  function setConnection(mode, label) {
    dom.connectionStatus.className = 'connection-pill ' + mode;
    dom.connectionStatus.querySelector('.connection-copy').textContent = label;
  }

  async function connect() {
    setConnection('connecting', 'Connecting');
    try {
      var response = await fetch('/api/summary', { cache: 'no-store' });
      if (response.ok) receiveSummary(await response.json());
    } catch {
      // The SSE connection below remains the source of truth and retries.
    }

    var source = new EventSource('/api/stream');
    source.addEventListener('open', function () {
      setConnection('', 'Live · local');
    });
    source.addEventListener('message', function (event) {
      try {
        receiveSummary(JSON.parse(event.data));
        setConnection('', 'Live · local');
      } catch {
        setConnection('disconnected', 'Invalid local data');
      }
    });
    source.addEventListener('error', function () {
      setConnection('disconnected', 'Reconnecting');
    });
  }
})();
