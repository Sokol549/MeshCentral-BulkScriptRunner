const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function create(parent) {
    const server = parent.meshServer || parent.parent;
    const root = path.join(server.datapath, 'bulkrunner');
    const file = path.join(root, 'presets.json');
    fs.mkdirSync(path.join(root, 'history'), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', { flag: 'wx' });
    const obj = { exports: ['onWebUIStartupEnd', 'onBulkRunnerMessage'] };
    function send(client, data) {
        const payload = JSON.stringify(Object.assign({ action: 'plugin', plugin: 'bulkrunner', method: 'onBulkRunnerMessage' }, data));
        try { if (client.ws && typeof client.ws.send === 'function') client.ws.send(payload);
        else if (typeof client.send === 'function') client.send(payload); } catch (e) { console.warn('[BulkRunner] Client disconnected:', e.message); }
    }
    function read() {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(value)) throw new Error('Invalid presets file');
        return value;
    }
    function write(data) {
        const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        try { fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    const execute = require('./execution')(server, root, send);
    obj.serveraction = function(command, client) {
        if (command && command.pluginaction === 'agentResult') { execute(command, client, null, null); return; }
        const user = client && client.user;
        if (!user || (user.siteadmin !== -1 && user.siteadmin !== 0xFFFFFFFF)) return;
        const domain = user._id && user._id.split('/')[1];
        if (domain === undefined) return;
        try {
            const action = command.pluginaction;
            if (execute(command, client, user, domain)) return;
            if (action === 'list') {
                const presets = read().filter(p => p.domain === domain).map(({ domain, ...p }) => p);
                const db = server.db;
                if (!db || typeof db.GetAllType !== 'function') throw new Error('MeshCentral database API unavailable');
                db.GetAllType('node', function(err, nodes) {
                    if (err) return send(client, { error: 'Не удалось загрузить устройства' });
                    db.GetAllType('mesh', function(err2, meshes) {
                        if (err2) return send(client, { error: 'Не удалось загрузить группы' });
                        const agents = (server.webserver && server.webserver.wsagents) || {};
                        send(client, { type: 'list', presets, meshes: (meshes || []).filter(m => m._id.split('/')[1] === domain).map(m => ({ id: m._id, name: m.name })), nodes: (nodes || []).filter(n => n._id.split('/')[1] === domain).map(n => ({ id: n._id, name: n.name || n._id, meshid: n.meshid, os: n.os || n.osdesc || '', desc: n.desc || '', ip: n.ip || '', tags: Array.isArray(n.tags) ? n.tags : [], online: !!agents[n._id] })) });
                    });
                });
            } else if (action === 'save') {
                const p = command.preset || {};
                if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200 || !['windows','linux'].includes(p.target_os) || typeof p.script_body !== 'string' || Buffer.byteLength(p.script_body) > 262144 || !Number.isInteger(p.default_timeout) || p.default_timeout < 1 || p.default_timeout > 86400 || typeof p.description !== 'string' || p.description.length > 2000) throw new Error('Некорректные данные шаблона');
                const all = read();
                let id = p.id;
                if (id && !all.some(x => x.domain === domain && x.id === id)) throw new Error('Шаблон не найден');
                if (!id) id = 'preset_' + crypto.randomBytes(12).toString('hex');
                const item = { id, domain, name: p.name.trim(), target_os: p.target_os, description: p.description, script_body: p.script_body, default_timeout: p.default_timeout };
                write(all.filter(x => !(x.domain === domain && x.id === id)).concat(item));
                send(client, { type: 'saved' });
            } else if (action === 'delete') {
                if (typeof command.id !== 'string') throw new Error('Некорректный идентификатор');
                const all = read();
                write(all.filter(x => !(x.domain === domain && x.id === command.id)));
                send(client, { type: 'saved' });
            } else if (action === 'run') {
                send(client, { error: 'Запуск отключён: подтверждённый сбор exit code, stdout/stderr и остановка процесса ещё не реализованы.' });
            }
        } catch (e) { send(client, { error: e.message }); }
    };
    obj.handleServerMessage = obj.serveraction;
    obj.onWebUIStartupEnd = function () {
        if (document.getElementById('bulkrunner-loader')) return;
        var s = document.createElement('script'); s.id = 'bulkrunner-loader'; s.src = 'plugin/bulkrunner/bulkrunner.js'; document.head.appendChild(s);
        var c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'plugin/bulkrunner/bulkrunner.css'; document.head.appendChild(c);
    };
    obj.onBulkRunnerMessage = function (server, message) { if (window.BulkRunner) window.BulkRunner.receive(message); };
    function routes(app) {
        if (!app || app._bulkRunnerRegistered) return false;
        app._bulkRunnerRegistered = true;
        ['bulkrunner.js', 'bulkrunner.css'].forEach(name => app.get('/plugin/bulkrunner/' + name, (req, res) => res.sendFile(path.join(__dirname, 'public', name))));
        if (app._router && Array.isArray(app._router.stack)) {
            const stack = app._router.stack;
            const layers = [];
            for (let i = stack.length - 1; i >= 0; i--) if (stack[i].route && String(stack[i].route.path).startsWith('/plugin/bulkrunner/')) layers.unshift(stack.splice(i, 1)[0]);
            stack.splice(2, 0, ...layers);
        }
        return true;
    }
    obj.hook_setupHttpHandlers = web => routes(web && (web.app || web));
    obj.server_startup = function () { let attempts = 0; function retry() { if (!routes(server.app || (server.webserver && server.webserver.app)) && ++attempts < 30) setTimeout(retry, 1000); } retry(); };
    return obj;
}
module.exports = create;
module.exports.bulkrunner = create;
