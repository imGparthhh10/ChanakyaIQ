/**
 * lists.js — Saved lists index & list-detail routes.
 *
 * URLs:
 *   #/lists           → index of all saved lists + Bookmarks pseudo-list
 *   #/lists/:id       → single list detail (members table + actions)
 *
 * Lists are localStorage-backed via the workspace store. The page
 * subscribes to workspace:lists:change so multi-tab edits stay in sync.
 */

import { bus }         from '../utils/eventBus.js';
import { qs, qsa, h } from '../utils/dom.js';
import { escapeHTML }  from '../utils/sanitize.js';
import { announce }    from '../utils/a11y.js';
import { CleanupRegistry } from '../utils/perf.js';
import { workspace }   from '../workspace/store.js';
import { dataEngine }  from '../data/data.js';
import { navigate }    from '../router.js';
import { Icon }        from '../components/icons.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(1) + ' Cr';
}

// ═══════════════════════════════════════════════════
// Lists index
// ═══════════════════════════════════════════════════

function renderIndex(container) {
  const lists = workspace.getLists();
  const bookmarks = workspace.getBookmarks();

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Workspace</span>
          <h1 class="page-title">Saved Lists</h1>
          <p class="page-sub">Curated collections of accounts for targeting, review, and hand-off.</p>
        </div>
        <div class="page-header-right">
          <button class="btn btn-primary" id="lists-create-btn">${svgIcon('plus')} New List</button>
        </div>
      </header>

      <section class="lists-grid">
        <a class="lists-card glass-panel" href="#/lists/_bookmarks">
          <div class="lists-card-icon lists-card-icon-star">${svgIcon('star')}</div>
          <div class="lists-card-body">
            <h3 class="lists-card-name">Bookmarks</h3>
            <p class="lists-card-desc">Every account you starred. Auto-updated.</p>
            <span class="lists-card-count">${bookmarks.length} companies</span>
          </div>
        </a>

        ${lists.length === 0 ? `
          <div class="lists-empty glass-panel">
            <div class="lists-empty-icon">${svgIcon('layers')}</div>
            <h3>No lists yet</h3>
            <p>Create your first list to organize targets by sector, region, campaign, or deal stage.</p>
            <button class="btn btn-primary" id="lists-empty-create">${svgIcon('plus')} Create your first list</button>
          </div>
        ` : lists.map(l => `
          <a class="lists-card glass-panel" href="#/lists/${encodeURIComponent(l.id)}">
            <div class="lists-card-icon">${svgIcon('layers')}</div>
            <div class="lists-card-body">
              <h3 class="lists-card-name">${escapeHTML(l.name)}</h3>
              <p class="lists-card-desc">Updated ${new Date(l.updatedAt).toLocaleDateString()}</p>
              <span class="lists-card-count">${l.count} companies</span>
            </div>
            <button class="lists-card-del icon-btn" data-list-id="${escapeHTML(l.id)}" aria-label="Delete list">🗑</button>
          </a>
        `).join('')}
      </section>
    </div>`;

  const cleanup = new CleanupRegistry();

  const createFn = () => {
    const name = prompt('Name your new list:');
    if (!name) return;
    const id = workspace.createList(name);
    if (id) navigate(`/lists/${id}`);
  };

  cleanup.addListener(qs('#lists-create-btn', container), 'click', createFn);
  const emptyBtn = qs('#lists-empty-create', container);
  if (emptyBtn) cleanup.addListener(emptyBtn, 'click', createFn);

  qsa('.lists-card-del', container).forEach(btn => {
    cleanup.addListener(btn, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.listId;
      const list = workspace.getList(id);
      if (!list) return;
      if (confirm(`Delete list "${list.name}"? This cannot be undone.`)) {
        workspace.deleteList(id);
        renderIndex(container);
      }
    });
  });

  cleanup.add(bus.on('workspace:lists:change', () => renderIndex(container)));
  cleanup.add(bus.on('workspace:bookmarks:change', () => renderIndex(container)));

  return () => cleanup.dispose();
}

// ═══════════════════════════════════════════════════
// List detail
// ═══════════════════════════════════════════════════

function resolveList(id) {
  if (id === '_bookmarks') {
    const bms = workspace.getBookmarks();
    return {
      id: '_bookmarks',
      name: 'Bookmarks',
      members: bms.map(b => b.key),
      synthetic: true,
    };
  }
  const list = workspace.getList(id);
  if (!list) return null;
  return { id, ...list };
}

function renderDetail(container, id) {
  const list = resolveList(id);
  if (!list) {
    container.innerHTML = `
      <div class="page-container">
        <section class="glass-panel c360-notfound">
          <div class="c360-nf-icon">🔍</div>
          <h2>List not found</h2>
          <p>This list may have been deleted.</p>
          <button class="btn btn-primary" onclick="location.hash='#/lists'">Back to Lists</button>
        </section>
      </div>`;
    return null;
  }

  const cache = dataEngine.cache;
  const members = cache
    ? list.members.map(k => cache.getAll().find(r => r._dedupeKey === k)).filter(Boolean)
    : [];

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel lists-detail-head">
        <div>
          <nav class="c360-breadcrumb" aria-label="Breadcrumb">
            <a href="#/lists">Lists</a> <span>/</span>
            <span class="c360-crumb-current">${escapeHTML(list.name)}</span>
          </nav>
          <h1 class="page-title">${escapeHTML(list.name)}</h1>
          <p class="page-sub">${members.length} companies · ${list.synthetic ? 'Auto-updated' : 'Manual list'}</p>
        </div>
        <div class="page-header-right">
          ${!list.synthetic ? `<button class="btn btn-ghost" id="list-rename">${svgIcon('edit')} Rename</button>` : ''}
          <button class="btn btn-ghost" id="list-export">${svgIcon('download')} Export</button>
          ${!list.synthetic ? `<button class="btn btn-ghost list-delete-btn" id="list-delete">${svgIcon('trash')} Delete</button>` : ''}
        </div>
      </header>

      <section class="glass-panel lists-members">
        ${members.length === 0 ? `
          <div class="lists-empty-inline">
            <p>No companies in this list yet.</p>
            <p class="lists-empty-hint">Add companies from Company 360 pages or search results.</p>
          </div>
        ` : `
          <table class="lists-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Sector</th>
                <th>Location</th>
                <th class="lists-num">Revenue</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${members.map(r => `
                <tr>
                  <td>
                    <a class="lists-row-name" href="#/company/${encodeURIComponent(r._dedupeKey)}">${escapeHTML(r.companyName)}</a>
                  </td>
                  <td class="lists-muted">${escapeHTML(r.category || '—')}</td>
                  <td class="lists-muted">${escapeHTML([r.hqCity, r.state].filter(Boolean).join(', ') || '—')}</td>
                  <td class="lists-num">${escapeHTML(fmt(r.revenue))}</td>
                  <td><span class="lists-status">${escapeHTML(workspace.getStatus(r._dedupeKey))}</span></td>
                  <td>
                    <button class="icon-btn lists-remove" data-key="${escapeHTML(r._dedupeKey)}" aria-label="Remove from list" title="Remove">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </section>
    </div>`;

  const cleanup = new CleanupRegistry();

  if (!list.synthetic) {
    cleanup.addListener(qs('#list-rename', container), 'click', () => {
      const name = prompt('Rename list:', list.name);
      if (name) { workspace.renameList(id, name); renderDetail(container, id); }
    });
    cleanup.addListener(qs('#list-delete', container), 'click', () => {
      if (confirm(`Delete list "${list.name}"? This cannot be undone.`)) {
        workspace.deleteList(id);
        navigate('/lists');
      }
    });
  }

  cleanup.addListener(qs('#list-export', container), 'click', () => {
    bus.emit('export:open');
  });

  qsa('.lists-remove', container).forEach(btn => {
    cleanup.addListener(btn, 'click', () => {
      const key = btn.dataset.key;
      if (list.synthetic) {
        workspace.toggleBookmark(key);
      } else {
        workspace.removeFromList(id, key);
      }
      renderDetail(container, id);
    });
  });

  cleanup.add(bus.on('workspace:lists:change', () => renderDetail(container, id)));
  cleanup.add(bus.on('workspace:bookmarks:change', () => {
    if (list.synthetic) renderDetail(container, id);
  }));

  return () => cleanup.dispose();
}

// ═══════════════════════════════════════════════════
// Router entries
// ═══════════════════════════════════════════════════

export async function mountListsIndex(container) {
  return renderIndex(container);
}

export async function mountListDetail(container, params) {
  return renderDetail(container, params.id);
}
