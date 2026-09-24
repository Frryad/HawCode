'use strict';

const secret = require('./secret');

const UPDATE_TIMEOUT_MS = 8000;
// However often anything asks, the provider is never called more than once a
// minute. A flapping Wi-Fi adapter must not turn into a request storm.
const MIN_UPDATE_GAP_MS = 60 * 1000;
// How often to re-check the public address. Twenty bytes out, forty back.
const ADDRESS_POLL_MS = 2 * 60 * 1000;
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
// A wrong token will never start working. Stop rather than hammer the provider.
const MAX_PERMANENT_ATTEMPTS = 3;

/** Strip anything the user may have pasted around a DuckDNS label. */
function duckLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.duckdns\.org\.?$/, '')
    .replace(/[^a-z0-9-]/g, '');
}

function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/** Strip a scheme, path or trailing dot from a full hostname. */
function plainHost(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

// The dyndns2 answers No-IP, Dynu and most others share. The first word is the
// verdict; anything marked permanent will not change on a retry.
const DYNDNS2 = {
  good: { ok: true },
  nochg: { ok: true },
  nohost: { ok: false, permanent: true, error: 'That hostname does not exist in this account.' },
  badauth: { ok: false, permanent: true, error: 'Wrong username or password.' },
  badagent: { ok: false, permanent: true, error: 'The provider rejected this update client.' },
  '!donator': { ok: false, permanent: true, error: 'This needs a paid account at the provider.' },
  abuse: { ok: false, permanent: true, error: 'The provider blocked this hostname for too many updates.' },
  notfqdn: { ok: false, permanent: true, error: 'The hostname must be a full name, like me.ddns.net.' },
  numhost: { ok: false, permanent: true, error: 'Too many hostnames in one update.' },
  dnserr: { ok: false, permanent: false, error: 'The provider had a DNS error. Retrying.' },
  911: { ok: false, permanent: false, error: 'The provider is having problems. Retrying later.' }
};

function parseDyndns2(body, response) {
  const reply = String(body || '').trim().slice(0, 200);
  const word = (reply.split(/\s+/)[0] || '').toLowerCase();
  const known = DYNDNS2[word];
  if (known) return { ...known, reply };
  const status = response ? response.status : 0;
  if (status === 401) return { ...DYNDNS2.badauth, reply };
  return {
    ok: false,
    permanent: status >= 400 && status < 500,
    reply,
    error: `Unexpected answer from the provider: ${reply || `HTTP ${status}`}`
  };
}

/** A dyndns2 provider: Basic auth over HTTPS, hostname and optional myip in the query. */
function dyndns2Provider({ id, label, hint, endpoint, suffix }) {
  return {
    id,
    label,
    hint,
    needsUsername: true,
    needsPublicIp: () => false,
    fqdn: (config) => plainHost(config.hostname),
    validate: (config) => {
      const host = plainHost(config.hostname);
      if (!host || !host.includes('.')) return `Enter the full hostname, like me${suffix}.`;
      if (!config.username) return `Enter your ${label} username.`;
      if (!config.token) return `Enter your ${label} password.`;
      return null;
    },
    // No myip unless one is passed: like DuckDNS, the provider then records the
    // address the request came from.
    buildUrl: (config) => `${endpoint}?hostname=${encodeURIComponent(plainHost(config.hostname))}`
      + (config.publicIp ? `&myip=${encodeURIComponent(config.publicIp)}` : ''),
    headers: (config) => ({ authorization: basicAuth(config.username, config.token) }),
    interpret: parseDyndns2
  };
}

/**
 * The providers HawCode can point a name with.
 *
 * Each is one plain HTTPS GET, which is why there is no dependency here and why
 * "any other provider" is a field rather than a feature request.
 */
const PROVIDERS = {
  duckdns: {
    id: 'duckdns',
    label: 'DuckDNS',
    hint: 'Free, no expiry. Sign in at duckdns.org, create a name, and copy the token '
      + 'shown at the top of the page.',
    needsPublicIp: () => false,
    fqdn: (config) => {
      const label = duckLabel(config.hostname);
      return label ? `${label}.duckdns.org` : '';
    },
    validate: (config) => {
      if (!duckLabel(config.hostname)) return 'Enter the DuckDNS name you created.';
      if (!config.token) return 'Enter the token from your DuckDNS account page.';
      return null;
    },
    buildUrl: (config) => 'https://www.duckdns.org/update'
      + `?domains=${encodeURIComponent(duckLabel(config.hostname))}`
      // No &ip= on purpose: DuckDNS then records the address it sees the request
      // arrive from, which is exactly the address a visitor would reach, and saves
      // this computer having to work out its own public address at all.
      + `&token=${encodeURIComponent(config.token)}`,
    // DuckDNS answers HTTP 200 whether it worked or not, so response.ok means
    // nothing here. The body is the only signal: 'OK' or 'KO'.
    interpret: (body) => {
      const reply = String(body || '').trim();
      if (reply === 'OK') return { ok: true, reply };
      return {
        ok: false,
        permanent: true,
        reply: reply || 'KO',
        error: `DuckDNS replied "${reply || 'KO'}". The subdomain must first be added on duckdns.org `
          + 'under the same account as the token (sign in, type the name, press "add domain"). '
          + 'Enter only the name, without .duckdns.org, and copy the token again.'
      };
    }
  },

  noip: dyndns2Provider({
    id: 'noip',
    label: 'No-IP',
    hint: 'Free; confirm the name once a month by e-mail. Create a hostname at noip.com, '
      + 'then enter it with your No-IP username and password.',
    endpoint: 'https://dynupdate.no-ip.com/nic/update',
    suffix: '.ddns.net'
  }),

  dynu: dyndns2Provider({
    id: 'dynu',
    label: 'Dynu',
    hint: 'Free, no expiry. Add a hostname at dynu.com, then enter it with your Dynu '
      + 'username and password (or IP update password).',
    endpoint: 'https://api.dynu.com/nic/update',
    suffix: '.dynu.net'
  }),

  custom: {
    id: 'custom',
    label: 'Custom update URL',
    hint: 'Paste the update address your provider gave you. <HOST> and <IP> are filled in '
      + 'for you. Must be https.',
    needsPublicIp: (config) => String(config.customUrl || '').includes('<IP>'),
    fqdn: (config) => String(config.hostname || '').trim().toLowerCase().replace(/^https?:\/\//, ''),
    validate: (config) => {
      const url = String(config.customUrl || '').trim();
      if (!url) return 'Paste the update address your provider gave you.';
      let parsed;
      try {
        parsed = new URL(url.replace(/<HOST>/g, 'example.com').replace(/<IP>/g, '203.0.113.1'));
      } catch {
        return 'That does not look like a web address.';
      }
      // An http: update URL puts the credentials it carries on the wire in clear.
      if (parsed.protocol !== 'https:') return 'The update address must start with https://.';
      if (!config.hostname) return 'Enter the name this points at, so it can be checked.';
      return null;
    },
    buildUrl: (config) => String(config.customUrl)
      .replace(/<HOST>/g, encodeURIComponent(String(config.hostname || '')))
      .replace(/<IP>/g, encodeURIComponent(String(config.publicIp || ''))),
    interpret: (body, response) => {
      const reply = String(body || '').trim().slice(0, 200);
      if (response && response.ok) return { ok: true, reply };
      const status = response ? response.status : 0;
      return {
        ok: false,
        // 4xx is the provider saying no; retrying will not change its mind.
        permanent: status >= 400 && status < 500,
        reply,
        error: `The provider answered HTTP ${status}${reply ? ` — ${reply}` : ''}.`
      };
    }
  }
};

/**
 * Keeps a free DDNS name pointed at this computer.
 *
 * The name is the only thing that leaves the machine, along with the address the
 * provider sees the request come from. Nothing proxies the workspace: a visitor
 * resolving the name connects straight to this computer, which is the whole
 * difference between this and the tunnel it replaces.
 */
function createDdns({ settings, reachability, appVersion, onStatus } = {}) {
  let keepalive = null;
  let addressPoll = null;
  let running = false;
  let inFlight = false;
  let dirty = false;
  let failures = 0;
  let permanentAttempts = 0;

  const state = {
    lastAt: null,
    lastIp: null,
    lastReply: null,
    lastError: null,
    parked: false,
    publicIp: null,
    verdict: null,
    // The last Test button result. Kept apart from lastIp so a test never makes
    // the app hand out a name that is not actually being kept up to date.
    lastTest: null,
    // What public DNS says the name points at, checked after each update.
    resolved: null
  };

  /** The saved configuration, with the token decrypted for use here only. */
  function config() {
    const provider = settings.get('ddnsProvider');
    return {
      enabled: Boolean(settings.get('ddnsEnabled')),
      provider: provider && PROVIDERS[provider] ? provider : null,
      hostname: settings.get('ddnsHostname') || '',
      username: settings.get('ddnsUsername') || '',
      token: secret.decrypt(settings.get('ddnsTokenEnc')),
      customUrl: settings.get('ddnsCustomUrl') || '',
      intervalMinutes: Number(settings.get('ddnsIntervalMinutes')) || 15
    };
  }

  function fqdn(from) {
    const current = from || config();
    const provider = PROVIDERS[current.provider];
    return provider ? provider.fqdn(current) : '';
  }

  function status() {
    const current = config();
    return {
      enabled: current.enabled,
      provider: current.provider,
      providerLabel: current.provider ? PROVIDERS[current.provider].label : null,
      hostname: current.hostname,
      fqdn: fqdn(current),
      running,
      intervalMinutes: current.intervalMinutes,
      ...state,
      nextAt: running && state.lastAt
        ? state.lastAt + (current.intervalMinutes * 60 * 1000)
        : null
    };
  }

  function report() {
    if (onStatus) onStatus(status());
  }

  /** Whether this is configured well enough to be worth starting. */
  function configured(from) {
    const current = from || config();
    if (!current.enabled) {
      return { ok: false, reason: 'Internet name is switched off in Settings.' };
    }
    if (!current.provider) {
      return { ok: false, reason: 'Choose a provider for your internet name in Settings.' };
    }
    const problem = PROVIDERS[current.provider].validate(current);
    if (problem) return { ok: false, reason: problem };
    if (!fqdn(current)) return { ok: false, reason: 'That name could not be read.' };
    return { ok: true };
  }

  /** One real update against the provider. */
  async function callProvider(current, publicIp) {
    const provider = PROVIDERS[current.provider];
    const url = provider.buildUrl({ ...current, publicIp });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': `HawCode/${appVersion || '0'}`,
          ...(provider.headers ? provider.headers({ ...current, publicIp }) : {})
        }
      });
      const body = await response.text();
      return provider.interpret(body, response);
    } catch (error) {
      return {
        ok: false,
        permanent: false,
        error: error.name === 'AbortError'
          ? 'The provider did not answer in time.'
          : `Could not reach the provider: ${error.message}`
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Update once, honouring the rate limit.
   *
   * `force` skips the "nothing changed recently" shortcut but never the minimum
   * gap: a caller in a hurry still waits its turn rather than queueing a second
   * request behind the first.
   */
  async function update({ force = false, reason = 'scheduled' } = {}) {
    const current = config();
    const ready = configured(current);
    if (!ready.ok) {
      state.lastError = ready.reason;
      report();
      return { ok: false, error: ready.reason };
    }
    if (state.parked && !force) {
      return { ok: false, error: state.lastError, parked: true };
    }
    if (inFlight) {
      dirty = true;
      return { ok: false, error: 'An update is already running.', queued: true };
    }

    const provider = PROVIDERS[current.provider];
    let publicIp = state.publicIp;
    if (provider.needsPublicIp(current) || !publicIp) {
      publicIp = (reachability ? await reachability.publicAddress() : null) || publicIp;
    }
    if (publicIp && publicIp !== state.publicIp) {
      state.publicIp = publicIp;
      if (reachability) {
        state.verdict = reachability.classify({ reflexive: publicIp, local: null }).verdict;
      }
    }
    if (provider.needsPublicIp(current) && !publicIp) {
      state.lastError = 'This computer could not work out its public address.';
      report();
      return { ok: false, error: state.lastError };
    }

    const sinceLast = state.lastAt ? Date.now() - state.lastAt : Infinity;
    const addressUnchanged = Boolean(state.lastIp && publicIp && state.lastIp === publicIp);
    const withinInterval = sinceLast < current.intervalMinutes * 60 * 1000;
    if (!force && addressUnchanged && withinInterval) {
      return { ok: true, skipped: true, fqdn: fqdn(current), ip: publicIp };
    }
    if (sinceLast < MIN_UPDATE_GAP_MS) {
      // Collapse everything asking during the gap into one call at its boundary.
      dirty = true;
      return { ok: true, deferred: true, fqdn: fqdn(current), ip: publicIp };
    }

    inFlight = true;
    try {
      const outcome = await callProvider(current, publicIp);
      state.lastAt = Date.now();
      state.lastReply = outcome.reply || null;

      if (outcome.ok) {
        state.lastIp = publicIp || state.lastIp;
        state.lastError = null;
        failures = 0;
        permanentAttempts = 0;
        state.parked = false;
        report();
        scheduleDnsCheck();
        return { ok: true, fqdn: fqdn(current), ip: state.lastIp, reason };
      }

      state.lastError = outcome.error;
      if (outcome.permanent) {
        permanentAttempts += 1;
        if (permanentAttempts >= MAX_PERMANENT_ATTEMPTS) {
          state.parked = true;
          stopTimers();
        }
      } else {
        failures += 1;
      }
      report();
      return { ok: false, error: outcome.error, parked: state.parked };
    } finally {
      inFlight = false;
      if (dirty && !state.parked) {
        dirty = false;
        // Let the gap elapse, then catch up on whatever asked while we were busy.
        setTimeout(() => { update({ reason: 'catch-up' }).catch(() => {}); }, MIN_UPDATE_GAP_MS);
      }
    }
  }

  function currentDelay() {
    if (!failures) return (config().intervalMinutes || 15) * 60 * 1000;
    return BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  }

  function scheduleKeepalive() {
    if (keepalive) clearTimeout(keepalive);
    if (!running) return;
    keepalive = setTimeout(async () => {
      await update({ reason: 'keepalive' }).catch(() => {});
      scheduleKeepalive();
    }, currentDelay());
    if (keepalive.unref) keepalive.unref();
  }

  let dnsCheck = null;
  const DNS_CHECK_DELAYS_MS = [20 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];

  /**
   * Ask a public resolver whether the name really points here now.
   *
   * A provider can say OK and still serve the old address for a while, and a
   * name pointed somewhere else is the commonest reason a friend's browser times
   * out. Retries on a short ladder and reports a visible error after ~8 minutes.
   */
  function scheduleDnsCheck(step = 0) {
    if (dnsCheck) clearTimeout(dnsCheck);
    dnsCheck = null;
    if (!reachability || !reachability.resolvePublic) return;
    dnsCheck = setTimeout(async () => {
      dnsCheck = null;
      const name = fqdn();
      const expected = state.lastIp || state.publicIp;
      if (!name || !expected) return;
      const resolved = await reachability.resolvePublic(name).catch(() => null);
      const addresses = (resolved && resolved.addresses) || [];
      const pointsHere = addresses.includes(expected);
      state.resolved = { addresses, pointsHere, at: Date.now() };
      if (!pointsHere && step + 1 < DNS_CHECK_DELAYS_MS.length) {
        scheduleDnsCheck(step + 1);
      } else if (!pointsHere) {
        state.lastError = `${name} still points at ${addresses.join(', ') || 'nothing'}, `
          + `not this connection (${expected}). Check the name and token, then press Update now.`;
      } else if (state.lastError && state.lastError.includes('still points at')) {
        state.lastError = null;
      }
      report();
    }, DNS_CHECK_DELAYS_MS[step]);
    if (dnsCheck.unref) dnsCheck.unref();
  }

  function stopTimers() {
    if (dnsCheck) {
      clearTimeout(dnsCheck);
      dnsCheck = null;
    }
    if (keepalive) {
      clearTimeout(keepalive);
      keepalive = null;
    }
    if (addressPoll) {
      clearInterval(addressPoll);
      addressPoll = null;
    }
  }

  return {
    /** Point the name at this computer and keep it pointed. */
    async start() {
      const current = config();
      const ready = configured(current);
      if (!ready.ok) return { ok: false, error: ready.reason };

      running = true;
      state.parked = false;
      permanentAttempts = 0;
      failures = 0;

      const first = await update({ force: true, reason: 'start' });
      if (!first.ok) {
        running = false;
        stopTimers();
        report();
        return first;
      }

      scheduleKeepalive();
      // Watch the public address between keepalives, so a provider-side change is
      // noticed in a couple of minutes rather than a quarter of an hour.
      addressPoll = setInterval(async () => {
        if (!reachability || state.parked) return;
        const seen = await reachability.publicAddress();
        if (seen && seen !== state.lastIp) {
          state.publicIp = seen;
          await update({ reason: 'public-address-changed' }).catch(() => {});
        }
      }, ADDRESS_POLL_MS);
      if (addressPoll.unref) addressPoll.unref();

      report();
      return { ok: true, fqdn: fqdn(current), ip: state.lastIp };
    },

    /**
     * Stop updating. Deliberately leaves the name pointed here: DuckDNS has no
     * delete, and repointing on every stop churns the record for no benefit. The
     * name resolves to a computer whose server is closed, which is the safe
     * outcome — `unpoint` is there for anyone who wants it dark.
     */
    async stop() {
      running = false;
      stopTimers();
      dirty = false;
      report();
    },

    /** Force an update now, for an IP change or a Try again button. */
    refresh(reason = 'manual') {
      return update({ force: true, reason });
    },

    /** Try an unsaved configuration, without starting anything. */
    async test(candidate = {}) {
      const merged = {
        // Testing is how someone checks a name before switching it on.
        enabled: true,
        provider: candidate.provider || config().provider,
        hostname: candidate.hostname != null ? candidate.hostname : config().hostname,
        username: candidate.username != null ? candidate.username : config().username,
        // An empty token in the candidate means "keep the saved one".
        token: candidate.token || config().token,
        customUrl: candidate.customUrl != null ? candidate.customUrl : config().customUrl,
        intervalMinutes: config().intervalMinutes
      };
      const ready = configured(merged);
      if (!ready.ok) return { ok: false, error: ready.reason };

      const provider = PROVIDERS[merged.provider];
      // Looked up whenever possible for the result shown, but only sent to the
      // provider when it asks for one.
      const publicIp = reachability ? await reachability.publicAddress() : null;
      if (provider.needsPublicIp(merged) && !publicIp) {
        return { ok: false, error: 'This computer could not work out its public address.' };
      }
      const outcome = await callProvider(merged, provider.needsPublicIp(merged) ? publicIp : null);
      state.lastTest = { ok: outcome.ok, at: Date.now(), ip: publicIp, reply: outcome.reply || null };
      report();

      const name = fqdn(merged);
      const result = {
        ok: outcome.ok,
        fqdn: name,
        publicIp,
        ip: publicIp || state.lastIp,
        reply: outcome.reply || null,
        error: outcome.error || null
      };
      if (publicIp && reachability) {
        Object.assign(result, reachability.classify({ reflexive: publicIp, local: null }));
      }
      // Ask a public resolver what it sees, which is the only outside opinion
      // available without a second internet connection.
      if (outcome.ok && reachability) {
        result.resolved = await reachability.resolvePublic(name);
        result.pointsHere = Boolean(publicIp && result.resolved.addresses.includes(publicIp));
      }
      return result;
    },

    /** Send the name to an address that answers nothing. */
    async unpoint() {
      // Clearing the name must work after the switch is turned off too.
      const current = { ...config(), enabled: true };
      const ready = configured(current);
      if (!ready.ok) return { ok: false, error: ready.reason };
      if (current.provider !== 'duckdns') {
        return { ok: false, error: 'Only a DuckDNS name can be cleared from here.' };
      }
      await this.stop();
      const url = `${PROVIDERS.duckdns.buildUrl(current)}&clear=true`;
      try {
        const response = await fetch(url, { headers: { 'user-agent': `HawCode/${appVersion || '0'}` } });
        const body = (await response.text()).trim();
        state.lastIp = null;
        state.lastReply = body;
        report();
        return body === 'OK'
          ? { ok: true }
          : { ok: false, error: `DuckDNS replied "${body || 'KO'}".` };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    configured,
    fqdn,
    isRunning: () => running,
    get status() {
      return status();
    }
  };
}

module.exports = { createDdns, PROVIDERS, duckLabel, parseDyndns2 };
