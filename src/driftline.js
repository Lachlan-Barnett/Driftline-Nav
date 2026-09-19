// Real-world data pulled from OpenStreetMap (© OpenStreetMap contributors, ODbL):
//  - places.json: extra named towns/villages/hamlets, [name, lat, lon, rank]
//  - speeds.json: signed speed limit per road, keyed "TownA|TownB"
import PLACE_DATA from './data/places.json';
import SPEED_LIMITS from './data/speeds.json';

export function initDriftline() {
  let rafId = null;
  const cleanupFns = [];
  try{
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============== PROJECTION ============== */
  // WORLD_W/WORLD_H keep the true aspect ratio at Queensland's latitudes (1° of longitude is
  // ~0.93 the length of 1° of latitude here), and KM_PER_UNIT follows from that scale.
  const LON_W=137, LON_E=154, LAT_N=-10, LAT_S=-29.5;
  const WORLD_W=970, WORLD_H=1200, KM_PER_UNIT=1.8, MAX_SPEED=110;
  function proj(lat,lon){
    return { x:(lon-LON_W)/(LON_E-LON_W)*WORLD_W, y:(lat-LAT_N)/(LAT_S-LAT_N)*WORLD_H };
  }

  /* ============== TOWNS (nodes) ============== */
  // [name, lat, lon, rank] — rank 1 = major city (label always shown), 2 = regional centre
  // (label once zoomed in a little), 3 = small town (label once zoomed in further).
  const TOWN_DATA = [
    // Cape York & Gulf
    ["Bamaga",-10.89,142.39,3],["Weipa",-12.6387,141.8711,2],["Lockhart River",-12.7853,143.3425,3],["Aurukun",-13.3561,141.7267,3],
    ["Coen",-13.9446,143.1997,3],["Laura",-15.5613,144.4469,3],["Lakeland",-15.8609,144.8579,3],["Cooktown",-15.4727,145.2534,2],
    ["Normanton",-17.67,141.08,3],["Karumba",-17.4876,140.8404,3],["Burketown",-17.7401,139.5465,3],["Doomadgee",-17.9424,138.8278,3],
    ["Croydon",-18.2043,142.2448,3],["Georgetown",-18.29,143.55,3],["Mount Surprise",-18.1456,144.3183,3],
    // Far North / Tablelands / Wet Tropics
    ["Port Douglas",-16.4846,145.4636,3],["Cairns",-16.92,145.77,1],["Mareeba",-16.9932,145.4224,2],["Chillagoe",-17.1541,144.5232,3],
    ["Atherton",-17.2667,145.4769,3],["Innisfail",-17.5242,146.0311,3],["Ravenshoe",-17.6063,145.4825,3],["Tully",-17.9340,145.9232,3],
    ["Cardwell",-18.2684,146.0300,3],["Ingham",-18.65,146.16,2],
    // North Queensland
    ["Townsville",-19.2569,146.8240,1],["Ayr",-19.5759,147.4045,3],["Charters Towers",-20.0714,146.2710,2],["Hughenden",-20.8422,144.2003,3],
    ["Richmond",-20.73,143.14,3],["Julia Creek",-20.6568,141.7451,3],["Cloncurry",-20.7052,140.5058,2],["Mount Isa",-20.7290,139.4932,1],
    ["Camooweal",-19.92,138.12,3],["Dajarra",-21.6947,139.5140,3],["Kynuna",-21.5796,141.9217,3],
    // Whitsundays / Mackay / Bowen Basin
    ["Bowen",-20.0121,148.2463,2],["Collinsville",-20.5527,147.8433,3],["Proserpine",-20.4018,148.5832,3],["Airlie Beach",-20.27,148.72,3],
    ["Mackay",-21.1420,149.1865,1],["Sarina",-21.4186,149.2183,3],["Nebo",-21.69,148.69,3],["Moranbah",-22.0030,148.0433,3],
    ["Dysart",-22.5880,148.3493,3],["Clermont",-22.8247,147.6403,3],["Capella",-23.0841,148.0229,3],["Emerald",-23.5263,148.1619,2],
    ["Blackwater",-23.5812,148.8832,3],
    // Capricorn / Central Queensland
    ["Rockhampton",-23.3782,150.5134,1],["Yeppoon",-23.1348,150.7437,3],["Mount Morgan",-23.6451,150.3883,3],["Gladstone",-23.8432,151.2561,1],
    ["Biloela",-24.3998,150.5142,3],["Springsure",-24.1171,148.0881,3],["Theodore",-24.9470,150.0760,3],["Miriam Vale",-24.33,151.56,3],
    ["Agnes Water",-24.2123,151.9030,3],["Gin Gin",-24.9928,151.9572,3],["Monto",-24.8639,151.1224,3],
    // Wide Bay / Burnett
    ["Bundaberg",-24.8653,152.3517,1],["Childers",-25.2345,152.2768,3],["Gayndah",-25.6246,151.6084,3],["Maryborough",-25.5376,152.7019,2],
    ["Hervey Bay",-25.2986,152.8535,2],["Tin Can Bay",-25.9149,153.0014,3],["Gympie",-26.1900,152.6600,2],["Noosa",-26.39,153.09,3],
    ["Kingaroy",-26.54,151.84,2],
    // South East Queensland
    ["Sunshine Coast",-26.6544,153.0934,1],["Caboolture",-27.0839,152.9511,3],["Redcliffe",-27.2269,153.1130,3],["Brisbane",-27.4690,153.0235,1],
    ["Ipswich",-27.6160,152.7608,2],["Gold Coast",-28.0024,153.4146,1],["Beaudesert",-27.9886,152.9961,3],["Gatton",-27.56,152.28,3],
    ["Toowoomba",-27.5610,151.9534,1],["Warwick",-28.2163,152.0327,2],["Stanthorpe",-28.6560,151.9338,3],["Inglewood",-28.4160,151.0805,3],
    // Darling Downs / Maranoa / South West
    ["Goondiwindi",-28.5472,150.3074,2],["Dalby",-27.1823,151.2634,2],["Chinchilla",-26.7417,150.6225,3],["Miles",-26.6597,150.1856,3],
    ["Wandoan",-26.1230,149.9611,3],["Taroom",-25.64,149.80,3],["Roma",-26.5710,148.7868,2],["Injune",-25.8432,148.5662,3],
    ["Surat",-27.15,149.07,3],["St George",-28.0367,148.5808,2],["Dirranbandi",-28.5842,148.2289,3],["Bollon",-28.0318,147.4780,3],
    ["Cunnamulla",-28.0707,145.6839,2],["Charleville",-26.4063,146.2420,2],["Mitchell",-26.4872,147.9767,3],["Augathella",-25.7969,146.5892,3],
    ["Quilpie",-26.6153,144.2696,3],["Eromanga",-26.6675,143.2706,3],["Thargomindah",-27.9960,143.8204,3],
    // Channel Country / Central West
    ["Windorah",-25.4205,142.6548,3],["Birdsville",-25.8981,139.3523,3],["Bedourie",-24.3596,139.4702,3],["Boulia",-22.9103,139.9108,3],
    ["Winton",-22.3845,143.0365,2],["Jundah",-24.8334,143.0618,3],["Longreach",-23.4378,144.2587,2],["Barcaldine",-23.5552,145.2873,3],
    ["Aramac",-22.9710,145.2439,3],["Jericho",-23.6036,146.1242,3],["Alpha",-23.65,146.64,3],["Blackall",-24.4232,145.4648,3],
    ["Tambo",-24.8831,146.2533,3],
    // Smaller towns (rank 4)
    ["Kowanyama",-15.4762,141.7466,4],
    ["Mossman",-16.4614,145.3727,4],
    ["Kuranda",-16.8209,145.6333,4],
    ["Mount Molloy",-16.6755,145.3301,4],
    ["Gordonvale",-17.0968,145.7744,4],
    ["Babinda",-17.3442,145.9234,4],
    ["Malanda",-17.3528,145.5959,4],
    ["Millaa Millaa",-17.5117,145.6138,4],
    ["Herberton",-17.3835,145.3854,4],
    ["Mount Garnet",-17.6755,145.1126,4],
    ["Dimbulah",-17.15,145.11,4],
    ["Hope Vale",-15.2948,145.1117,4],
    ["Musgrave",-14.78,143.5,4],
    ["Forsayth",-18.5873,143.6029,4],
    ["Giru",-19.5147,147.1054,4],
    ["Home Hill",-19.6642,147.4140,4],
    ["Glenden",-21.3596,148.1145,4],
    ["Carmila",-21.9087,149.4112,4],
    ["Marlborough",-22.8135,149.8895,4],
    ["Dingo",-23.6460,149.3310,4],
    ["Duaringa",-23.7212,149.6689,4],
    ["Rolleston",-24.4635,148.6229,4],
    ["Banana",-24.47,150.13,4],
    ["Moura",-24.5674,149.9747,4],
    ["Calliope",-24.0059,151.2001,4],
    ["Mount Larcom",-23.8111,150.9796,4],
    ["Eidsvold",-25.3712,151.1228,4],
    ["Mundubbera",-25.59,151.3,4],
    ["Goomeri",-26.1825,152.0678,4],
    ["Murgon",-26.2407,151.9402,4],
    ["Wondai",-26.3187,151.8738,4],
    ["Nanango",-26.6726,152.0030,4],
    ["Yarraman",-26.8411,151.9811,4],
    ["Crows Nest",-27.2613,152.0555,4],
    ["Blackbutt",-26.8830,152.1031,4],
    ["Kilcoy",-26.9431,152.5654,4],
    ["Woodford",-26.9547,152.7777,4],
    ["Esk",-27.24,152.42,4],
    ["Toogoolawah",-27.0871,152.3779,4],
    ["Lowood",-27.4623,152.5805,4],
    ["Laidley",-27.6307,152.3942,4],
    ["Boonah",-27.9969,152.6820,4],
    ["Rathdowney",-28.2111,152.8650,4],
    ["Canungra",-28.0171,153.1653,4],
    ["Oakey",-27.4360,151.7189,4],
    ["Pittsworth",-27.7199,151.6345,4],
    ["Millmerran",-27.8760,151.2701,4],
    ["Clifton",-27.9300,151.9058,4],
    ["Allora",-28.0342,151.9833,4],
    ["Killarney",-28.3354,152.2957,4],
    ["Tara",-27.2769,150.4570,4],
    ["Moonie",-27.7172,150.3704,4],
    ["Yelarbon",-28.5722,150.7529,4],
    ["Wallumbilla",-26.5844,149.1872,4],
    ["Yuleba",-26.6141,149.3845,4],
    ["Morven",-26.4158,147.1149,4],
    ["Wyandra",-27.2466,145.9777,4],
    ["Eulo",-28.1617,145.0468,4],
    ["Adavale",-25.91,144.6,4],
    ["Isisford",-24.26,144.44,4],
    ["Muttaburra",-22.5945,144.5479,4],
    ["Ilfracombe",-23.4904,144.5046,4],
    ["McKinlay",-21.27,141.29,4],
    ["Pentland",-20.5236,145.3993,4],
    ["Torrens Creek",-20.7690,145.0206,4],
    ["Gregory Downs",-18.64,138.84,4],
    ["Urandangi",-21.6094,138.3173,4],
    ["Betoota",-25.63,140.74,4],
    ["Stonehenge",-24.3528,143.2853,4],
    ["Noccundra",-27.8175,142.5884,4],
    ["Bogantungan",-23.6478,147.2902,4],
    ["Anakie",-23.5523,147.7469,4],
    ["Comet",-23.6045,148.5456,4],
    ["Tieri",-23.0358,148.3448,4],
    ["Middlemount",-22.81,148.7,4],
    ["Tiaro",-25.7273,152.5828,4],
    ["Cooroy",-26.42,152.91,4],
    ["Nambour",-26.6257,152.9600,4],
    ["Landsborough",-26.8091,152.9648,4],
    ["Maleny",-26.7586,152.8531,4],
    ["Emu Park",-23.2668,150.8202,4],
    ["Mount Perry",-25.1813,151.6454,4],
  ];
  const nodes = TOWN_DATA.map(([name,lat,lon,rank],id)=>{
    const p = proj(lat,lon);
    return { id, name, lat, lon, rank, x:p.x, y:p.y };
  });
  const NID = {}; nodes.forEach(n=>NID[n.name]=n.id);

  /* ============== ROADS (edges) ============== */
  const edges = [];
  function road(a,b,type,name){
    const A=nodes[NID[a]], B=nodes[NID[b]];
    const len = Math.hypot(A.x-B.x, A.y-B.y);
    edges.push({a:A.id,b:B.id,type,name,len,limit:SPEED_LIMITS[a+'|'+b]});
  }
  // Bruce Highway spine
  road("Innisfail","Tully","highway","Bruce Highway");
  road("Tully","Cardwell","highway","Bruce Highway");
  road("Cardwell","Ingham","highway","Bruce Highway");
  road("Ingham","Townsville","highway","Bruce Highway");
  road("Bowen","Proserpine","highway","Bruce Highway");
  road("Proserpine","Mackay","highway","Bruce Highway");
  road("Proserpine","Airlie Beach","rural","Shute Harbour Road");
  road("Mackay","Sarina","highway","Bruce Highway");
  road("Gladstone","Miriam Vale","highway","Bruce Highway");
  road("Miriam Vale","Gin Gin","highway","Bruce Highway");
  road("Gin Gin","Bundaberg","highway","Bruce Highway");
  road("Miriam Vale","Agnes Water","rural","Round Hill Road");
  road("Bundaberg","Childers","rural","Bruce Highway");
  road("Childers","Maryborough","rural","Bruce Highway");
  road("Maryborough","Hervey Bay","rural","Maryborough–Hervey Bay Road");
  road("Caboolture","Brisbane","highway","Bruce Highway");
  road("Brisbane","Redcliffe","rural","Houghton Highway");
  road("Noosa","Sunshine Coast","rural","Sunshine Motorway");
  road("Gympie","Tin Can Bay","rural","Tin Can Bay Road");
  // Capricorn / Burnett
  road("Rockhampton","Yeppoon","rural","Yeppoon Road");
  road("Rockhampton","Mount Morgan","rural","Burnett Highway");
  road("Mount Morgan","Biloela","rural","Burnett Highway");
  road("Biloela","Monto","rural","Burnett Highway");
  road("Gayndah","Kingaroy","rural","Burnett Highway");
  road("Kingaroy","Dalby","rural","Bunya Highway");
  road("Theodore","Taroom","rural","Leichhardt Highway");
  road("Taroom","Wandoan","rural","Leichhardt Highway");
  road("Wandoan","Miles","rural","Leichhardt Highway");
  road("Taroom","Injune","rural","Injune–Taroom Road");
  road("Injune","Roma","rural","Carnarvon Highway");
  // Far north
  road("Cairns","Port Douglas","highway","Captain Cook Highway");
  road("Cairns","Atherton","rural","Gillies Highway");
  road("Mareeba","Atherton","rural","Kennedy Highway");
  road("Atherton","Ravenshoe","rural","Kennedy Highway");
  road("Lakeland","Cooktown","rural","Mulligan Highway");
  road("Lakeland","Laura","outback","Peninsula Developmental Road");
  road("Coen","Weipa","outback","Peninsula Developmental Road");
  road("Coen","Lockhart River","outback","Lockhart River Road");
  road("Coen","Bamaga","outback","Bamaga Road");
  road("Weipa","Aurukun","outback","Aurukun Road");
  // Gulf Savannah
  road("Mount Surprise","Georgetown","rural","Gulf Developmental Road");
  road("Georgetown","Croydon","outback","Gulf Developmental Road");
  road("Croydon","Normanton","outback","Gulf Developmental Road");
  road("Normanton","Karumba","rural","Karumba Road");
  road("Normanton","Burketown","outback","Burketown Road");
  road("Burketown","Doomadgee","outback","Doomadgee Road");
  road("Normanton","Cloncurry","outback","Burke Developmental Road");
  // Flinders / Barkly (west)
  road("Townsville","Charters Towers","rural","Flinders Highway");
  road("Hughenden","Richmond","rural","Flinders Highway");
  road("Richmond","Julia Creek","rural","Flinders Highway");
  road("Julia Creek","Cloncurry","rural","Flinders Highway");
  road("Cloncurry","Mount Isa","rural","Barkly Highway");
  road("Mount Isa","Camooweal","rural","Barkly Highway");
  road("Mount Isa","Dajarra","outback","Donohue Highway");
  road("Dajarra","Boulia","outback","Donohue Highway");
  road("Hughenden","Winton","outback","Kennedy Developmental Road");
  road("Boulia","Winton","outback","Kennedy Developmental Road");
  road("Boulia","Bedourie","outback","Diamantina Developmental Road");
  road("Bedourie","Birdsville","outback","Birdsville Developmental Road");
  road("Windorah","Jundah","outback","Jundah–Windorah Road");
  road("Windorah","Quilpie","outback","Windorah–Quilpie Road");
  road("Bowen","Collinsville","rural","Bowen Developmental Road");
  // Matilda / Landsborough (central west)
  road("Kynuna","Winton","outback","Landsborough Highway");
  road("Winton","Longreach","rural","Landsborough Highway");
  road("Barcaldine","Aramac","outback","Aramac Road");
  road("Barcaldine","Jericho","rural","Capricorn Highway");
  road("Jericho","Alpha","rural","Capricorn Highway");
  road("Barcaldine","Blackall","outback","Landsborough Highway");
  road("Blackall","Tambo","outback","Landsborough Highway");
  road("Tambo","Augathella","outback","Landsborough Highway");
  road("Augathella","Charleville","outback","Landsborough Highway");
  // Gregory / Peak Downs (Bowen Basin)
  road("Emerald","Springsure","rural","Gregory Highway");
  road("Emerald","Capella","rural","Gregory Highway");
  road("Capella","Clermont","rural","Gregory Highway");
  road("Clermont","Charters Towers","outback","Gregory Highway");
  road("Clermont","Moranbah","rural","Peak Downs Highway");
  road("Moranbah","Dysart","rural","Peak Downs Highway");
  road("Moranbah","Nebo","rural","Peak Downs Highway");
  road("Nebo","Mackay","rural","Peak Downs Highway");
  // Warrego (south west)
  road("Mitchell","Roma","rural","Warrego Highway");
  road("Miles","Chinchilla","rural","Warrego Highway");
  road("Chinchilla","Dalby","rural","Warrego Highway");
  road("Toowoomba","Gatton","highway","Warrego Highway");
  road("Ipswich","Brisbane","highway","Ipswich Motorway");
  // Far south west
  road("Quilpie","Eromanga","outback","Adventure Way");
  road("Eromanga","Thargomindah","outback","Adventure Way");
  road("Cunnamulla","Bollon","rural","Balonne Highway");
  road("Bollon","St George","rural","Balonne Highway");
  road("St George","Dirranbandi","rural","Balonne Highway");
  road("St George","Surat","rural","Carnarvon Highway");
  road("Surat","Roma","rural","Carnarvon Highway");
  road("St George","Goondiwindi","rural","Barwon Highway");
  // South east corner
  road("Brisbane","Gold Coast","highway","Pacific Motorway");
  road("Brisbane","Beaudesert","rural","Mount Lindesay Highway");
  road("Ipswich","Warwick","rural","Cunningham Highway");
  road("Warwick","Stanthorpe","rural","New England Highway");
  road("Warwick","Inglewood","rural","Cunningham Highway");

  // Smaller-town roads and links
  road("Cairns","Gordonvale","highway","Bruce Highway");
  road("Gordonvale","Babinda","highway","Bruce Highway");
  road("Babinda","Innisfail","highway","Bruce Highway");
  road("Cairns","Kuranda","rural","Kennedy Highway");
  road("Kuranda","Mareeba","rural","Kennedy Highway");
  road("Innisfail","Millaa Millaa","rural","Palmerston Highway");
  road("Millaa Millaa","Malanda","rural","Palmerston Highway");
  road("Malanda","Atherton","rural","Malanda–Atherton Road");
  road("Mareeba","Mount Molloy","rural","Mulligan Highway");
  road("Mount Molloy","Lakeland","rural","Mulligan Highway");
  road("Laura","Musgrave","outback","Peninsula Developmental Road");
  road("Musgrave","Coen","outback","Peninsula Developmental Road");
  road("Mareeba","Dimbulah","rural","Burke Developmental Road");
  road("Dimbulah","Chillagoe","outback","Burke Developmental Road");
  road("Ravenshoe","Mount Garnet","rural","Kennedy Highway");
  road("Mount Garnet","Mount Surprise","rural","Kennedy Highway");
  road("Townsville","Giru","highway","Bruce Highway");
  road("Giru","Ayr","highway","Bruce Highway");
  road("Ayr","Home Hill","highway","Bruce Highway");
  road("Home Hill","Bowen","highway","Bruce Highway");
  road("Sarina","Carmila","highway","Bruce Highway");
  road("Carmila","Marlborough","highway","Bruce Highway");
  road("Marlborough","Rockhampton","highway","Bruce Highway");
  road("Rockhampton","Mount Larcom","highway","Bruce Highway");
  road("Mount Larcom","Gladstone","highway","Bruce Highway");
  road("Gladstone","Calliope","rural","Dawson Highway");
  road("Calliope","Biloela","rural","Dawson Highway");
  road("Springsure","Rolleston","rural","Dawson Highway");
  road("Rolleston","Banana","rural","Dawson Highway");
  road("Banana","Biloela","rural","Dawson Highway");
  road("Biloela","Moura","rural","Leichhardt Highway");
  road("Moura","Theodore","rural","Leichhardt Highway");
  road("Monto","Eidsvold","rural","Burnett Highway");
  road("Eidsvold","Mundubbera","rural","Burnett Highway");
  road("Mundubbera","Gayndah","rural","Burnett Highway");
  road("Kingaroy","Wondai","rural","Wide Bay Highway");
  road("Wondai","Murgon","rural","Wide Bay Highway");
  road("Murgon","Goomeri","rural","Wide Bay Highway");
  road("Goomeri","Gympie","rural","Wide Bay Highway");
  road("Kingaroy","Nanango","rural","D'Aguilar Highway");
  road("Nanango","Yarraman","rural","D'Aguilar Highway");
  road("Yarraman","Crows Nest","rural","New England Highway");
  road("Crows Nest","Toowoomba","rural","New England Highway");
  road("Maryborough","Tiaro","highway","Bruce Highway");
  road("Tiaro","Gympie","highway","Bruce Highway");
  road("Gympie","Cooroy","highway","Bruce Highway");
  road("Cooroy","Nambour","highway","Bruce Highway");
  road("Nambour","Landsborough","highway","Bruce Highway");
  road("Landsborough","Caboolture","highway","Bruce Highway");
  road("Sunshine Coast","Nambour","rural","Sunshine Motorway");
  road("Cooroy","Noosa","rural","Cooroy–Noosa Road");
  road("Landsborough","Maleny","rural","Maleny–Landsborough Road");
  road("Caboolture","Woodford","rural","D'Aguilar Highway");
  road("Woodford","Kilcoy","rural","D'Aguilar Highway");
  road("Kilcoy","Blackbutt","rural","D'Aguilar Highway");
  road("Blackbutt","Yarraman","rural","D'Aguilar Highway");
  road("Blackwater","Dingo","rural","Capricorn Highway");
  road("Dingo","Duaringa","rural","Capricorn Highway");
  road("Duaringa","Rockhampton","rural","Capricorn Highway");
  road("Emerald","Comet","rural","Capricorn Highway");
  road("Comet","Blackwater","rural","Capricorn Highway");
  road("Alpha","Bogantungan","rural","Capricorn Highway");
  road("Bogantungan","Anakie","rural","Capricorn Highway");
  road("Anakie","Emerald","rural","Capricorn Highway");
  road("Longreach","Ilfracombe","rural","Landsborough Highway");
  road("Ilfracombe","Barcaldine","rural","Landsborough Highway");
  road("Cloncurry","McKinlay","outback","Landsborough Highway");
  road("McKinlay","Kynuna","outback","Landsborough Highway");
  road("Charters Towers","Pentland","rural","Flinders Highway");
  road("Pentland","Torrens Creek","rural","Flinders Highway");
  road("Torrens Creek","Hughenden","rural","Flinders Highway");
  road("Burketown","Gregory Downs","outback","Wills Developmental Road");
  road("Gregory Downs","Camooweal","outback","Wills Developmental Road");
  road("Gatton","Laidley","highway","Warrego Highway");
  road("Laidley","Ipswich","highway","Warrego Highway");
  road("Toowoomba","Clifton","rural","New England Highway");
  road("Clifton","Allora","rural","New England Highway");
  road("Allora","Warwick","rural","New England Highway");
  road("Goondiwindi","Moonie","rural","Moonie Highway");
  road("Moonie","Tara","rural","Moonie Highway");
  road("Tara","Dalby","rural","Moonie Highway");
  road("Inglewood","Yelarbon","rural","Cunningham Highway");
  road("Yelarbon","Goondiwindi","rural","Cunningham Highway");
  road("Roma","Wallumbilla","rural","Warrego Highway");
  road("Wallumbilla","Yuleba","rural","Warrego Highway");
  road("Yuleba","Miles","rural","Warrego Highway");
  road("Charleville","Morven","rural","Warrego Highway");
  road("Morven","Mitchell","rural","Warrego Highway");
  road("Charleville","Wyandra","rural","Mitchell Highway");
  road("Wyandra","Cunnamulla","rural","Mitchell Highway");
  road("Thargomindah","Eulo","outback","Bulloo Developmental Road");
  road("Eulo","Cunnamulla","outback","Bulloo Developmental Road");
  road("Charleville","Adavale","outback","Adventure Way");
  road("Adavale","Quilpie","outback","Adventure Way");
  road("Birdsville","Betoota","outback","Birdsville Developmental Road");
  road("Betoota","Windorah","outback","Birdsville Developmental Road");
  road("Jundah","Stonehenge","outback","Thomson Developmental Road");
  road("Stonehenge","Longreach","outback","Thomson Developmental Road");
  road("Dalby","Oakey","highway","Warrego Highway");
  road("Oakey","Toowoomba","highway","Warrego Highway");
  road("Toowoomba","Pittsworth","rural","Gore Highway");
  road("Pittsworth","Millmerran","rural","Gore Highway");
  road("Millmerran","Goondiwindi","rural","Gore Highway");
  road("Kowanyama","Normanton","outback","Kowanyama Road");
  road("Port Douglas","Mossman","highway","Captain Cook Highway");
  road("Herberton","Atherton","rural","Herberton Road");
  road("Hope Vale","Cooktown","rural","Hope Vale Road");
  road("Forsayth","Georgetown","outback","Gulf Developmental Road");
  road("Collinsville","Glenden","rural","Bowen Developmental Road");
  road("Glenden","Nebo","rural","Suttor Developmental Road");
  road("Emu Park","Yeppoon","rural","Emu Park Road");
  road("Tieri","Capella","rural","Capella–Tieri Road");
  road("Middlemount","Dysart","rural","Dysart–Middlemount Road");
  road("Urandangi","Dajarra","outback","Urandangi Road");
  road("Noccundra","Thargomindah","outback","Adventure Way");
  road("Longreach","Muttaburra","outback","Muttaburra Road");
  road("Muttaburra","Aramac","outback","Muttaburra Road");
  road("Killarney","Warwick","rural","Killarney Road");
  road("Ipswich","Boonah","rural","Ipswich–Boonah Road");
  road("Boonah","Beaudesert","rural","Beaudesert–Boonah Road");
  road("Rathdowney","Beaudesert","rural","Mount Lindesay Highway");
  road("Beaudesert","Canungra","rural","Beaudesert–Nerang Road");
  road("Canungra","Gold Coast","rural","Beaudesert–Nerang Road");
  road("Ipswich","Lowood","rural","Brisbane Valley Highway");
  road("Lowood","Esk","rural","Brisbane Valley Highway");
  road("Esk","Toogoolawah","rural","Brisbane Valley Highway");
  road("Toogoolawah","Yarraman","rural","Brisbane Valley Highway");
  road("Longreach","Isisford","outback","Isisford Road");
  road("Isisford","Blackall","outback","Isisford Road");
  road("Gin Gin","Mount Perry","rural","Mount Perry Road");
  road("Mount Perry","Gayndah","rural","Mount Perry Road");

  const adj = new Map(); nodes.forEach(n=>adj.set(n.id, []));
  edges.forEach((e,i)=>{ adj.get(e.a).push({to:e.b, edgeIdx:i}); adj.get(e.b).push({to:e.a, edgeIdx:i}); });

  // Fallback only — every road in the network has its own signed limit in speeds.json
  // (Queensland's default limit outside built-up areas is 100 km/h).
  const SPEED = { highway:100, rural:100, outback:100, access:80, suburb:50 }; // access/suburb = local roads to extra places
  function edgeSpeed(e){ return e.limit || SPEED[e.type]; }
  function edgeKm(e){ return e.len*KM_PER_UNIT; }
  function edgeSeconds(e){ return edgeKm(e)/edgeSpeed(e)*3600; }
  function heuristicSeconds(fromId,goalId){
    const a=nodes[fromId], b=nodes[goalId];
    return Math.hypot(a.x-b.x,a.y-b.y)*KM_PER_UNIT/MAX_SPEED*3600;
  }

  /* ============== STATE OUTLINE (hand-traced from real lat/lon) ============== */
  // Mainland, clockwise from the tip of Cape York: east coast, the NSW border (Point Danger →
  // Macpherson Range → Dumaresq/Macintyre rivers → 29°S), the SA border (141°E, 26°S), the NT
  // border (138°E), then the Gulf of Carpentaria coast back up to the Cape.
  const MAINLAND_LL = [
    [-10.69,142.53],[-10.95,142.62],[-11.40,142.85],[-11.95,143.15],[-12.60,143.42],[-13.00,143.45],
    [-13.40,143.62],[-13.95,143.95],[-14.17,144.50],[-14.60,144.90],[-14.95,145.32],[-15.15,145.35],
    [-15.47,145.33],[-15.70,145.42],[-16.07,145.50],[-16.48,145.56],[-16.75,145.72],[-16.90,145.93],
    [-16.88,146.03],[-17.20,146.06],[-17.50,146.10],[-17.90,146.13],[-18.26,146.12],[-18.50,146.36],
    [-18.80,146.45],[-19.00,146.65],[-19.10,146.85],[-19.20,147.00],[-19.25,147.05],[-19.35,147.45],
    [-19.50,147.56],[-19.70,147.72],[-19.88,148.10],[-19.95,148.35],[-19.98,148.50],[-20.20,148.66],
    [-20.27,148.90],[-20.50,148.92],[-20.70,148.97],[-20.90,149.10],[-21.10,149.28],[-21.40,149.36],
    [-21.50,149.47],[-21.80,149.55],[-22.10,149.75],[-22.40,150.05],[-22.70,150.40],[-22.90,150.80],
    [-23.10,150.85],[-23.50,151.25],[-23.75,151.40],[-24.05,151.75],[-24.20,151.98],[-24.55,152.25],
    [-24.75,152.45],[-24.90,152.53],[-25.15,152.63],[-25.20,152.78],[-25.22,152.92],[-25.32,152.96],
    [-25.50,152.92],[-25.70,152.94],[-25.80,153.08],[-25.90,153.14],[-25.95,153.20],[-26.20,153.12],
    [-26.40,153.17],[-26.65,153.18],[-26.85,153.18],[-27.05,153.21],[-27.20,153.25],[-27.40,153.25],
    [-27.55,153.32],[-27.80,153.42],[-28.00,153.50],[-28.17,153.56],
    [-28.20,153.30],[-28.25,153.00],[-28.29,152.77],[-28.45,152.50],[-28.60,152.20],[-28.75,152.05],
    [-28.93,151.93],[-28.95,151.60],[-28.95,151.30],[-28.85,151.00],[-28.72,150.70],[-28.68,150.40],
    [-28.66,150.20],[-28.66,149.80],[-28.85,149.40],[-29.00,149.00],[-29.00,141.00],[-26.00,141.00],
    [-26.00,138.00],[-17.68,138.00],
    [-17.55,138.50],[-17.50,139.00],[-17.55,139.60],[-17.45,140.20],[-17.40,140.90],[-17.20,141.15],
    [-16.60,141.30],[-15.50,141.60],[-14.50,141.60],[-13.40,141.55],[-12.90,141.65],[-12.63,141.72],
    [-12.00,141.85],[-11.40,141.90],[-10.95,142.15],[-10.70,142.30],
  ];
  const ISLANDS_LL = [
    [[-24.72,153.20],[-24.95,153.33],[-25.45,153.37],[-25.72,153.22],[-25.75,153.05],[-25.40,152.98],[-25.10,153.00],[-24.85,153.05]], // K'gari (Fraser Island)
    [[-26.95,153.37],[-27.03,153.48],[-27.30,153.42],[-27.20,153.38]],                                                             // Moreton Island
    [[-27.40,153.42],[-27.48,153.56],[-27.72,153.48],[-27.55,153.40]],                                                             // North Stradbroke Island
    [[-16.45,139.30],[-16.45,139.55],[-16.70,139.60],[-16.72,139.32]],                                                             // Mornington Island
  ];
  const LAND = [MAINLAND_LL, ...ISLANDS_LL].map(poly=> poly.map(([lat,lon])=>proj(lat,lon)));

  /* ============== EXTRA PLACES (searchable/tappable, not part of the road network) ============== */
  // rank 3-4 = town, 5 = village, 6 = hamlet, 7 = suburb, 8 = rural locality. Picking one wires it into the road graph on demand
  // (see ensurePlaceNode), so the routing algorithms only ever see the towns plus places you visit.
  const places = PLACE_DATA.map(([name,lat,lon,rank])=>{
    const p = proj(lat,lon);
    return { name, lat, lon, rank, x:p.x, y:p.y, nodeId:null, link:null };
  });
  // Local roads: every place is linked into the network by a minimum spanning tree grown outward
  // from the towns, so each one hangs off its nearest neighbour (a town or another place). The
  // links are drawn whenever a place is, and become real graph edges once a place is picked.
  (function linkPlaces(){
    const n=places.length, attached=new Uint8Array(n), bestD2=new Float64Array(n).fill(Infinity), bestFrom=new Array(n);
    places.forEach((p,i)=>{
      nodes.forEach(t=>{ const dx=t.x-p.x, dy=t.y-p.y, d2=dx*dx+dy*dy; if(d2<bestD2[i]){ bestD2[i]=d2; bestFrom[i]={kind:'node', idx:t.id}; } });
    });
    const xs=new Float64Array(places.map(p=>p.x)), ys=new Float64Array(places.map(p=>p.y));
    for(let k=0;k<n;k++){
      let pick=-1;
      for(let i=0;i<n;i++) if(!attached[i] && (pick<0 || bestD2[i]<bestD2[pick])) pick=i;
      attached[pick]=1;
      places[pick].link={ kind:bestFrom[pick].kind, idx:bestFrom[pick].idx, len:Math.sqrt(bestD2[pick]) };
      const px=xs[pick], py=ys[pick];
      for(let i=0;i<n;i++){
        if(attached[i]) continue;
        const dx=xs[i]-px, dy=ys[i]-py, d2=dx*dx+dy*dy;
        if(d2<bestD2[i]){ bestD2[i]=d2; bestFrom[i]={kind:'place', idx:pick}; }
      }
    }
  })();

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
    while(!found && iter<2000){
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
  const MIN_SCALE=0.35, MAX_SCALE=64;
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

  /* ============== PAN / ZOOM (mouse drag + single-finger pan + two-finger pinch) ============== */
  let dragging=false, dragMoved=false, lastX=0, lastY=0, followMode=false;
  const activePointers = new Map(); // pointerId -> {x,y}
  let pinchActive=false, pinchLastDist=0;
  function ptDist(p1,p2){ return Math.hypot(p1.x-p2.x, p1.y-p2.y); }
  function ptMid(p1,p2){ return {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2}; }

  canvas.addEventListener('pointerdown', e=>{
    canvas.style.cursor=''; // let the .dragging grab cursor take over while panning
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

  function nodeAtClient(clientX, clientY){
    const rect=canvas.getBoundingClientRect(); const w=screenToWorld(clientX-rect.left, clientY-rect.top);
    let best=null,bestD=20/scale;
    for(const n of nodes){ if(n.virtual) continue; const d=Math.hypot(n.x-w.x,n.y-w.y); if(d<bestD){bestD=d;best=n;} }
    for(const p of places){ if(!placeVisible(p)) continue; const d=Math.hypot(p.x-w.x,p.y-w.y); if(d<bestD){bestD=d;best=p;} }
    return best;
  }
  function placeVisible(p){ return scale>=LABEL_MIN_SCALE[p.rank]*0.75; } // dots appear a little before their names do
  canvas.addEventListener('pointermove', e=>{
    if(!activePointers.has(e.pointerId)){
      // plain hover (no button/finger down) — show a pointer over anything tappable
      if(e.pointerType==='mouse') canvas.style.cursor = nodeAtClient(e.clientX, e.clientY) ? 'pointer' : '';
      return;
    }
    activePointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

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
    scale = clampScale(scale*(e.deltaY<0?1.15:0.87));
    offsetX=e.offsetX-before.x*scale; offsetY=e.offsetY-before.y*scale;
  }, {passive:false});
  document.getElementById('zoomIn').onclick=()=>zoomStep(1.2);
  document.getElementById('zoomOut').onclick=()=>zoomStep(0.83);
  function zoomStep(f){ hasInteracted=true; const before=screenToWorld(W/2,H/2); scale=clampScale(scale*f);
    offsetX=W/2-before.x*scale; offsetY=H/2-before.y*scale; }
  document.getElementById('recenterBtn').onclick=()=>{
    followMode=true; document.getElementById('recenterBtn').classList.remove('show');
    if(!navActive) fitToState();
  };
  function handleTap(e){
    if(fanOpen) closeFan();
    const best=nodeAtClient(e.clientX, e.clientY);
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
    hazards.push({id:genId(), type, x:car.x, y:car.y, t:Date.now()}); saveHazards();
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
  const PLACE_KIND = {3:'Town', 4:'Town', 5:'Village', 6:'Hamlet', 7:'Suburb', 8:'Locality'};
  function renderSuggestions(list, q){
    const withDist = list.map(n=>({ n, d: Math.hypot(n.x-car.x,n.y-car.y)*KM_PER_UNIT }));
    // name-prefix matches first, then nearest first
    withDist.sort((a,b)=> (q ? (b.n.name.toLowerCase().startsWith(q)-a.n.name.toLowerCase().startsWith(q)) : 0) || a.d-b.d);
    const shown = withDist.slice(0,40);
    suggestBox.innerHTML=shown.map(({n,d},i)=>{
      const kind = n.nodeId!==undefined ? PLACE_KIND[n.rank]+' · ' : '';
      return `<div class="suggestItem" data-i="${i}"><div class="suggestIcon">${pinSvg()}</div>
        <div><div class="suggestName">${n.name}</div><div class="suggestSub">${kind}${Math.round(d)} km away (straight line)</div></div></div>`;
    }).join('');
    suggestBox.classList.toggle('show', list.length>0);
    [...suggestBox.querySelectorAll('.suggestItem')].forEach(el=>{
      el.onclick=()=>{ const n=shown[+el.dataset.i].n; searchInput.value=''; suggestBox.classList.remove('show'); selectDestination(n); };
    });
  }
  function matchesFor(q){ return q ? nodes.filter(n=>!n.virtual && n.name.toLowerCase().includes(q)).concat(places.filter(p=>p.name.toLowerCase().includes(q))) : nodes.filter(n=>!n.virtual); }
  searchInput.addEventListener('input', ()=>{
    const q=searchInput.value.trim().toLowerCase();
    renderSuggestions(matchesFor(q), q);
  });
  searchInput.addEventListener('focus', ()=>{
    algPanel.classList.remove('show'); algBtn.classList.remove('active');
    closeAdminPanel(); closeFan(); closeMenu();
    if(document.getElementById('previewSheet').classList.contains('show')) closePreview();
    const q=searchInput.value.trim().toLowerCase();
    renderSuggestions(matchesFor(q), q);
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

  // Extra places are not in the road graph until you pick one: it gets a node plus a short access
  // road to the nearest town, so every routing algorithm can reach it like any other destination.
  function ensurePlaceNode(place){
    if(place.nodeId!==null) return nodes[place.nodeId];
    // walk up the local-road tree to the first town / already-created place, then build back down
    const chain=[]; let cur=place;
    while(cur && cur.nodeId===null){ chain.push(cur); cur = cur.link.kind==='place' ? places[cur.link.idx] : null; }
    for(let i=chain.length-1; i>=0; i--){
      const p=chain[i];
      const parent = p.link.kind==='node' ? nodes[p.link.idx] : nodes[places[p.link.idx].nodeId];
      const node={ id:nodes.length, name:p.name, lat:p.lat, lon:p.lon, rank:p.rank, x:p.x, y:p.y, virtual:true };
      nodes.push(node); adj.set(node.id, []);
      edges.push({ a:parent.id, b:node.id, type:'access', name:'Local roads to '+p.name, len:p.link.len, limit:p.rank===7 ? SPEED.suburb : SPEED.access });
      const edgeIdx=edges.length-1;
      adj.get(parent.id).push({to:node.id, edgeIdx}); adj.get(node.id).push({to:parent.id, edgeIdx});
      p.nodeId=node.id;
    }
    return nodes[place.nodeId];
  }

  function selectDestination(poi){
    if(poi.nodeId!==undefined) poi=ensurePlaceNode(poi);
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
    searchAnim = { seen:new Set(), current:-1, colorVar };
    let idx=0;
    const stepMs = Math.max(20, Math.min(140, 2600/trace.length));
    // Deep searches (IDS / IDA*) can revisit towns thousands of times on a map this size, so
    // play several trace steps per tick to keep the whole animation to a few seconds.
    const perTick = Math.max(1, Math.ceil(trace.length*stepMs/3200));
    searchTimer = setInterval(()=>{
      if(idx>=trace.length){ clearInterval(searchTimer); searchTimer=null; onDone(); return; }
      let lastPass=null;
      for(let k=0; k<perTick && idx<trace.length; k++, idx++){
        const step = trace[idx];
        if(step.expand!==undefined){ searchAnim.seen.add(step.expand); searchAnim.current=step.expand; }
        if(step.iterationEnd) lastPass=step;
      }
      if(lastPass){
        if(lastPass.threshold!==undefined) showToast('New IDA* pass · cutoff ≈ '+Math.max(1,Math.round(lastPass.threshold/60))+' min');
        else if(lastPass.depth!==undefined) showToast('New IDS pass · depth limit '+lastPass.depth);
      }
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
  const LABEL_MIN_SCALE = {1:0, 2:0.8, 3:1.2, 4:2.2, 5:3.6, 6:5.5, 7:12, 8:24}; // zoom at which each rank gets a name label // zoom level at which each town rank gets a name label
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
    const zs = Math.max(1, scale/1.4); // divide world-unit sizes by this so deep zoom doesn't balloon them

    // state landmass (mainland + the larger islands)
    ctx.lineJoin='round';
    ctx.fillStyle=styles.getPropertyValue('--land').trim();
    ctx.lineWidth=2/scale; ctx.strokeStyle=styles.getPropertyValue('--border-line').trim();
    LAND.forEach(poly=>{
      ctx.beginPath();
      poly.forEach((p,i)=> i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // roads, drawn weakest to strongest
    ['access','outback','rural','highway'].forEach(kind=>{
      edges.forEach(e=>{
        if(e.type!==kind) return;
        const A=nodes[e.a], B=nodes[e.b];
        ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineCap='round';
        if(kind==='access'){
          ctx.lineWidth=1.6/zs; ctx.setLineDash([3/zs,4/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); ctx.stroke(); ctx.setLineDash([]);
        } else if(kind==='outback'){
          ctx.lineWidth=4/zs; ctx.strokeStyle=styles.getPropertyValue('--road-outback').trim(); ctx.stroke();
          ctx.lineWidth=1.4/zs; ctx.setLineDash([6/zs,7/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-outback-line').trim(); ctx.stroke(); ctx.setLineDash([]);
        } else if(kind==='rural'){
          ctx.lineWidth=6/zs; ctx.strokeStyle=styles.getPropertyValue('--road-local').trim(); ctx.stroke();
          ctx.lineWidth=1.4/zs; ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); ctx.stroke();
        } else {
          ctx.lineWidth=9/zs; ctx.strokeStyle=styles.getPropertyValue('--road-hwy').trim(); ctx.stroke();
          ctx.lineWidth=1.8/zs; ctx.setLineDash([10/zs,8/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-hwy-line').trim(); ctx.stroke(); ctx.setLineDash([]);
        }
      });
    });

    // search visualization
    if(searchAnim){
      const col = styles.getPropertyValue(searchAnim.colorVar).trim();
      searchAnim.seen.forEach(id=>{
        if(id===searchAnim.current) return;
        const n=nodes[id];
        ctx.beginPath(); ctx.arc(n.x,n.y, 6/zs, 0, Math.PI*2);
        ctx.fillStyle=col; ctx.globalAlpha=0.35; ctx.fill(); ctx.globalAlpha=1;
      });
      if(searchAnim.current>=0){
        const n=nodes[searchAnim.current];
        ctx.beginPath(); ctx.arc(n.x,n.y, 10/zs, 0, Math.PI*2);
        ctx.fillStyle=col; ctx.globalAlpha=0.95; ctx.fill(); ctx.globalAlpha=1;
        ctx.lineWidth=2/zs; ctx.strokeStyle=col; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(n.x,n.y,16/zs,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1;
      }
    }

    // final route
    if(currentPath && !searchAnim){
      ctx.beginPath();
      const first=nodes[currentPath[0].from]; ctx.moveTo(first.x,first.y);
      currentPath.forEach(seg=>{ const n=nodes[seg.to]; ctx.lineTo(n.x,n.y); });
      ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.lineWidth=7/zs; ctx.strokeStyle=styles.getPropertyValue('--route-glow').trim(); ctx.stroke();
      ctx.lineWidth=3.4/zs; ctx.strokeStyle=styles.getPropertyValue('--route').trim();
      if(!navActive) ctx.setLineDash([2/zs,7/zs]);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // towns
    const DOT_R = {1:5, 2:4, 3:3, 4:2.5};
    const textCol = styles.getPropertyValue('--text').trim(), routeCol = styles.getPropertyValue('--route').trim();
    // viewport in world coordinates, so we only draw what is on screen
    const vx0=-offsetX/scale-30/scale, vx1=(W-offsetX)/scale+30/scale, vy0=-offsetY/scale-30/scale, vy1=(H-offsetY)/scale+30/scale;
    const inView = p=> p.x>=vx0 && p.x<=vx1 && p.y>=vy0 && p.y<=vy1;
    const isDestNode = n=> currentDestination && currentDestination.id===n.id;
    ctx.beginPath();
    places.forEach(p=>{
      if(!placeVisible(p)) return;
      const q = p.link.kind==='node' ? nodes[p.link.idx] : places[p.link.idx];
      // skip links whose bounding box is entirely off screen
      if(Math.max(p.x,q.x)<vx0 || Math.min(p.x,q.x)>vx1 || Math.max(p.y,q.y)<vy0 || Math.min(p.y,q.y)>vy1) return;
      ctx.moveTo(q.x,q.y); ctx.lineTo(p.x,p.y);
    });
    ctx.lineWidth=1.3/zs; ctx.setLineDash([3/zs,4/zs]); ctx.strokeStyle=styles.getPropertyValue('--road-local-line').trim(); ctx.stroke(); ctx.setLineDash([]);
    places.forEach(p=>{
      if(!placeVisible(p) || !inView(p) || (p.nodeId!==null && isDestNode(nodes[p.nodeId]))) return;
      ctx.beginPath(); ctx.arc(p.x,p.y, 2/zs, 0, Math.PI*2);
      ctx.fillStyle=textCol; ctx.globalAlpha=0.4; ctx.fill(); ctx.globalAlpha=1;
    });
    nodes.forEach(n=>{
      const isDest = isDestNode(n);
      if(n.virtual && !isDest) return;
      ctx.beginPath(); ctx.arc(n.x,n.y, (isDest?7:DOT_R[n.rank])/zs, 0, Math.PI*2);
      ctx.fillStyle = isDest ? routeCol : textCol;
      ctx.globalAlpha = isDest?1:0.55; ctx.fill(); ctx.globalAlpha=1;
    });
    // labels: bigger towns win, smaller ones appear as you zoom in, and any label that would
    // overlap one already placed is skipped so a map this dense stays readable
    const onPath = new Set();
    if(currentPath) currentPath.forEach(seg=>{ onPath.add(seg.from); onPath.add(seg.to); });
    const priority = n=> (n.id!==undefined && currentDestination && currentDestination.id===n.id) ? 0 : (n.id!==undefined && onPath.has(n.id)) ? 1 : 1+n.rank;
    const labelPx = 12/scale; // constant 12px on screen regardless of zoom
    ctx.font='600 '+labelPx.toFixed(1)+'px "Space Grotesk", sans-serif';
    ctx.fillStyle=textCol; ctx.textBaseline='bottom';
    const pad=3/scale, placed=[];
    const candidates = nodes.filter(n=> (!n.virtual || isDestNode(n)) && (priority(n)<=1 || scale>=LABEL_MIN_SCALE[n.rank]))
      .concat(places.filter(p=> scale>=LABEL_MIN_SCALE[p.rank] && inView(p) && !(p.nodeId!==null && isDestNode(nodes[p.nodeId]))));
    candidates
      .sort((a,b)=>priority(a)-priority(b))
      .forEach(n=>{
        const w=ctx.measureText(n.name).width, x0=n.x+8/scale, y1=n.y-4/scale;
        const r={x0:x0-pad, x1:x0+w+pad, y0:y1-labelPx-pad, y1:y1+pad};
        if(placed.some(p=> r.x0<p.x1 && r.x1>p.x0 && r.y0<p.y1 && r.y1>p.y0)) return;
        placed.push(r);
        ctx.fillText(n.name, x0, y1);
      });

    // hazards
    hazards = hazards.filter(h=>Date.now()-h.t<20*60*1000);
    const hazColors={police:'--blue', hazard:'--amber', crash:'--red'};
    const hazR = Math.min(6, 5/scale); // ~5px on screen once zoomed in, same approach as town labels
    hazards.forEach(h=>{
      const pulse = reduceMotion?0:Math.sin(pulseT*3+h.t)*0.25+0.75;
      const col=styles.getPropertyValue(hazColors[h.type]).trim();
      ctx.beginPath(); ctx.arc(h.x,h.y,hazR*2*pulse,0,Math.PI*2); ctx.fillStyle=col; ctx.globalAlpha=0.18; ctx.fill(); ctx.globalAlpha=1;
      ctx.beginPath(); ctx.arc(h.x,h.y,hazR,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
      ctx.lineWidth=1.4/scale; ctx.strokeStyle=styles.getPropertyValue('--map-bg').trim(); ctx.stroke();
    });

    // car — always an arrow, pointing in the current heading (idle heading defaults to north)
    ctx.save(); ctx.translate(car.x,car.y); ctx.rotate(car.heading); ctx.scale(1/zs,1/zs);
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
