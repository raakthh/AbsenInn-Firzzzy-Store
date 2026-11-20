/* AbsenInn — Employee: My Tasks */
(async function () {
  await Layout.init({ role: 'employee', page: 'tasks', title: 'My Tasks' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  let filter = 'active', tasks = [];

  el.innerHTML = `${Layout.pageHeader({ title: 'My Tasks', subtitle: 'Tugas yang diberikan kepada Anda. Perbarui progres agar owner bisa memantau.' })}
    <div class="segmented mb-4" role="group"><button data-f="active" class="is-active">Aktif</button><button data-f="overdue">Overdue</button><button data-f="completed">Selesai</button><button data-f="all">Semua</button></div><div data-list>${UI.loading(5)}</div>`;

  async function load() { try { tasks = await API.tasks.list({}); render(); } catch (e) { UI.errorState($('[data-list]'), e, load); } }

  function render() {
    const rows = tasks.filter((t) => filter === 'all' || (filter === 'active' ? t.status !== 'completed' : t.status_display === filter));
    $('[data-list]').innerHTML = rows.length ? `<div class="grid grid-2">${rows.map((t) => {
      const dl = Fmt.diffDays(Fmt.today(), t.deadline);
      return `<div class="card"><div class="card-body"><div class="flex justify-between items-center gap-2">${UI.priority(t.priority)}${UI.badge(t.status_display)}</div>
        <h3 class="mt-3">${esc(t.title)}</h3><p class="text-sm text-2 mt-1">${esc(t.description || '')}</p>
        <div class="flex items-center gap-2 text-sm mt-3 ${t.status_display === 'overdue' ? 'text-danger' : 'text-3'}">${icon('calendar', 15)}Deadline ${Fmt.date(t.deadline)}${t.status !== 'completed' ? ` · ${dl === 0 ? 'hari ini' : dl < 0 ? `terlambat ${-dl} hari` : `${dl} hari lagi`}` : ''}</div>
        ${t.status !== 'completed' ? `<div class="mt-4"><div class="flex justify-between text-xs text-3 mb-4" style="margin-bottom:6px"><span>Progress</span><b data-pv="${t.id}">${t.progress}%</b></div><input type="range" min="0" max="100" step="10" value="${t.progress}" data-range="${t.id}" style="width:100%;accent-color:var(--primary-500)" aria-label="Progress ${esc(t.title)}"></div>
          <div class="flex gap-2 mt-4">${t.status === 'todo' ? `<button class="btn btn-secondary btn-sm" data-st="in_progress" data-id="${t.id}">${icon('activity', 15)}Mulai Kerjakan</button>` : `<button class="btn btn-outline btn-sm" data-save="${t.id}">${icon('check', 15)}Simpan Progress</button>`}<button class="btn btn-success btn-sm" data-st="completed" data-id="${t.id}">${icon('check-circle', 15)}Tandai Selesai</button></div>`
          : `<div class="alert alert-success mt-4">${icon('check-circle')}<div>Selesai ${Fmt.dateTime(t.completed_at)}</div></div>`}</div></div>`; }).join('')}</div>`
      : UI.empty(filter === 'overdue' ? 'Tidak ada tugas overdue' : 'Tidak ada tugas', filter === 'active' ? 'Semua tugas sudah selesai. 🎉' : '', 'clipboard-list');
  }

  const list = $('[data-list]');
  list.addEventListener('input', (e) => { const r = e.target.closest('[data-range]'); if (r) list.querySelector(`[data-pv="${r.dataset.range}"]`).textContent = r.value + '%'; });
  list.addEventListener('click', async (e) => { const btn = e.currentTarget;
    const b = e.target.closest('[data-st], [data-save]'); if (!b) return;
    const id = b.dataset.id || b.dataset.save; const range = list.querySelector(`[data-range="${id}"]`);
    let status = b.dataset.st, progress = range ? Number(range.value) : undefined;
    if (b.dataset.save) { status = progress >= 100 ? 'completed' : progress === 0 ? 'todo' : 'in_progress'; }
    if (status === 'in_progress' && b.dataset.st) progress = Math.max(10, progress || 0);
    if (status === 'completed' && !(await UI.confirm({ title: 'Tandai tugas selesai?', message: 'Owner akan menerima notifikasi bahwa tugas ini selesai.', confirmText: 'Ya, selesai', tone: 'success' }))) return;
    const r = await UI.submit(b, null, () => API.tasks.setStatus(id, status, progress));
    if (r) { UI.toast(status === 'completed' ? 'Tugas ditandai selesai.' : 'Progress diperbarui.', 'success'); load(); }
  });
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('is-active', x === b)); render(); }));
  load();
})();
