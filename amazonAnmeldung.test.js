'use strict';
// @ts-nocheck

// Amazon-Anmeldung und Dienst-Übersicht (Fork chris76e)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const context = {
  require: (id) => {
    if (id === './lib/chris76e') return require('./lib/chris76e');
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

describe('Amazon-Anmeldung', () => {
  const liste = [{ desc: 'x', url: '/p?orderId=1' }];
  it('meldet vor jedem Abruf an (Amazon verlangt das nach ca. 30 min)', async () => {
    const a = adapter([liste]);
    await a.getAmazonPackages();
    a.amzAngemeldetUm = Date.now() - 30 * 60 * 1000;
    await a.getAmazonPackages();
    assert.equal(a.logins, 2);
  });
  it('Start/Knopf meldet an, der direkt folgende Abruf nicht noch einmal', async () => {
    const a = adapter([liste]);
    a.config = { amzActive: true, amzusername: 'u', amzpassword: 'p' };
    await a.loginProvider('amz');
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
  });
  it('Bestellseite verlangt trotzdem Anmeldung -> anmelden, zweiter Abruf liefert', async () => {
    const a = adapter(['anmelden', liste]);
    a.amzAngemeldetUm = Date.now();
    await a.getAmazonPackages();
    assert.equal(a.logins, 1);
    assert.equal(a.abrufe, 2);
    assert.ok(a.geschrieben);
  });
});

describe('Dienst-Übersicht nach Start/Neuanmeldung', () => {
  it('nimmt nur eingerichtete Dienste und zählt Sendungen je Quelle', () => {
    const a = Object.create(prototype);
    const zeilen = [];
    a.log = { info: (m) => zeilen.push(m), debug() {} };
    a.config = { amzActive: true, amzusername: 'u', amzpassword: 'p', dhlActive: true, dpdActive: true, dpdusername: 'u', dpdpassword: 'p', glsActive: false };
    a.sessions = { amz: true, dhl: {}, dpd: true };
    a.abrufOk = new Set(['amz', 'dhl']);
    a.briefeAbruf = 'ok';
    a.mergedJson = [{ source: 'AMZ' }, { source: 'AMZ' }, { source: 'DHL' }];
    a.dienstStandLoggen('nach dem Start');
    assert.equal(
      zeilen[0],
      'Dienste nach dem Start: Amazon ✓ angemeldet, 2 Sendungen · DHL ✓ angemeldet, 1 Sendung, Briefankündigung ✓ · DPD ✗ angemeldet, aber Abruf fehlgeschlagen',
    );
  });
});
