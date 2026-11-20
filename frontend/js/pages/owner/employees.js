/* AbsenInn — Owner: Employee Management */
(async function () {
  await Layout.init({ role: 'owner', page: 'employees', title: 'Employees' });
  const { icon, esc, $, $$ } = UI;
  const root = Auth.root();
  const el = $('#content');
  const state = { search: UI.qs('q') || '', status: '', position: '', all: [] };

  el.innerHTML = `
    ${Layout.pageHeader({ title: 'Employees', subtitle: 'Kelola data, jabatan, dan status karyawan.', actions: `<button class="btn btn-primary" data-add>${icon('user-plus')}Tambah Karyawan</button>` })}
    <div class="grid grid-4 stats-grid mb-4" data-summary></div>
    <div class="card">
      <div class="table-toolbar">
        <div class="input-group">${icon('search')}<input class="input input-sm" data-search placeholder="Cari nama, email, ID…" value="${esc(state.search)}" aria-label="Cari karyawan"></div>
        <select class="select select-sm" data-status style="width:auto" aria-label="Filter status"><option value="">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select>
        <select class="select select-sm" data-position style="width:auto" aria-label="Filter jabatan"><option value="">Semua jabatan</option></select>
        <span class="text-sm text-3" data-count style="margin-left:auto"></span>
      </div>
      <div data-table>${UI.loading(6)}</div>
    </div>`;

  const tableEl = $('[data-table]');
  const tbl = UI.table(tableEl, {
    rows: [], pageSize: 8, emptyTitle: 'Karyawan tidak ditemukan', emptyText: 'Ubah kata kunci atau filter pencarian.', emptyIcon: 'users',
    onRow: (e) => { location.href = `${root}owner/employee-detail.html?id=${e.id}`; },
    columns: [
      { label: 'Karyawan', render: (e) => `<div class="person">${UI.avatar(e)}<div><div class="person-name">${esc(e.full_name)}</div><div class="person-sub">${esc(e.email)}</div></div></div>` },
      { label: 'ID', render: (e) => `<span class="mono text-2">${esc(e.employee_code)}</span>` },
      { label: 'Jabatan', render: (e) => `${esc(e.position)}<div class="text-xs text-3">${esc(e.employment_type || '')}</div>` },
      { label: 'Telepon', render: (e) => esc(e.phone || '—') },
      { label: 'Bergabung', render: (e) => Fmt.date(e.join_date) },
      { label: 'Status', render: (e) => UI.badge(e.employment_status) },
      { label: '', cls: 'col-actions', render: (e) => `<div class="flex gap-1" style="justify-content:flex-end">
        <a class="btn btn-ghost btn-icon btn-sm" href="${root}owner/employee-detail.html?id=${e.id}" title="Lihat detail" aria-label="Detail ${esc(e.full_name)}">${icon('eye', 16)}</a>
        <button class="btn btn-ghost btn-icon btn-sm" data-edit="${e.id}" title="Edit" aria-label="Edit ${esc(e.full_name)}">${icon('pencil', 16)}</button>
        <button class="btn btn-ghost btn-icon btn-sm ${e.employment_status === 'active' ? 'text-danger' : 'text-success'}" data-toggle="${e.id}" title="${e.employment_status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}" aria-label="${e.employment_status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${esc(e.full_name)}">${icon(e.employment_status === 'active' ? 'user-x' : 'user-check', 16)}</button></div>` },
    ],
  });

  function bindRowActions() {
    $$('[data-edit]', tableEl).forEach((b) => b.addEventListener('click', () => EmployeeForm.open(state.all.find((x) => x.id === b.dataset.edit), reload)));
    $$('[data-toggle]', tableEl).forEach((b) => b.addEventListener('click', () => EmployeeForm.toggleStatus(state.all.find((x) => x.id === b.dataset.toggle), reload)));
  }
  // Re-bind after every table render (pagination re-renders the body)
  new MutationObserver(bindRowActions).observe(tableEl, { childList: true });

  function apply() {
    const t = state.search.toLowerCase();
    const rows = state.all.filter((e) => (!state.status || e.employment_status === state.status) && (!state.position || e.position === state.position)
      && (!t || [e.full_name, e.email, e.employee_code, e.position, e.phone].some((v) => String(v || '').toLowerCase().includes(t))));
    $('[data-count]').textContent = `${rows.length} dari ${state.all.length} karyawan`;
    tbl.update(rows);
  }

  async function reload() {
    try {
      state.all = await API.employees.list({});
      const positions = [...new Set(state.all.map((e) => e.position))].sort();
      const sel = $('[data-position]'); const cur = sel.value;
      sel.innerHTML = '<option value="">Semua jabatan</option>' + positions.map((p) => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('');
      const active = state.all.filter((e) => e.employment_status === 'active').length;
      const newest = [...state.all].sort((a, b) => b.join_date.localeCompare(a.join_date))[0];
      const stat = (ic, tone, v, l) => `<div class="card stat"><span class="stat-icon tone-${tone}">${icon(ic)}</span><div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div></div>`;
      $('[data-summary]').innerHTML = stat('users', 'primary', state.all.length, 'Total karyawan') + stat('user-check', 'success', active, 'Aktif') + stat('user-x', 'muted', state.all.length - active, 'Nonaktif') + stat('briefcase', 'info', positions.length, `Jabatan${newest ? ' · terbaru: ' + esc(newest.full_name.split(' ')[0]) : ''}`);
      apply();
    } catch (e) { UI.errorState(tableEl, e, reload); }
  }

  let debounce;
  $('[data-search]').addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.search = e.target.value.trim(); apply(); }, 180); });
  $('[data-status]').addEventListener('change', (e) => { state.status = e.target.value; apply(); });
  $('[data-position]').addEventListener('change', (e) => { state.position = e.target.value; apply(); });
  $('[data-add]').addEventListener('click', () => EmployeeForm.open(null, reload));
  reload();
})();
