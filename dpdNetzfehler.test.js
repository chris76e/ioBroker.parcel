'use strict';
// @ts-nocheck

// DPD: Netzwerkaussetzer bei der Anmeldung melden nicht mehr dauerhaft ab (Fork chris76e)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const dpdLib = require('./lib/dpdLogin');

const OK_LOGIN =
  '<soap:Envelope><soap:Body><getUserLoginResponse><Ack>true</Ack>' +
  '<SessionToken>NEU</SessionToken><cloudUserID>42</cloudUserID></getUserLoginResponse></soap:Body></soap:Envelope>';
const OK_ANON = '<soap:Envelope><soap:Body><r><SessionToken>ANON</SessionToken></r></soap:Body></soap:Envelope>';
const ABGELEHNT =
  '<soap:Envelope><soap:Body><r><Ack>false</Ack><ErrorCode>LOGIN_FAILED</ErrorCode><ErrorMsg>falsch</ErrorMsg></r></soap:Body></soap:Envelope>';

function econnreset() {
  const e = new Error('read ECONNRESET');
  e.code = 'ECONNRESET';
  return e;
}
const stille = { info() {}, debug() {}, warn() {}, error() {} };

// requestClient, der nacheinander die gegebenen Antworten (oder Fehler) liefert
function client(antworten) {
  return async () => {
    const a = antworten.shift();
    if (a instanceof Error) throw a;
    return { status: 200, data: a };
  };
}

describe('DPD-Login (lib): Netzwerkfehler vs. Ablehnung', () => {
  it('ECONNRESET in Stufe 1 → netzfehler', async () => {
    const r = await dpdLib.loginDPD({ requestClient: client([econnreset()]), username: 'u', password: 'p', log: stille });
    assert.deepEqual(r, { netzfehler: true, meldung: 'ECONNRESET' });
  });
  it('ECONNRESET in Stufe 2 → netzfehler', async () => {
    const r = await dpdLib.loginDPD({ requestClient: client([OK_ANON, econnreset()]), username: 'u', password: 'p', log: stille });
    assert.equal(r.netzfehler, true);
  });
  it('HTTP 503 (Fehler mit response) → netzfehler, HTTP 401 → null', async () => {
    const e503 = Object.assign(new Error('503'), { response: { status: 503 } });
    const e401 = Object.assign(new Error('401'), { response: { status: 401 } });
    assert.equal((await dpdLib.loginDPD({ requestClient: client([e503]), username: 'u', password: 'p', log: stille })).netzfehler, true);
    assert.equal(await dpdLib.loginDPD({ requestClient: client([e401]), username: 'u', password: 'p', log: stille }), null);
  });
  it('Ack=false → null (echte Ablehnung)', async () => {
    const r = await dpdLib.loginDPD({ requestClient: client([OK_ANON, ABGELEHNT]), username: 'u', password: 'p', log: stille });
    assert.equal(r, null);
  });
  it('Erfolg → Session', async () => {
    const r = await dpdLib.loginDPD({ requestClient: client([OK_ANON, OK_LOGIN]), username: 'u', password: 'p', log: stille });
    assert.deepEqual(r, { SessionToken: 'NEU', cloudUserID: 42 });
  });
});

// main.js im vm laden, lib/dpdLogin mit steuerbarer Attrappe
let loginAntworten = [];
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const context = {
  require: (id) => {
    if (id === './lib/chris76e') return require('./lib/chris76e');
    if (id === 'crypto') return require('node:crypto');
    if (id === './lib/dpdLogin') {
      return {
        loginDPD: async () => loginAntworten.shift(),
        fetchDPDParcels: async () => ({ status: 'ok', sessionToken: null, data: { sendungen: [] } }),
      };
    }
    return { Adapter: class {}, default: {} };
  },
  module: { exports: {} },
};
vm.runInNewContext(source + '\nmodule.exports = Parcel.prototype;', context);
const prototype = context.module.exports;

function adapter(sessions) {
  const states = {};
  const logs = [];
  const a = Object.assign(Object.create(prototype), {
    config: { dpdActive: true, dpdusername: 'u', dpdpassword: 'p', interval: 30 },
    sessions,
    log: { debug() {}, info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    setStateAsync: async (id, v) => {
      states[id] = v;
    },
    setState: (id, v) => {
      states[id] = v;
    },
    setObjectNotExistsAsync: async () => {},
  });
  return { a, states, logs };
}

describe('DPD im Adapter: Netzwerkaussetzer meldet nicht ab', () => {
  it('Live-Fall 11.11.: ECONNRESET beim 29-min-Relogin → alte Session bleibt', async () => {
    const alt = { SessionToken: 'ALT', cloudUserID: 42 };
    const { a, states } = adapter({ dpd: alt });
    states['auth.dpdSession'] = JSON.stringify(alt);
    loginAntworten = [{ netzfehler: true, meldung: 'ECONNRESET' }];
    await a.refreshToken();
    assert.equal(a.sessions.dpd, alt);
    assert.equal(states['auth.dpdSession'], JSON.stringify(alt)); // nicht geleert
  });

  it('ohne Session (Netzfehler beim Start) holt der nächste refreshToken die Anmeldung nach', async () => {
    const { a, states, logs } = adapter({});
    loginAntworten = [{ netzfehler: true, meldung: 'ECONNRESET' }, { SessionToken: 'NEU', cloudUserID: 42 }];
    await a.loginDPD();
    assert.equal(a.sessions.dpd, undefined);
    await a.refreshToken();
    assert.deepEqual(a.sessions.dpd, { SessionToken: 'NEU', cloudUserID: 42 });
    assert.ok(states['auth.dpdSession'].includes('NEU'));
    assert.ok(logs.includes('Relogin to DPD successful (nach Netzwerkaussetzer)'));
  });

  it('echte Ablehnung → abgemeldet, kein automatischer Wiederholversuch (Konto-Sperre vermeiden)', async () => {
    const { a, states } = adapter({ dpd: { SessionToken: 'ALT', cloudUserID: 42 } });
    loginAntworten = [null];
    await a.refreshToken();
    assert.equal(a.sessions.dpd, undefined);
    assert.equal(states['auth.dpdSession'], '');
    loginAntworten = [{ SessionToken: 'X', cloudUserID: 1 }];
    await a.refreshToken(); // keine Sessions, DPD gesperrt → nichts
    assert.equal(a.sessions.dpd, undefined);
    assert.equal(loginAntworten.length, 1);
    // Knopf/Neustart meldet wieder an und hebt die Sperre auf
    assert.equal(await a.loginDPD(), true);
    assert.equal(a.dpdAbgelehnt, false);
  });

  it('Netzfehler bei loginDPD → false, vorhandene Session und State bleiben', async () => {
    const alt = { SessionToken: 'ALT', cloudUserID: 42 };
    const { a, states } = adapter({ dpd: alt });
    states['auth.dpdSession'] = 'x';
    loginAntworten = [{ netzfehler: true, meldung: 'ECONNRESET' }];
    assert.equal(await a.loginDPD(true), false);
    assert.equal(a.sessions.dpd, alt);
    assert.equal(states['auth.dpdSession'], 'x');
    assert.equal(a.dpdAbgelehnt, undefined);
  });
});
