// The full app body, lifted verbatim from the original hand-built HTML page.
// It's injected once via dangerouslySetInnerHTML in App.jsx, then driftline.js
// (an ordinary DOM script, unchanged in behavior) wires up all the interactivity
// with plain getElementById/querySelector calls, exactly as it did as a static page.
export const markup = `
<div id="stage"><canvas id="map"></canvas></div>

<div id="topWrap">
  <div id="searchRow">
    <div id="searchCard" class="panel">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="searchInput" type="text" placeholder="Where to in Queensland?" autocomplete="off">
    </div>
    <button id="algBtn" aria-label="Routing algorithm">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.6"/><circle cx="12" cy="18" r="2.6"/><circle cx="18" cy="9" r="2.6"/><path d="M8.2 7.4L10 16.2M14 16.7L16.3 10.6M8 5.4h7.4"/></svg>
    </button>
    <button id="adminBtn" aria-label="Manage reports">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 3v2h6V3M9 9.5h6M9 13h6M9 16.5h4"/></svg>
    </button>
    <button id="menuBtn" aria-label="Menu">
      <span class="menuLine"></span><span class="menuLine"></span><span class="menuLine"></span>
    </button>
  </div>

  <div id="algPanel" class="panel">
    <div id="algPills">
      <button class="algPill" data-alg="bfs">BFS</button>
      <button class="algPill" data-alg="dfs">DFS</button>
      <button class="algPill" data-alg="ids">IDS</button>
      <button class="algPill" data-alg="dijkstra">Dijkstra</button>
      <button class="algPill" data-alg="astar">A*</button>
      <button class="algPill" data-alg="ida">IDA*</button>
    </div>
    <div id="algDesc">—</div>
    <div id="animateRow"><span>Animate the search</span><div class="switch on" id="animSwitch"></div></div>
    <div id="statsRow" style="display:none;"></div>
  </div>

  <div id="menuPanel" class="panel">
    <b>Features</b>
    <div id="featureList">
      <div class="featureRow"><div class="featureDot"></div>Search and drive to any of 190+ Queensland towns, plus 3,900+ suburbs, villages, hamlets and localities you can search or tap</div>
      <div class="featureRow"><div class="featureDot"></div>Pick your routing algorithm — BFS, DFS, IDS, Dijkstra, A*, or IDA* — and watch it search the map live</div>
      <div class="featureRow"><div class="featureDot"></div>Turn-by-turn directions with live speed, time and distance remaining, and arrival time</div>
      <div class="featureRow"><div class="featureDot"></div>Report police, hazards or crashes, and see what's on the way to your destination</div>
      <div class="featureRow"><div class="featureDot"></div>Manage reports — remove one, clear a type, or clear everything</div>
      <div class="featureRow"><div class="featureDot"></div>Pan, scroll-zoom, or pinch-to-zoom the map</div>
    </div>
    <div id="menuThemeRow"><span>Dark mode</span><div class="switch" id="menuThemeSwitch"></div></div>
  </div>

  <div id="adminPanel" class="panel">
    <div id="adminHead"><b>Reports</b><button id="clearAllBtn">Clear all reports</button></div>
    <div id="adminList"><div id="adminEmpty">No active reports</div></div>
  </div>

  <div id="turnCard" class="panel">
    <div id="turnIcon"></div>
    <div id="turnText"><div id="turnMain">Continue straight</div><div id="turnSub">on the highway</div></div>
    <button id="exitBtn" aria-label="End drive">✕</button>
  </div>

  <div id="routeReportsPanel" class="panel">
    <div id="routeReportsLabel">Reports ahead</div>
    <div id="routeReportsList"></div>
  </div>
</div>

<div id="suggestBox" class="panel"></div>

<div id="controls">
  <div id="zoomGroup"><button id="zoomIn" aria-label="Zoom in">+</button><button id="zoomOut" aria-label="Zoom out">–</button></div>
</div>

<button id="recenterBtn" aria-label="Recenter map">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-7-7 18-2.5-7.5L3 11z"/></svg>
</button>

<div id="previewSheet" class="panel">
  <div id="previewTitle">—</div>
  <div id="previewMeta">—</div>
  <div id="previewFlag"></div>
  <div id="onRouteWrap">
    <div id="onRouteLabel">Reports on the way</div>
    <div id="onRouteList"></div>
  </div>
  <div id="previewActions">
    <button class="btnGhost" id="cancelPreview">Cancel</button>
    <button class="btnPrimary" id="startDrive">Start drive</button>
  </div>
</div>

<div id="driveHud" class="panel">
  <div class="hudStat"><b id="hudSpeed">0</b><span>km/h</span></div>
  <div class="hudDivider"></div>
  <div class="hudStat"><b id="hudTime">–</b><span>time left</span></div>
  <div class="hudDivider"></div>
  <div class="hudStat"><b id="hudDist">–</b><span>km left</span></div>
  <div class="hudDivider"></div>
  <div class="hudStat"><b id="hudEta">–</b><span>arrival</span></div>
</div>

<div id="toastWrap"></div>
<div id="cityTag">Queensland · stylised map · © OpenStreetMap contributors</div>

<div id="reportsFanLayer"></div>
<div id="reportsFabWrap">
  <button id="reportsFab" aria-label="Report an incident">
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".9" fill="currentColor"/></svg>
    <span id="reportsBadge">0</span>
  </button>
</div>

`;
