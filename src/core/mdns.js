'use strict';

const { Bonjour } = require('bonjour-service');

/**
 * Announces "<hostname>.local" on the local network (mDNS / Bonjour) so other devices can use
 * http://stage.local instead of an IP address. Works on Windows 10+, macOS, iOS and recent Android.
 */
function advertise({ hostname, port, onError = () => {} }) {
  // Without an error callback bonjour-service throws (and would crash the app) when a network is unreachable.
  const bonjour = new Bonjour({}, onError);
  bonjour.publish({ name: 'Stage Timer', type: 'http', port, host: `${hostname}.local` });
  return {
    hostname: `${hostname}.local`,
    stop: () =>
      new Promise((resolve) => {
        try {
          bonjour.unpublishAll(() => {
            bonjour.destroy();
            resolve();
          });
        } catch {
          resolve();
        }
      }),
  };
}

module.exports = { advertise };
