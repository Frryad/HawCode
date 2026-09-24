'use strict';

// Endings that standards bodies have set aside for private networks. Nobody can
// ever sell these, so a name built on one cannot be taken away later.
const RESERVED_ENDINGS = new Set(['internal', 'home.arpa', 'test', 'invalid', 'example', 'localhost']);

// Endings that are real, delegated, and in active use. A name built on one of
// these works at home but shadows a real site, so it earns a louder warning.
// `.box` is on the list deliberately: it is HawCode's default because it reads
// well, and the user should know what they are choosing.
const DELEGATED_ENDINGS = new Set([
  'com', 'net', 'org', 'io', 'co', 'dev', 'app', 'page', 'box', 'zip', 'mov',
  'sh', 'me', 'xyz', 'site', 'online', 'cloud', 'link', 'work', 'live', 'run'
]);

const DEFAULT_ENDING = 'box';

/** Turn a folder name into something usable as a hostname label. */
function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
  return slug || 'workspace';
}

function normaliseEnding(value) {
  const ending = String(value || '')
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
    .replace(/[^a-z0-9.-]+/g, '');
  return ending || DEFAULT_ENDING;
}

function compose(name, ending) {
  return `${slugify(name)}.${normaliseEnding(ending)}`;
}

/**
 * What to tell the user about the ending they picked.
 *
 * Deliberately a warning and never a refusal: the naming is theirs. The point
 * is that "this might be taken away from you later" is something they can only
 * weigh if somebody says it out loud.
 */
function endingWarning(ending) {
  const normalised = normaliseEnding(ending);
  if (RESERVED_ENDINGS.has(normalised)) return null;
  if (DELEGATED_ENDINGS.has(normalised)) {
    return {
      level: 'warn',
      message: `.${normalised} is a real ending that someone already owns on the internet. ` +
        'It works fine on your own network, but while it is in use this computer will ' +
        'shadow any real site under it. Use .internal or .home.arpa to be certain that ' +
        'can never happen.'
    };
  }
  return {
    level: 'note',
    message: `.${normalised} is not set aside for private use, so a registry could start ` +
      'selling it one day and your names would start colliding with real sites. ' +
      '.internal and .home.arpa are reserved forever.'
  };
}

module.exports = {
  slugify,
  normaliseEnding,
  compose,
  endingWarning,
  DEFAULT_ENDING,
  RESERVED_ENDINGS,
  DELEGATED_ENDINGS
};
