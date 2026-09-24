/**
 * A dynamic import that survives a hiccup.
 *
 * The chunks come from this machine — the dev server, or HawCode's own local
 * server — so a failure is nearly always momentary: the dev server restarting
 * after a config change, or a browser peer whose Wi-Fi dropped for a second.
 * Two quick retries turn that into a pause instead of a dead panel. If they
 * both fail the error reaches the view's `LazyView`, which says so and offers
 * to try again.
 */

import { lazy } from 'react';

export function lazyView(load) {
  return lazy(() => attempt(load, 2));
}

function attempt(load, retriesLeft) {
  return load().catch((error) => {
    if (retriesLeft <= 0) throw error;
    return new Promise((resolve, reject) => {
      setTimeout(() => attempt(load, retriesLeft - 1).then(resolve, reject), 400);
    });
  });
}
