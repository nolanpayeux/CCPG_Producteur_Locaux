# Carte interactive CCPG – Leaflet

Version statique : 97 points, 10 catégories, clustering, filtres, recherche, tailles adaptatives et fiches.

## Test local

Dans le dossier du projet : `python -m http.server 8000`, puis ouvrir `http://localhost:8000`.
Ne pas ouvrir directement index.html en file:// : le navigateur peut bloquer le chargement du GeoJSON.

## Publication Cloudflare Pages

Téléverser le contenu du dossier ou le ZIP sur Cloudflare Pages > Workers & Pages > Créer > Pages > Importer des ressources / Direct Upload.
Le déploiement nécessite un accès Internet : bibliothèques Leaflet/MarkerCluster servies par CDN et tuiles Carto/OSM.

## Mise à jour

Remplacer `data/producteurs.geojson` (GeoJSON FeatureCollection de points) en conservant le champ `categorie` et `icone`. Les catégories et icônes se paramètrent dans `app.js`.

Attention : il s'agit d'un prototype à tester et à faire valider avant diffusion institutionnelle. Vérifier droits et mise à jour des données ainsi que la conformité RGPD et l'attribution cartographique.
