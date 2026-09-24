'use strict';

// Anything stored with this prefix has been through the operating system's own
// keystore. The prefix is what lets a settings file written before encryption was
// available keep working.
const PREFIX = 'enc:v1:';

let safeStorage = null;
try {
  // Only present in the Electron main process; a plain `node` require of this
  // module (a test, a script) should fall back rather than throw.
  ({ safeStorage } = require('electron'));
} catch {
  safeStorage = null;
}

function available() {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

/**
 * Wrap a secret for storage in the settings file.
 *
 * On Windows this is DPAPI, keyed to the user account, so the value in
 * hawcode-settings.json is useless to anyone who copies the file off the machine.
 * When the keystore is unavailable the value is stored as-is and `available()`
 * reports false, so the UI can say so rather than implying a protection that is
 * not there.
 */
function encrypt(value) {
  const text = String(value == null ? '' : value);
  if (!text) return '';
  if (!available()) return text;
  try {
    return PREFIX + safeStorage.encryptString(text).toString('base64');
  } catch {
    return text;
  }
}

function decrypt(stored) {
  const text = String(stored == null ? '' : stored);
  if (!text) return '';
  if (!text.startsWith(PREFIX)) return text;
  if (!available()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(text.slice(PREFIX.length), 'base64'));
  } catch {
    // A value encrypted under a different user account or a reinstalled profile
    // cannot be recovered. Treat it as absent so the user is asked again.
    return '';
  }
}

/** True when something is stored, without decrypting it. */
function isSet(stored) {
  return Boolean(stored && String(stored).length);
}

module.exports = { encrypt, decrypt, isSet, available, PREFIX };
