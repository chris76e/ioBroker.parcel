![Logo](admin/parcel.png)

# ioBroker.parcel

[![NPM version](https://img.shields.io/npm/v/iobroker.parcel.svg)](https://www.npmjs.com/package/iobroker.parcel)
[![Downloads](https://img.shields.io/npm/dm/iobroker.parcel.svg)](https://www.npmjs.com/package/iobroker.parcel)
![Number of Installations](https://iobroker.live/badges/parcel-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/parcel-stable.svg)
[![Dependency Status](https://img.shields.io/david/TA2k/iobroker.parcel.svg)](https://david-dm.org/TA2k/iobroker.parcel)

[![NPM](https://nodei.co/npm/iobroker.parcel.png?downloads=true)](https://nodei.co/npm/iobroker.parcel/)

**Tests:** ![Test and Release](https://github.com/TA2k/ioBroker.parcel/workflows/Test%20and%20Release/badge.svg)

## Parcel tracking adapter for ioBroker

Track parcels from Amazon, DHL, DPD, Hermes, UPS and GLS with your ioBroker smart home. Letter tracking of Deutsche Post is also supported. Notifications can be sent directly via Telegram, Pushover or Signal.

This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers. For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Login flow

**DHL:**

- Enter DHL app login
- Receive SMS/email code
- Enter code in instance settings and save

**Amazon:**

- Enter login credentials
- If required, enter an OTP token from your 2FA app before first login

**DPD, GLS, UPS, 17Track User:**

Enter username and password

**17TRACK API:**

Write a tracking number as text to `parcel.0.17t.register` with **ack / acknowledged disabled**.
Keep leading zeros and use one number per write. The adapter logs the request and the API's
acceptance or rejection (including its error code and message). Only an accepted request
is acknowledged by the adapter. API registrations use the account associated with the configured API key.

The read-only state `parcel.0.17t.quotaRemaining` shows the remaining shipment registration
quota returned by `getquota`. It is refreshed during each provider update and after a successful
registration or deletion. API errors preserve the last known value.

Enable **Telegram warning when fewer than 20 17TRACK shipments remain** in the notification
settings to receive a quota alert. This switch defaults to off and is independent of shipment
change notifications. It uses the configured Telegram instances and recipients; other notification
services are ignored. With no recipient specified, Telegram uses its default recipients.
The alert is sent once while the quota is below 20, including when first enabled with low quota.
The sent flag survives adapter restarts and resets once the quota returns to at least 20.

**Telegram notification for parcels and letters**

Enable in instance settings and enter e.g. `telegram.0`

## Einzelnen Paketdienst neu anmelden (Fork chris76e)

Unter `parcel.0.relogin` gibt es für jeden eingerichteten Dienst einen Knopf
(`amazon`, `dhl`, `dpd`, `gls`, `ups`, `hermes`, `17tuser`, `17track`).
Ein Druck meldet nur diesen Dienst neu an und ruft danach die Sendungen ab,
die anderen Dienste bleiben angemeldet, der Adapter wird nicht neu gestartet.

- `relogin.dhlCode`: neuen `dhllogin://` Code hier eintragen statt in den
  Einstellungen (Einstellungen speichern startet den ganzen Adapter neu).
- `relogin.amzOtp`: Amazon-Bestätigungscode (2FA/OTP) hier eintragen.
- `relogin.dhl` ohne Code erneuert nur die gespeicherte DHL-Session.

## Vis

**Show parcels in a Vis table**

Datapoint for all parcels:
`parcel.0.allProviderJson`

Datapoint for parcels in delivery:
`parcel.0.inDelivery`

**Widget: json table**

Instructions:
https://www.smarthome-tricks.de/software-iobroker/iobroker-vis-json-table-widget-teil-1-basics/

**Display DHL letter tracking in Vis**

Assign the datapoint `parcel.0.dhl.briefe....image` to a "String img src" element as object ID.

## Discussion and questions

<https://forum.iobroker.net/topic/51795/test-adapter-parcel-paketverfolgung-dhl-v0-0-1>

## Changelog
Versionen mit „chris76e“ (früher „einzeln“) stammen aus dem Fork [chris76e/ioBroker.parcel](https://github.com/chris76e/ioBroker.parcel) und bauen auf 0.3.3 von TA2k auf.

### 0.3.3-chris76e.11 (2026-11-03)
- GLS: Sendungen stehen jetzt unter ihrer Sendungsnummer wie in der GLS-App (Track-ID, sonst Paketnummer), nicht mehr unter der internen GLS-Kennung. Die interne Kennung steht in `glsId`, alle bekannten Nummern in `nummern`. Liefert Amazon dieselbe Sendung, bekommt der GLS-Eintrag die Nummer, unter der Amazon ihn führt. Amazon hängt an die 11-stellige GLS-Paketnummer teils eine Prüfziffer an. Damit zählt die Sendung in `notDelivered` und `inDelivery` nur einmal, wie bei DHL.
- GLS: Der Status enthält die Prognose von GLS, wenn sie feststeht („Zustellung morgen“, „Zustellung heute“).
- GLS: Die Schreibweise `DELIVERY_IN_TWO_OR_MORE_DAYS_ESTIMATE_CONFIRMED` (mit einem Unterstrich) wird als „unterwegs“ erkannt.

### 0.3.3-chris76e.10 (2026-11-02)
- Neuanmeldung eines einzelnen Dienstes (`relogin.<dienst>`, z. B. `relogin.dpd`): Danach werden nur noch die Sendungen dieses Dienstes abgerufen. Bisher hat der Adapter dabei alle Dienste neu abgefragt, Amazon also auch mit Anmeldung. Die Sendungen der anderen Dienste stammen aus dem letzten regulären Abruf und bleiben in `allProviderJson`, `notDelivered` und `inDelivery` erhalten. Alle Dienste werden weiter im normalen Rhythmus abgefragt. Die Logzeile danach zeigt nur den neu angemeldeten Dienst, zum Beispiel „Dienste nach Neuanmeldung: DPD ✓ angemeldet, 0 Sendungen“.

### 0.3.3-chris76e.9 (2026-11-02)
- Amazon: Die Änderung aus 0.3.3-einzeln.6 ist zurückgenommen. Der Test hat gezeigt, dass Amazon für die Bestellübersicht nach etwa 30 Minuten wieder eine frische Anmeldung verlangt. Der Adapter meldet sich deshalb wieder vor jedem Abruf an. Ausnahme: Direkt nach dem Start oder einer Neuanmeldung (weniger als 5 Minuten) meldet sich der erste Abruf nicht noch einmal an.
- Log: Nach dem Start und nach jeder Neuanmeldung eines Dienstes steht eine Zeile mit dem Stand aller eingerichteten Dienste, zum Beispiel „Dienste nach dem Start: Amazon ✓ angemeldet, 10 Sendungen · DHL ✓ angemeldet, 1 Sendung, Briefankündigung ✓ · DPD ✓ angemeldet, 0 Sendungen“. Ist ein Dienst nicht angemeldet, hat sein Abruf nicht geklappt oder liefert die Briefankündigung einen Fehler, steht dort ✗ mit dem Grund.

### 0.3.3-chris76e.8 (2026-11-02)
- Amazon: Vor jeder Anmeldung mit Passwort steht im Log, warum sie nötig ist, zum Beispiel „Amazon-Anmeldung: Bestellseite verlangt Anmeldung“. Kommen mit der gespeicherten Sitzung keine Bestellungen, nennt die Meldung auch, welche Seite Amazon stattdessen geliefert hat.

### 0.3.3-chris76e.7 (2026-11-02)
- Versionsbezeichnung „einzeln“ heißt jetzt „chris76e“; die Hilfsfunktionen des Forks liegen in `lib/chris76e.js` (Tests `chris76e.test.js`). Keine Änderung am Verhalten gegenüber 0.3.3-einzeln.6.

### 0.3.3-einzeln.6 (2026-11-02)
- Amazon: Der Adapter meldet sich nicht mehr bei jedem Abruf mit dem Passwort an. Bisher stand deshalb alle 30 Minuten „Relogin to Amazon successful“ im Log, und auch eine Neuanmeldung bei DHL oder DPD löste eine Amazon-Anmeldung aus. Jetzt werden die Bestellungen mit der gespeicherten Sitzung abgerufen. Neu angemeldet wird nur
  - spätestens alle 8 Stunden (`AMZ_ANMELDUNG_STD`),
  - wenn Amazon auf der Bestellseite eine Anmeldung verlangt,
  - wenn mit der gespeicherten Sitzung keine einzige Bestellung zurückkommt.

  Weniger Passwort-Anmeldungen bedeuten weniger Captcha- und Sperr-Risiko.

### 0.3.3-einzeln.5 (2026-11-02)
- DHL: Das Zustellzeitfenster steht jetzt als „13:20 - 14:50“ (deutsche Zeit, ohne Sekunden) im Status. DHL schickt manchmal ein leeres Fenster (zweimal Mitternacht, bisher „01:00:00-01:00:00“), das fällt jetzt weg.
- DHL: „0 Stopps“ erscheint nicht mehr. Die Zahl der Stopps bis zur Zustellung steht nur noch im Status, wenn DHL wirklich eine liefert („· 3 Stopps“).
- Amazon: Kennt der Adapter den Amazon-Status nicht, ermittelt er ihn jetzt aus dem Statustext (storniert/Rücksendung = abgeschlossen, verspätet = unterwegs) oder aus dem zuletzt erreichten Schritt der Sendungsverfolgung (bestellt, versendet, zugestellt). Ein unbekannter Status steht einmal pro Start im Log.
- Eine Sendung, die zugleich bei Amazon und beim Zusteller (DHL, DPD …) steht, zählt in `notDelivered`, `inDelivery` und den Zählern nur noch einmal. Das gilt auch für ein Paket mit mehreren Amazon-Bestellungen. Sie gilt als zugestellt, sobald einer der beiden Dienste „zugestellt“ meldet. `allProviderJson` enthält weiterhin alle Einträge.

### 0.3.3-einzeln.4 (2026-11-02)
- Amazon: Verspätete Sendungen („Neues Lieferdatum … Zuvor erwartet am …“) gelten als unterwegs. Bisher bekamen sie den Status „unbekannt“ und fehlten in Auswertungen offener Sendungen.

### 0.3.3-einzeln.3 (2026-10-28)
- Amazon: Ein Netzwerkfehler bei der Anmeldung bringt den Adapter nicht mehr zum Absturz, der nächste Abruf versucht es erneut. Ein Fehler bei Amazon hält die anderen Dienste nicht mehr auf.

### 0.3.3-einzeln.2 (2026-10-28)
- DHL-Verbesserungen aus dem Fork mproper23/ioBroker.parcel übernommen: Netzwerkfehler beim Erneuern des Tokens beenden die Sitzung nicht mehr, die Sitzung kann sich über SSO-Cookies selbst erneuern (`dhlSsoCookies`), Briefankündigung über eine Auth0-Websitzung (`auth.dhlAuth0Session`), bei Fehlern pausiert die Briefankündigung statt sich abzuschalten, optionaler Import von Web-Cookies. Cookie-Felder werden verschlüsselt gespeichert.

### 0.3.3-einzeln.1 (2026-10-28)
- Einzelne Dienste lassen sich ohne Neustart des Adapters neu anmelden: Datenpunkte `relogin.<dienst>` (z. B. `relogin.dpd`), dazu `relogin.dhlCode` für einen neuen DHL-Anmeldecode und `relogin.amzOtp` für einen Amazon-Einmalcode.

### 0.3.3 (2026-07-18)
- Fix GLS states

### 0.3.2 (2026-07-08)
- Fix for DPD
- Fix for GLS

### 0.3.1 (2026-07-07)

- DHL: New login via browser code (dhllogin://)
- Amazon: Login fix and captcha detection with note

### 0.3.0 (2026-04-05)

- DHL: New login via browser code (dhllogin://)
- Amazon: Login fix and captcha detection with note

### 0.2.10 (2025-01-15)

- add alternative way for dhl login
- move dhl connections error to info level

### 0.2.8 (2024-10-18)

- fix amazon login

### 0.0.30

- Fix hermes login

### 0.0.25

- Fix amazon UI parsing

### 0.0.19

- Fix GLS Parcel

### 0.0.18

- Fix UPS/GLS Login

### 0.0.1

- (TA2k) initial release

## License

MIT License

Copyright (c) 2022-2026 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
