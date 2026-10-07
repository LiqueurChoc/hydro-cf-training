'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const c = require('./core');
const { replayOriginal } = require('./rating');
let lastId, engine;
replayOriginal(workerData, async id => {
  if (id !== lastId) {
    const data = await new Promise(resolve => {
      parentPort.once('message', resolve);
      parentPort.postMessage({ type: 'reference', id });
    });
    engine = c.referenceEngine(data.rows, data.type); lastId = id;
  }
  return engine;
}).then(report => parentPort.postMessage({ type: 'result', report }),
  error => parentPort.postMessage({ type: 'error', error: error.message }));
