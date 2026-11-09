/* MeshAgent module: one child per attempt, no automatic retry after disconnect. */
'use strict';
var jobs = {};
var limit = 4000;
function report(mesh, message) {
    message.action = 'plugin'; message.plugin = 'bulkrunner'; message.pluginaction = 'agentResult';
    try { mesh.SendCommand(message); } catch (e) { }
}
function utf16Base64(value) {
    var bytes = Buffer.alloc(value.length * 2);
    for (var i = 0; i < value.length; i++) { var code = value.charCodeAt(i); bytes[i * 2] = code & 255; bytes[i * 2 + 1] = code >>> 8; }
    return bytes.toString('base64');
}
function consoleaction(cmd, rights, sessionid, mesh) {
    if (!cmd || typeof cmd.attempt !== 'string' || !/^[a-f0-9]{32}$/.test(cmd.attempt)) return;
    if (cmd.op === 'cancel') {
        var running = jobs[cmd.attempt];
        if (running) { try { process.kill(running.pid); } catch (e) { report(mesh, { attempt: cmd.attempt, event: 'cancelError', error: String(e) }); } }
        return;
    }
    if (cmd.op !== 'run' || jobs[cmd.attempt]) return;
    if (typeof cmd.script !== 'string' || cmd.script.length > 262144 || (cmd.os !== 'linux' && cmd.os !== 'windows')) return;
    if ((cmd.os === 'windows' && process.platform !== 'win32') || (cmd.os === 'linux' && process.platform !== 'linux')) {
        report(mesh, { attempt: cmd.attempt, event: 'finished', exitCode: null, error: 'ОС устройства не соответствует скрипту' }); return;
    }
    var child, output = '', errors = '', truncated = false;
    try {
        if (cmd.os === 'windows') {
            var exe = process.env.windir + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
            var script = "$ProgressPreference = 'SilentlyContinue'\n$ErrorActionPreference = 'Stop'\ntry {\n" + cmd.script + "\n} catch { [Console]::Error.WriteLine($_.Exception.ToString()); [Console]::Error.WriteLine($_.ScriptStackTrace); exit 1 }\n";
            var encoded = utf16Base64(script);
            child = require('child_process').execFile(exe, ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {});
        } else {
            child = require('child_process').execFile('/bin/bash', ['bash', '-c', 'set -e\nset -o pipefail\n' + cmd.script], {});
        }
        jobs[cmd.attempt] = child;
        child.stdout.on('data', function(data) { data = data.toString(); if (output.length + data.length > limit) truncated = true; output = (output + data).slice(0, limit); });
        child.stderr.on('data', function(data) { data = data.toString(); if (errors.length + data.length > limit) truncated = true; errors = (errors + data).slice(0, limit); });
        child.on('exit', function(code) {
            delete jobs[cmd.attempt];
            report(mesh, { attempt: cmd.attempt, event: 'finished', exitCode: typeof code === 'number' ? code : null, stdout: output, stderr: errors, truncated: truncated });
        });
        report(mesh, { attempt: cmd.attempt, event: 'started', pid: child.pid });
        child.stdin.end();
    } catch (e) {
        delete jobs[cmd.attempt];
        report(mesh, { attempt: cmd.attempt, event: 'finished', exitCode: null, error: String(e), stdout: output, stderr: errors });
    }
}
module.exports = { consoleaction: consoleaction };
