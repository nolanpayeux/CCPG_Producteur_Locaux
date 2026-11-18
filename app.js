const categories = [
  { key: 'Vin Bio', icon: 'vin_bio', name: 'Vin bio' },
  { key: 'Vin', icon: 'vin', name: 'Vin' },
  { key: "Huiles d'olives", icon: 'huile_olive', name: "Huile d’olive" },
  { key: 'Marché local', icon: 'marche_local', name: 'Marché local' },
  { key: 'Légumes et fruits', icon: 'fruits_legumes', name: 'Fruits et légumes' },
  { key: 'Boucheries', icon: 'boucheries', name: 'Élevage' },
  { key: 'Oeufs', icon: 'oeufs', name: 'Œufs' },
  { key: 'Fromagerie', icon: 'fromagerie', name: 'Fromagerie' },
  { key: 'Conserves', icon: 'conserves', name: 'Conserves' },
  { key: 'Miel', icon: 'miel', name: 'Miel' }
];

const map = L.map('map', { zoomControl: false, scrollWheelZoom: true, preferCanvas: true }).setView([43.90, 4.58], 12);
L.control.zoom({ position: 'topleft' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);

map.createPane('territoryMaskPane');
map.getPane('territoryMaskPane').style.zIndex = 240;
map.createPane('territoryCommunePane');
map.getPane('territoryCommunePane').style.zIndex = 250;
map.createPane('territoryBoundaryPane');
map.getPane('territoryBoundaryPane').style.zIndex = 260;
map.createPane('communeSelectionPane');
map.getPane('communeSelectionPane').style.zIndex = 275;
map.getPane('communeSelectionPane').style.pointerEvents = 'none';

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
let communeGeoFeatures = [];
let selectedCommuneCode = '';
let communeHighlightLayer = null;
// Couches vectorielles : seules les voies principales et le Rhône / Gardon.
map.createPane('roadsOverlayPane');
map.getPane('roadsOverlayPane').style.zIndex = 355;
map.getPane('roadsOverlayPane').style.pointerEvents = 'none';
map.createPane('riversOverlayPane');
map.getPane('riversOverlayPane').style.zIndex = 365;
map.getPane('riversOverlayPane').style.pointerEvents = 'none';
const roadLayer = L.layerGroup();
const riverLayer = L.layerGroup();
let roadsOn = false;
let waterwaysOn = false;

// Pont du Gard : repère patrimonial discret, sans étiquette permanente.
const pontDuGard = L.marker([43.9472222, 4.5352778], {
  icon: L.divIcon({
    className: 'pont-du-gard-marker',
    html: '<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:#fff;border:2px solid #9c2f27;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.18);font-size:16px;">🏛️</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17]
  }),
  title: 'Pont du Gard',
  zIndexOffset: 1200
}).bindPopup(
  '<strong>Pont du Gard</strong><br>' +
  'Monument inscrit au patrimoine mondial de l’UNESCO.<br>' +
  '<a href="https://pontdugard.fr/fr" target="_blank" rel="noopener noreferrer">Découvrir le site officiel</a>'
).addTo(map);

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

// Redessiner les liaisons après un changement de fond cartographique.
// Ne pas déclencher refresh() dans setBasemap() : celle-ci est appelée
// une première fois avant l'initialisation de toutes les couches.
document.getElementById('btn-basemap-light').onclick = () => {
  setBasemap('light');
  refresh();
};
document.getElementById('btn-basemap-ortho').onclick = () => {
  setBasemap('ortho');
  refresh();
};

const layer = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: true,
  // Garder les domaines proches regroupés plus longtemps sur ordinateur.
  // Les regroupements représentent des SITES, jamais des fiches de production.
  maxClusterRadius: zoom => zoom >= 15 ? 48 : zoom >= 13 ? 58 : 52,
  disableClusteringAtZoom: 16,
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
  return z <= 11 ? 34 : z <= 13 ? 42 : z <= 15 ? 50 : z <= 17 ? 58 : 66;
}

// Taille des marqueurs de regroupement inchangée.
function groupIconSize() {
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
// Les photos sont des propriétés GeoJSON séparées du texte descriptif.
// Convertit les anciens ajouts uMap/base64 en une photo distincte.
const LEGACY_PHOTO_PATTERN = /\{\{\s*(data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^}\n|\s]+)(?:\|[^}]*)?\s*\}\}|!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi;
function safePhotoSource(value) {
  const src = String(value || '').trim();
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src)) return src;
  if (/^https?:\/\/[^\s<>"']+$/i.test(src)) return src;
  return '';
}
function removeLegacyImageCode(value) {
  return String(value ?? '')
    .replace(LEGACY_PHOTO_PATTERN, ' ')
    // Ne jamais afficher les énormes chaînes base64 brutes, même mal encadrées.
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
    .replace(/\{\{[^}]*data:image[^}]*\}\}/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function normalizePhotoFields(p) {
  if (!p) return;
  for (const [descriptionKey, photoKey] of [['description','photo'], ['site_description','site_photo']]) {
    const raw = String(p[descriptionKey] ?? '');
    if (!safePhotoSource(p[photoKey])) {
      const match = raw.match(LEGACY_PHOTO_PATTERN);
      if (match) {
        const first = match[0].match(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^}\n|\s)]+/i);
        if (first) p[photoKey] = safePhotoSource(first[0].replace(/\s+/g, ''));
      }
    }
    if (raw) p[descriptionKey] = removeLegacyImageCode(raw);
  }
}
function renderDescription(raw) {
  return esc(removeLegacyImageCode(raw)).replace(/\n/g, '<br>');
}
function readableDescription(raw) {
  return removeLegacyImageCode(raw);
}
function photoHtml(src, alt) {
  const safe = safePhotoSource(src);
  if (!safe) return '';
  return `<div class="popup-photo" style="margin:10px 0"><img src="${esc(safe)}" alt="${esc(alt)}" loading="lazy" style="display:block;width:100%;max-height:280px;object-fit:contain;border-radius:8px"></div>`;
}
// La photo sélectionnée n'est jamais insérée dans le champ Description.
async function resizePhoto(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Sélectionnez une photo JPG, PNG, WebP ou GIF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Photo trop volumineuse (maximum 10 Mo).');
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de traiter cette image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    bitmap.close?.();
  }
}
function createPhotoEditor(afterElement, caption) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:8px 0 14px';
  const title = document.createElement('label');
  title.textContent = caption;
  title.style.cssText = 'display:block;font-size:13px;font-weight:600;margin-bottom:5px';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.style.cssText = 'display:block;max-width:100%;font-size:13px';
  const preview = document.createElement('img');
  preview.alt = 'Aperçu de la photo';
  preview.style.cssText = 'display:none;max-width:230px;max-height:150px;object-fit:contain;margin:8px 0;border-radius:7px';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Retirer la photo';
  remove.style.cssText = 'display:none;margin:5px 0 0';
  let photo = '';
  function setPhoto(value) {
    photo = safePhotoSource(value);
    preview.style.display = photo ? 'block' : 'none';
    remove.style.display = photo ? 'inline-block' : 'none';
    preview.src = photo || '';
    input.value = '';
  }
  input.addEventListener('change', async () => {
    try {
      const next = await resizePhoto(input.files?.[0]);
      if (next) setPhoto(next);
    } catch (err) {
      console.error(err);
      window.alert(err.message || 'Image illisible. Essayez en JPG ou PNG.');
      input.value = '';
    }
  });
  remove.addEventListener('click', () => setPhoto(''));
  wrap.append(title, input, preview, remove);
  afterElement.insertAdjacentElement('afterend', wrap);
  return { setPhoto, getPhoto: () => photo };
}

function popup(f) {
  const p = f.properties;
  const cat = categories.find(c => c.key === p.categorie);
  const contacts = contactLinks(p.liens ?? p.site_internet ?? p.website ?? p.url);
  const desc = renderDescription(p.description);
  const image = photoHtml(p.photo, 'Photographie du producteur');
  return `<div class="popup-head"><img src="${imagePath(p.icone || iconFor(p.categorie))}" alt=""><div><h3>${esc(p.name || 'Producteur local')}</h3><small>${esc(cat?.name || p.categorie || 'Production locale')}</small></div></div><div class="popup-section">${p.Adresse ? `<p>📍 ${esc(p.Adresse)}</p>` : ''}${p.tel ? `<p>☎ ${esc(p.tel)}</p>` : ''}${image}${desc ? `<p>${desc}</p>` : ''}${contacts}</div>`;
}
function initFilters() {
  const wrap = document.getElementById('filters');
  wrap.innerHTML = '';
  // Le volet Productions dépend uniquement de la commune : il reste indépendant
  // des catégories activées et du texte recherché, pour éviter des disparitions
  // de boutons lorsque l'utilisateur affine sa recherche.
  const commune = selectedCommuneCode
    ? communeGeoFeatures.find(f => String(f.properties.code) === selectedCommuneCode)
    : null;
  const counts = Object.fromEntries(categories.map(c => [c.key, 0]));
  for (const f of features) {
    const key = f.properties.categorie;
    if (!(key in counts)) continue;
    if (selectedCommuneCode) {
      if (!commune || !window.turf) continue;
      const coords = f.geometry?.coordinates;
      if (!Array.isArray(coords)) continue;
      try {
        if (!turf.booleanPointInPolygon(turf.point(coords), commune)) continue;
      } catch (_) { continue; }
    }
    counts[key]++;
  }
  for (const c of categories) {
    if (selectedCommuneCode && !counts[c.key]) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter' + (active.has(c.key) ? ' on' : '');
    b.dataset.category = c.key;
    b.setAttribute('aria-pressed', String(active.has(c.key)));
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

function searchMatchesFeature(f, q) {
  return [f.properties.name, f.properties.Adresse, readableDescription(f.properties.description), f.properties.categorie]
    .some(v => String(v || '').toLocaleLowerCase('fr').includes(q));
}
function getFilteredEntries() {
  const q = document.getElementById('search').value.trim().toLocaleLowerCase('fr');
  const selectedCommune = selectedCommuneCode ? communeGeoFeatures.find(f => String(f.properties.code) === selectedCommuneCode) : null;
  return markers.filter(({ f, originalLatLng }) => {
    if (!active.has(f.properties.categorie) || !searchMatchesFeature(f, q)) return false;
    if (selectedCommuneCode && !selectedCommune) return false;
    if (!selectedCommune) return true;
    try { return turf.booleanPointInPolygon(turf.point([originalLatLng.lng, originalLatLng.lat]), selectedCommune); }
    catch (e) { console.warn('Filtre géographique indisponible', e); return false; }
  });
}
function getLegendData(entries, bounds = null) {
  const visible = bounds ? entries.filter(entry => bounds.contains(entry.originalLatLng)) : entries;
  const counts = new Map();
  for (const entry of visible) {
    const key = entry.f.properties.categorie;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return categories
    .map(category => ({
      category,
      count: counts.get(category.key) || 0
    }))
    .filter(item => item.count > 0);
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
    group.description = group.members.map(x => String(x.f.properties.site_description || '').trim()).find(Boolean) || '';
    group.photo = group.members.map(x => safePhotoSource(x.f.properties.site_photo)).find(Boolean) || '';
    group.categories = [...new Set(group.members.map(x => x.f.properties.categorie))];
    group.title = (group.id ? group.members.find(x=>x.f.properties.site_nom)?.f.properties.site_nom : '') || group.members.find(x=>normalizeSiteText(x.f.properties.name)===group.name)?.f.properties.name || medoid.f.properties.name || 'Producteur local';
  }
  return groups;
}
function siteIcon(group) {
  if (group.categories.length === 1) return iconForFeature(group.members[0].f);
  const size = groupIconSize();
  return L.divIcon({
    className: 'site-multi-marker',
    html: `<span class="site-multi-dot">${group.categories.length}</span>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor:[0,-size/2]
  });
}
function sitePopup(group) {
  const categoriesHtml = group.categories.map(c => {
    const category = categories.find(x => x.key === c);
    return `<span class="site-category"><img src="${imagePath(iconFor(c))}" alt="">${esc(category?.name || c)}</span>`;
  }).join('');

  const address = group.members.find(x => x.f.properties.Adresse)?.f.properties.Adresse;
  const siteDescription = renderDescription(group.description);
  const siteImage = photoHtml(group.photo, 'Photographie du domaine');

  // Les coordonnées sont portées par les fiches des productions, pas par le groupe.
  // On les regroupe ici pour les rendre visibles dans la fiche du domaine.
  const phones = [...new Set(group.members
    .map(x => String(x.f.properties.tel || '').trim())
    .filter(Boolean))];
  const contacts = [...new Set(group.members
    .map(x => {
      const p = x.f.properties;
      return String(p.liens ?? p.site_internet ?? p.website ?? p.url ?? '').trim();
    })
    .filter(Boolean)
    .flatMap(value => value.split(/[\n;,]+/).map(v => v.trim()).filter(Boolean)))];
  const linksHtml = contacts.map(contactLinks).filter(Boolean).join('');
  const phonesHtml = phones.map(phone => `<p>☎ ${esc(phone)}</p>`).join('');
  const contactSection = phonesHtml || linksHtml
    ? `<div class="popup-section"><p><strong>Site internet et contact</strong></p>${phonesHtml}${linksHtml}</div>`
    : '';

  return `<div class="site-popup"><h3>${esc(group.title)}</h3>${address ? `<p>📍 ${esc(address)}</p>` : ''}${siteImage}${siteDescription ? `<p>${siteDescription}</p>` : ''}<p><strong>${group.categories.length} production${group.categories.length > 1 ? 's' : ''}</strong></p><div class="site-categories">${categoriesHtml}</div>${contactSection}</div>`;
}

// Zoom sur le site réel, jamais sur la position artificiellement décalée des pictogrammes.
// On inclut les positions sources pour ne pas perdre les productions éloignées.
function focusSite(group, popupContent) {
  if (editorEnabled) return;

  const positions = [group.position, ...group.members.map(x => x.originalLatLng)];
  const targetBounds = L.latLngBounds(positions);
  const maxZoom = group.members.length > 1 ? 16 : 17;

  // Cette fiche est liee a la carte, PAS au marqueur : refresh() peut ainsi
  // reconstruire les pictogrammes apres le zoom sans fermer la fiche.
  L.popup({ autoPan: false, maxWidth: 320, closeButton: true })
    .setLatLng(group.position)
    .setContent(popupContent || sitePopup(group))
    .openOn(map);

  map.flyToBounds(targetBounds, {
    padding: [70, 70],
    maxZoom,
    duration: 1.2
  });
}

function siteMarker(group) {
  const marker = L.marker(group.position, {
    icon:siteIcon(group),title:group.title,autoPan:false
  });
  marker.on('click', () => focusSite(group));
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
    const radius = Math.max(size * 1.22, (size+11)/(2*Math.sin(Math.PI/n)));
    const marker = L.circleMarker(group.position, {
      radius:5, color:'#a93b30', weight:2, fillColor:'#ffffff',fillOpacity:1,interactive:true,
      title:group.title
    });
    if (!forEdition) marker.on('click', () => focusSite(group));
    siteFanMarkers.addLayer(marker);
    // L'icône principale représente l'identité du site, pas une activité supplémentaire.
    const centerBadge=L.marker(group.position,{
      icon:L.divIcon({className:'site-anchor',html:`<span>${n}</span>`,iconSize:[25,25],iconAnchor:[12.5,12.5]}),
      autoPan:false,title:group.title
    });
    if (!forEdition) centerBadge.on('click', () => focusSite(group));
    siteFanMarkers.addLayer(centerBadge);
    itemsToRender.forEach(({category,items}, i) => {
      const angle = -Math.PI/2 + (2*Math.PI*i/n);
      const target = map.layerPointToLatLng(L.point(center.x + radius*Math.cos(angle), center.y + radius*Math.sin(angle)));
      // Garder les fiches distinctes même si plusieurs lignes sources ont la même catégorie.
      const feature = items[0].f;
      const marker=L.marker(target, {icon:iconForFeature(feature),title:`${group.title} — ${category}`,autoPan:false});
      if(forEdition){
        marker.off('click');
        marker.on('click',()=>editFeature(feature));
      } else {
        marker.on('click', () => focusSite(group, items.map(x => popup(x.f)).join('<hr class="site-separator">')));
      }
      siteFanMarkers.addLayer(marker);
      // Trait de rattachement à la position réelle du domaine.
      // Sur orthophoto : liseré sombre et trait corail CCPG (#E67560).
      // Sur plan épuré : trait fin et discret en pointillés.
      L.polyline([group.position, target], {
        pane: 'pointConnections',
        interactive: false,
        color: currentBasemap === 'ortho' ? '#432722' : '#9b8780',
        weight: currentBasemap === 'ortho' ? 5 : 1.4,
        opacity: currentBasemap === 'ortho' ? 0.82 : 0.45,
        dashArray: currentBasemap === 'ortho' ? null : '3 5'
      }).addTo(siteConnections);
      if (currentBasemap === 'ortho') {
        L.polyline([group.position, target], {
          pane: 'pointConnections',
          interactive: false,
          color: '#E67560',
          weight: 2.8,
          opacity: 0.95
        }).addTo(siteConnections);
      }
    });
  }
}
function refresh() {
  layer.clearLayers(); individualMarkers.clearLayers(); connectionLines.clearLayers();
  siteFanMarkers.clearLayers(); siteConnections.clearLayers();
  [layer,individualMarkers,connectionLines,siteFanMarkers,siteConnections].forEach(x=>map.removeLayer(x));
  const selected = getFilteredEntries();
  selected.forEach(x => x.marker.setLatLng(x.originalLatLng));
  const groups = getSiteGroups(selected);
  if (editorEnabled) {
    // Les clusters classiques cachaient les fiches et empêchaient leur sélection.
    // Zoom faible : chaque site est cliquable et amène aux fiches individuelles.
    // Zoom détaillé : chaque OBJET source a son propre pictogramme dans l'éventail.
    if(map.getZoom()<13){
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
    refreshPrintDecorations();
    return;
  }
  // Mobile : comportement historique inchangé (éventails dès le zoom 13).
  // Ordinateur : clustering prolongé jusqu'au zoom 15 inclus.
  const desktopClustering = window.matchMedia('(min-width: 761px)').matches;
  const detailedZoom = desktopClustering ? 16 : 13;
  if(map.getZoom() < detailedZoom) {
    map.addLayer(layer);
    groups.forEach(g=>layer.addLayer(siteMarker(g)));
  } else {
    map.addLayer(siteConnections);
    map.addLayer(siteFanMarkers);
    drawSiteFan(groups);
  }
  document.getElementById('counter').textContent = `${groups.length} site${groups.length>1?'s':''} • ${selected.length} production${selected.length>1?'s':''} affichée${selected.length>1?'s':''} sur ${features.length}`;
  refreshPrintDecorations();
}

// Revenir systématiquement à l'ensemble du territoire CCPG,
// indépendamment du zoom et des producteurs actuellement filtrés.
function reframe() {
  const b = territoryBounds || boundsAll;
  if (b && b.isValid()) {
    map.flyToBounds(b.pad(territoryBounds ? 0.03 : 0.12), {
      maxZoom: 12,
      duration: 1.2
    });
  }
}

// Bouton permanent sur la carte, sous les commandes + et -.
const homeControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    const button = L.DomUtil.create('a', '', container);
    button.href = '#';
    button.title = 'Vue générale du territoire CCPG';
    button.setAttribute('aria-label', 'Vue générale du territoire CCPG');
    button.setAttribute('role', 'button');
    button.textContent = '⌂';
    button.style.cssText = 'width:30px;height:30px;line-height:30px;text-align:center;font-size:24px;font-weight:bold;background:#fff;color:#333;text-decoration:none;display:block;';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    L.DomEvent.on(button, 'click', L.DomEvent.stop);
    L.DomEvent.on(button, 'click', reframe);
    return container;
  }
});
map.addControl(new homeControl());

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
    // Priorité aux contours stockés dans le dépôt : pas de dépendance réseau au chargement.
    // Sans ces deux fichiers, repli sur geo.api.gouv.fr pour compatibilité avec les anciennes versions.
    let epciGeo, communesGeo;
    try {
      const [localEpci, localCommunes] = await Promise.all([
        fetchJson('data/perimetre_ccpg.geojson'),
        fetchJson('data/communes_ccpg.geojson')
      ]);
      epciGeo = asFeatureCollection(localEpci);
      communesGeo = asFeatureCollection(localCommunes);
      if (!epciGeo.features.length || !communesGeo.features.length ||
          !communesGeo.features.every(f => f.properties?.code && f.geometry)) {
        throw new Error('Contours communaux locaux incomplets.');
      }
    } catch (_) {
      const epcis = await fetchJson('https://geo.api.gouv.fr/epcis?nom=Pont%20du%20Gard&fields=nom,code');
      const epci = Array.isArray(epcis) ? (epcis.find(x => /pont du gard/i.test(x.nom || '')) || epcis[0]) : null;
      if (!epci?.code) throw new Error('CCPG introuvable dans geo.api.gouv.fr');
      epciGeo = asFeatureCollection(await fetchJson(`https://geo.api.gouv.fr/epcis/${epci.code}?format=geojson&geometry=contour&fields=nom,code`));
      communesGeo = asFeatureCollection(await fetchJson(`https://geo.api.gouv.fr/communes?codeEpci=${epci.code}&format=geojson&geometry=contour&fields=nom,code,codesPostaux,population`));
    }
    const epciFeature = epciGeo.features[0];
    communeGeoFeatures = communesGeo.features.filter(f => f?.geometry && f?.properties?.code);
    const select = document.getElementById('commune-select');
    const previous = select.value;
    select.replaceChildren(new Option('Toutes les communes de la CCPG', ''));
    communeGeoFeatures.slice().sort((a,b) => (a.properties.nom || '').localeCompare(b.properties.nom || '', 'fr'))
      .forEach(f => select.add(new Option(f.properties.nom, String(f.properties.code))));
    selectedCommuneCode = communeGeoFeatures.some(f => String(f.properties.code) === previous) ? previous : '';
    select.value = selectedCommuneCode;
    initFilters();
    syncFilters();

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
    status.textContent = `${communesGeo.features.length} communes CCPG chargées`;
    refresh();
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
    features.forEach(f => normalizePhotoFields(f.properties));
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

// Recalculer l'affichage quand une fenêtre passe du mode ordinateur au mobile.
const desktopBreakpoint = window.matchMedia('(min-width: 761px)');
desktopBreakpoint.addEventListener('change', refresh);

document.getElementById('search').addEventListener('input', refresh);
document.getElementById('reset').onclick = () => {
  active = new Set(categories.map(c => c.key));
  document.getElementById('search').value = '';
  syncFilters();
  refresh();
  reframe();
};
document.getElementById('reframe').onclick = reframe;
function selectCommune(code) {
  selectedCommuneCode = code;
  if (communeHighlightLayer) { map.removeLayer(communeHighlightLayer); communeHighlightLayer = null; }
  const feature = communeGeoFeatures.find(f => String(f.properties.code) === code);
  if (feature) {
    // La commune demandée reste lisible ; seules les autres communes sont estompées.
    const others = communeGeoFeatures.filter(f => String(f.properties.code) !== code);
    communeHighlightLayer = L.layerGroup([
      L.geoJSON({type:'FeatureCollection',features:others}, {pane:'communeSelectionPane',interactive:false,style:{
        color:'#938984',weight:0.6,opacity:0.4,fillColor:'#d1ccc8',fillOpacity:0.48
      }}),
      L.geoJSON(feature, {pane:'communeSelectionPane',interactive:false,style:{
        color:'#a92e28',weight:3.2,fillColor:'#ffffff',fillOpacity:0,className:'territory-selected'
      }})
    ]).addTo(map);
    map.fitBounds(L.geoJSON(feature).getBounds().pad(0.08), { maxZoom:14 });
  } else if (!code) reframe();
  initFilters();
  syncFilters();
  refresh();
}
document.getElementById('commune-select').addEventListener('change', e => selectCommune(e.target.value));
// Couche statique : deux GeoJSON déployés dans data/ avec le site.
// Aucune requête à Overpass lors de la navigation ou du changement de zoom.
let staticRoads = null;
let staticRivers = null;
let roadsPromise = null;
let riversPromise = null;
function drawStaticLine(points, options, target) {
  if (points.length >= 2) L.polyline(points, { ...options, interactive:false }).addTo(target);
}
function forEachLine(feature, callback) {
  const g=feature?.geometry;
  if (!g) return;
  const lines=g.type==='LineString' ? [g.coordinates] : g.type==='MultiLineString' ? g.coordinates : [];
  for(const line of lines) {
    if(line.length>1)callback(line.map(([lon,lat])=>[lat,lon]));
  }
}
async function fetchStaticLayer(filename) {
  const response = await fetch(`data/${filename}`);
  if (!response.ok) throw new Error(`${filename} : HTTP ${response.status}`);
  const data=await response.json();
  if(data.type!=='FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${filename} : GeoJSON invalide`);
  return data.features;
}
function drawStoredRoads(features) {
  roadLayer.clearLayers();
  for (const feature of features) {
    const roadClass = String(feature.properties?.highway || '');
    const motorway = roadClass.startsWith('motorway');
    const main = motorway || roadClass.startsWith('trunk') || roadClass.startsWith('primary');
    const secondary = roadClass.startsWith('secondary');
    const weight = motorway ? 4.1 : main ? 3.3 : secondary ? 2.5 : 1.8;
    const color = motorway ? '#c67b4d' : main ? '#d79a6b' : secondary ? '#c6a38a' : '#b9a9a0';
    forEachLine(feature, latlngs => {
      // Une seule ligne par tronçon : pas de liseré blanc répété à chaque jonction.
      drawStaticLine(latlngs, {pane:'roadsOverlayPane',color,opacity:.82,weight,
        lineCap:'round',lineJoin:'round',smoothFactor:1.25},roadLayer);
    });
  }
}
function drawStoredRivers(features) {
  riverLayer.clearLayers();
  for (const feature of features) {
    forEachLine(feature, latlngs => {
      // Trait plus discret pour préserver les détails de la carte et les marqueurs.
      drawStaticLine(latlngs, {pane:'riversOverlayPane',color:'#effaff',opacity:.88,weight:8},riverLayer);
      drawStaticLine(latlngs, {pane:'riversOverlayPane',color:'#55b5c9',opacity:.84,weight:4.5},riverLayer);
    });
  }
}
async function toggleStaticRoads() {
  const status=document.getElementById('road-status');
  if(!roadsOn){map.removeLayer(roadLayer);status.textContent='';return;}
  roadLayer.addTo(map);
  if(staticRoads){status.textContent='Grands axes routiers affichés.';return;}
  status.textContent='Chargement local des routes…';
  try{
    roadsPromise ||= fetchStaticLayer('routes_principales.geojson');
    staticRoads=await roadsPromise;
    drawStoredRoads(staticRoads);
    if(roadsOn)status.textContent='Grands axes routiers affichés.';
  }catch(e){roadsPromise=null;status.textContent='Fichier routes_principales.geojson absent ou invalide.';console.warn(e);}
}
