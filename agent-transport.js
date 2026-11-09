'use strict';
const crypto = require('crypto');
class AgentTransport {
    constructor(getAgent, script, targetOS, authorize) { this.getAgent = getAgent; this.script = script; this.targetOS = targetOS; this.authorize = authorize || ((id, cb) => cb(true)); this.attempts = new Map(); }
    start(row, done) {
        const attempt = crypto.randomBytes(16).toString('hex');
        const state = { node: row.node_id, agent: null, done, cancelled: false };
        this.attempts.set(attempt, state);
        const finish = result => { if (!this.attempts.delete(attempt)) return; done(result); };
        this.authorize(row.node_id, allowed => {
            if (!this.attempts.has(attempt)) return;
            if (state.cancelled) return finish({ confirmed:true, exit_code:null, stderr:'Cancelled before dispatch' });
            if (!allowed) return finish({ confirmed:true, exit_code:null, stderr:'Execution permission revoked' });
            const agent = this.getAgent(row.node_id);
            if (!agent) return finish({ confirmed:true, exit_code:null, stderr:'Agent is offline' });
            state.agent = agent;
            const packet = JSON.stringify({ action:'plugin', plugin:'bulkrunner', op:'run', attempt, os:this.targetOS, script:this.script });
            if (Buffer.byteLength(packet, 'utf8') > 60000) return finish({ confirmed:true, exit_code:null, stderr:'Encoded request exceeds the agent message limit' });
            try { agent.send(packet); }
            catch (e) { finish({ confirmed:false, stderr:'Delivery failed; outcome is unknown' }); }
        });
        return { cancel: () => { state.cancelled = true; if (state.agent && this.attempts.has(attempt)) state.agent.send(JSON.stringify({ action:'plugin', plugin:'bulkrunner', op:'cancel', attempt })); } };
    }
    receive(command, agent) {
        const data = this.attempts.get(command.attempt);
        if (!data || data.agent !== agent || data.node !== agent.dbNodeKey || command.event !== 'finished') return false;
        if (command.exitCode !== null && !Number.isInteger(command.exitCode)) return false;
        this.attempts.delete(command.attempt);
        data.done({ confirmed:true, exit_code:command.exitCode, stdout:command.stdout, stderr: [command.stderr || '', command.error || ''].filter(Boolean).join('\n'), truncated:!!command.truncated }); return true;
    }
    disconnected(agent) { for (const [id, data] of this.attempts) { if (data.agent !== agent) continue; this.attempts.delete(id); data.done({ confirmed:false, stderr:'Connection lost; execution outcome is unknown.' }); } }
}
module.exports = AgentTransport;
