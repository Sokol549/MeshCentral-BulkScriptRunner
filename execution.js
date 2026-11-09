'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Dispatcher = require('./dispatcher');
const AgentTransport = require('./agent-transport');
module.exports = function (server, root, send) {
    let active = null;
    const historyDir = path.join(root, 'history');
    // A restart never starts a task twice; unfinished remote work has unknown outcome.
    for (const name of fs.readdirSync(historyDir).filter(n => /^run_[0-9]+_[a-f0-9]+\.json$/.test(n))) {
        const file = path.join(historyDir, name);
        try {
            const t = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (t.status !== 'Running' || !Array.isArray(t.results)) continue;
            t.results.forEach(r => { if (r.status === 'Running') { r.status = 'Unknown'; r.stderr = (r.stderr || '') + '\nServer restarted before completion was confirmed'; } else if (r.status === 'Pending') r.status = 'Cancelled'; });
            t.status = 'Unknown'; t.completed_at = new Date().toISOString();
            const temp = file + '.recover'; fs.writeFileSync(temp, JSON.stringify(t, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
        } catch (e) { console.error('[BulkRunner] Cannot recover history:', e.message); }
    }
    function changeTag(client, user, id, tag, remove) {
        const web = server.webserver;
        return new Promise((resolve, reject) => web.GetNodeWithRights(client.domain, user, id, (node, rights, visible) => {
            if (!node || !visible || !(rights & 4)) return reject(Error('No permission to modify device tags'));
            if (!server.db || typeof server.db.Set !== 'function' || typeof web.cleanDevice !== 'function' || typeof web.CloneSafeNode !== 'function' || typeof web.CreateNodeDispatchTargets !== 'function' || typeof server.DispatchEvent !== 'function') return reject(Error('MeshCentral tag API unavailable'));
            const tags = Array.isArray(node.tags) ? node.tags.slice() : [];
            const index = tags.indexOf(tag);
            if (remove && index < 0 || !remove && index >= 0) return resolve(false);
            if (remove) tags.splice(index, 1); else tags.push(tag);
            tags.sort(); node.tags = tags;
            server.db.Set(web.cleanDevice(node), err => {
                if (err) return reject(err);
                const event = { etype:'node', userid:user._id, username:user.name, action:'changenode', nodeid:node._id, domain:client.domain.id, node:web.CloneSafeNode(node), msg:'Device tags changed' };
                if (server.db.changeStream) event.noact = 1;
                server.DispatchEvent(web.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), null, event);
                resolve(true);
            });
        }));
    }
    return function (command, client, user, domain) {
        if (command.pluginaction === 'agentResult') { if (active && active.transport) active.transport.receive(command, client); return true; }
        if (command.pluginaction === 'releaseUnknown') {
            if (!active || !active.pool || active.pool.running.size || active.task.status !== 'Unknown' || active.domain !== domain) throw Error('No finished unknown task to release');
            if (command.task_id !== active.task.task_id) throw Error('Task does not match');
            active = null;
            send(client, { type:'released', task_id:command.task_id });
            return true;
        }
        if (command.pluginaction === 'current') { if (active && active.task && active.domain === domain) send(client, {type:'task', task:active.task}); return true; }
        if (command.pluginaction === 'abort') {
            if (!active || active.user !== user._id || !active.pool) throw Error('No active task');
            active.pool.abort(); return true;
        }
        if (command.pluginaction === 'history') {
            const tasks = fs.readdirSync(historyDir).filter(n => /^run_[0-9]+_[a-f0-9]+\.json$/.test(n)).map(n => { try { return JSON.parse(fs.readFileSync(path.join(historyDir, n), 'utf8')); } catch (_) { return null; } }).filter(t => t && t.domain === domain).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
            send(client, { type: 'history', tasks }); return true;
        }
        if (command.pluginaction === 'untag') {
            if (typeof command.task_id !== 'string' || !/^run_[0-9]+_[a-f0-9]+$/.test(command.task_id) || typeof command.tag !== 'string' || !command.tag.trim() || command.tag.length > 63 || command.tag.includes(',')) throw Error('Invalid task or tag');
            const task = JSON.parse(fs.readFileSync(path.join(historyDir, command.task_id + '.json'), 'utf8'));
            if (task.domain !== domain || !Array.isArray(task.results)) throw Error('Task not found');
            Promise.allSettled(task.results.map(r => changeTag(client,user,r.node_id,command.tag.trim(),true))).then(results => send(client, { type:'untag', changed:results.filter(x => x.status === 'fulfilled' && x.value).length, errors:results.filter(x => x.status === 'rejected').length }));
            return true;
        }
        if (command.pluginaction !== 'run') return false;
        if (active) { if (active.task && active.domain === domain) send(client, {type:'task', task:active.task}); throw Error('Another task is active or has an unknown outcome'); }
        if (!Array.isArray(command.nodeids) || !command.nodeids.length || command.nodeids.length > 1000 || new Set(command.nodeids).size !== command.nodeids.length || command.nodeids.some(id => typeof id !== 'string' || id.split('/').length !== 3 || id.split('/')[0] !== 'node' || id.split('/')[1] !== domain)) throw Error('Invalid targets');
        if (command.target_os !== 'windows' || typeof command.script !== 'string' || !command.script.trim() || Buffer.byteLength(command.script, 'utf8') > 32768 || !Number.isInteger(command.workers) || command.workers < 1 || command.workers > 100 || !Number.isInteger(command.timeout) || command.timeout < 1 || command.timeout > 86400) throw Error('Invalid task settings; script limit is 32768 bytes');
        if (command.success_tag != null && (typeof command.success_tag !== 'string' || !command.success_tag.trim() || command.success_tag.length > 63 || command.success_tag.includes(','))) throw Error('Invalid success tag');
        const web = server.webserver;
        if (!web || typeof web.GetNodeWithRights !== 'function' || !client.domain) throw Error('Node access validation is unavailable');
        const reservation = { user: user._id, preparing: true }; active = reservation;
        Promise.all(command.nodeids.map(id => new Promise(resolve => web.GetNodeWithRights(client.domain, user, id, (node, rights, visible) => resolve({ id, node, rights, visible }))))).then(items => {
            if (active !== reservation) return;
            if (items.some(x => !x.node || !x.visible || !(x.rights & 0x20000))) throw Error('No command execution rights for at least one target');
            const targets = items.map(x => {
                const n = x.node, agentId = n.agent && n.agent.id;
                const isWindows = (agentId > 0 && agentId < 5) || (agentId > 41 && agentId < 44);
                if (!Number.isInteger(agentId) || (command.target_os === 'windows') !== !!isWindows) throw Error('Target OS does not match');
                return { node_id: n._id, node_name: n.name || n._id, device_group: (web.meshes && web.meshes[n.meshid] && web.meshes[n.meshid].name) || n.meshid, os: command.target_os, online: !!web.wsagents[n._id] };
            });
            const task = { task_id: 'run_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex'), created_at: new Date().toISOString(), initiated_by: user.name || user._id, domain, target_os: command.target_os, applied_tag: command.success_tag ? command.success_tag.trim() : null, results: [], status: 'Running' };
            const transport = new AgentTransport(id => { const a = web.wsagents[id]; return a && a.authenticated === 2 ? a : null; }, command.script, command.target_os, (id, cb) => web.GetNodeWithRights(client.domain, user, id, (node, rights, visible) => cb(!!node && !!visible && !!(rights & 0x20000))));
            const save = () => { const temp = path.join(historyDir, task.task_id + '.tmp'), target = path.join(historyDir, task.task_id + '.json'); fs.writeFileSync(temp, JSON.stringify(task, null, 2), { mode: 0o600 }); fs.renameSync(temp, target); };
            const pool = new Dispatcher({ targets, concurrency: command.workers, timeout: command.timeout, transport, onChange: rows => {
                task.results = rows;
                task.stats = { total: rows.length, success: rows.filter(r => r.status === 'Success').length, failed: rows.filter(r => r.status === 'Failed').length, timeout: rows.filter(r => r.status === 'Timeout').length, skipped: rows.filter(r => r.status === 'Skipped').length, unknown: rows.filter(r => r.status === 'Unknown').length, cancelled: rows.filter(r => r.status === 'Cancelled').length };
                if (task.applied_tag) rows.filter(r => r.status === 'Success' && !r.tag_status).forEach(r => {
                    r.tag_status = 'Pending';
                    changeTag(client, user, r.node_id, task.applied_tag, false).then(() => { r.tag_status = 'Applied'; }, e => { r.tag_status = 'Failed'; r.tag_error = e.message; }).then(() => {
                        try { save(); } catch (e) { console.error('[BulkRunner] history:', e.message); }
                        send(client, { type:'task', task });
                    });
                });
                if (rows.every(r => !['Running','Pending'].includes(r.status))) { task.status = rows.some(r => r.status === 'Unknown') ? 'Unknown' : 'Completed'; task.completed_at = new Date().toISOString(); }
                try { save(); } catch (e) { console.error('[BulkRunner] history:', e.message); }
                send(client, { type: 'task', task });
                if (task.status === 'Completed' && active && active.pool === pool) active = null;
            } });
            active = { pool, transport, task, user: user._id, domain };
            save(); pool.start();
            const monitor = setInterval(() => {
                if (!active || active.pool !== pool) return clearInterval(monitor);
                for (const data of transport.attempts.values()) if (data.agent && web.wsagents[data.node] !== data.agent) transport.disconnected(data.agent);
            }, 2000);
            if (monitor.unref) monitor.unref();
        }).catch(err => { if (active === reservation || (active && active.user === user._id && active.task && active.task.status === 'Running' && !active.pool.running.size)) active = null; send(client, { error: err.message }); });
        return true;
    };
};
