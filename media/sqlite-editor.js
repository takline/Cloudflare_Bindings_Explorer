/* global acquireVsCodeApi */

(function () {
  const vscode = acquireVsCodeApi();
  const state = {
    dbInfo: null,
    tables: [],
    currentTable: null,
    currentData: null,
    filter: "",
  };

  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="header">
      <div class="header-title">
        <h1>SQLite Visual Editor</h1>
        <div class="header-meta" id="dbMeta">Loading database...</div>
      </div>
      <div class="header-actions">
        <span class="header-pill" id="dbSize">--</span>
        <span class="header-pill" id="tableCount">0 tables</span>
      </div>
    </div>
    <div class="container">
      <aside class="sidebar">
        <div class="sidebar-header">Tables</div>
        <ul class="table-list" id="tableList"></ul>
      </aside>
      <main class="main">
        <div class="toolbar">
          <div class="toolbar-left">
            <input type="text" id="filterInput" placeholder="Filter rows..." />
          </div>
          <div class="toolbar-right">
            <button id="addRowBtn" disabled>+ Add Row</button>
            <button id="refreshBtn" class="secondary" disabled>Refresh</button>
            <button id="queryBtn" class="secondary">SQL Query</button>
            <button id="copyBtn" class="secondary" disabled>Copy JSON</button>
          </div>
        </div>
        <div class="status-bar" id="statusBar"></div>
        <div id="messageContainer"></div>
        <div class="table-container" id="tableView"></div>
        <div class="query-panel" id="queryPanel">
          <textarea id="queryInput" placeholder="Write a SQL query..."></textarea>
          <div style="margin-top: 10px;">
            <button id="executeQueryBtn">Run Query</button>
          </div>
          <div class="table-container" id="queryResult"></div>
        </div>
      </main>
    </div>
    <div class="modal" id="addRowModal">
      <div class="modal-card">
        <h3>Add Row</h3>
        <div id="addRowForm"></div>
        <div class="modal-actions">
          <button class="secondary" id="cancelAddBtn">Cancel</button>
          <button id="confirmAddBtn">Insert</button>
        </div>
      </div>
    </div>
  `;

  const elements = {
    dbMeta: document.getElementById("dbMeta"),
    dbSize: document.getElementById("dbSize"),
    tableCount: document.getElementById("tableCount"),
    tableList: document.getElementById("tableList"),
    filterInput: document.getElementById("filterInput"),
    addRowBtn: document.getElementById("addRowBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    queryBtn: document.getElementById("queryBtn"),
    copyBtn: document.getElementById("copyBtn"),
    statusBar: document.getElementById("statusBar"),
    messageContainer: document.getElementById("messageContainer"),
    tableView: document.getElementById("tableView"),
    queryPanel: document.getElementById("queryPanel"),
    queryInput: document.getElementById("queryInput"),
    executeQueryBtn: document.getElementById("executeQueryBtn"),
    queryResult: document.getElementById("queryResult"),
    addRowModal: document.getElementById("addRowModal"),
    addRowForm: document.getElementById("addRowForm"),
    cancelAddBtn: document.getElementById("cancelAddBtn"),
    confirmAddBtn: document.getElementById("confirmAddBtn"),
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "dbInfo":
        updateDbInfo(message.info);
        break;
      case "tablesLoaded":
        state.tables = message.tables || [];
        renderTableList();
        break;
      case "tableDataLoaded":
        state.currentTable = message.tableName;
        state.currentData = message.data;
        renderTableData();
        elements.addRowBtn.disabled = false;
        elements.refreshBtn.disabled = false;
        elements.copyBtn.disabled = false;
        break;
      case "queryResult":
        renderQueryResult(message.result);
        break;
      case "updateSuccess":
        showMessage("Cell updated", "success");
        highlightCell(message.rowId, message.column);
        break;
      case "deleteSuccess":
        showMessage("Row deleted", "success");
        refreshCurrentTable();
        break;
      case "insertSuccess":
        showMessage("Row inserted", "success");
        refreshCurrentTable();
        break;
      case "error":
        showMessage(message.message, "error");
        break;
      default:
        break;
    }
  });

  elements.filterInput.addEventListener("input", (event) => {
    state.filter = event.target.value.toLowerCase();
    renderTableData();
  });

  elements.queryBtn.addEventListener("click", () => {
    const active = elements.queryPanel.classList.toggle("active");
    elements.tableView.classList.toggle("hidden", active);
  });

  elements.refreshBtn.addEventListener("click", () => {
    const tableName = state.currentTable || undefined;
    elements.statusBar.innerHTML = "<span>Refreshing from source...</span>";
    elements.tableView.innerHTML = '<div class="loading-state">Refreshing data from source...</div>';
    vscode.postMessage({ type: "refreshFromSource", tableName });
  });

  elements.copyBtn.addEventListener("click", async () => {
    if (!state.currentData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.currentData.rows, null, 2));
      showMessage("Copied JSON to clipboard", "success");
    } catch (error) {
      showMessage("Failed to copy JSON", "error");
    }
  });

  elements.executeQueryBtn.addEventListener("click", () => {
    const query = elements.queryInput.value.trim();
    if (!query) return;
    vscode.postMessage({
      type: "executeQuery",
      query,
      tableName: state.currentTable || undefined,
    });
  });

  elements.addRowBtn.addEventListener("click", () => {
    if (!state.currentData) return;
    renderAddRowForm();
    elements.addRowModal.classList.add("active");
  });

  elements.cancelAddBtn.addEventListener("click", () => {
    elements.addRowModal.classList.remove("active");
  });

  elements.confirmAddBtn.addEventListener("click", () => {
    if (!state.currentData) return;
    const values = {};
    state.currentData.columns.forEach((col) => {
      if (col.primaryKey) return;
      const input = document.getElementById(`field_${col.name}`);
      if (!input) return;
      const value = input.value.trim();
      if (value === "") {
        values[col.name] = undefined;
        return;
      }
      values[col.name] = value.toLowerCase() === "null" ? null : value;
    });
    vscode.postMessage({
      type: "insertRow",
      tableName: state.currentTable,
      values,
    });
    elements.addRowModal.classList.remove("active");
  });

  function updateDbInfo(info) {
    state.dbInfo = info;
    const displayName = info.displayName || info.name;
    const locationLabel = info.locationLabel || info.path;
    elements.dbMeta.textContent = `${displayName} • ${locationLabel}`;
    elements.dbSize.textContent = formatBytes(info.sizeBytes);
  }

  function renderTableList() {
    elements.tableList.innerHTML = "";
    elements.tableCount.textContent = `${state.tables.length} tables`;

    if (!state.tables.length) {
      elements.tableList.innerHTML = '<li class="empty-state">No tables found</li>';
      return;
    }

    const persisted = vscode.getState() || {};
    const selected = persisted.selectedTable;
    const hasSelected = state.tables.some((table) => table.name === selected);
    const firstNonEmptyTable = state.tables.find((table) => table.rowCount > 0);
    const nextSelected = hasSelected
      ? selected
      : firstNonEmptyTable
      ? firstNonEmptyTable.name
      : state.tables.length > 0
      ? state.tables[0].name
      : null;

    state.tables.forEach((table) => {
      const item = document.createElement("li");
      item.className = "table-item";
      item.dataset.tableName = table.name;
      if (table.name === nextSelected) {
        item.classList.add("active");
      }
      const icon = table.type === "view" ? "👁️" : "📋";
      item.innerHTML = `
        <div class="table-name"><span>${icon}</span><span>${escapeHtml(table.name)}</span></div>
        <div class="table-badges">
          <span class="badge">${table.rowCount} rows</span>
          <span class="badge">${table.columnCount} cols</span>
        </div>
      `;
      item.addEventListener("click", () => selectTable(table.name, item));
      elements.tableList.appendChild(item);
    });

    if (nextSelected) {
      const selectedItem = Array.from(
        elements.tableList.querySelectorAll(".table-item")
      ).find((el) => el.dataset.tableName === nextSelected);
      if (selectedItem) {
        selectTable(nextSelected, selectedItem, false);
      }
    }
  }

  function selectTable(tableName, element, persist = true) {
    Array.from(elements.tableList.querySelectorAll(".table-item")).forEach((item) => {
      item.classList.remove("active");
    });
    element.classList.add("active");
    if (persist) {
      vscode.setState({ selectedTable: tableName });
    }
    elements.queryPanel.classList.remove("active");
    elements.tableView.classList.remove("hidden");
    elements.statusBar.innerHTML = `<span>Loading ${escapeHtml(tableName)}...</span>`;
    elements.tableView.innerHTML = '<div class="loading-state">Loading table data...</div>';
    vscode.postMessage({ type: "getTableData", tableName });
  }

  function renderTableData() {
    const data = state.currentData;
    elements.tableView.innerHTML = "";
    elements.statusBar.innerHTML = "";
    elements.messageContainer.innerHTML = "";

    if (!data || !data.rows.length) {
      elements.tableView.innerHTML = '<div class="empty-state">No rows found for this table.</div>';
      return;
    }

    const isRemoteSource = state.dbInfo && state.dbInfo.source === "remote-d1";
    const primaryKeyColumns = data.columns
      .filter((column) => column.primaryKey)
      .map((column) => column.name);
    const supportsRemoteMutations = !isRemoteSource || primaryKeyColumns.length > 0;

    const filteredRows = applyFilter(data.rows, state.filter);
    const visibleRows = filteredRows.length;
    const statusParts = [
      `<span>Showing ${visibleRows} of ${data.rowCount} rows</span>`,
      `<span>${data.columns.length} columns</span>`,
    ];
    if (isRemoteSource) {
      statusParts.push("<span>Remote D1 live mode</span>");
    }
    elements.statusBar.innerHTML = statusParts.join("");

    if (isRemoteSource && !supportsRemoteMutations) {
      elements.messageContainer.innerHTML =
        '<div class="message warning">This table has no PRIMARY KEY. Row edit/delete is disabled. Use SQL Query for mutations.</div>';
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const rowidHeader = document.createElement("th");
    rowidHeader.textContent = "rowid";
    headerRow.appendChild(rowidHeader);

    data.columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = `${col.name} (${col.type || ""})`;
      headerRow.appendChild(th);
    });

    const actions = document.createElement("th");
    actions.textContent = "Actions";
    headerRow.appendChild(actions);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    filteredRows.forEach((row) => {
      const tr = document.createElement("tr");
      const rowIdentity = buildRowIdentity(row, primaryKeyColumns);
      const rowidCell = document.createElement("td");
      rowidCell.className = "rowid";
      rowidCell.textContent = row._rowid_;
      tr.appendChild(rowidCell);

      data.columns.forEach((col) => {
        const cell = document.createElement("td");
        const editable = !isRemoteSource || supportsRemoteMutations;
        cell.className = editable ? "cell-editable" : "cell-readonly";
        cell.contentEditable = editable ? "true" : "false";
        cell.dataset.rowid = row._rowid_;
        cell.dataset.column = col.name;
        cell.dataset.rowIdentity = JSON.stringify(rowIdentity);
        const rawValue = row[col.name];
        cell.dataset.original = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        cell.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        if (editable) {
          cell.addEventListener("blur", handleCellEdit);
          cell.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              cell.blur();
            }
            if (event.key === "Escape") {
              cell.textContent = cell.dataset.original;
              cell.blur();
            }
          });
        }
        tr.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "danger";
      if (isRemoteSource && !supportsRemoteMutations) {
        deleteBtn.disabled = true;
        deleteBtn.title = "PRIMARY KEY required";
      }
      deleteBtn.addEventListener("click", () => deleteRow(row._rowid_, rowIdentity));
      actionCell.appendChild(deleteBtn);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    elements.tableView.appendChild(table);
  }

  function handleCellEdit(event) {
    const cell = event.target;
    const rowId = Number(cell.dataset.rowid);
    const column = cell.dataset.column;
    const original = cell.dataset.original || "";
    const value = cell.textContent.trim();

    if (value === original) {
      return;
    }

    const normalized = value === "" || value.toLowerCase() === "null" ? null : value;
    const rowIdentity = parseRowIdentity(cell.dataset.rowIdentity);

    vscode.postMessage({
      type: "updateRow",
      tableName: state.currentTable,
      rowId,
      column,
      value: normalized,
      rowIdentity,
    });

    cell.dataset.original = normalized === null ? "" : String(normalized);
  }

  function deleteRow(rowId, rowIdentity) {
    if (!confirm("Delete this row?")) return;
    vscode.postMessage({
      type: "deleteRow",
      tableName: state.currentTable,
      rowId,
      rowIdentity,
    });
  }

  function refreshCurrentTable() {
    if (!state.currentTable) return;
    elements.statusBar.innerHTML = `<span>Refreshing ${escapeHtml(state.currentTable)}...</span>`;
    elements.tableView.innerHTML = '<div class="loading-state">Refreshing table data...</div>';
    vscode.postMessage({ type: "getTableData", tableName: state.currentTable });
  }

  function renderAddRowForm() {
    elements.addRowForm.innerHTML = "";
    state.currentData.columns.forEach((col) => {
      if (col.primaryKey) return;
      const wrapper = document.createElement("div");
      wrapper.style.marginBottom = "10px";
      wrapper.innerHTML = `
        <label style="display:block; font-size:12px; margin-bottom:4px;">${escapeHtml(col.name)} (${escapeHtml(col.type || "")})</label>
        <input type="text" id="field_${col.name}" placeholder="${col.notNull ? "Required" : "Optional"}" />
      `;
      elements.addRowForm.appendChild(wrapper);
    });
  }

  function renderQueryResult(result) {
    elements.queryResult.innerHTML = "";

    if (Array.isArray(result)) {
      if (!result.length) {
        elements.queryResult.innerHTML = '<div class="empty-state">Query returned no rows.</div>';
        return;
      }
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      Object.keys(result[0]).forEach((key) => {
        const th = document.createElement("th");
        th.textContent = key;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      result.forEach((row) => {
        const tr = document.createElement("tr");
        Object.values(row).forEach((value) => {
          const td = document.createElement("td");
          td.textContent = value === null ? "NULL" : String(value);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      elements.queryResult.appendChild(table);
      return;
    }

    elements.queryResult.innerHTML = `<div class="message success">${escapeHtml(result.message || "Query executed")}</div>`;
  }

  function showMessage(message, type) {
    elements.messageContainer.innerHTML = "";
    const node = document.createElement("div");
    node.className = `message ${type}`;
    node.textContent = message;
    elements.messageContainer.appendChild(node);
    setTimeout(() => node.remove(), 3000);
  }

  function highlightCell(rowId, column) {
    const selector = `.cell-editable[data-rowid="${rowId}"][data-column="${column}"]`;
    const cell = document.querySelector(selector);
    if (!cell) return;
    cell.classList.add("cell-highlight");
    setTimeout(() => cell.classList.remove("cell-highlight"), 1200);
  }

  function applyFilter(rows, filter) {
    if (!filter) return rows;
    return rows.filter((row) => {
      return Object.values(row).some((value) =>
        String(value ?? "").toLowerCase().includes(filter)
      );
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  function buildRowIdentity(row, primaryKeyColumns) {
    const identity = {};
    primaryKeyColumns.forEach((column) => {
      identity[column] = row[column] === undefined ? null : row[column];
    });
    return identity;
  }

  function parseRowIdentity(serialized) {
    if (!serialized || typeof serialized !== "string") {
      return undefined;
    }
    try {
      const parsed = JSON.parse(serialized);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  elements.statusBar.innerHTML = "<span>Loading database schema...</span>";
  elements.tableView.innerHTML = '<div class="loading-state">Loading database schema...</div>';
  vscode.postMessage({ type: "getTables" });
})();
