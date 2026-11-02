'use strict';

/**
 * Ergänzungen im Fork chris76e/ioBroker.parcel:
 * - amazonStatus: Amazon-shortStatus mit Rückfällen (Verspätung, Storno/Rücksendung, Meilenstein)
 * - dhlStatusText: DHL-Status mit Zeitfenster "13:20 - 14:50" (ohne Sekunden, leere Fenster weg) und Stopps nur bei echtem Zähler
 * - ohneDoppelte: notDelivered/inDelivery ohne doppelte Sendungsnummern (Amazon + Zusteller)
 */

const AMZ_SHORT = {
  ORDER_PLACED: 'REGISTERED',
  SHIPPING_SOON: 'IN_PREPARATION',
  IN_TRANSIT: 'IN_TRANSIT',
  DELAYED: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  PICKED_UP: 'DELIVERED',
  // Endstatus wie bei DPD RETURN_TO_SENDER: keine Zustellung mehr zu erwarten
  CANCELLED: 'DELIVERED',
  RETURNED: 'DELIVERED',
  RETURNING: 'DELIVERED',
};
const AMZ_MEILENSTEIN = {
  ORDERED: 'REGISTERED',
  SHIPPED: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};
const AMZ_ENDE = /storniert|erstattet|erstattung|rücksendung|zurückgesendet|zurück an|an den absender|an den verkäufer/i;
const AMZ_VERSPAETET = /neues lieferdatum|zuvor erwartet|verzöger|verspät/i;

/**
 * Amazon-Sendung -> Name des delivery_status (REGISTERED, IN_TRANSIT …) oder null, wenn nichts passt.
 * Reihenfolge: bekannter shortStatus, Statustext Storno/Rücksendung (Endstatus), Statustext Verspätung (unterwegs),
 * zuletzt erreichter Meilenstein aus progressTracker (ORDERED, SHIPPED …).
 * Beispiel 02.11.2026: shortStatus NO_INFORMATION_AVAILABLE, Text "Neues Lieferdatum: Donnerstag. Zuvor erwartet am 2. November",
 * Meilenstein SHIPPED -> IN_TRANSIT.
 *
 * @param {any} sendung Eintrag aus amazon.json (mit detailedState)
 * @returns {{status: string|null, grund: string}}
 */
function amazonStatus(sendung) {
  const d = (sendung && sendung.detailedState) || {};
  const kurz = String(d.shortStatus || '');
  if (AMZ_SHORT[kurz]) return { status: AMZ_SHORT[kurz], grund: 'shortStatus' };
  const text = String((sendung && sendung.status) || '');
  if (AMZ_ENDE.test(text)) return { status: 'DELIVERED', grund: 'text-ende' };
  if (AMZ_VERSPAETET.test(text)) return { status: 'IN_TRANSIT', grund: 'text-verspaetet' };
  const m = String((d.progressTracker && d.progressTracker.lastReachedMilestone) || '');
  if (AMZ_MEILENSTEIN[m]) return { status: AMZ_MEILENSTEIN[m], grund: 'meilenstein' };
  return { status: null, grund: 'unbekannt' };
}

const ZEIT = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

/**
 * Uhrzeit "HH:MM" in deutscher Zeit, '' bei ungültigem Wert
 *
 * @param {any} v Zeitpunkt (ISO-Text)
 */
function uhrzeit(v) {
  if (!v) return '';
  const t = new Date(v);
  return isNaN(t.getTime()) ? '' : ZEIT.format(t);
}

/**
 * Statustext einer DHL-Sendung: kurzStatus/status, dazu Zeitfenster "13:20 - 14:50" (nur wenn von und bis bekannt und
 * verschieden; DHL schickt sonst z. B. zweimal Mitternacht = "01:00:00-01:00:00") und "3 Stopps" (nur bei Zähler > 0).
 *
 * @param {any} sendung Eintrag aus dhl.json
 * @returns {string}
 */
function dhlStatusText(sendung) {
  const sd = (sendung && sendung.sendungsdetails) || {};
  const verlauf = sd.sendungsverlauf || {};
  let status = verlauf.kurzStatus || verlauf.status || '';
  const z = sd.zustellung || {};
  const von = uhrzeit(z.zustellzeitfensterVon);
  const bis = uhrzeit(z.zustellzeitfensterBis);
  if (von && bis && von !== bis) status = `${status} ${von} - ${bis}`;
  const stopps = Number(sd.liveTracking && sd.liveTracking.countdown);
  if (sd.liveTracking && Number.isFinite(stopps) && stopps > 0) status = `${status} · ${stopps} ${stopps === 1 ? 'Stopp' : 'Stopps'}`;
  return String(status).trim();
}

/**
 * Doppelte Sendungsnummern (Amazon + Zusteller, z. B. JJD… von Amazon und DHL) in notDelivered/inDelivery zusammenfassen.
 * Eine Sendungsnummer gilt als zugestellt, sobald irgendein Dienst sie als zugestellt meldet. Pro Nummer bleibt der
 * Eintrag mit dem weitesten Stand (bei Gleichstand der Zusteller); kommt ein Amazon-Eintrag dazu, übernimmt er dessen
 * Artikelnamen und bekommt "quellen" (z. B. ["AMZ","DHL"]). allProviderJson bleibt unverändert.
 *
 * @param {any[]} notDelivered
 * @param {any[]} inDelivery
 * @param {any[]} alle mergedJson
 * @param {Record<string, number>} ds delivery_status
 */
function ohneDoppelte(notDelivered, inDelivery, alle, ds) {
  const key = (s) => (s && s.id !== undefined && s.id !== null && String(s.id) !== '' ? String(s.id) : null);
  const zugestellt = new Set();
  const gruppen = {};
  for (const s of alle || []) {
    const k = key(s);
    if (!k) continue;
    if (s.delivery_status === ds.DELIVERED) zugestellt.add(k);
    (gruppen[k] = gruppen[k] || []).push(s);
  }
  const rang = (s) => (s.delivery_status === ds.DELIVERED ? 1000 : Number(s.delivery_status) || 0);
  const vertreter = (k) => {
    const g = (gruppen[k] || []).filter((s) => s.delivery_status !== ds.DELIVERED);
    if (g.length < 2) return null;
    let best = g[0];
    for (const s of g.slice(1)) {
      if (rang(s) > rang(best) || (rang(s) === rang(best) && best.source === 'AMZ' && s.source !== 'AMZ')) best = s;
    }
    const amz = g.find((s) => s.source === 'AMZ');
    const out = Object.assign({}, best, { quellen: [...new Set(g.map((s) => s.source))] });
    if (amz && best.source !== 'AMZ' && amz.name) out.name = amz.name;
    if (best.delivery_status === ds.OUT_FOR_DELIVERY) out.inDelivery = true;
    return out;
  };
  const filtern = (liste, nurInZustellung) => {
    const gesehen = new Set();
    const out = [];
    for (const s of liste || []) {
      const k = key(s);
      if (!k) {
        out.push(s);
        continue;
      }
      if (gesehen.has(k) || zugestellt.has(k)) continue;
      gesehen.add(k);
      const v = vertreter(k);
      if (!v) {
        out.push(s);
        continue;
      }
      if (nurInZustellung && v.delivery_status !== ds.OUT_FOR_DELIVERY) continue;
      out.push(v);
    }
    return out;
  };
  // inDelivery: auch eine Nummer aufnehmen, die nur der Zusteller als "in Zustellung" meldet (steht dann schon drin)
  return { notDelivered: filtern(notDelivered, false), inDelivery: filtern(inDelivery, true) };
}

/**
 * Eine Logzeile mit dem Stand jedes eingerichteten Dienstes, z. B.
 * "Dienste nach dem Start: Amazon ✓ angemeldet, 10 Sendungen · DHL ✓ angemeldet, 1 Sendung · DPD ✗ Abruf fehlgeschlagen"
 *
 * @param {string} anlass z. B. "nach dem Start"
 * @param {{name: string, angemeldet: boolean, abruf: boolean, anzahl: number, briefe?: string}[]} dienste nur eingerichtete Dienste;
 *   briefe (DHL): 'ok' oder Fehlertext der Briefankündigung
 * @returns {string}
 */
function dienstUebersicht(anlass, dienste) {
  const teile = (dienste || []).map((d) => {
    let t;
    if (!d.angemeldet) t = `${d.name} ✗ nicht angemeldet`;
    else if (!d.abruf) t = `${d.name} ✗ angemeldet, aber Abruf fehlgeschlagen`;
    else t = `${d.name} ✓ angemeldet, ${d.anzahl} ${d.anzahl === 1 ? 'Sendung' : 'Sendungen'}`;
    if (d.briefe) t += d.briefe === 'ok' ? ', Briefankündigung ✓' : `, Briefankündigung ✗ ${d.briefe}`;
    return t;
  });
  return `Dienste ${anlass}: ${teile.length ? teile.join(' · ') : 'keiner eingerichtet'}`;
}

/**
 * Liste der Provider-Daten nach dem Abruf nur eines Dienstes: die Einträge dieses Dienstes aus dem letzten Abruf werden durch
 * die neuen ersetzt (an der Stelle des ersten alten Eintrags, sonst hinten), alle anderen bleiben in ihrer Reihenfolge.
 *
 * @param {{id: string, data: any}[]} alt mergeLog des letzten Abrufs
 * @param {string} id neu abgerufener Dienst
 * @param {{id: string, data: any}[]} neu mergeProviderJson-Aufrufe dieses Abrufs
 * @returns {{id: string, data: any}[]}
 */
function mergeLogFuer(alt, id, neu) {
  const frisch = (neu || []).filter((e) => e.id === id);
  const out = [];
  let eingesetzt = false;
  for (const e of alt || []) {
    if (e.id !== id) {
      out.push(e);
    } else if (!eingesetzt) {
      out.push(...frisch);
      eingesetzt = true;
    }
  }
  if (!eingesetzt) out.push(...frisch);
  return out;
}

module.exports = { amazonStatus, dhlStatusText, ohneDoppelte, uhrzeit, dienstUebersicht, mergeLogFuer };
