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

  elements.refreshBtn.addEventListener("click", () => refreshCurrentTable());

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
    vscode.postMessage({ type: "executeQuery", query });
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
    elements.dbMeta.textContent = `${info.name} • ${info.path}`;
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

    state.tables.forEach((table) => {
      const item = document.createElement("li");
      item.className = "table-item";
      if (table.name === selected) {
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

    if (selected) {
      const selectedItem = Array.from(elements.tableList.querySelectorAll(".table-item")).find(
        (el) => el.textContent.includes(selected)
      );
      if (selectedItem) {
        vscode.postMessage({ type: "getTableData", tableName: selected });
      }
    }
  }

  function selectTable(tableName, element) {
    Array.from(elements.tableList.querySelectorAll(".table-item")).forEach((item) => {
      item.classList.remove("active");
    });
    element.classList.add("active");
    vscode.setState({ selectedTable: tableName });
    elements.queryPanel.classList.remove("active");
    elements.tableView.classList.remove("hidden");
    vscode.postMessage({ type: "getTableData", tableName });
  }

  function renderTableData() {
    const data = state.currentData;
    elements.tableView.innerHTML = "";
    elements.statusBar.innerHTML = "";

    if (!data || !data.rows.length) {
      elements.tableView.innerHTML = '<div class="empty-state">No rows found for this table.</div>';
      return;
    }

    const filteredRows = applyFilter(data.rows, state.filter);
    const visibleRows = filteredRows.length;
    elements.statusBar.innerHTML = `
      <span>Showing ${visibleRows} of ${data.rowCount} rows</span>
      <span>${data.columns.length} columns</span>
    `;

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
      const rowidCell = document.createElement("td");
      rowidCell.className = "rowid";
      rowidCell.textContent = row._rowid_;
      tr.appendChild(rowidCell);

      data.columns.forEach((col) => {
        const cell = document.createElement("td");
        cell.className = "cell-editable";
        cell.contentEditable = true;
        cell.dataset.rowid = row._rowid_;
        cell.dataset.column = col.name;
        const rawValue = row[col.name];
        cell.dataset.original = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        cell.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
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
        tr.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "danger";
      deleteBtn.addEventListener("click", () => deleteRow(row._rowid_));
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

    vscode.postMessage({
      type: "updateRow",
      tableName: state.currentTable,
      rowId,
      column,
      value: normalized,
    });

    cell.dataset.original = normalized === null ? "" : String(normalized);
  }

  function deleteRow(rowId) {
    if (!confirm("Delete this row?")) return;
    vscode.postMessage({ type: "deleteRow", tableName: state.currentTable, rowId });
  }

  function refreshCurrentTable() {
    if (!state.currentTable) return;
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

  vscode.postMessage({ type: "getTables" });
})();
