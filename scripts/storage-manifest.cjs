'use strict';
const { collections } = require('./recovery-contract.json');
// Run through Hydro CLI to obtain actual namespace names after prefix/map resolution.
module.exports = function manifest(db = require('hydrooj').db) {
  return { database: db.db.databaseName, collections: Object.fromEntries(collections.map(name => [name, db.collection(name).collectionName])) };
};
