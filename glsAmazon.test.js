'use strict';
// @ts-nocheck

const { expect } = require('chai');
const { glsSendung, glsAnAmazonAngleichen, ohneDoppelte } = require('./lib/chris76e');
const { classifyGlsDeliveryStatus } = require('./lib/glsStatus');

const ds = { ERROR: -1, UNKNOWN: 5, REGISTERED: 10, IN_PREPARATION: 20, IN_TRANSIT: 30, OUT_FOR_DELIVERY: 40, DELIVERED: 1 };

// echte Daten vom 03.11.2026 (gekürzt)
const leifheit = {
  id: 'a2d5a3f5-afa1-4f0e-9e83-ff84004ac90c',
  trackingReference: 'ZMORSQBI',
  parcelNumber: '71022925630',
  name: 'AVANTRADO GmbH  ',
  deliveredAt: null,
  latestStatusText: 'Das Paket wurde durch GLS übernommen.',
  estimate: { deliveryStatus: 'DELIVERY_IN_ONE_DAY', updatedDeliveryStatus: 'DELIVERY_IN_ONE_DAY' },
};
const vileda = {
  id: '717c8ea0-c9ca-4cb9-adef-f17406b3d243',
  trackingReference: '42030610626',
  parcelNumber: '42030610626',
  name: null,
  deliveredAt: null,
  latestStatusText: 'Das Paket ist im Paketzentrum eingetroffen.',
  estimate: {
    deliveryStatus: 'DELIVERY_IN_TWO_OR_MORE_DAYS__ESTIMATE_CONFIRMED',
    updatedDeliveryStatus: 'DELIVERY_IN_TWO_OR_MORE_DAYS_ESTIMATE_CONFIRMED',
  },
};

describe('glsSendung', () => {
  it('Track-ID statt UUID, Prognose morgen', () => {
    const g = glsSendung(leifheit);
    expect(g.id).to.equal('ZMORSQBI');
    expect(g.glsId).to.equal(leifheit.id);
    expect(g.nummern).to.deep.equal(['ZMORSQBI', '71022925630']);
    expect(g.status).to.equal('Das Paket wurde durch GLS übernommen. Zustellung morgen');
  });
  it('gleiche Nummern nur einmal, ohne Prognose bei 2+ Tagen', () => {
    const g = glsSendung(vileda);
    expect(g.id).to.equal('42030610626');
    expect(g.nummern).to.deep.equal(['42030610626']);
    expect(g.status).to.equal('Das Paket ist im Paketzentrum eingetroffen.');
  });
  it('zugestellt: keine Prognose; ohne Nummern bleibt UUID', () => {
    expect(glsSendung({ ...leifheit, deliveredAt: '2026-11-04 10:00:00' }).status).to.equal(
      'Das Paket wurde durch GLS übernommen.',
    );
    expect(glsSendung({ id: 'uuid-1' }).id).to.equal('uuid-1');
  });
});

describe('glsAnAmazonAngleichen', () => {
  const amzEintrag = (id) => ({ id, source: 'AMZ', delivery_status: 30 });
  const glsEintrag = (roh) => {
    const g = glsSendung(roh);
    return { id: g.id, glsId: g.glsId, nummern: g.nummern, source: 'GLS', delivery_status: 30 };
  };

  it('Track-ID gleich und Paketnummer + Prüfziffer', () => {
    const a1 = amzEintrag('ZMORSQBI');
    const a2 = amzEintrag('420306106265');
    const g1 = glsEintrag(leifheit);
    const g2 = glsEintrag(vileda);
    const alle = [a1, a2, g1, g2];
    const nachId = { ZMORSQBI: a1, 420306106265: a2, 42030610626: g2 };
    expect(glsAnAmazonAngleichen(alle, nachId)).to.equal(1);
    expect(g1.id).to.equal('ZMORSQBI');
    expect(g2.id).to.equal('420306106265');
    // allProviderObjects bleibt unverändert (sonst Absturz in der Benachrichtigungsschleife, 03.11.2026)
    expect(nachId['42030610626']).to.equal(g2);
    expect(Object.keys(nachId)).to.have.length(3);
    // zusammen mit ohneDoppelte: jede Sendung zählt einmal
    const r = ohneDoppelte([a1, a2, g1, g2], [], alle, ds);
    expect(r.notDelivered).to.have.length(2);
  });
  it('keine Treffer bei anderer Länge oder ohne Amazon', () => {
    const g = glsEintrag(vileda);
    expect(glsAnAmazonAngleichen([amzEintrag('4203061062612'), g])).to.equal(0);
    expect(g.id).to.equal('42030610626');
    expect(glsAnAmazonAngleichen([g])).to.equal(0);
  });
});

describe('GLS-Status mit einem Unterstrich', () => {
  it('DELIVERY_IN_TWO_OR_MORE_DAYS_ESTIMATE_CONFIRMED = unterwegs', () => {
    expect(classifyGlsDeliveryStatus({ ...vileda, latestStatusText: '' }, ds)).to.equal(ds.IN_TRANSIT);
  });
});
