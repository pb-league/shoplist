// ============================================================
// PANTRY — Google Apps Script (Code.gs)
// Deploy as a Web App (Execute as: Me, Access: Anyone)
// ============================================================

const SHEET_NAME_CATEGORIES = 'Categories';
const SHEET_NAME_ITEMS = 'Items';

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const payload = JSON.parse(e.postData.contents);
    const result = handleAction(payload);
    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.toString() }));
  }

  return output;
}

function doGet(e) {
  // Allow CORS preflight / direct test
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'Pantry API running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleAction(payload) {
  const action = payload.action;
  switch (action) {
    case 'getData':       return getData();
    case 'addCategory':   return addCategory(payload);
    case 'updateCategory':return updateCategory(payload);
    case 'deleteCategory':return deleteCategory(payload);
    case 'addItem':       return addItem(payload);
    case 'deleteItem':    return deleteItem(payload);
    default:              return { ok: false, error: 'Unknown action: ' + action };
  }
}

// ---- HELPERS ----
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function genId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ---- ACTIONS ----

function getData() {
  const catSheet  = getOrCreateSheet(SHEET_NAME_CATEGORIES, ['id', 'name']);
  const itemSheet = getOrCreateSheet(SHEET_NAME_ITEMS, ['id', 'name', 'category']);
  return {
    ok: true,
    categories: sheetToObjects(catSheet).map(r => ({ id: String(r.id), name: String(r.name) })),
    items: sheetToObjects(itemSheet).map(r => ({ id: String(r.id), name: String(r.name), category: String(r.category) }))
  };
}

function addCategory({ name }) {
  if (!name) return { ok: false, error: 'Name required' };
  const sheet = getOrCreateSheet(SHEET_NAME_CATEGORIES, ['id', 'name']);
  const id = genId();
  sheet.appendRow([id, name]);
  return { ok: true, id };
}

function updateCategory({ id, name }) {
  const sheet = getOrCreateSheet(SHEET_NAME_CATEGORIES, ['id', 'name']);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 2).setValue(name);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Category not found' };
}

function deleteCategory({ id }) {
  // Delete category
  const catSheet = getOrCreateSheet(SHEET_NAME_CATEGORIES, ['id', 'name']);
  const catData = catSheet.getDataRange().getValues();
  for (let i = catData.length - 1; i >= 1; i--) {
    if (String(catData[i][0]) === String(id)) {
      catSheet.deleteRow(i + 1);
      break;
    }
  }
  // Delete all items in category
  const itemSheet = getOrCreateSheet(SHEET_NAME_ITEMS, ['id', 'name', 'category']);
  const itemData = itemSheet.getDataRange().getValues();
  for (let i = itemData.length - 1; i >= 1; i--) {
    if (String(itemData[i][2]) === String(id)) {
      itemSheet.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

function addItem({ name, category }) {
  if (!name || !category) return { ok: false, error: 'Name and category required' };
  const sheet = getOrCreateSheet(SHEET_NAME_ITEMS, ['id', 'name', 'category']);
  const id = genId();
  sheet.appendRow([id, name, category]);
  return { ok: true, id };
}

function deleteItem({ id }) {
  const sheet = getOrCreateSheet(SHEET_NAME_ITEMS, ['id', 'name', 'category']);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Item not found' };
}
