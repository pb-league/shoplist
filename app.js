// ============================================================
// PANTRY — app.js
// ============================================================

// ---- STATE ----
let SHEET_URL    = '';
let db           = { categories: [], items: [] };
let shoppingList = [];
let previousList = [];
let refreshTimer = null;

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  const savedCode = localStorage.getItem('pantry_household_code');
  if (savedCode) {
    resolveCode(savedCode).then(url => {
      if (url) {
        SHEET_URL = url;
        launchApp();
      } else {
        // Saved code no longer valid — show setup
        localStorage.removeItem('pantry_household_code');
        showSetup();
      }
    });
  }
});

// ---- SETUP ----
async function connectWithCode() {
  const code = document.getElementById('household-code-input').value.trim().toLowerCase();
  if (!code) { showToast('Please enter your household code'); return; }
  showToast('Looking up code…');
  const url = await resolveCode(code);
  if (!url) {
    showToast('Code not found — check with whoever set up your Pantry');
    return;
  }
  SHEET_URL = url;
  localStorage.setItem('pantry_household_code', code);
  launchApp();
}

async function resolveCode(code) {
  try {
    const res  = await fetch('households.json?_=' + Date.now());
    const map  = await res.json();
    return map[code] || null;
  } catch (e) {
    showToast('Could not load household list');
    return null;
  }
}

function showSetup() {
  document.getElementById('setup-modal').classList.add('active');
  document.getElementById('app').classList.add('hidden');
}

function openSetup() {
  const code = localStorage.getItem('pantry_household_code') || '';
  document.getElementById('household-code-input').value = code;
  document.getElementById('setup-modal').classList.add('active');
}

function launchApp() {
  document.getElementById('setup-modal').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('hidden'));
  loadAll();
  startAutoRefresh();
}

// ---- SHEET API ----
async function sheetCall(payload) {
  const res  = await fetch(SHEET_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: text }; }
}

// ---- LOAD ALL (single round trip) ----
async function loadAll() {
  showDbLoading(true);
  try {
    const result = await sheetCall({ action: 'getAll' });
    if (result.ok) {
      db.categories = result.categories || [];
      db.items      = result.items      || [];
      shoppingList  = result.list       || [];
      updateListBadge();
      renderDatabase();
      if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
    } else {
      showToast('Error loading data: ' + (result.error || 'Unknown'));
    }
  } catch (e) {
    showToast('Could not reach your Sheet. Check your URL in Settings.');
  }
  showDbLoading(false);
}

// ---- LOAD DB ONLY ----
async function loadDatabase() {
  showDbLoading(true);
  try {
    const result = await sheetCall({ action: 'getData' });
    if (result.ok) {
      db.categories = result.categories || [];
      db.items      = result.items      || [];
      renderDatabase();
    } else {
      showToast('Error loading data: ' + (result.error || 'Unknown'));
    }
  } catch (e) {
    showToast('Could not reach your Sheet. Check your URL in Settings.');
  }
  showDbLoading(false);
}

// ---- LOAD LIST FROM SHEET ----
async function loadList(silent) {
  try {
    const result = await sheetCall({ action: 'getList' });
    if (result.ok) {
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
  refreshTimer = setInterval(() => loadList(true), 60000);
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
    const catItems = db.items.filter(i => i.category === cat.id);
    const card     = document.createElement('div');
    card.className  = 'category-card';
    card.id         = 'cat-card-' + cat.id;
    card.draggable  = true;
    card.dataset.catId = cat.id;
    const aisleLabel = cat.aisle ? '<span class="category-aisle">Aisle ' + esc(cat.aisle) + '</span>' : '';
    card.innerHTML = `
      <div class="category-header">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="category-name">${esc(cat.name)}</span>
        ${aisleLabel}
        <div class="category-actions">
          <button class="btn-icon" title="Edit" onclick="editCategory('${cat.id}','${esc(cat.name)}','${esc(cat.aisle || '')}')">✎</button>
          <button class="btn-icon" title="Delete" onclick="deleteCategory('${cat.id}')">🗑</button>
        </div>
      </div>
      <div class="category-items" id="cat-items-${cat.id}">
        ${catItems.map(i => renderItemRow(i)).join('')}
      </div>
      <div class="category-add-item">
        <button class="category-add-item-btn" onclick="openAddItem('${cat.id}')">+ add item</button>
      </div>
    `;
    container.appendChild(card);
  });

  initDragAndDrop();
}

function renderItemRow(item) {
  const inList = shoppingList.some(s => s.itemId === item.id);
  const dotClick = inList
    ? 'removeFromList(\'' + item.id + '\');event.stopPropagation()'
    : 'addToList(\'' + item.id + '\');event.stopPropagation()';
  return `
    <div class="item-row ${inList ? 'in-list' : ''}" id="item-row-${item.id}">
      <span class="item-dot" title="${inList ? 'Remove from list' : 'Add to list'}" onclick="${dotClick}"></span>
      <span class="item-name">${esc(item.name)}</span>
      <div class="item-actions">
        <button class="btn-icon" onclick="deleteItem('${item.id}');event.stopPropagation()">🗑</button>
      </div>
    </div>`;
}

// ---- DRAG AND DROP (category reorder) ----
let dragSrcId = null;

function initDragAndDrop() {
  const container = document.getElementById('categories-container');
  container.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragSrcId = card.dataset.catId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', e => {
      card.classList.remove('dragging');
      container.querySelectorAll('.category-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.category-card').forEach(c => c.classList.remove('drag-over'));
      if (card.dataset.catId !== dragSrcId) card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrcId || card.dataset.catId === dragSrcId) return;
      card.classList.remove('drag-over');

      // Reorder db.categories array
      const srcIdx  = db.categories.findIndex(c => c.id === dragSrcId);
      const destIdx = db.categories.findIndex(c => c.id === card.dataset.catId);
      const [moved] = db.categories.splice(srcIdx, 1);
      db.categories.splice(destIdx, 0, moved);

      renderDatabase();
      // Persist new order
      sheetCall({ action: 'reorderCategories', orderedIds: db.categories.map(c => c.id) });
    });
  });
}

// ---- RENDER SHOPPING LIST ----
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

  // Group by category, sorted by db.categories sortOrder
  const catOrder = db.categories.map(c => c.name);
  const byCategory = {};
  shoppingList.forEach(item => {
    const catName = item.category || 'Other';
    if (!byCategory[catName]) byCategory[catName] = [];
    byCategory[catName].push(item);
  });

  // Sort groups: known categories first (by db order), then unknowns alphabetically
  const sortedCatNames = Object.keys(byCategory).sort((a, b) => {
    const ai = catOrder.indexOf(a);
    const bi = catOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  sortedCatNames.forEach(catName => {
    const cat     = db.categories.find(c => c.name === catName);
    const aisleTag = cat && cat.aisle ? ' <span class="list-aisle-tag">Aisle ' + esc(cat.aisle) + '</span>' : '';
    const section = document.createElement('div');
    section.innerHTML =
      '<div class="list-section-header">' +
        '<span class="list-section-title">' + esc(catName) + '</span>' + aisleTag +
      '</div>' +
      byCategory[catName].map(i => renderListItemCard(i)).join('');
    container.appendChild(section);
  });

  updateListBadge();
}

function renderListItemCard(item) {
  return '<div class="list-item-card ' + (item.checked ? 'checked' : '') + '" id="list-card-' + item.id + '">' +
    '<div class="check-box" onclick="toggleCheck(\'' + item.id + '\')">' + (item.checked ? '✓' : '') + '</div>' +
    '<span class="list-item-name">' + esc(item.name) + '</span>' +
    '<div class="qty-control">' +
      '<button class="qty-btn" onclick="changeQty(\'' + item.id + '\',-1)">−</button>' +
      '<span class="qty-display" id="qty-' + item.id + '">' + item.qty + '</span>' +
      '<button class="qty-btn" onclick="changeQty(\'' + item.id + '\',1)">+</button>' +
    '</div>' +
    '<button class="list-delete-btn" onclick="removeListItem(\'' + item.id + '\')">✕</button>' +
  '</div>';
}

// ---- LIST ACTIONS ----
async function addToList(itemId) {
  if (shoppingList.some(s => s.itemId === itemId)) return;
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  const cat      = db.categories.find(c => c.id === item.category);
  const listItem = {
    id:       'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId:   item.id,
    name:     item.name,
    category: cat ? cat.name : 'Other',
    qty:      1,
    checked:  false
  };
  shoppingList.push(listItem);
  updateListBadge();
  refreshItemRow(itemId);
  showToast('"' + item.name + '" added to list');
  const result = await sheetCall({ action: 'addToList', ...listItem });
  if (!result.ok) {
    showToast('Error saving to sheet');
    shoppingList = shoppingList.filter(s => s.id !== listItem.id);
    updateListBadge();
    refreshItemRow(itemId);
  }
}

async function removeFromList(itemId) {
  const entry = shoppingList.find(s => s.itemId === itemId);
  if (!entry) return;
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  updateListBadge();
  refreshItemRow(itemId);
  await sheetCall({ action: 'removeFromList', itemId });
}

async function removeListItem(listId) {
  const item = shoppingList.find(i => i.id === listId);
  shoppingList = shoppingList.filter(i => i.id !== listId);
  updateListBadge();
  if (item && item.itemId) refreshItemRow(item.itemId);
  renderShoppingList();
  await sheetCall({ action: 'removeFromList', id: listId });
}

async function toggleCheck(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  item.checked = !item.checked;
  updateListBadge();
  const card = document.getElementById('list-card-' + listId);
  if (card) {
    card.classList.toggle('checked', item.checked);
    card.querySelector('.check-box').textContent = item.checked ? '✓' : '';
  }
  await sheetCall({ action: 'updateListItem', id: listId, checked: item.checked });
}

async function changeQty(listId, delta) {
  const item = shoppingList.find(i => i.id === listId);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  const el = document.getElementById('qty-' + listId);
  if (el) el.textContent = item.qty;
  await sheetCall({ action: 'updateListItem', id: listId, qty: item.qty });
}

async function clearChecked() {
  const checked = shoppingList.filter(i => i.checked);
  if (checked.length === 0) { showToast('No checked items to clear'); return; }
  checked.forEach(i => { if (i.itemId) refreshItemRowAfterRemove(i.itemId); });
  shoppingList = shoppingList.filter(i => !i.checked);
  updateListBadge();
  renderShoppingList();
  showToast(checked.length + ' item' + (checked.length > 1 ? 's' : '') + ' cleared');
  await sheetCall({ action: 'clearChecked' });
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

// ---- SAVE LIST ----
async function saveCurrentList() {
  if (shoppingList.length === 0) { showToast('Nothing on the list to save'); return; }
  showToast('Saving list…');
  const result = await sheetCall({ action: 'saveList' });
  if (result.ok) {
    showToast(result.count + ' items saved');
  } else {
    showToast('Error saving list');
  }
}

// ---- RESTORE LIST ----
async function openRestoreModal() {
  showToast('Loading saved list…');
  const result = await sheetCall({ action: 'getSavedList' });
  if (!result.ok || result.list.length === 0) {
    showToast('No saved list found');
    return;
  }
  const savedDate = result.savedAt ? new Date(result.savedAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : 'unknown date';
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Restore Saved List</h2>' +
    '<p style="color:var(--ink-light);font-size:13px;margin-bottom:14px;">Saved on ' + savedDate + ' — ' + result.list.length + ' items</p>' +
    '<div class="prev-list-preview" style="max-height:200px">' +
      result.list.map(i =>
        '<div class="prev-item-row"><span style="flex:1;font-size:13px;color:var(--ink-mid)">' + esc(i.name) + '</span><span class="cat-tag">' + esc(i.category) + '</span></div>'
      ).join('') +
    '</div>' +
    '<p style="font-size:13px;color:var(--ink-light);margin:14px 0 6px;">How would you like to restore?</p>' +
    '<div class="modal-actions" style="flex-direction:column;gap:8px;">' +
      '<button class="btn-primary" style="width:100%" onclick="doRestoreList(\'merge\')">Merge — add missing items to current list</button>' +
      '<button class="btn-secondary" style="width:100%" onclick="doRestoreList(\'replace\')">Replace — clear list and restore saved items</button>' +
      '<button class="btn-ghost" style="color:var(--ink-light);width:100%" onclick="closeModal()">Cancel</button>' +
    '</div>';
  openModal();
}

async function doRestoreList(mode) {
  closeModal();
  showToast('Restoring…');
  const result = await sheetCall({ action: 'restoreList', mode });
  if (result.ok) {
    await loadList(false);
    renderShoppingList();
    showToast('List restored!');
  } else {
    showToast('Error: ' + (result.error || 'Unknown'));
  }
}

// ---- NEW LIST MODAL ----
function openNewListModal() {
  if (shoppingList.length === 0) { showToast('Your list is empty'); return; }
  previousList = JSON.parse(JSON.stringify(shoppingList));
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Start New List</h2>' +
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
      '<button class="btn-primary" onclick="startNewList()">Start New List</button>' +
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
  showToast('Starting new list…');
  const result = await sheetCall({ action: 'newList', keepIds });
  if (result.ok) {
    await loadList(false);
    renderDatabase();
    showToast('New list started!');
  } else {
    showToast('Error starting new list');
  }
}

// ---- QUICK ADD ----
function openAddQuickItem() {
  const catOptions = db.categories.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
  document.getElementById('generic-modal-content').innerHTML =
    '<h2 class="modal-title">Quick Add Item</h2>' +
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
    if (dbResult.ok) {
      itemId = dbResult.id;
      db.items.push({ id: itemId, name, category: catId });
      renderDatabase();
    } else {
      showToast('Saved to list only (DB error)');
    }
  }

  const listItem = {
    id:       'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId:   itemId || '',
    name,
    category: cat ? cat.name : 'Other',
    qty,
    checked:  false
  };
  shoppingList.push(listItem);
  updateListBadge();
  if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
  showToast('"' + name + '" added to list');
  await sheetCall({ action: 'addToList', ...listItem });
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
  showToast('Creating category…');
  const result = await sheetCall({ action: 'addCategory', name, aisle });
  if (result.ok) {
    db.categories.push({ id: result.id, name, aisle, sortOrder: db.categories.length });
    renderDatabase();
    showToast('Category "' + name + '" created');
  } else {
    showToast('Error: ' + (result.error || 'Unknown'));
  }
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
  } else {
    showToast('Error updating category');
  }
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
  } else {
    showToast('Error deleting category');
  }
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
  showToast('Saving item…');
  const result = await sheetCall({ action: 'addItem', name, category: catId });
  if (result.ok) {
    db.items.push({ id: result.id, name, category: catId });
    renderDatabase();
    showToast('"' + name + '" added');
  } else {
    showToast('Error: ' + (result.error || 'Unknown'));
  }
}

async function deleteItem(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!window.confirm('Delete "' + item?.name + '" from the database?')) return;
  const listEntry = shoppingList.find(s => s.itemId === itemId);
  if (listEntry) await sheetCall({ action: 'removeFromList', id: listEntry.id });
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  updateListBadge();
  const result = await sheetCall({ action: 'deleteItem', id: itemId });
  if (result.ok) {
    db.items = db.items.filter(i => i.id !== itemId);
    renderDatabase();
    if (document.getElementById('view-list').classList.contains('active')) renderShoppingList();
    showToast('Item deleted');
  } else {
    showToast('Error deleting item');
  }
}

// ---- VIEWS ----
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const viewEl = document.getElementById('view-' + view);
  viewEl.classList.remove('hidden');
  viewEl.classList.add('active');
  document.querySelector('[data-view="' + view + '"]').classList.add('active');
  if (view === 'list') {
    document.getElementById('list-loading').classList.add('hidden');
    renderShoppingList();
  }
}

// ---- MODAL HELPERS ----
function openModal() {
  document.getElementById('generic-modal').classList.add('active');
  setTimeout(() => {
    const first = document.querySelector('#generic-modal-content input, #generic-modal-content select');
    if (first) first.focus();
  }, 100);
}
function closeModal() {
  document.getElementById('generic-modal').classList.remove('active');
}
document.getElementById('generic-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('generic-modal')) closeModal();
});

// ---- UI HELPERS ----
function updateListBadge() {
  const badge     = document.getElementById('list-badge');
  const unchecked = shoppingList.filter(i => !i.checked).length;
  badge.textContent = unchecked;
  badge.classList.toggle('hidden', unchecked === 0);
}
function showDbLoading(show) {
  document.getElementById('db-loading').style.display = show ? 'flex' : 'none';
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
