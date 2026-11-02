'use strict';
// @ts-nocheck

// Neuanmeldung eines Dienstes ruft nur diesen Dienst ab (Fork chris76e)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { mergeLogFuer } = require('./lib/chris76e');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const context = {
  require: (id) => (id === './lib/chris76e' ? require('./lib/chris76e') : id === 'crypto' ? require('node:crypto') : { Adapter: class {}, default: {} }),
  module: { exports: {} },
};
vm.runInNewContext(source + '\nmodule.exports = Parcel.prototype;', context);
const prototype = context.module.exports;

function fixture() {
  const states = {};
  const z = { amz: 0, dpd: 0 };
  let dpdDaten = { sendungen: [{ id: 'D1', name: 'DPD alt', status: 'unterwegs', direction: 'receive' }] };
  const a = Object.assign(Object.create(prototype), {
    config: {},
    sessions: { amz: true, dpd: true },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    logAxiosError: (_l, e) => {
      throw e;
    },
    sleep: async () => {},
    setStateAsync: async (id, v) => {
      states[id] = v;
    },
    setState: (id, v) => {
      states[id] = v;
    },
    ignoredPath: [],
    json2iob: { parse() {} },
    cleanupProvider: async () => {},
    delivery_status: { ERROR: -1, UNKNOWN: 5, REGISTERED: 10, IN_PREPARATION: 20, IN_TRANSIT: 30, OUT_FOR_DELIVERY: 40, DELIVERED: 1 },
    deliveryStatusCheck: () => 30,
    getAmazonPackages: async function () {
      z.amz++;
      await this.mergeProviderJson('amz', { sendungen: [{ id: 'A1', name: 'Regal', status: 'Bestellt', detailedState: {} }] });
    },
    fetchDPDParcels: async () => {
      z.dpd++;
      return dpdDaten;
    },
  });
  return { a, states, z, setDpd: (d) => (dpdDaten = d) };
}

describe('Neuanmeldung: nur der eine Dienst wird abgerufen', () => {
  it('voller Abruf, dann nur DPD: Amazon nicht erneut abgerufen, aber weiter in allen Listen', async () => {
    const { a, states, z, setDpd } = fixture();
    await a.updateProvider();
    assert.deepEqual(z, { amz: 1, dpd: 1 });
    assert.deepEqual(JSON.parse(states.allProviderJson).map((s) => s.id), ['A1', 'D1']);

    setDpd({ sendungen: [{ id: 'D2', name: 'DPD neu', status: 'unterwegs', direction: 'receive' }] });
    await a.updateProvider('dpd');
    assert.deepEqual(z, { amz: 1, dpd: 2 });
    assert.deepEqual(JSON.parse(states.allProviderJson).map((s) => s.id), ['A1', 'D2']);
    assert.equal(states.notDeliveredCount, 2);
    assert.deepEqual([...a.abrufOk], ['dpd']);

    // nächster regulärer Abruf holt wieder alle
    await a.updateProvider();
    assert.deepEqual(z, { amz: 2, dpd: 3 });
    assert.deepEqual(JSON.parse(states.allProviderJson).map((s) => s.id), ['A1', 'D2']);
  });

  it('Knopf ruft updateProvider nur für diesen Dienst auf (vorher voller Abruf vorhanden)', async () => {
    const { a } = fixture();
    const aufrufe = [];
    a.isProviderConfigured = () => true;
    a.clearDPDSession = async () => {};
    a.loginProvider = async (id) => {
      a.sessions[id] = true;
    };
    a.startIntervals = () => {};
    a.reloginRunning = {};
    a.updateProvider = async (id) => aufrufe.push(id);
    a.dienstStandLoggen = () => {};
    a.mergeLog = [{ id: 'amz', data: {} }];
    await a.reloginProvider('dpd');
    a.mergeLog = undefined; // noch nie abgerufen -> voller Abruf
    await a.reloginProvider('dpd');
    assert.deepEqual(aufrufe, ['dpd', undefined]);
  });

  it('mergeLogFuer ersetzt nur die Einträge des Dienstes an ihrer Stelle', () => {
    const alt = [
      { id: 'dhl', data: 1 },
      { id: 'dhl', data: 2 },
      { id: 'amz', data: 3 },
      { id: 'dpd', data: 4 },
    ];
    assert.deepEqual(mergeLogFuer(alt, 'dhl', [{ id: 'dhl', data: 9 }]), [
      { id: 'dhl', data: 9 },
      { id: 'amz', data: 3 },
      { id: 'dpd', data: 4 },
    ]);
    assert.deepEqual(mergeLogFuer(alt.slice(2), 'gls', [{ id: 'gls', data: 5 }]).map((e) => e.id), ['amz', 'dpd', 'gls']);
    assert.deepEqual(mergeLogFuer(alt, 'dpd', []).map((e) => e.id), ['dhl', 'dhl', 'amz']);
  });
});
