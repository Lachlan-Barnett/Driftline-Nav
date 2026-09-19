// The full app body. It's injected once via dangerouslySetInnerHTML in App.jsx, then driftline.js
// wires up all the interactivity with plain getElementById/querySelector calls.
// (Lists such as suggestions, the trip stops and the settings rows are filled in by driftline.js.)
export const markup = `
<div id="stage"><canvas id="map"></canvas><canvas id="overlay"></canvas></div>

<div id="topWrap">
  <div id="searchRow">
    <div id="searchCard" class="panel">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="searchInput" type="text" placeholder="Where to in Queensland?" autocomplete="off">
    </div>
    <button id="addStopBtn" class="disabled" aria-label="Add destination" data-tip="Add destination">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>
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

  <div id="tripPanel" class="panel"></div>

  <div id="algPanel" class="panel">
    <div id="algPills">
      <button class="algPill" data-alg="bfs">BFS</button>
      <button class="algPill" data-alg="dfs">DFS</button>
      <button class="algPill" data-alg="ids">IDS</button>
      <button class="algPill" data-alg="dijkstra">Dijkstra</button>
      <button class="algPill" data-alg="astar">A*</button>
      <button class="algPill" data-alg="ida">IDA*</button>
      <button class="algPill" data-alg="wave">Wave</button>
    </div>
    <div id="algDesc">—</div>
    <div id="animateRow"><span>Animate the search</span><div class="switch on" id="animSwitch"></div></div>
    <button class="btnGhost" id="algCompareBtn">Compare all algorithms</button>
    <div id="statsRow" style="display:none;"></div>
  </div>

  <div id="menuPanel" class="panel">
    <b>Features</b>
    <div id="featureList">
      <div class="featureRow"><div class="featureDot"></div>Search and drive to any of 190+ Queensland towns, plus 4,000+ suburbs, villages, hamlets and localities you can search or tap</div>
      <div class="featureRow"><div class="featureDot"></div>Plan a road trip: press + to add destinations, then drag or use the arrows to reorder them. Every leg is searched on its own</div>
      <div class="featureRow"><div class="featureDot"></div>Pick your routing algorithm — BFS, DFS, IDS, Dijkstra, A*, IDA* or Wave — and watch it search the map live, or compare all seven side by side</div>
      <div class="featureRow"><div class="featureDot"></div>Long-press (or right-click) the map to set your start point or report something right there</div>
      <div class="featureRow"><div class="featureDot"></div>Speed limit signs, with slower speeds through built-up areas</div>
      <div class="featureRow"><div class="featureDot"></div>Report police, hazards or crashes: they slow the road they're on, and you're offered a faster route if one appears ahead</div>
      <div class="featureRow"><div class="featureDot"></div>Favourite and recent destinations in the search box</div>
      <div class="featureRow"><div class="featureDot"></div>Turn-by-turn directions with live speed, time and distance remaining, and arrival time</div>
      <div class="featureRow"><div class="featureDot"></div>Pan, scroll-zoom, or pinch-to-zoom the map</div>
    </div>
    <b>Settings</b>
    <div id="settingsList"></div>
    <div id="settingsBtns">
      <button class="smallGhost" data-act="clearRecents">Clear recent destinations</button>
      <button class="smallGhost" data-act="clearFavs">Clear favourites</button>
    </div>
    <div id="menuThemeRow"><span>Dark mode</span><div class="switch" id="menuThemeSwitch"></div></div>
  </div>

  <div id="adminPanel" class="panel">
    <div id="adminHead"><b>Reports</b><button id="clearAllBtn">Clear all reports</button></div>
    <div id="adminList"><div id="adminEmpty">No active reports</div></div>
  </div>

  <div id="rerouteCard" class="panel">
    <div id="rerouteText"></div>
    <div id="rerouteActions">
      <button class="btnGhost" id="rerouteNo">Keep route</button>
      <button class="btnPrimary" id="rerouteYes">Reroute</button>
    </div>
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

<div id="comparePanel" class="panel">
  <div class="cmpHead"><b>Compare algorithms</b><button id="cmpClose" aria-label="Close">✕</button></div>
  <div id="cmpSub"></div>
  <div id="cmpBody"></div>
  <div class="cmpFoot">Every leg of the trip is searched independently by each algorithm. The best value in each column is highlighted; Replay animates that algorithm's search on the map.</div>
</div>

<div id="ctxMenu" class="panel"></div>

<button id="recenterBtn" aria-label="Recenter map">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-7-7 18-2.5-7.5L3 11z"/></svg>
</button>

<div id="previewSheet" class="panel">
  <div id="previewHead">
    <div id="previewTitle">—</div>
    <button class="starBtn" id="favBtn" aria-label="Favourite this destination">☆</button>
  </div>
  <div id="previewMeta">—</div>
  <div id="legList"></div>
  <div id="previewFlag"></div>
  <div id="delayNote"></div>
  <div id="onRouteWrap">
    <div id="onRouteLabel">Reports on the way</div>
    <div id="onRouteList"></div>
  </div>
  <div id="previewActions">
    <button class="btnGhost" id="cancelPreview">Cancel</button>
    <button class="btnGhost" id="compareBtn">Compare</button>
    <button class="btnPrimary" id="startDrive">Start drive</button>
  </div>
</div>

<div id="speedHud" class="panel">
  <div class="limitSign" id="limitSign"><span id="limitNum">100</span></div>
  <div id="speedNow"><b id="hudSpeed">0</b><span>km/h</span></div>
</div>

<div id="driveHud" class="panel">
  <div id="hudStop"></div>
  <div class="hudRow">
    <div class="hudStat"><b id="hudTime">–</b><span>time left</span></div>
    <div class="hudDivider"></div>
    <div class="hudStat"><b id="hudDist">–</b><span>km left</span></div>
    <div class="hudDivider"></div>
    <div class="hudStat"><b id="hudEta">–</b><span>arrival</span></div>
  </div>
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
