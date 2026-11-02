'use strict';
// @ts-nocheck

const { expect } = require('chai');
const { amazonStatus, dhlStatusText, ohneDoppelte } = require('./lib/einzeln');

const ds = { ERROR: -1, UNKNOWN: 5, REGISTERED: 10, IN_PREPARATION: 20, IN_TRANSIT: 30, OUT_FOR_DELIVERY: 40, DELIVERED: 1 };
const amz = (shortStatus, status, meilenstein) => ({
  status,
  detailedState: { shortStatus, progressTracker: meilenstein ? { lastReachedMilestone: meilenstein } : undefined },
});

describe('Amazon-Status (einzeln)', () => {
  it('bekannte shortStatus-Werte', () => {
    expect(amazonStatus(amz('ORDER_PLACED', 'Bestellt. Zustellung: Mittwoch', 'ORDERED')).status).to.equal('REGISTERED');
    expect(amazonStatus(amz('IN_TRANSIT', 'Versendet.', 'SHIPPED')).status).to.equal('IN_TRANSIT');
    expect(amazonStatus(amz('DELIVERED', 'Zugestellt: 31. Oktober', 'DELIVERED')).status).to.equal('DELIVERED');
    expect(amazonStatus(amz('DELAYED', 'x')).status).to.equal('IN_TRANSIT');
  });
  it('Verspätung mit NO_INFORMATION_AVAILABLE (echter Fall 02.11.2026) -> unterwegs', () => {
    const r = amazonStatus(
      amz('NO_INFORMATION_AVAILABLE', 'Versendet. Neues Lieferdatum: Donnerstag. Zuvor erwartet am 2. November. Entschuldigen Sie nochmals die Verzögerung.', 'SHIPPED'),
    );
    expect(r).to.deep.equal({ status: 'IN_TRANSIT', grund: 'text-verspaetet' });
  });
  it('Storno/Rücksendung -> Endstatus', () => {
    expect(amazonStatus(amz('NO_INFORMATION_AVAILABLE', 'Storniert', 'ORDERED')).status).to.equal('DELIVERED');
    expect(amazonStatus(amz('XYZ', 'Rücksendung an den Verkäufer', 'SHIPPED')).status).to.equal('DELIVERED');
    expect(amazonStatus(amz('CANCELLED', 'egal')).status).to.equal('DELIVERED');
  });
  it('unbekannter shortStatus ohne passenden Text -> Meilenstein', () => {
    expect(amazonStatus(amz('NEU', 'irgendwas', 'SHIPPED')).status).to.equal('IN_TRANSIT');
    expect(amazonStatus(amz('NEU', 'irgendwas', 'ORDERED')).status).to.equal('REGISTERED');
  });
  it('gar nichts bekannt -> null', () => {
    expect(amazonStatus(amz('NEU', 'irgendwas'))).to.deep.equal({ status: null, grund: 'unbekannt' });
    expect(amazonStatus({})).to.deep.equal({ status: null, grund: 'unbekannt' });
  });
  it('Zugestellt-Text mit shortStatus DELIVERED bleibt zugestellt, auch wenn "zurück" vorkommt', () => {
    expect(amazonStatus(amz('DELIVERED', 'Zugestellt: an Nachbarn, zurück an …')).status).to.equal('DELIVERED');
  });
});

describe('DHL-Statustext (einzeln)', () => {
  const dhl = (sd) => ({ sendungsdetails: Object.assign({ sendungsverlauf: { kurzStatus: 'In Zustellung' } }, sd) });
  it('Zeitfenster ohne Sekunden in deutscher Zeit', () => {
    const t = dhlStatusText(dhl({ zustellung: { zustellzeitfensterVon: '2026-10-31T13:20:00+01:00', zustellzeitfensterBis: '2026-10-31T14:50:00+01:00' } }));
    expect(t).to.equal('In Zustellung 13:20 - 14:50');
  });
  it('Sommerzeit/UTC-Angabe wird nach Europe/Berlin umgerechnet', () => {
    const t = dhlStatusText(dhl({ zustellung: { zustellzeitfensterVon: '2026-07-01T10:00:00Z', zustellzeitfensterBis: '2026-07-01T12:30:00Z' } }));
    expect(t).to.equal('In Zustellung 12:00 - 14:30');
  });
  it('leeres Fenster (zweimal Mitternacht) fällt weg', () => {
    const t = dhlStatusText(dhl({ zustellung: { zustellzeitfensterVon: '2026-10-31T00:00:00Z', zustellzeitfensterBis: '2026-10-31T00:00:00Z' } }));
    expect(t).to.equal('In Zustellung');
  });
  it('nur "bis" ohne "von" fällt weg, ungültige Zeit fällt weg', () => {
    expect(dhlStatusText(dhl({ zustellung: { zustellzeitfensterBis: '2026-10-31T14:50:00+01:00' } }))).to.equal('In Zustellung');
    expect(dhlStatusText(dhl({ zustellung: { zustellzeitfensterVon: 'quatsch', zustellzeitfensterBis: 'auch' } }))).to.equal('In Zustellung');
  });
  it('Stopps nur bei Zähler > 0', () => {
    expect(dhlStatusText(dhl({ liveTracking: {} }))).to.equal('In Zustellung');
    expect(dhlStatusText(dhl({ liveTracking: { countdown: 0 } }))).to.equal('In Zustellung');
    expect(dhlStatusText(dhl({ liveTracking: { countdown: 1 } }))).to.equal('In Zustellung · 1 Stopp');
    expect(
      dhlStatusText(
        dhl({ liveTracking: { countdown: 3 }, zustellung: { zustellzeitfensterVon: '2026-10-31T13:20:00+01:00', zustellzeitfensterBis: '2026-10-31T14:50:00+01:00' } }),
      ),
    ).to.equal('In Zustellung 13:20 - 14:50 · 3 Stopps');
  });
  it('status statt kurzStatus, ohne Verlauf leer', () => {
    expect(dhlStatusText({ sendungsdetails: { sendungsverlauf: { status: 'Zustellung erfolgreich.' } } })).to.equal('Zustellung erfolgreich.');
    expect(dhlStatusText({})).to.equal('');
  });
});

describe('Doppelte Sendungsnummern (einzeln)', () => {
  const a = (id, source, st, name) => ({ id, source, delivery_status: st, name: name || source, status: source + ' ' + st });
  const offen = (l) => l.filter((s) => s.delivery_status !== ds.DELIVERED);
  const inZ = (l) => l.filter((s) => s.delivery_status === ds.OUT_FOR_DELIVERY);

  it('Amazon + DHL in Zustellung zählt einmal, mit Amazon-Namen und DHL-Status', () => {
    const alle = [a('JJD1', 'AMZ', ds.IN_TRANSIT, 'Socken'), a('JJD1', 'DHL', ds.OUT_FOR_DELIVERY, 'Amazon'), a('X', 'AMZ', ds.REGISTERED, 'Regal')];
    const r = ohneDoppelte(offen(alle), inZ(alle), alle, ds);
    expect(r.notDelivered.map((s) => s.id)).to.deep.equal(['JJD1', 'X']);
    expect(r.notDelivered[0]).to.include({ source: 'DHL', name: 'Socken', delivery_status: ds.OUT_FOR_DELIVERY, inDelivery: true });
    expect(r.notDelivered[0].quellen).to.deep.equal(['AMZ', 'DHL']);
    expect(r.inDelivery.map((s) => s.id)).to.deep.equal(['JJD1']);
    expect(alle[1].name).to.equal('Amazon'); // Original unverändert
  });
  it('ein Dienst meldet zugestellt -> nicht mehr offen', () => {
    const alle = [a('JJD1', 'AMZ', ds.OUT_FOR_DELIVERY, 'Socken'), a('JJD1', 'DHL', ds.DELIVERED, 'Amazon')];
    const r = ohneDoppelte(offen(alle), inZ(alle), alle, ds);
    expect(r.notDelivered).to.have.length(0);
    expect(r.inDelivery).to.have.length(0);
  });
  it('Gleichstand -> Zusteller-Eintrag', () => {
    const alle = [a('JJD1', 'AMZ', ds.IN_TRANSIT, 'Socken'), a('JJD1', 'DHL', ds.IN_TRANSIT, 'Amazon')];
    const r = ohneDoppelte(offen(alle), inZ(alle), alle, ds);
    expect(r.notDelivered).to.have.length(1);
    expect(r.notDelivered[0]).to.include({ source: 'DHL', name: 'Socken' });
  });
  it('mehrere Amazon-Bestellungen im selben Paket zählen einmal', () => {
    const alle = [a('DE1', 'AMZ', ds.IN_TRANSIT, 'Artikel'), a('DE1', 'AMZ', ds.IN_TRANSIT, '304-1234567-1234567')];
    const r = ohneDoppelte(offen(alle), inZ(alle), alle, ds);
    expect(r.notDelivered).to.have.length(1);
  });
  it('Einzelsendungen und Einträge ohne Nummer bleiben unverändert', () => {
    const alle = [a('A', 'DPD', ds.IN_TRANSIT), a('', 'DHL', ds.IN_TRANSIT), a(undefined, 'GLS', ds.REGISTERED)];
    const r = ohneDoppelte(offen(alle), inZ(alle), alle, ds);
    expect(r.notDelivered).to.have.length(3);
    expect(r.notDelivered[0]).to.equal(alle[0]);
  });
});
