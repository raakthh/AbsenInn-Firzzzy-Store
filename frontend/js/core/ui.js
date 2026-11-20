/* =========================================================
   AbsenInn — Reusable UI components (vanilla JS)
   toast · modal · confirm · badges · avatar · states · table
   with search/pagination · tabs · form helpers
   ========================================================= */
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, s, c) => Icons.svg(n, s, c);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- Status dictionary (labels + badge tones) ---------- */
  const STATUS = {
    present: ['Hadir', 'success'], late: ['Terlambat', 'pending'], early_leave: ['Pulang Awal', 'pending'],
    sick: ['Sakit', 'info'], paid_leave: ['Cuti/Izin', 'primary'], unpaid_leave: ['Cuti Tdk Dibayar', 'muted'],
    absent: ['Absen', 'danger'], needs_review: ['Perlu Review', 'pending'], not_checked_in: ['Belum Check-in', 'muted'], unreconciled: ['Belum Direkonsiliasi', 'muted'],
    verified: ['Terverifikasi', 'success'], outside: ['Di Luar Lokasi', 'danger'], gps_unavailable: ['GPS Tidak Tersedia', 'muted'], not_configured: ['Lokasi Belum Diatur', 'muted'], reviewed: ['Sudah Direview', 'info'],
    pending: ['Menunggu', 'pending'], approved: ['Disetujui', 'success'], rejected: ['Ditolak', 'danger'], cancelled: ['Dibatalkan', 'muted'], applied: ['Diterapkan', 'success'],
    todo: ['To Do', 'muted'], in_progress: ['In Progress', 'info'], completed: ['Selesai', 'success'], overdue: ['Overdue', 'danger'],
    draft: ['Draft', 'muted'], pending_approval: ['Menunggu Approval', 'pending'], scheduled: ['Terjadwal', 'info'], paid: ['Dibayar', 'success'],
    active: ['Aktif', 'success'], inactive: ['Nonaktif', 'muted'],
  };
  const statusLabel = (s) => (STATUS[s] ? STATUS[s][0] : s || '—');
  const badge = (s, label) => `<span class="badge badge-${STATUS[s] ? STATUS[s][1] : 'muted'}">${esc(label || statusLabel(s))}</span>`;
  const priority = (p) => `<span class="prio prio-${p}">${{ high: 'High', medium: 'Medium', low: 'Low' }[p] || p}</span>`;

  function avatar(person, size = '') {
    const name = (person && (person.full_name || person.name)) || '?';
    const color = (person && person.avatar_color) || '#6C55F2';
    const img = person && person.photo_url ? `<img src="${esc(person.photo_url)}" alt="">` : esc(Fmt.initials(name));
    return `<span class="avatar ${size ? 'avatar-' + size : ''}" style="background:${esc(color)}" aria-hidden="true">${img}</span>`;
  }
  function person(p, sub) {
    if (!p) return '<span class="text-3">—</span>';
    return `<div class="person">${avatar(p, 'sm')}<div class="grow"><div class="person-name truncate">${esc(p.full_name)}</div>${sub !== false ? `<div class="person-sub truncate">${esc(sub || p.position || '')}</div>` : ''}</div></div>`;
  }

  /* ---------- States ---------- */
  const loading = (rows = 4) => `<div class="loader" role="status" aria-label="Memuat">${Array.from({ length: rows }, (_, i) => `<div class="skeleton" style="width:${90 - i * 12}%"></div>`).join('')}</div>`;
  const empty = (title, msg, ic = 'sparkles', action = '') => `<div class="state"><div class="state-icon">${icon(ic)}</div><div class="state-title">${esc(title)}</div>${msg ? `<p>${esc(msg)}</p>` : ''}${action}</div>`;
  function errorState(el, err, retry) {
    el.innerHTML = `<div class="state state-error"><div class="state-icon">${icon('alert-triangle')}</div><div class="state-title">Gagal memuat data</div><p>${esc((err && err.message) || 'Terjadi kesalahan')}</p>${retry ? '<button class="btn btn-outline btn-sm mt-2" data-retry>' + icon('refresh-cw') + 'Coba lagi</button>' : ''}</div>`;
    if (retry) el.querySelector('[data-retry]').addEventListener('click', retry);
  }
  /* Run an async loader into a container with loading / error / retry handling. */
  async function load(el, fn, rows) {
    el.innerHTML = loading(rows);
    try { await fn(); } catch (e) { console.error(e); errorState(el, e, () => load(el, fn, rows)); }
  }

  /* ---------- Toast ---------- */
  function toast(message, type = 'info', title) {
    let stack = $('.toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
    const ic = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
    const t = document.createElement('div');
    t.className = `toast toast-${type}`; t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = `<span class="toast-icon">${icon(ic, 20)}</span><div><div class="toast-title">${esc(title || { success: 'Berhasil', error: 'Gagal', warning: 'Perhatian', info: 'Info' }[type])}</div><div class="toast-msg">${esc(message)}</div></div><button class="toast-close" aria-label="Tutup">${icon('x', 16)}</button>`;
    const close = () => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 200); };
    t.querySelector('.toast-close').addEventListener('click', close);
    stack.appendChild(t); setTimeout(close, type === 'error' ? 6000 : 3800);
  }
  const apiError = (e, fallback) => toast((e && e.message) || fallback || 'Terjadi kesalahan', 'error');

  /* ---------- Modal ---------- */
  function modal({ title, subtitle = '', body = '', footer = '', size = '', onClose, dismissible = true } = {}) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal ${size ? 'modal-' + size : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-header"><div><div class="modal-title">${esc(title)}</div>${subtitle ? `<div class="modal-subtitle">${subtitle}</div>` : ''}</div>
      <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Tutup">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div>`;
    document.body.appendChild(bd);
    const prevFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => bd.classList.add('is-open'));
    let closed = false;
    const close = (result) => {
      if (closed) return; closed = true;
      bd.classList.remove('is-open'); document.removeEventListener('keydown', onKey);
      setTimeout(() => { bd.remove(); if (!$('.modal-backdrop')) document.body.style.overflow = ''; if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 180);
      if (onClose) onClose(result);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible && bd === $$('.modal-backdrop').pop()) close(); };
    document.addEventListener('keydown', onKey);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd && dismissible) close(); });
    $$('[data-close]', bd).forEach((b) => b.addEventListener('click', () => close()));
    const first = bd.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-footer .btn-primary');
    setTimeout(() => first && first.focus && first.focus(), 60);
    return { el: bd, body: $('.modal-body', bd), footer: $('.modal-footer', bd), close };
  }

  function confirm({ title = 'Konfirmasi', message = 'Lanjutkan?', confirmText = 'Ya, lanjutkan', cancelText = 'Batal', tone = 'primary', ic } = {}) {
    return new Promise((resolve) => {
      const toneIcon = ic || (tone === 'danger' ? 'alert-triangle' : tone === 'success' ? 'check-circle' : 'info');
      const m = modal({ title, size: 'sm',
        body: `<div class="confirm-icon tone-${tone === 'primary' ? 'primary' : tone}">${icon(toneIcon)}</div><p class="text-2">${message}</p>`,
        footer: `<button class="btn btn-outline" data-close>${esc(cancelText)}</button><button class="btn btn-${tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'}" data-ok>${esc(confirmText)}</button>`,
        onClose: (r) => resolve(r === true) });
      m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
    });
  }

  /* ---------- Forms ---------- */
  function field({ name, label, type = 'text', value = '', required = false, placeholder = '', options = null, hint = '', span = false, attrs = '', rows = 3 }) {
    const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
    let control;
    if (type === 'select') control = `<select class="select" id="${id}" name="${name}" ${required ? 'required' : ''} ${attrs}>${(options || []).map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    else if (type === 'textarea') control = `<textarea class="textarea" id="${id}" name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${attrs}>${esc(value)}</textarea>`;
    else control = `<input class="input" id="${id}" type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${attrs}>`;
    return `<div class="field ${span ? 'span-2' : ''}" data-field="${name}"><label class="label" for="${id}">${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>${control}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}<span class="field-error"></span></div>`;
  }
  function formData(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
    $$('input[type=checkbox][name]', form).forEach((c) => { if (!c.dataset.multi) out[c.name] = c.checked; });
    return out;
  }
  function clearErrors(form) { $$('.field', form).forEach((f) => { f.classList.remove('has-error'); const e = $('.field-error', f); if (e) e.textContent = ''; }); }
  function showErrors(form, errors) {
    clearErrors(form);
    let first = null;
    Object.entries(errors || {}).forEach(([k, msg]) => {
      const f = $(`[data-field="${k}"]`, form); if (!f) return;
      f.classList.add('has-error'); const e = $('.field-error', f); if (e) e.textContent = msg;
      if (!first) first = f.querySelector('input,select,textarea');
    });
    if (first) first.focus();
    return Object.keys(errors || {}).length > 0;
  }
  /* Client-side checks (server re-validates). rules: { name: [fn(value, data) → message|null] } */
  function validate(form, rules) {
    const data = formData(form); const errors = {};
    Object.entries(rules).forEach(([k, fns]) => { for (const fn of [].concat(fns)) { const m = fn(data[k], data); if (m) { errors[k] = m; break; } } });
    showErrors(form, errors);
    return Object.keys(errors).length ? null : data;
  }
  const rules = {
    required: (msg = 'Wajib diisi') => (v) => (v === undefined || v === null || String(v).trim() === '' ? msg : null),
    min: (n, msg) => (v) => (v && String(v).trim().length < n ? msg || `Minimal ${n} karakter` : null),
    email: (msg = 'Format email tidak valid') => (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? msg : null),
    phone: (msg = 'Nomor telepon tidak valid') => (v) => (v && !/^[0-9+\-\s()]{8,20}$/.test(v) ? msg : null),
    positive: (msg = 'Harus lebih dari 0') => (v) => (v !== '' && v != null && !(Number(v) > 0) ? msg : null),
  };
  /* Submit helper: button loading state + server validation mapping. */
  async function submit(btn, form, fn) {
    if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
    try { return await fn(); }
    catch (e) { if (e && e.code === 'VALIDATION' && form) showErrors(form, e.details); apiError(e); return undefined; }
    finally { if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; } }
  }

  /* ---------- Data table with search + pagination ---------- */
  function table(container, { columns, rows, pageSize = 10, emptyTitle = 'Belum ada data', emptyText = '', emptyIcon = 'database', onRow, rowClass } = {}) {
    let page = 1;
    function render() {
      const total = rows.length; const pages = Math.max(1, Math.ceil(total / pageSize)); page = Math.min(page, pages);
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      if (!total) { container.innerHTML = empty(emptyTitle, emptyText, emptyIcon); return; }
      container.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${slice.map((r, i) => `<tr data-i="${(page - 1) * pageSize + i}" class="${rowClass ? rowClass(r) : ''}" ${onRow ? 'style="cursor:pointer"' : ''}>${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${pages > 1 || total > 5 ? `<div class="pagination"><span>Menampilkan ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} dari ${total}</span><div class="pagination-pages">
        <button class="page-btn" data-pg="prev" ${page === 1 ? 'disabled' : ''} aria-label="Sebelumnya">${icon('chevron-left', 16)}</button>
        ${pageList(page, pages).map((p) => (p === '…' ? '<span class="page-btn" style="border:none">…</span>' : `<button class="page-btn ${p === page ? 'is-active' : ''}" data-pg="${p}">${p}</button>`)).join('')}
        <button class="page-btn" data-pg="next" ${page === pages ? 'disabled' : ''} aria-label="Berikutnya">${icon('chevron-right', 16)}</button></div></div>` : ''}`;
      $$('[data-pg]', container).forEach((b) => b.addEventListener('click', () => { const v = b.dataset.pg; page = v === 'prev' ? page - 1 : v === 'next' ? page + 1 : Number(v); render(); }));
      if (onRow) $$('tbody tr', container).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('button, a, input, select')) return; onRow(rows[Number(tr.dataset.i)]); }));
    }
    render();
    return { update(newRows) { rows = newRows; page = 1; render(); }, rerender: render };
  }
  function pageList(p, n) { if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1); const s = new Set([1, n, p, p - 1, p + 1]); const arr = [...s].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b); const out = []; arr.forEach((x, i) => { if (i && x - arr[i - 1] > 1) out.push('…'); out.push(x); }); return out; }

  /* ---------- Tabs ---------- */
  function tabs(root, onChange) {
    $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => {
      $$('[data-tab]', root).forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', x === b); });
      onChange(b.dataset.tab);
    }));
  }

  /* ---------- Dropdown ---------- */
  function dropdown(root) {
    const btn = $('[data-dd-toggle]', root);
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = !root.classList.contains('is-open'); $$('.dropdown.is-open').forEach((d) => d.classList.remove('is-open')); root.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open); });
  }
  document.addEventListener('click', (e) => { $$('.dropdown.is-open').forEach((d) => { if (!d.contains(e.target)) d.classList.remove('is-open'); }); });

  /* ---------- Misc ---------- */
  function downloadCSV(filename, columns, rows) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [columns.map((c) => q(c.label)).join(','), ...rows.map((r) => columns.map((c) => q(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function printModal(m) { document.body.classList.add('printing-modal'); window.print(); setTimeout(() => document.body.classList.remove('printing-modal'), 300); }
  const qs = (k) => new URLSearchParams(location.search).get(k);
  const selfiePlaceholder = (label) => `<div class="selfie-ph">${icon('scan-face')}<small>${esc(label || 'Placeholder demo — bukan foto asli')}</small></div>`;

  window.UI = { esc, icon, $, $$, STATUS, statusLabel, badge, priority, avatar, person, loading, empty, errorState, load, toast, apiError, modal, confirm, field, formData, clearErrors, showErrors, validate, rules, submit, table, tabs, dropdown, downloadCSV, printModal, qs, selfiePlaceholder };
})();
