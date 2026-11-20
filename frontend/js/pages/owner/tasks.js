/* AbsenInn — Owner: Task Management */
(async function () {
  await Layout.init({ role: 'owner', page: 'tasks', title: 'Task Management' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  const st = { view: localStorage.getItem('absenninn_task_view') || 'board', assignee: '', priority: '', search: '' };
  let tasks = [], employees = [];
  const COLS = [['todo', 'To Do', 'muted'], ['in_progress', 'In Progress', 'info'], ['completed', 'Completed', 'success'], ['overdue', 'Overdue', 'danger']];

  el.innerHTML = `
    ${Layout.pageHeader({ title: 'Task Management', subtitle: 'Buat, bagikan, dan pantau progres pekerjaan tim.', actions: `<button class="btn btn-primary" data-new>${icon('plus')}Buat Tugas</button>` })}
    <div class="grid grid-4 stats-grid mb-4" data-summary></div>
    <div class="card mb-4"><div class="table-toolbar" style="border-bottom:none">
      <div class="input-group">${icon('search')}<input class="input input-sm" data-search placeholder="Cari tugas…"></div>
      <select class="select select-sm" data-assignee style="width:auto" aria-label="Filter karyawan"><option value="">Semua karyawan</option></select>
      <select class="select select-sm" data-priority style="width:auto" aria-label="Filter prioritas"><option value="">Semua prioritas</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <div class="segmented" style="margin-left:auto" role="group" aria-label="Tampilan"><button data-view="board" class="${st.view === 'board' ? 'is-active' : ''}">${icon('columns', 15)} Board</button><button data-view="list" class="${st.view === 'list' ? 'is-active' : ''}">${icon('list', 15)} List</button></div>
    </div></div>
    <div data-board>${UI.loading(6)}</div>`;

  async function reload() {
    try {
      [tasks, employees] = await Promise.all([API.tasks.list({}), API.employees.list({})]);
      const sel = $('[data-assignee]'); const cur = sel.value;
      sel.innerHTML = '<option value="">Semua karyawan</option>' + employees.map((e) => `<option value="${e.id}" ${cur === e.id ? 'selected' : ''}>${esc(e.full_name)}</option>`).join('');
      const s = Metrics.taskSummary(tasks);
      const stat = (ic, tone, v, l) => `<div class="card stat"><span class="stat-icon tone-${tone}">${icon(ic)}</span><div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div></div>`;
      $('[data-summary]').innerHTML = stat('clipboard-list', 'primary', s.total, 'Total tugas') + stat('activity', 'info', s.counts.in_progress, 'Sedang dikerjakan') + stat('check-circle', 'success', Fmt.percent(s.completionRate), 'Completion rate') + stat('alert-triangle', 'danger', s.counts.overdue, 'Overdue');
      render();
    } catch (e) { UI.errorState($('[data-board]'), e, reload); }
  }

  function filtered() {
    const t = st.search.toLowerCase();
    return tasks.filter((x) => (!st.assignee || x.assignee_id === st.assignee) && (!st.priority || x.priority === st.priority) && (!t || x.title.toLowerCase().includes(t) || (x.description || '').toLowerCase().includes(t)));
  }

  function card(t) {
    const dl = Fmt.diffDays(Fmt.today(), t.deadline);
    const dlText = t.status === 'completed' ? `Selesai ${Fmt.date(t.completed_at, 'short')}` : dl === 0 ? 'Hari ini' : dl < 0 ? `Terlambat ${-dl} hari` : `${dl} hari lagi`;
    return `<article class="task-card" data-open="${t.id}" tabindex="0" aria-label="${esc(t.title)}">
      <div class="flex justify-between items-center gap-2">${UI.priority(t.priority)}<span class="text-xs ${t.status_display === 'overdue' ? 'text-danger fw-600' : 'text-3'}">${icon('clock', 13)} ${dlText}</span></div>
      <div class="task-card-title">${esc(t.title)}</div>
      ${t.status !== 'todo' ? `<div><div class="progress"><div class="progress-bar ${t.progress === 100 ? 'is-success' : ''}" style="width:${t.progress}%"></div></div><div class="text-xs text-3 mt-1">${t.progress}%</div></div>` : ''}
      <div class="task-meta">${t.assignee ? `<span class="flex items-center gap-2">${UI.avatar(t.assignee, 'sm')}${esc(t.assignee.full_name.split(' ')[0])}</span>` : ''}<span>${Fmt.date(t.deadline, 'short')}</span></div></article>`;
  }

  function render() {
    const rows = filtered(), b = $('[data-board]');
    if (st.view === 'board') {
      b.innerHTML = `<div class="kanban">${COLS.map(([k, l, tone]) => { const items = rows.filter((t) => t.status_display === k); return `<section class="kanban-col" aria-label="${l}"><div class="kanban-head"><span class="flex items-center gap-2"><span class="badge badge-${tone} no-dot">${items.length}</span>${l}</span></div>${items.map(card).join('') || `<div class="text-xs text-3 text-center" style="padding:24px 8px">Tidak ada tugas</div>`}</section>`; }).join('')}</div>`;
    } else {
      b.innerHTML = '<div class="card" data-t></div>';
      UI.table($('[data-t]', b), { rows, pageSize: 10, emptyTitle: 'Tidak ada tugas', emptyIcon: 'clipboard-list', onRow: (t) => openDetail(t.id), columns: [
        { label: 'Tugas', render: (t) => `<div class="fw-600">${esc(t.title)}</div><div class="text-xs text-3 truncate" style="max-width:300px">${esc(t.description)}</div>` },
        { label: 'Karyawan', render: (t) => UI.person(t.assignee, false) }, { label: 'Prioritas', render: (t) => UI.priority(t.priority) }, { label: 'Deadline', render: (t) => Fmt.date(t.deadline) },
        { label: 'Progress', render: (t) => `<div class="progress" style="width:80px"><div class="progress-bar ${t.progress === 100 ? 'is-success' : ''}" style="width:${t.progress}%"></div></div>` },
        { label: 'Status', render: (t) => UI.badge(t.status_display) },
        { label: '', cls: 'col-actions', render: (t) => `<div class="flex gap-1"><button class="btn btn-ghost btn-icon btn-sm" data-edit="${t.id}" aria-label="Edit">${icon('pencil', 16)}</button><button class="btn btn-ghost btn-icon btn-sm text-danger" data-del="${t.id}" aria-label="Hapus">${icon('trash', 16)}</button></div>` }] });
    }
  }

  $('[data-board]').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) return openForm(tasks.find((t) => t.id === ed.dataset.edit));
    const del = e.target.closest('[data-del]'); if (del) return remove(tasks.find((t) => t.id === del.dataset.del));
    const o = e.target.closest('[data-open]'); if (o) openDetail(o.dataset.open);
  });
  $('[data-board]').addEventListener('keydown', (e) => { const o = e.target.closest('[data-open]'); if (o && e.key === 'Enter') openDetail(o.dataset.open); });

  function openForm(t) {
    const isNew = !t;
    const active = employees.filter((e) => e.employment_status === 'active' || (t && e.id === t.assignee_id));
    const m = UI.modal({ title: isNew ? 'Buat Tugas' : 'Edit Tugas', size: 'lg',
      body: `<form class="form-grid" novalidate data-f>
        ${UI.field({ name: 'title', label: 'Judul tugas', value: t ? t.title : '', required: true, span: true, placeholder: 'Mis. Packing order Shopee', attrs: 'list="task-examples"' })}
        <datalist id="task-examples">${['Packing Orders', 'Stock Checking', 'Upload Product', 'Customer Service', 'Order Processing', 'Administration'].map((x) => `<option value="${x}">`).join('')}</datalist>
        ${UI.field({ name: 'description', label: 'Deskripsi', type: 'textarea', value: t ? t.description : '', span: true, placeholder: 'Detail pekerjaan, target, atau catatan…' })}
        ${UI.field({ name: 'assignee_id', label: 'Ditugaskan ke', type: 'select', required: true, value: t ? t.assignee_id : '', options: [['', 'Pilih karyawan']].concat(active.map((e) => [e.id, `${e.full_name} — ${e.position}`])) })}
        ${UI.field({ name: 'priority', label: 'Prioritas', type: 'select', required: true, value: t ? t.priority : 'medium', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] })}
        ${UI.field({ name: 'deadline', label: 'Deadline', type: 'date', required: true, value: t ? t.deadline : Fmt.addDays(Fmt.today(), 1), attrs: isNew ? `min="${Fmt.today()}"` : '' })}
      </form>`,
      footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'Buat & Bagikan' : 'Simpan'}</button>` });
    const form = m.el.querySelector('[data-f]');
    m.el.querySelector('[data-save]').addEventListener('click', async (ev) => { const btn = ev.currentTarget;
      const r = UI.rules;
      const data = UI.validate(form, { title: [r.required(), r.min(3)], assignee_id: [r.required('Pilih karyawan')], deadline: [r.required(), (v) => (isNew && v < Fmt.today() ? 'Deadline tidak boleh di masa lalu' : null)] });
      if (!data) return;
      const saved = await UI.submit(btn, form, () => (isNew ? API.tasks.create(data) : API.tasks.update(t.id, data)));
      if (saved) { UI.toast(isNew ? `Tugas dibagikan ke ${saved.assignee.full_name}.` : 'Tugas diperbarui.', 'success'); m.close(); reload(); }
    });
  }

  async function remove(t) {
    if (!(await UI.confirm({ title: 'Hapus tugas?', message: `"<b>${esc(t.title)}</b>" beserta riwayatnya akan dihapus permanen.`, confirmText: 'Hapus', tone: 'danger', ic: 'trash' }))) return;
    try { await API.tasks.remove(t.id); UI.toast('Tugas dihapus.', 'success'); reload(); } catch (e) { UI.apiError(e); }
  }

  async function openDetail(id) {
    const m = UI.modal({ title: 'Detail Tugas', size: 'lg', body: UI.loading(6) });
    try {
      const t = await API.tasks.get(id);
      m.body.innerHTML = `<div class="flex items-center gap-2 wrap">${UI.badge(t.status_display)}${UI.priority(t.priority)}</div>
        <h2 class="mt-3">${esc(t.title)}</h2><p class="text-2 mt-2">${esc(t.description || 'Tidak ada deskripsi.')}</p>
        <dl class="kv mt-4"><dt>Ditugaskan ke</dt><dd>${UI.person(t.assignee)}</dd><dt>Deadline</dt><dd>${Fmt.date(t.deadline, 'long')}</dd><dt>Dibuat</dt><dd>${Fmt.dateTime(t.created_at)}</dd>
          <dt>Progress</dt><dd><div class="flex items-center gap-2"><div class="progress grow" style="max-width:220px"><div class="progress-bar ${t.progress === 100 ? 'is-success' : ''}" style="width:${t.progress}%"></div></div>${t.progress}%</div></dd></dl>
        <div class="field mt-4" style="max-width:260px"><label class="label" for="tk-st">Ubah status</label><select id="tk-st" class="select">${[['todo', 'To Do'], ['in_progress', 'In Progress'], ['completed', 'Completed']].map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="fw-700 mt-6 mb-4">Riwayat perubahan</div><div class="timeline">${[...t.history].reverse().map((h) => `<div class="tl-item"><span class="tl-dot"></span><div><div class="tl-title">${esc(h.action)}${h.from && h.to && h.from !== h.to ? `: ${UI.statusLabel(h.from)} → ${UI.statusLabel(h.to)}` : ''}</div><div class="tl-sub">${esc(h.by)} · ${Fmt.dateTime(h.at)}</div></div></div>`).join('')}</div>`;
      m.el.querySelector('.modal').insertAdjacentHTML('beforeend', `<div class="modal-footer"><button class="btn btn-danger-soft" data-del2 style="margin-right:auto">${icon('trash')}Hapus</button><button class="btn btn-outline" data-edit2>${icon('pencil')}Edit</button><button class="btn btn-primary" data-save-st>Simpan Status</button></div>`);
      m.el.querySelector('[data-edit2]').addEventListener('click', () => { m.close(); openForm(tasks.find((x) => x.id === id)); });
      m.el.querySelector('[data-del2]').addEventListener('click', () => { m.close(); remove(t); });
      m.el.querySelector('[data-save-st]').addEventListener('click', async (e) => { const btn = e.currentTarget;
        const v = m.el.querySelector('#tk-st').value; if (v === t.status) return m.close();
        const r = await UI.submit(btn, null, () => API.tasks.setStatus(id, v, v === 'in_progress' ? Math.max(t.progress, 10) : undefined));
        if (r) { UI.toast('Status tugas diperbarui.', 'success'); m.close(); reload(); }
      });
    } catch (e) { UI.errorState(m.body, e); }
  }

  let deb; $('[data-search]').addEventListener('input', (e) => { clearTimeout(deb); deb = setTimeout(() => { st.search = e.target.value.trim(); render(); }, 160); });
  $('[data-assignee]').addEventListener('change', (e) => { st.assignee = e.target.value; render(); });
  $('[data-priority]').addEventListener('change', (e) => { st.priority = e.target.value; render(); });
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { st.view = b.dataset.view; localStorage.setItem('absenninn_task_view', st.view); el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('is-active', x === b)); render(); }));
  $('[data-new]').addEventListener('click', () => openForm(null));
  await reload();
  if (UI.qs('new')) openForm(null);
})();
