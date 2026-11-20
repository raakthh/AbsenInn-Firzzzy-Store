/* AbsenInn — Employee: Notifications */
(async function () {
  await Layout.init({ role: 'employee', page: 'notifications', title: 'Notifications' });
  const { icon, $ } = UI;
  const el = $('#content');
  let filter = 'all';
  el.innerHTML = `${Layout.pageHeader({ title: 'Notifications', subtitle: 'Persetujuan izin, tugas baru, gaji, dan pengumuman.' })}<div class="card" data-card>${UI.loading(5)}</div>`;

  async function render() {
    const card = $('[data-card]');
    try {
      const list = await API.notifications.list(); const unread = list.filter((n) => !n.read).length;
      const rows = filter === 'unread' ? list.filter((n) => !n.read) : list;
      card.innerHTML = `<div class="table-toolbar"><div class="segmented" role="group"><button data-f="all" class="${filter === 'all' ? 'is-active' : ''}">Semua (${list.length})</button><button data-f="unread" class="${filter === 'unread' ? 'is-active' : ''}">Belum dibaca (${unread})</button></div>
        <button class="btn btn-outline btn-sm" data-all style="margin-left:auto" ${unread ? '' : 'disabled'}>${icon('check-check', 15)}Tandai semua dibaca</button></div>
        <div data-list>${rows.length ? rows.map(Layout.notifRow).join('') : UI.empty(filter === 'unread' ? 'Semua sudah dibaca' : 'Belum ada notifikasi', '', 'bell')}</div>`;
      Layout.bindNotifRows($('[data-list]', card));
      card.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
      $('[data-all]', card).addEventListener('click', async () => { await API.notifications.readAll(); UI.toast('Semua notifikasi ditandai dibaca', 'success'); Layout.refreshBadges(); render(); });
    } catch (e) { UI.errorState(card, e, render); }
  }
  document.addEventListener('notifications:changed', render);
  render();
})();
