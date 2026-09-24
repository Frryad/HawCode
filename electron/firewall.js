'use strict';

const fs = require('fs');
const path = require('path');

const { runElevated, isElevated, run, psQuote, powershellCommand } = require('./elevated');

const NETSH = 'netsh';
const SHOW_TIMEOUT_MS = 10000;

const STATE_FILE = 'hawcode-firewall-state.json';

/**
 * Ports that only ever make sense on the local network.
 *
 * This is the list the invariant below is built from. A name server reachable from
 * the internet is an open recursive resolver: it can be used to amplify traffic at
 * a third party, and it will earn the user an abuse complaint from their provider.
 */
const LAN_ONLY_PORTS = new Set([53, 5353, 41234]);

/**
 * The complete set of rules HawCode will ever create.
 *
 * Names are frozen, exact, and ASCII — a .cmd file runs under whatever code page
 * the machine happens to have, and a mangled name is a rule that can never be
 * deleted again. They are also long and specific so they cannot collide with a
 * rule the user wrote. Revert works from this list alone and never from a
 * wildcard, so it can only ever remove rules from here.
 */
const RULES = [
  {
    id: 'web-lan',
    name: 'HawCode workspace (TCP 80 and 3000-3010) local network',
    description: 'Lets other computers on your Wi-Fi or router open the workspace.',
    protocol: 'TCP',
    ports: 'web',
    profile: 'private,domain,public',
    remote: 'localsubnet',
    when: 'always'
  },
  {
    id: 'web-internet',
    name: 'HawCode workspace (TCP 80 and 3000-3010) internet',
    description: 'Lets visitors from the internet reach the workspace, once your router forwards the port.',
    protocol: 'TCP',
    ports: 'web',
    profile: 'private,public,domain',
    remote: 'any',
    when: 'internet'
  },
  {
    id: 'dns-udp',
    name: 'HawCode names (UDP 53) local network only',
    description: 'Answers name lookups for the addresses this computer issues.',
    protocol: 'UDP',
    ports: '53',
    profile: 'private,domain',
    remote: 'localsubnet',
    when: 'always'
  },
  {
    id: 'dns-tcp',
    name: 'HawCode names (TCP 53) local network only',
    description: 'The same name lookups, for answers too large for one packet.',
    protocol: 'TCP',
    ports: '53',
    profile: 'private,domain',
    remote: 'localsubnet',
    when: 'always'
  },
  {
    id: 'mdns',
    name: 'HawCode local name (UDP 5353) local network only',
    description: 'Answers for hawcode.local without anything being configured.',
    protocol: 'UDP',
    ports: '5353',
    profile: 'private,domain',
    remote: 'localsubnet',
    when: 'always'
  },
  {
    id: 'discovery',
    name: 'HawCode discovery (UDP 41234) local network only',
    description: 'Lets HawCode on another computer find this workspace by itself.',
    protocol: 'UDP',
    ports: '41234',
    profile: 'private,domain',
    remote: 'localsubnet',
    when: 'always'
  },
  {
    id: 'extra-port',
    name: 'HawCode workspace extra port internet',
    description: 'An additional port, for a router that will not forward port 80.',
    protocol: 'TCP',
    ports: 'extra',
    profile: 'private,public,domain',
    remote: 'any',
    when: 'extra'
  }
];

const RULE_IDS = new Set(RULES.map((rule) => rule.id));

/**
 * Refuse to build a rule that would expose a local-only service.
 *
 * Deliberately a thrown error rather than a silent correction: if a future change
 * makes this reachable, the build should stop rather than quietly ship an open
 * resolver to every user.
 */
function assertNotPubliclyExposed(rule, ports) {
  const isPublic = rule.profile.includes('public') || rule.remote !== 'localsubnet';
  if (!isPublic) return;
  const exposed = ports.filter((port) => LAN_ONLY_PORTS.has(port));
  if (exposed.length) {
    throw new Error(
      `HawCode refused to open port ${exposed.join(', ')} beyond the local network. `
      + 'A name server reachable from the internet is an open resolver and can be used '
      + 'to attack others.'
    );
  }
}

/** Expand a rule's port spec into netsh's localport syntax plus the numbers in it. */
function resolvePorts(rule, { webPorts, extraPort }) {
  if (rule.ports === 'web') {
    const list = webPorts && webPorts.length ? webPorts : ['80', '3000-3010'];
    const numbers = [];
    for (const entry of list) {
      const [from, to] = String(entry).split('-').map(Number);
      for (let port = from; port <= (to || from); port += 1) numbers.push(port);
    }
    return { spec: list.join(','), numbers };
  }
  if (rule.ports === 'extra') {
    // One port or a comma list (HawCode's extra port and XAMPP's).
    const numbers = String(extraPort).split(',').map(Number).filter((port) => port > 0 && port < 65536);
    return { spec: numbers.join(','), numbers };
  }
  return { spec: rule.ports, numbers: [Number(rule.ports)] };
}

function quote(value) {
  // netsh takes double quotes and nothing inside these values ever contains one.
  return `"${String(value).replace(/"/g, '')}"`;
}

function addCommand(rule, spec, program) {
  const parts = [
    NETSH, 'advfirewall', 'firewall', 'add', 'rule',
    `name=${quote(rule.name)}`,
    'dir=in',
    'action=allow',
    `protocol=${rule.protocol}`,
    `localport=${spec}`,
    `profile=${rule.profile}`,
    `remoteip=${rule.remote}`
  ];
  // Omit program restriction for web/extra port forwarding rules so Apache (XAMPP) or HawCode works on that port
  if (program && rule.ports !== 'web' && rule.ports !== 'extra') {
    parts.push(`program=${quote(program)}`);
  }
  parts.push('enable=yes', `description=${quote('Added by HawCode. Removed when you stop sharing.')}`);
  return parts.join(' ');
}

function deleteCommand(rule) {
  return `${NETSH} advfirewall firewall delete rule name=${quote(rule.name)} dir=in`;
}

/**
 * For execFile, not a .cmd file: the name goes in bare. Node already quotes an
 * argument containing spaces, so quoting it here as well handed netsh a name
 * with literal quote marks in it, which never matched. Every rule then read as
 * missing: the UI said the firewall was blocking, and every share asked for UAC.
 */
function showCommand(rule) {
  return [NETSH, 'advfirewall', 'firewall', 'show', 'rule', `name=${rule.name}`, 'dir=in'];
}

/** Enabled inbound Block rules Windows holds against a program. Readable without elevation. */
function blockRulesScript(program) {
  return `@(Get-NetFirewallApplicationFilter -Program ${psQuote(program)} -ErrorAction SilentlyContinue `
    + '| Get-NetFirewallRule -ErrorAction SilentlyContinue '
    + "| Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' })";
}

// Where XAMPP's Apache lives, for the "already allowed" check below.
const APACHE_PROGRAMS = ['C:\\xampp\\apache\\bin\\httpd.exe'];

/**
 * Which of these programs Windows already lets in, on every active profile,
 * from any address and on any TCP port.
 *
 * Windows' own "allow this app" prompt creates exactly such a rule the first
 * time a program listens. With one in place the program's ports are open even
 * though none of HawCode's named rules exist, and saying "the firewall may
 * block visitors" would send the user chasing a problem they do not have.
 * Printed as one `path=0|1` line per program; readable without elevation.
 */
function allowRulesScript(programs) {
  const list = programs.map(psQuote).join(',');
  return '$active = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.NetworkCategory }); '
    + "if (-not $active.Count) { $active = @('Public') }; "
    + `foreach ($prog in @(${list})) { `
    + '$ok = $false; '
    + '$rules = @(Get-NetFirewallApplicationFilter -Program $prog -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue '
    + "| Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }); "
    + 'foreach ($r in $rules) { '
    + '$pf = $r | Get-NetFirewallPortFilter; $af = $r | Get-NetFirewallAddressFilter; $prof = [string]$r.Profile; '
    + "$protoOk = ($pf.Protocol -eq 'Any' -or $pf.Protocol -eq 'TCP') -and ($pf.LocalPort -eq 'Any'); "
    + "$addrOk = ($af.RemoteAddress -eq 'Any'); "
    + "$profOk = ($prof -eq 'Any') -or (@($active | Where-Object { $prof -notmatch $_ }).Count -eq 0); "
    + 'if ($protoOk -and $addrOk -and $profOk) { $ok = $true } }; '
    + "Write-Output ($prog + '=' + [int]$ok) }";
}

/**
 * Windows Firewall rules for the ports HawCode listens on.
 *
 * Three things shape this module. Rules persist across reboots, so anything left
 * behind by a crash is a hole in the user's machine that nothing in Windows
 * attributes to HawCode — hence the state file and the offer to clean up on the
 * next launch. netsh messages are translated into the system language, so nothing
 * here parses its output and every decision is made on an exit code. And creating
 * a rule twice really does produce two rules, so every add is preceded by a
 * delete.
 */
function createFirewall({ userDataDir, execPath, getWebPorts, getExtraPort, onStatus } = {}) {
  const program = execPath || process.execPath;
  const workDir = path.join(userDataDir, 'firewall');
  const statePath = path.join(userDataDir, STATE_FILE);

  let cached = null;

  function readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (!parsed || !Array.isArray(parsed.ruleIds)) return null;
      // Only ids this build knows about, so a downgrade cannot be asked to delete
      // a rule whose name it no longer has.
      const ruleIds = parsed.ruleIds.filter((id) => RULE_IDS.has(id));
      return ruleIds.length ? { ...parsed, ruleIds } : null;
    } catch {
      return null;
    }
  }

  function writeState(value) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      if (!value) {
        fs.rmSync(statePath, { force: true });
        return;
      }
      fs.writeFileSync(statePath, JSON.stringify(value, null, 2), 'utf-8');
    } catch (error) {
      console.error('HawCode could not record its firewall changes:', error.message);
    }
  }

  /** Programs whose own Allow rule already opens their ports (see allowRulesScript). */
  async function programsAllowed() {
    if (process.platform !== 'win32') return {};
    const programs = [program, ...APACHE_PROGRAMS.filter((file) => fs.existsSync(file))];
    const result = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', allowRulesScript(programs)
    ], 30000);
    const allowed = {};
    for (const line of String(result.stdout).split(/\r?\n/)) {
      const match = /^(.*)=([01])\s*$/.exec(line.trim());
      if (match) allowed[match[1].toLowerCase()] = match[2] === '1';
    }
    return {
      hawcode: Boolean(allowed[program.toLowerCase()]),
      apache: APACHE_PROGRAMS.some((file) => allowed[file.toLowerCase()])
    };
  }

  /**
   * How many inbound Block rules Windows has for this program.
   *
   * Clicking Cancel on Windows' own "allow this app" prompt creates them, and a
   * Block rule beats every Allow rule, so with one in place nothing HawCode adds
   * makes any difference. The commonest reason a firewall that "has the rules"
   * still drops every visitor.
   */
  async function countBlockRules() {
    if (process.platform !== 'win32') return 0;
    const result = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', `${blockRulesScript(program)}.Count`
    ], 20000);
    const count = Number(String(result.stdout).trim());
    return Number.isFinite(count) ? count : 0;
  }

  /** The exact commands, for showing the user before anything runs. */
  function plan({ internet = false, extraPort = null } = {}) {
    const webPorts = getWebPorts ? getWebPorts() : null;
    const resolvedExtra = extraPort != null ? extraPort : (getExtraPort ? getExtraPort() : null);

    const steps = [];
    for (const rule of RULES) {
      if (rule.when === 'internet' && !internet) continue;
      if (rule.when === 'extra' && !(internet && resolvedExtra)) continue;
      const { spec, numbers } = resolvePorts(rule, { webPorts, extraPort: resolvedExtra });
      if (!spec || spec === 'null') continue;
      assertNotPubliclyExposed(rule, numbers);
      steps.push({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        scope: rule.remote === 'localsubnet' ? 'local network only' : 'internet',
        command: addCommand(rule, spec, program),
        revert: deleteCommand(rule)
      });
    }
    // The LAN rule is redundant once the internet rule exists, and two rules for
    // the same ports is just something else to explain.
    if (internet) return { steps: steps.filter((step) => step.id !== 'web-lan'), program };
    return { steps, program };
  }

  /** Which of our rules Windows already has. Readable without elevation. */
  /**
   * The ports each of our TCP rules really opens, by rule name.
   *
   * A rule's name never changes but its ports do (a new extra port, XAMPP on
   * another port), and a rule that exists with yesterday's ports looked
   * "applied" while blocking today's. PowerShell's port filter gives the ports
   * without parsing netsh's translated text.
   */
  async function portsByRule(names) {
    if (process.platform !== 'win32' || !names.length) return {};
    const list = names.map(psQuote).join(',');
    const script = `$o = @{}; foreach ($n in @(${list})) { `
      + '$r = Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Select-Object -First 1; '
      + 'if ($r) { $o[$n] = (@($r | Get-NetFirewallPortFilter | ForEach-Object { $_.LocalPort }) -join \',\') } }; '
      + '$o | ConvertTo-Json -Compress';
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 30000);
    try {
      return JSON.parse(String(result.stdout).trim() || '{}') || {};
    } catch {
      return {};
    }
  }

  function expand(spec) {
    const numbers = new Set();
    for (const part of String(spec || '').split(',')) {
      const [from, to] = part.trim().split('-').map(Number);
      if (!from) continue;
      for (let port = from; port <= (to || from); port += 1) numbers.add(port);
    }
    return numbers;
  }

  async function status({ internet = false, extraPort = null } = {}) {
    const wanted = plan({ internet, extraPort });
    const webPorts = getWebPorts ? getWebPorts() : null;
    const resolvedExtra = extraPort != null ? extraPort : (getExtraPort ? getExtraPort() : null);
    const rules = {};
    for (const step of wanted.steps) {
      const rule = RULES.find((entry) => entry.id === step.id);
      // Exit 0 means the rule exists, 1 means it does not. The text is localised
      // and is never read.
      const result = await run(NETSH, showCommand(rule).slice(1), SHOW_TIMEOUT_MS);
      rules[step.id] = result.code === 0;
    }

    // Existing TCP rules must also open the ports wanted today.
    const tcpRules = RULES.filter((rule) => rule.protocol === 'TCP' && (rule.ports === 'web' || rule.ports === 'extra'));
    const actual = await portsByRule(tcpRules.map((rule) => rule.name));
    const covers = (rule, needed) => Boolean(actual[rule.name])
      && [...needed].every((port) => expand(actual[rule.name]).has(port));
    for (const rule of tcpRules) {
      if (!rules[rule.id] || !actual[rule.name]) continue;
      const needed = resolvePorts(rule, { webPorts, extraPort: resolvedExtra }).numbers;
      if (!covers(rule, needed)) rules[rule.id] = false;
    }

    // The internet rule allows every address, the local network included, so it
    // already satisfies the LAN rule when it opens the same ports; no prompt just
    // to add a narrower copy.
    if (rules['web-lan'] === false) {
      const lanRule = RULES.find((entry) => entry.id === 'web-lan');
      const internetRule = RULES.find((entry) => entry.id === 'web-internet');
      if (covers(internetRule, resolvePorts(lanRule, { webPorts, extraPort: resolvedExtra }).numbers)) {
        rules['web-lan'] = true;
      }
    }
    const leftOver = readState();
    const applied = Object.values(rules).length > 0 && Object.values(rules).every(Boolean);
    const blockedRules = await countBlockRules();
    const allowedByProgram = await programsAllowed();
    // Visitors get in when our web rule is there, or when Windows already lets
    // HawCode itself in on every port (and nothing blocks it).
    const webRule = internet ? rules['web-internet'] : rules['web-lan'];
    const webOpen = !blockedRules && Boolean(webRule || allowedByProgram.hawcode);
    cached = {
      elevated: await isElevated(),
      blockedRules,
      allowedByProgram,
      webOpen,
      rules,
      applied,
      installed: applied,
      count: Object.values(rules).filter(Boolean).length,
      program,
      recordedExecPath: leftOver ? leftOver.execPath : null,
      execPathChanged: Boolean(leftOver && leftOver.execPath && leftOver.execPath !== program),
      leftOverFromCrash: Boolean(leftOver && !leftOver.session)
    };
    if (onStatus) onStatus(cached);
    return cached;
  }

  /**
   * Run netsh commands, plus any `extra` elevated steps a caller wants done at the
   * same time (the hosts file, the network profile), behind one UAC prompt.
   *
   * Every step's exit code is reported separately, so one refused change never
   * hides whether the others landed.
   */
  async function runBatch(steps, { revert = false, removeBlocks = false, extra = [], files = {} } = {}) {
    const entries = [];
    for (const step of steps) {
      // Always delete first: netsh will happily create a second rule with the
      // same name, and then neither the user nor we can tell them apart.
      entries.push({ tag: `DEL ${step.id}`, command: step.revert });
      if (!revert) entries.push({ tag: `ADD ${step.id}`, command: step.command });
    }
    if (removeBlocks) {
      // netsh cannot select rules by program, so this one line is PowerShell.
      entries.push({
        tag: 'UNBLOCK program',
        command: powershellCommand(`${blockRulesScript(program)} | Remove-NetFirewallRule -ErrorAction SilentlyContinue`)
      });
    }
    for (const step of extra) entries.push({ tag: `EXTRA ${step.id}`, command: step.command });
    if (!entries.length) return { ok: true, steps: [], extra: [] };

    const outcome = await runElevated({ workDir, entries, files });
    if (!outcome.ok) return { ...outcome, steps: [], extra: [] };

    const codes = outcome.codes;
    const perStep = steps.map((step) => {
      const add = codes[`ADD ${step.id}`];
      const del = codes[`DEL ${step.id}`];
      return {
        id: step.id,
        name: step.name,
        // On a revert the delete's own code is the outcome; on an apply the delete
        // is only housekeeping and code 1 there merely means "was not there".
        ok: revert ? del === 0 || del === 1 : add === 0,
        wasPresent: del === 0,
        addCode: add,
        deleteCode: del
      };
    });
    const perExtra = extra.map((step) => ({
      id: step.id,
      name: step.name,
      ok: codes[`EXTRA ${step.id}`] === 0,
      code: codes[`EXTRA ${step.id}`]
    }));

    return {
      ok: outcome.finished && perStep.every((step) => step.ok) && perExtra.every((step) => step.ok),
      partial: !outcome.finished,
      steps: perStep,
      extra: perExtra,
      log: outcome.log,
      exitCode: outcome.exitCode
    };
  }

  return {
    plan,
    status,
    isElevated,

    /**
     * Add the rules. `force` re-runs even when everything is already in place;
     * otherwise a machine that already has the rules and no Block rule is left
     * alone, so starting a share does not raise a UAC prompt every time.
     */
    async apply({ internet = false, extraPort = null, force = false, extra = [], files = {} } = {}) {
      const wanted = plan({ internet, extraPort });
      if (!wanted.steps.length && !extra.length) return { ok: true, steps: [], extra: [] };

      const before = await status({ internet, extraPort });
      if (!force && !extra.length && before.applied && !before.blockedRules) {
        return { ok: true, alreadyApplied: true, steps: [], extra: [] };
      }

      // Recorded before running, so a crash mid-way still leaves a trail.
      writeState({
        appliedAt: Date.now(),
        execPath: program,
        ruleIds: wanted.steps.map((step) => step.id),
        session: true
      });

      const result = await runBatch(wanted.steps, {
        revert: false,
        removeBlocks: before.blockedRules > 0,
        extra,
        files
      });
      if (result.cancelled || !result.ok) {
        // Nothing to clean up on a refusal; on a partial failure keep the record
        // so the rules that did land can still be removed.
        if (result.cancelled) writeState(null);
      }
      await status({ internet, extraPort });
      return result;
    },

    /**
     * Remove every rule from RULES, by exact name.
     *
     * Deliberately covers all of them rather than only the ones this session
     * added: a rule left behind by an earlier crash is exactly what the user wants
     * gone, and a name from this list can only ever be one of ours.
     */
    async revert() {
      const steps = RULES.map((rule) => ({
        id: rule.id,
        name: rule.name,
        revert: deleteCommand(rule)
      }));
      const result = await runBatch(steps, { revert: true });
      if (result.ok) writeState(null);
      cached = null;
      return result;
    },

    /** Rules an earlier run left behind, for the offer to clean up at startup. */
    pendingFromCrash() {
      const leftOver = readState();
      if (!leftOver) return null;
      return {
        appliedAt: leftOver.appliedAt || null,
        ruleIds: leftOver.ruleIds,
        names: leftOver.ruleIds
          .map((id) => (RULES.find((rule) => rule.id === id) || {}).name)
          .filter(Boolean)
      };
    },

    /** Note that this session ended cleanly, so the next one does not ask. */
    clearRecord() {
      writeState(null);
    },

    get cached() {
      return cached;
    }
  };
}

module.exports = { createFirewall, RULES, LAN_ONLY_PORTS, assertNotPubliclyExposed };
