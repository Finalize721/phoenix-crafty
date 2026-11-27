# Crafty Atelier

Inoffizieller, auf den Crafty+ ausgerichteter Fork der [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app) mit zusätzlichen Akkufunktionen, automatischer Verbindung unter Android und individuell anpassbarer Oberfläche.

**[Crafty Atelier öffnen](https://finalize721.github.io/phoenix-crafty/)** · [English](README.md) · [Originalprojekt](https://github.com/firsttris/reactive-volcano-app)

[![GitHub Pages](https://github.com/Finalize721/phoenix-crafty/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/Finalize721/phoenix-crafty/actions/workflows/pages.yml)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

## Was unterscheidet den Fork vom Original?

| Funktion | Beschreibung |
|---|---|
| Automatische Verbindung unter Android | Beim App-Start in Android Chrome wird automatisch versucht, das zuletzt autorisierte Gerät zu verbinden. Erneute Verbindungsversuche haben Vorrang vor der Geräteauswahl. |
| Ladeprognose | Geschätzte Restladezeit und Endzeit bis 99 % anhand lokaler Akkudaten und aktueller Beobachtungen. Historische Vorschau auch bei unbestätigtem Ladestatus. |
| Akkudiagnose | Export von Akkumessungen, Prognoseverläufen und Berechnungsdetails als JSON zur Fehlersuche. |
| Ladebenachrichtigung | Browserbenachrichtigung bei 99 %, sofern unterstützt und autorisiert. |
| Akkugrenze | Experimentelles Crafty+-Ortungssignal und automatische Heizungsabschaltung aktivierbar, bei frei wählbarer Akkugrenze (1–99 %, Standard 15 %). Beide standardmäßig aus. |
| Experimentelle Session-Verlängerung | Zeitlich begrenzter Versuch (15, 30, 45 oder 60 Minuten), den unterstützten Fünf-Minuten-Abschalttimer mit Rückleseprüfung zurückzusetzen. |
| Oberfläche | Drei Farbpaletten, eigene Grund- und Akzentfarben, dauerhaft gespeicherter Hell-/Dunkelmodus und neues Startbild/App-Symbole. |
| Verlauf und Zuverlässigkeit | Einstellbare Aufbewahrungsdauer, erneutes Auslesen der Bluetooth-Werte bei Rückkehr zur App und genauere Prüfung von Akku-Beobachtungen. |

Der Fork baut auf der vorhandenen Gerätesteuerung, Session-Historie, Gerätewiedererkennung und automatischen Wiederverbindung nach Verbindungsabbrüchen des Originalprojekts auf. Er wird hauptsächlich für den Crafty+ entwickelt und genutzt. Andere vom Original unterstützte Geräte wurden für diesen Fork nicht unabhängig validiert.

## Loslegen

1. [Crafty Atelier](https://finalize721.github.io/phoenix-crafty/) in Chrome auf Android öffnen.
2. Crafty+ einschalten und sicherstellen, dass kein anderes Smartphone und keine andere App verbunden ist.
3. Bei der ersten Verbindung das Gerät im Bluetooth-Auswahldialog auswählen.
4. Optional die PWA über das Browsermenü installieren. Nach dem ersten Laden kann die App auch offline starten.

### Gerät über App-Neustarts hinweg merken

Falls Chrome wiederholt zur Geräteauswahl auffordert, folgende Adresse öffnen:

`chrome://flags/#enable-web-bluetooth-new-permissions-backend`

**Use the new permissions backend for Web Bluetooth** auf Enabled setzen, sofern verfügbar, Chrome neu starten und das Gerät erneut autorisieren. Dies hat auf dem Android-Gerät des Fork-Entwicklers funktioniert. Die Verfügbarkeit hängt von Browser und Version ab.

Die App speichert die Geräte-ID lokal und ruft das autorisierte Gerät über `navigator.bluetooth.getDevices()` ab. Die Berechtigung selbst verwaltet Chrome. Automatisches Verbinden erfordert ein erreichbares Gerät und kann Browserberechtigungen nicht umgehen.

## Akku- und Session-Funktionen

- **Ladeprognose:** experimentelle Schätzung, keine garantierte Endzeit. Die App schließt aus beobachteten Akkuänderungen auf den Ladestatus; ein bestätigtes Signal für ein angeschlossenes Ladegerät steht nicht zur Verfügung. Fehlende oder verzögerte Bluetooth-Daten können die Prognose beeinflussen.
- **Akkugrenze:** in den Crafty+-Einstellungen die Grenze festlegen und die gewünschten Aktionen aktivieren. Bei Unterschreiten während einer aktiven Heizsession werden diese nach Erreichen der Zieltemperatur und erneuter Prüfung der Gerätedaten ausgeführt. Eine geänderte Grenze aktiviert die Erkennung erneut, ohne sofort eine Aktion auszulösen. Bewusstes erneutes Einschalten unterhalb der Grenze löst nicht sofort wieder eine Abschaltung aus. Die optionale experimentelle Gerätewarnung fordert einmal das vorhandene Ortungssignal an, keine Smartphone-Vibration. Dauer, Vibrationsmuster und Auswirkung auf die Heizung hängen von der Firmware ab und sind nicht am Gerät bestätigt; die Heizsession kann unterbrochen werden. Die bisherige Smartphone-Warnung wird nicht automatisch übernommen.
- **Session-Verlängerung:** setzt aktive Heizung, erreichte Zieltemperatur, 300 Sekunden Abschaltzeit und sichtbare App voraus. Versucht alle 30 Sekunden, die Abschaltzeit erneut zu schreiben. Stoppt bei fehlender Bestätigung, Wegfall der Voraussetzungen, Verbindungsabbruch, Hintergrundbetrieb oder Zeitüberschreitung. Ob der Reset von der Firmware akzeptiert wird, muss am Gerät bestätigt werden. Schaltet die Heizung nie automatisch ein; nach dem Stoppen läuft der normale Gerätetimer weiter.

Alle automatischen Aktionen benötigen die laufende App und eine aktive Bluetooth-Verbindung. Android kann den Browser im Hintergrund pausieren oder beenden. Diese Funktionen sind keine Sicherheitsmechanismen; das Gerät nicht unbeaufsichtigt lassen.

Akkuhistorie und Einstellungen bleiben im Browser. Der lokale Diagnoseexport kann Gerätekennungen und Zeitstempel enthalten; vor dem Teilen prüfen.

## Entwicklung

Benötigt [Bun](https://bun.sh/) (siehe `packageManager` in package.json).

```bash
git clone https://github.com/Finalize721/phoenix-crafty.git
cd phoenix-crafty
bun install --frozen-lockfile
bun run dev
```

```bash
bun run test
bun run build
```

Pull Requests durchlaufen automatisierte Tests und den Produktions-Build. Pushes auf main veröffentlichen die App auf GitHub Pages.

*Entwicklungshinweis: Sämtliche Änderungen gegenüber dem Original wurden chatbasiert mit KI-Unterstützung entwickelt („Vibe Coding“), ohne unabhängiges menschliches Code-Review. Automatisierte Tests, KI-gestützte Prüfungen und gelegentliche Praxistests ersetzen weder ein menschliches Review noch umfassende Hardwarevalidierung. Die Ergänzungen sind experimentell.*

## Originalprojekt und Lizenz

Crafty Atelier basiert auf der [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app) von Tristan Teufel und Mitwirkenden. Die [ursprüngliche README](https://github.com/firsttris/reactive-volcano-app#readme) und [Upstream-Dokumentation](https://firsttris.github.io/reactive-volcano-app/docs/) enthalten die vollständige Geräteübersicht, Plattformunterstützung, Self-Hosting und Protokolldetails. Diese Dokumentation beschreibt das Originalprojekt und nicht zwingend alle Ergänzungen des Forks.

Lizenziert unter [AGPL-3.0](LICENSE), ursprüngliches Copyright und Lizenz bleiben erhalten. Unabhängiges, inoffizielles Projekt ohne Verbindung zur Storz & Bickel GmbH und ohne deren Unterstützung oder Autorisierung. CRAFTY, VOLCANO, VENTY, VEAZY und STORZ & BICKEL sind Marken ihrer jeweiligen Inhaber. Ohne Gewährleistung; Nutzung auf eigenes Risiko.
