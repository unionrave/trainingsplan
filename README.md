# Trainingsplan

Interaktiver Trainingsplan fürs Fitnessstudio als kleine Web-App, gedacht für Docker Compose auf Unraid.
Mehrere Personen mit eigenem Plan und Verlauf, keine externen Abhängigkeiten (Node.js, JSON-Dateien als Speicher).

## Funktionen
- **Training:** Trainingstag wählen, Sätze abhaken, Gewicht und Wiederholungen eintragen, Einheit abschließen
- **Plan:** Tage und Übungen anlegen, umbenennen, sortieren, löschen
- **Verlauf:** Gewichtsdiagramm pro Übung und Liste aller Einheiten
- **Mehrere Personen:** Eigenes Profil pro Person, Export als JSON

## Installation auf Unraid
1. Ordner `/mnt/user/appdata/trainingsplan/app/` anlegen und `server.js` sowie `index.html` hineinkopieren.
2. `docker-compose.yml` im Compose Manager als Stack einfügen und starten.
3. App öffnen unter `http://<UNRAID-IP>:8085`.

Die Daten liegen unter `/mnt/user/appdata/trainingsplan/data/` (eine JSON-Datei pro Person).

## Hinweis
Die App hat keine Anmeldung. Für den Zugriff von außen einen Reverse Proxy mit Login davorschalten.
