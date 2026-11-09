(function () {
    'use strict';
    if (window.BulkRunner) return;
    var state = { nodes: [], meshes: [], presets: [], selected: new Set() };
    function el(tag, text, attrs) { var e = document.createElement(tag); if (text != null) e.textContent = text; Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    function send(action, extra) { meshserver.send(Object.assign({ action: 'plugin', plugin: 'bulkrunner', pluginaction: action }, extra || {})); }
    var button = el('button', 'Bulk Script Runner 0.1', { type: 'button', class: 'br-open' });
    var panel = el('div', null, { class: 'br-overlay', hidden: '' });
    panel.innerHTML = '<div class="br-panel"><header><strong>Bulk Script Runner 0.1</strong><button type="button" data-act="close">×</button></header><p class="br-notice">Предварительная версия: выполнение скриптов пока отключено. Доступны выбор устройств и шаблоны.</p><div class="br-error" role="alert"></div><div class="br-columns"><section><h3>Устройства</h3><label>Группа <select id="br-group"><option value="">Все группы</option></select></label><label>Поиск <input id="br-search" placeholder="Имя, IP, описание"></label><label>Теги <select id="br-tags" multiple size="4"></select></label><label>Совпадение <select id="br-mode"><option value="and">Все теги (AND)</option><option value="or">Любой тег (OR)</option></select></label><p><button type="button" data-act="select">Выбрать видимые</button> <button type="button" data-act="clear">Снять выбор</button></p><p id="br-count"></p><div class="br-list" id="br-nodes"></div></section><section><h3>Скрипт и шаблоны</h3><label>Шаблон <select id="br-preset"><option value="">Новый шаблон</option></select></label><label>Название <input id="br-name"></label><label>Описание <input id="br-description"></label><label>Оболочка <select id="br-os"><option value="windows">PowerShell</option><option value="linux">Bash</option></select></label><label>Скрипт <textarea id="br-script" rows="14" spellcheck="false"></textarea></label><label>Таймаут, сек <input id="br-timeout" type="number" min="1" max="86400" value="120"></label><p><button type="button" data-act="save">Сохранить шаблон</button> <button type="button" data-act="delete">Удалить шаблон</button></p><label>Потоки <input type="number" value="10" disabled></label><button type="button" disabled title="Исполнитель ещё не реализован">Run Task</button></section></div></div>';
    document.body.appendChild(button); document.body.appendChild(panel);
    function by(id) { return document.getElementById('br-' + id); }
    function refresh() { send('list'); }
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
    panel.querySelector('[data-act=clear]').onclick = function () { state.selected.clear(); renderNodes(); };
    by('preset').onchange = function () { var p = state.presets.find(function (x) { return x.id === by('preset').value; }); by('name').value = p ? p.name : ''; by('description').value = p ? p.description : ''; by('script').value = p ? p.script_body : ''; by('timeout').value = p ? p.default_timeout : 120; if (p) by('os').value = p.target_os; };
    by('script').onkeydown = function (e) { if (e.key !== 'Tab') return; e.preventDefault(); var t = e.target, start = t.selectionStart; t.setRangeText('    ', start, t.selectionEnd, 'end'); };
    panel.querySelector('[data-act=save]').onclick = function () { send('save', { preset: { id: by('preset').value || undefined, name: by('name').value, description: by('description').value, target_os: by('os').value, script_body: by('script').value, default_timeout: Number(by('timeout').value) } }); };
    panel.querySelector('[data-act=delete]').onclick = function () { if (by('preset').value && confirm('Удалить выбранный шаблон?')) send('delete', { id: by('preset').value }); };
    window.BulkRunner = { receive: function (m) {
        by('error').textContent = m.error || '';
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
