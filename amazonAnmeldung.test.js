'use strict';
// @ts-nocheck

// Amazon nicht mehr bei jedem Abruf mit Passwort anmelden (Fork chris76e, 0.3.3-einzeln.6)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const context = {
  require: (id) => {
    if (id === './lib/einzeln') return require('./lib/einzeln');
    return { Adapter: class {}, default: {} };
  },
  module: { exports: {} },
};
vm.runInNewContext(source + '\nmodule.exports = Parcel.prototype;', context);
const prototype = context.module.exports;

/**
 * @param {Array<any>} antworten Rückgaben von getAmazonOrders nacheinander (undefined = Anmeldeseite)
 */
function adapter(antworten) {
  const a = Object.create(prototype);
  a.logins = 0;
  a.abrufe = 0;
  a.geschrieben = null;
  a.log = { debug() {}, info() {}, warn() {}, error() {} };
  a.loginAmz = async () => {
    a.logins++;
  };
  a.getAmazonOrders = async () => {
    const r = antworten[Math.min(a.abrufe, antworten.length - 1)];
    a.abrufe++;
    if (r === 'anmelden') {
      // wie im Adapter: Bestellseite verlangt Anmeldung -> anmelden, undefined zurück
      await a.amzAnmelden('Bestellseite verlangt Anmeldung');
      return undefined;
    }
    return r;
  };
  a.json2iob = { parse() {} };
  a.mergeProviderJson = () => {};
  a.cookieJar = { toJSON: () => ({}) };
  a.setStateAsync = async (id, val) => {
    if (id === 'amazon.json') a.geschrieben = JSON.parse(val);
  };
  a.requestClient = async () => undefined; // Bestelldetails werden hier nicht gebraucht
  return a;
}

describe('Amazon-Anmeldung nur bei Bedarf', () => {
  it('erster Abruf meldet an, folgende Abrufe nutzen die Sitzung', async () => {
    const a = adapter([[]]);
    a.getAmazonOrders = async () => {
      a.abrufe++;
      return [{ desc: 'x', url: '/progress-tracker/package?orderId=1' }];
    };
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    await a.getAmazonPackages();
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    assert.equal(a.abrufe, 3);
  });

  it('nach 8 Stunden wird neu angemeldet', async () => {
    const a = adapter([[{ desc: 'x', url: '/p?orderId=1' }]]);
    a.amzAngemeldetUm = Date.now() - 8 * 3600 * 1000 - 1000;
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    a.amzAngemeldetUm = Date.now() - 7 * 3600 * 1000;
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
  });

  it('Bestellseite verlangt Anmeldung -> einmal anmelden, zweiter Abruf liefert', async () => {
    const a = adapter(['anmelden', [{ desc: 'x', url: '/p?orderId=1' }]]);
    a.amzAngemeldetUm = Date.now() - 3600 * 1000;
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    assert.equal(a.abrufe, 2);
    assert.ok(a.geschrieben);
  });

  it('leere Liste mit alter Sitzung -> neu anmelden und nochmal holen (keine leere Liste schreiben, wenn danach Bestellungen kommen)', async () => {
    const a = adapter([[], [{ desc: 'x', url: '/p?orderId=1' }]]);
    a.amzAngemeldetUm = Date.now() - 3600 * 1000;
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    assert.equal(a.abrufe, 2);
  });

  it('leere Liste direkt nach frischer Anmeldung -> keine zweite Anmeldung', async () => {
    const a = adapter([[]]);
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    assert.equal(a.abrufe, 1);
    assert.deepEqual(a.geschrieben, { sendungen: [] });
  });

  it('Start/Knopf meldet an, der direkt folgende Abruf nicht noch einmal', async () => {
    const a = adapter([[{ desc: 'x', url: '/p?orderId=1' }]]);
    a.config = { amzActive: true, amzusername: 'u', amzpassword: 'p' };
    await a.loginProvider('amz');
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
  });
});
