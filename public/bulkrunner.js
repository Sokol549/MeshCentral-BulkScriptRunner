(function () {
    'use strict';
    if (window.BulkRunner) return;
    var state = { nodes: [], meshes: [], presets: [], selected: new Set(), task: null };
    function el(tag, text, attrs) { var e = document.createElement(tag); if (text != null) e.textContent = text; Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    function send(action, extra) { meshserver.send(Object.assign({ action: 'plugin', plugin: 'bulkrunner', pluginaction: action }, extra || {})); }
    var button = el('button', 'Bulk Script Runner 0.1', { type: 'button', class: 'br-open' });
    var panel = el('div', null, { class: 'br-overlay', hidden: '' });
    panel.innerHTML = '<div class="br-panel"><header><strong>Bulk Script Runner 0.1</strong><button type="button" data-act="close">×</button></header><p class="br-notice">0.1: experimental execution. Scripts run under the MeshAgent service account.</p><div id="br-error" class="br-error" role="alert"></div><div class="br-columns"><section><h3>Устройства</h3><label>Группа <select id="br-group"><option value="">Все группы</option></select></label><label>Поиск <input id="br-search" placeholder="Имя, IP, описание"></label><label>Теги <select id="br-tags" multiple size="4"></select></label><label>Совпадение <select id="br-mode"><option value="and">Все теги (AND)</option><option value="or">Любой тег (OR)</option></select></label><p><button type="button" data-act="select">Выбрать видимые</button> <button type="button" data-act="update-core">Обновить ядро агента</button> <button type="button" data-act="clear">Снять выбор</button></p><p id="br-count"></p><div class="br-list" id="br-nodes"></div></section><section><h3>Скрипт и шаблоны</h3><label>Шаблон <select id="br-preset"><option value="">Новый шаблон</option></select></label><label>Название <input id="br-name"></label><label>Описание <input id="br-description"></label><label>Оболочка <select id="br-os"><option value="windows">PowerShell</option><option value="linux" disabled>Bash (later)</option></select></label><label>Скрипт <textarea id="br-script" rows="14" spellcheck="false"></textarea></label><label><input id="br-tag-enabled" type="checkbox"> Tag successful devices</label><label>Success tag <input id="br-tag" maxlength="63"></label><label>Таймаут, сек <input id="br-timeout" type="number" min="1" max="86400" value="120"></label><p><button type="button" data-act="save">Сохранить шаблон</button> <button type="button" data-act="delete">Удалить шаблон</button></p><label>Потоки <input id="br-workers" type="number" min="1" max="100" value="10"></label><button type="button" data-act="run">Run Task</button> <button type="button" data-act="abort">Abort All</button> <button type="button" data-act="release" hidden>Release unknown task</button></section></div></div>';
    document.body.appendChild(button); document.body.appendChild(panel);
    // MeshCentral handles document-level keys for its device filter, console and terminal.
    // Keep keys inside this dialog while preserving the native behaviour of its controls.
    function isolateKeyboard(container) {
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
            container.addEventListener(type, function (event) { event.stopPropagation(); });
        });
    }
    isolateKeyboard(panel);
    function by(id) { return document.getElementById('br-' + id); }
    var now = new Date(), pad = function(n) { return String(n).padStart(2, '0'); }; by('tag').value = 'done_' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes());
    function refresh() { send('list'); send('current'); }
    button.onclick = function () { panel.hidden = false; refresh(); };
    panel.querySelector('[data-act=close]').onclick = function () { panel.hidden = true; };
    panel.onclick = function (e) { if (e.target === panel) panel.hidden = true; };
    function visible(n) {
        var group = by('group').value, q = by('search').value.toLowerCase(), tags = Array.from(by('tags').selectedOptions).map(function (x) { return x.value; });
        return (!group || n.meshid === group) && (!q || [n.name,n.ip,n.desc].join(' ').toLowerCase().includes(q)) && (!tags.length || (by('mode').value === 'and' ? tags.every(function (t) { return n.tags.includes(t); }) : tags.some(function (t) { return n.tags.includes(t); })));
    }
    function renderNodes() {
        var list = by('nodes'); list.replaceChildren();
        state.nodes.filter(visible).forEach(function (n) {
            var row = el('label', null, { class: 'br-node' }), check = el('input', null, { type: 'checkbox' }); check.checked = state.selected.has(n.id);
            check.onchange = function () { if (check.checked) state.selected.add(n.id); else state.selected.delete(n.id); count(); };
            row.append(check, document.createTextNode(' ' + n.name + ' · ' + (n.online ? 'Online' : 'Offline') + ' · ' + (n.os || 'OS неизвестна'))); list.appendChild(row);
        }); count();
    }
    function count() { var selected = state.nodes.filter(function (n) { return state.selected.has(n.id); }); var online = selected.filter(function (n) { return n.online; }).length; by('count').textContent = 'Выбрано: ' + selected.length + ' (Онлайн: ' + online + ', Офлайн: ' + (selected.length - online) + ')'; }
    ['group','search','tags','mode'].forEach(function (id) { by(id).onchange = renderNodes; by(id).oninput = renderNodes; });
    panel.querySelector('[data-act=select]').onclick = function () { state.nodes.filter(visible).forEach(function (n) { state.selected.add(n.id); }); renderNodes(); };
    panel.querySelector('[data-act=update-core]').onclick = function () {
        var ids = Array.from(state.selected);
        if (!ids.length) { by('error').textContent = 'Сначала выберите устройства.'; return; }
        if (!confirm('Установить стандартное ядро MeshCentral на выбранные устройства? Пользовательское ядро будет заменено, а сеансы могут кратковременно прерваться.')) return;
        meshserver.send({action: 'uploadagentcore', type: 'default', nodeids: ids});
        by('error').textContent = 'Обновление запрошено. Дождитесь переподключения агентов и повторите запуск; обновление ещё не подтверждено.';
    };
    panel.querySelector('[data-act=clear]').onclick = function () { state.selected.clear(); renderNodes(); };
    by('preset').onchange = function () { var p = state.presets.find(function (x) { return x.id === by('preset').value; }); by('name').value = p ? p.name : ''; by('description').value = p ? p.description : ''; by('script').value = p ? p.script_body : ''; by('timeout').value = p ? p.default_timeout : 120; if (p) by('os').value = p.target_os; };
    by('script').onkeydown = function (e) { if (e.key !== 'Tab') return; e.preventDefault(); var t = e.target, start = t.selectionStart; t.setRangeText('    ', start, t.selectionEnd, 'end'); };
    panel.querySelector('[data-act=save]').onclick = function () { send('save', { preset: { id: by('preset').value || undefined, name: by('name').value, description: by('description').value, target_os: by('os').value, script_body: by('script').value, default_timeout: Number(by('timeout').value) } }); };
    panel.querySelector('[data-act=delete]').onclick = function () { if (by('preset').value && confirm('Удалить выбранный шаблон?')) send('delete', { id: by('preset').value }); };
    var reports = el('section'); reports.innerHTML = '<h3>Task results</h3><button type="button" data-act="history">Task History</button> <button type="button" data-act="untag">Remove tag</button> <button type="button" data-act="json">Export JSON</button> <button type="button" data-act="csv">Export CSV</button><div id="br-results"></div>'; panel.querySelector('.br-panel').appendChild(reports);
    function renderTask(task) {
        state.task = task; panel.querySelector('[data-act=release]').hidden = task.status !== 'Unknown'; var box = by('results'); box.replaceChildren(el('p', task.task_id + ' - ' + task.status + (task.stats && task.stats.total ? ' | Success: ' + Math.round(100 * task.stats.success / task.stats.total) + '%' : '')));
        (task.results || []).forEach(function(r) { var row = el('div', null, { class:'br-node' }); row.append(document.createTextNode(r.node_name + ' | ' + r.status + ' | exit: ' + (r.exit_code == null ? '-' : r.exit_code) + ' | ' + (r.duration_sec == null ? '-' : r.duration_sec + ' s') + ' ')); var log = el('button','Logs',{type:'button'}); log.onclick = function(){ var dialog = el('div', null, {class:'br-overlay'}), content=el('div', null, {class:'br-panel'}), close=el('button','Close',{type:'button'}), out=el('pre',r.stdout || ''), stdout=el('button','STDOUT',{type:'button'}), stderr=el('button','STDERR',{type:'button'}), copy=el('button','Copy',{type:'button'}); out.style.whiteSpace='pre-wrap'; out.style.background='#111'; out.style.color='#a5e8ae'; stdout.onclick=function(){out.textContent=r.stdout || '';out.style.color='#a5e8ae';}; stderr.onclick=function(){out.textContent=r.stderr || '';out.style.color='#ffaaaa';}; copy.onclick=function(){navigator.clipboard.writeText(out.textContent);}; close.onclick=function(){dialog.remove();}; content.append(close,stdout,stderr,copy,out); dialog.appendChild(content); isolateKeyboard(dialog); document.body.appendChild(dialog); }; row.appendChild(log); box.appendChild(row); });
    }
    panel.querySelector('[data-act=run]').onclick = function () { if (!state.selected.size) { by('error').textContent = 'Select at least one device'; return; } send('run', { nodeids: Array.from(state.selected), target_os: by('os').value, script: by('script').value, timeout: Number(by('timeout').value), workers: Number(by('workers').value), success_tag: by('tag-enabled').checked ? by('tag').value : null }); };
    panel.querySelector('[data-act=release]').onclick = function () { if (state.task && state.task.status === 'Unknown' && confirm('The previous script may still be running on a device. Release the queue without retrying it?')) send('releaseUnknown', {task_id:state.task.task_id}); };
    panel.querySelector('[data-act=abort]').onclick = function () { send('abort'); };
    panel.querySelector('[data-act=untag]').onclick = function () { if (!state.task) return; var tag = prompt('Tag to remove from this task', state.task.applied_tag || by('tag').value); if (tag) send('untag', {task_id:state.task.task_id,tag:tag}); };
    panel.querySelector('[data-act=history]').onclick = function () { send('history'); };
    panel.querySelector('[data-act=json]').onclick = function () { if (!state.task) return; var a=el('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(state.task,null,2)],{type:'application/json'})); a.download=state.task.task_id+'.json'; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000); };
    panel.querySelector('[data-act=csv]').onclick = function () {
        if (!state.task) return;
        function csv(value) { var s = String(value == null ? '' : value); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
        var rows = [['TaskID','NodeName','NodeID','DeviceGroup','OS','Status','ExitCode','DurationSec','StdErrSummary']];
        state.task.results.forEach(function(r) { rows.push([state.task.task_id,r.node_name,r.node_id,r.device_group,r.os,r.status,r.exit_code,r.duration_sec,(r.stderr || '').split('\n')[0]]); });
        var a=el('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(function(row){return row.map(csv).join(',');}).join('\r\n')],{type:'text/csv;charset=utf-8'})); a.download=state.task.task_id+'.csv'; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
    };
    window.BulkRunner = { receive: function (m) {
        by('error').textContent = m.error || '';
        if (m.type === 'released') { panel.querySelector('[data-act=release]').hidden = true; by('error').textContent = 'Queue released; the previous result remains unknown.'; return; }
        if (m.type === 'untag') { by('error').textContent = 'Tags removed: ' + m.changed + '; errors: ' + m.errors; return; }
        if (m.type === 'task') { renderTask(m.task); return; }
        if (m.type === 'history') { var box=by('results'); box.replaceChildren(); m.tasks.forEach(function(t){var b=el('button',t.created_at+' | '+t.task_id+' | '+t.status,{type:'button'}); b.onclick=function(){renderTask(t);}; box.appendChild(b);}); return; }
        if (m.type === 'saved') { refresh(); return; }
        if (m.type !== 'list') return;
        state.nodes = m.nodes; state.meshes = m.meshes; state.presets = m.presets;
        var group = by('group').value, preset = by('preset').value, tags = Array.from(by('tags').selectedOptions).map(function (x) { return x.value; });
        by('group').replaceChildren(el('option', 'Все группы', { value: '' })); state.meshes.forEach(function (x) { by('group').appendChild(el('option', x.name, { value: x.id })); }); by('group').value = group;
        by('preset').replaceChildren(el('option', 'Новый шаблон', { value: '' })); state.presets.forEach(function (x) { by('preset').appendChild(el('option', x.name, { value: x.id })); }); by('preset').value = state.presets.some(function (x) { return x.id === preset; }) ? preset : '';
        by('tags').replaceChildren(); Array.from(new Set(state.nodes.flatMap(function (x) { return x.tags; }))).sort().forEach(function (t) { var o = el('option', t, { value: t }); o.selected = tags.includes(t); by('tags').appendChild(o); });
        renderNodes();
    } };
})();
