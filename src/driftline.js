export function initDriftline() {
  let rafId = null;
  const cleanupFns = [];
  try{
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============== PROJECTION ============== */
  const LON_W=137, LON_E=154, LAT_N=-10, LAT_S=-29.5;
  const WORLD_W=900, WORLD_H=1200, KM_PER_UNIT=1.7, MAX_SPEED=110;
  function proj(lat,lon){
    return { x:(lon-LON_W)/(LON_E-LON_W)*WORLD_W, y:(lat-LAT_N)/(LAT_S-LAT_N)*WORLD_H };
  }

  /* ============== TOWNS (nodes) ============== */
  const TOWN_DATA = [
    ["Weipa",-12.63,141.88],["Cooktown",-15.47,145.25],["Cairns",-16.92,145.77],["Mareeba",-17.00,145.43],
    ["Ingham",-18.65,146.16],["Townsville",-19.26,146.82],["Charters Towers",-20.08,146.27],["Hughenden",-20.85,144.20],
    ["Cloncurry",-20.71,140.51],["Mount Isa",-20.73,139.49],["Winton",-22.39,143.04],["Longreach",-23.44,144.25],
    ["Barcaldine",-23.55,145.29],["Emerald",-23.53,148.16],["Bowen",-20.02,148.24],["Mackay",-21.14,149.19],
    ["Rockhampton",-23.38,150.51],["Gladstone",-23.85,151.26],["Bundaberg",-24.87,152.35],["Hervey Bay",-25.30,152.85],
    ["Maryborough",-25.54,152.70],["Gympie",-26.19,152.67],["Charleville",-26.41,146.24],["Roma",-26.57,148.79],
    ["Dalby",-27.18,151.26],["Toowoomba",-27.56,151.95],["Sunshine Coast",-26.65,153.09],["Ipswich",-27.62,152.76],
    ["Brisbane",-27.47,153.03],["Warwick",-28.22,152.03],["Stanthorpe",-28.65,151.93],["Goondiwindi",-28.55,150.32],
    ["Gold Coast",-28.02,153.40],
  ];
  const nodes = TOWN_DATA.map(([name,lat,lon],id)=>{
    const p = proj(lat,lon);
    return { id, name, lat, lon, x:p.x, y:p.y };
  });
  const NID = {}; nodes.forEach(n=>NID[n.name]=n.id);

  /* ============== ROADS (edges) ============== */
  const edges = [];
  function road(a,b,type,name){
    const A=nodes[NID[a]], B=nodes[NID[b]];
    const len = Math.hypot(A.x-B.x, A.y-B.y);
    edges.push({a:A.id,b:B.id,type,name,len});
  }
  // Bruce Highway spine
  road("Cairns","Ingham","highway","Bruce Highway");
  road("Ingham","Townsville","highway","Bruce Highway");
  road("Townsville","Bowen","highway","Bruce Highway");
  road("Bowen","Mackay","highway","Bruce Highway");
  road("Mackay","Rockhampton","highway","Bruce Highway");
  road("Rockhampton","Gladstone","highway","Bruce Highway");
  road("Gladstone","Bundaberg","highway","Bruce Highway");
  road("Bundaberg","Maryborough","rural","Bruce Highway");
  road("Maryborough","Hervey Bay","rural","Tin Can Bay Road");
  road("Maryborough","Gympie","highway","Bruce Highway");
  road("Gympie","Sunshine Coast","highway","Bruce Highway");
  road("Sunshine Coast","Brisbane","highway","Bruce Highway");
  // Far north
  road("Cairns","Mareeba","rural","Kennedy Highway");
  road("Mareeba","Cooktown","outback","Mulligan Highway");
  road("Cooktown","Weipa","outback","Peninsula Development Road");
  // Flinders / Barkly (west)
  road("Townsville","Charters Towers","rural","Flinders Highway");
  road("Charters Towers","Hughenden","rural","Flinders Highway");
  road("Hughenden","Cloncurry","rural","Flinders Highway");
  road("Cloncurry","Mount Isa","rural","Barkly Highway");
  road("Hughenden","Winton","outback","Kennedy Developmental Road");
  // Matilda / Landsborough (central west)
  road("Cloncurry","Winton","rural","Landsborough Highway");
  road("Winton","Longreach","rural","Landsborough Highway");
  road("Longreach","Barcaldine","rural","Landsborough Highway");
  road("Barcaldine","Emerald","rural","Capricorn Highway");
  road("Emerald","Rockhampton","rural","Capricorn Highway");
  road("Emerald","Mackay","rural","Peak Downs Highway");
  road("Barcaldine","Charleville","outback","Landsborough Highway");
  // Warrego (south west)
  road("Charleville","Roma","rural","Warrego Highway");
  road("Roma","Dalby","rural","Warrego Highway");
  road("Dalby","Toowoomba","highway","Warrego Highway");
  road("Toowoomba","Ipswich","highway","Warrego Highway");
  road("Ipswich","Brisbane","highway","Ipswich Motorway");
  // South east corner
  road("Brisbane","Gold Coast","highway","Pacific Motorway");
  road("Toowoomba","Warwick","rural","New England Highway");
  road("Warwick","Stanthorpe","rural","New England Highway");
  road("Warwick","Goondiwindi","rural","Cunningham Highway");
  road("Goondiwindi","Dalby","outback","Moonie Highway");

  const adj = new Map(); nodes.forEach(n=>adj.set(n.id, []));
  edges.forEach((e,i)=>{ adj.get(e.a).push({to:e.b, edgeIdx:i}); adj.get(e.b).push({to:e.a, edgeIdx:i}); });

  const SPEED = { highway:110, rural:95, outback:75 };
  function edgeSpeed(e){ return SPEED[e.type]; }
  function edgeKm(e){ return e.len*KM_PER_UNIT; }
  function edgeSeconds(e){ return edgeKm(e)/edgeSpeed(e)*3600; }
  function heuristicSeconds(fromId,goalId){
    const a=nodes[fromId], b=nodes[goalId];
    return Math.hypot(a.x-b.x,a.y-b.y)*KM_PER_UNIT/MAX_SPEED*3600;
  }

  /* ============== STATE OUTLINE (stylised) ============== */
  const OUTLINE = [
    [-10.7,142.5],[-12.9,143.4],[-14.7,144.9],[-15.47,145.25],[-16.92,145.77],[-19.26,146.82],
    [-21.14,149.19],[-23.38,150.51],[-23.85,151.26],[-24.87,152.35],[-26.65,153.09],[-27.47,153.03],
    [-28.02,153.40],[-29.0,153.05],[-29.0,141.0],[-26.0,138.0],[-16.5,138.0],[-17.5,140.8],[-12.63,141.88],[-10.7,142.5]
  ].map(([lat,lon])=>proj(lat,lon));

  /* ============== ROUTE ALGORITHMS ============== */
  function buildResult(startId,endId,parent,trace){
    if(endId!==startId && !parent.has(endId)) return null;
    const path=[]; let cur=endId;
    while(cur!==startId){ const pe=parent.get(cur); if(!pe) return null; path.unshift({edgeIdx:pe.edgeIdx, from:pe.from, to:cur}); cur=pe.from; }
    let totalSec=0, totalLen=0;
    path.forEach(seg=>{ const e=edges[seg.edgeIdx]; totalSec+=edgeSeconds(e); totalLen+=edgeKm(e); });
    const explored = new Set(); trace.forEach(t=>{ if(t.expand!==undefined) explored.add(t.expand); });
    return { path, trace, totalSec, totalLenKm:totalLen, nodesExplored:explored.size };
  }
  function runBFS(startId,endId){
    const visited=new Set([startId]), parent=new Map(), trace=[], queue=[startId];
    while(queue.length){
      const u=queue.shift(); trace.push({expand:u});
      if(u===endId) break;
      for(const link of adj.get(u)){ if(!visited.has(link.to)){ visited.add(link.to); parent.set(link.to,{from:u,edgeIdx:link.edgeIdx}); queue.push(link.to); } }
    }
    return buildResult(startId,endId,parent,trace);
  }
  function runDFS(startId,endId){
    const visited=new Set(), parent=new Map(), trace=[]; let found=false;
    function dfs(u){
      visited.add(u); trace.push({expand:u});
      if(u===endId) return true;
      for(const link of adj.get(u)){
        if(found) return true;
        if(!visited.has(link.to)){ parent.set(link.to,{from:u,edgeIdx:link.edgeIdx}); if(dfs(link.to)) return true; }
      }
      return false;
    }
    found = dfs(startId);
    return buildResult(startId,endId,parent,trace);
  }
  function runIDS(startId,endId){
    const trace=[]; const parent=new Map(); let found=false;
    function dls(u, path, depth, limit){
      trace.push({expand:u});
      if(u===endId){ found=true; return true; }
      if(depth>=limit) return false;
      for(const link of adj.get(u)){
        if(path.includes(link.to)) continue;
        parent.set(link.to,{from:u,edgeIdx:link.edgeIdx});
        path.push(link.to);
        if(dls(link.to, path, depth+1, limit)) return true;
        path.pop();
      }
      return false;
    }
    let limit=0;
    while(!found && limit<=nodes.length){
      if(dls(startId, [startId], 0, limit)) break;
      trace.push({iterationEnd:true, depth:limit});
      limit++;
    }
    return buildResult(startId,endId,parent,trace);
  }
  function runDijkstra(startId,endId){
    const dist=new Map(), parent=new Map(), visited=new Set(), trace=[];
    nodes.forEach(n=>dist.set(n.id,Infinity)); dist.set(startId,0);
    while(true){
      let u=-1,best=Infinity;
      for(const n of nodes) if(!visited.has(n.id) && dist.get(n.id)<best){ best=dist.get(n.id); u=n.id; }
      if(u===-1) break;
      visited.add(u); trace.push({expand:u});
      if(u===endId) break;
      for(const link of adj.get(u)){
        const e=edges[link.edgeIdx], nd=dist.get(u)+edgeSeconds(e);
        if(nd<dist.get(link.to)){ dist.set(link.to,nd); parent.set(link.to,{from:u,edgeIdx:link.edgeIdx}); }
      }
    }
    return buildResult(startId,endId,parent,trace);
  }
  function runAStar(startId,endId){
    const g=new Map(), parent=new Map(), visited=new Set(), trace=[];
    nodes.forEach(n=>g.set(n.id,Infinity)); g.set(startId,0);
    while(true){
      let u=-1,best=Infinity;
      for(const n of nodes){ if(visited.has(n.id) || g.get(n.id)===Infinity) continue;
        const f=g.get(n.id)+heuristicSeconds(n.id,endId); if(f<best){best=f;u=n.id;} }
      if(u===-1) break;
      visited.add(u); trace.push({expand:u});
      if(u===endId) break;
      for(const link of adj.get(u)){
        const e=edges[link.edgeIdx], ng=g.get(u)+edgeSeconds(e);
        if(ng<g.get(link.to)){ g.set(link.to,ng); parent.set(link.to,{from:u,edgeIdx:link.edgeIdx}); }
      }
    }
    return buildResult(startId,endId,parent,trace);
  }
  function runIDAStar(startId,endId){
    const trace=[]; const parent=new Map(); let found=false;
    let threshold=heuristicSeconds(startId,endId);
    const path=[startId];
    function search(g,bound){
      const u=path[path.length-1];
      const f=g+heuristicSeconds(u,endId);
      trace.push({expand:u});
      if(f>bound) return f;
      if(u===endId){ found=true; return -1; }
      let min=Infinity;
      for(const link of adj.get(u)){
        if(path.includes(link.to)) continue;
        const e=edges[link.edgeIdx];
        parent.set(link.to,{from:u,edgeIdx:link.edgeIdx});
        path.push(link.to);
        const t=search(g+edgeSeconds(e), bound);
        if(found) return -1;
        path.pop();
        if(t<min) min=t;
      }
      return min;
    }
    let iter=0;
    while(!found && iter<60){
      const t=search(0,threshold); iter++;
      if(found) break;
      if(t===Infinity) break;
      threshold=t;
      trace.push({iterationEnd:true, threshold:t});
    }
    return buildResult(startId,endId,parent,trace);
  }
  const ALGS = {
    bfs:{fn:runBFS, label:"BFS", color:"--alg-bfs", desc:"Explores outward in equal steps, ignoring speed limits — finds the route with the fewest towns, not the fastest one."},
    dfs:{fn:runDFS, label:"DFS", color:"--alg-dfs", desc:"Commits to one direction and only backtracks at dead ends — gets you there, but rarely by a sensible way."},
    ids:{fn:runIDS, label:"IDS", color:"--alg-ids", desc:"DFS re-run from scratch with the depth limit raised by one each pass — finds the same fewest-towns route as BFS, using barely any memory."},
    dijkstra:{fn:runDijkstra, label:"Dijkstra", color:"--alg-dijkstra", desc:"Always finds the fastest route by travel time, expanding the whole map evenly outward from the start."},
    astar:{fn:runAStar, label:"A*", color:"--alg-astar", desc:"Same optimal answer as Dijkstra, but a straight-line estimate to the destination steers the search there faster."},
    ida:{fn:runIDAStar, label:"IDA*", color:"--alg-ida", desc:"A* logic run as repeated shallow dives with a rising cutoff — slower to watch, but barely any memory needed."},
  };

  /* ============== CANVAS / CAMERA ============== */
  const canvas=document.getElementById('map'), ctx=canvas.getContext('2d');
  let dpr=Math.min(window.devicePixelRatio||1,2), scale=1, offsetX=0, offsetY=0, W=0,H=0;
  function resize(){
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(W*dpr)); canvas.height=Math.max(1,Math.round(H*dpr));
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

  /* ============== PAN / ZOOM (mouse drag + single-finger pan + two-finger pinch) ============== */
  let dragging=false, dragMoved=false, lastX=0, lastY=0, followMode=false;
  const activePointers = new Map(); // pointerId -> {x,y}
  let pinchActive=false, pinchLastDist=0;
  function ptDist(p1,p2){ return Math.hypot(p1.x-p2.x, p1.y-p2.y); }
  function ptMid(p1,p2){ return {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2}; }

  canvas.addEventListener('pointerdown', e=>{
    canvas.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(activePointers.size===1){
      dragging=true; dragMoved=false; pinchActive=false; canvas.classList.add('dragging');
      lastX=e.clientX; lastY=e.clientY;
    } else if(activePointers.size===2){
      dragging=false; pinchActive=true; dragMoved=true; // a two-finger touch is never a tap
      const pts=[...activePointers.values()];
      pinchLastDist = ptDist(pts[0], pts[1]);
    }
  });

  canvas.addEventListener('pointermove', e=>{
    if(!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

    if(activePointers.size>=2){
      const pts=[...activePointers.values()].slice(0,2);
      const newDist = ptDist(pts[0], pts[1]);
      const mid = ptMid(pts[0], pts[1]);
      const rect = canvas.getBoundingClientRect();
      const midX = mid.x-rect.left, midY = mid.y-rect.top;
      if(pinchLastDist>0 && newDist>0){
        const before = screenToWorld(midX, midY);
        scale = Math.max(0.35, Math.min(3.2, scale*(newDist/pinchLastDist)));
        offsetX = midX - before.x*scale; offsetY = midY - before.y*scale;
      }
      pinchLastDist = newDist;
      hasInteracted = true;
      if(followMode){ followMode=false; document.getElementById('recenterBtn').classList.add('show'); }
      return;
    }

    if(!dragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    if(Math.abs(dx)+Math.abs(dy)>3) dragMoved=true;
    offsetX+=dx; offsetY+=dy; lastX=e.clientX; lastY=e.clientY;
    if(dragMoved){ hasInteracted=true; if(followMode){ followMode=false; document.getElementById('recenterBtn').classList.add('show'); } }
  });

  function endPointer(e){
    if(!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if(activePointers.size===1){
      // one finger lifted out of a pinch — resume single-finger pan from here, no jump, no tap
      const p=[...activePointers.values()][0];
      dragging=true; dragMoved=true; pinchActive=false; pinchLastDist=0;
      lastX=p.x; lastY=p.y;
    } else if(activePointers.size===0){
      const wasGesture = dragMoved || pinchActive;
      canvas.classList.remove('dragging');
      if(dragging && !wasGesture) handleTap(e);
      dragging=false; pinchActive=false; pinchLastDist=0;
    }
  }
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', e=>{
    e.preventDefault(); hasInteracted=true;
    const before=screenToWorld(e.offsetX,e.offsetY);
    scale = Math.max(0.35, Math.min(3.2, scale*(e.deltaY<0?1.12:0.89)));
    offsetX=e.offsetX-before.x*scale; offsetY=e.offsetY-before.y*scale;
  }, {passive:false});
  document.getElementById('zoomIn').onclick=()=>zoomStep(1.2);
  document.getElementById('zoomOut').onclick=()=>zoomStep(0.83);
  function zoomStep(f){ hasInteracted=true; const before=screenToWorld(W/2,H/2); scale=Math.max(0.35,Math.min(3.2,scale*f));
    offsetX=W/2-before.x*scale; offsetY=H/2-before.y*scale; }
  document.getElementById('recenterBtn').onclick=()=>{
    followMode=true; document.getElementById('recenterBtn').classList.remove('show');
    if(!navActive) fitToState();
  };
  function handleTap(e){
    if(fanOpen) closeFan();
    const rect=canvas.getBoundingClientRect(); const w=screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    let best=null,bestD=20/scale;
    for(const n of nodes){ const d=Math.hypot(n.x-w.x,n.y-w.y); if(d<bestD){bestD=d;best=n;} }
    if(best) selectDestination(best);
    else if(!navActive && document.getElementById('previewSheet').classList.contains('show')) closePreview();
  }

  /* ============== HAZARDS (data) ============== */
  function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  let hazards=[];
  try{
    const raw=localStorage.getItem('driftline_qld_hazards');
    if(raw) hazards=JSON.parse(raw).filter(h=>Date.now()-h.t<20*60*1000).map(h=> h.id ? h : Object.assign({}, h, {id:genId()}));
  }catch(err){ hazards=[]; }
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
  function addHazard(type){
    const jitterX=(Math.random()-0.5)*20, jitterY=(Math.random()-0.5)*20;
    hazards.push({id:genId(), type, x:car.x+jitterX, y:car.y+jitterY, t:Date.now()}); saveHazards();
    const labels={police:'Police reported nearby', hazard:'Hazard reported nearby', crash:'Crash reported nearby'};
    showToast(labels[type]||'Reported');
    updateBadge();
    if(adminPanel.classList.contains('show')) refreshAdminList();
    if(navActive) updateRouteReportsPanel();
  }

  /* ============== "on the way" report matching ============== */
  const ON_ROUTE_THRESHOLD = 7; // world units — roughly the width of a highway corridor at this map's scale
  function pointSegDist(px,py, ax,ay,bx,by){
    const dx=bx-ax, dy=by-ay, lenSq=dx*dx+dy*dy;
    let t = lenSq>0 ? ((px-ax)*dx+(py-ay)*dy)/lenSq : 0;
    t = Math.max(0, Math.min(1,t));
    return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
  }
  function hazardsOnRoute(path, fromIdx){
    if(!path) return [];
    const segs = path.slice(fromIdx||0);
    return hazards.filter(h=>{
      let minD=Infinity;
      segs.forEach(seg=>{
        const A=nodes[seg.from], B=nodes[seg.to];
        const d=pointSegDist(h.x,h.y, A.x,A.y,B.x,B.y);
        if(d<minD) minD=d;
      });
      return minD<=ON_ROUTE_THRESHOLD;
    });
  }
  function renderRouteReportRows(list){
    return list.map(h=>`<div class="routeReportRow">
      <div class="routeReportDot" style="background:var(${TYPE_COLORS[h.type]})"></div>
      <div class="routeReportName">${TYPE_LABELS[h.type]}</div>
      <div class="routeReportTime">${timeAgo(h.t)}</div>
    </div>`).join('');
  }
  function updateRouteReportsPanel(){
    const panel=document.getElementById('routeReportsPanel');
    const list=document.getElementById('routeReportsList');
    if(!navActive || !currentPath){ panel.classList.remove('show'); return; }
    const onRoute = hazardsOnRoute(currentPath, navSegIdx);
    if(onRoute.length>0){ list.innerHTML=renderRouteReportRows(onRoute); panel.classList.add('show'); }
    else { panel.classList.remove('show'); list.innerHTML=''; }
  }

  /* ============== REPORT FAB — fans out Police/Hazard/Crash buttons ============== */
  const REPORT_TYPES = [
    {type:'police', label:'Police', icon:'<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z"/><path d="M9.5 12.5l2 2 3.5-4"/>'},
    {type:'hazard', label:'Hazard', icon:'<path d="M12 3l9.5 17H2.5L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor" stroke="none"/>'},
    {type:'crash', label:'Crash', icon:'<path d="M3 12l3-6h12l3 6"/><path d="M3 12v4h2m14-4v4h-2"/><path d="M7 16h10"/><circle cx="7.5" cy="16.5" r="1.4"/><circle cx="16.5" cy="16.5" r="1.4"/>'},
  ];
  const reportsFab=document.getElementById('reportsFab');
  const reportsBadge=document.getElementById('reportsBadge');
  const fanLayer=document.getElementById('reportsFanLayer');
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
    document.getElementById('controls').classList.toggle('receded', anyOpen);
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
    if(!fanOpen && document.getElementById('previewSheet').classList.contains('show')) closePreview();
    fanOpen ? closeFan() : openFan();
  }
  reportsFab.addEventListener('click', toggleFan);
  updateBadge();

  /* ============== ADMIN PANEL (view / remove existing reports) ============== */
  const adminBtn=document.getElementById('adminBtn'), adminPanel=document.getElementById('adminPanel');
  let armedType=null, armedTypeTimer=null, armedAll=false, armedAllTimer=null;
  function armLabel(type){ return type ? 'Tap to confirm' : null; }
  function refreshAdminList(){
    const wrap=document.getElementById('adminList');
    const clearAllBtn=document.getElementById('clearAllBtn');
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
          <div class="reportInfo"><div class="reportMeta">${timeAgo(h.t)} · ${dist.toFixed(0)} km away</div></div>
          <button class="reportRemove" data-id="${h.id}" aria-label="Remove this report">✕</button></div>`;
      }).join('');
      const isArmed = armedType===type;
      return `<div class="reportGroup"><div class="reportGroupHead"><span>${TYPE_LABELS[type]} · ${groups[type].length}</span>
        <button class="smallGhost${isArmed?' armed':''}" data-cleartype="${type}">${isArmed?'Tap to confirm':'Clear all '+TYPE_LABELS[type].toLowerCase()}</button></div>${rows}</div>`;
    }).join('');
    wrap.querySelectorAll('.reportRemove').forEach(btn=>{
      btn.onclick=()=>{ hazards=hazards.filter(h=>h.id!==btn.dataset.id); saveHazards(); updateBadge(); refreshAdminList(); };
    });
    wrap.querySelectorAll('[data-cleartype]').forEach(btn=>{
      btn.onclick=()=>{
        const type=btn.dataset.cleartype;
        if(armedType===type){
          clearTimeout(armedTypeTimer); armedType=null;
          const count=hazards.filter(h=>h.type===type).length;
          hazards=hazards.filter(h=>h.type!==type); saveHazards(); updateBadge();
          showToast('Cleared '+count+' '+TYPE_LABELS[type].toLowerCase()+' report'+(count===1?'':'s'));
          refreshAdminList();
        } else {
          armedType=type; clearTimeout(armedTypeTimer);
          armedTypeTimer=setTimeout(()=>{ armedType=null; refreshAdminList(); }, 4000);
          refreshAdminList();
        }
      };
    });
  }
  document.getElementById('clearAllBtn').onclick=()=>{
    if(armedAll){
      clearTimeout(armedAllTimer); armedAll=false;
      const count=hazards.length;
      hazards=[]; saveHazards(); updateBadge();
      showToast('Cleared all '+count+' report'+(count===1?'':'s'));
      refreshAdminList();
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
    if(document.getElementById('previewSheet').classList.contains('show')) closePreview();
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
    const wrap=document.getElementById('toastWrap'); const el=document.createElement('div');
    el.className='toast'; el.textContent=msg; wrap.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),300); }, ms||2600);
  }

  /* ============== PREFERENCES (persisted per-browser) ============== */
  function loadPrefs(){
    try{ const raw=localStorage.getItem('driftline_qld_prefs'); if(raw) return JSON.parse(raw); }catch(err){}
    return {};
  }
  function savePrefs(patch){
    try{ const cur=loadPrefs(); localStorage.setItem('driftline_qld_prefs', JSON.stringify(Object.assign(cur, patch))); }catch(err){}
  }
  const prefs = loadPrefs();

  /* ============== THEME ============== */
  const root=document.documentElement;
  let isDay = typeof prefs.day==='boolean' ? prefs.day : false;
  function setTheme(day){
    root.setAttribute('data-theme', day?'day':'night');
    const menuSwitch=document.getElementById('menuThemeSwitch');
    if(menuSwitch) menuSwitch.classList.toggle('on', !day); // switch reads "Dark mode" — on means night theme active
  }
  setTheme(isDay);
  function toggleTheme(){ isDay=!isDay; setTheme(isDay); savePrefs({day:isDay}); }

  /* ============== ALGORITHM PANEL ============== */
  let currentAlg = (prefs.alg && ALGS[prefs.alg]) ? prefs.alg : 'dijkstra';
  const algBtn=document.getElementById('algBtn'), algPanel=document.getElementById('algPanel');
  function paintPills(){
    document.querySelectorAll('.algPill').forEach(btn=>{
      const a=btn.dataset.alg, on=a===currentAlg;
      btn.classList.toggle('sel', on);
      btn.style.background = on ? `var(${ALGS[a].color})` : 'transparent';
      btn.style.color = on ? '#04211d' : '';
    });
    document.getElementById('algDesc').textContent = ALGS[currentAlg].desc;
  }
  paintPills();
  algBtn.onclick = ()=>{
    const opening = !algPanel.classList.contains('show');
    algPanel.classList.toggle('show', opening); algBtn.classList.toggle('active', opening);
    if(opening){
      closeFan(); closeAdminPanel(); closeMenu();
      if(document.getElementById('previewSheet').classList.contains('show')) closePreview();
    }
    syncControlsRecede();
  };
  document.querySelectorAll('.algPill').forEach(btn=>{
    btn.onclick=()=>{ currentAlg=btn.dataset.alg; paintPills(); savePrefs({alg:currentAlg}); if(lastPoi && !navActive) selectDestination(lastPoi); };
  });
  let animateSearch = typeof prefs.animate==='boolean' ? prefs.animate : true;
  const animSwitch=document.getElementById('animSwitch');
  animSwitch.classList.toggle('on', animateSearch);
  animSwitch.onclick=()=>{ animateSearch=!animateSearch; animSwitch.classList.toggle('on', animateSearch); savePrefs({animate:animateSearch}); };

  /* ============== HAMBURGER MENU ============== */
  const menuBtn=document.getElementById('menuBtn'), menuPanel=document.getElementById('menuPanel');
  function openMenu(){
    menuPanel.classList.add('show'); menuBtn.classList.add('open');
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeFan(); closeAdminPanel();
    if(document.getElementById('previewSheet').classList.contains('show')) closePreview();
    syncControlsRecede();
  }
  function closeMenu(){ menuPanel.classList.remove('show'); menuBtn.classList.remove('open'); syncControlsRecede(); }
  menuBtn.onclick=()=>{ menuPanel.classList.contains('show') ? closeMenu() : openMenu(); };
  document.getElementById('menuThemeSwitch').onclick=toggleTheme;

  /* ============== SEARCH ============== */
  const searchInput=document.getElementById('searchInput'), suggestBox=document.getElementById('suggestBox');
  function pinSvg(){ return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'; }
  function renderSuggestions(list){
    const withDist = list.map(n=>({ n, d: Math.hypot(n.x-car.x,n.y-car.y)*KM_PER_UNIT }));
    withDist.sort((a,b)=>a.d-b.d);
    suggestBox.innerHTML=withDist.map(({n,d})=>{
      return `<div class="suggestItem" data-id="${n.id}"><div class="suggestIcon">${pinSvg()}</div>
        <div><div class="suggestName">${n.name}</div><div class="suggestSub">${Math.round(d)} km away (straight line)</div></div></div>`;
    }).join('');
    suggestBox.classList.toggle('show', list.length>0);
    [...suggestBox.querySelectorAll('.suggestItem')].forEach(el=>{
      el.onclick=()=>{ const n=nodes[+el.dataset.id]; searchInput.value=''; suggestBox.classList.remove('show'); selectDestination(n); };
    });
  }
  searchInput.addEventListener('input', ()=>{
    const q=searchInput.value.trim().toLowerCase();
    renderSuggestions(q ? nodes.filter(n=>n.name.toLowerCase().includes(q)) : nodes);
  });
  searchInput.addEventListener('focus', ()=>{
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeAdminPanel(); closeFan(); closeMenu();
    if(document.getElementById('previewSheet').classList.contains('show')) closePreview();
    const q=searchInput.value.trim().toLowerCase();
    renderSuggestions(q ? nodes.filter(n=>n.name.toLowerCase().includes(q)) : nodes);
  });
  function handleDocumentClick(e){ if(!suggestBox.contains(e.target) && e.target!==searchInput) suggestBox.classList.remove('show'); }
  document.addEventListener('click', handleDocumentClick);
  cleanupFns.push(()=> document.removeEventListener('click', handleDocumentClick));

  /* ============== ROUTE / NAV STATE ============== */
  let currentDestination=null, currentPath=null, lastPoi=null;
  let navActive=false, navFrac=0, navSegIdx=0, playbackSeconds=15;
  let cumLen=[], cumTime=[], segLens=[], segTimes=[];
  let searchAnim=null, searchTimer=null;

  function nearestNodeTo(x,y){ let best=0,bestD=Infinity; nodes.forEach(n=>{ const d=Math.hypot(n.x-x,n.y-y); if(d<bestD){bestD=d;best=n.id;} }); return best; }

  function selectDestination(poi){
    suggestBox.classList.remove('show');
    const startNode = nearestNodeTo(car.x, car.y);
    if(poi.id===startNode){ showToast("You're already in "+poi.name); return; }
    lastPoi = poi;
    const alg = ALGS[currentAlg];
    const result = alg.fn(startNode, poi.id);
    if(!result){ showToast("No route found to "+poi.name); return; }
    const optimal = runDijkstra(startNode, poi.id);

    currentDestination = poi; currentPath = result.path;

    function settle(){
      document.getElementById('previewTitle').textContent = poi.name;
      const mins = Math.round(result.totalSec/60);
      const hrs = Math.floor(mins/60), rem = mins%60;
      const timeStr = hrs>0 ? `${hrs} h ${rem} min` : `${rem} min`;
      document.getElementById('previewMeta').textContent = `${result.totalLenKm.toFixed(0)} km · ${timeStr} · ${alg.label} · ${result.nodesExplored} towns explored`;
      const flag = document.getElementById('previewFlag');
      if(optimal && result.totalSec > optimal.totalSec*1.02){
        const pct = Math.round((result.totalSec/optimal.totalSec-1)*100);
        flag.textContent = `⚠ ${pct}% slower than the fastest route`;
        flag.style.color = 'var(--amber)';
      } else {
        flag.textContent = '✓ fastest route by travel time';
        flag.style.color = 'var(--route)';
      }
      const onRoute = hazardsOnRoute(result.path, 0);
      const onRouteWrap = document.getElementById('onRouteWrap');
      if(onRoute.length>0){
        document.getElementById('onRouteList').innerHTML = renderRouteReportRows(onRoute);
        onRouteWrap.classList.add('show');
      } else {
        onRouteWrap.classList.remove('show'); document.getElementById('onRouteList').innerHTML='';
      }
      document.getElementById('previewSheet').classList.add('show');
      document.getElementById('reportsFabWrap').classList.add('behindSheet');
      document.getElementById('reportsFanLayer').classList.add('behindSheet');
    }

    if(animateSearch && result.trace.length>1){
      playSearchAnimation(result.trace, alg.color, settle);
    } else {
      settle();
    }
  }

  function playSearchAnimation(trace, colorVar, onDone){
    if(searchTimer) clearInterval(searchTimer);
    searchAnim = { order:[], colorVar };
    let idx=0;
    const stepMs = Math.max(20, Math.min(140, 2600/trace.length));
    searchTimer = setInterval(()=>{
      if(idx>=trace.length){ clearInterval(searchTimer); searchTimer=null; onDone(); return; }
      const step = trace[idx];
      if(step.expand!==undefined) searchAnim.order.push(step.expand);
      if(step.iterationEnd){
        if(step.threshold!==undefined) showToast('New IDA* pass · cutoff ≈ '+Math.max(1,Math.round(step.threshold/60))+' min');
        else if(step.depth!==undefined) showToast('New IDS pass · depth limit '+step.depth);
      }
      idx++;
    }, stepMs);
  }

  function closePreview(){
    document.getElementById('previewSheet').classList.remove('show');
    document.getElementById('onRouteWrap').classList.remove('show');
    document.getElementById('reportsFabWrap').classList.remove('behindSheet');
    document.getElementById('reportsFanLayer').classList.remove('behindSheet');
    currentDestination=null; currentPath=null; searchAnim=null;
    if(searchTimer){ clearInterval(searchTimer); searchTimer=null; }
  }
  document.getElementById('cancelPreview').onclick=closePreview;
  document.getElementById('startDrive').onclick=startNavigation;
  document.getElementById('exitBtn').onclick=endNavigation;

  function startNavigation(){
    document.getElementById('previewSheet').classList.remove('show');
    document.getElementById('reportsFabWrap').classList.remove('behindSheet');
    document.getElementById('reportsFanLayer').classList.remove('behindSheet');
    document.getElementById('turnCard').classList.add('show');
    document.getElementById('driveHud').classList.add('show');
    document.getElementById('searchRow').style.visibility='hidden';
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeFan(); closeAdminPanel(); closeMenu();
    searchAnim=null;

    cumLen=[0]; cumTime=[0]; segLens=[]; segTimes=[];
    currentPath.forEach(seg=>{
      const e=edges[seg.edgeIdx], km=edgeKm(e), sec=edgeSeconds(e);
      segLens.push(km); segTimes.push(sec);
      cumLen.push(cumLen[cumLen.length-1]+km);
      cumTime.push(cumTime[cumTime.length-1]+sec);
    });
    const totalLen = cumLen[cumLen.length-1], totalSec = cumTime[cumTime.length-1];
    playbackSeconds = Math.max(9, Math.min(42, totalSec/280));

    navActive=true; navFrac=0; navSegIdx=0; followMode=true;
    document.getElementById('recenterBtn').classList.remove('show');
    document.documentElement.style.setProperty('--fab-bottom', '104px');
    updateTurnBanner();
    updateRouteReportsPanel();
    showToast("Drive started to "+currentDestination.name);
  }
  function endNavigation(){
    navActive=false; currentDestination=null; currentPath=null;
    document.getElementById('turnCard').classList.remove('show');
    document.getElementById('driveHud').classList.remove('show');
    document.getElementById('routeReportsPanel').classList.remove('show');
    document.getElementById('searchRow').style.visibility='visible';
    document.documentElement.style.setProperty('--fab-bottom', '16px');
    followMode=false;
  }

  function bearingOf(e,forward){ const A=nodes[forward?e.a:e.b], B=nodes[forward?e.b:e.a]; return Math.atan2(B.y-A.y,B.x-A.x); }
  function segForward(seg){ return seg.from===edges[seg.edgeIdx].a; }
  const turnIcons = {
    straight:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>',
    left:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6v6a2 2 0 002 2h9M11 5L7 9l4 4"/></svg>',
    right:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6v6a2 2 0 01-2 2H6M13 5l4 4-4 4"/></svg>',
    arrive:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2"/></svg>'
  };
  function updateTurnBanner(){
    if(!navActive || !currentPath) return;
    const seg=currentPath[navSegIdx], e=edges[seg.edgeIdx], isLast=navSegIdx===currentPath.length-1;
    let kind='straight', mainTxt='Continue on '+e.name;
    if(navSegIdx>0){
      const prevSeg=currentPath[navSegIdx-1], prevE=edges[prevSeg.edgeIdx];
      if(prevE.name!==e.name){
        let diff=bearingOf(e,segForward(seg))-bearingOf(prevE,segForward(prevSeg));
        while(diff>Math.PI) diff-=2*Math.PI; while(diff<-Math.PI) diff+=2*Math.PI;
        const deg=diff*180/Math.PI;
        if(Math.abs(deg)<25) mainTxt='Continue onto '+e.name;
        else if(deg>0){ kind='right'; mainTxt='Turn right onto '+e.name; }
        else{ kind='left'; mainTxt='Turn left onto '+e.name; }
      }
    } else { mainTxt='Head out on '+e.name; }
    document.getElementById('turnSub').textContent = isLast ? 'Arriving at '+currentDestination.name
      : 'then '+edges[currentPath[navSegIdx+1].edgeIdx].name;
    document.getElementById('turnIcon').innerHTML = turnIcons[kind];
    document.getElementById('turnMain').textContent = mainTxt;
    updateRouteReportsPanel();
  }
  function arrive(){
    document.getElementById('turnIcon').innerHTML=turnIcons.arrive;
    document.getElementById('turnMain').textContent='You have arrived';
    document.getElementById('turnSub').textContent=currentDestination.name;
    showToast('Arrived at '+currentDestination.name);
    const dest=currentDestination;
    setTimeout(endNavigation, 2200);
    navActive=false;
  }

  /* ============== MAIN LOOP ============== */
  let lastT=null, pulseT=0;
  function frame(t){
    if(lastT===null) lastT=t;
    const dt=Math.min(0.05,(t-lastT)/1000); lastT=t; pulseT+=dt;

    if(navActive && currentPath){
      navFrac += dt/playbackSeconds;
      if(navFrac>=1){
        const last=currentPath[currentPath.length-1];
        car.x=nodes[last.to].x; car.y=nodes[last.to].y;
        arrive();
      } else {
        const totalLen=cumLen[cumLen.length-1], target=navFrac*totalLen;
        let idx=0; while(idx<segLens.length-1 && cumLen[idx+1]<target) idx++;
        if(idx!==navSegIdx){ navSegIdx=idx; updateTurnBanner(); }
        const segStart=cumLen[idx], segLen=segLens[idx];
        const localT = segLen>0 ? Math.min(1,(target-segStart)/segLen) : 1;
        const seg=currentPath[idx], A=nodes[seg.from], B=nodes[seg.to];
        car.x=A.x+(B.x-A.x)*localT; car.y=A.y+(B.y-A.y)*localT;
        car.heading=Math.atan2(B.y-A.y,B.x-A.x);
        if(followMode) centerOn(car.x,car.y);

        const elapsedTime = cumTime[idx] + (segTimes[idx]*localT);
        const totalSec = cumTime[cumTime.length-1];
        const remainSec = Math.max(0,totalSec-elapsedTime);
        const remainKm = Math.max(0,totalLen-target);
        document.getElementById('hudSpeed').textContent = Math.round(edgeSpeed(edges[seg.edgeIdx]));
        const rmin=Math.round(remainSec/60);
        document.getElementById('hudTime').textContent = rmin>=60 ? Math.floor(rmin/60)+'h '+(rmin%60)+'m' : rmin+' min';
        document.getElementById('hudDist').textContent = remainKm.toFixed(0);
        document.getElementById('hudEta').textContent = new Date(Date.now()+remainSec*1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
      }
    }
    render();
    rafId = requestAnimationFrame(frame);
  }

  function render(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const styles=getComputedStyle(root);
    ctx.fillStyle=styles.getPropertyValue('--bg').trim(); ctx.fillRect(0,0,W,H);

    ctx.save(); ctx.translate(offsetX,offsetY); ctx.scale(scale,scale);

    // state landmass
    ctx.beginPath();
    OUTLINE.forEach((p,i)=> i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.closePath();
    ctx.fillStyle=styles.getPropertyValue('--land').trim(); ctx.fill();
    ctx.lineWidth=2/scale; ctx.strokeStyle=styles.getPropertyValue('--border-line').trim(); ctx.stroke();

    // roads, drawn weakest to strongest
    ['outback','rural','highway'].forEach(kind=>{
      edges.forEach(e=>{
        if(e.type!==kind) return;
        const A=nodes[e.a], B=nodes[e.b];
        ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineCap='round';
        if(kind==='outback'){
          ctx.lineWidth=4; ctx.strokeStyle=styles.getPropertyValue('--road-outback').trim(); ctx.stroke();
          ctx.lineWidth=1.4; ctx.setLineDash([6,7]); ctx.strokeStyle=styles.getPropertyValue('--road-outback-line').trim(); ctx.stroke(); ctx.setLineDash([]);
        } else if(kind==='rural'){
          ctx.lineWidth=6; ctx.strokeStyle=styles.getPropertyValue('--road-local').trim(); ctx.stroke();
          ctx.lineWidth=1.4; ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); ctx.stroke();
        } else {
          ctx.lineWidth=9; ctx.strokeStyle=styles.getPropertyValue('--road-hwy').trim(); ctx.stroke();
          ctx.lineWidth=1.8; ctx.setLineDash([10,8]); ctx.strokeStyle=styles.getPropertyValue('--road-hwy-line').trim(); ctx.stroke(); ctx.setLineDash([]);
        }
      });
    });

    // search visualization
    if(searchAnim){
      const col = styles.getPropertyValue(searchAnim.colorVar).trim();
      searchAnim.order.forEach((id,i)=>{
        const n=nodes[id]; const isCurrent = i===searchAnim.order.length-1;
        ctx.beginPath(); ctx.arc(n.x,n.y, isCurrent?10:6, 0, Math.PI*2);
        ctx.fillStyle=col; ctx.globalAlpha = isCurrent ? 0.95 : 0.35; ctx.fill(); ctx.globalAlpha=1;
        if(isCurrent){ ctx.lineWidth=2; ctx.strokeStyle=col; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(n.x,n.y,16,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1; }
      });
    }

    // final route
    if(currentPath && !searchAnim){
      ctx.beginPath();
      const first=nodes[currentPath[0].from]; ctx.moveTo(first.x,first.y);
      currentPath.forEach(seg=>{ const n=nodes[seg.to]; ctx.lineTo(n.x,n.y); });
      ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.lineWidth=7; ctx.strokeStyle=styles.getPropertyValue('--route-glow').trim(); ctx.stroke();
      ctx.lineWidth=3.4; ctx.strokeStyle=styles.getPropertyValue('--route').trim();
      if(!navActive) ctx.setLineDash([2,7]);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // towns
    const showLabels = scale>0.55;
    nodes.forEach(n=>{
      const isDest = currentDestination && currentDestination.id===n.id;
      ctx.beginPath(); ctx.arc(n.x,n.y, isDest?7:4, 0, Math.PI*2);
      ctx.fillStyle = isDest ? styles.getPropertyValue('--route').trim() : styles.getPropertyValue('--text').trim();
      ctx.globalAlpha = isDest?1:0.55; ctx.fill(); ctx.globalAlpha=1;
      if(showLabels || isDest){
        const labelPx = Math.max(9, Math.min(16, 12/scale)); // constant on-screen size regardless of zoom
        ctx.font='600 '+labelPx.toFixed(1)+'px "Space Grotesk", sans-serif';
        ctx.fillStyle=styles.getPropertyValue('--text').trim(); ctx.textBaseline='bottom';
        ctx.fillText(n.name, n.x+8/scale, n.y-4/scale);
      }
    });

    // hazards
    hazards = hazards.filter(h=>Date.now()-h.t<20*60*1000);
    const hazColors={police:'--blue', hazard:'--amber', crash:'--red'};
    const hazR = Math.max(3, Math.min(6, 5/scale)); // constant-ish on-screen size, same approach as town labels
    hazards.forEach(h=>{
      const pulse = reduceMotion?0:Math.sin(pulseT*3+h.t)*0.25+0.75;
      const col=styles.getPropertyValue(hazColors[h.type]).trim();
      ctx.beginPath(); ctx.arc(h.x,h.y,hazR*2*pulse,0,Math.PI*2); ctx.fillStyle=col; ctx.globalAlpha=0.18; ctx.fill(); ctx.globalAlpha=1;
      ctx.beginPath(); ctx.arc(h.x,h.y,hazR,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
      ctx.lineWidth=Math.max(0.8,1.4/scale); ctx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); ctx.stroke();
    });

    // car — always an arrow, pointing in the current heading (idle heading defaults to north)
    ctx.save(); ctx.translate(car.x,car.y); ctx.rotate(car.heading);
    if(!navActive){
      const pulse=reduceMotion?0:Math.sin(pulseT*2.4)*0.3+0.7;
      ctx.beginPath(); ctx.arc(0,0,12*pulse,0,Math.PI*2); ctx.fillStyle=styles.getPropertyValue('--blue').trim(); ctx.globalAlpha=0.22; ctx.fill(); ctx.globalAlpha=1;
    }
    ctx.beginPath(); ctx.moveTo(11,0); ctx.lineTo(-7,6); ctx.lineTo(-3,0); ctx.lineTo(-7,-6); ctx.closePath();
    ctx.fillStyle = navActive ? styles.getPropertyValue('--route').trim() : styles.getPropertyValue('--blue').trim();
    ctx.fill();
    ctx.lineWidth=1.6; ctx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  rafId = requestAnimationFrame(frame);
  setTimeout(handleViewportChange, 250); // re-fit once mobile browser chrome (address bar) settles
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
