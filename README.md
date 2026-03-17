# 🛒 Pantry — Grocery List Manager

A GitHub Pages web app that uses **Google Sheets as a database** to manage grocery items, categories, and shopping lists.

---

## Features

- **Item Database** — Create categories, add items to each category
- **Shopping List** — Add items from the database, adjust quantities, check off when purchased
- **Quick Add** — Add one-off items not in the database, with option to save them
- **New List** — Start fresh using your previous list as a starting point (pick and choose what carries over)
- **Persistent** — Shopping list is saved to your browser; database lives in Google Sheets

---

## Setup

### 1. Host the web app on GitHub Pages

1. Fork or upload these files to a new GitHub repo
2. Go to **Settings → Pages** → Source: `main` branch, root folder
3. Your app will be live at `https://yourusername.github.io/your-repo-name`

### 2. Set up Google Sheets Backend

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet
2. Click **Extensions → Apps Script**
3. Delete any existing code and paste the entire contents of **`Code.gs`** (from this repo)
4. Click **Save** (name the project anything, e.g. "Pantry")
5. Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** — authorize the permissions when prompted
7. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/ABC.../exec`)

### 3. Connect the App

1. Open your GitHub Pages site
2. Paste your Web App URL in the setup screen
3. Click **Connect Sheet** — you're ready to go!

---

## How to Use

### Item Database (📦)

- Click **+ Category** to create a new category (e.g. Produce, Dairy, Snacks)
- Click **+ Item** or the `+ add item` button inside any category card to add items
- Hover an item to see **+ list** (add to shopping list) or 🗑 (delete from database)
- Items highlighted in green are already on your shopping list

### Shopping List (📋)

- Items are grouped by category
- **Check off** items as you shop by clicking the checkbox
- Use **−/+** buttons to adjust quantities
- Click **✕** on any item to remove it from the list
- **Clear Checked** removes all checked items at once
- **+ Quick Add** adds a one-off item (optionally save it to the database)

### Starting a New List (↺ New List)

1. Click **↺ New List** in the Shopping List view
2. Your current list is shown — check/uncheck which items to carry over
3. Click **Start New List** — only selected items are kept (unchecked, qty reset)

---

## Data Structure (Google Sheet)

The script automatically creates two sheets:

| Sheet | Columns |
|-------|---------|
| **Categories** | `id`, `name` |
| **Items** | `id`, `name`, `category` (category id) |

Shopping list state is stored in your **browser's localStorage** (not in the sheet).

---

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript — no build step required
- **Backend**: Google Apps Script Web App
- **Database**: Google Sheets
- **Hosting**: GitHub Pages
