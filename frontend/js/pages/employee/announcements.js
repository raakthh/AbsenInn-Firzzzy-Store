/* AbsenInn — Employee: Announcements */
(async function () {
  await Layout.init({ role: 'employee', page: 'announcements', title: 'Announcements' });
  const { icon, esc, $ } = UI;
  const el = $('#content');
  el.innerHTML = `${Layout.pageHeader({ title: 'Announcements', subtitle: 'Pengumuman dari owner perusahaan.' })}<div data-list>${UI.loading(5)}</div>`;
  async function load() {
    const box = $('[data-list]');
    try {
      const list = await API.announcements.list();
      box.innerHTML = list.length ? list.map((a) => `<article class="card mb-4"><div class="card-body"><div class="flex items-center gap-3"><span class="stat-icon tone-mint">${icon('megaphone')}</span><div class="grow"><div class="flex items-center gap-2 wrap"><h3>${esc(a.title)}</h3>${a.pinned ? `<span class="badge badge-primary no-dot">${icon('flag', 12)} Disematkan</span>` : ''}</div><div class="text-xs text-3">${Fmt.dateTime(a.created_at)}</div></div></div>
        <p class="text-2 mt-3" style="white-space:pre-line">${esc(a.body)}</p></div></article>`).join('') : `<div class="card">${UI.empty('Belum ada pengumuman', 'Pengumuman dari owner akan tampil di sini.', 'megaphone')}</div>`;
    } catch (e) { UI.errorState(box, e, load); }
  }
  load();
})();
