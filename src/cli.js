'use strict';

// Headless runner (no Electron): `npm run serve`. Handy for servers and quick testing.
const os = require('os');
const path = require('path');
const { StageService } = require('./core/service');
const { createServer } = require('./core/server');

(async () => {
  const dataDir = process.env.STAGETIMER_DATA || path.join(os.homedir(), '.stagetimer');
  const service = new StageService({ dataDir });
  await service.loadSchedule();
  const server = createServer(service);
  await server.start(service.settings.port);
  const u = server.urls();
  console.log(`Stage Timer running (${service.meetingType}, schedule: ${service.status.source})`);
  console.log(`  Display : ${u.display}\n  Control : ${u.control}\n  OBS dock: ${u.dock}\n  PIN     : ${service.settings.pin}`);
})();
