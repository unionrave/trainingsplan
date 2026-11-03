# Trainingsplan

Interaktiver Trainingsplan fürs Fitnessstudio als kleine Web-App, gedacht für Docker Compose auf Unraid.
Mehrere Personen mit eigenem Plan und Verlauf, keine externen Abhängigkeiten (Node.js, JSON-Dateien als Speicher).

## Funktionen
- **Training:** Trainingstag wählen, Sätze abhaken, Gewicht und Wiederholungen pro Satz eintragen (die Werte der letzten Einheit sind pro Satz vorbelegt), Einheit abschließen
- **Pausentimer:** startet nach jedem abgehakten Satz, mit Signalton und Vibration. Standard-Pause und Pause pro Übung einstellbar, +/−15 Sekunden, überspringen
- **Plan:** Tage und Übungen anlegen, umbenennen, sortieren, löschen. Übungsnamen werden aus der Bibliothek vorgeschlagen. Pro Übung wahlweise „alle Sätze gleich" oder jeder Satz einzeln geplant (Gewicht, Wiederholungen, Aufwärmsatz), z. B. für Pyramidensätze
- **Übungsbibliothek:** 40 Übungen mit Ausführung und Tipps, durchsuchbar und filterbar nach Muskelgruppe und Gerät. Übungen lassen sich direkt in einen Trainingstag übernehmen, eigene Übungen sind möglich
- **Verlauf:** Gewichtsdiagramm pro Übung und Liste aller Einheiten
- **PIN pro Person:** 4–8 Ziffern, ändern jederzeit möglich
- **Trainer-Zugang:** Mit der Trainer-PIN Zugriff auf alle Pläne, Bearbeiten, PINs zurücksetzen, Personen verwalten

## Aufbau des Repos
```
trainingsplan/
├── docker-compose.yml   Stack für Unraid
├── app/                 Anwendung (wird schreibgeschützt in den Container gemountet)
│   ├── server.js
│   ├── index.html
│   └── library.json     Übungsbibliothek, frei editierbar
└── data/                Pläne und PINs (wird nicht ins Repo übernommen)
```

## Installation auf Unraid
1. Im Unraid-Terminal das Repo nach `/mnt/user/appdata` klonen:
   ```
   cd /mnt/user/appdata
   git clone https://github.com/unionrave/trainingsplan.git
   ```
   Damit entstehen `app/` und `data/` automatisch am richtigen Ort.
2. Den Inhalt von `docker-compose.yml` im Compose Manager als neuen Stack einfügen und dort `TRAINER_PIN` ändern.
3. Stack starten und die App unter `http://<UNRAID-IP>:8085` öffnen.

## Update
```
cd /mnt/user/appdata/trainingsplan
git pull
```
Danach den Container neu starten. Die Daten in `data/` bleiben erhalten.
Die `TRAINER_PIN` besser nur in der Kopie im Compose Manager ändern und nicht in der Datei im Repo-Ordner, sonst meldet `git pull` Konflikte.

### Update von der ersten Version (alle Dateien im Hauptordner)
Ein `git pull` verschiebt die Dateien automatisch nach `app/`. Vorhandene Personen bleiben erhalten. Wer noch keine PIN hat, vergibt sie beim ersten Anmelden: Die erste eingegebene PIN wird übernommen.

## Übungsbibliothek anpassen
Die Übungen stehen in `app/library.json` (Name, Muskelgruppe, Gerät, Ausführung, Tipps) und lassen sich dort direkt ergänzen oder ändern. Nach dem Speichern genügt ein Neuladen der Seite.

## Sicherheit
- PINs werden nur als Hash gespeichert. Nach 5 falschen Versuchen wird der Zugang für 5 Minuten gesperrt.
- Die Trainer-PIN steht in der Compose-Datei (`TRAINER_PIN`). Wird sie geändert, den Container neu starten.
- Die App ist für das Heimnetz gedacht. Für den Zugriff von außen immer einen Reverse Proxy mit HTTPS davorschalten, da PINs sonst unverschlüsselt übertragen werden.
