const categories=[
{key:'Vin Bio',icon:'vin_bio',name:'Vin bio'},{key:'Vin',icon:'vin',name:'Vin'},
{key:"Huiles d'olives",icon:'huile_olive',name:"Huile d’olive"},{key:'Marché local',icon:'marche_local',name:'Marché local'},
{key:'Légumes et fruits',icon:'fruits_legumes',name:'Fruits et légumes'},{key:'Boucheries',icon:'boucheries',name:'Boucheries'},
{key:'Oeufs',icon:'oeufs',name:'Œufs'},{key:'Fromagerie',icon:'fromagerie',name:'Fromagerie'},
{key:'Conserves',icon:'conserves',name:'Conserves'},{key:'Miel',icon:'miel',name:'Miel'}];
const map=L.map('map',{zoomControl:false,scrollWheelZoom:true,preferCanvas:true}).setView([43.90,4.58],12);
L.control.zoom({position:'topleft'}).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
 attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',subdomains:'abcd',maxZoom:19}).addTo(map);
const layer=L.markerClusterGroup({showCoverageOnHover:false,spiderfyOnMaxZoom:true,zoomToBoundsOnClick:true,maxClusterRadius:52,disableClusteringAtZoom:17,
 iconCreateFunction(c){let n=c.getChildCount(),size=n<10?40:n<30?48:56;return L.divIcon({html:`<div class="cluster-inner">${n}</div>`,className:'cluster '+(n<10?'cluster-small':n<30?'cluster-medium':'cluster-large'),iconSize:[size,size]});}});
map.addLayer(layer);
let features=[],active=new Set(categories.map(c=>c.key)),boundsAll=null;const markers=[];
const iconFor=(key)=>categories.find(c=>c.key===key)?.icon||'fruits_legumes';
const imagePath=(slug)=>'assets/icons/'+slug+'.png';
function iconSize(){let z=map.getZoom();return z<=11?26:z<=13?32:z<=15?40:z<=17?47:54;}
function iconForFeature(f){let size=iconSize();return L.divIcon({className:'marker-pin',html:`<img src="${imagePath(f.properties.icone||iconFor(f.properties.categorie))}" alt="">`,iconSize:[size,size],iconAnchor:[size/2,size*.94],popupAnchor:[0,-size*.7]});}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function validUrl(v){let s=String(v||'').trim();if(!s||/^(pas de|aucun|non)/i.test(s))return null;if(!/^https?:\/\//i.test(s))s='https://'+s;try{let u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
function popup(f){let p=f.properties;let cat=categories.find(c=>c.key===p.categorie);let site=validUrl(p.liens);let desc=esc(p.description).replace(/\n/g,'<br>');return `<div class="popup-head"><img src="${imagePath(p.icone||iconFor(p.categorie))}" alt=""><div><h3>${esc(p.name||'Producteur local')}</h3><small>${esc(cat?.name||p.categorie||'Production locale')}</small></div></div><div class="popup-section">${p.Adresse?`<p>📍 ${esc(p.Adresse)}</p>`:''}${p.tel?`<p>☎ ${esc(p.tel)}</p>`:''}${desc?`<p>${desc}</p>`:''}${site?`<p><a href="${esc(site)}" target="_blank" rel="noopener noreferrer">Visiter le site ↗</a></p>`:''}</div>`}
function initFilters(){let wrap=document.getElementById('filters');wrap.innerHTML='';const counts=Object.fromEntries(categories.map(c=>[c.key,features.filter(f=>f.properties.categorie===c.key).length]));for(let c of categories){let b=document.createElement('button');b.type='button';b.className='filter on';b.dataset.category=c.key;b.setAttribute('aria-pressed','true');b.innerHTML=`<img src="${imagePath(c.icon)}" alt=""><span>${esc(c.name)}</span><small>${counts[c.key]||0}</small>`;b.onclick=()=>{if(active.has(c.key))active.delete(c.key);else active.add(c.key);syncFilters();refresh()};wrap.append(b)}}
function syncFilters(){for(let b of document.querySelectorAll('.filter')){let on=active.has(b.dataset.category);b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}}
function refresh(){let q=document.getElementById('search').value.trim().toLocaleLowerCase('fr');layer.clearLayers();let selected=markers.filter(({f})=>active.has(f.properties.categorie)&&[f.properties.name,f.properties.Adresse,f.properties.description,f.properties.categorie].some(v=>String(v||'').toLocaleLowerCase('fr').includes(q)));selected.forEach(x=>layer.addLayer(x.marker));document.getElementById('counter').textContent=selected.length+' site'+(selected.length>1?'s':'')+' affiché'+(selected.length>1?'s':'')+' sur '+features.length;if(q&&selected.length===1){map.setView(selected[0].marker.getLatLng(),15);selected[0].marker.openPopup()}}
function reframe(){let group=layer.getBounds();if(group.isValid())map.fitBounds(group.pad(.15),{maxZoom:13});else if(boundsAll)map.fitBounds(boundsAll.pad(.12),{maxZoom:13})}
async function load(){try{let response=await fetch('data/producteurs.geojson');if(!response.ok)throw new Error('HTTP '+response.status);let data=await response.json();features=data.features.filter(f=>f?.geometry?.type==='Point'&&Array.isArray(f.geometry.coordinates));for(let f of features){let [lon,lat]=f.geometry.coordinates;let marker=L.marker([lat,lon],{icon:iconForFeature(f),title:f.properties.name||'Site'}).bindPopup(()=>popup(f));markers.push({f,marker})}boundsAll=L.latLngBounds(markers.map(x=>x.marker.getLatLng()));initFilters();refresh();reframe()}catch(e){document.getElementById('counter').textContent='Impossible de charger les données : '+e.message;document.getElementById('counter').classList.add('error');console.error(e)}}
map.on('zoomend',()=>{for(let x of markers)x.marker.setIcon(iconForFeature(x.f))});
document.getElementById('search').addEventListener('input',refresh);
document.getElementById('reset').onclick=()=>{active=new Set(categories.map(c=>c.key));document.getElementById('search').value='';syncFilters();refresh();reframe()};
document.getElementById('reframe').onclick=reframe;
document.getElementById('mobile-toggle').onclick=()=>{let p=document.getElementById('sidebar'),open=p.classList.toggle('open');document.getElementById('mobile-toggle').setAttribute('aria-expanded',String(open));document.getElementById('mobile-toggle').textContent=open?'✕   Fermer les filtres':'☰   Catégories & recherche';setTimeout(()=>map.invalidateSize(),270)};
load();