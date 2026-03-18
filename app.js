// ============================================================
// PANTRY — app.js
// ============================================================

// ---- STATE ----
let SHEET_URL            = '';   // master script URL — set via window.PANTRY_MASTER_URL
let currentHouseholdCode = '';
let householdName        = '';
let db             = { categories: [], items: [] };
let shoppingList   = [];
let previousList   = [];
let refreshTimer   = null;
let activeListName = 'Main';
let allListNames   = ['Main'];
let noteDebounce   = null;
let pendingWrites  = 0;
let currentUser    = '';
let listDragSrcId  = null;

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  SHEET_URL            = window.PANTRY_MASTER_URL || '';
  currentUser          = localStorage.getItem('pantry_user') || '';
  activeListName       = localStorage.getItem('pantry_active_list') || 'Main';

  // Support ?code=tucker1 or legacy ?url=tucker1 in the URL
  const params     = new URLSearchParams(window.location.search);
  const paramCode  = params.get('code') || params.get('url');
  if (paramCode) {
    currentHouseholdCode = paramCode.toLowerCase();
    localStorage.setItem('pantry_household_code', currentHouseholdCode);
  } else {
    currentHouseholdCode = localStorage.getItem('pantry_household_code') || '';
  }
  householdName = localStorage.getItem('pantry_household_name') || '';

  if (!SHEET_URL) { showToast('Master URL not configured — see config.js'); return; }

  if (currentHouseholdCode) {
    // Refresh household name from master if not cached
    if (!householdName) {
      fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'resolveCode', code: currentHouseholdCode })
      }).then(r => r.json()).then(data => {
        if (data.ok && data.exists) {
          householdName = data.householdName || currentHouseholdCode;
          localStorage.setItem('pantry_household_name', householdName);
          updateUserDisplay();
        }
      }).catch(() => {});
    }
    if (!currentUser) promptForUsername();
    else launchApp();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ---- USERNAME ----
function promptForUsername() {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Who are you?</h2>' +
    '<p style="color:var(--ink-light);font-size:14px;margin-bottom:16px;">Enter your name so others can see who added items to the list.</p>' +
    '<input class="modal-input" id="username-input" placeholder="e.g. Mom, Dad, Alex…" autofocus />' +
    '<div class="modal-actions">' +
      '<button class="btn-primary" onclick="saveUsername()">Continue</button>' +
    '</div>';
  document.getElementById('generic-modal').classList.add('active');
}

function saveUsername() {
  const name = document.getElementById('username-input').value.trim();
  if (!name) { showToast('Please enter your name'); return; }
  currentUser = name;
  localStorage.setItem('pantry_user', currentUser);
  closeModal();
  launchApp();
}

function changeUsername() {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Change Your Name</h2>' +
    '<input class="modal-input" id="username-input" value="' + esc(currentUser) + '" autofocus />' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveUsername()">Save</button>' +
    '</div>';
  openModal();
}

// ---- SETUP ----
async function connectWithCode() {
  const code = document.getElementById('household-code-input').value.trim().toLowerCase();
  if (!code) { showToast('Please enter your household code'); return; }
  showToast('Looking up code…');
  // Verify code exists via master script
  const res = await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'resolveCode', code })
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok || !data.exists) {
    showToast('Code not found — check with whoever set up your Pantry');
    return;
  }
  currentHouseholdCode = code;
  householdName        = data.householdName || code;
  localStorage.setItem('pantry_household_code', code);
  localStorage.setItem('pantry_household_name', householdName);
  if (!currentUser) promptForUsername();
  else launchApp();
}

function showSetup() {
  document.getElementById('setup-modal').classList.add('active');
  document.getElementById('app').classList.add('hidden');
}

function openSetup() {
  document.getElementById('household-code-input').value = currentHouseholdCode;
  document.getElementById('setup-modal').classList.add('active');
}

function launchApp() {
  document.getElementById('setup-modal').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('hidden'));
  updateUserDisplay();
  loadAll();
  startAutoRefresh();
}

function updateUserDisplay() {
  const name = currentUser || 'Set name';
  const el   = document.getElementById('sidebar-username');
  if (el) el.textContent = name;
  const elm  = document.getElementById('sidebar-username-mobile');
  if (elm) elm.textContent = name;
  const hn = document.getElementById('sidebar-household-name');
  if (hn) hn.textContent = householdName || currentHouseholdCode;
}

// ---- SHEET API ----
async function sheetCall(payload) {
  const res  = await fetch(SHEET_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ ...payload, householdCode: currentHouseholdCode })
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: text }; }
}

// ---- LOAD ALL ----
async function loadAll() {
  showDbLoading(true);
  try {
    const result = await sheetCall({ action: 'getAll', listName: activeListName });
    if (result.ok) {
      db.categories = result.categories || [];
      db.items      = result.items      || [];
      shoppingList  = result.list       || [];
      allListNames  = result.listNames  || [activeListName];
      if (!allListNames.includes(activeListName)) allListNames.push(activeListName);
      updateListBadge();
      updateListDropdown();
      renderDatabase();
      setNote(result.note || '');
      if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
    } else {
      showToast('Error loading data: ' + (result.error || 'Unknown'));
    }
  } catch (e) {
    showToast('Could not reach your Sheet. Check your URL in Settings.');
  }
  showDbLoading(false);
}

// ---- LOAD LIST ----
async function loadList(silent, force) {
  try {
    const result = await sheetCall({ action: 'getList', listName: activeListName });
    if (result.ok) {
      if (!force && result.list.length === 0 && shoppingList.length > 0) return;
      shoppingList = result.list || [];
      updateListBadge();
      if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
      renderDatabase();
    }
  } catch (e) {
    if (!silent) showToast('Could not refresh list.');
  }
}

// ---- AUTO REFRESH ----
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (pendingWrites > 0) return;
    loadList(true);
    loadNote(true);
  }, 60000);
}

// ---- LIST SELECTOR ----
function updateListDropdown() {
  const options = allListNames.map(n =>
    '<option value="' + esc(n) + '"' + (n === activeListName ? ' selected' : '') + '>' + esc(n) + '</option>'
  ).join('') + '<option value="__new__">+ New list…</option>';
  document.querySelectorAll('#list-selector, .mobile-list-selector-row select').forEach(sel => {
    if (sel) sel.innerHTML = options;
  });
}

async function onListSelect(e) {
  const val = e.target.value;
  if (val === '__new__') { e.target.value = activeListName; openNewNamedListModal(); return; }
  await switchList(val);
}

async function switchList(name) {
  activeListName = name;
  localStorage.setItem('pantry_active_list', activeListName);
  shoppingList = []; // clear immediately so old list doesn't show
  updateListBadge();
  if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
  updateListDropdown();
  showToast('Loading "' + name + '"…');
  await loadList(false, true);
  await loadNote(true);
  renderDatabase();
}

// ---- COLLAPSED CATEGORIES ----
let collapsedCats = new Set(JSON.parse(localStorage.getItem('pantry_collapsed_cats') || '[]'));

function saveCollapsedCats() {
  localStorage.setItem('pantry_collapsed_cats', JSON.stringify([...collapsedCats]));
}

function toggleCategory(catId) {
  if (collapsedCats.has(catId)) collapsedCats.delete(catId);
  else collapsedCats.add(catId);
  saveCollapsedCats();
  renderDatabase();
}

// ---- RENDER DATABASE ----
function renderDatabase() {
  const container = document.getElementById('categories-container');
  const empty     = document.getElementById('db-empty');
  container.innerHTML = '';
  if (db.categories.length === 0) {
    container.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  empty.classList.add('hidden');

  db.categories.forEach(cat => {
    container.appendChild(makeCategoryCard(cat, collapsedCats.has(cat.id)));
  });

  initCatDragAndDrop();
  initItemDragAndDrop();
}

function makeCategoryCard(cat, collapsed) {
  const catItems    = db.items.filter(i => i.category === cat.id);
  const inListCount = catItems.filter(i => shoppingList.some(s => s.itemId === i.id)).length;
  const card        = document.createElement('div');
  card.className    = 'category-card' + (collapsed ? ' collapsed' : '');
  card.id           = 'cat-card-' + cat.id;
  card.draggable    = true;
  card.dataset.catId = cat.id;
  const aisleLabel  = cat.aisle ? '<span class="category-aisle">Aisle ' + esc(cat.aisle) + '</span>' : '';
  const listBadge   = (collapsed && inListCount > 0)
    ? '<span class="cat-list-badge">' + inListCount + ' on list</span>' : '';
  card.innerHTML =
    '<div class="category-header" onclick="toggleCategory(\'' + cat.id + '\')">' +
      '<span class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">⠿</span>' +
      '<span class="category-collapse-icon">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span class="category-name">' + esc(cat.name) + '</span>' +
      aisleLabel +
      listBadge +
      '<div class="category-actions" onclick="event.stopPropagation()">' +
        '<button class="btn-icon" title="Edit" onclick="editCategory(\'' + cat.id + '\',\'' + esc(cat.name) + '\',\'' + esc(cat.aisle||'') + '\')">✎</button>' +
        '<button class="btn-icon" title="Delete" onclick="deleteCategory(\'' + cat.id + '\')">🗑</button>' +
      '</div>' +
    '</div>' +
    '<div class="category-items" id="cat-items-' + cat.id + '">' +
      (collapsed ? '' : catItems.map(i => renderItemRow(i)).join('')) +
    '</div>' +
    (collapsed ? '' :
      '<div class="category-add-item">' +
        '<button class="category-add-item-btn" onclick="openAddItem(\'' + cat.id + '\')">+ add item</button>' +
      '</div>'
    );
  return card;
}

function renderItemRow(item) {
  const inList   = shoppingList.some(s => s.itemId === item.id);
  const listItem = shoppingList.find(s => s.itemId === item.id);
  const rowClick = inList
    ? 'removeFromList(\'' + item.id + '\')'
    : 'addToList(\'' + item.id + '\',1)';
  const qtyBtn = inList
    ? '<button class="item-qty-btn item-qty-btn--active" onclick="openEditQty(\'' + listItem.id + '\');event.stopPropagation()" title="Change quantity">×' + listItem.qty + '</button>'
    : '<button class="item-qty-btn" onclick="openAddWithQty(\'' + item.id + '\');event.stopPropagation()" title="Add with quantity">+qty</button>';
  return '<div class="item-row ' + (inList ? 'in-list' : '') + '" id="item-row-' + item.id + '" draggable="true" data-item-id="' + item.id + '" onclick="' + rowClick + '">' +
    '<span class="item-drag-handle" onclick="event.stopPropagation()">⠿</span>' +
    '<span class="item-dot"></span>' +
    qtyBtn +
    '<span class="item-name">' + esc(item.name) + '</span>' +
    '<div class="item-actions">' +
      '<button class="btn-icon" onclick="deleteItem(\'' + item.id + '\');event.stopPropagation()">🗑</button>' +
    '</div>' +
  '</div>';
}

// ---- CATEGORY DRAG AND DROP ----
function initCatDragAndDrop() {
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      catDragSrcId = card.dataset.catId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.category-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.category-card').forEach(c => c.classList.remove('drag-over'));
      if (card.dataset.catId !== catDragSrcId) card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!catDragSrcId || card.dataset.catId === catDragSrcId) return;
      card.classList.remove('drag-over');
      const srcIdx  = db.categories.findIndex(c => c.id === catDragSrcId);
      const destIdx = db.categories.findIndex(c => c.id === card.dataset.catId);
      const [moved] = db.categories.splice(srcIdx, 1);
      db.categories.splice(destIdx, 0, moved);
      renderDatabase();
      sheetCall({ action: 'reorderCategories', orderedIds: db.categories.map(c => c.id) });
    });
  });
}

// ---- ITEM DRAG AND DROP (within category) ----
let itemDragSrcId  = null;
let itemDragCatId  = null;

function initItemDragAndDrop() {
  document.querySelectorAll('.category-items').forEach(container => {
    container.querySelectorAll('.item-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        itemDragSrcId = row.dataset.itemId;
        itemDragCatId = row.closest('.category-card').dataset.catId;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation(); // don't trigger category drag
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        if (row.dataset.itemId === itemDragSrcId) return;
        document.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!itemDragSrcId || row.dataset.itemId === itemDragSrcId) return;
        row.classList.remove('drag-over');
        // Only reorder within the same category
        const destCatId = row.closest('.category-card').dataset.catId;
        if (destCatId !== itemDragCatId) return;
        const catItems  = db.items.filter(i => i.category === itemDragCatId);
        const srcIdx    = catItems.findIndex(i => i.id === itemDragSrcId);
        const destIdx   = catItems.findIndex(i => i.id === row.dataset.itemId);
        if (srcIdx === -1 || destIdx === -1) return;
        // Reorder in db.items
        const allSrcIdx  = db.items.findIndex(i => i.id === itemDragSrcId);
        const allDestIdx = db.items.findIndex(i => i.id === row.dataset.itemId);
        const [moved] = db.items.splice(allSrcIdx, 1);
        db.items.splice(allDestIdx, 0, moved);
        renderDatabase();
        // Persist new item order
        sheetCall({ action: 'reorderItems', categoryId: itemDragCatId, orderedIds: db.items.filter(i => i.category === itemDragCatId).map(i => i.id) });
      });
    });
  });
}
function renderShoppingList() {
  const container = document.getElementById('list-container');
  const empty     = document.getElementById('list-empty');
  const loading   = document.getElementById('list-loading');
  if (loading) loading.classList.add('hidden');
  container.innerHTML = '';

  if (shoppingList.length === 0) {
    container.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  empty.classList.add('hidden');

  const catOrder   = db.categories.map(c => c.name);
  const byCategory = {};
  shoppingList.forEach(item => {
    const catName = item.category || 'Other';
    if (!byCategory[catName]) byCategory[catName] = [];
    byCategory[catName].push(item);
  });
  // Each category's items are already sorted by sortOrder from the sheet
  const sortedCatNames = Object.keys(byCategory).sort((a, b) => {
    const ai = catOrder.indexOf(a), bi = catOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  });

  sortedCatNames.forEach(catName => {
    const cat      = db.categories.find(c => c.name === catName);
    const aisleTag = cat && cat.aisle ? ' <span class="list-aisle-tag">Aisle ' + esc(cat.aisle) + '</span>' : '';
    const section  = document.createElement('div');
    section.className = 'list-section';
    section.innerHTML =
      '<div class="list-section-header">' +
        '<span class="list-section-title">' + esc(catName) + '</span>' + aisleTag +
      '</div>';
    byCategory[catName].forEach(item => {
      const card = document.createElement('div');
      card.innerHTML = renderListItemCard(item);
      section.appendChild(card.firstElementChild);
    });
    container.appendChild(section);
  });

  updateListBadge();
  initListDragAndDrop();
  initSwipeToCheck();
}

function renderListItemCard(item) {
  const addedByTag = item.addedBy ? '<span class="list-item-addedby">' + esc(item.addedBy) + '</span>' : '';
  const notePreview = item.note ? '<div class="list-item-note-preview">' + esc(item.note) + '</div>' : '';
  return '<div class="list-item-card ' + (item.checked ? 'checked' : '') + '" id="list-card-' + item.id + '" draggable="true" data-list-id="' + item.id + '">' +
    '<span class="list-drag-handle">⠿</span>' +
    '<div class="check-box" onclick="toggleCheck(\'' + item.id + '\')">' + (item.checked ? '✓' : '') + '</div>' +
    '<div class="list-item-body">' +
      '<div class="list-item-main">' +
        '<span class="list-item-name">' + esc(item.name) + '</span>' +
        addedByTag +
      '</div>' +
      notePreview +
    '</div>' +
    '<div class="qty-control">' +
      '<button class="qty-btn" onclick="changeQty(\'' + item.id + '\',-1)">−</button>' +
      '<span class="qty-display" id="qty-' + item.id + '">' + item.qty + '</span>' +
      '<button class="qty-btn" onclick="changeQty(\'' + item.id + '\',1)">+</button>' +
    '</div>' +
    '<button class="list-note-btn" title="Add note" onclick="openItemNote(\'' + item.id + '\')">💬</button>' +
    '<button class="list-delete-btn" onclick="removeListItem(\'' + item.id + '\')">✕</button>' +
  '</div>';
}

// ---- LIST ITEM DRAG AND DROP ----
function initListDragAndDrop() {
  const container = document.getElementById('list-container');
  container.querySelectorAll('.list-item-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      listDragSrcId = card.dataset.listId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.list-item-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.list-item-card').forEach(c => c.classList.remove('drag-over'));
      if (card.dataset.listId !== listDragSrcId) card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!listDragSrcId || card.dataset.listId === listDragSrcId) return;
      card.classList.remove('drag-over');
      const srcIdx  = shoppingList.findIndex(i => i.id === listDragSrcId);
      const destIdx = shoppingList.findIndex(i => i.id === card.dataset.listId);
      if (srcIdx === -1 || destIdx === -1) return;
      const [moved] = shoppingList.splice(srcIdx, 1);
      shoppingList.splice(destIdx, 0, moved);
      // Update sortOrder in memory
      shoppingList.forEach((item, idx) => item.sortOrder = idx);
      renderShoppingList();
      pendingWrites++;
      sheetCall({ action: 'reorderList', listName: activeListName, orderedIds: shoppingList.map(i => i.id) })
        .then(() => pendingWrites--);
    });
  });
}

// ---- LIST ACTIONS ----
async function addToList(itemId, qty) {
  qty = qty || 1;
  if (shoppingList.some(s => s.itemId === itemId)) return;
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  const cat      = db.categories.find(c => c.id === item.category);
  const maxSort  = shoppingList.reduce((m, i) => Math.max(m, i.sortOrder || 0), -1);
  const listItem = {
    id:        'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId:    item.id,
    name:      item.name,
    category:  cat ? cat.name : 'Other',
    qty,
    checked:   false,
    sortOrder: maxSort + 1,
    addedBy:   currentUser,
    note:      '',
    listName:  activeListName
  };
  shoppingList.push(listItem);
  updateListBadge();
  refreshItemRow(itemId);
  showToast('"' + item.name + '" added to ' + activeListName + (qty > 1 ? ' (×' + qty + ')' : ''));
  pendingWrites++;
  const result = await sheetCall({ action: 'addToList', ...listItem });
  pendingWrites--;
  if (!result.ok) {
    showToast('Error saving to sheet');
    shoppingList = shoppingList.filter(s => s.id !== listItem.id);
    updateListBadge();
    refreshItemRow(itemId);
  }
}

function openEditQty(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Change Quantity</h2>' +
    '<p style="font-size:15px;color:var(--ink-mid);margin-bottom:16px;">' + esc(item.name) + '</p>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">' +
      '<button class="qty-btn" style="font-size:20px;width:36px;height:36px;background:var(--cream);border:1.5px solid var(--parchment);border-radius:6px;" onclick="adjustModalQty(-1)">−</button>' +
      '<span id="modal-qty-display" style="font-size:20px;font-weight:700;min-width:32px;text-align:center;">' + item.qty + '</span>' +
      '<button class="qty-btn" style="font-size:20px;width:36px;height:36px;background:var(--cream);border:1.5px solid var(--parchment);border-radius:6px;" onclick="adjustModalQty(1)">+</button>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="confirmEditQty(\'' + listId + '\')">Update</button>' +
    '</div>';
  openModal();
}

async function confirmEditQty(listId) {
  const qty = parseInt(document.getElementById('modal-qty-display').textContent) || 1;
  closeModal();
  await changeQty(listId, qty - shoppingList.find(i => i.id === listId)?.qty || 0);
  renderDatabase();
}

function openAddWithQty(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Add to List</h2>' +
    '<p style="font-size:15px;color:var(--ink-mid);margin-bottom:16px;">' + esc(item.name) + '</p>' +
    '<label class="modal-label">Quantity</label>' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">' +
      '<button class="qty-btn" style="font-size:20px;width:36px;height:36px;background:var(--cream);border:1.5px solid var(--parchment);border-radius:6px;" onclick="adjustModalQty(-1)">−</button>' +
      '<span id="modal-qty-display" style="font-size:20px;font-weight:700;min-width:32px;text-align:center;">1</span>' +
      '<button class="qty-btn" style="font-size:20px;width:36px;height:36px;background:var(--cream);border:1.5px solid var(--parchment);border-radius:6px;" onclick="adjustModalQty(1)">+</button>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="confirmAddWithQty(\'' + itemId + '\')">Add to List</button>' +
    '</div>';
  openModal();
}

function adjustModalQty(delta) {
  const el = document.getElementById('modal-qty-display');
  if (!el) return;
  el.textContent = Math.max(1, parseInt(el.textContent) + delta);
}

async function confirmAddWithQty(itemId) {
  const qty = parseInt(document.getElementById('modal-qty-display').textContent) || 1;
  closeModal();
  await addToList(itemId, qty);
}

async function removeFromList(itemId) {
  const entry = shoppingList.find(s => s.itemId === itemId);
  if (!entry) return;
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  updateListBadge();
  refreshItemRow(itemId);
  pendingWrites++;
  await sheetCall({ action: 'removeFromList', itemId, listName: activeListName });
  pendingWrites--;
}

async function removeListItem(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  shoppingList = shoppingList.filter(i => i.id !== listId);
  updateListBadge();
  if (item.itemId) refreshItemRow(item.itemId);
  renderShoppingList();

  // Undo: re-add to sheet and local state
  pushUndo('"' + item.name + '" removed', async () => {
    shoppingList.push(item);
    shoppingList.sort((a, b) => (a.sortOrder||0) - (b.sortOrder||0));
    updateListBadge();
    renderShoppingList();
    if (item.itemId) refreshItemRow(item.itemId);
    pendingWrites++;
    await sheetCall({ action: 'addToList', ...item, listName: activeListName });
    pendingWrites--;
  });
  showToast('"' + item.name + '" removed', 'Undo');

  pendingWrites++;
  await sheetCall({ action: 'removeFromList', id: listId, listName: activeListName });
  pendingWrites--;
}

async function toggleCheck(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  const wasChecked = item.checked;
  item.checked = !item.checked;
  updateListBadge();
  const card = document.getElementById('list-card-' + listId);
  if (card) {
    card.classList.toggle('checked', item.checked);
    card.querySelector('.check-box').textContent = item.checked ? '✓' : '';
  }

  if (item.checked) {
    pushUndo('"' + item.name + '" checked', async () => {
      item.checked = false;
      updateListBadge();
      const c = document.getElementById('list-card-' + listId);
      if (c) { c.classList.remove('checked'); c.querySelector('.check-box').textContent = ''; }
      pendingWrites++;
      await sheetCall({ action: 'updateListItem', id: listId, checked: false });
      pendingWrites--;
    });
    showToast('"' + item.name + '" checked', 'Undo');
  }

  pendingWrites++;
  await sheetCall({ action: 'updateListItem', id: listId, checked: item.checked });
  pendingWrites--;
}

async function changeQty(listId, delta) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  const el = document.getElementById('qty-' + listId);
  if (el) el.textContent = item.qty;
  pendingWrites++;
  await sheetCall({ action: 'updateListItem', id: listId, qty: item.qty });
  pendingWrites--;
}

async function clearChecked() {
  const checked = shoppingList.filter(i => i.checked);
  if (checked.length === 0) { showToast('No checked items to clear'); return; }
  checked.forEach(i => { if (i.itemId) refreshItemRowAfterRemove(i.itemId); });
  shoppingList = shoppingList.filter(i => !i.checked);
  updateListBadge();
  renderShoppingList();
  showToast(checked.length + ' item' + (checked.length > 1 ? 's' : '') + ' cleared');
  pendingWrites++;
  await sheetCall({ action: 'clearChecked', listName: activeListName });
  pendingWrites--;
}

// ---- ITEM NOTE ----
function openItemNote(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Note for ' + esc(item.name) + '</h2>' +
    '<textarea class="modal-input" id="item-note-input" rows="4" placeholder="e.g. get the organic one, only if on sale…" style="resize:vertical">' + esc(item.note || '') + '</textarea>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="clearItemNote(\'' + listId + '\')">Clear</button>' +
      '<button class="btn-primary" onclick="saveItemNote(\'' + listId + '\')">Save</button>' +
    '</div>';
  openModal();
}

async function saveItemNote(listId) {
  const note = document.getElementById('item-note-input').value.trim();
  closeModal();
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  item.note = note;
  renderShoppingList();
  await sheetCall({ action: 'updateListItem', id: listId, note });
}

async function clearItemNote(listId) {
  closeModal();
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  item.note = '';
  renderShoppingList();
  await sheetCall({ action: 'updateListItem', id: listId, note: '' });
}

function refreshItemRow(itemId) {
  const row = document.getElementById('item-row-' + itemId);
  if (row) {
    const item = db.items.find(i => i.id === itemId);
    if (item) row.outerHTML = renderItemRow(item);
  }
}

function refreshItemRowAfterRemove(itemId) {
  const row    = document.getElementById('item-row-' + itemId);
  if (!row) return;
  const item   = db.items.find(i => i.id === itemId);
  const inList = shoppingList.filter(s => !s.checked).some(s => s.itemId === itemId);
  if (item && !inList) {
    const newRow = document.createElement('div');
    newRow.innerHTML = renderItemRow(item);
    row.replaceWith(newRow.firstElementChild);
  }
}

// ---- ARCHIVE ----
async function archiveAndClear() {
  if (shoppingList.length === 0) { showToast('List is empty'); return; }
  showToast('Archiving…');
  const archResult = await sheetCall({ action: 'archiveList', listName: activeListName });
  if (!archResult.ok) { showToast('Error archiving: ' + (archResult.error || '')); return; }
  openNewListModal(true); // pass flag to indicate we already archived
}

async function openArchiveModal() {
  showToast('Loading archives…');
  const result = await sheetCall({ action: 'getArchives', listName: activeListName });
  if (!result.ok || result.archives.length === 0) { showToast('No archives found for "' + activeListName + '"'); return; }
  const html = result.archives.map(a => {
    const date = new Date(a.archivedAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const unchecked = a.items.filter(i => !i.checked).length;
    const checked   = a.items.filter(i => i.checked).length;
    return '<div class="archive-entry">' +
      '<div class="archive-entry-header">' +
        '<span class="archive-date">' + date + '</span>' +
        '<span class="archive-stats">' + unchecked + ' items' + (checked ? ', ' + checked + ' checked' : '') + '</span>' +
      '</div>' +
      '<div class="archive-items">' +
        a.items.slice(0, 8).map(i =>
          '<span class="archive-item' + (i.checked ? ' archive-item-checked' : '') + '">' + esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '') + '</span>'
        ).join('') +
        (a.items.length > 8 ? '<span class="archive-item-more">+' + (a.items.length - 8) + ' more</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Archive — ' + esc(activeListName) + '</h2>' +
    '<div style="max-height:420px;overflow-y:auto;">' + html + '</div>' +
    '<div class="modal-actions"><button class="btn-secondary" onclick="closeModal()">Close</button></div>';
  openModal();
}

// ---- NEW NAMED LIST ----
function openNewNamedListModal() {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">New List</h2>' +
    '<label class="modal-label">List Name</label>' +
    '<input class="modal-input" id="new-list-name" placeholder="e.g. Costco, Weekly Shop…" autofocus />' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="createNewNamedList()">Create & Switch</button>' +
    '</div>';
  openModal();
}

async function createNewNamedList() {
  const name = document.getElementById('new-list-name').value.trim();
  if (!name) { showToast('Please enter a list name'); return; }
  if (allListNames.includes(name)) { showToast('A list with that name already exists'); return; }
  closeModal();
  allListNames.push(name);
  await switchList(name);
}

// ---- RENAME / DELETE LIST ----
function openListOptionsModal() {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">List Options</h2>' +
    '<p style="color:var(--ink-light);font-size:13px;margin-bottom:16px;">Managing: <strong>' + esc(activeListName) + '</strong></p>' +
    '<label class="modal-label">Rename this list</label>' +
    '<input class="modal-input" id="rename-list-input" value="' + esc(activeListName) + '" />' +
    '<div class="modal-actions" style="flex-direction:column;gap:8px;margin-top:20px;">' +
      '<button class="btn-primary" style="width:100%" onclick="doRenameList()">Rename</button>' +
      '<button class="btn-secondary" style="width:100%" onclick="closeModalAndPrint()">🖨 Print List</button>' +
      '<button class="btn-danger"  style="width:100%" onclick="doDeleteList()">Delete this list</button>' +
      '<button class="btn-secondary" style="width:100%" onclick="closeModal()">Cancel</button>' +
    '</div>';
  openModal();
}

async function doRenameList() {
  const newName = document.getElementById('rename-list-input').value.trim();
  if (!newName || newName === activeListName) { closeModal(); return; }
  if (allListNames.includes(newName)) { showToast('That name is already taken'); return; }
  closeModal();
  const result = await sheetCall({ action: 'renameList', oldName: activeListName, newName });
  if (result.ok) {
    const idx = allListNames.indexOf(activeListName);
    if (idx !== -1) allListNames[idx] = newName;
    activeListName = newName;
    localStorage.setItem('pantry_active_list', activeListName);
    updateListDropdown();
    showToast('List renamed to "' + newName + '"');
  } else { showToast('Error renaming list'); }
}

async function doDeleteList() {
  if (!window.confirm('Delete list "' + activeListName + '" and all its items?')) return;
  closeModal();
  const deletedName = activeListName;
  const result = await sheetCall({ action: 'deleteList', listName: deletedName });
  if (result.ok) {
    allListNames = allListNames.filter(n => n !== deletedName);
    if (allListNames.length === 0) allListNames = ['Main'];
    activeListName = allListNames[0];
    localStorage.setItem('pantry_active_list', activeListName);
    await loadList(false);
    updateListDropdown();
    renderDatabase();
    showToast('"' + deletedName + '" deleted');
  } else { showToast('Error deleting list'); }
}

// ---- SAVE / RESTORE ----
async function saveCurrentList() {
  if (shoppingList.length === 0) { showToast('Nothing on the list to save'); return; }
  showToast('Saving list…');
  const result = await sheetCall({ action: 'saveList', listName: activeListName });
  if (result.ok) showToast(result.count + ' items saved');
  else showToast('Error saving list');
}

async function openRestoreModal() {
  showToast('Loading saved list…');
  const result = await sheetCall({ action: 'getSavedList', listName: activeListName });
  if (!result.ok || result.list.length === 0) { showToast('No saved list found for "' + activeListName + '"'); return; }
  const savedDate = result.savedAt ? new Date(result.savedAt).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'unknown date';
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Restore Saved List</h2>' +
    '<p style="color:var(--ink-light);font-size:13px;margin-bottom:14px;">Saved on ' + savedDate + ' — ' + result.list.length + ' items</p>' +
    '<div class="prev-list-preview" style="max-height:200px">' +
      result.list.map(i => '<div class="prev-item-row"><span style="flex:1;font-size:13px;color:var(--ink-mid)">' + esc(i.name) + '</span><span class="cat-tag">' + esc(i.category) + '</span></div>').join('') +
    '</div>' +
    '<div class="modal-actions" style="flex-direction:column;gap:8px;margin-top:16px;">' +
      '<button class="btn-primary" style="width:100%" onclick="doRestoreList(\'merge\')">Merge — add missing items</button>' +
      '<button class="btn-secondary" style="width:100%" onclick="doRestoreList(\'replace\')">Replace — clear and restore</button>' +
      '<button class="btn-ghost" style="color:var(--ink-light);width:100%" onclick="closeModal()">Cancel</button>' +
    '</div>';
  openModal();
}

async function doRestoreList(mode) {
  closeModal();
  showToast('Restoring…');
  const result = await sheetCall({ action: 'restoreList', mode, listName: activeListName });
  if (result.ok) { await loadList(false); showToast('List restored!'); }
  else showToast('Error: ' + (result.error || 'Unknown'));
}

// ---- NEW LIST (clear current) ----
function openNewListModal(alreadyArchived) {
  if (shoppingList.length === 0 && !alreadyArchived) { showToast('Your list is empty'); return; }
  previousList = JSON.parse(JSON.stringify(shoppingList));
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Clear "' + esc(activeListName) + '"</h2>' +
    '<p style="color:var(--ink-light);font-size:14px;margin-bottom:16px;">Select items to carry over.</p>' +
    '<div class="prev-list-preview" id="prev-list-preview">' +
      previousList.map(i =>
        '<div class="prev-item-row">' +
          '<input type="checkbox" id="prev-' + i.id + '" data-id="' + i.id + '" checked />' +
          '<label for="prev-' + i.id + '">' + esc(i.name) + '</label>' +
          '<span class="cat-tag">' + esc(i.category) + '</span>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button class="btn-ghost" style="color:var(--ink-light);border:1px solid var(--parchment);font-size:13px;padding:5px 10px;border-radius:4px;" onclick="toggleAllPrev(true)">All</button>' +
      '<button class="btn-ghost" style="color:var(--ink-light);border:1px solid var(--parchment);font-size:13px;padding:5px 10px;border-radius:4px;" onclick="toggleAllPrev(false)">None</button>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="startNewList()">Clear & Start Fresh</button>' +
    '</div>';
  openModal();
}

function toggleAllPrev(state) {
  document.querySelectorAll('#prev-list-preview input[type=checkbox]').forEach(cb => cb.checked = state);
}

async function startNewList() {
  const keepIds = [];
  document.querySelectorAll('#prev-list-preview input[type=checkbox]:checked').forEach(cb => keepIds.push(cb.dataset.id));
  closeModal();
  showToast('Clearing list…');
  const result = await sheetCall({ action: 'newList', keepIds, listName: activeListName });
  if (result.ok) {
    await loadList(false);
    setNote('');
    renderDatabase();
    showToast('List cleared!');
  } else showToast('Error clearing list');
}

// ---- QUICK ADD ----
function openAddQuickItem() {
  const catOptions = db.categories.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Quick Add to ' + esc(activeListName) + '</h2>' +
    '<label class="modal-label">Item Name</label>' +
    '<input class="modal-input" id="quick-name" placeholder="e.g. Greek yogurt" autofocus />' +
    '<label class="modal-label">Category (optional)</label>' +
    '<select class="modal-select" id="quick-cat"><option value="">— Uncategorized —</option>' + catOptions + '</select>' +
    '<label class="modal-label">Quantity</label>' +
    '<input class="modal-input" id="quick-qty" type="number" min="1" value="1" />' +
    '<label class="modal-checkbox-row"><input type="checkbox" id="quick-save" /> Save this item to the database</label>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="addQuickItem()">Add to List</button>' +
    '</div>';
  openModal();
}

async function addQuickItem() {
  const name   = document.getElementById('quick-name').value.trim();
  if (!name) { showToast('Please enter an item name'); return; }
  const catId  = document.getElementById('quick-cat').value;
  const qty    = parseInt(document.getElementById('quick-qty').value) || 1;
  const saveDB = document.getElementById('quick-save').checked;
  const cat    = db.categories.find(c => c.id === catId);
  closeModal();
  let itemId = null;
  if (saveDB && catId) {
    showToast('Saving to database…');
    const dbResult = await sheetCall({ action: 'addItem', name, category: catId });
    if (dbResult.ok) { itemId = dbResult.id; db.items.push({ id: itemId, name, category: catId }); renderDatabase(); }
    else showToast('Saved to list only (DB error)');
  }
  const maxSort = shoppingList.reduce((m, i) => Math.max(m, i.sortOrder || 0), -1);
  const listItem = {
    id: 'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId: itemId || '', name,
    category: cat ? cat.name : 'Other',
    qty, checked: false, sortOrder: maxSort + 1,
    addedBy: currentUser, note: '', listName: activeListName
  };
  shoppingList.push(listItem);
  updateListBadge();
  if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
  showToast('"' + name + '" added to list');
  pendingWrites++;
  await sheetCall({ action: 'addToList', ...listItem });
  pendingWrites--;
}

// ---- ADD / EDIT CATEGORY ----
function openAddCategory() {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">New Category</h2>' +
    '<label class="modal-label">Category Name</label>' +
    '<input class="modal-input" id="cat-name-input" placeholder="e.g. Produce, Dairy, Snacks…" autofocus />' +
    '<label class="modal-label">Aisle # (optional)</label>' +
    '<input class="modal-input" id="cat-aisle-input" placeholder="e.g. 3, 7A, Frozen…" />' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveNewCategory()">Create Category</button>' +
    '</div>';
  openModal();
}

async function saveNewCategory() {
  const name  = document.getElementById('cat-name-input').value.trim();
  const aisle = document.getElementById('cat-aisle-input').value.trim();
  if (!name) { showToast('Please enter a category name'); return; }
  closeModal();
  const result = await sheetCall({ action: 'addCategory', name, aisle });
  if (result.ok) {
    db.categories.push({ id: result.id, name, aisle, sortOrder: db.categories.length });
    renderDatabase();
    showToast('Category "' + name + '" created');
  } else showToast('Error: ' + (result.error || 'Unknown'));
}

function editCategory(id, currentName, currentAisle) {
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Edit Category</h2>' +
    '<label class="modal-label">Category Name</label>' +
    '<input class="modal-input" id="cat-rename-input" value="' + esc(currentName) + '" autofocus />' +
    '<label class="modal-label">Aisle # (optional)</label>' +
    '<input class="modal-input" id="cat-aisle-edit" value="' + esc(currentAisle) + '" placeholder="e.g. 3, 7A, Frozen…" />' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveEditCategory(\'' + id + '\')">Save</button>' +
    '</div>';
  openModal();
}

async function saveEditCategory(id) {
  const name  = document.getElementById('cat-rename-input').value.trim();
  const aisle = document.getElementById('cat-aisle-edit').value.trim();
  if (!name) return;
  closeModal();
  const result = await sheetCall({ action: 'updateCategory', id, name, aisle });
  if (result.ok) {
    const cat = db.categories.find(c => c.id === id);
    if (cat) { cat.name = name; cat.aisle = aisle; }
    renderDatabase();
    showToast('Category updated');
  } else showToast('Error updating category');
}

async function deleteCategory(id) {
  const cat        = db.categories.find(c => c.id === id);
  const itemsInCat = db.items.filter(i => i.category === id).length;
  if (!window.confirm('Delete category "' + cat?.name + '"?' + (itemsInCat > 0 ? ' (' + itemsInCat + ' items will also be deleted)' : ''))) return;
  const result = await sheetCall({ action: 'deleteCategory', id });
  if (result.ok) {
    db.categories = db.categories.filter(c => c.id !== id);
    db.items      = db.items.filter(i => i.category !== id);
    renderDatabase();
    showToast('Category deleted');
  } else showToast('Error deleting category');
}

// ---- ADD ITEM ----
function openAddItem(preselectedCatId) {
  const catOptions = db.categories.map(c =>
    '<option value="' + c.id + '"' + (c.id === preselectedCatId ? ' selected' : '') + '>' + esc(c.name) + '</option>'
  ).join('');
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Add Item to Database</h2>' +
    '<label class="modal-label">Item Name</label>' +
    '<input class="modal-input" id="item-name-input" placeholder="e.g. Whole milk, Brown rice…" autofocus />' +
    '<label class="modal-label">Category</label>' +
    '<select class="modal-select" id="item-cat-select"><option value="">— Select category —</option>' + catOptions + '</select>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveNewItem()">Add Item</button>' +
    '</div>';
  openModal();
}

async function saveNewItem() {
  const name  = document.getElementById('item-name-input').value.trim();
  const catId = document.getElementById('item-cat-select').value;
  if (!name)  { showToast('Please enter an item name'); return; }
  if (!catId) { showToast('Please select a category');  return; }
  closeModal();
  const result = await sheetCall({ action: 'addItem', name, category: catId });
  if (result.ok) {
    db.items.push({ id: result.id, name, category: catId });
    renderDatabase();
    showToast('"' + name + '" added');
  } else showToast('Error: ' + (result.error || 'Unknown'));
}

async function deleteItem(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!window.confirm('Delete "' + item?.name + '" from the database?')) return;
  const listEntry = shoppingList.find(s => s.itemId === itemId);
  if (listEntry) await sheetCall({ action: 'removeFromList', id: listEntry.id, listName: activeListName });
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  updateListBadge();
  const result = await sheetCall({ action: 'deleteItem', id: itemId });
  if (result.ok) {
    db.items = db.items.filter(i => i.id !== itemId);
    renderDatabase();
    if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
    showToast('Item deleted');
  } else showToast('Error deleting item');
}

// ---- NOTES ----
function setNote(text) {
  const ta = document.getElementById('list-notes');
  if (ta) ta.value = text || '';
  const area = document.getElementById('list-notes-area');
  if (area) area.classList.remove('hidden');
}

function onNoteInput() {
  const status = document.getElementById('list-notes-status');
  if (status) status.textContent = 'Unsaved changes…';
  clearTimeout(noteDebounce);
  noteDebounce = setTimeout(saveNote, 2000);
}

async function saveNote() {
  clearTimeout(noteDebounce);
  const ta   = document.getElementById('list-notes');
  const note = ta ? ta.value : '';
  const status = document.getElementById('list-notes-status');
  await sheetCall({ action: 'saveNote', listName: activeListName, note });
  if (status) { status.textContent = 'Saved'; setTimeout(() => { status.textContent = ''; }, 2000); }
}

async function loadNote(silent) {
  try {
    const result = await sheetCall({ action: 'getNote', listName: activeListName });
    if (result.ok) setNote(result.note);
  } catch (e) {}
}

// ---- PRINT LIST ----
function closeModalAndPrint() {
  closeModal();
  setTimeout(printList, 100);
}

function printList() {
  const catOrder = db.categories.map(c => c.name);
  const byCategory = {};
  shoppingList.filter(i => !i.checked).forEach(item => {
    const cat = item.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });
  const sortedCats = Object.keys(byCategory).sort((a, b) => {
    const ai = catOrder.indexOf(a), bi = catOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  });

  const date = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const sections = sortedCats.map(catName => {
    const cat      = db.categories.find(c => c.name === catName);
    const aisle    = cat && cat.aisle ? ' <span style="font-size:11px;color:#888;font-weight:400;">· Aisle ' + catName + '</span>' : '';
    const items    = byCategory[catName].map(i =>
      '<li>' + i.name + (i.qty > 1 ? ' <span style="color:#888">×' + i.qty + '</span>' : '') +
      (i.note ? ' <span style="color:#aaa;font-style:italic;font-size:11px;">— ' + i.note + '</span>' : '') + '</li>'
    ).join('');
    return '<div style="margin-bottom:16px"><strong style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#555">' + catName + aisle + '</strong><ul style="margin:4px 0 0 16px;padding:0;list-style:disc">' + items + '</ul></div>';
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Shopping List — ${householdName || activeListName}</title>
    <style>
      body { font-family: Georgia, serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #222; }
      h1 { font-size: 28px; margin-bottom: 2px; }
      .household { font-size: 14px; color: #888; margin-bottom: 2px; }
      .meta { font-size: 13px; color: #aaa; margin-bottom: 28px; }
      ul { line-height: 1.8; }
      @media print { body { margin: 20px; } }
    </style></head><body>
    ${householdName ? '<div class="household">🛒 ' + householdName + '</div>' : ''}
    <h1>${activeListName}</h1>
    <div class="meta">${date} · ${shoppingList.filter(i => !i.checked).length} items</div>
    ${sections}
    <script>window.onload = function(){ window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

// ---- SWIPE TO CHECK (mobile) ----
function initSwipeToCheck() {
  document.querySelectorAll('.list-item-card').forEach(card => {
    let startX = 0, startY = 0, dx = 0;
    let swiping = false;

    card.addEventListener('touchstart', e => {
      startX  = e.touches[0].clientX;
      startY  = e.touches[0].clientY;
      dx      = 0;
      swiping = false;
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      // Only treat as horizontal swipe if more horizontal than vertical
      if (Math.abs(dx) > dy && Math.abs(dx) > 10) {
        swiping = true;
        const clamp = Math.max(-80, Math.min(80, dx));
        card.style.transform = 'translateX(' + clamp + 'px)';
        card.style.transition = 'none';
        // Color feedback
        if (dx < -30) card.style.background = 'var(--sage-muted)';
        else if (dx > 30) card.style.background = 'var(--danger-light)';
        else card.style.background = '';
      }
    }, { passive: true });

    card.addEventListener('touchend', e => {
      card.style.transition = '';
      card.style.transform  = '';
      card.style.background = '';
      if (!swiping) return;
      const listId = card.dataset.listId;
      if (dx < -60) {
        // Swipe left → check off
        toggleCheck(listId);
      } else if (dx > 60) {
        // Swipe right → delete
        removeListItem(listId);
      }
    }, { passive: true });
  });
}

// ---- SHARE LIST ----
function shareList() {
  const url = window.location.origin + window.location.pathname.replace('index.html', '') +
    'share.html?code=' + encodeURIComponent(currentHouseholdCode) +
    '&list=' + encodeURIComponent(activeListName);

  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Share "' + esc(activeListName) + '"</h2>' +
    '<p style="color:var(--ink-light);font-size:13px;margin-bottom:16px;">Anyone with this link or QR code can view the list (read-only). No login needed.</p>' +
    '<div style="display:flex;justify-content:center;margin-bottom:16px;">' +
      '<div id="qr-code" style="background:#fff;padding:10px;border-radius:8px;border:1px solid var(--parchment);"></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;background:var(--cream-dark);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:16px;">' +
      '<span style="flex:1;font-size:12px;word-break:break-all;color:var(--ink-mid)">' + esc(url) + '</span>' +
      '<button class="btn-primary" style="flex-shrink:0;padding:6px 12px;font-size:12px" onclick="copyShareUrl(\'' + esc(url) + '\')">Copy</button>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn-secondary" onclick="closeModal()">Close</button>' +
    '</div>';
  openModal();

  function renderQR() {
    const el = document.getElementById('qr-code');
    if (!el) return;
    new QRCode(el, {
      text:  url,
      width: 180, height: 180,
      colorDark:  '#2a2118',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  if (typeof QRCode !== 'undefined') {
    renderQR();
  } else {
    const script  = document.createElement('script');
    script.src    = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = renderQR;
    script.onerror = () => {
      const el = document.getElementById('qr-code');
      if (el) {
        const img = document.createElement('img');
        img.src    = 'https://chart.googleapis.com/chart?chs=180x180&cht=qr&choe=UTF-8&chl=' + encodeURIComponent(url);
        img.width  = 180; img.height = 180; img.alt = 'QR code';
        el.appendChild(img);
      }
    };
    document.head.appendChild(script);
  }
}

function copyShareUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied!');
    closeModal();
  }).catch(() => {
    showToast('Could not copy — select the URL manually');
  });
}

// ---- VIEWS ----
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
  const viewEl = document.getElementById('view-' + view);
  viewEl.classList.remove('hidden');
  viewEl.classList.add('active');
  document.querySelector('[data-view="' + view + '"]')?.classList.add('active');
  document.querySelectorAll('.bottom-tab[data-view="' + view + '"]').forEach(b => b.classList.add('active'));
  if (view === 'list') {
    document.getElementById('list-loading').classList.add('hidden');
    renderShoppingList();
  }
}

// ---- MODAL HELPERS ----
function openModal() {
  document.getElementById('generic-modal').classList.add('active');
  setTimeout(() => {
    const first = document.querySelector('#generic-modal-content input, #generic-modal-content select, #generic-modal-content textarea');
    if (first) first.focus();
  }, 100);
}
function closeModal() { document.getElementById('generic-modal').classList.remove('active'); }
document.getElementById('generic-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('generic-modal')) closeModal();
});

// ---- UI HELPERS ----
function updateListBadge() {
  const unchecked = shoppingList.filter(i => !i.checked).length;
  ['list-badge', 'list-badge-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = unchecked; el.classList.toggle('hidden', unchecked === 0); }
  });
}
function showDbLoading(show) {
  document.getElementById('db-loading').style.display = show ? 'flex' : 'none';
}
// ---- UNDO ----
let undoStack  = null;  // { label, fn }
let undoTimer  = null;

function pushUndo(label, fn) {
  undoStack = { label, fn };
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoStack = null; }, 4000);
}

async function doUndo() {
  if (!undoStack) return;
  const { fn } = undoStack;
  undoStack = null;
  if (undoTimer) clearTimeout(undoTimer);
  hideToast();
  await fn();
}

function showToast(msg, undoLabel) {
  const t = document.getElementById('toast');
  if (undoLabel) {
    t.innerHTML = msg + ' <button class="toast-undo-btn" onclick="doUndo()">Undo</button>';
  } else {
    t.textContent = msg;
  }
  t.classList.add('show');
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { t.classList.remove('show'); undoStack = null; }, 4000);
}

function hideToast() {
  document.getElementById('toast').classList.remove('show');
}
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
