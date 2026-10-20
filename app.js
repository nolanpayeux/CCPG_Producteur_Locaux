const categories = [
  { key: 'Vin Bio', icon: 'vin_bio', name: 'Vin bio' },
  { key: 'Vin', icon: 'vin', name: 'Vin' },
  { key: "Huiles d'olives", icon: 'huile_olive', name: "Huile d’olive" },
  { key: 'Marché local', icon: 'marche_local', name: 'Marché local' },
  { key: 'Légumes et fruits', icon: 'fruits_legumes', name: 'Fruits et légumes' },
  { key: 'Boucheries', icon: 'boucheries', name: 'Boucheries' },
  { key: 'Oeufs', icon: 'oeufs', name: 'Œufs' },
  { key: 'Fromagerie', icon: 'fromagerie', name: 'Fromagerie' },
  { key: 'Conserves', icon: 'conserves', name: 'Conserves' },
  { key: 'Miel', icon: 'miel', name: 'Miel' }
];

const map = L.map('map', { zoomControl: false, scrollWheelZoom: true, preferCanvas: true }).setView([43.90, 4.58], 12);
L.control.zoom({ position: 'topleft' }).addTo(map);

map.createPane('territoryMaskPane');
map.getPane('territoryMaskPane').style.zIndex = 240;
map.createPane('territoryCommunePane');
map.getPane('territoryCommunePane').style.zIndex = 250;
map.createPane('territoryBoundaryPane');
map.getPane('territoryBoundaryPane').style.zIndex = 260;

const lightBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Sources: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
  maxZoom: 16
});
const lightLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Sources: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
  maxZoom: 16
});
const orthoBase = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxZoom: 19
});
const orthoLabels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Source: Esri',
  maxZoom: 19
});


let features = [];
let active = new Set(categories.map(c => c.key));
let boundsAll = null;
let territoryBounds = null;
const markers = [];
let territoryMaskLayer = null;
let territoryCommuneLayer = null;
let territoryBoundaryLayer = null;

let currentBasemap = 'light';
function setBasemap(mode) {
  currentBasemap = mode;
  [lightBase, lightLabels, orthoBase, orthoLabels].forEach(layer => map.removeLayer(layer));
  if (mode === 'ortho') {
    orthoBase.addTo(map);
    orthoLabels.addTo(map);
    document.getElementById('zoom-chip').textContent = 'Orthophoto des producteurs locaux';
  } else {
    lightBase.addTo(map);
    lightLabels.addTo(map);
    document.getElementById('zoom-chip').textContent = 'Carte des producteurs locaux';
  }
  if (territoryMaskLayer) {
    territoryMaskLayer.setStyle({ fillOpacity: mode === 'ortho' ? 0.50 : 0.68 });
  }
  document.querySelectorAll('.basemap-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.map === mode));
}
setBasemap('light');

document.getElementById('btn-basemap-light').onclick = () => setBasemap('light');
document.getElementById('btn-basemap-ortho').onclick = () => setBasemap('ortho');

const layer = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: true,
  maxClusterRadius: 52,
  disableClusteringAtZoom: 15,
  iconCreateFunction(c) {
    const n = c.getChildCount();
    const size = n < 10 ? 40 : n < 30 ? 48 : 56;
    return L.divIcon({
      html: `<div class="cluster-inner">${n}</div>`,
      className: 'cluster ' + (n < 10 ? 'cluster-small' : n < 30 ? 'cluster-medium' : 'cluster-large'),
      iconSize: [size, size]
    });
  }
});
map.addLayer(layer);
const iconFor = key => categories.find(c => c.key === key)?.icon || 'fruits_legumes';
const imagePath = slug => 'assets/icons/' + slug + '.png';
function iconSize() {
  const z = map.getZoom();
  return z <= 11 ? 26 : z <= 13 ? 32 : z <= 15 ? 40 : z <= 17 ? 47 : 54;
}
function iconForFeature(f) {
  const size = iconSize();
  // Les marqueurs qui ont la meme position restent geographiquement exacts.
  // Seule leur ancre graphique est decalee a fort zoom pour les distinguer.
  const duplicates = f._duplicateCount || 1;
  const spread = map.getZoom() >= 15 && duplicates > 1;
  const gap = Math.max(16, size * .46);
  const offsetX = spread ? (f._duplicateIndex - (duplicates - 1) / 2) * 2 * gap : 0;
  return L.divIcon({
    className: 'marker-pin',
    html: `<img src="${imagePath(f.properties.icone || iconFor(f.properties.categorie))}" alt="">`,
    iconSize: [size, size],
    iconAnchor: [size / 2 - offsetX, size * .94],
    popupAnchor: [0, -size * .7]
  });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function validUrl(v) {
  let s = String(v || '').trim();
  if (!s || /^(pas de|aucun|non)/i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
function popup(f) {
  const p = f.properties;
  const cat = categories.find(c => c.key === p.categorie);
  const site = validUrl(p.liens);
  const desc = esc(p.description).replace(/\n/g, '<br>');
  return `<div class="popup-head"><img src="${imagePath(p.icone || iconFor(p.categorie))}" alt=""><div><h3>${esc(p.name || 'Producteur local')}</h3><small>${esc(cat?.name || p.categorie || 'Production locale')}</small></div></div><div class="popup-section">${p.Adresse ? `<p>📍 ${esc(p.Adresse)}</p>` : ''}${p.tel ? `<p>☎ ${esc(p.tel)}</p>` : ''}${desc ? `<p>${desc}</p>` : ''}${site ? `<p><a href="${esc(site)}" target="_blank" rel="noopener noreferrer">Visiter le site ↗</a></p>` : ''}</div>`;
}
function initFilters() {
  const wrap = document.getElementById('filters');
  wrap.innerHTML = '';
  const counts = Object.fromEntries(categories.map(c => [c.key, features.filter(f => f.properties.categorie === c.key).length]));
  for (const c of categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter on';
    b.dataset.category = c.key;
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<img src="${imagePath(c.icon)}" alt=""><span>${esc(c.name)}</span><small>${counts[c.key] || 0}</small>`;
    b.onclick = () => {
      if (active.has(c.key)) active.delete(c.key); else active.add(c.key);
      syncFilters();
      refresh();
    };
    wrap.append(b);
  }
}
function syncFilters() {
  for (const b of document.querySelectorAll('.filter')) {
    const on = active.has(b.dataset.category);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
function refresh() {
  const q = document.getElementById('search').value.trim().toLocaleLowerCase('fr');
  layer.clearLayers();
  const selected = markers.filter(({ f }) => active.has(f.properties.categorie) && [f.properties.name, f.properties.Adresse, f.properties.description, f.properties.categorie].some(v => String(v || '').toLocaleLowerCase('fr').includes(q)));
  selected.forEach(x => layer.addLayer(x.marker));
  document.getElementById('counter').textContent = selected.length + ' site' + (selected.length > 1 ? 's' : '') + ' affiché' + (selected.length > 1 ? 's' : '') + ' sur ' + features.length;
  if (q && selected.length === 1) {
    map.setView(selected[0].marker.getLatLng(), 15);
    selected[0].marker.openPopup();
  }
}
function reframe() {
  const group = layer.getBounds();
  if (group.isValid()) {
    map.fitBounds(group.pad(.15), { maxZoom: 13 });
  } else if (territoryBounds) {
    map.fitBounds(territoryBounds.pad(.03), { maxZoom: 12 });
  } else if (boundsAll) {
    map.fitBounds(boundsAll.pad(.12), { maxZoom: 13 });
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' — ' + url);
  return await response.json();
}
function asFeatureCollection(data) {
  if (!data) return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection') return data;
  if (data.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
  if (Array.isArray(data)) return { type: 'FeatureCollection', features: data.map(x => x.type === 'Feature' ? x : { type: 'Feature', properties: { ...x }, geometry: x.geometry }).filter(f => f.geometry) };
  return { type: 'FeatureCollection', features: [] };
}

function drawTerritoryMask(epciFeature) {
  if (!window.turf || !epciFeature) return;
  try {
    const masked = turf.mask(turf.featureCollection([epciFeature]));
    if (territoryMaskLayer) map.removeLayer(territoryMaskLayer);
    territoryMaskLayer = L.geoJSON(masked, {
      pane: 'territoryMaskPane',
      interactive: false,
      style: {
        stroke: false,
        fillColor: '#d8d4d1',
        fillOpacity: currentBasemap === 'ortho' ? 0.50 : 0.68,
        className: 'territory-mask'
      }
    }).addTo(map);
  } catch (error) {
    console.warn('Impossible de créer le masque territorial', error);
  }
}

async function loadTerritory() {
  const status = document.getElementById('territory-status');
  status.textContent = 'Chargement du contour des communes…';
  try {
    const epcis = await fetchJson('https://geo.api.gouv.fr/epcis?nom=Pont%20du%20Gard&fields=nom,code');
    const epci = Array.isArray(epcis) ? (epcis.find(x => /pont du gard/i.test(x.nom || '')) || epcis[0]) : null;
    if (!epci?.code) throw new Error('CCPG introuvable dans geo.api.gouv.fr');

    const epciGeoRaw = await fetchJson(`https://geo.api.gouv.fr/epcis/${epci.code}?format=geojson&geometry=contour&fields=nom,code`);
    const epciGeo = asFeatureCollection(epciGeoRaw);
    const epciFeature = epciGeo.features[0];

    const communesGeoRaw = await fetchJson(`https://geo.api.gouv.fr/communes?codeEpci=${epci.code}&format=geojson&geometry=contour&fields=nom,code,codesPostaux,population`);
    const communesGeo = asFeatureCollection(communesGeoRaw);

    if (territoryCommuneLayer) map.removeLayer(territoryCommuneLayer);
    territoryCommuneLayer = L.geoJSON(communesGeo, {
      pane: 'territoryCommunePane',
      interactive: false,
      style: {
        color: '#6f6158',
        weight: 1,
        opacity: 0.85,
        fillColor: '#ffffff',
        fillOpacity: 0.08,
        className: 'territory-commune'
      }
    }).addTo(map);

    if (territoryBoundaryLayer) map.removeLayer(territoryBoundaryLayer);
    territoryBoundaryLayer = L.geoJSON(epciGeo, {
      pane: 'territoryBoundaryPane',
      interactive: false,
      style: {
        color: '#9c2f27',
        weight: 2.6,
        opacity: 1,
        fillOpacity: 0,
        className: 'territory-boundary'
      }
    }).addTo(map);

    drawTerritoryMask(epciFeature);
    territoryBounds = territoryBoundaryLayer.getBounds();
    status.textContent = `${communesGeo.features.length} communes CCPG chargées depuis geo.api.gouv.fr`;
  } catch (error) {
    console.error(error);
    status.textContent = 'Contour communal indisponible pour le moment.';
    status.classList.add('error');
  }
}

async function load() {
  try {
    const response = await fetch('data/producteurs.geojson');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    features = data.features.filter(f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates));
    const samePositions = new Map();
    for (const f of features) {
      const key = f.geometry.coordinates.join(',');
      if (!samePositions.has(key)) samePositions.set(key, []);
      samePositions.get(key).push(f);
    }
    for (const group of samePositions.values()) {
      group.forEach((f, i) => {
        f._duplicateIndex = i;
        f._duplicateCount = group.length;
      });
    }
    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates;
      const marker = L.marker([lat, lon], { icon: iconForFeature(f), title: f.properties.name || 'Site' }).bindPopup(() => popup(f));
      markers.push({ f, marker });
    }
    boundsAll = L.latLngBounds(markers.map(x => x.marker.getLatLng()));
    initFilters();
    refresh();
    await loadTerritory();
    reframe();
  } catch (e) {
    document.getElementById('counter').textContent = 'Impossible de charger les données : ' + e.message;
    document.getElementById('counter').classList.add('error');
    console.error(e);
  }
}

map.on('zoomend', () => {
  for (const x of markers) x.marker.setIcon(iconForFeature(x.f));
});

document.getElementById('search').addEventListener('input', refresh);
document.getElementById('reset').onclick = () => {
  active = new Set(categories.map(c => c.key));
  document.getElementById('search').value = '';
  syncFilters();
  refresh();
  reframe();
};
document.getElementById('reframe').onclick = reframe;
document.getElementById('mobile-toggle').onclick = () => {
  const p = document.getElementById('sidebar');
  const open = p.classList.toggle('open');
  document.getElementById('mobile-toggle').setAttribute('aria-expanded', String(open));
  document.getElementById('mobile-toggle').textContent = open ? '✕   Fermer les filtres' : '☰   Catégories & recherche';
  setTimeout(() => map.invalidateSize(), 270);
};

load();


// Composition PDF : la carte Leaflet est déplacée dans une page A4 d'aperçu.
// L'impression est lancée via le dialogue du navigateur, avec « Enregistrer au format PDF ».
const printPageRule = document.createElement('style');
printPageRule.id='print-page-size';
printPageRule.textContent='@page { size: A4 landscape; margin: 0; }';
document.head.appendChild(printPageRule);
const printWorkspace = document.getElementById('print-workspace');
const printSheet = document.getElementById('print-sheet');
const printHolder = document.getElementById('print-map-holder');
const originalMapParent = document.getElementById('map').parentElement;
const mapElement = document.getElementById('map');
let printMode = false;
function updatePrintMap(){ map.invalidateSize({animate:false}); }
function openPrintMode(){
  if(printMode)return;
  printMode=true;
  document.getElementById('print-date').textContent=new Date().toLocaleDateString('fr-FR');
  printWorkspace.classList.add('open');
  printWorkspace.setAttribute('aria-hidden','false');
  printHolder.appendChild(mapElement);
  requestAnimationFrame(()=>requestAnimationFrame(updatePrintMap));
}
function closePrintMode(){
  if(!printMode)return;
  printMode=false;
  originalMapParent.insertBefore(mapElement,originalMapParent.firstChild);
  printWorkspace.classList.remove('open');
  printWorkspace.setAttribute('aria-hidden','true');
  requestAnimationFrame(()=>requestAnimationFrame(updatePrintMap));
}
document.getElementById('open-print').onclick=openPrintMode;
document.getElementById('print-close').onclick=closePrintMode;
document.getElementById('print-orientation').onchange=e=>{
  const orientation=e.target.value;
  printPageRule.textContent=`@page { size: A4 ${orientation}; margin: 0; }`;
  printSheet.classList.toggle('portrait',orientation==='portrait');
  printSheet.classList.toggle('landscape',orientation==='landscape');
  requestAnimationFrame(()=>requestAnimationFrame(updatePrintMap));
};
document.getElementById('print-now').onclick=()=>{
  // Laisser à Leaflet un court délai pour finir de dessiner les tuiles après un zoom.
  updatePrintMap();
  setTimeout(()=>window.print(),650);
};
window.addEventListener('beforeprint',()=>{if(!printMode)openPrintMode();updatePrintMap()});
