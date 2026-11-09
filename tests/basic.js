const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const create = require('../bulkrunner');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulkrunner-test-'));
try {
    const server = { datapath: dir, webserver: { wsagents: { 'node/a/1': {} } }, db: { GetAllType(type, cb) { cb(null, type === 'node' ? [{ _id: 'node/a/1', name: 'One', tags: ['test'] }, { _id: 'node/b/2' }] : [{ _id: 'mesh/a/1', name: 'Group' }, { _id: 'mesh/b/2' }]); } } };
    let response; const client = { user: { _id: 'user/a/admin', siteadmin: -1 }, ws: { send(s) { response = JSON.parse(s); } } };
    let plugin = create({ parent: server });
    const preset = { name: 'test', description: '', target_os: 'linux', script_body: 'exit 2', default_timeout: 120 };
    plugin.serveraction({ pluginaction: 'save', preset }, client);
    assert.equal(response.type, 'saved');
    plugin = create({ parent: server });
    plugin.serveraction({ pluginaction: 'list' }, client);
    assert.equal(response.presets.length, 1); assert.equal(response.nodes.length, 1); assert.equal(response.nodes[0].online, true); assert.equal(response.meshes.length, 1);
    const id = response.presets[0].id;
    const other = { user: { _id: 'user/b/admin', siteadmin: -1 }, ws: client.ws };
    plugin.serveraction({ pluginaction: 'list' }, other); assert.equal(response.presets.length, 0); assert.equal(response.nodes.length, 1);
    plugin.serveraction({ pluginaction: 'save', preset: { ...preset, id } }, other); assert.ok(response.error);
    response = null; plugin.serveraction({ pluginaction: 'list' }, { user: { _id: 'user/a/x', siteadmin: 0 }, ws: client.ws }); assert.equal(response, null);
    plugin.serveraction({ pluginaction: 'run' }, client); assert.match(response.error, /отключён/);
    plugin.serveraction({ pluginaction: 'delete', id }, client); plugin.serveraction({ pluginaction: 'list' }, client); assert.equal(response.presets.length, 0);
    console.log('BulkRunner checks passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
