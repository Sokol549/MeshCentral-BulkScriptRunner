'use strict';
const crypto = require('crypto');
class AgentTransport {
    constructor(getAgent, script, targetOS, authorize, options = {}) { this.getAgent = getAgent; this.script = script; this.targetOS = targetOS; this.authorize = authorize || ((id, cb) => cb(true)); this.attempts = new Map(); this.probeTimeout = options.probeTimeout || 10000; }
    start(row, done) {
        const attempt = crypto.randomBytes(16).toString('hex');
        const state = { node: row.node_id, agent: null, done, cancelled: false, sent: false, timer: null };
        this.attempts.set(attempt, state);
        const finish = result => { if (!this.attempts.delete(attempt)) return; clearTimeout(state.timer); done(result); };
        state.finish = finish;
        this.authorize(row.node_id, allowed => {
            if (!this.attempts.has(attempt)) return;
            if (state.cancelled) return finish({ confirmed:true, exit_code:null, stderr:'Cancelled before dispatch' });
            if (!allowed) return finish({ confirmed:true, exit_code:null, stderr:'Execution permission revoked' });
            const agent = this.getAgent(row.node_id);
            if (!agent) return finish({ confirmed:true, exit_code:null, stderr:'Agent is offline' });
            state.agent = agent;
            const packet = JSON.stringify({ action:'plugin', plugin:'bulkrunner', op:'run', attempt, os:this.targetOS, script:this.script });
            if (Buffer.byteLength(packet, 'utf8') > 60000) return finish({ confirmed:true, exit_code:null, stderr:'Encoded request exceeds the agent message limit' });
            state.packet = packet;
            state.timer = setTimeout(() => finish({ confirmed:true, exit_code:null, stderr:'Agent module did not respond; script was not sent. Update the agent core and retry.' }), this.probeTimeout);
            try { agent.send(JSON.stringify({action:'plugin',plugin:'bulkrunner',op:'probe',attempt})); }
            catch (e) { finish({ confirmed:true, exit_code:null, stderr:'Agent probe could not be sent; script was not sent.' }); }
        });
        return { cancel: () => {
            state.cancelled = true;
            if (!this.attempts.has(attempt)) return;
            if (!state.sent) return finish({ confirmed:true, exit_code:null, stderr:'Cancelled before dispatch' });
            state.agent.send(JSON.stringify({ action:'plugin', plugin:'bulkrunner', op:'cancel', attempt }));
        } };
    }
    receive(command, agent) {
        const state = this.attempts.get(command.attempt);
        if (!state || state.agent !== agent || state.node !== agent.dbNodeKey) return false;
        if (command.event === 'ready' && !state.sent) {
            clearTimeout(state.timer);
            state.sent = true;
            try { agent.send(state.packet); } catch (e) { state.finish({ confirmed:false, stderr:'Delivery failed; outcome is unknown' }); }
            return true;
        }
        if (!state.sent || command.event !== 'finished' || (command.exitCode !== null && !Number.isInteger(command.exitCode))) return false;
        state.finish({ confirmed:true, exit_code:command.exitCode, stdout:command.stdout, stderr: [command.stderr || '', command.error || ''].filter(Boolean).join('\n'), truncated:!!command.truncated }); return true;
    }
    disconnected(agent) { for (const data of this.attempts.values()) { if (data.agent !== agent) continue; data.finish({ confirmed:!data.sent, exit_code:null, stderr:data.sent ? 'Connection lost; execution outcome is unknown.' : 'Connection lost before script dispatch.' }); } }
}
module.exports = AgentTransport;
