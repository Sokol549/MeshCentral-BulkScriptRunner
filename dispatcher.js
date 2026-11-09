'use strict';
// The transport completes only when the remote process has confirmed its exit.
// A lost connection is an unknown outcome, never a successful execution.
class Dispatcher {
    constructor(options) {
        if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 100) throw new Error('Invalid concurrency');
        if (!Number.isInteger(options.timeout) || options.timeout < 1 || options.timeout > 86400) throw new Error('Invalid timeout');
        this.limit = options.concurrency;
        this.timeout = options.timeout;
        this.transport = options.transport;
        this.onChange = options.onChange || (() => {});
        if (!Array.isArray(options.targets) || new Set(options.targets.map(t => t.node_id)).size !== options.targets.length || options.targets.some(t => !t.node_id)) throw new Error('Invalid or duplicate targets');
        this.results = options.targets.map(t => ({ ...t, status: t.online ? 'Pending' : 'Skipped', exit_code: null, stdout: '', stderr: '' }));
        this.running = new Map();
        this.aborted = false;
        this.uncertain = false;
    }
    start() { this.emit(); this.pump(); }
    emit() { this.onChange(this.results); }
    pump() {
        while (!this.aborted && !this.uncertain && this.running.size < this.limit) {
            const row = this.results.find(r => r.status === 'Pending');
            if (!row) break;
            row.status = 'Running';
            row.started_at = new Date().toISOString();
            const start = Date.now();
            const slot = { timer: null, cancel: null, stopReason: null };
            this.running.set(row.node_id, slot);
            const done = result => {
                if (this.running.get(row.node_id) !== slot) return;
                clearTimeout(slot.timer);
                this.running.delete(row.node_id);
                row.duration_sec = Math.round((Date.now() - start) / 100) / 10;
                row.stdout = String(result.stdout || '');
                row.stderr = String(result.stderr || '');
                row.truncated = !!result.truncated;
                row.exit_code = Number.isInteger(result.exit_code) ? result.exit_code : null;
                // A cancellation/timeout status requires confirmation that the process ended.
                row.status = !result.confirmed ? 'Unknown' : slot.stopReason ? slot.stopReason : row.exit_code === 0 ? 'Success' : 'Failed';
                if (!result.confirmed) { this.uncertain = true; this.results.filter(r => r.status === 'Pending').forEach(r => { r.status = 'Cancelled'; }); }
                this.emit(); this.pump();
            };
            slot.done = done;
            try {
                const handle = this.transport.start(row, done);
                slot.cancel = handle && handle.cancel;
                if (this.running.get(row.node_id) === slot) slot.timer = setTimeout(() => this.stop(row.node_id, 'Timeout'), this.timeout * 1000);
            } catch (e) { done({ confirmed: true, exit_code: null, stderr: String(e.message || e) }); }
            this.emit();
        }
    }
    stop(id, reason) {
        const slot = this.running.get(id);
        if (!slot || slot.stopReason) return;
        slot.stopReason = reason;
        clearTimeout(slot.timer);
        slot.timer = setTimeout(() => slot.done({ confirmed: false, stderr: 'Termination was not confirmed' }), 15000);
        try { if (typeof slot.cancel === 'function') slot.cancel(); else throw new Error('Cancellation unavailable'); }
        catch (e) { this.onChange(this.results, e); }
    }
    abort() {
        this.aborted = true;
        this.results.filter(r => r.status === 'Pending').forEach(r => { r.status = 'Cancelled'; });
        for (const id of this.running.keys()) this.stop(id, 'Cancelled');
        this.emit();
    }
}
module.exports = Dispatcher;
