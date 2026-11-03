# Trainingsplan

Interaktiver Trainingsplan fürs Fitnessstudio als kleine Web-App, gedacht für Docker Compose auf Unraid.
Mehrere Personen mit eigenem Plan und Verlauf, keine externen Abhängigkeiten (Node.js, JSON-Dateien als Speicher).

## Funktionen
- **Training:** Trainingstag wählen, Sätze abhaken, Gewicht und Wiederholungen eintragen, Einheit abschließen
- **Pausentimer:** startet nach jedem abgehakten Satz, mit Signalton und Vibration. Standard-Pause und Pause pro Übung einstellbar, +/−15 Sekunden, überspringen
- **Plan:** Tage und Übungen anlegen, umbenennen, sortieren, löschen. Übungsnamen werden aus der Bibliothek vorgeschlagen
- **Übungsbibliothek:** 40 Übungen mit Ausführung und Tipps, durchsuchbar und filterbar nach Muskelgruppe und Gerät. Übungen lassen sich direkt in einen Trainingstag übernehmen, eigene Übungen sind möglich
- **Verlauf:** Gewichtsdiagramm pro Übung und Liste aller Einheiten
- **PIN pro Person:** 4–8 Ziffern, ändern jederzeit möglich
- **Trainer-Zugang:** Mit der Trainer-PIN Zugriff auf alle Pläne, Bearbeiten, PINs zurücksetzen, Personen verwalten

## Installation auf Unraid
1. Ordner `/mnt/user/appdata/trainingsplan/app/` anlegen und `server.js`, `index.html` und `library.json` hineinkopieren.
2. In `docker-compose.yml` die `TRAINER_PIN` ändern und die Datei im Compose Manager als Stack einfügen.
3. Stack starten und die App unter `http://<UNRAID-IP>:8085` öffnen.

Die Daten liegen unter `/mnt/user/appdata/trainingsplan/data/` (eine JSON-Datei pro Person im Unterordner `users`).

## Update einer älteren Version
Dateien im `app`-Ordner ersetzen und den Container neu starten. Bestehende Personen bleiben erhalten. Wer noch keine PIN hat, vergibt sie beim ersten Anmelden: Die erste eingegebene PIN wird übernommen.

## Übungsbibliothek anpassen
Die Übungen stehen in `library.json` (Name, Muskelgruppe, Gerät, Ausführung, Tipps) und lassen sich dort direkt ergänzen oder ändern. Nach dem Speichern genügt ein Neuladen der Seite.

## Sicherheit
- PINs werden nur als Hash gespeichert. Nach 5 falschen Versuchen wird der Zugang für 5 Minuten gesperrt.
- Die Trainer-PIN steht in der Compose-Datei (`TRAINER_PIN`). Wird sie geändert, den Container neu starten.
- Die App ist für das Heimnetz gedacht. Für den Zugriff von außen immer einen Reverse Proxy mit HTTPS davorschalten, da PINs sonst unverschlüsselt übertragen werden.
