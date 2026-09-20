// Driftline: everything the app does in the browser. The map data and routing live in
// graph.js / algorithms.js (pure, tested without a browser); this file is the interface on top:
// canvas drawing, camera, search, trip planner, navigation, reports, settings.
//
// Real-world map data (the credit is in the map footer), built by scripts/:
//   places.json      extra named places, [name, lat, lon, kind]
//   local-roads.json the local road linking each of those places in, with its real shape
//   roads.json       the real driving shape of each road in network.js
//   junctions.json   where roads that share a road out of a town fork (real junction nodes)
//   speeds.json      the signed speed limit of each road
//   coast.json       the real coastline (mainland + islands)
import PLACE_DATA from './data/places.json';
import LOCAL_ROADS from './data/local-roads.json';
import SPEED_LIMITS from './data/speeds.json';
import ROAD_SHAPES from './data/roads.json';
import COAST from './data/coast.json';
import JUNCTIONS from './data/junctions.json';
import { TOWNS, ROADS } from './data/network.js';
import { WORLD_W, WORLD_H, KM_PER_UNIT } from './projection.js';
import { createGraph } from './graph.js';
import { createAlgorithms } from './algorithms.js';

export function initDriftline() {
  let rafId = null;
  const cleanupFns = [];
  try{
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ============== PREFERENCES + SETTINGS (persisted per-browser) ============== */
  function loadPrefs(){
    try{ const raw=localStorage.getItem('driftline_qld_prefs'); if(raw) return JSON.parse(raw); }catch(err){}
    return {};
  }
  function savePrefs(patch){
    try{ const cur=loadPrefs(); localStorage.setItem('driftline_qld_prefs', JSON.stringify(Object.assign(cur, patch))); }catch(err){}
  }
  const prefs = loadPrefs();
  const SETTING_DEFS = [
    { key:'speedSigns',    label:'Speed limit signs',                  def:true },
    { key:'builtUp',       label:'Slower speeds in built-up areas',    def:true },
    { key:'avoidReports',  label:'Avoid reports when routing',         def:true },
    { key:'offerReroute',  label:'Offer reroutes while driving',       def:true },
    { key:'showPlaces',    label:'Show suburbs, villages & local roads', def:true },
    { key:'animate',       label:'Animate the search',                 def:true },
    { key:'bidirectional', label:'Bidirectional search',               def:false },
  ];
  const settings = {};
  SETTING_DEFS.forEach(d=>{
    const saved = prefs.settings && prefs.settings[d.key];
    settings[d.key] = typeof saved==='boolean' ? saved
      : (d.key==='animate' && typeof prefs.animate==='boolean') ? prefs.animate : d.def;
  });
  function saveSettings(){ savePrefs({ settings:Object.assign({}, settings), animate:settings.animate }); }

  /* ============== GRAPH + ALGORITHMS ============== */
  const graph = createGraph({ towns:TOWNS, roads:ROADS, roadShapes:ROAD_SHAPES, speedLimits:SPEED_LIMITS,
    coast:COAST, places:PLACE_DATA, localRoads:LOCAL_ROADS, junctions:JUNCTIONS }, settings);
  const { nodes, edges, NID, places, LAND, edgeSeconds, edgeKm, pointAlong, edgeBearing } = graph;
  const { ALGS, runDijkstra } = createAlgorithms(graph);

  /* ============== CANVAS / CAMERA ============== */
  const canvas=$('map'), ctx=canvas.getContext('2d');
  // A second transparent canvas over the map holds the things that pulse (you and the reports), so the
  // pulse redraws a few shapes instead of the whole map.
  const overlay=$('overlay'), octx=overlay.getContext('2d');
  let dpr=Math.min(window.devicePixelRatio||1,2), scale=1, offsetX=0, offsetY=0, W=0,H=0;
  function resize(){
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(W*dpr)); canvas.height=Math.max(1,Math.round(H*dpr));
    overlay.width=canvas.width; overlay.height=canvas.height;
  }
  function handleViewportChange(){ resize(); if(!hasInteracted) fitToState(); }
  window.addEventListener('resize', handleViewportChange);
  cleanupFns.push(()=> window.removeEventListener('resize', handleViewportChange));
  function handleOrientationChange(){ setTimeout(handleViewportChange, 60); }
  window.addEventListener('orientationchange', handleOrientationChange);
  cleanupFns.push(()=> window.removeEventListener('orientationchange', handleOrientationChange));
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', handleViewportChange);
    cleanupFns.push(()=> window.visualViewport.removeEventListener('resize', handleViewportChange));
  }
  const textWidths=new Map();          // label widths at the 12 px label font; cleared once the web font has loaded
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>textWidths.clear());
  const HAS_PATH2D = typeof Path2D !== 'undefined';
  let landPath=null;
  function getLandPath(){
    if(!landPath){ landPath=new Path2D(); LAND.forEach(poly=>{ poly.forEach((p,i)=> i===0?landPath.moveTo(p.x,p.y):landPath.lineTo(p.x,p.y)); landPath.closePath(); }); }
    return landPath;
  }
  function edgePath(e){
    if(!e.path2d){ const p=new Path2D(); e.pts.forEach((q,i)=> i===0?p.moveTo(q.x,q.y):p.lineTo(q.x,q.y)); e.path2d=p; }
    return e.path2d;
  }
  const MIN_SCALE=0.35, MAX_SCALE=300;
  function clampScale(v){ return Math.max(MIN_SCALE, Math.min(MAX_SCALE, v)); }
  function screenToWorld(sx,sy){ return {x:(sx-offsetX)/scale, y:(sy-offsetY)/scale}; }
  function fitToState(){
    const pad=60;
    scale = Math.min((W-pad*2)/WORLD_W, (H-pad*2)/WORLD_H);
    offsetX = W/2 - (WORLD_W/2)*scale; offsetY = H/2 - (WORLD_H/2)*scale;
  }
  function centerOn(x,y){ offsetX=W/2-x*scale; offsetY=H/2-y*scale; }

  const START_NODE = NID["Brisbane"];
  let car = { x:nodes[START_NODE].x, y:nodes[START_NODE].y, heading:-Math.PI/2 };
  let hasInteracted=false;
  resize(); fitToState();

  // zoom level at which each rank gets a name label (ranks 1-4 towns, 3-8 extra places)
  const LABEL_MIN_SCALE = {1:0, 2:0.8, 3:1.2, 4:2.2, 5:3.6, 6:5.5, 7:12, 8:24};
  function placeVisible(p){ return settings.showPlaces && scale>=LABEL_MIN_SCALE[p.rank]*0.75; } // dots appear a little before their names do

  /* ============== PAN / ZOOM / TAP / LONG-PRESS ============== */
  let dragging=false, dragMoved=false, lastX=0, lastY=0, followMode=false;
  const activePointers = new Map(); // pointerId -> {x,y}
  let pinchActive=false, pinchLastDist=0;
  let longPressTimer=null, longPressFired=false, pressStart=null;
  function ptDist(p1,p2){ return Math.hypot(p1.x-p2.x, p1.y-p2.y); }
  function ptMid(p1,p2){ return {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2}; }
  function cancelLongPress(){ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; } }

  canvas.addEventListener('pointerdown', e=>{
    closeCtxMenu();
    canvas.style.cursor=''; // let the .dragging grab cursor take over while panning
    canvas.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(activePointers.size===1){
      dragging=true; dragMoved=false; pinchActive=false; canvas.classList.add('dragging');
      lastX=e.clientX; lastY=e.clientY;
      longPressFired=false; cancelLongPress();
      if(e.button===0 || e.button===undefined){
        pressStart={x:e.clientX, y:e.clientY};
        longPressTimer=setTimeout(()=>{
          longPressTimer=null;
          if(activePointers.size!==1 || pinchActive) return;
          longPressFired=true; openCtxMenuAt(pressStart.x, pressStart.y);
        }, 550);
      }
    } else if(activePointers.size===2){
      cancelLongPress();
      dragging=false; pinchActive=true; dragMoved=true; // a two-finger touch is never a tap
      const pts=[...activePointers.values()];
      pinchLastDist = ptDist(pts[0], pts[1]);
    }
  });

  // the town / extra place under a screen position, if any (towns win ties)
  function nodeAtClient(clientX, clientY){
    const rect=canvas.getBoundingClientRect(); const w=screenToWorld(clientX-rect.left, clientY-rect.top);
    let best=null,bestD=20/scale;
    for(const n of nodes){ if(n.virtual) continue; const d=Math.hypot(n.x-w.x,n.y-w.y); if(d<bestD){bestD=d;best=n;} }
    for(const p of places){ if(!placeVisible(p)) continue; const d=Math.hypot(p.x-w.x,p.y-w.y); if(d<bestD){bestD=d;best=p;} }
    return best;
  }
  canvas.addEventListener('pointermove', e=>{
    if(!activePointers.has(e.pointerId)){
      // plain hover (no button/finger down) — show a pointer over anything tappable
      if(e.pointerType==='mouse') canvas.style.cursor = nodeAtClient(e.clientX, e.clientY) ? 'pointer' : '';
      return;
    }
    activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(pressStart && Math.hypot(e.clientX-pressStart.x, e.clientY-pressStart.y)>8) cancelLongPress();

    if(activePointers.size>=2){
      const pts=[...activePointers.values()].slice(0,2);
      const newDist = ptDist(pts[0], pts[1]);
      const mid = ptMid(pts[0], pts[1]);
      const rect = canvas.getBoundingClientRect();
      const midX = mid.x-rect.left, midY = mid.y-rect.top;
      if(pinchLastDist>0 && newDist>0){
        const before = screenToWorld(midX, midY);
        scale = clampScale(scale*(newDist/pinchLastDist));
        offsetX = midX - before.x*scale; offsetY = midY - before.y*scale;
      }
      pinchLastDist = newDist;
      hasInteracted = true;
      if(followMode){ followMode=false; $('recenterBtn').classList.add('show'); }
      return;
    }

    if(!dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    if(Math.abs(dx)+Math.abs(dy)>3) dragMoved=true;
    offsetX+=dx; offsetY+=dy; lastX=e.clientX; lastY=e.clientY;
    if(dragMoved){ hasInteracted=true; if(followMode){ followMode=false; $('recenterBtn').classList.add('show'); } }
  });

  function endPointer(e){
    if(!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    cancelLongPress();
    if(activePointers.size===1){
      // one finger lifted out of a pinch — resume single-finger pan from here, no jump, no tap
      const p=[...activePointers.values()][0];
      dragging=true; dragMoved=true; pinchActive=false; pinchLastDist=0;
      lastX=p.x; lastY=p.y;
    } else if(activePointers.size===0){
      const wasGesture = dragMoved || pinchActive;
      canvas.classList.remove('dragging');
      if(dragging && !wasGesture && !longPressFired) handleTap(e);
      dragging=false; pinchActive=false; pinchLastDist=0; longPressFired=false;
    }
  }
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', e=>{ e.preventDefault(); cancelLongPress(); openCtxMenuAt(e.clientX, e.clientY); });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault(); hasInteracted=true;
    const before=screenToWorld(e.offsetX,e.offsetY);
    scale = clampScale(scale*(e.deltaY<0?1.15:0.87));
    offsetX=e.offsetX-before.x*scale; offsetY=e.offsetY-before.y*scale;
  }, {passive:false});
  $('zoomIn').onclick=()=>zoomStep(1.2);
  $('zoomOut').onclick=()=>zoomStep(0.83);
  function zoomStep(f){ hasInteracted=true; const before=screenToWorld(W/2,H/2); scale=clampScale(scale*f);
    offsetX=W/2-before.x*scale; offsetY=H/2-before.y*scale; }
  $('recenterBtn').onclick=()=>{
    followMode=true; $('recenterBtn').classList.remove('show');
    if(!navActive) fitToState();
  };
  function handleTap(e){
    if(fanOpen) closeFan();
    const best=nodeAtClient(e.clientX, e.clientY);
    if(best) handlePick(best);
    else if(!navActive && $('previewSheet').classList.contains('show')) cancelTrip();
  }

  /* ============== HAZARDS (reports) ============== */
  function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  let hazards=[];
  try{
    const raw=localStorage.getItem('driftline_qld_hazards');
    if(raw) hazards=JSON.parse(raw).filter(h=>Date.now()-h.t<20*60*1000).map(h=> h.id ? h : Object.assign({}, h, {id:genId()}));
  }catch(err){ hazards=[]; }
  graph.recomputeDelays(hazards);
  function saveHazards(){ try{ localStorage.setItem('driftline_qld_hazards', JSON.stringify(hazards)); }catch(err){} }
  const TYPE_LABELS={police:'Police', hazard:'Hazard', crash:'Crash'};
  const TYPE_COLORS={police:'--blue', hazard:'--amber', crash:'--red'};
  function timeAgo(t){
    const s=Math.floor((Date.now()-t)/1000);
    if(s<60) return s+'s ago';
    const m=Math.floor(s/60);
    if(m<60) return m+'m ago';
    return Math.floor(m/60)+'h ago';
  }
  // Reports are put on the road (snapped to the nearest one), and slow that road down: see graph.recomputeDelays.
  // heading = the way you were driving when you reported it; without one it applies to both directions
  function addHazardAt(type, wx, wy, heading){
    const hit=graph.nearestRoadPoint(wx,wy);
    const x = hit && hit.d<6 ? hit.x : wx, y = hit && hit.d<6 ? hit.y : wy;
    hazards.push({id:genId(), type, x, y, t:Date.now(), heading}); saveHazards();
    const where = hit && hit.d<6 ? ' on '+edges[hit.edgeIdx].name : ' nearby';
    showToast(TYPE_LABELS[type]+' reported'+where+(heading!==undefined ? ' (your direction)' : ''));
    hazardsChanged();
  }
  function addHazard(type){ addHazardAt(type, car.x, car.y, navActive ? car.heading : undefined); }
  let replanTimer=null;
  function hazardsChanged(){
    graph.recomputeDelays(hazards);
    updateBadge();
    if(adminPanel.classList.contains('show')) refreshAdminList();
    dismissReroute(false);
    if(navActive){ updateRouteReportsPanel(); checkReroute(); }
    else if(trip.stops.length && !replanTimer){
      replanTimer=setTimeout(()=>{ replanTimer=null; if(!navActive && trip.stops.length) planTrip(); }, 60);
    }
  }

  /* ---- "on the way" report matching ---- */
  const ON_ROUTE_UNITS = 0.7;   // ~1.3 km: a report counts as on a road only if it is really on it
  // Reports on the route that matter to you: on a road of the route, applying to the way you drive it
  // (not the opposite carriageway), and not already behind you on the road you are on (carAlong = how far
  // along that first road the car is, in map units).
  function hazardsOnRoute(path, fromIdx, carAlong){
    if(!path) return [];
    const start=fromIdx||0, out=[];
    hazards.forEach(h=>{
      for(let i=start;i<path.length;i++){
        const seg=path[i], e=edges[seg.edgeIdx]; if(e.removed) continue;
        const bb=e.bbox; if(h.x<bb.x0-ON_ROUTE_UNITS || h.x>bb.x1+ON_ROUTE_UNITS || h.y<bb.y0-ON_ROUTE_UNITS || h.y>bb.y1+ON_ROUTE_UNITS) continue;
        const hit=graph.projectOnEdge(e, h.x, h.y);
        if(!hit || hit.d>ON_ROUTE_UNITS) continue;
        const fwd=seg.from===e.a, dir=graph.reportDirection(e, hit.dist, h.heading);
        if(dir!=='both' && (dir==='fwd')!==fwd) continue;              // it is on the other side / other way
        const along = fwd ? hit.dist : e.len-hit.dist;                  // how far into this road we meet it
        if(i===start && carAlong!==undefined && along < carAlong-0.05) continue;   // already passed it
        out.push(h); break;
      }
    });
    return out;
  }
  function renderRouteReportRows(list){
    return list.map(h=>`<div class="routeReportRow">
      <div class="routeReportDot" style="background:var(${TYPE_COLORS[h.type]})"></div>
      <div class="routeReportName">${TYPE_LABELS[h.type]}</div>
      <div class="routeReportTime">${timeAgo(h.t)}</div>
    </div>`).join('');
  }
  function updateRouteReportsPanel(){
    const panel=$('routeReportsPanel');
    const list=$('routeReportsList');
    if(!navActive || !currentPath){ panel.classList.remove('show'); return; }
    const onRoute = hazardsOnRoute(currentPath, navSegIdx, navCarAlong);
    if(onRoute.length>0){ list.innerHTML=renderRouteReportRows(onRoute); panel.classList.add('show'); }
    else { panel.classList.remove('show'); list.innerHTML=''; }
  }

  /* ============== REPORT FAB — fans out Police/Hazard/Crash buttons ============== */
  const REPORT_TYPES = [
    {type:'police', label:'Police', icon:'<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z"/><path d="M9.5 12.5l2 2 3.5-4"/>'},
    {type:'hazard', label:'Hazard', icon:'<path d="M12 3l9.5 17H2.5L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor" stroke="none"/>'},
    {type:'crash', label:'Crash', icon:'<path d="M3 12l3-6h12l3 6"/><path d="M3 12v4h2m14-4v4h-2"/><path d="M7 16h10"/><circle cx="7.5" cy="16.5" r="1.4"/><circle cx="16.5" cy="16.5" r="1.4"/>'},
  ];
  const reportsFab=$('reportsFab');
  const reportsBadge=$('reportsBadge');
  const fanLayer=$('reportsFanLayer');
  let fanOpen=false;

  function updateBadge(){
    if(hazards.length>0){ reportsBadge.textContent=hazards.length; reportsBadge.style.display='flex'; }
    else{ reportsBadge.style.display='none'; }
  }
  function chipAngleFor(i,n){
    const start=170, end=280; // safe on-screen sweep from a bottom-right corner anchor
    const t = n<=1 ? 0.5 : i/(n-1);
    return (start + t*(end-start)) * Math.PI/180;
  }
  function buildReportChip(def,i,n){
    const wrap=document.createElement('div'); wrap.className='reportChip';
    const inner=document.createElement('div'); inner.className='chipInner'; inner.style.color=`var(${TYPE_COLORS[def.type]})`;
    inner.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${def.icon}</svg>`;
    const label=document.createElement('div'); label.className='chipLabel'; label.style.color='var(--text)'; label.textContent=def.label;
    inner.appendChild(label); wrap.appendChild(inner);
    const angle=chipAngleFor(i,n), R=92;
    inner.style.setProperty('--dx', (Math.cos(angle)*R).toFixed(1)+'px');
    inner.style.setProperty('--dy', (Math.sin(angle)*R).toFixed(1)+'px');
    inner.addEventListener('click', ev=>{ ev.stopPropagation(); addHazard(def.type); closeFan(); });
    return wrap;
  }
  function syncControlsRecede(){
    const anyOpen = fanOpen
      || algPanel.classList.contains('show')
      || adminPanel.classList.contains('show')
      || menuPanel.classList.contains('show');
    $('controls').classList.toggle('receded', anyOpen);
  }
  function openFan(){
    fanOpen=true; reportsFab.classList.add('fanIsOpen');
    syncControlsRecede();
    fanLayer.innerHTML='';
    REPORT_TYPES.forEach((def,i)=> fanLayer.appendChild(buildReportChip(def,i,REPORT_TYPES.length)));
    requestAnimationFrame(()=> fanLayer.querySelectorAll('.reportChip').forEach(c=>c.classList.add('open')) );
  }
  function closeFan(){
    fanOpen=false; reportsFab.classList.remove('fanIsOpen');
    syncControlsRecede();
    fanLayer.querySelectorAll('.reportChip').forEach(c=>c.classList.remove('open'));
    setTimeout(()=>{ if(!fanOpen) fanLayer.innerHTML=''; }, 400);
  }
  function toggleFan(){
    closeAdminPanel(); algPanel.classList.remove('show'); algBtn.classList.remove('active'); closeMenu();
    fanOpen ? closeFan() : openFan();
  }
  reportsFab.addEventListener('click', toggleFan);
  updateBadge();

  /* ============== ADMIN PANEL (view / remove existing reports) ============== */
  const adminBtn=$('adminBtn'), adminPanel=$('adminPanel');
  let armedType=null, armedTypeTimer=null, armedAll=false, armedAllTimer=null;
  function refreshAdminList(){
    const wrap=$('adminList');
    const clearAllBtn=$('clearAllBtn');
    if(hazards.length===0){
      wrap.innerHTML='<div id="adminEmpty">No active reports</div>';
      clearAllBtn.style.display='none';
      return;
    }
    clearAllBtn.style.display='block';
    clearAllBtn.textContent = armedAll ? 'Tap to confirm' : 'Clear all reports';
    clearAllBtn.classList.toggle('armed', armedAll);
    const groups={police:[], hazard:[], crash:[]};
    hazards.forEach(h=>{ if(groups[h.type]) groups[h.type].push(h); });
    wrap.innerHTML = Object.keys(groups).filter(t=>groups[t].length>0).map(type=>{
      const rows = groups[type].map(h=>{
        const dist = Math.hypot(h.x-car.x, h.y-car.y)*KM_PER_UNIT;
        return `<div class="reportRow"><div class="reportDot" style="background:var(${TYPE_COLORS[type]})"></div>
          <div class="reportInfo"><div class="reportMeta">${timeAgo(h.t)} · ${dist.toFixed(0)} km away${h.heading!==undefined ? ' · one direction' : ''}</div></div>
          <button class="reportRemove" data-id="${h.id}" aria-label="Remove this report">✕</button></div>`;
      }).join('');
      const isArmed = armedType===type;
      return `<div class="reportGroup"><div class="reportGroupHead"><span>${TYPE_LABELS[type]} · ${groups[type].length}</span>
        <button class="smallGhost${isArmed?' armed':''}" data-cleartype="${type}">${isArmed?'Tap to confirm':'Clear all '+TYPE_LABELS[type].toLowerCase()}</button></div>${rows}</div>`;
    }).join('');
    wrap.querySelectorAll('.reportRemove').forEach(btn=>{
      btn.onclick=()=>{ hazards=hazards.filter(h=>h.id!==btn.dataset.id); saveHazards(); hazardsChanged(); };
    });
    wrap.querySelectorAll('[data-cleartype]').forEach(btn=>{
      btn.onclick=()=>{
        const type=btn.dataset.cleartype;
        if(armedType===type){
          clearTimeout(armedTypeTimer); armedType=null;
          const count=hazards.filter(h=>h.type===type).length;
          hazards=hazards.filter(h=>h.type!==type); saveHazards();
          showToast('Cleared '+count+' '+TYPE_LABELS[type].toLowerCase()+' report'+(count===1?'':'s'));
          hazardsChanged();
        } else {
          armedType=type; clearTimeout(armedTypeTimer);
          armedTypeTimer=setTimeout(()=>{ armedType=null; refreshAdminList(); }, 4000);
          refreshAdminList();
        }
      };
    });
  }
  $('clearAllBtn').onclick=()=>{
    if(armedAll){
      clearTimeout(armedAllTimer); armedAll=false;
      const count=hazards.length;
      hazards=[]; saveHazards();
      showToast('Cleared all '+count+' report'+(count===1?'':'s'));
      hazardsChanged();
    } else {
      armedAll=true; clearTimeout(armedAllTimer);
      armedAllTimer=setTimeout(()=>{ armedAll=false; refreshAdminList(); }, 4000);
      refreshAdminList();
    }
  };
  let adminRefreshTimer=null;
  function openAdminPanel(){
    adminPanel.classList.add('show'); adminBtn.classList.add('active');
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeFan(); closeMenu();
    refreshAdminList();
    if(adminRefreshTimer) clearInterval(adminRefreshTimer);
    adminRefreshTimer=setInterval(refreshAdminList, 5000);
    syncControlsRecede();
  }
  function closeAdminPanel(){
    adminPanel.classList.remove('show'); adminBtn.classList.remove('active');
    armedType=null; armedAll=false; clearTimeout(armedTypeTimer); clearTimeout(armedAllTimer);
    if(adminRefreshTimer){ clearInterval(adminRefreshTimer); adminRefreshTimer=null; }
    syncControlsRecede();
  }
  adminBtn.onclick=()=>{ adminPanel.classList.contains('show') ? closeAdminPanel() : openAdminPanel(); };

  /* ============== TOASTS ============== */
  function showToast(msg,ms){
    const wrap=$('toastWrap'); const el=document.createElement('div');
    el.className='toast'; el.textContent=msg; wrap.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),300); }, ms||2600);
  }

  /* ============== THEME ============== */
  const root=document.documentElement;
  let isDay = typeof prefs.day==='boolean' ? prefs.day : false;
  // The colours the canvas uses, read from the stylesheet once (and again when the theme changes):
  // asking the browser for computed styles on every frame is slow.
  const colors={};
  const COLOR_VARS=['--bg','--land','--border-line','--road-local','--road-local-line','--road-outback','--road-outback-line','--road-hwy','--road-hwy-line','--path','--path-glow','--text','--route','--map-bg','--user','--blue','--amber','--red'];
  function readColors(){ const s=getComputedStyle(root); COLOR_VARS.forEach(k=>{ colors[k]=s.getPropertyValue(k).trim(); }); }
  function setTheme(day){
    root.setAttribute('data-theme', day?'day':'night');
    readColors();
    const menuSwitch=$('menuThemeSwitch');
    if(menuSwitch) menuSwitch.classList.toggle('on', !day); // switch reads "Dark mode" — on means night theme active
  }
  setTheme(isDay);
  function toggleTheme(){ isDay=!isDay; setTheme(isDay); savePrefs({day:isDay}); }

  /* ============== ALGORITHM PANEL ============== */
  let currentAlg = (prefs.alg && ALGS[prefs.alg]) ? prefs.alg : 'dijkstra';
  const algBtn=$('algBtn'), algPanel=$('algPanel'), bidirCheck=$('bidirCheck');
  function paintPills(){
    document.querySelectorAll('.algPill').forEach(btn=>{
      const a=btn.dataset.alg, on=a===currentAlg;
      btn.classList.toggle('sel', on);
      btn.style.background = on ? `var(${ALGS[a].color})` : 'transparent';
      btn.style.color = on ? '#04211d' : '';
    });
    $('algDesc').textContent = ALGS[currentAlg].desc;
    // only some algorithms can search from both ends
    const canBidir=!!ALGS[currentAlg].bidir;
    bidirCheck.disabled=!canBidir;
    $('bidirRow').classList.toggle('off', !canBidir);
    $('bidirNote').textContent = canBidir ? '' : 'BFS, Dijkstra and A* only';
  }
  paintPills();
  algBtn.onclick = ()=>{
    const opening = !algPanel.classList.contains('show');
    algPanel.classList.toggle('show', opening); algBtn.classList.toggle('active', opening);
    if(opening){ closeFan(); closeAdminPanel(); closeMenu(); }
    syncControlsRecede();
  };
  function setAlgorithm(key){
    currentAlg=key; paintPills(); savePrefs({alg:currentAlg});
    if(trip.stops.length && !navActive) planTrip({forceAnimate:true});
  }
  document.querySelectorAll('.algPill').forEach(btn=>{ btn.onclick=()=>setAlgorithm(btn.dataset.alg); });
  const animSwitch=$('animSwitch');
  animSwitch.onclick=()=> setSetting('animate', !settings.animate);
  bidirCheck.onchange=()=> setSetting('bidirectional', !!bidirCheck.checked);
  $('algCompareBtn').onclick=()=> openCompare();

  /* ============== HAMBURGER MENU + SETTINGS ============== */
  const menuBtn=$('menuBtn'), menuPanel=$('menuPanel');
  function openMenu(){
    menuPanel.classList.add('show'); menuBtn.classList.add('open');
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeFan(); closeAdminPanel();
    syncControlsRecede();
  }
  function closeMenu(){ menuPanel.classList.remove('show'); menuBtn.classList.remove('open'); syncControlsRecede(); }
  menuBtn.onclick=()=>{ menuPanel.classList.contains('show') ? closeMenu() : openMenu(); };
  $('menuThemeSwitch').onclick=toggleTheme;

  function renderSettings(){
    $('settingsList').innerHTML = SETTING_DEFS.map(d=>
      `<div class="settingRow"><span>${d.label}</span><div class="switch${settings[d.key]?' on':''}" data-setting="${d.key}"></div></div>`).join('');
    animSwitch.classList.toggle('on', settings.animate);
    bidirCheck.checked = settings.bidirectional;
    $('speedHud').classList.toggle('noSign', !settings.speedSigns);
  }
  function setSetting(key, value){
    if(settings[key]===value) return;
    settings[key]=value; saveSettings(); renderSettings();
    if(key==='builtUp' || key==='avoidReports'){
      if(navActive) return;                      // never change the trip mid-drive
      if(trip.stops.length) planTrip();
    }
    if(key==='bidirectional'){
      if(trip.stops.length && !navActive) planTrip({forceAnimate:true});
      return;
    }
    if(key==='speedSigns' && navActive) updateSpeedHud(true);
  }
  $('settingsList').addEventListener('click', e=>{
    const sw=e.target.closest('[data-setting]'); if(!sw) return;
    setSetting(sw.dataset.setting, !settings[sw.dataset.setting]);
  });
  $('settingsBtns').addEventListener('click', e=>{
    const b=e.target.closest('[data-act]'); if(!b) return;
    if(b.dataset.act==='clearRecents'){ saved.recents=[]; saveSaved(); showToast('Recent destinations cleared'); }
    if(b.dataset.act==='clearFavs'){ saved.favs=[]; saveSaved(); showToast('Favourites cleared'); }
    refreshSuggestions();
  });
  renderSettings();

  /* ============== FAVOURITES + RECENT DESTINATIONS ============== */
  const SAVED_KEY='driftline_qld_saved';
  let saved={favs:[], recents:[]};
  try{ const raw=localStorage.getItem(SAVED_KEY); if(raw){ const s=JSON.parse(raw); saved={favs:s.favs||[], recents:s.recents||[]}; } }catch(err){}
  function saveSaved(){ try{ localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }catch(err){} }
  // A stable key for a town or extra place (dropped pins are not saved).
  function poiKey(poi){
    if(poi.isPin) return null;
    const p = poi.placeRef || (poi.nodeId!==undefined ? poi : null);
    return p ? 'p:'+p.name+'@'+p.lat.toFixed(4)+','+p.lon.toFixed(4) : 'n:'+poi.name;
  }
  function resolveKey(k){
    if(k.startsWith('n:')){ const id=NID[k.slice(2)]; return id===undefined ? null : nodes[id]; }
    const m=/^p:(.*)@(-?[\d.]+),(-?[\d.]+)$/.exec(k); if(!m) return null;
    return places.find(p=>p.name===m[1] && p.lat.toFixed(4)===m[2] && p.lon.toFixed(4)===m[3]) || null;
  }
  const isFav = poi=>{ const k=poiKey(poi); return !!k && saved.favs.some(f=>f.k===k); };
  function toggleFav(poi){
    const k=poiKey(poi); if(!k) return;
    if(saved.favs.some(f=>f.k===k)){ saved.favs=saved.favs.filter(f=>f.k!==k); showToast('Removed '+poi.name+' from favourites'); }
    else { saved.favs.push({k, name:poi.name}); showToast('Added '+poi.name+' to favourites'); }
    saveSaved(); updateFavBtn();
  }
  function pushRecent(poi){
    const k=poiKey(poi); if(!k) return;
    saved.recents=[{k, name:poi.name}, ...saved.recents.filter(r=>r.k!==k)].slice(0,8);
    saveSaved();
  }

  /* ============== SEARCH ============== */
  const searchInput=$('searchInput'), suggestBox=$('suggestBox'), addStopBtn=$('addStopBtn');
  // 'dest' replaces the trip with the picked place, 'add' appends it as another stop, 'start' sets the start
  let searchMode='dest';
  function setSearchMode(m){
    searchMode=m;
    searchInput.placeholder = {dest:'Where to in Queensland?', add:'Add another destination…', start:'Search for a start location…'}[m];
    addStopBtn.classList.toggle('active', m==='add');
    renderTripPanel();
  }
  function pinSvg(){ return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'; }
  /* ---- search matching: forgiving of case, punctuation, abbreviations ("Mt" = Mount) and small typos ---- */
  const ABBREV = { mt:'mount', mtn:'mountain', st:'saint', sth:'south', nth:'north', pt:'point', ck:'creek', hwy:'highway', hts:'heights', bch:'beach', rd:'road' };
  const normText = s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  function within1(a,b){                      // edit distance of at most one letter
    if(a===b) return true;
    const la=a.length, lb=b.length; if(Math.abs(la-lb)>1) return false;
    let i=0, j=0, edits=0;
    while(i<la && j<lb){
      if(a[i]===b[j]){ i++; j++; continue; }
      if(++edits>1) return false;
      if(la>lb) i++; else if(lb>la) j++; else { i++; j++; }
    }
    return edits+(la-i)+(lb-j) <= 1;
  }
  function searchKey(n){ if(n._key===undefined){ n._key=normText(n.name); n._words=n._key.split(' '); } return n; }
  // how well one typed word matches a name: 4 starts a word, 3 abbreviates one, 2 is inside one, 1 is a small typo, 0 no match
  function wordMatch(t, n, fuzzy){
    let best=0; const alt=ABBREV[t];
    for(const w of n._words){
      if(w.startsWith(t)) return 4;
      if(alt && w.startsWith(alt)) best=Math.max(best,3);
      if(t.length>=3 && w.includes(t)) best=Math.max(best,2);
      if(fuzzy && t.length>=4 && (within1(t, w) || within1(t, w.slice(0,t.length)) || within1(t, w.slice(0,t.length+1)))) best=Math.max(best,1);
    }
    return best;
  }
  const KIND_BONUS = { city:55, town:45, village:30, hamlet:20, suburb:12, locality:5 };
  const townBonus = n=> n.rank===1 ? 60 : n.rank===2 ? 50 : n.rank===3 ? 40 : 30;
  function searchPlaces(q){
    const qn=normText(q), tokens=qn.split(' ').filter(Boolean);
    if(!tokens.length) return [];
    const run = fuzzy=>{
      const out=[];
      const consider = (n, bonus)=>{
        searchKey(n);
        let score;
        if(n._key===qn) score=1000;
        else if(n._key.startsWith(qn)) score=900;
        else {
          let worst=4;
          for(const t of tokens){ const m=wordMatch(t,n,fuzzy); if(!m){ worst=0; break; } worst=Math.min(worst,m); }
          if(!worst) return;
          score=300+worst*80+(n._key.includes(qn)?30:0);
        }
        const d=distFromCar(n);
        out.push({ poi:n, d, score: score+bonus-Math.min(d,2000)/100 });
      };
      for(const n of nodes){ if(!n.virtual) consider(n, townBonus(n)); }
      for(const p of places) consider(p, KIND_BONUS[p.kind]||0);
      return out;
    };
    let res=run(false);
    if(res.length<5) res=run(true);              // few hits: allow a typo
    res.sort((x,y)=> y.score-x.score);
    return res.slice(0,40);
  }
  let suggestItems=[], suggestActive=-1;         // suggestActive: the highlighted row, for the keyboard
  const distFromCar = n=> Math.hypot(n.x-car.x,n.y-car.y)*KM_PER_UNIT;
  function buildSuggestions(q){
    const items=[];
    const asItem = poi=>({ poi, d:distFromCar(poi) });
    if(!q){
      const favs=saved.favs.map(f=>resolveKey(f.k)).filter(Boolean);
      const recents=saved.recents.filter(r=>!saved.favs.some(f=>f.k===r.k)).map(r=>resolveKey(r.k)).filter(Boolean);
      if(favs.length){ items.push({header:'Favourites'}); favs.forEach(p=>items.push(asItem(p))); }
      if(recents.length){ items.push({header:'Recent'}); recents.forEach(p=>items.push(asItem(p))); }
      const room = Math.max(10, 40-items.length);
      const nearby = nodes.filter(n=>!n.virtual).map(asItem).sort((a,b)=>a.d-b.d).slice(0,room);
      if(items.length) items.push({header:'Nearby towns'});
      items.push(...nearby);
      return items;
    }
    const found = searchPlaces(q);
    return found.map(f=>({ poi:f.poi, d:f.d }));
  }
  function renderSuggestions(q, keepActive){
    suggestItems=buildSuggestions(q);
    const firstRow=suggestItems.findIndex(it=>it.poi);
    if(!keepActive || !suggestItems[suggestActive] || !suggestItems[suggestActive].poi) suggestActive = q ? firstRow : -1;
    suggestBox.innerHTML=suggestItems.map((it,i)=>{
      if(it.header) return `<div class="suggestHead">${it.header}</div>`;
      const n=it.poi, kind = n.nodeId!==undefined ? n.label+' · near '+esc(graph.nearestTownName(n.x,n.y))+' · ' : '', fav=isFav(n);
      return `<div class="suggestItem${i===suggestActive?' active':''}" data-i="${i}"><div class="suggestIcon">${pinSvg()}</div>
        <div class="suggestBody"><div class="suggestName">${esc(n.name)}</div><div class="suggestSub">${kind}${Math.round(it.d)} km away (straight line)</div></div>
        <button class="starBtn${fav?' on':''}" data-star="${i}" aria-label="${fav?'Remove from':'Add to'} favourites">${fav?'★':'☆'}</button></div>`;
    }).join('');
    suggestBox.classList.toggle('show', suggestItems.length>0);
    const row=suggestBox.querySelector && suggestBox.querySelector('.suggestItem.active');
    if(row && row.scrollIntoView) row.scrollIntoView({block:'nearest'});
  }
  const currentQuery = ()=> searchInput.value.trim().toLowerCase();
  function refreshSuggestions(){ if(suggestBox.classList.contains('show')) renderSuggestions(currentQuery()); }
  suggestBox.addEventListener('click', e=>{
    const star=e.target.closest('[data-star]');
    if(star){ e.stopPropagation(); toggleFav(suggestItems[+star.dataset.star].poi); renderSuggestions(currentQuery()); return; }
    const row=e.target.closest('[data-i]'); if(!row) return;
    const it=suggestItems[+row.dataset.i]; if(!it || !it.poi) return;
    searchInput.value=''; suggestBox.classList.remove('show');
    handlePick(it.poi);
  });
  searchInput.addEventListener('input', ()=> renderSuggestions(currentQuery()));
  searchInput.addEventListener('keydown', e=>{
    const rows=suggestItems.map((it,i)=>it.poi?i:-1).filter(i=>i>=0);
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      if(!rows.length) return;
      e.preventDefault();
      if(!suggestBox.classList.contains('show')) renderSuggestions(currentQuery());
      const pos=rows.indexOf(suggestActive);
      suggestActive = rows[e.key==='ArrowDown' ? (pos+1)%rows.length : (pos<=0 ? rows.length-1 : pos-1)];
      renderSuggestions(currentQuery(), true);
    } else if(e.key==='Enter'){
      const i = rows.includes(suggestActive) ? suggestActive : rows[0];
      if(i===undefined) return;
      e.preventDefault();
      const it=suggestItems[i];
      searchInput.value=''; suggestBox.classList.remove('show'); if(searchInput.blur) searchInput.blur();
      handlePick(it.poi);
    } else if(e.key==='Escape'){ suggestBox.classList.remove('show'); }
  });
  searchInput.addEventListener('focus', ()=>{
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeAdminPanel(); closeFan(); closeMenu();
    renderSuggestions(currentQuery());
  });
  function handleDocumentClick(e){
    if(!suggestBox.contains(e.target) && e.target!==searchInput && !(e.target.closest && e.target.closest('#addStopBtn, #tripPanel'))) suggestBox.classList.remove('show');
  }
  document.addEventListener('click', handleDocumentClick);
  cleanupFns.push(()=> document.removeEventListener('click', handleDocumentClick));

  // A place was picked (search result, tap on the map, or the long-press menu).
  function handlePick(poi){
    if(searchMode==='start'){
      const node = poi.nodeId!==undefined ? graph.ensurePlaceNode(poi) : poi;
      setSearchMode('dest'); setCarAtNode(node);
      return;
    }
    chooseDestination(poi, { append: searchMode==='add' });
  }

  /* ============== TRIP STATE ============== */
  // trip.stops = [{ poi, node }] in visit order. legs[i] = the independent search from the previous
  // stop (or the start) to stop i. currentPath is every leg's path joined; legEndSeg[k] is the index
  // of leg k's last road in it.
  const trip = { stops:[] };
  let legs=[], currentPath=null, legEndSeg=[], currentDestination=null;
  let navActive=false, navFrac=0, navSegIdx=0, playbackSeconds=15;
  let cumLen=[], cumTime=[], segLens=[], segTimes=[];
  let navStops=[], navLegs=[], navStopK=0, navPause=0, curSpeed=0, curLimit=100, navCarAlong=0;
  let searchAnim=null, searchAnimsDone=[], searchTimer=null, animRunning=false, planToken=0;
  const legCache=new Map();

  const fmtDuration = sec=>{ const m=Math.round(sec/60), h=Math.floor(m/60); return h>0 ? `${h} h ${m%60} min` : `${m} min`; };
  const nearestNodeTo = (x,y)=> graph.nearestNodeTo(x,y);
  function startLabel(){
    const n=nodes[nearestNodeTo(car.x,car.y)];
    return n.isPin ? 'Near '+graph.nearestTownName(car.x,car.y) : n.name;
  }

  function chooseDestination(poi, {append=false}={}){
    const node = poi.nodeId!==undefined ? graph.ensurePlaceNode(poi) : poi;
    pushRecent(poi);
    const stop={poi, node};
    if(append && trip.stops.length) trip.stops.push(stop); else trip.stops=[stop];
    suggestBox.classList.remove('show');
    setSearchMode('dest');
    planTrip({forceAnimate:true});
  }

  function computeLeg(fromId, toId){
    const key=[fromId,toId,currentAlg,graph.graphVersion(),graph.delayVersion(),settings.builtUp,settings.avoidReports,settings.bidirectional&&!!ALGS[currentAlg].bidir].join('|');
    const hit=legCache.get(key);
    if(hit) return Object.assign({}, hit, {cached:true});
    const result=ALGS[currentAlg].fn(fromId,toId);
    if(!result) return null;
    const leg={fromId, toId, result, optimal:runDijkstra(fromId,toId)};
    if(legCache.size>150) legCache.clear();
    legCache.set(key, leg);
    return Object.assign({}, leg, {cached:false});
  }

  function cancelSearchAnimation(){
    if(searchTimer){ clearInterval(searchTimer); searchTimer=null; }
    searchAnim=null; searchAnimsDone=[]; animRunning=false; planToken++;
  }
  function clearPlan(){
    cancelSearchAnimation();
    legs=[]; currentPath=null; legEndSeg=[]; currentDestination=null;
    setPreviewVisible(false);
  }
  function cancelTrip(){
    trip.stops=[]; clearPlan(); dismissReroute(false);
    if(searchMode!=='dest') setSearchMode('dest'); else renderTripPanel();
  }

  // Search every leg (start -> stop 1 -> stop 2 ...) independently with the chosen algorithm.
  // Legs already searched (same road network, reports and settings) are reused; only new ones animate.
  function planTrip({forceAnimate=false, alwaysAnimate=false}={}){
    cancelSearchAnimation();
    const token=planToken;
    if(!trip.stops.length){ clearPlan(); renderTripPanel(); return; }
    let from=nearestNodeTo(car.x,car.y);
    const computed=[], kept=[];
    for(const stop of trip.stops){
      const to=stop.node.id;
      if(to===from){ showToast(kept.length ? stop.poi.name+' is the same as the stop before it' : "You're already in "+stop.poi.name); continue; }
      const leg=computeLeg(from,to);
      if(!leg){ showToast('No route to '+stop.poi.name); continue; }
      computed.push(Object.assign(leg,{stop})); kept.push(stop); from=to;
    }
    trip.stops=kept;
    if(!computed.length){ clearPlan(); renderTripPanel(); return; }
    legs=computed;
    currentPath=[]; legEndSeg=[];
    legs.forEach(l=>{ l.result.path.forEach(s=>currentPath.push(s)); legEndSeg.push(currentPath.length-1); });
    currentDestination=legs[legs.length-1].stop.node;
    renderTripPanel();

    const animate = (settings.animate || alwaysAnimate);
    const toAnimate = animate ? legs.filter(l=> forceAnimate ? (alwaysAnimate || !l.cached) : !l.cached) : [];
    legs.forEach(l=>{ if(!toAnimate.includes(l) && l.result.trace.length>1) searchAnimsDone.push(staticAnim(l.result)); });
    if(!toAnimate.length){ settlePreview(); return; }
    animRunning=true; setPreviewVisible(false);
    const pace = Math.min(1, 1.8/toAnimate.length);
    const playLeg=i=>{
      if(token!==planToken) return;
      if(i>=toAnimate.length){ animRunning=false; settlePreview(); return; }
      const r=toAnimate[i].result;
      if(r.trace.length<=1){ playLeg(i+1); return; }
      playSearchAnimation(r.trace, ()=>{
        if(token!==planToken) return;
        searchAnimsDone.push(searchAnim); searchAnim=null;
        playLeg(i+1);
      }, r.wave, pace);
    };
    playLeg(0);
  }

  /* ---- search animation: neon lines growing along the roads being searched ---- */
  // Step algorithms grow the road each expanded town was reached by; Wave grows every road at once,
  // driven by a shared clock (simT) instead of by trace steps.
  const NEON = '#39FF14';
  // pace < 1 speeds a leg up, so a many-legged trip still settles in a few seconds
  function playSearchAnimation(trace, onDone, wave, pace=1){
    if(searchTimer) clearInterval(searchTimer);
    searchAnim = { segs:new Map(), wave:null, done:false, endAt:0 };
    const finish = ()=>{ clearInterval(searchTimer); searchTimer=null; searchAnim.done=true; onDone(); };
    if(wave){
      const durMs = 4200*pace;
      wave.segs.forEach((seg,i)=> searchAnim.segs.set(i, seg));
      searchAnim.wave = { T:wave.T, startMs:performance.now(), durMs };
      searchTimer = setInterval(()=>{ if(performance.now()-searchAnim.wave.startMs >= durMs+250) finish(); }, 50);
      return;
    }
    let idx=0;
    const stepMs = Math.max(8, Math.min(140, 2600*pace/trace.length));
    const growMs = Math.max(150, Math.min(800, stepMs*5)); // how long each road takes to light up
    // Deep searches (IDS / IDA*) can revisit towns thousands of times on a map this size, so
    // play several trace steps per tick to keep the whole animation to a few seconds.
    const perTick = Math.max(1, Math.ceil(trace.length*stepMs/(3200*pace)));
    searchTimer = setInterval(()=>{
      if(idx>=trace.length){
        if(!searchAnim.endAt) searchAnim.endAt = performance.now()+growMs; // let the last roads finish growing
        if(performance.now()>=searchAnim.endAt) finish();
        return;
      }
      let lastPass=null;
      for(let k=0; k<perTick && idx<trace.length; k++, idx++){
        const step = trace[idx];
        if(step.edgeIdx!==undefined){
          const fwd = edges[step.edgeIdx].a===step.from, key = step.edgeIdx*2+(fwd?1:0);
          if(!searchAnim.segs.has(key)) searchAnim.segs.set(key, { edgeIdx:step.edgeIdx, fwd, t0:performance.now(), dur:growMs });
        }
        if(step.iterationEnd) lastPass=step;
      }
      if(lastPass){
        if(lastPass.threshold!==undefined) showToast('New IDA* pass · cutoff ≈ '+Math.max(1,Math.round(lastPass.threshold/60))+' min');
        else if(lastPass.depth!==undefined) showToast('New IDS pass · depth limit '+lastPass.depth);
      }
    }, stepMs);
  }
  // A finished search, fully grown (used for legs that were not re-animated).
  function staticAnim(result){
    const a={ segs:new Map(), wave:null, done:true, full:true };
    if(result.wave){ result.wave.segs.forEach((s,i)=>a.segs.set(i,s)); a.wave={ T:result.wave.T, static:true }; }
    else result.trace.forEach(step=>{
      if(step.edgeIdx===undefined) return;
      const fwd=edges[step.edgeIdx].a===step.from;
      a.segs.set(step.edgeIdx*2+(fwd?1:0), { edgeIdx:step.edgeIdx, fwd });
    });
    return a;
  }
  // add the first `dist` (world units) of edge e, travelling forward (a->b) or not, to the current path
  function tracePartial(e, forward, dist){
    const pts=e.pts, cum=e.cum, n=pts.length;
    const at=k=> pts[forward?k:n-1-k];
    const cumAt=k=> forward ? cum[k] : e.len-cum[n-1-k];
    ctx.moveTo(at(0).x, at(0).y);
    for(let k=1;k<n;k++){
      const p=at(k), c=cumAt(k);
      if(c<=dist){ ctx.lineTo(p.x,p.y); continue; }
      const q=at(k-1), c0=cumAt(k-1), u=(dist-c0)/(c-c0);
      ctx.lineTo(q.x+(p.x-q.x)*u, q.y+(p.y-q.y)*u);
      return;
    }
  }

  /* ---- trip panel (start, stops, reorder) ---- */
  const tripPanel=$('tripPanel');
  function renderTripPanel(){
    const show = !navActive && (trip.stops.length>=2 || (trip.stops.length>=1 && searchMode!=='dest'));
    addStopBtn.classList.toggle('disabled', trip.stops.length===0);
    if(!show){ tripPanel.classList.remove('show'); tripPanel.innerHTML=''; return; }
    const aligned = legs.length===trip.stops.length;
    const totalSec = legs.reduce((s,l)=>s+l.result.totalSec,0), totalKm = legs.reduce((s,l)=>s+l.result.totalLenKm,0);
    const rows = trip.stops.map((s,i)=>{
      const l = aligned ? legs[i] : null;
      const sub = l ? `<div class="tripSub">${Math.round(l.result.totalLenKm)} km · ${fmtDuration(l.result.totalSec)}</div>` : '';
      return `<div class="tripRow" draggable="true" data-i="${i}"><span class="tripGrip" title="Drag to reorder">⋮⋮</span><span class="tripNum">${i+1}</span>
        <div class="tripName">${esc(s.poi.name)}${sub}</div>
        <button class="tripBtn" data-act="up" data-i="${i}" aria-label="Move up"${i===0?' disabled':''}>▲</button>
        <button class="tripBtn" data-act="down" data-i="${i}" aria-label="Move down"${i===trip.stops.length-1?' disabled':''}>▼</button>
        <button class="tripBtn" data-act="remove" data-i="${i}" aria-label="Remove stop">✕</button></div>`;
    }).join('');
    const totals = aligned ? `${Math.round(totalKm)} km · ${fmtDuration(totalSec)}` : '';
    tripPanel.innerHTML = `<div class="tripHead"><b>Road trip · ${trip.stops.length} stop${trip.stops.length===1?'':'s'}</b><span class="tripTotals">${totals}</span></div>
      <div class="tripRow tripStart" data-act="pickStart"><span class="tripPin">S</span><div class="tripName">Start · ${esc(startLabel())}<div class="tripSub">${searchMode==='start' ? 'Search or tap a place to start from' : 'Tap to change, or long-press the map'}</div></div></div>
      ${rows}
      <button class="tripAdd" data-act="addStop">+ Add destination</button>`;
    tripPanel.classList.add('show');
  }
  function moveStop(from, to){
    if(from===to || to<0 || to>=trip.stops.length || from<0 || from>=trip.stops.length) return;
    const [s]=trip.stops.splice(from,1); trip.stops.splice(to,0,s);
    planTrip();
  }
  function removeStop(i){
    trip.stops.splice(i,1);
    if(!trip.stops.length){ cancelTrip(); return; }
    planTrip();
  }
  tripPanel.addEventListener('click', e=>{
    const t=e.target.closest('[data-act]'); if(!t) return;
    const i=+t.dataset.i;
    if(t.dataset.act==='up') moveStop(i,i-1);
    else if(t.dataset.act==='down') moveStop(i,i+1);
    else if(t.dataset.act==='remove') removeStop(i);
    else if(t.dataset.act==='addStop') beginAddStop();
    else if(t.dataset.act==='pickStart'){ setSearchMode('start'); searchInput.value=''; searchInput.focus(); }
  });
  let dragFrom=null;
  tripPanel.addEventListener('dragstart', e=>{
    const row=e.target.closest('.tripRow[data-i]'); if(!row) return;
    dragFrom=+row.dataset.i; row.classList.add('dragging');
    if(e.dataTransfer){ e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', String(dragFrom)); }catch(err){} }
  });
  tripPanel.addEventListener('dragover', e=>{
    const row=e.target.closest('.tripRow[data-i]'); if(!row || dragFrom===null) return;
    e.preventDefault();
    tripPanel.querySelectorAll('.dragOver').forEach(r=>r.classList.remove('dragOver'));
    row.classList.add('dragOver');
  });
  tripPanel.addEventListener('drop', e=>{
    const row=e.target.closest('.tripRow[data-i]'); if(!row || dragFrom===null) return;
    e.preventDefault(); const from=dragFrom; dragFrom=null; moveStop(from, +row.dataset.i);
  });
  tripPanel.addEventListener('dragend', ()=>{ dragFrom=null; renderTripPanel(); });

  function beginAddStop(){
    if(!trip.stops.length){ showToast('Search for a destination first, then press + to add another'); searchInput.focus(); return; }
    setSearchMode('add'); searchInput.value=''; searchInput.focus();
  }
  addStopBtn.onclick=beginAddStop;

  /* ---- preview sheet ---- */
  function setPreviewVisible(on){
    $('previewSheet').classList.toggle('show', on);
    $('reportsFabWrap').classList.toggle('behindSheet', on);
    $('reportsFanLayer').classList.toggle('behindSheet', on);
    if(!on) $('onRouteWrap').classList.remove('show');
  }
  function updateFavBtn(){
    const btn=$('favBtn');
    const single = trip.stops.length===1;
    btn.style.display = single ? '' : 'none';
    if(single){ const fav=isFav(trip.stops[0].poi); btn.textContent=fav?'★':'☆'; btn.classList.toggle('on', fav); }
  }
  function settlePreview(){
    if(!legs.length) return;
    const alg=ALGS[currentAlg];
    const totalSec=legs.reduce((s,l)=>s+l.result.totalSec,0), totalKm=legs.reduce((s,l)=>s+l.result.totalLenKm,0);
    const explored=legs.reduce((s,l)=>s+l.result.nodesExplored,0);
    const optimalSec=legs.reduce((s,l)=>s+(l.optimal?l.optimal.totalSec:l.result.totalSec),0);
    const multi=trip.stops.length>1;
    $('previewTitle').textContent = multi ? `Road trip · ${trip.stops.length} stops` : trip.stops[0].poi.name;
    $('previewMeta').textContent = `${totalKm.toFixed(0)} km · ${fmtDuration(totalSec)} · ${alg.label} · ${explored} towns explored`;
    const legList=$('legList');
    if(multi){
      let prev=startLabel();
      legList.innerHTML = legs.map(l=>{
        const row=`<div class="legRow"><span>${esc(prev)} → ${esc(l.stop.poi.name)}</span><span>${Math.round(l.result.totalLenKm)} km · ${fmtDuration(l.result.totalSec)}</span></div>`;
        prev=l.stop.poi.name; return row;
      }).join('');
      legList.classList.add('show');
    } else { legList.innerHTML=''; legList.classList.remove('show'); }
    const flag=$('previewFlag');
    if(totalSec>optimalSec*1.02){
      flag.textContent=`⚠ ${Math.round((totalSec/optimalSec-1)*100)}% slower than the fastest route`; flag.style.color='var(--amber)';
    } else { flag.textContent='✓ fastest route by travel time'; flag.style.color='var(--route)'; }
    let delay=0; if(settings.avoidReports) currentPath.forEach(seg=>{ delay+=graph.delayFor(edges[seg.edgeIdx], seg.from===edges[seg.edgeIdx].a); });
    const note=$('delayNote');
    if(delay>0){ note.textContent=`⏱ Includes about ${Math.max(1,Math.round(delay/60))} min of delays from reports on this route`; note.classList.add('show'); }
    else { note.textContent=''; note.classList.remove('show'); }
    const onRoute=hazardsOnRoute(currentPath,0), wrap=$('onRouteWrap');
    if(onRoute.length>0){ $('onRouteList').innerHTML=renderRouteReportRows(onRoute); wrap.classList.add('show'); }
    else { wrap.classList.remove('show'); $('onRouteList').innerHTML=''; }
    updateFavBtn();
    setPreviewVisible(true);
  }
  $('cancelPreview').onclick=cancelTrip;
  $('startDrive').onclick=()=> startNavigation();
  $('compareBtn').onclick=()=> openCompare();
  $('favBtn').onclick=()=>{ if(trip.stops.length===1) toggleFav(trip.stops[0].poi); };

  /* ============== COMPARE ALL ALGORITHMS ============== */
  const comparePanel=$('comparePanel');
  function openCompare(){
    if(!trip.stops.length || !legs.length){ showToast('Pick a destination first, then compare the algorithms'); return; }
    const pairs=legs.map(l=>({from:l.fromId, to:l.toId}));
    const rows=Object.keys(ALGS).map(key=>{
      const r={key, explored:0, km:0, sec:0, steps:0};
      pairs.forEach(p=>{ const res=ALGS[key].fn(p.from,p.to); if(!res){ r.failed=true; return; } r.explored+=res.nodesExplored; r.km+=res.totalLenKm; r.sec+=res.totalSec; r.steps+=res.trace.length; });
      return r;
    }).filter(r=>!r.failed);
    const best=f=>Math.min(...rows.map(f));
    const bSec=best(r=>r.sec), bKm=best(r=>r.km), bExp=best(r=>r.explored);
    const names=[startLabel(), ...legs.map(l=>l.stop.poi.name)].join(' → ');
    $('cmpSub').textContent = `${names} · ${pairs.length} leg${pairs.length===1?'':'s'}, each searched independently`;
    $('cmpBody').innerHTML = `<table class="cmpTable"><thead><tr><th>Algorithm</th><th>Towns explored</th><th>Distance</th><th>Drive time</th><th></th></tr></thead><tbody>${
      rows.map(r=>{
        const slower = r.sec>bSec*1.005 ? `<span class="cmpNote">+${Math.round((r.sec/bSec-1)*100)}% vs fastest</span>` : '';
        return `<tr class="${r.key===currentAlg?'cmpSel':''}"><td><span class="cmpAlg"><span class="cmpSwatch" style="background:var(${ALGS[r.key].color})"></span>${ALGS[r.key].label}</span></td>
          <td class="${r.explored===bExp?'best':''}">${r.explored}<span class="cmpNote">${r.steps} steps</span></td>
          <td class="${r.km<=bKm*1.0005?'best':''}">${Math.round(r.km)} km</td>
          <td class="${r.sec<=bSec*1.0005?'best':''}">${fmtDuration(r.sec)}${slower}</td>
          <td><button class="cmpReplay" data-act="replay" data-alg="${r.key}">Replay</button></td></tr>`;
      }).join('')}</tbody></table>`;
    comparePanel.classList.add('show');
  }
  function closeCompare(){ comparePanel.classList.remove('show'); }
  $('cmpClose').onclick=closeCompare;
  $('cmpBody').addEventListener('click', e=>{
    const b=e.target.closest('[data-act="replay"]'); if(!b) return;
    closeCompare();
    currentAlg=b.dataset.alg; paintPills(); savePrefs({alg:currentAlg});
    planTrip({forceAnimate:true, alwaysAnimate:true});
  });

  /* ============== LONG-PRESS / RIGHT-CLICK MENU (set start, add destination, report) ============== */
  const ctxMenu=$('ctxMenu');
  let ctxWorld=null, ctxPoi=null;
  function openCtxMenuAt(cx, cy){
    const rect=canvas.getBoundingClientRect(); ctxWorld=screenToWorld(cx-rect.left, cy-rect.top);
    ctxPoi=nodeAtClient(cx,cy);
    const where = ctxPoi ? ctxPoi.name : 'Near '+graph.nearestTownName(ctxWorld.x, ctxWorld.y);
    const dot = v=>`<span class="ctxDot" style="background:var(${v})"></span>`;
    ctxMenu.innerHTML = `<div class="ctxHead">${esc(where)}</div>
      <div class="ctxItem${navActive?' disabled':''}" data-act="setStart">${dot('--blue')}Set start here</div>
      ${ctxPoi ? `<div class="ctxItem" data-act="addDest">${dot('--route')}${trip.stops.length ? 'Add as a stop' : 'Go to '+esc(ctxPoi.name)}</div>` : ''}
      <div class="ctxSep"></div>
      <div class="ctxItem" data-act="report" data-type="crash">${dot('--red')}Report a crash here</div>
      <div class="ctxItem" data-act="report" data-type="hazard">${dot('--amber')}Report a hazard here</div>
      <div class="ctxItem" data-act="report" data-type="police">${dot('--blue')}Report police here</div>`;
    ctxMenu.style.left=Math.max(8, Math.min(cx, window.innerWidth-250))+'px';
    ctxMenu.style.top=Math.max(8, Math.min(cy, window.innerHeight-260))+'px';
    ctxMenu.classList.add('show');
  }
  function closeCtxMenu(){ ctxMenu.classList.remove('show'); }
  ctxMenu.addEventListener('click', e=>{
    const it=e.target.closest('[data-act]'); if(!it) return;
    const act=it.dataset.act, w=ctxWorld, poi=ctxPoi;
    closeCtxMenu();
    if(act==='setStart') setStartAtWorld(w.x,w.y);
    else if(act==='addDest' && poi) chooseDestination(poi, {append: trip.stops.length>0});
    else if(act==='report') addHazardAt(it.dataset.type, w.x, w.y);
  });
  function handleOutsidePointer(e){ if(ctxMenu.classList.contains('show') && !ctxMenu.contains(e.target)) closeCtxMenu(); }
  document.addEventListener('pointerdown', handleOutsidePointer);
  cleanupFns.push(()=> document.removeEventListener('pointerdown', handleOutsidePointer));

  // Drop the start pin on the nearest road (splitting it there), or on a chosen town/place.
  function setStartAtWorld(wx, wy){
    if(navActive){ showToast("Can't move the start during a drive"); return; }
    const hit=graph.nearestRoadPoint(wx,wy);
    if(!hit){ showToast('No road found there'); return; }
    setCarAtNode(graph.splitEdgeAt(hit.edgeIdx, hit.dist));
  }
  function setCarAtNode(node){
    if(navActive) return;
    car.x=node.x; car.y=node.y; car.heading=-Math.PI/2;
    graph.recomputeDelays(hazards);       // a split road makes new edges: give them their reports
    legCache.clear();
    hasInteracted=true;
    const sx=car.x*scale+offsetX, sy=car.y*scale+offsetY;
    if(sx<40 || sx>W-40 || sy<120 || sy>H-120) centerOn(car.x,car.y);
    showToast('Start set: '+startLabel());
    if(trip.stops.length) planTrip({forceAnimate:true}); else renderTripPanel();
  }

  /* ============== NAVIGATION ============== */
  const legOfSeg = i=>{ const k=legEndSeg.findIndex(e=>e>=i); return k<0 ? legEndSeg.length-1 : k; };
  function buildNavArrays(){
    cumLen=[0]; cumTime=[0]; segLens=[]; segTimes=[];
    currentPath.forEach(seg=>{
      const e=edges[seg.edgeIdx], km=edgeKm(e), sec=edgeSeconds(e, seg.from===e.a);
      segLens.push(km); segTimes.push(sec);
      cumLen.push(cumLen[cumLen.length-1]+km);
      cumTime.push(cumTime[cumTime.length-1]+sec);
    });
  }
  function startNavigation(){
    if(!currentPath || animRunning) return;
    setPreviewVisible(false);
    $('turnCard').classList.add('show');
    $('driveHud').classList.add('show');
    $('speedHud').classList.add('show');
    $('searchRow').style.visibility='hidden';
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeFan(); closeAdminPanel(); closeMenu(); closeCompare(); suggestBox.classList.remove('show');
    searchAnim=null; searchAnimsDone=[]; if(searchTimer){ clearInterval(searchTimer); searchTimer=null; }

    navStops=trip.stops.slice(); navLegs=legs.slice(); navStopK=0; navPause=0; curSpeed=0; navCarAlong=0;
    buildNavArrays();
    const totalSec = cumTime[cumTime.length-1];
    playbackSeconds = Math.max(9, Math.min(42, totalSec/280));

    navActive=true; navFrac=0; navSegIdx=0; followMode=true;
    $('recenterBtn').classList.remove('show');
    root.style.setProperty('--recenter-bottom', '130px'); // the recentre button sits above the speed HUD
    renderTripPanel();
    updateTurnBanner(); updateHudStop(); updateSpeedHud(true);
    updateRouteReportsPanel();
    showToast(navStops.length>1 ? 'Road trip started · '+navStops.length+' stops' : 'Drive started to '+navStops[0].poi.name);
  }
  function endNavigation(){
    navActive=false; currentPath=null; legs=[]; legEndSeg=[]; currentDestination=null; trip.stops=[]; navStops=[]; navLegs=[];
    $('turnCard').classList.remove('show');
    $('driveHud').classList.remove('show');
    $('speedHud').classList.remove('show');
    $('routeReportsPanel').classList.remove('show');
    dismissReroute(false);
    $('searchRow').style.visibility='visible';
    root.style.setProperty('--recenter-bottom', '16px');
    followMode=false;
    renderTripPanel();
  }
  $('exitBtn').onclick=endNavigation;

  function segForward(seg){ return seg.from===edges[seg.edgeIdx].a; }
  const turnIcons = {
    straight:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>',
    left:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6v6a2 2 0 002 2h9M11 5L7 9l4 4"/></svg>',
    right:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6v6a2 2 0 01-2 2H6M13 5l4 4-4 4"/></svg>',
    arrive:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2"/></svg>'
  };
  function updateTurnBanner(){
    if(!navActive || !currentPath) return;
    const seg=currentPath[navSegIdx], e=edges[seg.edgeIdx], k=legOfSeg(navSegIdx);
    const isLegEnd=navSegIdx===legEndSeg[k], isLast=k===legEndSeg.length-1 && isLegEnd;
    let kind='straight', mainTxt='Continue on '+e.name;
    if(navSegIdx>0){
      const prevSeg=currentPath[navSegIdx-1], prevE=edges[prevSeg.edgeIdx];
      if(prevE.name!==e.name){
        let diff=edgeBearing(e,segForward(seg),false)-edgeBearing(prevE,segForward(prevSeg),true);
        while(diff>Math.PI) diff-=2*Math.PI; while(diff<-Math.PI) diff+=2*Math.PI;
        const deg=diff*180/Math.PI;
        if(Math.abs(deg)<25) mainTxt='Continue onto '+e.name;
        else if(deg>0){ kind='right'; mainTxt='Turn right onto '+e.name; }
        else{ kind='left'; mainTxt='Turn left onto '+e.name; }
      }
    } else { mainTxt='Head out on '+e.name; }
    const stopName = navStops[k] ? navStops[k].poi.name : '';
    $('turnSub').textContent = isLast ? 'Arriving at '+stopName
      : isLegEnd ? 'Stop '+(k+1)+': '+stopName
      : 'then '+edges[currentPath[navSegIdx+1].edgeIdx].name;
    $('turnIcon').innerHTML = turnIcons[kind];
    $('turnMain').textContent = mainTxt;
    updateRouteReportsPanel();
  }
  function updateHudStop(){
    const el=$('hudStop');
    if(navStops.length>1){ const k=Math.min(navStopK, navStops.length-1); el.textContent=`Stop ${k+1} of ${navStops.length} · ${navStops[k].poi.name}`; el.classList.add('show'); }
    else el.classList.remove('show');
  }
  let shownLimit=null, shownSpeed=null;
  function updateSpeedHud(force){
    if(force){ shownLimit=null; shownSpeed=null; }
    const lim=Math.round(curLimit), spd=Math.round(curSpeed);
    if(lim!==shownLimit){ $('limitNum').textContent=lim; shownLimit=lim; }
    if(spd!==shownSpeed){ $('hudSpeed').textContent=spd; shownSpeed=spd; }
  }
  function arriveAtStop(k){
    $('turnIcon').innerHTML=turnIcons.arrive;
    $('turnMain').textContent='Stop '+(k+1)+' reached';
    $('turnSub').textContent=navStops[k].poi.name+' · continuing to '+navStops[k+1].poi.name;
    showToast('Arrived at stop '+(k+1)+': '+navStops[k].poi.name);
  }
  function arrive(){
    $('turnIcon').innerHTML=turnIcons.arrive;
    $('turnMain').textContent='You have arrived';
    $('turnSub').textContent=navStops[navStops.length-1].poi.name;
    showToast('Arrived at '+navStops[navStops.length-1].poi.name);
    curSpeed=0; updateSpeedHud();
    setTimeout(endNavigation, 2200);
    navActive=false;
  }

  /* ---- reroute offers: a faster way round the reports ahead ---- */
  const rerouteState={ pending:null, dismissedAt:-1 };
  function dismissReroute(remember){
    if(remember) rerouteState.dismissedAt=graph.delayVersion();
    rerouteState.pending=null; $('rerouteCard').classList.remove('show');
  }
  function checkReroute(){
    if(!settings.offerReroute || !navActive || !currentPath || rerouteState.pending) return;
    if(rerouteState.dismissedAt===graph.delayVersion()) return;
    const seg=currentPath[navSegIdx], k=legOfSeg(navSegIdx), destId=navLegs[k].toId;
    if(seg.to===destId) return;
    let cur=0; for(let i=navSegIdx+1;i<=legEndSeg[k];i++) { const e2=edges[currentPath[i].edgeIdx]; cur+=edgeSeconds(e2, currentPath[i].from===e2.a); }
    const best=runDijkstra(seg.to, destId); if(!best) return;
    const same = best.path.length===legEndSeg[k]-navSegIdx && best.path.every((s,j)=>s.edgeIdx===currentPath[navSegIdx+1+j].edgeIdx);
    const save=cur-best.totalSec;
    if(same || save<120) return;
    const types=[...new Set(hazardsOnRoute(currentPath, navSegIdx, navCarAlong).map(h=>TYPE_LABELS[h.type].toLowerCase()))];
    rerouteState.pending={ k, path:best.path, save };
    $('rerouteText').textContent = `${types.length ? types.join(' and ') : 'Traffic'} reported ahead. A faster route saves about ${Math.round(save/60)} min.`;
    $('rerouteCard').classList.add('show');
  }
  function applyReroute(){
    const p=rerouteState.pending; if(!p || !navActive) return;
    const idx=navSegIdx;
    const localT = segLens[idx]>0 ? Math.min(1,(navFrac*cumLen[cumLen.length-1]-cumLen[idx])/segLens[idx]) : 1;
    const doneKm = cumLen[idx]+localT*segLens[idx];
    const oldEnd=legEndSeg[p.k];
    const head=currentPath.slice(0,idx+1), tail=currentPath.slice(oldEnd+1);
    currentPath=[...head, ...p.path, ...tail];
    const newEnd=idx+p.path.length, delta=newEnd-oldEnd;
    legEndSeg=legEndSeg.map((e,j)=> j<p.k ? e : j===p.k ? newEnd : e+delta);
    buildNavArrays();
    navFrac=doneKm/cumLen[cumLen.length-1];
    dismissReroute(false);
    updateTurnBanner();
    showToast('Rerouted: about '+Math.round(p.save/60)+' min faster');
  }
  $('rerouteYes').onclick=applyReroute;
  $('rerouteNo').onclick=()=> dismissReroute(true);

  /* ============== MAIN LOOP ============== */
  let lastT=null, pulseT=0, renderCount=0, lastSig='', lastOverlaySig='', lastPulseDraw=0;
  // everything the picture depends on, cheaply comparable
  function renderSignature(){
    return [scale,offsetX,offsetY,W,H,dpr,isDay,settings.showPlaces,navActive,animRunning,
      currentPath?currentPath.length:-1,legs.length,searchAnimsDone.length,trip.stops.map(s=>s.node.id).join(','),
      navStops.length,graph.graphVersion(),nodes.length,edges.length].join('|');
  }
  function frame(t){
    if(lastT===null) lastT=t;
    const dt=Math.min(0.05,(t-lastT)/1000); lastT=t; pulseT+=dt;

    if(navActive && currentPath){
      if(navPause>0){ navPause-=dt; }                     // brief stop at each waypoint
      else navFrac += dt/playbackSeconds;
      const totalLen=cumLen[cumLen.length-1];
      let target=Math.min(1,navFrac)*totalLen;
      // reached the end of a leg that is not the last: stop there for a moment
      if(navStopK<legEndSeg.length-1){
        const stopAt=cumLen[legEndSeg[navStopK]+1];
        if(target>=stopAt){
          navFrac=stopAt/totalLen; target=stopAt; navPause=1.6;
          arriveAtStop(navStopK); navStopK++; updateHudStop();
        }
      }
      if(navFrac>=1){
        const last=currentPath[currentPath.length-1];
        car.x=nodes[last.to].x; car.y=nodes[last.to].y;
        arrive();
      } else {
        let idx=0; while(idx<segLens.length-1 && cumLen[idx+1]<target) idx++;
        if(idx!==navSegIdx){ navSegIdx=idx; if(navPause<=0) updateTurnBanner(); }
        const segStart=cumLen[idx], segLen=segLens[idx];
        const localT = segLen>0 ? Math.min(1,(target-segStart)/segLen) : 1;
        const seg=currentPath[idx], segEdge=edges[seg.edgeIdx], fwd=segForward(seg);
        const pos=pointAlong(segEdge, fwd, localT*segEdge.len);
        car.x=pos.x; car.y=pos.y; car.heading=pos.heading; navCarAlong=localT*segEdge.len;
        if(followMode) centerOn(car.x,car.y);

        const elapsedTime = cumTime[idx] + (segTimes[idx]*localT);
        const totalSec = cumTime[cumTime.length-1];
        const remainSec = Math.max(0,totalSec-elapsedTime);
        const remainKm = Math.max(0,totalLen-target);
        // the car eases to the limit at its position (which drops in built-up areas)
        curLimit = graph.limitAt(segEdge, fwd, localT*segEdge.len);
        const goal = navPause>0 ? 0 : curLimit;
        curSpeed += Math.max(-90*dt, Math.min(40*dt, goal-curSpeed));
        updateSpeedHud();
        const rmin=Math.round(remainSec/60);
        $('hudTime').textContent = rmin>=60 ? Math.floor(rmin/60)+'h '+(rmin%60)+'m' : rmin+' min';
        $('hudDist').textContent = remainKm.toFixed(0);
        $('hudEta').textContent = new Date(Date.now()+remainSec*1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
      }
    }
    // The map only needs redrawing when what it shows has changed or something on it is moving. Sitting
    // idle it used to redraw 60 times a second, which is what made the app heavy on the browser.
    const sig = renderSignature();
    const moving = navActive || animRunning || !!searchAnim || dragging || pinchActive;
    const sx=car.x*scale+offsetX, sy=car.y*scale+offsetY;
    const pulsing = !reduceMotion && (hazards.length>0 || (!navActive && sx>-20 && sx<W+20 && sy>-20 && sy<H+20));   // the ring around you, report markers
    const oSig = [car.x,car.y,car.heading,hazards.length,navActive].join('|');
    if(sig!==lastSig || moving){
      lastSig=sig; lastOverlaySig=oSig; lastPulseDraw=t;
      renderCount++;
      render(); renderOverlay();
    } else if(oSig!==lastOverlaySig || (pulsing && t-lastPulseDraw>60)){
      lastOverlaySig=oSig; lastPulseDraw=t;
      renderOverlay();
    }
    rafId = requestAnimationFrame(frame);
  }

  function render(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const styles={ getPropertyValue:k=>colors[k]||'' };
    ctx.fillStyle=styles.getPropertyValue('--bg').trim(); ctx.fillRect(0,0,W,H);

    ctx.save(); ctx.translate(offsetX,offsetY); ctx.scale(scale,scale);
    const zs = Math.max(1, scale/1.4); // divide world-unit sizes by this so deep zoom doesn't balloon them
    // viewport in world coordinates, so we only draw what is on screen
    const vx0=-offsetX/scale-30/scale, vx1=(W-offsetX)/scale+30/scale, vy0=-offsetY/scale-30/scale, vy1=(H-offsetY)/scale+30/scale;
    const inView = p=> p.x>=vx0 && p.x<=vx1 && p.y>=vy0 && p.y<=vy1;

    // state landmass (mainland + islands, from the real coastline)
    ctx.lineJoin='round';
    ctx.fillStyle=styles.getPropertyValue('--land').trim();
    ctx.lineWidth=2/scale; ctx.strokeStyle=styles.getPropertyValue('--border-line').trim();
    if(HAS_PATH2D){ const lp=getLandPath(); ctx.fill(lp); ctx.stroke(lp); }
    else LAND.forEach(poly=>{
      ctx.beginPath();
      poly.forEach((p,i)=> i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // roads, drawn weakest to strongest
    ['access','outback','rural','highway'].forEach(kind=>{
      edges.forEach(e=>{
        if(e.removed || e.type!==kind) return;
        const bb=e.bbox; if(bb.x1<vx0 || bb.x0>vx1 || bb.y1<vy0 || bb.y0>vy1) return;
        const P=HAS_PATH2D ? edgePath(e) : null;
        if(!P){ ctx.beginPath(); e.pts.forEach((p,i)=> i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)); }
        const stk = P ? ()=>ctx.stroke(P) : ()=>ctx.stroke();
        ctx.lineCap='round'; ctx.lineJoin='round';
        if(kind==='access'){
          ctx.lineWidth=1.6/zs; ctx.setLineDash([3/zs,4/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); stk(); ctx.setLineDash([]);
        } else if(kind==='outback'){
          ctx.lineWidth=4/zs; ctx.strokeStyle=styles.getPropertyValue('--road-outback').trim(); stk();
          ctx.lineWidth=1.4/zs; ctx.setLineDash([6/zs,7/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-outback-line').trim(); stk(); ctx.setLineDash([]);
        } else if(kind==='rural'){
          ctx.lineWidth=6/zs; ctx.strokeStyle=styles.getPropertyValue('--road-local').trim(); stk();
          ctx.lineWidth=1.4/zs; ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); stk();
        } else {
          ctx.lineWidth=9/zs; ctx.strokeStyle=styles.getPropertyValue('--road-hwy').trim(); stk();
          ctx.lineWidth=1.8/zs; ctx.setLineDash([10/zs,8/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-hwy-line').trim(); stk(); ctx.setLineDash([]);
        }
      });
    });

    // search visualization: neon lines growing out along the roads being searched (earlier legs stay, dimmed)
    const now=performance.now();
    const collect=(anim, list)=>{
      const wv=anim.wave;
      const simT = wv ? (wv.static ? wv.T : Math.min(wv.T,(now-wv.startMs)/wv.durMs*wv.T)) : 0;
      anim.segs.forEach(seg=>{
        const e=edges[seg.edgeIdx]; if(e.removed) return;
        const bb=e.bbox; if(bb.x1<vx0 || bb.x0>vx1 || bb.y1<vy0 || bb.y0>vy1) return;
        const d = wv ? Math.max(0, Math.min(simT, seg.s1)-seg.s0)
                : seg.t0===undefined ? e.len
                : Math.max(0, Math.min(1, (now-seg.t0)/seg.dur))*e.len;
        if(d>0) list.push([e, seg.fwd, d]);
      });
    };
    const dimmed=[], live=[];
    searchAnimsDone.forEach(a=>collect(a,dimmed));
    if(searchAnim) collect(searchAnim, live);
    const neon=(list, mult)=>{
      if(!list.length) return;
      const pass=(w, style, alpha)=>{
        ctx.beginPath(); list.forEach(([e,fwd,d])=>tracePartial(e,fwd,d));
        ctx.lineWidth=w/zs; ctx.strokeStyle=style; ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.globalAlpha=alpha*mult; ctx.stroke();
      };
      pass(11, NEON, 0.16); pass(5.5, NEON, 0.5); pass(2, '#D9FFD0', 1); // glow, body, hot core
      ctx.globalAlpha=1;
    };
    neon(dimmed, 0.45); neon(live, 1);

    // final route: purple, so it stands out against the neon-green search lines
    if(currentPath && !animRunning){
      ctx.beginPath();
      let started=false;
      currentPath.forEach(seg=>{
        const pts=edges[seg.edgeIdx].pts, fwd=segForward(seg);
        for(let k=0;k<pts.length;k++){ const p=pts[fwd?k:pts.length-1-k]; if(!started){ ctx.moveTo(p.x,p.y); started=true; } else ctx.lineTo(p.x,p.y); }
      });
      ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.lineWidth=9/zs; ctx.strokeStyle=styles.getPropertyValue('--path-glow').trim(); ctx.stroke();
      ctx.lineWidth=4.4/zs; ctx.strokeStyle=styles.getPropertyValue('--path').trim();
      if(!navActive) ctx.setLineDash([2/zs,7/zs]);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // towns + extra places
    const DOT_R = {1:5, 2:4, 3:3, 4:2.5};
    const textCol = styles.getPropertyValue('--text').trim(), routeCol = styles.getPropertyValue('--route').trim();
    const stopIds = new Set((navActive ? navStops : trip.stops).map(s=>s.node.id));
    const numbered = stopIds.size>1;
    if(settings.showPlaces){
      // side roads from the road to each visible place, drawn along their real shapes
      ctx.beginPath();
      places.forEach(p=>{
        if(!placeVisible(p) || !p.spurPts) return;
        const pts=p.spurPts, q=pts[0];
        if(Math.max(p.x,q.x)<vx0 || Math.min(p.x,q.x)>vx1 || Math.max(p.y,q.y)<vy0 || Math.min(p.y,q.y)>vy1) return;
        for(let k=0;k<pts.length;k++) k===0 ? ctx.moveTo(pts[k].x,pts[k].y) : ctx.lineTo(pts[k].x,pts[k].y);
      });
      ctx.lineWidth=1.3/zs; ctx.setLineDash([3/zs,4/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); ctx.stroke(); ctx.setLineDash([]);
      places.forEach(p=>{
        if(!placeVisible(p) || !inView(p) || (p.nodeId!==null && stopIds.has(p.nodeId))) return;
        ctx.beginPath(); ctx.arc(p.x,p.y, 2/zs, 0, Math.PI*2);
        ctx.fillStyle=textCol; ctx.globalAlpha=0.4; ctx.fill(); ctx.globalAlpha=1;
      });
    }
    nodes.forEach(n=>{
      const isStop = stopIds.has(n.id);
      if(n.virtual && !isStop) return;
      if(isStop && numbered) return;               // numbered markers are drawn on top, in screen space
      ctx.beginPath(); ctx.arc(n.x,n.y, (isStop?7:DOT_R[n.rank])/zs, 0, Math.PI*2);
      ctx.fillStyle = isStop ? routeCol : textCol;
      ctx.globalAlpha = isStop?1:0.55; ctx.fill(); ctx.globalAlpha=1;
    });
    // labels: bigger towns win, smaller ones appear as you zoom in, and any label that would
    // overlap one already placed is skipped so a map this dense stays readable
    const onPath = new Set();
    if(currentPath) currentPath.forEach(seg=>{ onPath.add(seg.from); onPath.add(seg.to); });
    const priority = n=> (n.id!==undefined && stopIds.has(n.id)) ? 0 : (n.id!==undefined && onPath.has(n.id)) ? 1 : 1+n.rank;
    // Labels are drawn in screen pixels, not map units: a font sized as 12/scale rounds to 0px at
    // extreme zoom, which is what made every name vanish at max zoom.
    const LABEL_PX=12;
    ctx.save(); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.font='600 '+LABEL_PX+'px "Space Grotesk", sans-serif';
    ctx.fillStyle=textCol; ctx.textBaseline='bottom';
    const pad=3, placed=[];
    const candidates = nodes.filter(n=> (!n.virtual || stopIds.has(n.id)) && (priority(n)<=1 || scale>=LABEL_MIN_SCALE[n.rank]))
      .concat(settings.showPlaces ? places.filter(p=> scale>=LABEL_MIN_SCALE[p.rank] && inView(p) && !(p.nodeId!==null && stopIds.has(p.nodeId))) : []);
    candidates
      .sort((a,b)=>priority(a)-priority(b))
      .forEach(n=>{
        const sx=n.x*scale+offsetX, sy=n.y*scale+offsetY;
        if(sx<-300 || sx>W+300 || sy<-100 || sy>H+100) return;
        let w=textWidths.get(n.name); if(w===undefined){ w=ctx.measureText(n.name).width; textWidths.set(n.name,w); }
        const x0=sx+(numbered && stopIds.has(n.id) ? 14 : 8), y1=sy-4;
        const r={x0:x0-pad, x1:x0+w+pad, y0:y1-LABEL_PX-pad, y1:y1+pad};
        if(placed.some(p=> r.x0<p.x1 && r.x1>p.x0 && r.y0<p.y1 && r.y1>p.y0)) return;
        placed.push(r);
        ctx.fillText(n.name, x0, y1);
      });
    // numbered stop markers for a road trip
    if(numbered){
      ctx.textAlign='center'; ctx.textBaseline='middle';
      (navActive ? navStops : trip.stops).forEach((s,i)=>{
        const sx=s.node.x*scale+offsetX, sy=s.node.y*scale+offsetY;
        if(sx<-20 || sx>W+20 || sy<-20 || sy>H+20) return;
        ctx.beginPath(); ctx.arc(sx,sy,9,0,Math.PI*2); ctx.fillStyle=routeCol; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); ctx.stroke();
        ctx.fillStyle='#04211d'; ctx.font='700 11px "Space Grotesk", sans-serif'; ctx.fillText(String(i+1), sx, sy+0.5);
      });
    }
    ctx.restore();


    ctx.restore();
  }


  // you (the car) and the reports, on the overlay layer
  function renderOverlay(){
    octx.setTransform(dpr,0,0,dpr,0,0);
    octx.clearRect(0,0,W,H);
    const styles={ getPropertyValue:k=>colors[k]||'' };
    octx.save(); octx.translate(offsetX,offsetY); octx.scale(scale,scale);
    const zs = Math.max(1, scale/1.4);
    // hazards
    const beforeCount=hazards.length;
    hazards = hazards.filter(h=>Date.now()-h.t<20*60*1000);
    if(hazards.length!==beforeCount){ saveHazards(); hazardsChanged(); }
    const hazColors={police:'--blue', hazard:'--amber', crash:'--red'};
    const hazR = Math.min(6, 5/scale); // ~5px on screen once zoomed in, same approach as town labels
    hazards.forEach(h=>{
      const pulse = reduceMotion?0:Math.sin(pulseT*3+h.t)*0.25+0.75;
      const col=styles.getPropertyValue(hazColors[h.type]).trim();
      octx.beginPath(); octx.arc(h.x,h.y,hazR*2*pulse,0,Math.PI*2); octx.fillStyle=col; octx.globalAlpha=0.18; octx.fill(); octx.globalAlpha=1;
      octx.beginPath(); octx.arc(h.x,h.y,hazR,0,Math.PI*2); octx.fillStyle=col; octx.fill();
      octx.lineWidth=1.4/scale; octx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); octx.stroke();
      if(h.heading!==undefined){                   // reported while driving: it only applies to that direction
        octx.save(); octx.translate(h.x,h.y); octx.rotate(h.heading); octx.beginPath();
        octx.moveTo(hazR*3.4,0); octx.lineTo(hazR*2.1,hazR*1.1); octx.lineTo(hazR*2.1,-hazR*1.1); octx.closePath(); octx.fillStyle=col; octx.fill(); octx.restore();
      }
    });

    // the user (car) — always a red arrow, pointing in the current heading (idle heading defaults to north)
    octx.save(); octx.translate(car.x,car.y); octx.rotate(car.heading); octx.scale(1/zs,1/zs);
    if(!navActive){
      const pulse=reduceMotion?0:Math.sin(pulseT*2.4)*0.3+0.7;
      octx.beginPath(); octx.arc(0,0,12*pulse,0,Math.PI*2); octx.fillStyle=styles.getPropertyValue('--user').trim(); octx.globalAlpha=0.22; octx.fill(); octx.globalAlpha=1;
    }
    octx.beginPath(); octx.moveTo(11,0); octx.lineTo(-7,6); octx.lineTo(-3,0); octx.lineTo(-7,-6); octx.closePath();
    octx.fillStyle = styles.getPropertyValue('--user').trim();
    octx.fill();
    octx.lineWidth=1.6; octx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); octx.stroke();
    octx.restore();
    octx.restore();
  }

  // Test hook: only exists when a test sets window.__DRIFTLINE_DEBUG__ before starting the app.
  if(window.__DRIFTLINE_DEBUG__){
    window.__driftline = {
      graph, ALGS, trip, hazards:()=>hazards, saved:()=>saved, settings, car:()=>car,
      state:()=>({ navActive, legs:legs.length, animRunning, pathLen:currentPath?currentPath.length:0, legEndSeg:legEndSeg.slice(),
        searchMode, navStopK, navSegIdx, navFrac, curSpeed, curLimit, rerouteOffered:!!rerouteState.pending, scale }),
      chooseDestination, handlePick, planTrip, moveStop, removeStop, startNavigation, setStartAtWorld, setCarAtNode,
      renderOnce:()=>{ const t0=performance.now(); render(); renderOverlay(); return performance.now()-t0; }, renderCount:()=>renderCount,
      addHazardAt, applyReroute, openCompare, setSetting, toggleFav, setSearchMode, cancelTrip, endNavigation,
    };
  }

  rafId = requestAnimationFrame(frame);
  setTimeout(handleViewportChange, 250); // re-fit once the mobile browser toolbar (address bar) settles
  showToast("Pick a routing algorithm, then search a Queensland town", 3600);
  }catch(err){
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      +'background:#070C14;color:#EAF2FA;font-family:system-ui,sans-serif;padding:24px;text-align:center;">'
      +'Driftline hit a snag loading the map: '+(err && err.message ? err.message : err)+'</div>';
  }

  return function cleanup(){
    if(rafId) cancelAnimationFrame(rafId);
    cleanupFns.forEach(fn=>{ try{ fn(); }catch(e){} });
  };
}
