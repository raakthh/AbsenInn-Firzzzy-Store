/* =========================================================
   AbsenInn — App shell: sidebar, topbar, notifications,
   profile dropdown, mobile nav, splash/loading screen.
   Every protected page calls Layout.init({...}).
   ========================================================= */
(function () {
  const { icon, esc, $, $$ } = UI;

  const NAV = {
    owner: [
      { section: 'Utama' },
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: 'owner/dashboard.html' },
      { id: 'employees', label: 'Employees', icon: 'users', href: 'owner/employees.html' },
      { id: 'attendance', label: 'Attendance', icon: 'calendar-check', href: 'owner/attendance.html' },
      { id: 'leave', label: 'Leave Management', icon: 'file-text', href: 'owner/leave.html', badge: 'leave' },
      { id: 'tasks', label: 'Task Management', icon: 'clipboard-list', href: 'owner/tasks.html' },
      { section: 'Keuangan & Insight' },
      { id: 'payroll', label: 'Payroll', icon: 'wallet', href: 'owner/payroll.html' },
      { id: 'analytics', label: 'Performance Analytics', icon: 'trending-up', href: 'owner/analytics.html' },
      { id: 'reports', label: 'Reports', icon: 'file-bar-chart', href: 'owner/reports.html' },
      { section: 'Lainnya' },
      { id: 'notifications', label: 'Notifications', icon: 'bell', href: 'owner/notifications.html', badge: 'notif' },
      { id: 'settings', label: 'Settings', icon: 'settings', href: 'owner/settings.html' },
    ],
    employee: [
      { id: 'dashboard', label: 'My Dashboard', short: 'Beranda', icon: 'home', href: 'employee/dashboard.html', mobile: true },
      { id: 'attendance', label: 'My Attendance', short: 'Absensi', icon: 'calendar-check', href: 'employee/attendance.html', mobile: true },
      { id: 'leave', label: 'My Leave', short: 'Izin', icon: 'plane', href: 'employee/leave.html', mobile: true },
      { id: 'tasks', label: 'My Tasks', short: 'Tugas', icon: 'clipboard-list', href: 'employee/tasks.html', mobile: true },
      { id: 'payslip', label: 'My Payslip', short: 'Gaji', icon: 'wallet', href: 'employee/payslip.html', mobile: true },
      { id: 'profile', label: 'My Profile', icon: 'user', href: 'employee/profile.html' },
      { id: 'notifications', label: 'Notifications', icon: 'bell', href: 'employee/notifications.html', badge: 'notif' },
      { id: 'announcements', label: 'Announcements', icon: 'megaphone', href: 'employee/announcements.html' },
    ],
  };

  const NOTIF_ICON = {
    leave_request: ['file-text', 'pending'], leave_approved: ['check-circle', 'success'], leave_rejected: ['x-circle', 'danger'],
    task_assigned: ['clipboard-list', 'primary'], task_deadline: ['clock', 'danger'], task_completed: ['check-check', 'success'],
    salary_paid: ['banknote', 'success'], salary_upcoming: ['calendar', 'info'], salary_delayed: ['alert-triangle', 'danger'], payslip: ['receipt', 'primary'],
    payroll_approved: ['shield-check', 'success'], attendance_review: ['map-pin', 'pending'], attendance_reminder: ['clock', 'info'], attendance_corrected: ['pencil', 'info'],
    checkout_reminder: ['log-out', 'info'], reconcile_reminder: ['check-check', 'pending'], payroll_reminder: ['wallet', 'pending'],
    correction_request: ['history', 'pending'], correction_approved: ['check-circle', 'success'], correction_rejected: ['x-circle', 'danger'], announcement: ['megaphone', 'mint'],
  };
  const notifIcon = (type) => NOTIF_ICON[type] || ['bell', 'primary'];

  function brandHTML(compact) {
    return `<a class="brand" href="${Auth.root()}index.html" aria-label="AbsenInn beranda">
      <img class="brand-mark" src="${Auth.root()}assets/images/logo-mark.svg" alt="">
      ${compact ? '' : `<div><div class="brand-name">Absen<span>Inn</span></div><div class="brand-desc">${esc(APP_CONFIG.DESCRIPTOR)}</div></div>`}</a>`;
  }

  function showSplash() {
    if ($('.splash')) return;
    const s = document.createElement('div');
    s.className = 'splash';
    s.innerHTML = `<div class="splash-inner"><img class="splash-mark" src="${Auth.root()}assets/images/logo-mark.svg" alt=""><div class="brand-name">Absen<span style="color:var(--primary-500)">Inn</span></div><div class="splash-bar"></div></div>`;
    document.body.prepend(s);
  }
  function hideSplash() { const s = $('.splash'); if (s) { s.classList.add('is-hidden'); setTimeout(() => s.remove(), 400); } }

  const Layout = {
    session: null, role: null, page: null,

    async init({ role, page, title }) {
      if (Auth.blockedByFileProtocol) return new Promise(() => {});
      showSplash();
      const s = await Auth.guard(role);
      if (!s) return new Promise(() => {}); // redirecting
      Layout.session = s; Layout.role = role; Layout.page = page;
      document.title = `${title} · AbsenInn`;
      Layout.render(title);
      if (UI.qs('denied')) UI.toast('Anda tidak memiliki akses ke halaman tersebut.', 'warning', 'Akses dibatasi');
      await Layout.refreshBadges();
      if (!API.isDemo()) Layout.pollNotifications();
      setTimeout(hideSplash, 150);
      return s;
    },

    render(title) {
      const s = Layout.session, root = Auth.root(), items = NAV[Layout.role];
      const content = $('#content');
      const app = document.createElement('div');
      app.className = `app ${Layout.role === 'employee' ? 'app-employee' : 'app-owner'}`;
      const navHTML = items.map((it) => it.section ? `<div class="nav-section">${esc(it.section)}</div>` :
        `<a class="nav-link ${it.id === Layout.page ? 'is-active' : ''}" href="${root}${it.href}" ${it.id === Layout.page ? 'aria-current="page"' : ''}>${icon(it.icon)}<span>${esc(it.label)}</span>${it.badge ? `<span class="nav-badge hidden" data-badge="${it.badge}"></span>` : ''}</a>`).join('');

      app.innerHTML = `
        <aside class="sidebar" aria-label="Navigasi utama">
          <div class="sidebar-brand">${brandHTML()}</div>
          <nav class="sidebar-nav">${navHTML}</nav>
          <div class="sidebar-footer">
            ${Layout.role === 'owner' ? `<div class="sidebar-promo"><strong>${icon('shield-check', 14)} Data aman</strong>Gaji & bukti absensi hanya dapat diakses sesuai hak akses.</div>` : ''}
            <div class="sidebar-user">${UI.avatar(s, 'sm')}<div class="grow"><div class="fw-600 truncate">${esc(s.full_name)}</div><div class="text-xs text-3">${s.role === 'owner' ? 'Owner' : 'Employee'}</div></div>
            <button class="btn btn-ghost btn-icon btn-sm" data-logout aria-label="Keluar" title="Keluar">${icon('log-out', 16)}</button></div>
          </div>
        </aside>
        <div class="sidebar-overlay" data-close-sidebar></div>
        <div class="main">
          ${API.isDemo() ? `<div class="demo-banner no-print">${icon('sparkles')}<span><strong>Mode Demo</strong><span class="demo-long"> — data fiktif tersimpan di browser ini (bukan penyimpanan aman). Produksi memakai Supabase + Django.</span><span class="demo-short"> · data fiktif</span></span><button data-reset-demo>Reset demo</button></div>` : ''}
          <header class="topbar">
            <button class="icon-btn topbar-menu" data-open-sidebar aria-label="Buka menu">${icon('menu')}</button>
            <div class="topbar-title">${esc(title)}</div>
            ${Layout.role === 'owner' ? `<form class="topbar-search input-group" role="search" data-global-search>${icon('search')}<input class="input" name="q" placeholder="Cari karyawan…" aria-label="Cari karyawan"></form>` : '<div style="margin-left:auto"></div>'}
            <div class="topbar-actions">
              <div class="dropdown" data-notif-dd>
                <button class="icon-btn" data-dd-toggle aria-label="Notifikasi" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="dot hidden" data-badge="notif-dot"></span></button>
                <div class="dropdown-menu notif-menu" role="menu">
                  <div class="notif-menu-head"><b>Notifikasi</b><button class="btn btn-ghost btn-sm" data-read-all>${icon('check-check', 15)}Tandai dibaca</button></div>
                  <div class="notif-menu-list" data-notif-list>${UI.loading(3)}</div>
                  <div class="notif-menu-foot"><a class="card-link" href="${root}${Layout.role}/notifications.html">Lihat semua ${icon('arrow-right')}</a></div>
                </div>
              </div>
              <div class="dropdown" data-profile-dd>
                <button class="profile-btn" data-dd-toggle aria-haspopup="true" aria-expanded="false">${UI.avatar(s, 'sm')}<span class="profile-meta text-sm fw-600">${esc(s.full_name.split(' ')[0])}</span>${icon('chevron-down')}</button>
                <div class="dropdown-menu" role="menu">
                  <div class="dropdown-header"><div class="fw-700">${esc(s.full_name)}</div><div class="text-xs text-3">${esc(s.email)}</div></div>
                  <div class="dropdown-divider"></div>
                  ${Layout.role === 'owner'
                    ? `<a class="dropdown-item" href="${root}owner/settings.html">${icon('settings')}Settings</a><a class="dropdown-item" href="${root}owner/settings.html#account">${icon('user')}Akun saya</a>`
                    : `<a class="dropdown-item" href="${root}employee/profile.html">${icon('user')}My Profile</a><a class="dropdown-item" href="${root}employee/announcements.html">${icon('megaphone')}Announcements</a>`}
                  ${API.isDemo() ? '' : `<button class="dropdown-item" data-change-pw>${icon('key-round')}Ganti password</button>`}
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item danger" data-logout>${icon('log-out')}Keluar</button>
                </div>
              </div>
            </div>
          </header>
        </div>
        ${Layout.role === 'employee' ? `<nav class="bottom-nav" aria-label="Navigasi bawah">${items.filter((i) => i.mobile).map((i) => `<a href="${root}${i.href}" class="${i.id === Layout.page ? 'is-active' : ''}">${icon(i.icon)}<span>${esc(i.short)}</span></a>`).join('')}</nav>` : ''}`;
      content.parentNode.insertBefore(app, content);
      $('.main', app).appendChild(content);

      // Wiring
      $$('[data-logout]', app).forEach((b) => b.addEventListener('click', async () => { if (await UI.confirm({ title: 'Keluar dari AbsenInn?', message: 'Anda perlu login kembali untuk mengakses akun.', confirmText: 'Keluar', tone: 'danger', ic: 'log-out' })) Auth.logout(); }));
      $$('.dropdown', app).forEach(UI.dropdown);
      const open = $('[data-open-sidebar]', app); if (open) open.addEventListener('click', () => document.body.classList.add('sidebar-open'));
      $('[data-close-sidebar]', app).addEventListener('click', () => document.body.classList.remove('sidebar-open'));
      $('[data-read-all]', app).addEventListener('click', async (e) => { const btn = e.currentTarget; e.stopPropagation(); await API.notifications.readAll(); await Layout.refreshBadges(); UI.toast('Semua notifikasi ditandai dibaca', 'success'); document.dispatchEvent(new CustomEvent('notifications:changed')); });
      const cpw = $('[data-change-pw]', app); if (cpw) cpw.addEventListener('click', () => Layout.changePasswordDialog());
      const reset = $('[data-reset-demo]', app);
      if (reset) reset.addEventListener('click', async () => { if (await UI.confirm({ title: 'Reset data demo?', message: 'Semua perubahan pada data demo di browser ini akan dikembalikan ke data awal.', confirmText: 'Reset', tone: 'danger', ic: 'rotate-ccw' })) { DemoStore.reset(); location.reload(); } });
      const gs = $('[data-global-search]', app);
      if (gs) gs.addEventListener('submit', (e) => { e.preventDefault(); const q = gs.q.value.trim(); location.href = `${root}owner/employees.html${q ? '?q=' + encodeURIComponent(q) : ''}`; });
      window.addEventListener('scroll', () => $('.topbar', app).classList.toggle('is-scrolled', window.scrollY > 4), { passive: true });
    },

    async refreshBadges() {
      try {
        const list = await API.notifications.list();
        const unread = list.filter((n) => !n.read).length;
        $$('[data-badge="notif"], [data-badge="notif-dot"]').forEach((b) => { b.textContent = unread > 9 ? '9+' : unread; b.classList.toggle('hidden', !unread); });
        Layout.renderNotifMenu(list.slice(0, 6));
        if (Layout.role === 'owner') {
          const pending = (await API.leave.list({ status: 'pending' })).length;
          $$('[data-badge="leave"]').forEach((b) => { b.textContent = pending; b.classList.toggle('hidden', !pending); b.classList.add('soft'); });
        }
      } catch (e) { console.warn('badge refresh failed', e); }
    },

    /* Production: light polling (unread count only) so reminders & approvals appear without reloading. */
    pollNotifications(intervalMs = 60000) {
      if (Layout._poll) return;
      let last = null;
      const tick = async () => {
        if (document.hidden) return;
        try {
          const { unread } = await API.notifications.unreadCount();
          if (last !== null && unread !== last) { await Layout.refreshBadges(); document.dispatchEvent(new CustomEvent('notifications:changed')); }
          last = unread;
        } catch (e) { /* offline or session refresh — try again next tick */ }
      };
      tick();
      Layout._poll = setInterval(tick, intervalMs);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    },

    renderNotifMenu(list) {
      const el = $('[data-notif-list]'); if (!el) return;
      if (!list.length) { el.innerHTML = UI.empty('Tidak ada notifikasi', 'Semua kabar terbaru akan muncul di sini.', 'bell'); return; }
      el.innerHTML = list.map(Layout.notifRow).join('');
      Layout.bindNotifRows(el);
    },
    notifRow(n) {
      const [ic, tone] = notifIcon(n.type);
      return `<div class="notif-row ${n.read ? '' : 'is-unread'}" data-nid="${n.id}" data-link="${esc(n.link || '')}" role="button" tabindex="0">
        <span class="notif-ico tone-${tone}">${icon(ic)}</span><div class="grow"><div class="notif-title">${esc(n.title)}</div><div class="notif-msg">${esc(n.message)}</div><div class="notif-time">${Fmt.relative(n.created_at)}</div></div></div>`;
    },
    bindNotifRows(el) {
      $$('[data-nid]', el).forEach((row) => {
        const go = async () => { await API.notifications.read(row.dataset.nid); if (row.dataset.link) location.href = Auth.root() + row.dataset.link; else { row.classList.remove('is-unread'); Layout.refreshBadges(); } };
        row.addEventListener('click', go); row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      });
    },
    notifIcon,

    changePasswordDialog() {
      const m = UI.modal({ title: 'Ganti password', size: 'sm',
        body: `<form novalidate data-f style="display:grid;gap:16px">${UI.field({ name: 'password', label: 'Password baru', type: 'password', required: true, placeholder: 'Minimal 8 karakter', attrs: 'autocomplete="new-password"' })}${UI.field({ name: 'confirm', label: 'Ulangi password baru', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}</form>`,
        footer: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" data-ok>${icon('check')}Simpan</button>` });
      const f = m.el.querySelector('[data-f]');
      m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const d = UI.validate(f, { password: [UI.rules.required(), UI.rules.min(8, 'Minimal 8 karakter')], confirm: [UI.rules.required(), (v, x) => (v !== x.password ? 'Password tidak sama' : null)] });
        if (!d) return;
        const ok = await UI.submit(btn, f, () => Auth.changePassword(d.password));
        if (ok) { UI.toast('Password berhasil diubah.', 'success'); m.close(); }
      });
    },

    pageHeader({ title, subtitle = '', actions = '', crumbs = null }) {
      return `<div class="page-header"><div>${crumbs ? `<nav class="breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${Auth.root()}${c[1]}">${esc(c[0])}</a>${icon('chevron-right')}` : `<span>${esc(c[0])}</span>`)).join('')}</nav>` : ''}
        <h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
    },
  };
  window.Layout = Layout;
})();
