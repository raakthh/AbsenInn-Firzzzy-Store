/* AbsenInn — Owner: Notifications & Announcements */
(async function () {
  await Layout.init({ role: 'owner', page: 'notifications', title: 'Notifications' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  let tab = location.hash === '#announcements' ? 'announcements' : 'notifications', filter = 'all';

  el.innerHTML = `${Layout.pageHeader({ title: 'Notifications', subtitle: 'Kabar terbaru & pengumuman untuk karyawan.' })}
    <div class="card"><div class="tabs" style="padding:0 16px" role="tablist"><button class="tab ${tab === 'notifications' ? 'is-active' : ''}" data-tab="notifications">${icon('bell')}Notifikasi <span class="count" data-unread>0</span></button><button class="tab ${tab === 'announcements' ? 'is-active' : ''}" data-tab="announcements">${icon('megaphone')}Pengumuman</button></div><div data-panel>${UI.loading(5)}</div></div>`;

  async function render() { const p = $('[data-panel]'); p.onclick = null; try { await (tab === 'notifications' ? notifs(p) : anns(p)); } catch (e) { UI.errorState(p, e, render); } }

  async function notifs(p) {
    const list = await API.notifications.list();
    const unread = list.filter((n) => !n.read).length; $('[data-unread]').textContent = unread;
    const rows = filter === 'unread' ? list.filter((n) => !n.read) : list;
    p.innerHTML = `<div class="table-toolbar"><div class="segmented" role="group"><button data-f="all" class="${filter === 'all' ? 'is-active' : ''}">Semua (${list.length})</button><button data-f="unread" class="${filter === 'unread' ? 'is-active' : ''}">Belum dibaca (${unread})</button></div>
      <button class="btn btn-outline btn-sm" data-all style="margin-left:auto" ${unread ? '' : 'disabled'}>${icon('check-check', 15)}Tandai semua dibaca</button></div>
      <div data-list>${rows.length ? rows.map(Layout.notifRow).join('') : UI.empty(filter === 'unread' ? 'Semua sudah dibaca' : 'Belum ada notifikasi', 'Notifikasi pengajuan izin, tugas, payroll, dan absensi akan muncul di sini.', 'bell')}</div>`;
    Layout.bindNotifRows($('[data-list]', p));
    p.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    $('[data-all]', p).addEventListener('click', async () => { await API.notifications.readAll(); UI.toast('Semua notifikasi ditandai dibaca', 'success'); Layout.refreshBadges(); render(); });
  }

  async function anns(p) {
    const list = await API.announcements.list();
    p.innerHTML = `<div class="card-body grid grid-side-main" style="align-items:start">
      <form class="card" style="box-shadow:none" novalidate data-f><div class="card-header"><div class="card-title">Buat Pengumuman</div></div><div class="card-body" style="display:grid;gap:16px">
        ${UI.field({ name: 'title', label: 'Judul', required: true, placeholder: 'Mis. Libur nasional' })}
        ${UI.field({ name: 'body', label: 'Isi pengumuman', type: 'textarea', required: true, rows: 5 })}
        <label class="check"><input type="checkbox" name="pinned"> Sematkan di atas</label>
        <button class="btn btn-primary" type="submit">${icon('send')}Kirim ke semua karyawan</button></div></form>
      <div><div class="fw-700 mb-4">Pengumuman terkirim (${list.length})</div>${list.length ? list.map((a) => `<div class="card mb-4"><div class="card-body"><div class="flex justify-between gap-3"><div><div class="flex items-center gap-2">${a.pinned ? `<span class="badge badge-primary no-dot">${icon('flag', 12)} Disematkan</span>` : ''}<b>${esc(a.title)}</b></div><div class="text-xs text-3 mt-1">${Fmt.dateTime(a.created_at)}</div></div>
        <button class="btn btn-ghost btn-icon btn-sm text-danger" data-del="${a.id}" aria-label="Hapus pengumuman">${icon('trash', 16)}</button></div><p class="text-2 mt-3" style="white-space:pre-line">${esc(a.body)}</p></div></div>`).join('') : UI.empty('Belum ada pengumuman', '', 'megaphone')}</div></div>`;
    const form = $('[data-f]', p);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = UI.validate(form, { title: [UI.rules.required(), UI.rules.min(3)], body: [UI.rules.required(), UI.rules.min(10)] }); if (!d) return;
      const r = await UI.submit(form.querySelector('[type=submit]'), form, () => API.announcements.create(d));
      if (r) { UI.toast('Pengumuman terkirim ke semua karyawan aktif.', 'success'); render(); }
    });
    p.onclick = async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; if (!(await UI.confirm({ title: 'Hapus pengumuman?', confirmText: 'Hapus', tone: 'danger', ic: 'trash' }))) return; try { await API.announcements.remove(b.dataset.del); UI.toast('Pengumuman dihapus', 'success'); render(); } catch (err) { UI.apiError(err); } };
  }

  UI.tabs(el.querySelector('.card'), (t) => { tab = t; render(); });
  document.addEventListener('notifications:changed', () => { if (tab === 'notifications') render(); });
  render();
})();
