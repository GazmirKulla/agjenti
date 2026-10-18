// Audit-only harness. Blocks real outbound network in this Node process and children.
// Unit-test mocks can replace fetch without reaching the network.
/* eslint-disable @typescript-eslint/no-require-imports -- Synchronous CommonJS preload for node --require, before application imports. */
'use strict';
const deny = () => { throw new Error('QA_NETWORK_BLOCKED: real network access is disabled during the isolated audit'); };
const net = require('node:net');
net.Socket.prototype.connect = deny;
net.connect = deny;
net.createConnection = deny;
require('node:tls').connect = deny;
require('node:http').request = deny;
require('node:http').get = deny;
require('node:https').request = deny;
require('node:https').get = deny;
require('node:http2').connect = deny;
require('node:dgram').createSocket = deny;
globalThis.fetch = async () => deny();
