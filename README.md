# MeinBrowser (Tauri)

## Einmalig einrichten (Windows)
1. Rust installieren: https://rustup.rs (mit den "C++ Build Tools" von Visual Studio, falls gefragt)
2. WebView2 ist unter Windows 10/11 schon vorhanden.
3. Im Projektordner:
   ```
   npm install
   npx tauri icon app-icon.png
   npm run dev
   ```
   `tauri icon` erzeugt die Icons in `src-tauri/icons`. Ohne diesen Schritt startet der Build nicht.

## Fertige .exe bauen
```
npm run build
```
Ergebnis liegt in `src-tauri/target/release/` (Installer unter `bundle/`).

## Aufbau
- `src/index.html`, `src/app.js`: Oberfläche (Tabs, Adressleiste, Seitenleiste)
- `src/start.html`: Startseite
- `src-tauri/src/main.rs`: Fenster und Tabs. Jeder Tab ist ein eigener Webview.
- `src-tauri/capabilities/default.json`: nur die Oberfläche darf Tauri-Befehle nutzen, nie die Webseiten

## Noch nicht übernommen
- Werbeblocker
- eigene Berechtigungsabfrage (Mikrofon/Kamera fragt jetzt WebView2 selbst)
- eigenes Fenster zur Bildschirmauswahl (nutzt jetzt die von WebView2)
- Tastenkürzel (Strg+T usw.) funktionieren nur, wenn die Leiste oben den Fokus hat, nicht mitten in einer Webseite
- Adresse ändert sich bei Seiten ohne Neuladen (z. B. YouTube) nicht live
