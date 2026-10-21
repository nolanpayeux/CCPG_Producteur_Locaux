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
let originalGeoJson = null;
let editorEnabled = false;
let selectedFeature = null;
let locatingFeature = false;
let dragPreview = null;
const undoStack = [];
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
  maxClusterRadius: zoom => zoom >= 15 ? 37 : 52,
  disableClusteringAtZoom: 21,
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
// À partir du zoom 15 : marqueurs indépendants et traits de rattachement.
const individualMarkers = L.layerGroup();
const connectionLines = L.layerGroup();
map.createPane('pointConnections');
map.getPane('pointConnections').style.zIndex = 410;
map.getPane('pointConnections').style.pointerEvents = 'none';
const iconFor = key => categories.find(c => c.key === key)?.icon || 'fruits_legumes';
const imagePath = slug => 'assets/icons/' + slug + '.png';
function iconSize() {
  const z = map.getZoom();
  return z <= 11 ? 26 : z <= 13 ? 32 : z <= 15 ? 40 : z <= 17 ? 47 : 54;
}
function iconForFeature(f) {
  const size = iconSize();
  return L.divIcon({
    className: 'marker-pin',
    html: `<img src="${imagePath(f.properties.icone || iconFor(f.properties.categorie))}" alt="">`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size * .94],
    popupAnchor: [0, -size * .7]
  });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function contactLinks(value) {
  const entries = String(value ?? '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
  const links = [];
  for (const value of entries) {
    if (/^(pas de|aucun|non|sans site)/i.test(value)) continue;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      links.push(`<p>✉ <a href="mailto:${esc(value)}">Envoyer un e-mail</a> <span class="popup-link-detail">${esc(value)}</span></p>`);
      continue;
    }
    const candidate = /^https?:\/\//i.test(value) ? value : 'https://' + value;
    try {
      const parsed = new URL(candidate);
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) continue;
      links.push(`<p>↗ <a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Site internet</a> <span class="popup-link-detail">${esc(parsed.hostname.replace(/^www\./, ''))}</span></p>`);
    } catch (_) { /* Valeur non reconnue : ne pas créer de lien erroné. */ }
  }
  return [...new Set(links)].join('');
}
// Nettoie uniquement la représentation HTML : le GeoJSON source reste intact.
function readableDescription(raw) {
  return String(raw ?? '')
    // Images et pièces jointes intégrées par uMap (souvent des JPEG Base64 géants).
    .replace(/\{\{\s*data:image\/[^\n]*?(?:\}\}|$)/gi, '')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, '')
    // Balises image uMap, avec URL distante et dimension optionnelle.
    .replace(/\{\{\s*https?:\/\/[^}]+\}\}/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
function popup(f) {
  const p = f.properties;
  const cat = categories.find(c => c.key === p.categorie);
  const contacts = contactLinks(p.liens ?? p.site_internet ?? p.website ?? p.url);
  const desc = esc(readableDescription(p.description)).replace(/\n/g, '<br>');
  return `<div class="popup-head"><img src="${imagePath(p.icone || iconFor(p.categorie))}" alt=""><div><h3>${esc(p.name || 'Producteur local')}</h3><small>${esc(cat?.name || p.categorie || 'Production locale')}</small></div></div><div class="popup-section">${p.Adresse ? `<p>📍 ${esc(p.Adresse)}</p>` : ''}${p.tel ? `<p>☎ ${esc(p.tel)}</p>` : ''}${desc ? `<p>${desc}</p>` : ''}${contacts}</div>`;
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
// V10 : les objets sources restent indépendants pour l'édition et l'export.
// La représentation publique est organisée par SITE (nom + adresse cohérente).
// Les distances sont contrôlées pour ne pas fusionner deux implantations éloignées.
const siteMarkers = [];
const siteFanMarkers = L.layerGroup();
const siteConnections = L.layerGroup();
const SITE_MAX_DISTANCE_METERS = 130;
// Rattachement vérifié par proximité et adresse : le libellé générique de
// la ligne légumes correspond au même chemin que Les Vergers de l'Ilon.
// La géométrie et les propriétés source restent intactes.
const SITE_ALIASES = [{
  originalName:'Meynes, Producteurs légumes',
  canonicalName:"Les Vergers de l'ilon",
  addressContains:'mas de l ilon',
  near:[43.8839,4.5805], maxMeters:120
}];
function canonicalSiteName(entry) {
  const name=normalizeSiteText(entry.f.properties.name);
  const addr=normalizeSiteText(entry.f.properties.Adresse);
  for(const a of SITE_ALIASES){
    if(name===normalizeSiteText(a.originalName) && addr.includes(a.addressContains)
      && map.distance(entry.originalLatLng,L.latLng(a.near)) <= a.maxMeters){
      return normalizeSiteText(a.canonicalName);
    }
  }
  return name;
}
function siteAddressKey(entry) {
  const addr=normalizeSiteText(entry.f.properties.Adresse);
  if(canonicalSiteName(entry)===normalizeSiteText("Les Vergers de l'ilon") && addr.includes('mas de l ilon')) return 'mas de l ilon meynes';
  return addr;
}


function normalizeSiteText(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function siteId(f) { return String(f.properties.site_id || '').trim(); }
function groupCenter(g) {
  const p=g.members.find(x=>Number.isFinite(Number(x.f.properties.site_lat)) && Number.isFinite(Number(x.f.properties.site_lon)) && x.f.properties.site_lat !== undefined && x.f.properties.site_lon !== undefined);
  return p ? L.latLng(Number(p.f.properties.site_lat),Number(p.f.properties.site_lon)) : null;
}
function allSiteGroups() { return getSiteGroups(markers); }
function getSiteGroups(entries) {
  const groups = [];
  // Un nom seul ne suffit pas à fusionner : il faut une adresse compatible ET une proximité réelle.
  for (const entry of entries) {
    const name = canonicalSiteName(entry);
    const address = siteAddressKey(entry);
    const explicitId=siteId(entry.f);
    let group = explicitId ? groups.find(g=>g.id===explicitId) : groups.find(g => !g.id && name && g.name === name &&
      ((address && g.address && address === g.address) || (!address && !g.address)) &&
      g.members.every(x => map.distance(x.originalLatLng, entry.originalLatLng) <= SITE_MAX_DISTANCE_METERS));
    if (!group) {
      group = {id:explicitId||'',name, address, members: []};
      groups.push(group);
    }
    group.members.push(entry);
  }
  // Position de site : le point source le plus central (médoïde), jamais une coordonnée fictive.
  for (const group of groups) {
    const medoid = group.members.slice().sort((a, b) => {
      const score = e => group.members.reduce((sum, other) => sum + map.distance(e.originalLatLng, other.originalLatLng), 0);
      return score(a) - score(b);
    })[0];
    group.position = groupCenter(group) || medoid.originalLatLng;
    if (group.id) group.name=normalizeSiteText(group.members[0].f.properties.site_nom || group.members[0].f.properties.name);
    group.categories = [...new Set(group.members.map(x => x.f.properties.categorie))];
    group.title = (group.id ? group.members.find(x=>x.f.properties.site_nom)?.f.properties.site_nom : '') || group.members.find(x=>normalizeSiteText(x.f.properties.name)===group.name)?.f.properties.name || medoid.f.properties.name || 'Producteur local';
  }
  return groups;
}
function siteIcon(group) {
  if (group.categories.length === 1) return iconForFeature(group.members[0].f);
  const size = iconSize();
  return L.divIcon({
    className: 'site-multi-marker',
    html: `<span class="site-multi-dot">${group.categories.length}</span>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor:[0,-size/2]
  });
}
function sitePopup(group) {
  const categoriesHtml = group.categories.map(c => {
    const category=categories.find(x=>x.key===c);
    return `<span class="site-category"><img src="${imagePath(iconFor(c))}" alt="">${esc(category?.name||c)}</span>`;
  }).join('');
  const address = group.members.find(x=>x.f.properties.Adresse)?.f.properties.Adresse;
  return `<div class="site-popup"><h3>${esc(group.title)}</h3>${address?`<p>📍 ${esc(address)}</p>`:''}<p><strong>${group.categories.length} production${group.categories.length>1?'s':''}</strong></p><div class="site-categories">${categoriesHtml}</div></div>`;
}
function siteMarker(group) {
  const marker = L.marker(group.position, {
    icon:siteIcon(group),title:group.title,autoPan:false
  }).bindPopup(()=>sitePopup(group),{autoPan:false});
  return marker;
}
function drawSiteFan(groups,forEdition=false) {
  siteFanMarkers.clearLayers();
  siteConnections.clearLayers();
  // Position réelle de chacun des sites; seules les icônes d'activités sont déployées.
  for (const group of groups) {
    if ((forEdition ? group.members.length : group.categories.length) <= 1) {
      const entry=group.members[0];
      if(forEdition){
        const m=L.marker(entry.originalLatLng,{icon:iconForFeature(entry.f),autoPan:false,title:group.title});
        m.on('click',()=>editFeature(entry.f));
        siteFanMarkers.addLayer(m);
      } else siteFanMarkers.addLayer(siteMarker(group));
      continue;
    }
    const center = map.latLngToLayerPoint(group.position);
    const itemsToRender=forEdition ? group.members.map(x=>({category:x.f.properties.categorie,items:[x]})) : group.categories.map(category=>({category,items:group.members.filter(x=>x.f.properties.categorie===category)}));
    const n = itemsToRender.length;
    const size = iconSize();
    const radius = Math.max(size * 1.30, (size+14)/(2*Math.sin(Math.PI/n)));
    const marker = L.circleMarker(group.position, {
      radius:5, color:'#a93b30', weight:2, fillColor:'#ffffff',fillOpacity:1,interactive:true,
      title:group.title
    }).bindPopup(()=>sitePopup(group),{autoPan:false});
    siteFanMarkers.addLayer(marker);
    // L'icône principale représente l'identité du site, pas une activité supplémentaire.
    const centerBadge=L.marker(group.position,{
      icon:L.divIcon({className:'site-anchor',html:`<span>${n}</span>`,iconSize:[25,25],iconAnchor:[12.5,12.5]}),
      autoPan:false,title:group.title
    }).bindPopup(()=>sitePopup(group),{autoPan:false});
    siteFanMarkers.addLayer(centerBadge);
    itemsToRender.forEach(({category,items}, i) => {
      const angle = -Math.PI/2 + (2*Math.PI*i/n);
      const target = map.layerPointToLatLng(L.point(center.x + radius*Math.cos(angle), center.y + radius*Math.sin(angle)));
      // Garder les fiches distinctes même si plusieurs lignes sources ont la même catégorie.
      const feature = items[0].f;
      const marker=L.marker(target, {icon:iconForFeature(feature),title:`${group.title} — ${category}`,autoPan:false})
        .bindPopup(()=>items.map(x=>popup(x.f)).join('<hr class="site-separator">'),{autoPan:false});
      if(forEdition){
        marker.off('click');
        marker.on('click',()=>{marker.closePopup();editFeature(feature);});
      }
      siteFanMarkers.addLayer(marker);
      // Trait court et discret vers le site, et non vers une position décalée d'un autre producteur.
      L.polyline([group.position,target],{pane:'pointConnections',interactive:false,color:'#9b8780',weight:1,opacity:.34,dashArray:'2 5'})
        .addTo(siteConnections);
    });
  }
}
function refresh() {
  const q = document.getElementById('search').value.trim().toLocaleLowerCase('fr');
  layer.clearLayers(); individualMarkers.clearLayers(); connectionLines.clearLayers();
  siteFanMarkers.clearLayers(); siteConnections.clearLayers();
  [layer,individualMarkers,connectionLines,siteFanMarkers,siteConnections].forEach(x=>map.removeLayer(x));
  const selected = markers.filter(({ f }) => active.has(f.properties.categorie) &&
    [f.properties.name,f.properties.Adresse,readableDescription(f.properties.description),f.properties.categorie]
      .some(v=>String(v||'').toLocaleLowerCase('fr').includes(q)));
  selected.forEach(x => x.marker.setLatLng(x.originalLatLng));
  const groups = getSiteGroups(selected);
  if (editorEnabled) {
    // Les clusters classiques cachaient les fiches et empêchaient leur sélection.
    // Zoom faible : chaque site est cliquable et amène aux fiches individuelles.
    // Zoom détaillé : chaque OBJET source a son propre pictogramme dans l'éventail.
    if(map.getZoom()<15){
      map.addLayer(siteFanMarkers);
      groups.forEach(g=>{
        const m=siteMarker(g);
        m.off('click');
        m.on('click',()=>{m.closePopup();map.setView(g.position,16);});
        siteFanMarkers.addLayer(m);
      });
    } else {
      map.addLayer(siteConnections);
      map.addLayer(siteFanMarkers);
      drawSiteFan(groups,true);
    }
    document.getElementById('counter').textContent = `${groups.length} site(s) • ${selected.length} fiche(s) éditables`;
    return;
  }
  if(map.getZoom() < 15) {
    map.addLayer(layer);
    groups.forEach(g=>layer.addLayer(siteMarker(g)));
  } else {
    map.addLayer(siteConnections);
    map.addLayer(siteFanMarkers);
    drawSiteFan(groups);
  }
  document.getElementById('counter').textContent = `${groups.length} site${groups.length>1?'s':''} • ${selected.length} production${selected.length>1?'s':''} affichée${selected.length>1?'s':''} sur ${features.length}`;
}

function reframe() {
  const group = layer.getBounds();
  if (group.isValid() && map.getZoom() < 15) {
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
    originalGeoJson = structuredClone(data);
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
      const originalLatLng = L.latLng(lat, lon);
      const marker = L.marker(originalLatLng, { icon: iconForFeature(f), title: f.properties.name || 'Site', autoPan: false }).bindPopup(() => popup(f), { autoPan: false });
      markers.push({ f, marker, originalLatLng });
      marker.on('click', () => { if (editorEnabled) { marker.closePopup(); editFeature(f); } });
    }
    boundsAll = L.latLngBounds(markers.map(x => x.originalLatLng));
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
  refresh();
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
  if (editorEnabled) setEditor(false);
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


// V6 — Édition locale. Ne transmet aucune modification à un serveur.
const editPanel = document.getElementById('edit-panel');
const editForm = document.getElementById('edit-form');
const editStatus = document.getElementById('edit-status');
const editLaunch = document.getElementById('edit-launch');
const fieldsToEdit = ['name','categorie','Adresse','tel','liens','description'];
const editCategory = document.getElementById('edit-category');
for (const c of categories) editCategory.add(new Option(c.name, c.key));
function setStatus(text) { editStatus.textContent = text; }
function setEditor(isOn) {
  if (isOn && printMode) closePrintMode();
  clearDragPreview();
  editorEnabled = isOn;
  editPanel.hidden = !isOn;
  editLaunch.classList.toggle('active', isOn);
  editLaunch.textContent = isOn ? '✕ Quitter édition' : '✎ Mode édition';
  if (!isOn) { locatingFeature = false; editForm.hidden = true; selectedFeature = null; }
  document.getElementById('open-print').hidden = isOn;
  setStatus(isOn ? 'Cliquez sur un producteur pour modifier sa fiche, ou gérez les groupes.' : '');
  refresh(); refreshGroupControls();
}
editLaunch.onclick = () => setEditor(!editorEnabled);
document.getElementById('edit-close').onclick = () => setEditor(false);
function editFeature(f) {
  if (!editorEnabled) return;
  clearDragPreview();
  selectedFeature = f;
  editForm.hidden = false;
  locatingFeature = false;
  for (const name of fieldsToEdit) editForm.elements.namedItem(name).value = f.properties[name] ?? '';
  editForm.elements.namedItem('lat').value = f.geometry.coordinates[1];
  editForm.elements.namedItem('lon').value = f.geometry.coordinates[0];
  document.getElementById('edit-delete').hidden = !features.includes(f);
  refreshGroupControls();
  document.getElementById('edit-site').value=siteId(f);
  setStatus('Modification du producteur « ' + (f.properties.name || 'Sans nom') + ' ».');
}
function snapshot() { undoStack.push(structuredClone(features)); if (undoStack.length > 30) undoStack.shift(); }
function refreshEditionData() {
  // Reconstruit les marqueurs : coordonnées sources intactes, décalage visuel géré par refresh().
  layer.clearLayers(); individualMarkers.clearLayers(); connectionLines.clearLayers();
  markers.length = 0;
  for (const f of features) {
    const [lon,lat] = f.geometry.coordinates;
    const originalLatLng = L.latLng(lat,lon);
    const marker = L.marker(originalLatLng,{ icon: iconForFeature(f), title:f.properties.name || 'Producteur', autoPan:false }).bindPopup(()=>popup(f),{autoPan:false});
    marker.on('click',()=>{ if(editorEnabled){ marker.closePopup(); editFeature(f); } });
    markers.push({f,marker,originalLatLng});
  }
  boundsAll = markers.length ? L.latLngBounds(markers.map(m=>m.originalLatLng)) : null;
  initFilters(); syncFilters(); refresh(); refreshGroupControls();
}
document.getElementById('edit-add').onclick = () => {
  const center = map.getCenter();
  editFeature({type:'Feature',geometry:{type:'Point',coordinates:[center.lng,center.lat]},properties:{ name:'',categorie:categories[0].key, description:'', Adresse:'',tel:'',liens:'',icone:categories[0].icon }});
  setStatus('Nouveau producteur : complétez le formulaire puis sélectionnez son emplacement.');
};
document.getElementById('edit-cancel').onclick = () => { clearDragPreview(); editForm.hidden=true; selectedFeature=null; locatingFeature=false; setStatus('Édition annulée.'); };
function clearDragPreview() {
  if (dragPreview) { map.removeLayer(dragPreview); dragPreview = null; }
  locatingFeature = false;
}
document.getElementById('edit-locate').textContent = '↔ Déplacer le marqueur';
document.getElementById('edit-locate').onclick = () => {
  if (!selectedFeature) return;
  clearDragPreview();
  const lat = Number(editForm.elements.namedItem('lat').value);
  const lon = Number(editForm.elements.namedItem('lon').value);
  dragPreview = L.marker([lat, lon], {
    draggable: true, autoPan: true, zIndexOffset: 2000,
    icon: iconForFeature(selectedFeature)
  }).addTo(map);
  dragPreview.on('drag', e => {
    const v = e.target.getLatLng();
    editForm.elements.namedItem('lat').value = v.lat.toFixed(7);
    editForm.elements.namedItem('lon').value = v.lng.toFixed(7);
  });
  map.setView([lat, lon], Math.max(map.getZoom(), 16));
  setStatus('Glissez le marqueur sur la carte ; sa position est visible immédiatement. Cliquez sur Enregistrer pour valider.');
};
map.on('click', e => {
  if (!editorEnabled || !locatingFeature || !selectedFeature) return;
  editForm.elements.namedItem('lat').value = e.latlng.lat.toFixed(7);
  editForm.elements.namedItem('lon').value = e.latlng.lng.toFixed(7);
  locatingFeature=false;
  setStatus('Coordonnées mises à jour. Cliquez sur Enregistrer pour valider.');
});
// Une modification validée ici n'est PAS une publication du site public.
const savedModal = document.getElementById('edit-saved-modal');
const savedModalOk = document.getElementById('edit-saved-ok');
let savedModalPreviousFocus = null;
function showLocalSaveNotice() {
  savedModalPreviousFocus = document.activeElement;
  savedModal.hidden = false;
  savedModalOk.focus();
}
function closeLocalSaveNotice() {
  savedModal.hidden = true;
  if (savedModalPreviousFocus?.isConnected) savedModalPreviousFocus.focus();
}
savedModalOk.addEventListener('click', closeLocalSaveNotice);
savedModal.addEventListener('click', e => { if(e.target === savedModal) closeLocalSaveNotice(); });
savedModal.addEventListener('keydown', e => {
  if(e.key === 'Escape') { e.preventDefault(); closeLocalSaveNotice(); }
  if(e.key === 'Tab') { e.preventDefault(); savedModalOk.focus(); }
});
editForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!selectedFeature) return;
  if (!editForm.reportValidity()) return;
  const lat=Number(editForm.elements.namedItem('lat').value),lon=Number(editForm.elements.namedItem('lon').value);
  if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) {setStatus('Coordonnées non valides.');return;}
  snapshot();
  const p=selectedFeature.properties;
  for (const name of fieldsToEdit) p[name]=editForm.elements.namedItem(name).value.trim();
  p.icone=iconFor(p.categorie);
  const requestedSite=document.getElementById('edit-site').value;
  if(requestedSite) {
    const target=allSiteGroups().find(g=>g.id===requestedSite);
    if(target){p.site_id=target.id;p.site_nom=target.title;p.site_lat=target.position.lat;p.site_lon=target.position.lng;}
    else if(pendingGroup && pendingGroup.id===requestedSite){p.site_id=pendingGroup.id;p.site_nom=pendingGroup.name;p.site_lat=pendingGroup.position.lat;p.site_lon=pendingGroup.position.lng;}
  } else {
    // Une fiche détachée doit rester indépendante même si son nom/adresse correspondent à un groupe automatique.
    if (siteId(selectedFeature)) {p.site_id=nextSiteId();p.site_nom=p.name;p.site_lat=lat;p.site_lon=lon;}
    else {delete p.site_id;delete p.site_nom;delete p.site_lat;delete p.site_lon;}
  }
  selectedFeature.geometry.coordinates=[lon,lat];
  if (!features.includes(selectedFeature)) features.push(selectedFeature);
  clearDragPreview();refreshEditionData();editForm.hidden=true;selectedFeature=null;
  setStatus('Modifications enregistrées dans cette session. Exportez le GeoJSON pour les conserver.');
  showLocalSaveNotice();
});
document.getElementById('edit-delete').onclick = () => {
  if (!selectedFeature || !features.includes(selectedFeature)) return;
  if (!window.confirm('Supprimer ce producteur de la version de travail ?')) return;
  snapshot();features=features.filter(f=>f!==selectedFeature);
  clearDragPreview();selectedFeature=null;editForm.hidden=true;refreshEditionData();setStatus('Producteur supprimé de la session. Export nécessaire.');
};
document.getElementById('edit-undo').onclick=()=>{
  if(!undoStack.length){setStatus('Aucune modification à annuler.');return;}
  clearDragPreview();features=undoStack.pop();selectedFeature=null;editForm.hidden=true;refreshEditionData();setStatus('Dernière modification annulée.');
};
document.getElementById('edit-export').onclick=()=>{
  const exportData={...(originalGeoJson||{type:'FeatureCollection'}),type:'FeatureCollection',features:features.map(f=>{
    const clean=structuredClone(f);
    delete clean._duplicateIndex;delete clean._duplicateCount;
    return clean;
  })};
  const blob=new Blob([JSON.stringify(exportData,null,2)],{type:'application/geo+json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='producteurs_CCPG_modifies.geojson';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  setStatus('Fichier téléchargé. Remplacez data/producteurs.geojson sur GitHub après vérification.');
};


// V11 — Gestion de groupes durable, stockée sur chaque fiche du GeoJSON.
// Les groupes historiques sont affichés sans modifier les données tant qu'une action ne les convertit pas.
let currentGroupId='';
function nextSiteId() {
  let id;
  do { id='site_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7); }
  while(features.some(f=>siteId(f)===id));
  return id;
}
function groupKey(g) { return g.id || ('legacy:'+allSiteGroups().indexOf(g)); }
function refreshGroupControls() {
  const groups=allSiteGroups();
  const select=document.getElementById('group-select');
  const assign=document.getElementById('edit-site');
  const previous=select.value;
  select.replaceChildren(new Option('— Choisir un groupe —',''));
  assign.replaceChildren(new Option('Aucun rattachement explicite',''));
  groups.forEach((g,i)=>{
    // Les groupes automatiques peuvent être convertis par le panneau de gestion.
    select.add(new Option(`${g.title} (${g.members.length} fiche${g.members.length>1?'s':''})${g.id?'':' · auto'}`,g.id || 'legacy:'+i));
    if(g.id) assign.add(new Option(g.title,g.id));
  });
  if([...select.options].some(x=>x.value===previous))select.value=previous;
  else select.value='';
  currentGroupId=select.value;
  const g=resolveSelectedGroup();
  document.getElementById('group-details').hidden=!g;
  if(g){
    document.getElementById('group-name').value=g.title;
    document.getElementById('group-lat').value=g.position.lat.toFixed(7);
    document.getElementById('group-lon').value=g.position.lng.toFixed(7);
    document.getElementById('group-members').textContent=g.members.map(m=>m.f.properties.name+' — '+m.f.properties.categorie).join(' · ');
  }
}
function resolveSelectedGroup() {
  const val=document.getElementById('group-select').value;
  const gs=allSiteGroups();
  if(val.startsWith('legacy:'))return gs[Number(val.split(':')[1])]||null;
  return gs.find(g=>g.id===val)||null;
}
function updateGroup(g, name, position){
  const id=g.id||nextSiteId();
  for(const x of g.members){
    const p=x.f.properties;
    p.site_id=id;p.site_nom=name;p.site_lat=position.lat;p.site_lon=position.lng;
  }
  return id;
}
document.getElementById('group-select').addEventListener('change',()=>refreshGroupControls());
document.getElementById('group-new').onclick=()=>{
  const name=window.prompt('Nom du nouveau groupe / site :');
  if(!name || !name.trim())return;
  // Le GeoJSON n'enregistre que des fiches. Le groupe est créé dès qu'une fiche lui est associée.
  const id=nextSiteId();
  const pos=map.getCenter();
  const f={type:'Feature',geometry:{type:'Point',coordinates:[pos.lng,pos.lat]},properties:{name:name.trim(),categorie:categories[0].key,description:'',Adresse:'',tel:'',liens:'',icone:categories[0].icon,site_id:id,site_nom:name.trim(),site_lat:pos.lat,site_lon:pos.lng}};
  editFeature(f);
  // L'option temporaire permet d'enregistrer la toute première production d'un nouveau groupe.
  const assign=document.getElementById('edit-site');assign.add(new Option(name.trim(),id));assign.value=id;
  pendingGroup={id,name:name.trim(),position:pos};
  setStatus('Nouveau groupe « '+name.trim()+' » : créez sa première production et cliquez sur Enregistrer.');
};
let pendingGroup=null;
// Le formulaire d'édition conserve les groupes fraîchement créés avant leur premier enregistrement.
const baseEditSubmit=editForm;
baseEditSubmit.addEventListener('submit',()=>{ pendingGroup=null; });
document.getElementById('group-save').onclick=()=>{
  const g=resolveSelectedGroup();if(!g)return;
  const name=document.getElementById('group-name').value.trim();
  const lat=Number(document.getElementById('group-lat').value),lon=Number(document.getElementById('group-lon').value);
  if(!name||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){setStatus('Nom ou coordonnées du groupe invalides.');return;}
  snapshot();const id=updateGroup(g,name,L.latLng(lat,lon));
  refreshEditionData();document.getElementById('group-select').value=id;refreshGroupControls();
  setStatus('Groupe enregistré. Exportez le GeoJSON pour conserver les modifications.');
  showLocalSaveNotice();
};
document.getElementById('group-dissolve').onclick=()=>{
  const g=resolveSelectedGroup();if(!g)return;
  if(!confirm('Dissoudre « '+g.title+' » ? Les fiches seront conservées.'))return;
  snapshot();
  for(const x of g.members){
    const p=x.f.properties;delete p.site_id;delete p.site_nom;delete p.site_lat;delete p.site_lon;
  }
  // Empêche la reconstitution automatique du groupe historique via un identifiant explicite unique par fiche.
  for(const x of g.members){ const p=x.f.properties; p.site_id=nextSiteId();p.site_nom=p.name; p.site_lat=x.f.geometry.coordinates[1];p.site_lon=x.f.geometry.coordinates[0]; }
  refreshEditionData();setStatus('Groupe dissous : chaque fiche forme désormais son propre site. Exportez le GeoJSON.');
};
