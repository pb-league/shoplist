// ============================================================
// PANTRY — app.js
// ============================================================

// ---- STATE ----
let SHEET_URL = '';
let db = { categories: [], items: [] };   // database
let shoppingList = [];                     // { id, name, category, qty, checked, isNew }
let previousList = [];                     // snapshot before starting new list

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  SHEET_URL = localStorage.getItem('pantry_sheet_url') || '';
  if (SHEET_URL) {
    document.getElementById('sheet-url-input').value = SHEET_URL;
    launchApp();
  }
  // Load saved list from localStorage
  const saved = localStorage.getItem('pantry_list');
  if (saved) shoppingList = JSON.parse(saved);
  updateListBadge();
});

// ---- SETUP ----
function connectSheet() {
  const val = document.getElementById('sheet-url-input').value.trim();
  if (!val.startsWith('https://script.google.com')) {
    showToast('Please enter a valid Google Apps Script URL');
    return;
  }
  SHEET_URL = val;
  localStorage.setItem('pantry_sheet_url', SHEET_URL);
  launchApp();
}

function openSetup() {
  document.getElementById('sheet-url-input').value = SHEET_URL;
  document.getElementById('setup-modal').classList.add('active');
}

function launchApp() {
  document.getElementById('setup-modal').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  loadDatabase();
}

// ---- SHEET API ----
async function sheetCall(payload) {
  const res = await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: text }; }
}

// ---- LOAD DB ----
async function loadDatabase() {
  showDbLoading(true);
  try {
    const result = await sheetCall({ action: 'getData' });
    if (result.ok) {
      db.categories = result.categories || [];
      db.items = result.items || [];
      renderDatabase();
    } else {
      showToast('Error loading data: ' + (result.error || 'Unknown'));
    }
  } catch (e) {
    showToast('Could not reach your Sheet. Check your URL in Settings.');
  }
  showDbLoading(false);
}

// ---- RENDER DATABASE ----
function renderDatabase() {
  const container = document.getElementById('categories-container');
  const empty = document.getElementById('db-empty');
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
    const card = document.createElement('div');
    card.className = 'category-card';
    card.id = 'cat-card-' + cat.id;
    card.innerHTML = `
      <div class="category-header">
        <span class="category-name">${esc(cat.name)}</span>
        <div class="category-actions">
          <button class="btn-icon" title="Rename" onclick="renameCategory('${cat.id}','${esc(cat.name)}')">✎</button>
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
}

function renderItemRow(item) {
  const inList = shoppingList.some(s => s.itemId === item.id);
  return `
    <div class="item-row ${inList ? 'in-list' : ''}" id="item-row-${item.id}">
      <span class="item-dot"></span>
      <span class="item-name">${esc(item.name)}</span>
      <div class="item-actions">
        ${inList
          ? `<button class="remove-from-list-btn" onclick="removeFromList('${item.id}');event.stopPropagation()">✕ remove</button>`
          : `<button class="add-to-list-btn" onclick="addToList('${item.id}');event.stopPropagation()">+ list</button>`
        }
        <button class="btn-icon" onclick="deleteItem('${item.id}');event.stopPropagation()">🗑</button>
      </div>
    </div>`;
}

// ---- RENDER SHOPPING LIST ----
function renderShoppingList() {
  const container = document.getElementById('list-container');
  const empty = document.getElementById('list-empty');
  container.innerHTML = '';

  if (shoppingList.length === 0) {
    container.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  empty.classList.add('hidden');

  // group by category
  const byCategory = {};
  shoppingList.forEach(item => {
    const catName = item.category || 'Other';
    if (!byCategory[catName]) byCategory[catName] = [];
    byCategory[catName].push(item);
  });

  Object.entries(byCategory).forEach(([catName, items]) => {
    const section = document.createElement('div');
    section.innerHTML = `
      <div class="list-section-header">
        <span class="list-section-title">${esc(catName)}</span>
      </div>
      ${items.map(i => renderListItemCard(i)).join('')}
    `;
    container.appendChild(section);
  });

  updateListBadge();
}

function renderListItemCard(item) {
  return `
    <div class="list-item-card ${item.checked ? 'checked' : ''}" id="list-card-${item.id}">
      <div class="check-box" onclick="toggleCheck('${item.id}')">${item.checked ? '✓' : ''}</div>
      <span class="list-item-name">${esc(item.name)}</span>
      <div class="qty-control">
        <button class="qty-btn" onclick="changeQty('${item.id}',-1)">−</button>
        <span class="qty-display" id="qty-${item.id}">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty('${item.id}',1)">+</button>
      </div>
      <button class="list-delete-btn" onclick="removeListItem('${item.id}')">✕</button>
    </div>`;
}

// ---- LIST ACTIONS ----
function addToList(itemId) {
  if (shoppingList.some(s => s.itemId === itemId)) return;
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  const cat = db.categories.find(c => c.id === item.category);
  const listItem = {
    id: 'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId: item.id,
    name: item.name,
    category: cat ? cat.name : 'Other',
    qty: 1,
    checked: false,
    isNew: false
  };
  shoppingList.push(listItem);
  saveList();
  refreshItemRow(itemId);
  renderShoppingList();
  showToast(`"${item.name}" added to list`);
}

function removeFromList(itemId) {
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  saveList();
  refreshItemRow(itemId);
  renderShoppingList();
}

function removeListItem(listId) {
  const item = shoppingList.find(i => i.id === listId);
  shoppingList = shoppingList.filter(i => i.id !== listId);
  saveList();
  if (item && item.itemId) refreshItemRow(item.itemId);
  renderShoppingList();
}

function toggleCheck(listId) {
  const item = shoppingList.find(i => i.id === listId);
  if (item) {
    item.checked = !item.checked;
    saveList();
    const card = document.getElementById('list-card-' + listId);
    if (card) {
      card.classList.toggle('checked', item.checked);
      card.querySelector('.check-box').textContent = item.checked ? '✓' : '';
      card.querySelector('.list-item-name').style.textDecoration = item.checked ? 'line-through' : '';
    }
  }
}

function changeQty(listId, delta) {
  const item = shoppingList.find(i => i.id === listId);
  if (item) {
    item.qty = Math.max(1, item.qty + delta);
    saveList();
    const el = document.getElementById('qty-' + listId);
    if (el) el.textContent = item.qty;
  }
}

function clearChecked() {
  const checked = shoppingList.filter(i => i.checked);
  if (checked.length === 0) { showToast('No checked items to clear'); return; }
  checked.forEach(i => { if (i.itemId) refreshItemRowAfterRemove(i.itemId); });
  shoppingList = shoppingList.filter(i => !i.checked);
  saveList();
  renderShoppingList();
  showToast(`${checked.length} item${checked.length > 1 ? 's' : ''} cleared`);
}

function refreshItemRow(itemId) {
  const row = document.getElementById('item-row-' + itemId);
  if (row) {
    const item = db.items.find(i => i.id === itemId);
    if (item) row.outerHTML = renderItemRow(item);
  }
}
function refreshItemRowAfterRemove(itemId) {
  const row = document.getElementById('item-row-' + itemId);
  if (!row) return;
  const item = db.items.find(i => i.id === itemId);
  if (item) {
    const inList = shoppingList.filter(s => !s.checked).some(s => s.itemId === itemId);
    if (!inList) {
      const newRow = document.createElement('div');
      newRow.innerHTML = renderItemRow(item);
      row.replaceWith(newRow.firstElementChild);
    }
  }
}

// ---- NEW LIST MODAL ----
function openNewListModal() {
  if (shoppingList.length === 0) { showToast('Your list is empty'); return; }
  previousList = JSON.parse(JSON.stringify(shoppingList));

  const content = document.getElementById('generic-modal-content');
  content.innerHTML = `
    <h2 class="modal-title">Start New List</h2>
    <p style="color:var(--ink-light);font-size:14px;margin-bottom:16px;">Select items from your previous list to carry over to the new list.</p>
    <div class="prev-list-preview" id="prev-list-preview">
      ${previousList.map(i => `
        <div class="prev-item-row">
          <input type="checkbox" id="prev-${i.id}" data-id="${i.id}" checked />
          <label for="prev-${i.id}">${esc(i.name)}</label>
          <span class="cat-tag">${esc(i.category)}</span>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn-ghost" style="color:var(--ink-light);border:1px solid var(--parchment);font-size:13px;padding:5px 10px;border-radius:4px;" onclick="toggleAllPrev(true)">All</button>
      <button class="btn-ghost" style="color:var(--ink-light);border:1px solid var(--parchment);font-size:13px;padding:5px 10px;border-radius:4px;" onclick="toggleAllPrev(false)">None</button>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="startNewList()">Start New List</button>
    </div>
  `;
  openModal();
}

function toggleAllPrev(state) {
  document.querySelectorAll('#prev-list-preview input[type=checkbox]').forEach(cb => cb.checked = state);
}

function startNewList() {
  const selected = [];
  document.querySelectorAll('#prev-list-preview input[type=checkbox]:checked').forEach(cb => {
    const prev = previousList.find(i => i.id === cb.dataset.id);
    if (prev) selected.push({ ...prev, id: 'li_' + Date.now() + '_' + Math.random().toString(36).slice(2), checked: false });
  });
  shoppingList = selected;
  saveList();
  renderShoppingList();
  renderDatabase(); // refresh in-list states
  closeModal();
  showToast('New list started!');
}

// ---- QUICK ADD (not in DB) ----
function openAddQuickItem() {
  const catOptions = db.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  document.getElementById('generic-modal-content').innerHTML = `
    <h2 class="modal-title">Quick Add Item</h2>
    <label class="modal-label">Item Name</label>
    <input class="modal-input" id="quick-name" placeholder="e.g. Greek yogurt" autofocus />
    <label class="modal-label">Category (optional)</label>
    <select class="modal-select" id="quick-cat">
      <option value="">— Uncategorized —</option>
      ${catOptions}
    </select>
    <label class="modal-label">Quantity</label>
    <input class="modal-input" id="quick-qty" type="number" min="1" value="1" />
    <label class="modal-checkbox-row">
      <input type="checkbox" id="quick-save" />
      Save this item to the database
    </label>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="addQuickItem()">Add to List</button>
    </div>
  `;
  openModal();
}

async function addQuickItem() {
  const name = document.getElementById('quick-name').value.trim();
  if (!name) { showToast('Please enter an item name'); return; }
  const catId = document.getElementById('quick-cat').value;
  const qty = parseInt(document.getElementById('quick-qty').value) || 1;
  const saveDB = document.getElementById('quick-save').checked;
  const cat = db.categories.find(c => c.id === catId);

  const listItem = {
    id: 'li_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    itemId: null,
    name,
    category: cat ? cat.name : 'Other',
    qty,
    checked: false,
    isNew: true
  };

  if (saveDB && catId) {
    closeModal();
    showToast('Saving to database…');
    const result = await sheetCall({ action: 'addItem', name, category: catId });
    if (result.ok) {
      const newItem = { id: result.id, name, category: catId };
      db.items.push(newItem);
      listItem.itemId = result.id;
      listItem.isNew = false;
      renderDatabase();
      showToast(`"${name}" saved to database`);
    } else {
      showToast('Saved to list only (DB error)');
    }
  } else {
    closeModal();
  }

  shoppingList.push(listItem);
  saveList();
  renderShoppingList();
  if (!saveDB) showToast(`"${name}" added to list`);
}

// ---- ADD CATEGORY ----
function openAddCategory() {
  document.getElementById('generic-modal-content').innerHTML = `
    <h2 class="modal-title">New Category</h2>
    <label class="modal-label">Category Name</label>
    <input class="modal-input" id="cat-name-input" placeholder="e.g. Produce, Dairy, Snacks…" autofocus />
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveNewCategory()">Create Category</button>
    </div>
  `;
  openModal();
}

async function saveNewCategory() {
  const name = document.getElementById('cat-name-input').value.trim();
  if (!name) { showToast('Please enter a category name'); return; }
  closeModal();
  showToast('Creating category…');
  const result = await sheetCall({ action: 'addCategory', name });
  if (result.ok) {
    db.categories.push({ id: result.id, name });
    renderDatabase();
    showToast(`Category "${name}" created`);
  } else {
    showToast('Error: ' + (result.error || 'Unknown'));
  }
}

function renameCategory(id, currentName) {
  document.getElementById('generic-modal-content').innerHTML = `
    <h2 class="modal-title">Rename Category</h2>
    <label class="modal-label">Category Name</label>
    <input class="modal-input" id="cat-rename-input" value="${esc(currentName)}" autofocus />
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveRenameCategory('${id}')">Save</button>
    </div>
  `;
  openModal();
}

async function saveRenameCategory(id) {
  const name = document.getElementById('cat-rename-input').value.trim();
  if (!name) return;
  closeModal();
  const result = await sheetCall({ action: 'updateCategory', id, name });
  if (result.ok) {
    const cat = db.categories.find(c => c.id === id);
    if (cat) cat.name = name;
    renderDatabase();
    showToast('Category renamed');
  } else {
    showToast('Error renaming category');
  }
}

async function deleteCategory(id) {
  const cat = db.categories.find(c => c.id === id);
  const itemsInCat = db.items.filter(i => i.category === id).length;
  const confirm = window.confirm(`Delete category "${cat?.name}"? ${itemsInCat > 0 ? `(${itemsInCat} items will also be deleted)` : ''}`);
  if (!confirm) return;
  const result = await sheetCall({ action: 'deleteCategory', id });
  if (result.ok) {
    db.categories = db.categories.filter(c => c.id !== id);
    db.items = db.items.filter(i => i.category !== id);
    renderDatabase();
    showToast('Category deleted');
  } else {
    showToast('Error deleting category');
  }
}

// ---- ADD ITEM ----
function openAddItem(preselectedCatId) {
  const catOptions = db.categories.map(c =>
    `<option value="${c.id}" ${c.id === preselectedCatId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  document.getElementById('generic-modal-content').innerHTML = `
    <h2 class="modal-title">Add Item to Database</h2>
    <label class="modal-label">Item Name</label>
    <input class="modal-input" id="item-name-input" placeholder="e.g. Whole milk, Brown rice…" autofocus />
    <label class="modal-label">Category</label>
    <select class="modal-select" id="item-cat-select">
      <option value="">— Select category —</option>
      ${catOptions}
    </select>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveNewItem()">Add Item</button>
    </div>
  `;
  openModal();
}

async function saveNewItem() {
  const name = document.getElementById('item-name-input').value.trim();
  const catId = document.getElementById('item-cat-select').value;
  if (!name) { showToast('Please enter an item name'); return; }
  if (!catId) { showToast('Please select a category'); return; }
  closeModal();
  showToast('Saving item…');
  const result = await sheetCall({ action: 'addItem', name, category: catId });
  if (result.ok) {
    db.items.push({ id: result.id, name, category: catId });
    renderDatabase();
    showToast(`"${name}" added`);
  } else {
    showToast('Error: ' + (result.error || 'Unknown'));
  }
}

async function deleteItem(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!window.confirm(`Delete "${item?.name}" from the database?`)) return;
  // Remove from list too
  shoppingList = shoppingList.filter(s => s.itemId !== itemId);
  saveList();
  const result = await sheetCall({ action: 'deleteItem', id: itemId });
  if (result.ok) {
    db.items = db.items.filter(i => i.id !== itemId);
    renderDatabase();
    renderShoppingList();
    showToast('Item deleted');
  } else {
    showToast('Error deleting item');
  }
}

// ---- VIEWS ----
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  if (view === 'list') renderShoppingList();
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

// ---- SAVE / PERSIST ----
function saveList() {
  localStorage.setItem('pantry_list', JSON.stringify(shoppingList));
  updateListBadge();
}
function updateListBadge() {
  const badge = document.getElementById('list-badge');
  const unchecked = shoppingList.filter(i => !i.checked).length;
  badge.textContent = unchecked;
  badge.classList.toggle('hidden', unchecked === 0);
}

// ---- UI HELPERS ----
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
