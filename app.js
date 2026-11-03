(() => {
  "use strict";

  const HOUSES = {
    TB: "Tana Boys", TG: "Tana Girls", AB: "Athi Boys", AG: "Athi Girls",
    NB: "Nzoia Boys", NG: "Nzoia Girls", MB: "Mara Boys", MG: "Mara Girls",
  };
  const BOOK_CODE = /^[A-Z0-9][A-Z0-9._/-]{0,79}$/i;
  const DB_NAME = "mhsk-bookstore";
  const DB_VERSION = 9;
  const PAGE_NAMES = {
    dashboard: "Overview", circulation: "Issue & return", inventory: "Library catalog",
    bookstore: "Textbook register", "bookstore-returns": "Bookstore returns", "year-setup": "Academic year setup", archives: "Archives", students: "Student register", reports: "Clearance & reports",
    governance: "Staff & approvals",
  };
  const state = {
    page: "dashboard", db: null, supabase: null, session: null, staffRole: null, offlineAuthorization: null, syncConfig: null, sessionTask: null, channel: null,
    inventoryQuery: "", studentQuery: "", bookstoreReturnQuery: "", inventoryFilter: "all", inventoryView: "table", studentFilter: "all", textbookQuery: "",
    circulationMode: "issue", deferredInstall: null, syncing: false, remoteRefreshTimer: null,
  };
  const byId = (id) => document.getElementById(id);
  const content = byId("app-content");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function requestBackgroundSync() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.sync) return registration.sync.register("mhsk-bookstore-sync");
    }).catch((error) => notify(`Background synchronization could not be scheduled: ${error.message}`, true));
  }


  function notify(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    byId("toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function setSyncStatus(kind, label) {
    const indicator = byId("sync-indicator");
    indicator.className = `sync-indicator${kind === "pending" ? " pending" : kind === "error" ? " error" : ""}`;
    indicator.lastElementChild.textContent = label;
    byId("connection-label").textContent = state.session
      ? "Synchronized workspace"
      : state.syncConfig ? "Sign-in required" : "Local demo only";
    byId("auth-button").textContent = state.session ? "Sign out" : "Sign in";
    byId("user-label").textContent = state.staffRole ? `KBMS ${state.staffRole.replaceAll("_", " ")}` : "Library desk";
  }

  function currentRole() {
    return state.session ? state.staffRole : state.offlineAuthorization?.role;
  }

  function roleCanWriteTable(table) {
    if (!state.syncConfig) return true;
    const role = currentRole();
    const permissions = {
      students: ["admin", "super_admin", "library_admin", "principal", "deputy_principal"],
      books: ["admin", "super_admin", "library_admin", "librarian", "library_assistant"],
      loans: ["admin", "super_admin", "library_admin", "librarian", "library_assistant"],
      textbook_copies: ["admin", "super_admin", "bookstore_admin", "bookstore_assistant"],
      textbook_allocations: ["admin", "super_admin", "bookstore_admin", "bookstore_assistant", "teacher", "subject_teacher", "class_teacher"],
      clearance_records: ["admin", "super_admin", "principal", "deputy_principal", "library_admin", "librarian", "library_assistant", "bookstore_admin", "bookstore_assistant"],
    };
    return Boolean(role && (permissions[table] || []).includes(role));
  }

  function canManageYearSetup() {
    return !state.syncConfig || ["admin", "super_admin", "principal", "deputy_principal", "bookstore_admin"].includes(currentRole());
  }

  function canArchiveAcademicYears() {
    return !state.syncConfig || ["admin", "super_admin", "principal", "deputy_principal", "bookstore_admin"].includes(currentRole());
  }

  function canManageRecords() {
    return ["students", "books", "loans", "textbook_copies", "textbook_allocations", "clearance_records"].some(roleCanWriteTable);
  }

  function canManageLibrary() { return roleCanWriteTable("books") && roleCanWriteTable("loans"); }
  function canManageTextbookInventory() { return roleCanWriteTable("textbook_copies"); }
  function canManageTextbookAllocations() { return roleCanWriteTable("textbook_allocations"); }
  function canReturnTextbookAllocations() { return !state.syncConfig || ["admin", "super_admin", "bookstore_admin", "bookstore_assistant"].includes(currentRole()); }
  function canManageStudents() { return roleCanWriteTable("students"); }
  function canManageStudentDeparture() { return !state.syncConfig || ["admin", "super_admin", "principal", "deputy_principal"].includes(currentRole()); }
  function canManageClearanceDepartment(department) {
    if (!state.syncConfig) return true;
    const role = currentRole();
    if (["admin", "super_admin", "principal", "deputy_principal"].includes(role)) return true;
    return department === "library"
      ? ["library_admin", "librarian", "library_assistant"].includes(role)
      : ["bookstore_admin", "bookstore_assistant"].includes(role);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const upgrade = request.transaction;
        const db = request.result;
        for (const name of ["students", "books", "loans", "textbook_copies", "textbook_allocations", "clearance_records", "outbox", "device-auth", "staff_profiles", "staff_assignments", "approval_requests", "audit_events", "school_classes", "school_subjects", "academic_years", "class_archive_students", "system_settings"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("active-loans")) {
          const activeLoans = db.createObjectStore("active-loans", { keyPath: "book_id" });
          if (upgrade && event.oldVersion >= 1) {
            const existingLoans = upgrade.objectStore("loans").getAll();
            existingLoans.onsuccess = () => {
              for (const loan of existingLoans.result) {
                if (!loan.returned_at) activeLoans.put({ book_id: loan.book_id, loan_id: loan.id });
              }
            };
          }
        }
        if (!db.objectStoreNames.contains("active-textbook-copies")) {
          const activeCopies = db.createObjectStore("active-textbook-copies", { keyPath: "copy_id" });
          const existingAllocations = upgrade.objectStore("textbook_allocations").getAll();
          existingAllocations.onsuccess = () => {
            for (const allocation of existingAllocations.result) {
              if (!allocation.returned_at) activeCopies.put({ copy_id: allocation.copy_id, allocation_id: allocation.id });
            }
          };
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("Could not open local KBMS storage."));
      request.onblocked = () => reject(new Error("Close other KBMS tabs to finish updating local storage."));
    });
  }

  function removeOutboxIfUnchanged(item) {
    return new Promise((resolve, reject) => {
      const objectStore = store("outbox", "readwrite");
      const request = objectStore.get(item.id);
      request.onsuccess = () => {
        const current = request.result;
        if (current && JSON.stringify(current.record) === JSON.stringify(item.record)) objectStore.delete(item.id);
      };
      request.onerror = () => reject(request.error || new Error("Could not verify a synchronized record."));
      objectStore.transaction.oncomplete = resolve;
      objectStore.transaction.onerror = () => reject(objectStore.transaction.error || new Error("Could not update the synchronization queue."));
    });
  }

  function normalizeStudentRecord(student) {
    const legacyCode = String(student.house_code || "").toUpperCase();
    const house = student.house || legacyCode[0] || "T";
    const schoolSection = student.school_section || legacyCode[1] || "G";
    const grade = String(student.grade || "Unassigned");
    const classNumber = student.class_number ?? null;
    return { ...student, house, school_section: schoolSection,
      house_code: `${house}${schoolSection}`,
      current_class: student.current_class || (classNumber ? `${grade} · Class ${classNumber}` : grade),
      active: student.active !== false };
  }

  function lateDays(loan, asOf = localDateIso()) {
    if (!loan?.due_date) return 0;
    const endDate = loan.returned_at || asOf;
    const due = Date.parse(`${loan.due_date}T00:00:00Z`);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(due) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.floor((end - due) / 86400000));
  }

  function lateFeeKes(loan, asOf = localDateIso()) {
    return lateDays(loan, asOf) * 5;
  }

  function store(name, mode = "readonly") {
    return state.db.transaction(name, mode).objectStore(name);
  }

  function getAll(name) {
    return new Promise((resolve, reject) => {
      const request = store(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Could not read ${name}.`));
    });
  }

  function getStoredRecord(name, id) {
    return new Promise((resolve, reject) => {
      const request = store(name).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Could not read ${name} record.`));
    });
  }

  function saveDeviceAuthorization(record) {
    return new Promise((resolve, reject) => {
      const objectStore = store("device-auth", "readwrite");
      const request = record ? objectStore.put(record) : objectStore.delete("authorization");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error("Could not update device access state."));
    });
  }

  function writeRecord(name, record, serverConfirmed = false) {
    return new Promise((resolve, reject) => {
      if (state.syncConfig && !roleCanWriteTable(name)) {
        reject(new Error("Your account does not have permission to change this type of record."));
        return;
      }
      if (name === "students") record = normalizeStudentRecord(record);
      const stores = name === "loans" ? [name, "outbox", "active-loans"] : [name, "outbox"];
      const tx = state.db.transaction(stores, "readwrite");
      tx.objectStore(name).put(record);
      if (name === "loans") {
        const activeLoans = tx.objectStore("active-loans");
        if (record.returned_at) activeLoans.delete(record.book_id);
        else activeLoans.put({ book_id: record.book_id, loan_id: record.id });
      }
      if (state.syncConfig && roleCanWriteTable(name) && name !== "outbox" && !serverConfirmed) {
        tx.objectStore("outbox").put({ id: `${name}:${record.id}`, table: name, record });
      }
      tx.oncomplete = () => {
        if (state.syncConfig && roleCanWriteTable(name) && name !== "outbox" && !serverConfirmed) requestBackgroundSync();
        resolve();
      };
      tx.onerror = () => reject(tx.error?.name === "ConstraintError"
        ? new Error("This book copy has already been issued on this device.")
        : tx.error || new Error(`Could not save ${name} record.`));
      tx.onabort = () => reject(tx.error || new Error(`Saving ${name} record was aborted.`));
    });
  }

  function writeRecords(name, records) {
    return new Promise((resolve, reject) => {
      if (state.syncConfig && !roleCanWriteTable(name)) {
        reject(new Error("Your account does not have permission to change this type of record."));
        return;
      }
      if (name === "students") records = records.map(normalizeStudentRecord);
      const tx = state.db.transaction(state.syncConfig && roleCanWriteTable(name) ? [name, "outbox"] : [name], "readwrite");
      const objectStore = tx.objectStore(name);
      for (const record of records) {
        objectStore.add(record);
        if (state.syncConfig && roleCanWriteTable(name)) {
          tx.objectStore("outbox").put({ id: `${name}:${record.id}`, table: name, record });
        }
      }
      tx.oncomplete = () => {
        if (state.syncConfig && roleCanWriteTable(name)) requestBackgroundSync();
        resolve();
      };
      tx.onerror = () => reject(tx.error?.name === "ConstraintError"
        ? new Error("The import contains a record that already exists.") : tx.error || new Error("Could not save imported records."));
      tx.onabort = () => reject(tx.error || new Error("The import was cancelled; no records were added."));
    });
  }

  function removeRecord(name, id) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(name, "readwrite");
      tx.objectStore(name).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(`Could not remove ${name} record.`));
    });
  }

  async function replaceAll(name, records) {
    await new Promise((resolve, reject) => {
      const names = name === "loans" ? [name, "active-loans"]
        : name === "textbook_allocations" ? [name, "active-textbook-copies"] : [name];
      const tx = state.db.transaction(names, "readwrite");
      const objectStore = tx.objectStore(name);
      objectStore.clear();
      if (name === "loans") tx.objectStore("active-loans").clear();
      if (name === "textbook_allocations") tx.objectStore("active-textbook-copies").clear();
      for (const item of records) {
        objectStore.put(item);
        if (name === "loans" && !item.returned_at) {
          tx.objectStore("active-loans").put({ book_id: item.book_id, loan_id: item.id });
        }
        if (name === "textbook_allocations" && !item.returned_at) {
          tx.objectStore("active-textbook-copies").put({ copy_id: item.copy_id, allocation_id: item.id });
        }
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(`Could not refresh ${name}.`));
    });
  }

  async function clearSyncedWorkspace() {
    if (!state.db) return;
    for (const table of ["students", "books", "loans", "textbook_copies", "textbook_allocations", "clearance_records"]) {
      await replaceAll(table, []);
    }
    await new Promise((resolve, reject) => {
      const tx = state.db.transaction("outbox", "readwrite");
      tx.objectStore("outbox").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not clear the signed-out device cache."));
    });
  }

  function formField(label, name, options = {}) {
    const { required = true, type = "text", placeholder = "", value = "", min, max, maxLength, choices, full = false, hint = "", textarea = false } = options;
    const attrs = `${required ? "required" : ""}${min !== undefined ? ` min="${min}"` : ""}${max !== undefined ? ` max="${max}"` : ""}${maxLength !== undefined ? ` maxlength="${maxLength}"` : ""}`;
    const control = choices
      ? `<select name="${name}" ${attrs}>${choices.map(([key, title]) => `<option value="${escapeHtml(key)}"${key === value ? " selected" : ""}>${escapeHtml(title)}</option>`).join("")}</select>`
      : textarea
        ? `<textarea name="${name}" ${attrs} placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
      : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${attrs}>`;
    return `<label class="field${full ? " full" : ""}"><span>${escapeHtml(label)}</span>${control}${hint ? `<small class="inline-hint">${escapeHtml(hint)}</small>` : ""}</label>`;
  }

  function photoField(value = "") {
    return `<label class="field full"><span>Book photo <small>(optional)</small></span><input name="cover_photo" type="file" accept="image/jpeg,image/png,image/webp"><small class="inline-hint">${value ? "Choose a new photo to replace the current one. Leave empty to keep it." : "Add a clear cover photo. Images are resized for offline storage."}</small></label>`;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field.length === 0) quoted = true;
      else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field);
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        field = "";
      } else field += char;
    }
    if (quoted) throw new Error("The CSV contains a quoted field that was not closed.");
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  function csvHeaderIndexes(header) {
    return new Map(header.map((label, index) => [
      label.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      index,
    ]));
  }

  function csvValue(row, indexes, aliases) {
    for (const alias of aliases) {
      const column = indexes.get(alias);
      if (column !== undefined) return String(row[column] || "").trim();
    }
    return "";
  }

  async function unzipXlsxEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This Excel file is not a valid .xlsx workbook.");
    const count = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder("utf-8");
    const entries = new Map();
    for (let n = 0; n < count; n += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("The Excel workbook has a damaged ZIP directory.");
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      let content;
      if (method === 0) content = compressed;
      else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        content = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error("This browser cannot read the compression used by this Excel file. Save it as CSV and retry.");
      entries.set(name, decoder.decode(content));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function xmlText(node, selector) {
    return node.getElementsByTagName(selector);
  }

  function excelColumnIndex(reference) {
    const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
    let value = 0;
    for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
    return value - 1;
  }

  async function parseXlsx(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose an Excel file smaller than 20 MB.");
    const entries = await unzipXlsxEntries(await file.arrayBuffer());
    const parser = new DOMParser();
    const workbookText = entries.get("xl/workbook.xml");
    if (!workbookText) throw new Error("The Excel workbook is missing its workbook definition.");
    const workbook = parser.parseFromString(workbookText, "application/xml");
    const firstSheet = xmlText(workbook, "sheet")[0];
    if (!firstSheet) throw new Error("The Excel workbook does not contain a worksheet.");
    const relationshipId = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relText = entries.get("xl/_rels/workbook.xml.rels");
    const relDoc = relText ? parser.parseFromString(relText, "application/xml") : null;
    const relationship = relDoc && Array.from(xmlText(relDoc, "Relationship")).find((item) => item.getAttribute("Id") === relationshipId);
    let sheetPath = relationship?.getAttribute("Target") || "worksheets/sheet1.xml";
    sheetPath = sheetPath.startsWith("/") ? sheetPath.slice(1) : `xl/${sheetPath.replace(/^\.\//, "")}`;
    const sheetText = entries.get(sheetPath);
    if (!sheetText) throw new Error("Could not locate the first worksheet in this Excel workbook.");
    const sharedText = entries.get("xl/sharedStrings.xml");
    const sharedDoc = sharedText ? parser.parseFromString(sharedText, "application/xml") : null;
    const shared = sharedDoc ? Array.from(xmlText(sharedDoc, "si")).map((item) => Array.from(xmlText(item, "t")).map((part) => part.textContent || "").join("")) : [];
    const sheet = parser.parseFromString(sheetText, "application/xml");
    const rows = [];
    for (const rowNode of Array.from(xmlText(sheet, "row"))) {
      const row = [];
      for (const cell of Array.from(xmlText(rowNode, "c"))) {
        const index = excelColumnIndex(cell.getAttribute("r"));
        const type = cell.getAttribute("t");
        const valueNode = xmlText(cell, "v")[0];
        let value = valueNode?.textContent || "";
        if (type === "s") value = shared[Number(value)] ?? "";
        else if (type === "inlineStr") value = Array.from(xmlText(cell, "t")).map((part) => part.textContent || "").join("");
        else if (type === "b") value = value === "1" ? "TRUE" : "FALSE";
        row[index] = value;
      }
      rows.push(row.map((value) => value ?? ""));
    }
    while (rows.length && !rows[rows.length - 1].some((value) => String(value).trim())) rows.pop();
    if (!rows.length) throw new Error("The first worksheet is empty.");
    return rows;
  }

  async function readImportRows(file) {
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension === "xlsx") return parseXlsx(file);
    if (extension === "csv") return parseCsv(await file.text());
    throw new Error("Choose a .xlsx or .csv spreadsheet.");
  }

  async function importCsv(file, kind) {
    if (!file) throw new Error("Choose a spreadsheet file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose a spreadsheet smaller than 20 MB.");
    const rows = file.__parsedRows || await readImportRows(file);
    if (rows.length < 2) throw new Error("The spreadsheet needs a header row and at least one data row.");
    const indexes = csvHeaderIndexes(rows[0]);
    const dataRows = rows.slice(1);
    if (dataRows.length > 10000) throw new Error("Import at most 10,000 rows at a time.");
    const now = new Date().toISOString();
    const problems = [];
    const records = [];
    if (kind === "students") {
      const current = await getAll("students");
      const knownAdmissions = new Set(current.map((student) => student.admission_number.toLowerCase()));
      for (const [offset, row] of dataRows.entries()) {
        const admission = csvValue(row, indexes, ["admission_number", "admission", "adm_no", "adm_number", "student_id"]);
        const name = csvValue(row, indexes, ["full_name", "student_name", "name"]);
        const houseInput = csvValue(row, indexes, ["house_code", "house"]);
        const sectionInput = csvValue(row, indexes, ["school_section", "section", "stream_code"]).toUpperCase();
        const houseCode = Object.keys(HOUSES).find((code) => code.toLowerCase() === houseInput.toLowerCase())
          || Object.keys(HOUSES).find((code) => HOUSES[code].toLowerCase() === houseInput.toLowerCase())
          || Object.keys(HOUSES).find((code) => Boolean(sectionInput) && code[0] === houseInput.toUpperCase() && code[1] === sectionInput)
          || Object.keys(HOUSES).find((code) => Boolean(sectionInput) && HOUSES[code].startsWith(houseInput) && code[1] === sectionInput);
        const grade = csvValue(row, indexes, ["grade", "form", "year_group"]);
        const classLabel = csvValue(row, indexes, ["current_class", "class_name", "class_label", "class", "stream"]);
        const classInput = csvValue(row, indexes, ["class_number", "class_no", "stream_number"]);
        const classMatch = (classInput || classLabel).match(/(?:class\s*)?(\d+)$/i);
        const classNumber = classMatch ? Number(classMatch[1]) : null;
        const currentClass = classLabel && !/^class\s*\d+$/i.test(classLabel)
          ? classLabel
          : classNumber && grade ? `${grade} · Class ${classNumber}` : (grade || classLabel);
        let issue = "";
        if (!admission || admission.length > 64) issue = "missing or overlong admission number";
        else if (knownAdmissions.has(admission.toLowerCase())) issue = "duplicate admission number";
        else if (name.length < 2 || name.length > 160) issue = "missing or invalid student name";
        else if (!houseCode) issue = "house must match one of the school house codes or names";
        else if ((!grade && !classLabel) || grade.length > 40 || classLabel.length > 100) issue = "grade or class label is missing or too long";
        else if ((classInput || /^class\s*\d+$/i.test(classLabel)) && (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 999)) issue = "class number must be from 1 to 999";
        if (issue) {
          if (problems.length < 12) problems.push(`Row ${offset + 2}: ${issue}.`);
          continue;
        }
        knownAdmissions.add(admission.toLowerCase());
        records.push({
          id: crypto.randomUUID(), admission_number: admission, full_name: name, house_code: houseCode,
          house: houseCode[0], school_section: houseCode[1], current_class: currentClass, active: true,
          grade: (grade || currentClass.split(/[·–-]/)[0].trim()).replace(/^(grade|form)/i, (match) => `${match[0].toUpperCase()}${match.slice(1).toLowerCase()}`),
          class_number: Number.isInteger(classNumber) && classNumber > 0 ? classNumber : null, academic_status: "active",
          created_at: now, updated_at: now,
        });
      }
    } else {
      const current = await getAll("books");
      const knownCodes = new Set(current.map((book) => book.accession_code.toLowerCase()));
      for (const [offset, row] of dataRows.entries()) {
        const accession = csvValue(row, indexes, ["accession_code", "book_code", "code", "accession", "barcode"]);
        const title = csvValue(row, indexes, ["title", "book_title", "name"]);
        const subject = csvValue(row, indexes, ["subject", "course"]);
        const publisher = csvValue(row, indexes, ["publisher", "publishing_house"]);
        const description = csvValue(row, indexes, ["description", "edition", "notes"]);
        const year = csvValue(row, indexes, ["purchase_year", "year", "year_purchased"]);
        const structured = /^([A-Z]{2,6})-(\d{3,8})-(\d{4})$/i.exec(accession);
        const purchaseYear = year ? Number(year) : structured ? Number(structured[3]) : null;
        let issue = "";
        if (!BOOK_CODE.test(accession)) issue = "missing or invalid book code";
        else if (knownCodes.has(accession.toLowerCase())) issue = "duplicate book code";
        else if (!title || title.length > 240) issue = "missing or overlong title";
        else if (subject.length > 100 || publisher.length > 120 || description.length > 500) issue = "subject, publisher or description is too long";
        else if (purchaseYear !== null && (!Number.isInteger(purchaseYear) || purchaseYear < 1900 || purchaseYear > new Date().getFullYear())) issue = "invalid purchase year";
        if (issue) {
          if (problems.length < 12) problems.push(`Row ${offset + 2}: ${issue}.`);
          continue;
        }
        knownCodes.add(accession.toLowerCase());
        records.push({
          id: crypto.randomUUID(), accession_code: accession,
          prefix: structured?.[1].toUpperCase() || null, accession_number: structured?.[2] || null,
          purchase_year: purchaseYear, title, description, subject: subject || "Not recorded",
          publisher, condition: "Available", cover_image: null, created_at: now, updated_at: now,
        });
      }
    }
    if (problems.length) {
      throw new Error(`Import stopped without adding records. Fix the following rows and try again:\n${problems.join("\n")}`);
    }
    if (!records.length) throw new Error("No records were found to import.");
    await writeRecords(kind === "students" ? "students" : "books", records);
    notify(`${records.length.toLocaleString()} ${kind === "students" ? "student" : "library book"} record${records.length === 1 ? "" : "s"} imported.`);
    await refresh();
    if (state.session) flushOutbox();
  }

  async function compressPhoto(file) {
    if (!file || file.size === 0) return "";
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file for the book photo.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
    const source = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch (error) {
      throw new Error(`Could not read the selected book photo: ${error.message}`);
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  function showForm(title, fields, submitLabel, onSubmit, eyebrow = "SCHOOL BOOK RECORD") {
    const dialog = byId("form-dialog");
    byId("dialog-eyebrow").textContent = eyebrow;
    byId("dialog-title").textContent = title;
    byId("dialog-fields").innerHTML = fields;
    byId("dialog-submit").textContent = submitLabel;
    const form = byId("dialog-form");
    form.onsubmit = async (event) => {
      // Cancel/close is never a save attempt: bypass required-field checks and
      // close immediately without invoking the record callback.
      if (event.submitter?.value === "cancel") {
        event.preventDefault();
        dialog.close("cancel");
        return;
      }
      event.preventDefault();
      const button = byId("dialog-submit");
      button.disabled = true;
      try {
        await onSubmit(new FormData(form));
        dialog.close();
      } catch (error) {
        notify(error.message || "The record could not be saved.", true);
      } finally {
        button.disabled = false;
      }
    };
    dialog.showModal();
  }

  function localDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function localDateIso(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function byNewest(items) {
    return [...items].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }

  function houseName(code) {
    return HOUSES[code] || code || "Not assigned";
  }

  function currentLoanFor(bookId, loans) {
    return loans.find((loan) => loan.book_id === bookId && !loan.returned_at);
  }

  function buildFollowUpRecords(students, books, loans) {
    const studentMap = new Map(students.map((student) => [student.id, student]));
    const bookMap = new Map(books.map((book) => [book.id, book]));
    const outstanding = loans.filter((loan) => !loan.returned_at);
    const records = outstanding.map((loan) => {
      const student = studentMap.get(loan.student_id);
      const book = bookMap.get(loan.book_id);
      return {
        houseCode: loan.house_code_snapshot || student?.house_code || "Unassigned",
        student, book, loan,
        type: book?.condition === "Lost" ? "Missing / unreturned" : "Unreturned",
      };
    });
    for (const book of books.filter((item) => item.condition === "Lost" && !outstanding.some((loan) => loan.book_id === item.id))) {
      const lastLoan = byNewest(loans.filter((loan) => loan.book_id === book.id))[0];
      const student = lastLoan ? studentMap.get(lastLoan.student_id) : null;
      records.push({
        houseCode: lastLoan?.house_code_snapshot || student?.house_code || "Unassigned",
        student, book, loan: lastLoan, type: "Missing",
      });
    }
    const houseOrder = new Map(Object.keys(HOUSES).map((code, index) => [code, index]));
    return records.sort((a, b) => {
      const houseComparison = (houseOrder.get(a.houseCode) ?? 99) - (houseOrder.get(b.houseCode) ?? 99);
      return houseComparison || (a.student?.full_name || "").localeCompare(b.student?.full_name || "")
        || (a.book?.accession_code || "").localeCompare(b.book?.accession_code || "");
    });
  }

  async function refresh() {
    if (state.syncConfig && !state.session) {
      content.innerHTML = `<section class="panel panel-empty"><strong>Sign in to access school records</strong><p>School records are hidden on this device until an authorized staff account is verified. The local-only demo is separate from the shared school workspace.</p><button class="button button-primary" type="button" id="signin-required-button">Sign in</button></section>`;
      byId("signin-required-button")?.addEventListener("click", showAuthDialog);
      return;
    }
    try {
      if (state.page === "dashboard") await renderDashboard();
      if (state.page === "circulation") await renderCirculation();
      if (state.page === "inventory") await renderInventory();
      if (state.page === "bookstore") await renderBookstore();
      if (state.page === "bookstore-returns") await renderBookstoreReturns();
      if (state.page === "year-setup") await renderYearSetup();
      if (state.page === "archives") await renderArchives();
      if (state.page === "students") await renderStudents();
      if (state.page === "reports") await renderReports();
      if (state.page === "governance") await renderGovernance();
    } catch (error) {
      content.innerHTML = `<section class="panel panel-empty"><strong>Workspace could not be loaded</strong><p>${escapeHtml(error.message || "Check local storage access and try again.")}</p></section>`;
    }
  }

  function heading(eyebrow, title, description, action = "") {
    return `<div class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action}</div>`;
  }

  function statCard(label, value, note) {
    return `<article class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-number">${value}</div><div class="stat-note">${escapeHtml(note)}</div></article>`;
  }

  function demoDateOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDateIso(date);
  }

  async function loadFictionalDemoData() {
    if (state.syncConfig) throw new Error("Fictional demo data can only be loaded into an unconnected local demo workspace.");
    const [students, books, copies, allocations] = await Promise.all([
      getAll("students"), getAll("books"), getAll("textbook_copies"), getAll("textbook_allocations"),
    ]);
    if (students.length || books.length || copies.length || allocations.length) {
      throw new Error("This workspace already contains records. Demo data was not added to avoid mixing it with other records.");
    }
    const now = new Date().toISOString();
    const makeStudent = (admission, fullName, house, section, classNumber = 1) => ({
      id: crypto.randomUUID(), admission_number: admission, full_name: fullName,
      house_code: `${house}${section}`, house, school_section: section,
      current_class: classNumber === 1 ? "Grade 10 Delta" : "Grade 10 Alpha", active: true,
      grade: "Grade 10", class_number: classNumber, academic_status: "active",
      created_at: now, updated_at: now,
    });
    const demoStudents = [
      makeStudent("DEMO-1001", "Amina Njoroge", "T", "G"),
      makeStudent("DEMO-1002", "Brian Kiptoo", "A", "B"),
      makeStudent("DEMO-1003", "Wanjiku Muthoni", "N", "G", 2),
      makeStudent("DEMO-1004", "Kevin Otieno", "M", "B", 2),
      makeStudent("DEMO-1005", "Faith Chebet", "T", "G"),
      makeStudent("DEMO-1006", "Daniel Mwangi", "A", "B"),
      makeStudent("DEMO-1007", "Mary Atieno", "N", "G", 2),
      makeStudent("DEMO-1008", "Samuel Maina", "M", "B", 2),
    ];
    const demoLibraryBooks = [
      ["LIB-001-2022", "Foundations of Mathematics · Grade 10", "Mathematics", 2022],
      ["LIB-002-2021", "Integrated Science · Grade 10", "Integrated Science", 2021],
      ["LIB-003-2023", "English Language and Literature", "English", 2023],
      ["LIB-004-2020", "Introduction to Geography", "Geography", 2020],
    ].map(([accession_code, title, subject, purchase_year]) => ({
      id: crypto.randomUUID(), accession_code, prefix: accession_code.split("-")[0],
      accession_number: accession_code.split("-")[1], purchase_year, title,
      description: "Fictional demonstration library copy", subject,
      publisher: "KBMS Demo Press", condition: "Available", cover_image: null,
      created_at: now, updated_at: now,
    }));
    const demoTextbooks = [
      ["INV-001-2020", "Mathematics · Grade 10", "Mathematics", 2020],
      ["INV-002-2020", "Mathematics · Grade 10", "Mathematics", 2020],
      ["INV-003-2020", "Mathematics · Grade 10", "Mathematics", 2020],
      ["INV-004-2021", "Integrated Science · Grade 10", "Integrated Science", 2021],
      ["INV-005-2021", "Integrated Science · Grade 10", "Integrated Science", 2021],
      ["INV-006-2022", "English · Grade 10", "English", 2022],
      ["INV-007-2022", "English · Grade 10", "English", 2022],
      ["INV-008-2023", "Geography · Grade 10", "Geography", 2023],
    ].map(([copy_code, title, subject, purchase_year]) => ({
      id: crypto.randomUUID(), copy_code, title, subject, publisher: "KBMS Demo Press",
      purchase_year, condition: "Available", cover_image: null, created_at: now, updated_at: now,
    }));

    await writeRecords("students", demoStudents);
    await writeRecords("books", demoLibraryBooks);
    await writeRecords("textbook_copies", demoTextbooks);

    const [overdueStudent, currentStudent] = demoStudents;
    const overdueLoan = {
      id: crypto.randomUUID(), student_id: overdueStudent.id, book_id: demoLibraryBooks[0].id,
      student_admission_snapshot: overdueStudent.admission_number, student_name_snapshot: overdueStudent.full_name,
      house_code_snapshot: overdueStudent.house_code, grade_snapshot: overdueStudent.grade,
      class_number_snapshot: overdueStudent.class_number, class_snapshot: overdueStudent.current_class,
      book_code_snapshot: demoLibraryBooks[0].accession_code, book_title_snapshot: demoLibraryBooks[0].title,
      purchase_year_snapshot: demoLibraryBooks[0].purchase_year, issued_at: demoDateOffset(-10),
      due_date: demoDateOffset(-3), returned_at: null, created_at: now, updated_at: now,
    };
    const currentLoan = {
      id: crypto.randomUUID(), student_id: currentStudent.id, book_id: demoLibraryBooks[1].id,
      student_admission_snapshot: currentStudent.admission_number, student_name_snapshot: currentStudent.full_name,
      house_code_snapshot: currentStudent.house_code, grade_snapshot: currentStudent.grade,
      class_number_snapshot: currentStudent.class_number, class_snapshot: currentStudent.current_class,
      book_code_snapshot: demoLibraryBooks[1].accession_code, book_title_snapshot: demoLibraryBooks[1].title,
      purchase_year_snapshot: demoLibraryBooks[1].purchase_year, issued_at: demoDateOffset(-2),
      due_date: demoDateOffset(5), returned_at: null, created_at: now, updated_at: now,
    };
    await writeRecord("loans", overdueLoan);
    await writeRecord("loans", currentLoan);

    const allocationRecords = demoTextbooks.slice(0, 2).map((copy, index) => {
      const student = demoStudents[index];
      return {
        id: crypto.randomUUID(), copy_id: copy.id, copy_code_snapshot: copy.copy_code,
        title_snapshot: copy.title, subject_snapshot: copy.subject, student_id: student.id,
        student_admission_snapshot: student.admission_number, student_name_snapshot: student.full_name,
        grade_snapshot: student.grade, class_number_snapshot: student.class_number,
        class_snapshot: student.current_class, academic_year: new Date().getFullYear(),
        allocated_at: demoDateOffset(-20), due_date: `${new Date().getFullYear()}-12-31`,
        returned_at: null, created_at: now, updated_at: now,
      };
    });
    await createTextbookAllocations(allocationRecords);

    const clearedStudent = demoStudents[2];
    await writeRecords("clearance_records", ["library", "bookstore"].map((department) => ({
      id: crypto.randomUUID(), student_id: clearedStudent.id, department,
      academic_year_id: null, status: "cleared", checked_by: null, checked_at: now,
      notes: "Fictional demonstration history", created_at: now, updated_at: now,
    })));

    const demoStaff = [
      ["STF-DEMO-01", "Grace Wanjiru", "principal", "Chief Principal"],
      ["STF-DEMO-02", "Peter Mutua", "library_admin", "Library Administrator"],
      ["STF-DEMO-03", "Lydia Chebet", "bookstore_admin", "Bookstore Administrator"],
      ["STF-DEMO-04", "James Mwangi", "class_teacher", "Class Teacher"],
      ["STF-DEMO-05", "Anne Achieng", "subject_teacher", "Subject Teacher"],
    ].map(([staff_code, display_name, role, role_label]) => ({
      id: crypto.randomUUID(), staff_code, display_name, role, role_label,
      active: true, demo_record: true, created_at: now, updated_at: now,
    }));
    await writeRecords("staff_profiles", demoStaff);
    const demoYearId = crypto.randomUUID();
    const demoYear = { id: demoYearId, year_label: String(new Date().getFullYear()), starts_on: `${new Date().getFullYear()}-01-01`, ends_on: `${new Date().getFullYear()}-12-31`, is_current: true, status: "active", archived_at: null, created_at: now };
    const demoClasses = [
      { id: crypto.randomUUID(), academic_year_id: demoYearId, class_code: "G10-DELTA", display_name: "Grade 10 Delta", grade: "Grade 10", grade_label: "Grade 10", class_label: "Grade 10 Delta", active: true, archived_at: null, created_at: now },
      { id: crypto.randomUUID(), academic_year_id: demoYearId, class_code: "G10-ALPHA", display_name: "Grade 10 Alpha", grade: "Grade 10", grade_label: "Grade 10", class_label: "Grade 10 Alpha", active: true, archived_at: null, created_at: now },
    ];
    const demoSubjects = ["Mathematics", "Integrated Science", "English", "Geography"].map((name) => ({ id: crypto.randomUUID(), name, active: true, created_at: now }));
    await writeRecord("academic_years", demoYear);
    await writeRecords("school_classes", demoClasses);
    await writeRecords("school_subjects", demoSubjects);
    await writeRecords("staff_assignments", [
      { id: crypto.randomUUID(), staff_id: demoStaff[3].id, class_id: demoClasses[0].id, subject_id: null, assignment_type: "class_teacher", starts_on: `${new Date().getFullYear()}-01-01`, ends_on: null, active: true, created_at: now },
      { id: crypto.randomUUID(), staff_id: demoStaff[4].id, class_id: demoClasses[0].id, subject_id: demoSubjects[0].id, assignment_type: "subject_teacher", starts_on: `${new Date().getFullYear()}-01-01`, ends_on: null, active: true, created_at: now },
    ]);
    await writeRecords("approval_requests", [{
      id: crypto.randomUUID(), request_type: "inventory_adjustment", title: "Review a damaged textbook copy",
      description: "A fictional copy has been reported damaged and requires an administrator decision.",
      status: "pending", requested_by: null, requested_by_label: "Bookstore Administrator",
      requested_at: now, decided_by: null, decided_at: null, decision_note: "", demo_record: true, created_at: now, updated_at: now,
    }]);
    notify("Official demonstration scenario loaded. All student, staff and transaction records are fictional.");
    await refresh();
  }

  async function renderDashboard() {
    const [books, students, loans, textbookCopies, textbookAllocations] = await Promise.all([getAll("books"), getAll("students"), getAll("loans"), getAll("textbook_copies"), getAll("textbook_allocations")]);
    const circulating = loans.filter((loan) => !loan.returned_at);
    const overdue = circulating.filter((loan) => loan.due_date && loan.due_date < localDateIso());
    const damaged = books.filter((book) => book.condition === "Damaged").length;
    const lost = books.filter((book) => book.condition === "Lost").length;
    const streamRows = Object.entries(HOUSES).map(([code, label]) => {
      const studentMap = new Map(students.map((student) => [student.id, student]));
      const houseLoans = loans.filter((loan) => (loan.house_code_snapshot || studentMap.get(loan.student_id)?.house_code) === code);
      const returned = houseLoans.filter((loan) => loan.returned_at).length;
      const rate = houseLoans.length ? Math.round((returned / houseLoans.length) * 100) : null;
      return `<div class="stream-row"><span class="stream-name">${code} · ${escapeHtml(label)}</span><div class="bar-track" aria-label="${rate === null ? "No lending records" : `${rate}% of loans returned`}"><div class="bar-fill" style="width:${rate || 0}%"></div></div><span class="stream-count">${rate === null ? "No loans" : `${rate}%`}</span></div>`;
    }).join("");
    content.innerHTML = `${heading("MOI HIGH SCHOOL · KABARAK", "Books, in good order.", "A clear view of library circulation, textbook lending and student records.", `<button class="button button-primary" data-page-link="circulation">Record a loan</button>`)}
      <section class="stats-grid" aria-label="Live library metrics">
        ${statCard("ON LOAN", circulating.length, "Library copies currently with students")}
        ${statCard("OVERDUE", overdue.length, "Past a recorded return date")}
        ${statCard("TEXTBOOKS OUT", textbookAllocations.filter((item) => !item.returned_at).length, `${textbookCopies.length} individual textbook copies recorded`)}
        ${statCard("STUDENTS", students.length, `${damaged + lost} library copies damaged or lost`)}
      </section>
      ${!state.syncConfig && students.length ? `<section class="panel demo-walkthrough"><div class="panel-header"><div><span class="eyebrow">OFFICIAL DEMONSTRATION</span><h2>Presentation walkthrough</h2><p>Follow one fictional student's journey through the system.</p></div><span class="status-tag">Fictional data only</span></div><div class="demo-steps"><button type="button" data-page-link="students"><span>01</span><strong>Student register</strong><small>Find DEMO-1001 and review the student profile.</small></button><button type="button" data-page-link="circulation"><span>02</span><strong>Library circulation</strong><small>Show the overdue loan and estimated late fee.</small></button><button type="button" data-page-link="bookstore"><span>03</span><strong>Textbook register</strong><small>Review physical copy codes and allocations.</small></button><button type="button" data-page-link="reports"><span>04</span><strong>Clearance & reports</strong><small>Review department follow-up and outstanding books.</small></button></div><div class="demo-footer"><p>All names, admission numbers, books and transactions are invented for this presentation.</p></div></section>` : ""}
      ${canManageRecords() ? `<section class="panel quick-actions-panel"><div class="panel-header"><div><h2>Desk shortcuts</h2><p>Common tasks for library and textbook desks.</p></div></div><div class="quick-actions">${canManageLibrary() ? `<button class="button button-secondary" data-action="add-book">Add library copy</button><button class="button button-secondary" data-action="quick-issue">Issue a library book</button>` : ""}${canManageTextbookInventory() ? `<button class="button button-secondary" data-page-link="bookstore">Manage textbook copies</button>` : ""}${canManageStudents() ? `<button class="button button-secondary" data-action="add-student">Register student</button>` : ""}</div></section>` : ""}
      ${!state.syncConfig && students.length === 0 && books.length === 0 && textbookCopies.length === 0 && textbookAllocations.length === 0 ? `<section class="panel quick-actions-panel"><div class="panel-header"><div><h2>Start the official demo</h2><p>Load a prepared scenario with fictional students, library loans, textbook allocations and clearance history.</p></div><span class="status-tag">Fictional data</span></div><div class="quick-actions"><button class="button button-primary" data-action="load-demo-data">Load official demo records</button></div></section>` : ""}
      <div class="overview-grid">
        <section class="panel"><div class="panel-header"><div><h2>Book return rate by house</h2><p>Returned lending records as a share of recorded issues</p></div><span class="status-tag">Live records</span></div><div class="panel-body"><div class="stream-list">${streamRows}</div></div></section>
        <section class="panel"><div class="panel-header"><div><h2>Recent circulation</h2><p>Latest issue and return activity</p></div><button class="footer-link" data-page-link="circulation">View ledger</button></div><div id="recent-activity"></div></section>
      </div>
      <section class="panel quick-panel"><div class="panel-header"><div><h2>Quick issue terminal</h2><p>Scan a student admission and a book code already in the library catalog.</p></div><span class="status-tag">Ready</span></div><div class="panel-body"><form class="quick-entry" id="quick-issue-form"><label class="field"><span>Student and book code</span><input name="scan" autocomplete="off" placeholder="Admission number  BOOK-CODE" required${canManageLibrary() ? "" : " disabled"}></label><button class="button button-primary" type="submit"${canManageLibrary() ? "" : " disabled"}>Issue book</button></form><p class="inline-hint">Enter the student admission or name and the exact code from the library catalog. Separate them with a space, tab or comma.</p></div></section>`;
    const recent = byNewest(loans).slice(0, 5);
    const studentsById = new Map(students.map((student) => [student.id, student]));
    const booksById = new Map(books.map((book) => [book.id, book]));
    byId("recent-activity").innerHTML = recent.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Book</th><th>Activity</th></tr></thead><tbody>${recent.map((loan) => `<tr><td><strong>${escapeHtml(studentsById.get(loan.student_id)?.full_name || "Unknown student")}</strong></td><td class="code-text">${escapeHtml(booksById.get(loan.book_id)?.accession_code || "Unknown book")}</td><td><span class="status-tag ${loan.returned_at ? "good" : ""}">${loan.returned_at ? "Returned" : "Issued"}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="panel-empty"><span class="empty-mark">L</span><strong>No circulation records yet</strong><p>Issued and returned textbooks will appear here.</p></div>`;
    byId("quick-issue-form").addEventListener("submit", (event) => {
      event.preventDefault();
      issueFromScan(String(new FormData(event.currentTarget).get("scan")));
    });
  }

  async function renderCirculation() {
    const [loans, students, books] = await Promise.all([getAll("loans"), getAll("students"), getAll("books")]);
    const studentMap = new Map(students.map((item) => [item.id, item]));
    const bookMap = new Map(books.map((item) => [item.id, item]));
    const records = byNewest(loans);
    content.innerHTML = `${heading("LIBRARY", "Issue & return", "Record borrowing and returns for individually catalogued library copies.", `<button class="button button-primary" data-action="quick-issue"${canManageLibrary() ? "" : " hidden"}>Issue a book</button>`)}
      <section class="panel"><div class="panel-header"><div><h2>Issue and return terminal</h2><p>Enter an admission number or student name, followed by the book code.</p></div><div class="segmented"><button class="segment-button ${state.circulationMode === "issue" ? "active" : ""}" data-mode="issue">Issue</button><button class="segment-button ${state.circulationMode === "return" ? "active" : ""}" data-mode="return">Return</button></div></div>
      <div class="panel-body"><form id="circulation-form" class="quick-entry circulation-entry"><label class="field"><span>Student name or admission</span><input name="student" autocomplete="off" placeholder="Search student" required${canManageLibrary() ? "" : " disabled"}></label><label class="field"><span>Library book code</span><input name="book" autocomplete="off" placeholder="Enter the catalogued code" required${canManageLibrary() ? "" : " disabled"}></label>${state.circulationMode === "issue" ? `<label class="field"><span>Weekly return date</span><input name="due_date" type="date" required${canManageLibrary() ? "" : " disabled"}></label>` : ""}<button class="button button-primary" type="submit"${canManageLibrary() ? "" : " disabled"}>${state.circulationMode === "issue" ? "Issue book" : "Record return"}</button></form><p class="inline-hint">${canManageLibrary() ? "Use the code printed on the physical copy. Enter the weekly return date specified by the school. Late-fee estimates use KSh 5 per calendar day after that date." : "Your account does not have permission to record library issues or returns."}</p></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Borrowing history</h2><p>${records.length} recorded issue${records.length === 1 ? "" : "s"}</p></div><button class="button button-secondary" data-action="export-overdue">Export unreturned CSV</button></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>House</th><th>Book code</th><th>Issued</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${records.length ? records.map((loan) => {
        const student = studentMap.get(loan.student_id);
        const book = bookMap.get(loan.book_id);
        const isOverdue = !loan.returned_at && loan.due_date && loan.due_date < localDateIso();
        return `<tr><td><strong>${escapeHtml(loan.student_name_snapshot || student?.full_name || "Student record unavailable")}</strong><br><small>${escapeHtml(loan.student_admission_snapshot || student?.admission_number || "")}</small></td><td>${escapeHtml(houseName(loan.house_code_snapshot || student?.house_code || "Not assigned"))}</td><td class="code-text">${escapeHtml(loan.book_code_snapshot || book?.accession_code || "Book record unavailable")}</td><td>${escapeHtml(loan.issued_at || "Not recorded")}</td><td>${escapeHtml(loan.due_date || "Not set")}</td><td><span class="status-tag ${loan.returned_at ? "good" : isOverdue ? "danger" : "warn"}">${loan.returned_at ? "Returned" : isOverdue ? "Overdue" : "On loan"}</span></td><td>${loan.returned_at || !canManageLibrary() ? "" : `<button class="footer-link" data-return-loan="${escapeHtml(loan.id)}">Record return</button>`}</td></tr>`;
      }).join("") : `<tr><td class="table-empty" colspan="7">No loans recorded. Add students and books before issuing a textbook.</td></tr>`}</tbody></table></div></section>`;
    byId("circulation-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await issueOrReturn(String(data.get("student")), String(data.get("book")), state.circulationMode, String(data.get("due_date") || ""));
    });
  }

  async function renderInventory() {
    const [books, loans] = await Promise.all([getAll("books"), getAll("loans")]);
    const filtered = books.filter((book) => {
      const query = state.inventoryQuery.toLowerCase();
      const matches = !query || [book.title, book.description, book.subject, book.publisher, book.accession_code].some((item) => String(item || "").toLowerCase().includes(query));
      const matchesCondition = state.inventoryFilter === "all"
        || (state.inventoryFilter === "Issued" ? Boolean(currentLoanFor(book.id, loans)) : book.condition === state.inventoryFilter);
      return matches && matchesCondition;
    });
    const bookRows = filtered.map((book) => {
        const age = book.purchase_year ? new Date().getFullYear() - Number(book.purchase_year) : null;
        const loaned = currentLoanFor(book.id, loans);
        const condition = loaned ? "Issued" : book.condition;
        const ageClass = age === null ? "" : age >= 8 ? "danger" : age >= 5 ? "warn" : "good";
        return `<tr><td class="code-text">${escapeHtml(book.accession_code)}</td><td><strong>${escapeHtml(book.title)}</strong>${book.description ? `<br><small>${escapeHtml(book.description)}</small>` : ""}</td><td>${escapeHtml(book.subject || "Not recorded")}</td><td>${escapeHtml(book.publisher || "Not recorded")}</td><td>${escapeHtml(book.purchase_year || "Not recorded")}</td><td><span class="status-tag ${ageClass}">${age === null ? "Not recorded" : `${age} yr`}</span></td><td><span class="status-tag ${condition === "Available" ? "good" : condition === "Lost" || condition === "Damaged" ? "danger" : "warn"}">${escapeHtml(condition)}</span></td><td>${canManageLibrary() ? `<button class="footer-link" data-edit-book="${escapeHtml(book.id)}">Edit</button>` : ""}</td></tr>`;
    }).join("");
    const bookCards = filtered.map((book) => {
      const age = book.purchase_year ? new Date().getFullYear() - Number(book.purchase_year) : null;
      const loaned = currentLoanFor(book.id, loans);
      const condition = loaned ? "Issued" : book.condition;
      const ageClass = age === null ? "" : age >= 8 ? "danger" : age >= 5 ? "warn" : "good";
      return `<article class="book-card">${book.cover_image ? `<img class="book-cover" src="${escapeHtml(book.cover_image)}" alt="Cover of ${escapeHtml(book.title)}">` : `<div class="book-cover-placeholder" aria-hidden="true">BOOK</div>`}<div class="book-card-top"><span class="book-subject">${escapeHtml(book.subject || "Subject not recorded")}</span><span class="status-tag ${condition === "Available" ? "good" : condition === "Lost" || condition === "Damaged" ? "danger" : "warn"}">${escapeHtml(condition)}</span></div><h3>${escapeHtml(book.title)}</h3><p class="code-text">${escapeHtml(book.accession_code)}</p>${book.description ? `<p class="book-description">${escapeHtml(book.description)}</p>` : ""}<dl><div><dt>Publisher</dt><dd>${escapeHtml(book.publisher || "Not recorded")}</dd></div><div><dt>Purchase year</dt><dd>${escapeHtml(book.purchase_year || "Not recorded")}</dd></div><div><dt>Age</dt><dd><span class="status-tag ${ageClass}">${age === null ? "Not recorded" : `${age} yr`}</span></dd></div></dl>${canManageLibrary() ? `<button class="footer-link" data-edit-book="${escapeHtml(book.id)}">Edit copy</button>` : ""}</article>`;
    }).join("");
    const emptyMessage = books.length ? "No books match these filters." : "No textbook copies cataloged yet.";
    content.innerHTML = `${heading("LIBRARY COLLECTION", "Library catalog", "Track individual copies, current availability and searchable book details.", canManageLibrary() ? `<div class="heading-actions"><button class="button button-secondary" data-action="import-books">Import CSV</button><button class="button button-primary" data-action="add-book">Add library copy</button></div>` : "")}
      <section class="panel"><div class="panel-header inventory-header"><div><h2>Library collection</h2><p>${filtered.length} of ${books.length} registered cop${books.length === 1 ? "y" : "ies"}</p></div><div class="inventory-toolbar"><div class="toolbar"><div class="search-wrap"><input class="search-input" id="inventory-search" type="search" value="${escapeHtml(state.inventoryQuery)}" placeholder="Search title, description or book code"></div><select class="filter-select" id="inventory-filter" aria-label="Filter inventory">${[["all", "All conditions"], ["Available", "Available"], ["Issued", "Issued"], ["Damaged", "Damaged"], ["Lost", "Lost"]].map(([key, label]) => `<option value="${key}"${state.inventoryFilter === key ? " selected" : ""}>${label}</option>`).join("")}</select></div><div class="segmented inventory-views" aria-label="Catalog layout"><button class="segment-button ${state.inventoryView === "table" ? "active" : ""}" data-inventory-view="table" aria-pressed="${state.inventoryView === "table"}">Table</button><button class="segment-button ${state.inventoryView === "gallery" ? "active" : ""}" data-inventory-view="gallery" aria-pressed="${state.inventoryView === "gallery"}">Gallery</button></div></div></div>
      ${state.inventoryView === "table" ? `<div class="table-wrap"><table><thead><tr><th>Accession code</th><th>Title</th><th>Subject</th><th>Publisher</th><th>Purchase year</th><th>Age</th><th>Condition</th><th></th></tr></thead><tbody>${bookRows || `<tr><td class="table-empty" colspan="8">${escapeHtml(emptyMessage)}${!books.length && canManageLibrary() ? `<div class="empty-actions"><button class="button button-primary" data-action="add-book">Catalog first book</button></div>` : ""}</td></tr>`}</tbody></table></div>` : `<div class="book-grid">${bookCards || `<div class="panel-empty"><strong>${escapeHtml(emptyMessage)}</strong>${!books.length && canManageLibrary() ? `<button class="button button-primary" data-action="add-book">Catalog first book</button>` : ""}</div>`}</div>`}</section>
      <p class="inline-hint">Aging indicator: 5+ years warrants review; 8+ years warrants replacement assessment. Thresholds are operational prompts, not automatic disposal decisions.</p>`;
    byId("inventory-search").addEventListener("input", async (event) => {
      state.inventoryQuery = event.target.value;
      const start = event.target.selectionStart;
      const end = event.target.selectionEnd;
      await renderInventory();
      const search = byId("inventory-search");
      search.focus();
      search.setSelectionRange(start, end);
    });
    byId("inventory-filter").addEventListener("change", (event) => { state.inventoryFilter = event.target.value; renderInventory(); });
  }

  async function renderBookstore() {
    const [copies, allocations, students] = await Promise.all([
      getAll("textbook_copies"), getAll("textbook_allocations"), getAll("students"),
    ]);
    const query = state.textbookQuery.trim().toLowerCase();
    const active = allocations.filter((item) => !item.returned_at);
    const allocatedIds = new Set(active.map((item) => item.copy_id));
    const filtered = copies.filter((copy) => [copy.title, copy.subject, copy.copy_code, copy.publisher]
      .some((value) => String(value || "").toLowerCase().includes(query)));
    const rows = filtered.map((copy) => {
      const allocation = active.find((item) => item.copy_id === copy.id);
      const status = allocation ? "Allocated" : copy.condition || "Available";
      const statusClass = status === "Available" ? "good" : status === "Lost" || status === "Damaged" ? "danger" : "warn";
      return `<tr><td class="code-text">${escapeHtml(copy.copy_code)}</td><td class="shop-item-cell">${copy.cover_image ? `<img class="shop-thumb" src="${escapeHtml(copy.cover_image)}" alt="Cover of ${escapeHtml(copy.title)}">` : ""}<span><strong>${escapeHtml(copy.title)}</strong><small>${escapeHtml(copy.subject || "Subject not recorded")}${copy.publisher ? ` · ${escapeHtml(copy.publisher)}` : ""}</small></span></td><td>${escapeHtml(copy.purchase_year || "Not recorded")}</td><td><span class="status-tag ${statusClass}">${status}</span></td><td>${allocation ? `${escapeHtml(allocation.student_name_snapshot)}<br><span class="code-text">${escapeHtml(allocation.student_admission_snapshot)}</span>` : "—"}</td><td class="row-actions">${canManageTextbookInventory() || canManageTextbookAllocations() ? `${canManageTextbookAllocations() && !allocation && status === "Available" ? `<button class="button button-secondary button-small" data-allocate-copy="${escapeHtml(copy.id)}">Allocate</button>` : ""}${canManageTextbookInventory() ? `<button class="footer-link" data-edit-textbook="${escapeHtml(copy.id)}">Edit</button>` : ""}` : ""}</td></tr>`;
    }).join("");
    const outstandingRows = byNewest(active).map((item) => `<tr><td class="code-text">${escapeHtml(item.copy_code_snapshot)}</td><td><strong>${escapeHtml(item.title_snapshot)}</strong><small>${escapeHtml(item.subject_snapshot || "")}</small></td><td>${escapeHtml(item.student_name_snapshot)}<br><span class="code-text">${escapeHtml(item.student_admission_snapshot)}</span></td><td>${escapeHtml(item.academic_year || "—")}</td><td>${escapeHtml(item.due_date || "Not set")}</td><td>${canReturnTextbookAllocations() ? `<button class="button button-secondary button-small" data-return-textbook="${escapeHtml(item.id)}">Record return</button>` : "Outstanding"}</td></tr>`).join("");
    content.innerHTML = `${heading("BOOKSTORE · TEXTBOOK REGISTER", "Textbook register", "Track each textbook copy and the student currently responsible for it. This is a lending register — not a sales counter.", `${canManageTextbookInventory() ? `<button class="button button-secondary" data-action="textbook-template">Download import template</button><button class="button button-secondary" data-action="import-textbook-copies">Bulk import</button><button class="button button-primary" data-action="add-textbook-copy">Add textbook copy</button>` : ""}${canManageTextbookAllocations() ? `<button class="button button-secondary" data-action="bulk-allocate-textbooks">Class allocation</button>` : ""}${canReturnTextbookAllocations() ? `<button class="button button-secondary" data-page-link="bookstore-returns">Process returns</button>` : ""}`)}
      <section class="stats-grid" aria-label="Textbook lending summary">${statCard("INDIVIDUAL COPIES", copies.length, "Textbook copies in this register")}${statCard("AVAILABLE", copies.filter((copy) => !allocatedIds.has(copy.id) && (copy.condition || "Available") === "Available").length, "Ready to allocate")}${statCard("ALLOCATED", active.length, "Currently held by students")}${statCard("RETURNED", allocations.filter((item) => item.returned_at).length, "Historical allocations returned")}</section>
      <section class="panel"><div class="panel-header inventory-header"><div><h2>Textbook copies</h2><p>${filtered.length} of ${copies.length} copies · each physical copy has its own code</p></div><div class="toolbar"><div class="search-wrap"><input class="search-input" id="textbook-search" type="search" value="${escapeHtml(state.textbookQuery)}" placeholder="Search title, subject or copy code"></div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Copy code</th><th>Textbook</th><th>Year acquired</th><th>Status</th><th>Currently allocated to</th><th></th></tr></thead><tbody>${rows || `<tr><td class="table-empty" colspan="6">${copies.length ? "No textbook copies match this search." : "No textbook copies recorded yet. Add the first physical copy to begin."}</td></tr>`}</tbody></table></div></section>
      <section class="panel textbook-allocations-panel"><div class="panel-header"><div><h2>Outstanding textbook allocations</h2><p>Students who still have bookstore textbooks to return</p></div></div><div class="table-wrap"><table><thead><tr><th>Copy code</th><th>Textbook</th><th>Student</th><th>Academic year</th><th>Return deadline</th><th></th></tr></thead><tbody>${outstandingRows || `<tr><td class="table-empty" colspan="6">No outstanding textbook allocations.</td></tr>`}</tbody></table></div></section>
      <p class="inline-hint">For bulk entry, download the template and add one row per physical copy. Repeat the title for multiple copies, but give every copy its own unique code. The entire file is checked before anything is imported. Demo data is stored on this device unless the matching textbook tables are installed in the shared database. Set the school's confirmed academic-year return date when allocating; no school deadline has been assumed.</p>`;
    byId("textbook-search").addEventListener("input", async (event) => {
      state.textbookQuery = event.target.value;
      const start = event.target.selectionStart;
      const end = event.target.selectionEnd;
      await renderBookstore();
      const search = byId("textbook-search");
      search.focus();
      search.setSelectionRange(start, end);
    });
  }

  async function importTextbookCopies(file) {
    if (!file) throw new Error("Choose an Excel (.xlsx) or CSV file.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose a spreadsheet smaller than 20 MB.");
    const rows = file.__parsedRows || await readImportRows(file);
    if (rows.length < 2) throw new Error("The spreadsheet needs a header row and at least one textbook copy.");
    if (rows.length - 1 > 10000) throw new Error("Import at most 10,000 textbook copies at a time.");
    const indexes = csvHeaderIndexes(rows[0]);
    const existing = await getAll("textbook_copies");
    const knownCodes = new Set(existing.map((copy) => String(copy.copy_code).toLowerCase()));
    const problems = [];
    const records = [];
    const now = new Date().toISOString();
    const allowedConditions = new Set(["available", "damaged", "lost"]);
    for (const [offset, row] of rows.slice(1).entries()) {
      const copyCode = csvValue(row, indexes, ["copy_code", "book_code", "code", "barcode", "legacy_code"]);
      const title = csvValue(row, indexes, ["title", "book_title", "textbook_title", "name"]);
      const subject = csvValue(row, indexes, ["subject", "course"]);
      const publisher = csvValue(row, indexes, ["publisher", "edition", "publishing_house"]);
      const yearText = csvValue(row, indexes, ["purchase_year", "year_acquired", "year"]);
      const conditionInput = (csvValue(row, indexes, ["condition", "status"]) || "Available").toLowerCase();
      const year = yearText ? Number(yearText) : null;
      let issue = "";
      if (!copyCode || !BOOK_CODE.test(copyCode)) issue = "missing or invalid individual copy code";
      else if (knownCodes.has(copyCode.toLowerCase())) issue = "duplicate copy code (already registered or repeated in this file)";
      else if (!title || title.length > 240) issue = "missing or overlong textbook title";
      else if (!subject || subject.length > 100) issue = "missing or overlong subject";
      else if (publisher.length > 160) issue = "publisher / edition is too long";
      else if (year !== null && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) issue = "invalid acquisition year";
      else if (!allowedConditions.has(conditionInput)) issue = "condition must be Available, Damaged or Lost";
      if (issue) {
        if (problems.length < 20) problems.push(`Row ${offset + 2}: ${issue}.`);
        continue;
      }
      knownCodes.add(copyCode.toLowerCase());
      records.push({
        id: crypto.randomUUID(), copy_code: copyCode, title, subject,
        publisher, purchase_year: year, condition: conditionInput[0].toUpperCase() + conditionInput.slice(1),
        cover_image: null, created_at: now, updated_at: now,
      });
    }
    if (problems.length) {
      throw new Error(`Nothing was imported. Fix the following rows and upload again:\n${problems.join("\n")}`);
    }
    if (!records.length) throw new Error("No textbook copy records were found.");
    const preview = records.slice(0, 8).map((record) => `• ${record.copy_code} — ${record.title}`).join("\n");
    const more = records.length > 8 ? `\n…and ${records.length - 8} more copies` : "";
    if (!window.confirm(`Ready to import ${records.length.toLocaleString()} textbook copies?\n\n${preview}${more}\n\nEach row represents one physical copy. No records have been added yet. Continue?`)) return;
    // Validate the whole file first; writeRecords commits the prepared batch together.
    await writeRecords("textbook_copies", records);
    notify(`${records.length.toLocaleString()} textbook cop${records.length === 1 ? "y" : "ies"} imported successfully.`);
    await refresh();
    if (state.session) flushOutbox();
  }

  async function addTextbookCopy(existing = null) {
    const fields = [
      formField("Individual copy code", "copy_code", { value: existing?.copy_code || "", maxLength: 80, full: true, placeholder: "Example: INV-001-2020" }),
      formField("Textbook title", "title", { value: existing?.title || "", maxLength: 240, full: true }),
      formField("Subject", "subject", { value: existing?.subject || "", maxLength: 100 }),
      formField("Publisher / edition", "publisher", { value: existing?.publisher || "", maxLength: 160, required: false }),
      formField("Year acquired", "purchase_year", { type: "number", min: 1900, max: 2100, value: existing?.purchase_year || "", required: false, hint: "Leave blank if the year is unknown; do not guess." }),
      formField("Condition", "condition", { value: existing?.condition || "Available", choices: [["Available", "Available"], ["Damaged", "Damaged"], ["Lost", "Lost"]] }),
      photoField(existing?.cover_image),
    ].join("");
    showForm(existing ? "Edit textbook copy" : "Add textbook copy", fields, existing ? "Save changes" : "Add copy", async (form) => {
      const copyCode = String(form.get("copy_code") || "").trim();
      const title = String(form.get("title") || "").trim();
      const subject = String(form.get("subject") || "").trim();
      const yearText = String(form.get("purchase_year") || "").trim();
      const year = yearText ? Number(yearText) : null;
      if (!copyCode || !BOOK_CODE.test(copyCode) || !title || title.length > 240 || !subject || subject.length > 100 || (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100))) {
        throw new Error("Enter a valid copy code, title, subject and optional acquisition year.");
      }
      const copies = await getAll("textbook_copies");
      if (copies.some((copy) => copy.copy_code.toLowerCase() === copyCode.toLowerCase() && copy.id !== existing?.id)) throw new Error("That textbook copy code is already registered.");
      const activeAllocations = await getAll("textbook_allocations");
      if (existing && activeAllocations.some((item) => item.copy_id === existing.id && !item.returned_at) && form.get("condition") !== "Available") {
        throw new Error("Return the allocated copy before changing its condition.");
      }
      const photo = await compressPhoto(form.get("cover_photo"));
      const now = new Date().toISOString();
      const record = { id: existing?.id || crypto.randomUUID(), copy_code: copyCode, title, subject,
        publisher: String(form.get("publisher") || "").trim(), purchase_year: year,
        condition: String(form.get("condition")), cover_image: photo || existing?.cover_image || null,
        created_at: existing?.created_at || now, updated_at: now };
      await writeRecord("textbook_copies", record);
      notify(existing ? "Textbook copy updated." : "Textbook copy added.");
      await refresh();
      if (state.session) flushOutbox();
    }, "BOOKSTORE TEXTBOOK COPY");
  }

  async function allocateTextbookCopy(copyId) {
    const [copy, students, allocations] = await Promise.all([
      getStoredRecord("textbook_copies", copyId), getAll("students"), getAll("textbook_allocations"),
    ]);
    if (!copy || copy.condition !== "Available" || allocations.some((item) => item.copy_id === copyId && !item.returned_at)) {
      notify("That textbook copy is not currently available.", true); return;
    }
    if (!students.length) { notify("Register or import students before allocating textbooks.", true); return; }
    const studentChoices = students.filter((student) => student.active !== false && student.academic_status !== "departed" && student.academic_status !== "graduated")
      .sort((a, b) => a.admission_number.localeCompare(b.admission_number))
      .map((student) => [student.id, `${student.admission_number} · ${student.full_name} (${student.grade}, Class ${student.class_number})`]);
    const currentYear = new Date().getFullYear();
    const fields = [
      formField("Student", "student_id", { choices: studentChoices, full: true }),
      formField("Academic year", "academic_year", { type: "number", min: 2020, max: 2200, value: currentYear }),
      formField("Return deadline (academic year end)", "due_date", { type: "date", full: true, hint: "Use the date confirmed by the school." }),
    ].join("");
    showForm(`Allocate ${copy.copy_code}`, fields, "Record allocation", async (form) => {
      const student = students.find((item) => item.id === form.get("student_id"));
      const academicYear = Number(form.get("academic_year"));
      const dueDate = String(form.get("due_date") || "");
      const parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
      if (!student || !Number.isInteger(academicYear) || academicYear < 2020 || academicYear > 2200
        || !parsedDueDate || Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate
        || dueDate < localDateIso()) throw new Error("Select a student, academic year and a valid return deadline that is today or later.");
      const record = { id: crypto.randomUUID(), copy_id: copy.id, copy_code_snapshot: copy.copy_code,
        title_snapshot: copy.title, subject_snapshot: copy.subject, student_id: student.id,
        student_admission_snapshot: student.admission_number, student_name_snapshot: student.full_name,
        grade_snapshot: student.grade, class_number_snapshot: student.class_number, class_snapshot: student.current_class || `${student.grade} · Class ${student.class_number}`,
        academic_year: academicYear, allocated_at: localDateIso(), due_date: dueDate,
        returned_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await createTextbookAllocation(record);
      notify(`${copy.copy_code} allocated to ${student.full_name}.`);
      await refresh();
      if (state.session) flushOutbox();
    }, "TEXTBOOK ALLOCATION");
  }

  async function bulkAllocateTextbooks() {
    if (!canManageTextbookAllocations()) return;
    const [students, copies, allocations] = await Promise.all([
      getAll("students"), getAll("textbook_copies"), getAll("textbook_allocations"),
    ]);
    const activeStudents = students.filter((student) => student.active !== false && student.academic_status !== "graduated");
    const classLabels = [...new Set(activeStudents.map((student) => student.current_class || `${student.grade} · Class ${student.class_number || "—"}`))].sort();
    const subjects = [...new Set(copies.filter((copy) => copy.condition === "Available").map((copy) => copy.subject).filter(Boolean))].sort();
    if (!classLabels.length || !subjects.length) {
      notify("Add active students and available textbook copies with subject labels first.", true);
      return;
    }
    const currentYear = new Date().getFullYear();
    const fields = [
      formField("Class", "class_snapshot", { choices: classLabels.map((label) => [label, label]), full: true }),
      formField("Subject", "subject", { choices: subjects.map((subject) => [subject, subject]), full: true }),
      formField("Present students (optional)", "admissions", { required: false, textarea: true, full: true,
        hint: "Leave blank to allocate to the whole class. Or paste only the admission numbers of students collecting today, separated by commas or new lines." }),
      formField("Academic year", "academic_year", { type: "number", min: 2020, max: 2200, value: currentYear }),
      formField("End-of-year return deadline", "due_date", { type: "date", full: true, hint: "Use the date approved by the school." }),
    ].join("");
    showForm("Allocate textbooks to a class", fields, "Preview and allocate", async (form) => {
      const classSnapshot = String(form.get("class_snapshot") || "");
      const subject = String(form.get("subject") || "");
      const academicYear = Number(form.get("academic_year"));
      const dueDate = String(form.get("due_date") || "");
      const parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
      if (!Number.isInteger(academicYear) || academicYear < 2020 || academicYear > 2200
        || !parsedDueDate || Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate
        || dueDate < localDateIso()) throw new Error("Choose a valid academic year and school-approved return deadline.");
      let classStudents = activeStudents.filter((student) => (student.current_class || `${student.grade} · Class ${student.class_number || "—"}`) === classSnapshot)
        .sort((a, b) => String(a.admission_number).localeCompare(String(b.admission_number), undefined, { numeric: true }));
      const admissionText = String(form.get("admissions") || "").trim();
      if (admissionText) {
        const requested = admissionText.split(/[\s,;]+/).filter(Boolean);
        const unique = new Set(requested.map((value) => value.toLowerCase()));
        if (unique.size !== requested.length) throw new Error("The admission list contains duplicates.");
        const byAdmission = new Map(classStudents.map((student) => [student.admission_number.toLowerCase(), student]));
        const missing = requested.filter((value) => !byAdmission.has(value.toLowerCase()));
        if (missing.length) throw new Error(`These admission numbers are not active in ${classSnapshot}: ${missing.slice(0, 5).join(", ")}`);
        classStudents = requested.map((value) => byAdmission.get(value.toLowerCase()));
      }
      if (!classStudents.length) throw new Error("No eligible students were selected.");
      const activeCopyIds = new Set(allocations.filter((item) => !item.returned_at).map((item) => item.copy_id));
      const availableCopies = copies.filter((copy) => copy.subject.toLowerCase() === subject.toLowerCase()
        && copy.condition === "Available" && !activeCopyIds.has(copy.id))
        .sort((a, b) => a.copy_code.localeCompare(b.copy_code, undefined, { numeric: true }));
      if (availableCopies.length < classStudents.length) {
        throw new Error(`Only ${availableCopies.length} available ${subject} copies exist for ${classStudents.length} selected students. Add copies or select fewer students; nothing was allocated.`);
      }
      if (!window.confirm(`Allocate ${classStudents.length} ${subject} textbook copies to ${classSnapshot}? Each student will receive one individually coded copy.`)) return;
      const now = new Date().toISOString();
      const records = classStudents.map((student, index) => {
        const copy = availableCopies[index];
        return {
          id: crypto.randomUUID(), copy_id: copy.id, copy_code_snapshot: copy.copy_code,
          title_snapshot: copy.title, subject_snapshot: copy.subject, student_id: student.id,
          student_admission_snapshot: student.admission_number, student_name_snapshot: student.full_name,
          grade_snapshot: student.grade, class_number_snapshot: student.class_number,
          class_snapshot: classSnapshot, academic_year: academicYear,
          allocated_at: localDateIso(), due_date: dueDate, returned_at: null,
          created_at: now, updated_at: now,
        };
      });
      await createTextbookAllocations(records);
      notify(`${records.length} ${subject} textbook allocations recorded for ${classSnapshot}.`);
      await refresh();
      if (state.session) flushOutbox();
    }, "CLASS TEXTBOOK ALLOCATION");
  }

  async function createTextbookAllocations(records) {
    if (!records.length) return;
    if (state.syncConfig) {
      if (!state.session || !navigator.onLine) throw new Error("A shared-school class allocation must be confirmed online.");
      const role = currentRole();
      const rpcName = ["teacher", "subject_teacher", "class_teacher"].includes(role)
        ? "teacher_allocate_textbooks" : "bookstore_allocate_textbooks";
      const { error } = await state.supabase.rpc(rpcName, {
        p_allocations: records.map((record) => ({ id: record.id, student_id: record.student_id, copy_id: record.copy_id })),
        p_academic_year: records[0].academic_year,
        p_due_date: records[0].due_date,
      });
      if (error) throw new Error(`The school server rejected the class allocation; no copies were issued: ${error.message}`);
      const { data: confirmedRecords, error: readError } = await state.supabase.from("textbook_allocations")
        .select("*").in("id", records.map((record) => record.id));
      if (readError || confirmedRecords?.length !== records.length) {
        throw new Error(`The allocation was committed, but the server records could not be reloaded. Refresh before retrying. ${readError?.message || ""}`);
      }
      records = records.map((record) => confirmedRecords.find((item) => item.id === record.id));
    }
    await new Promise((resolve, reject) => {
      const names = ["textbook_allocations", "active-textbook-copies"];
      const tx = state.db.transaction(names, "readwrite");
      for (const record of records) {
        tx.objectStore("textbook_allocations").add(record);
        tx.objectStore("active-textbook-copies").put({ copy_id: record.copy_id, allocation_id: record.id });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error?.name === "ConstraintError" ? new Error("A copy is already allocated on this device. Synchronize and refresh before trying again.") : tx.error || new Error("The class allocation could not be saved locally."));
      tx.onabort = () => reject(tx.error || new Error("The class allocation was cancelled."));
    });
  }

  async function createTextbookAllocation(record) {
    if (state.syncConfig) {
      if (!state.session || !navigator.onLine) throw new Error("A shared-school allocation must be confirmed online. Reconnect and sign in before issuing this textbook.");
      const role = currentRole();
      const rpcName = ["teacher", "subject_teacher", "class_teacher"].includes(role)
        ? "teacher_allocate_textbooks" : "bookstore_allocate_textbooks";
      const { error } = await state.supabase.rpc(rpcName, {
        p_allocations: [{ id: record.id, student_id: record.student_id, copy_id: record.copy_id }],
        p_academic_year: record.academic_year,
        p_due_date: record.due_date,
      });
      if (error) throw new Error(`The school server did not confirm this allocation: ${error.message}`);
      const { data: confirmedRecord, error: readError } = await state.supabase.from("textbook_allocations")
        .select("*").eq("id", record.id).maybeSingle();
      if (readError || !confirmedRecord) {
        throw new Error(`The allocation was committed, but the server record could not be reloaded. Refresh before retrying. ${readError?.message || ""}`);
      }
      record = confirmedRecord;
    }
    return new Promise((resolve, reject) => {
      if (state.syncConfig && !canManageTextbookAllocations()) return reject(new Error("Your account cannot allocate textbooks."));
      const names = ["textbook_allocations", "active-textbook-copies"];
      const tx = state.db.transaction(names, "readwrite");
      tx.objectStore("textbook_allocations").add(record);
      tx.objectStore("active-textbook-copies").put({ copy_id: record.copy_id, allocation_id: record.id });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error?.name === "ConstraintError" ? new Error("The server recorded this allocation, but this device has a conflicting local record. Synchronize before continuing.") : tx.error || new Error("Could not save textbook allocation."));
      tx.onabort = () => reject(tx.error || new Error("Textbook allocation was cancelled."));
    });
  }

  async function renderBookstoreReturns() {
    const [allocations, copies] = await Promise.all([
      getAll("textbook_allocations"), getAll("textbook_copies"),
    ]);
    const active = allocations.filter((item) => !item.returned_at);
    const query = (state.bookstoreReturnQuery || "").trim().toLowerCase();
    const filtered = byNewest(active).filter((item) => [
      item.student_admission_snapshot, item.student_name_snapshot,
      item.copy_code_snapshot, item.title_snapshot, item.subject_snapshot,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
    const rows = filtered.map((item) => {
      const copy = copies.find((entry) => entry.id === item.copy_id);
      return `<tr>
        <td><strong>${escapeHtml(item.student_name_snapshot)}</strong><br><span class="code-text">${escapeHtml(item.student_admission_snapshot)}</span></td>
        <td><strong>${escapeHtml(item.title_snapshot)}</strong><small>${escapeHtml(item.subject_snapshot || "")}</small></td>
        <td class="code-text">${escapeHtml(item.copy_code_snapshot)}</td>
        <td>${escapeHtml(item.academic_year || "—")}</td>
        <td>${escapeHtml(item.due_date || "Not set")}</td>
        <td><span class="status-tag ${copy?.condition === "Lost" || copy?.condition === "Damaged" ? "danger" : "warn"}">${escapeHtml(copy?.condition || "Allocated")}</span></td>
        <td class="row-actions">${canReturnTextbookAllocations() ? `<button class="button button-primary button-small" data-return-textbook="${escapeHtml(item.id)}">Record return</button>` : "Awaiting bookstore staff"}</td>
      </tr>`;
    }).join("");
    content.innerHTML = `${heading("BOOKSTORE · RETURNS DESK", "Process textbook returns", "A dedicated desk for receiving textbooks. Search by student, admission number, textbook title or individual copy code, then confirm each physical return.", `${canManageTextbookAllocations() ? `<button class="button button-secondary" data-page-link="bookstore">Back to textbook register</button>` : ""}`)}
      <section class="stats-grid" aria-label="Bookstore return summary">
        ${statCard("TEXTBOOKS OUT", active.length, "All outstanding allocations")}
        ${statCard("MATCHING RECORDS", filtered.length, query ? "Matches your search" : "Currently shown")}
        ${statCard("RETURNED TO DATE", allocations.filter((item) => item.returned_at).length, "Historical returns retained")}
        ${statCard("NEED FOLLOW-UP", active.filter((item) => !item.due_date).length, "No return deadline recorded")}
      </section>
      <section class="panel">
        <div class="panel-header inventory-header"><div><h2>Find a textbook to return</h2><p>Search across every student and every outstanding copy.</p></div>
          <div class="toolbar"><div class="search-wrap"><input class="search-input" id="bookstore-return-search" type="search" value="${escapeHtml(state.bookstoreReturnQuery || "")}" placeholder="Admission no., student, title or copy code" aria-label="Search outstanding textbook allocations"></div></div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Textbook</th><th>Copy code</th><th>Academic year</th><th>Due date</th><th>Copy status</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td class="table-empty" colspan="7">${active.length ? "No outstanding textbooks match that search." : "All textbook copies have been returned. There are no outstanding returns."}</td></tr>`}</tbody></table></div>
      </section>
      <p class="inline-hint">Only record a return after the physical textbook has been received and its copy code checked. In shared mode, the server must confirm the return online; the original allocation remains in the history.</p>`;
    byId("bookstore-return-search").addEventListener("input", async (event) => {
      state.bookstoreReturnQuery = event.target.value;
      const start = event.target.selectionStart;
      const end = event.target.selectionEnd;
      await renderBookstoreReturns();
      const search = byId("bookstore-return-search");
      search.focus();
      search.setSelectionRange(start, end);
    });
  }

  async function returnTextbookCopy(allocationId) {
    const allocation = await getStoredRecord("textbook_allocations", allocationId);
    if (!allocation || allocation.returned_at) { notify("That allocation is already closed.", true); return; }
    if (!window.confirm(`Confirm return of ${allocation.copy_code_snapshot} from ${allocation.student_name_snapshot}?`)) return;
    let returnedAt = localDateIso();
    if (state.syncConfig) {
      if (!state.session || !navigator.onLine) { notify("A shared-school return must be confirmed online. Reconnect before closing this allocation.", true); return; }
      const { data, error } = await state.supabase.rpc("return_textbook_copy", { p_allocation_id: allocation.id });
      if (error) { notify(`The school server did not confirm this return: ${error.message}`, true); return; }
      if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        notify("The server returned an unexpected result. Refresh the register before continuing.", true); return;
      }
      returnedAt = data;
    }
    const updated = { ...allocation, returned_at: returnedAt, updated_at: new Date().toISOString() };
    const names = ["textbook_allocations", "active-textbook-copies"];
    const tx = state.db.transaction(names, "readwrite");
    tx.objectStore("textbook_allocations").put(updated);
    tx.objectStore("active-textbook-copies").delete(allocation.copy_id);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not record textbook return.")); tx.onabort = () => reject(tx.error || new Error("Textbook return was cancelled.")); });
    notify("Textbook return recorded.");
    await refresh();
    if (state.session) flushOutbox();
  }

  async function renderStudents() {
    const [students, loans, clearanceRecords] = await Promise.all([getAll("students"), getAll("loans"), getAll("clearance_records")]);
    const latestClearance = (studentId, department) => byNewest(clearanceRecords.filter((item) => item.student_id === studentId && item.department === department))[0];
    const filtered = students.filter((student) => {
      const query = state.studentQuery.toLowerCase();
      const matches = !query || [student.full_name, student.admission_number].some((item) => String(item || "").toLowerCase().includes(query));
      return matches && (student.active !== false || Boolean(query)) && (state.studentFilter === "all" || student.house_code === state.studentFilter);
    }).sort((a, b) => String(a.admission_number || "").localeCompare(String(b.admission_number || ""), undefined, { numeric: true, sensitivity: "base" }));
    const activeLoans = loans.filter((loan) => !loan.returned_at);
    content.innerHTML = `${heading("STUDENT SERVICES", "Student register", "Find a student by name or admission number and review their current book status.", `<div class="heading-actions">${canManageStudents() ? `<button class="button button-secondary" data-action="student-template">Download template</button><button class="button button-secondary" data-action="import-students">Import class list</button><button class="button button-primary" data-action="add-student">Register student</button>` : ""}</div>`)}
      <section class="panel"><div class="panel-header"><div><h2>Student register</h2><p>${students.length} student record${students.length === 1 ? "" : "s"} on this device</p></div><div class="toolbar"><div class="search-wrap"><input class="search-input" id="student-search" type="search" value="${escapeHtml(state.studentQuery)}" placeholder="Search student or admission"></div><select id="student-filter" class="filter-select" aria-label="Filter by house"><option value="all">All houses</option>${Object.entries(HOUSES).map(([code, label]) => `<option value="${code}"${state.studentFilter === code ? " selected" : ""}>${code} · ${label}</option>`).join("")}</select></div></div>
      <div class="table-wrap"><table><thead><tr><th>Admission</th><th>Student</th><th>House</th><th>Class</th><th>Books out</th><th>Library</th><th>Bookstore</th><th></th></tr></thead><tbody>${filtered.length ? filtered.map((student) => {
        const count = activeLoans.filter((loan) => loan.student_id === student.id).length;
        const libraryStatus = latestClearance(student.id, "library")?.status || "pending";
        const bookstoreStatus = latestClearance(student.id, "bookstore")?.status || "pending";
        const clearanceCell = (department, status) => `<td><span class="status-tag ${status === "cleared" ? "good" : status === "blocked" ? "danger" : "warn"}">${escapeHtml(status)}</span>${canManageClearanceDepartment(department) && student.active !== false ? `<br><button class="footer-link" data-clearance="${escapeHtml(student.id)}" data-clearance-dept="${department}">${status === "cleared" ? "Reopen" : "Clear"}</button>` : ""}</td>`;
        return `<tr><td class="code-text">${escapeHtml(student.admission_number)}</td><td><button class="footer-link" data-student-profile="${escapeHtml(student.id)}"><strong>${escapeHtml(student.full_name)}</strong></button>${student.active === false ? `<br><small>Inactive / departed</small>` : ""}</td><td>${escapeHtml(student.house_code)} · ${escapeHtml(houseName(student.house_code))}</td><td>${escapeHtml(student.current_class || `${student.grade} · Class ${student.class_number || "—"}`)}</td><td>${count}</td>${clearanceCell("library", libraryStatus)}${clearanceCell("bookstore", bookstoreStatus)}<td>${canManageStudentDeparture() && student.active !== false ? `<button class="footer-link" data-depart-student="${escapeHtml(student.id)}">Record departure</button>` : ""}</td></tr>`;
      }).join("") : `<tr><td class="table-empty" colspan="8">${students.length ? "No student records match this search." : "No students registered yet."}${!students.length && canManageRecords() ? `<div class="empty-actions"><button class="button button-primary" data-action="add-student">Register first student</button></div>` : ""}</td></tr>`}</tbody></table></div></section>
      <div class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>House and class structure</h2><p>Eight house codes · school-defined class groups</p></div></div><div class="panel-body"><div class="house-grid">${Object.entries(HOUSES).map(([code, label]) => `<div class="house-card"><strong>${code}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div><p class="inline-hint">Senior school records use Grades 10, 11 and 12 from 2028. Class groups should follow the school's approved class structure.</p></div></div>`;
    byId("student-search").addEventListener("input", async (event) => {
      state.studentQuery = event.target.value;
      const start = event.target.selectionStart;
      const end = event.target.selectionEnd;
      await renderStudents();
      const search = byId("student-search");
      search.focus();
      search.setSelectionRange(start, end);
    });
    byId("student-filter").addEventListener("change", (event) => { state.studentFilter = event.target.value; renderStudents(); });
  }

  async function renderGovernance() {
    if (state.syncConfig) return renderConnectedGovernance();
    const [staff, classes, subjects, assignments, approvals, audits] = await Promise.all([
      getAll("staff_profiles"), getAll("school_classes"), getAll("school_subjects"),
      getAll("staff_assignments"), getAll("approval_requests"), getAll("audit_events"),
    ]);
    const staffMap = new Map(staff.map((item) => [item.id, item]));
    const classMap = new Map(classes.map((item) => [item.id, item]));
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    content.innerHTML = `${heading("SCHOOL ADMINISTRATION", "Staff & approvals", "Preview teacher assignments, staff roles and approval history using fictional demonstration records.", `<button class="button button-secondary" data-action="demo-request-approval">New approval request</button>`)}
      <section class="panel demo-warning"><div class="panel-body"><strong>Demonstration only — not staff authentication</strong><p>These sample staff profiles and decisions are stored only in this browser. They do not create accounts, enforce permissions or authorize real school transactions.</p></div></section>
      <section class="stats-grid">${statCard("DEMO STAFF", staff.length, "Fictional staff profiles")}${statCard("ACTIVE ASSIGNMENTS", assignments.filter((item) => item.active !== false).length, "Class and subject links")}${statCard("PENDING APPROVALS", approvals.filter((item) => item.status === "pending").length, "Awaiting a demo decision")}${statCard("AUDIT EVENTS", audits.length, "Local workflow history")}</section>
      <section class="panel"><div class="panel-header"><div><h2>Staff directory</h2><p>Roles are examples only; no passwords or login credentials are stored.</p></div></div><div class="table-wrap"><table><thead><tr><th>Staff code</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>${staff.length ? staff.map((person) => `<tr><td class="code-text">${escapeHtml(person.staff_code || "—")}</td><td><strong>${escapeHtml(person.display_name)}</strong></td><td>${escapeHtml(person.role_label || person.role)}</td><td><span class="status-tag ${person.active === false ? "danger" : "good"}">${person.active === false ? "Inactive" : "Active"}</span></td></tr>`).join("") : `<tr><td colspan="4" class="table-empty">No demonstration staff profiles loaded.</td></tr>`}</tbody></table></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Teacher assignments</h2><p>Assignments are date-aware and remain in history when ended.</p></div><button class="button button-secondary" data-action="demo-add-assignment">Add demo assignment</button></div><div class="table-wrap"><table><thead><tr><th>Teacher</th><th>Assignment</th><th>Class</th><th>Subject</th><th>From</th><th>Status</th><th></th></tr></thead><tbody>${assignments.length ? byNewest(assignments).map((item) => `<tr><td>${escapeHtml(staffMap.get(item.staff_id)?.display_name || "Unknown staff")}</td><td>${escapeHtml(item.assignment_type?.replaceAll("_", " ") || "Teacher")}</td><td>${escapeHtml(classMap.get(item.class_id)?.display_name || "—")}</td><td>${escapeHtml(subjectMap.get(item.subject_id)?.name || "Class teacher")}</td><td>${escapeHtml(item.starts_on || "—")}</td><td><span class="status-tag ${item.active === false ? "" : "good"}">${item.active === false ? "Ended" : "Active"}</span></td><td>${item.active === false ? "" : `<button class="footer-link" data-end-demo-assignment="${escapeHtml(item.id)}">End assignment</button>`}</td></tr>`).join("") : `<tr><td colspan="7" class="table-empty">No assignments have been added.</td></tr>`}</tbody></table></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Principal approval queue</h2><p>Requests, decisions and reasons are retained in the local demonstration history.</p></div></div><div class="table-wrap"><table><thead><tr><th>Request</th><th>Submitted by</th><th>Requested</th><th>Status</th><th>Decision</th></tr></thead><tbody>${approvals.length ? byNewest(approvals).map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description || "")}</small></td><td>${escapeHtml(item.requested_by_label || "Demo staff")}</td><td>${escapeHtml(item.requested_at || "—")}</td><td><span class="status-tag ${item.status === "approved" ? "good" : item.status === "rejected" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></td><td>${item.status === "pending" ? `<button class="footer-link" data-decide-demo-approval="${escapeHtml(item.id)}" data-decision="approved">Approve</button> · <button class="footer-link" data-decide-demo-approval="${escapeHtml(item.id)}" data-decision="rejected">Reject</button>` : `${escapeHtml(item.decision_note || "Decision recorded")}`}</td></tr>`).join("") : `<tr><td colspan="5" class="table-empty">No approval requests.</td></tr>`}</tbody></table></div></section>`;
  }

  async function renderConnectedGovernance() {
    const role = currentRole();
    const isAdmin = ["admin", "super_admin"].includes(role);
    const canApprove = ["admin", "super_admin", "principal", "deputy_principal"].includes(role);
    const canConfigureSchool = canApprove;
    const [approvalResult, staffResult, membershipResult, yearResult, classResult, subjectResult, assignmentResult] = await Promise.all([
      state.supabase.from("approval_requests").select("*").order("requested_at", { ascending: false }).limit(200),
      canConfigureSchool ? state.supabase.from("staff_profiles").select("user_id,staff_number,display_name,username,department,active").order("display_name") : Promise.resolve({ data: [], error: null }),
      isAdmin ? state.supabase.from("staff_memberships").select("user_id,role,active") : Promise.resolve({ data: [], error: null }),
      canConfigureSchool ? state.supabase.from("academic_years").select("*").order("year_label", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      canConfigureSchool ? state.supabase.from("school_classes").select("*").order("grade_label").order("class_label") : Promise.resolve({ data: [], error: null }),
      canConfigureSchool ? state.supabase.from("school_subjects").select("*").order("subject_name") : Promise.resolve({ data: [], error: null }),
      canConfigureSchool ? state.supabase.from("staff_assignments").select("*").order("starts_on", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [approvalResult, staffResult, membershipResult, yearResult, classResult, subjectResult, assignmentResult]) if (result.error) throw new Error(result.error.message);
    const approvals = approvalResult.data || [];
    const staff = staffResult.data || [];
    const memberships = new Map((membershipResult.data || []).map((item) => [item.user_id, item]));
    const years = yearResult.data || [];
    const classes = classResult.data || [];
    const subjects = subjectResult.data || [];
    const assignments = assignmentResult.data || [];
    const staffMap = new Map(staff.map((item) => [item.user_id, item]));
    const classMap = new Map(classes.map((item) => [item.id, item]));
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    const toolbar = `${isAdmin ? '<button class="button button-secondary" data-action="add-staff-account">Create staff account</button>' : ''}${canConfigureSchool ? '<button class="button button-secondary" data-action="add-academic-year">Add academic year</button><button class="button button-secondary" data-action="add-school-class">Add class</button><button class="button button-secondary" data-action="add-school-subject">Add subject</button><button class="button button-secondary" data-action="add-teacher-assignment">Assign teacher</button>' : ''}<button class="button button-primary" data-action="request-approval">New approval request</button>`;
    content.innerHTML = `${heading("SCHOOL ADMINISTRATION", "Staff & approvals", "Connected school workspace. Staff access, assignments and approval decisions are checked by the server.", toolbar)}
      <section class="stats-grid">${statCard("PENDING APPROVALS", approvals.filter((item) => item.status === "pending").length, "Awaiting an authorized decision")}${statCard("RECORDED REQUESTS", approvals.length, "Approval history")}${isAdmin ? statCard("STAFF ACCOUNTS", staff.length, "Provisioned accounts") : statCard("YOUR ROLE", escapeHtml(role || "Staff"), "Server-verified role")}${canConfigureSchool ? statCard("ACTIVE TEACHER LINKS", assignments.filter((item) => !item.ends_on || item.ends_on >= localDateIso()).length, "Date-aware assignments") : ""}</section>
      ${isAdmin ? `<section class="panel"><div class="panel-header"><div><h2>Staff directory</h2><p>Temporary passwords are shown only once when an account is created or reset.</p></div></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${staff.length ? staff.map((person) => { const membership = memberships.get(person.user_id); return `<tr><td><strong>${escapeHtml(person.display_name)}</strong><small>${escapeHtml(person.staff_number || person.department || "")}</small></td><td class="code-text">${escapeHtml(person.username || "—")}</td><td>${escapeHtml(membership?.role || "No role")}</td><td><span class="status-tag ${person.active && membership?.active ? "good" : "danger"}">${person.active && membership?.active ? "Active" : "Inactive"}</span></td><td>${person.user_id === state.session.user.id ? "Current account" : `<button class="footer-link" data-staff-action="reset_password" data-user-id="${escapeHtml(person.user_id)}">Reset password</button> · <button class="footer-link" data-staff-action="change_role" data-user-id="${escapeHtml(person.user_id)}">Change role</button> · <button class="footer-link" data-staff-action="${person.active && membership?.active ? "deactivate" : "activate"}" data-user-id="${escapeHtml(person.user_id)}">${person.active && membership?.active ? "Deactivate" : "Activate"}</button>`}</td></tr>`; }).join("") : `<tr><td colspan="5" class="table-empty">No staff accounts found.</td></tr>`}</tbody></table></div></section>` : ""}
      ${canConfigureSchool ? `<section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Academic years, classes & subjects</h2><p>Set the active year and maintain the school's configurable class and subject directory.</p></div></div><div class="table-wrap"><table><thead><tr><th>Academic year</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>${years.length ? years.map((year) => `<tr><td><strong>${escapeHtml(year.year_label)}</strong></td><td>${escapeHtml(year.starts_on || "—")} → ${escapeHtml(year.ends_on || "—")}</td><td><span class="status-tag ${year.is_current ? "good" : ""}">${year.is_current ? "Current" : escapeHtml(year.status)}</span></td><td>${!year.is_current ? `<button class="footer-link" data-set-current-year="${escapeHtml(year.id)}">Make current</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="table-empty">No academic years configured.</td></tr>`}</tbody></table></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Grade</th><th>Class label (must match student register)</th><th>Section</th><th>Academic year</th></tr></thead><tbody>${classes.length ? classes.map((item) => `<tr><td>${escapeHtml(item.grade_label)}</td><td>${escapeHtml(item.class_label)}</td><td>${escapeHtml(item.school_section || "Both / not set")}</td><td>${escapeHtml(years.find((year) => year.id === item.academic_year_id)?.year_label || "—")}</td></tr>`).join("") : `<tr><td colspan="4" class="table-empty">No classes configured.</td></tr>`}</tbody></table></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Subject code</th><th>Subject name</th><th>Status</th></tr></thead><tbody>${subjects.length ? subjects.map((item) => `<tr><td class="code-text">${escapeHtml(item.subject_code)}</td><td>${escapeHtml(item.subject_name)}</td><td>${item.active ? "Active" : "Inactive"}</td></tr>`).join("") : `<tr><td colspan="3" class="table-empty">No subjects configured.</td></tr>`}</tbody></table></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Teacher assignments</h2><p>Assignments are date-aware and remain in history when ended. Class labels and subjects must match the student and textbook registers.</p></div></div><div class="table-wrap"><table><thead><tr><th>Teacher</th><th>Assignment</th><th>Class</th><th>Subject</th><th>From</th><th>Until</th><th></th></tr></thead><tbody>${assignments.length ? assignments.map((item) => `<tr><td>${escapeHtml(staffMap.get(item.staff_user_id)?.display_name || "Staff account")}</td><td>${escapeHtml(item.assignment_type.replaceAll("_", " "))}</td><td>${escapeHtml(classMap.get(item.class_id)?.class_label || "—")}</td><td>${escapeHtml(subjectMap.get(item.subject_id)?.subject_name || "Class-wide")}</td><td>${escapeHtml(item.starts_on)}</td><td>${escapeHtml(item.ends_on || "Current")}</td><td>${!item.ends_on ? `<button class="footer-link" data-end-staff-assignment="${escapeHtml(item.id)}">End assignment</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="table-empty">No teacher assignments recorded.</td></tr>`}</tbody></table></div></section>` : ""}
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Principal approval queue</h2><p>Approval reasons, decisions and timestamps are stored in the server audit history.</p></div></div><div class="table-wrap"><table><thead><tr><th>Request</th><th>Requested by</th><th>Type</th><th>Submitted</th><th>Status</th><th>Decision</th></tr></thead><tbody>${approvals.length ? approvals.map((item) => `<tr><td><strong>${escapeHtml(item.request_reason)}</strong><small>${escapeHtml(item.target_table)}${item.target_id ? ` · ${escapeHtml(item.target_id)}` : ""}</small></td><td class="code-text">${escapeHtml(String(item.requested_by).slice(0, 8))}</td><td>${escapeHtml(item.request_type.replaceAll("_", " "))}</td><td>${escapeHtml(item.requested_at ? new Date(item.requested_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—")}</td><td><span class="status-tag ${item.status === "approved" ? "good" : item.status === "rejected" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></td><td>${item.status === "pending" && canApprove && item.requested_by !== state.session.user.id ? `<button class="footer-link" data-approval-id="${escapeHtml(item.id)}" data-decision="approved">Approve</button> · <button class="footer-link" data-approval-id="${escapeHtml(item.id)}" data-decision="rejected">Reject</button>` : escapeHtml(item.decision_note || (item.status === "pending" ? "Awaiting approver" : "Decision recorded"))}</td></tr>`).join("") : `<tr><td colspan="6" class="table-empty">No approval requests.</td></tr>`}</tbody></table></div></section>`;
  }

  async function renderYearSetup() {
    if (!canManageYearSetup()) {
      content.innerHTML = `<section class="panel panel-empty"><strong>Academic year setup is restricted</strong><p>Ask the bookstore administrator or school administrator to prepare classes for the new year.</p></section>`;
      return;
    }
    let years; let classes;
    if (state.syncConfig) {
      const [yearResult, classResult] = await Promise.all([
        state.supabase.from("academic_years").select("*").order("year_label", { ascending: false }),
        state.supabase.from("school_classes").select("*").order("grade_label").order("class_label"),
      ]);
      if (yearResult.error) throw yearResult.error;
      if (classResult.error) throw classResult.error;
      years = yearResult.data || []; classes = classResult.data || [];
    } else {
      years = await getAll("academic_years"); classes = await getAll("school_classes");
    }
    const activeYears = years.filter((year) => !year.archived_at && year.status !== "closed");
    const closedYears = years.filter((year) => !year.archived_at && year.status === "closed");
    const openYearIds = new Set(activeYears.map((year) => year.id));
    const canAddYear = !state.syncConfig || ["admin", "super_admin", "principal", "deputy_principal"].includes(currentRole());
    const toolbar = `${canAddYear ? '<button class="button button-secondary" data-action="add-academic-year">Add academic year</button>' : ''}<button class="button button-primary" data-action="add-school-class">Add class / stream</button><button class="button button-secondary" data-page-link="archives">View archives</button>`;
    content.innerHTML = `${heading("BOOKSTORE · YEAR PREPARATION", "Academic year setup", "Prepare the new year's named classes before textbook distribution. For example: Form 3 Delta. Previous years remain available in Archives.", toolbar)}
      <section class="stats-grid">${statCard("ACADEMIC YEARS", years.length, "Current and planned years")}${statCard("ACTIVE CLASSES", classes.filter((item) => item.active !== false && !item.archived_at).length, "Across open academic years")}${statCard("ARCHIVED YEARS", years.filter((year) => year.archived_at || year.status === "closed").length, "Historical records retained")}</section>
      <section class="panel"><div class="panel-header"><div><h2>Open academic years</h2><p>Bookstore staff can add classes to a year already created by an administrator.</p></div></div><div class="table-wrap"><table><thead><tr><th>Academic year</th><th>Dates</th><th>Status</th><th>Classes</th><th></th></tr></thead><tbody>${activeYears.length ? activeYears.map((year) => { const count = classes.filter((item) => item.academic_year_id === year.id && item.active !== false).length; return `<tr><td><strong>${escapeHtml(year.year_label)}</strong></td><td>${escapeHtml(year.starts_on || "—")} → ${escapeHtml(year.ends_on || "—")}</td><td><span class="status-tag ${year.is_current ? "good" : ""}">${year.is_current ? "Current" : escapeHtml(year.status || "Planned")}</span></td><td>${count}</td><td>${!year.is_current && year.starts_on && year.ends_on && year.starts_on <= localDateIso() && year.ends_on >= localDateIso() && (!state.syncConfig || ["admin", "super_admin", "principal", "deputy_principal"].includes(currentRole())) ? `<button class="footer-link" data-set-current-year="${escapeHtml(year.id)}">Make current</button> · ` : ""}${canArchiveAcademicYears() && !year.is_current ? `<button class="footer-link" data-archive-year="${escapeHtml(year.id)}">Release / archive year</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="5" class="table-empty">No open academic years. Add one to begin setup.</td></tr>`}</tbody></table></div></section>
      ${closedYears.length ? `<section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Completed years awaiting archive</h2><p>These years are closed but have not yet been archived. Their classes remain preserved until the release step is confirmed.</p></div></div><div class="table-wrap"><table><thead><tr><th>Academic year</th><th>Classes</th><th>Action</th></tr></thead><tbody>${closedYears.map((year) => `<tr><td><strong>${escapeHtml(year.year_label)}</strong></td><td>${classes.filter((item) => item.academic_year_id === year.id).length}</td><td>${canArchiveAcademicYears() ? `<button class="footer-link" data-archive-year="${escapeHtml(year.id)}">Release / archive year</button>` : "Awaiting authorised release"}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Classes and streams</h2><p>Class names are entered as the school uses them, not generated from class numbers.</p></div></div><div class="table-wrap"><table><thead><tr><th>Form / grade</th><th>Class name</th><th>School section</th><th>Academic year</th><th>Status</th></tr></thead><tbody>${classes.filter((item) => item.active !== false && !item.archived_at && openYearIds.has(item.academic_year_id)).length ? classes.filter((item) => item.active !== false && !item.archived_at && openYearIds.has(item.academic_year_id)).map((item) => `<tr><td>${escapeHtml(item.grade_label || item.grade || "—")}</td><td><strong>${escapeHtml(item.class_label || item.display_name || "—")}</strong></td><td>${escapeHtml(item.school_section || "—")}</td><td>${escapeHtml(years.find((year) => year.id === item.academic_year_id)?.year_label || "—")}</td><td><span class="status-tag good">Active</span></td></tr>`).join("") : `<tr><td colspan="5" class="table-empty">No active classes yet.</td></tr>`}</tbody></table></div></section>`;
  }

  async function renderArchives() {
    let years; let classes; let rosterSnapshots;
    if (state.syncConfig) {
      const [yearResult, classResult, rosterResult] = await Promise.all([
        state.supabase.from("academic_years").select("*").order("year_label", { ascending: false }),
        state.supabase.from("school_classes").select("*").order("grade_label").order("class_label"),
        state.supabase.from("class_archive_students").select("*").order("full_name"),
      ]);
      if (yearResult.error) throw yearResult.error;
      if (classResult.error) throw classResult.error;
      if (rosterResult.error) throw rosterResult.error;
      years = yearResult.data || []; classes = classResult.data || []; rosterSnapshots = rosterResult.data || [];
    } else {
      years = await getAll("academic_years"); classes = await getAll("school_classes"); rosterSnapshots = await getAll("class_archive_students");
    }
    const archivedYears = years.filter((year) => Boolean(year.archived_at));
    const archivedIds = new Set(archivedYears.map((year) => year.id));
    const archivedClasses = classes.filter((item) => archivedIds.has(item.academic_year_id) || Boolean(item.archived_at));
    content.innerHTML = `${heading("BOOKSTORE · HISTORICAL RECORDS", "Archives", "Completed academic years and released classes are kept here for reference. Archived records are read-only; historical allocations and returns are never deleted.", '<button class="button button-secondary" data-page-link="year-setup">Back to year setup</button>')}
      <section class="stats-grid">${statCard("ARCHIVED YEARS", archivedYears.length, "Closed academic years")}${statCard("ARCHIVED CLASSES", archivedClasses.length, "Historical class records")}${statCard("CURRENT YEARS", years.filter((year) => year.is_current).length, "Not included in archives")}</section>
      ${archivedYears.length ? archivedYears.map((year) => { const yearClasses = archivedClasses.filter((item) => item.academic_year_id === year.id); return `<section class="panel" style="margin-bottom:16px"><div class="panel-header"><div><h2>${escapeHtml(year.year_label)}</h2><p>${escapeHtml(year.starts_on || "—")} → ${escapeHtml(year.ends_on || "—")} · Archived ${escapeHtml(year.archived_at ? new Date(year.archived_at).toLocaleDateString("en-KE") : "as closed year")}</p></div><span class="status-tag">Archived · Read only</span></div><div class="table-wrap"><table><thead><tr><th>Form / grade</th><th>Class / stream</th><th>Section</th><th>Record status</th></tr></thead><tbody>${yearClasses.length ? yearClasses.map((item) => { const roster = rosterSnapshots.filter((student) => student.class_id === item.id); return `<tr><td>${escapeHtml(item.grade_label || item.grade || "—")}</td><td><strong>${escapeHtml(item.class_label || item.display_name || "—")}</strong><small>${roster.length} student roster record(s)</small></td><td>${escapeHtml(item.school_section || "—")}</td><td><span class="status-tag">Historical · Read only</span></td></tr>${roster.length ? `<tr><td colspan="4"><details><summary>View archived student list (${roster.length})</summary><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Admission number</th><th>Student</th><th>House</th><th>Section</th></tr></thead><tbody>${roster.map((student) => `<tr><td class="code-text">${escapeHtml(student.admission_number_snapshot)}</td><td>${escapeHtml(student.full_name_snapshot)}</td><td>${escapeHtml(student.house_code || "—")}</td><td>${escapeHtml(student.school_section || "—")}</td></tr>`).join("")}</tbody></table></div></details></td></tr>` : ""}`; }).join("") : `<tr><td colspan="4" class="table-empty">No class records were attached to this year.</td></tr>`}</tbody></table></div></section>`; }).join("") : `<section class="panel panel-empty"><strong>No archived academic years yet</strong><p>When a completed year is released from Academic Year Setup, it will appear here. Archiving never deletes student or textbook history.</p></section>`}`;
  }

  async function archiveConnectedAcademicYear(id) {
    const yearResult = await state.supabase.from("academic_years").select("id,year_label,is_current,status").eq("id", id).single();
    if (yearResult.error) throw yearResult.error;
    const year = yearResult.data;
    if (year.is_current) { notify("The current academic year cannot be archived.", true); return; }
    const allocationResult = await state.supabase.from("textbook_allocations").select("id", { count: "exact", head: true }).is("returned_at", null).eq("academic_year", Number.parseInt(year.year_label, 10));
    if (allocationResult.error) throw allocationResult.error;
    const outstanding = allocationResult.count || 0;
    const warning = outstanding ? `\n\n${outstanding} textbook allocation(s) remain outstanding. They will stay visible in historical follow-up and will NOT be cleared.` : "";
    if (!window.confirm(`Archive academic year ${year.year_label}? Its classes will leave active setup and appear in read-only Archives.${warning}\n\nThis does not mark every student as graduated, clear outstanding items, or delete students, allocations, returns or clearance history. Student departure and clearance remain separate processes.`)) return;
    const { error } = await state.supabase.rpc("archive_academic_year", { p_academic_year_id: id });
    if (error) throw error;
    notify(`Academic year ${year.year_label} archived. Historical records were retained.`);
    await refresh();
  }

  async function setDemoCurrentAcademicYear(id) {
    const years = await getAll("academic_years");
    const selected = years.find((year) => year.id === id);
    if (!selected || selected.archived_at || selected.status === "closed") { notify("An archived year cannot be made current.", true); return; }
    if (!selected.starts_on || !selected.ends_on || selected.starts_on > localDateIso() || selected.ends_on < localDateIso()) { notify("The date range must include today before this year can become current.", true); return; }
    for (const year of years) {
      year.is_current = year.id === id;
      if (year.id === id) year.status = "active";
      else if (year.status === "active") year.status = "closed";
      await writeRecord("academic_years", year);
    }
    notify(`${selected.year_label} is now the current academic year.`);
    await refresh();
  }

  async function archiveDemoAcademicYear(id) {
    const year = await getStoredRecord("academic_years", id);
    if (!year || year.is_current) { notify("The current academic year cannot be archived.", true); return; }
    const allocations = await getAll("textbook_allocations");
    const outstanding = allocations.filter((item) => !item.returned_at && String(item.academic_year) === String(year.year_label)).length;
    const warning = outstanding ? `\n\n${outstanding} textbook allocation(s) remain outstanding. They will remain in the historical follow-up.` : "";
    if (!window.confirm(`Archive academic year ${year.year_label}?${warning}\n\nThis does not automatically mark students as graduated or clear outstanding items. No student or transaction history will be deleted.`)) return;
    year.status = "closed"; year.archived_at = new Date().toISOString(); year.active = false;
    await writeRecord("academic_years", year);
    const classes = (await getAll("school_classes")).filter((item) => item.academic_year_id === id);
    const students = await getAll("students");
    const existingSnapshots = await getAll("class_archive_students");
    const snapshots = [];
    for (const item of classes) {
      for (const student of students.filter((person) => String(person.current_class || "").trim().toLowerCase() === String(item.class_label || item.display_name || "").trim().toLowerCase())) {
        if (existingSnapshots.some((snapshot) => snapshot.academic_year_id === id && snapshot.class_id === item.id && snapshot.student_id === student.id)) continue;
        snapshots.push({ id: crypto.randomUUID(), academic_year_id: id, class_id: item.id, student_id: student.id, admission_number_snapshot: student.admission_number, full_name_snapshot: student.full_name, grade_label: item.grade_label || item.grade || "", class_label: item.class_label || item.display_name || "", house_code: student.house_code || student.house || "", school_section: student.school_section || "", snapshot_at: year.archived_at });
      }
      item.active = false; item.archived_at = year.archived_at; await writeRecord("school_classes", item);
    }
    if (snapshots.length) await writeRecords("class_archive_students", snapshots);
    notify(`Academic year ${year.year_label} archived. Historical records were retained.`);
    await refresh();
  }

  async function addDemoClass() {
    const years = (await getAll("academic_years")).filter((year) => !year.archived_at && year.status !== "closed");
    if (!years.length) { notify("Add an academic year first.", true); return; }
    const fields = [formField("Academic year", "academic_year_id", { choices: years.map((year) => [year.id, year.year_label]) }), formField("Form / grade", "grade_label", { maxLength: 60, placeholder: "Form 3" }), formField("Class / stream name", "stream_name", { maxLength: 60, placeholder: "Delta" }), formField("School section", "school_section", { choices: [["", "Not applicable / both"], ["G", "G"], ["B", "B"]] })].join("");
    showForm("Add bookstore class", fields, "Save class", async (form) => {
      const grade = String(form.get("grade_label")).trim(); const stream = String(form.get("stream_name")).trim();
      if (!grade || !stream) throw new Error("Enter both the form / grade and class name.");
      const yearId = String(form.get("academic_year_id")); const section = String(form.get("school_section") || "") || null;
      const existing = await getAll("school_classes");
      if (existing.some((item) => item.academic_year_id === yearId && item.grade_label === grade && item.class_label === `${grade} ${stream}` && (item.school_section || null) === section)) throw new Error("That class already exists for this academic year and section.");
      await writeRecord("school_classes", { id: crypto.randomUUID(), academic_year_id: yearId, grade_label: grade, class_label: `${grade} ${stream}`, display_name: `${grade} ${stream}`, grade, active: true, archived_at: null, school_section: section, created_at: new Date().toISOString() });
      await refresh();
    }, "BOOKSTORE · CLASS SETUP");
  }

  async function addDemoAcademicYear() {
    const fields = [formField("Academic year", "year_label", { maxLength: 40, placeholder: "2027" }), formField("Starts on", "starts_on", { type: "date" }), formField("Ends on", "ends_on", { type: "date" })].join("");
    showForm("Add academic year", fields, "Save academic year", async (form) => {
      const label = String(form.get("year_label")).trim(); const starts = String(form.get("starts_on")); const ends = String(form.get("ends_on"));
      if (!/^\d{4}/.test(label) || !starts || !ends || ends < starts) throw new Error("Enter a four-digit year label and a valid date range.");
      const years = await getAll("academic_years");
      if (years.some((item) => item.year_label.toLowerCase() === label.toLowerCase())) throw new Error("That academic year already exists.");
      await writeRecord("academic_years", { id: crypto.randomUUID(), year_label: label, starts_on: starts, ends_on: ends, is_current: false, status: "planned", archived_at: null, created_at: new Date().toISOString() });
      await refresh();
    }, "ACADEMIC YEAR");
  }

  async function addConnectedAcademicYear() {
    const fields = [formField("Academic year label (must start with four-digit year)", "year_label", { maxLength: 40 }), formField("Starts on", "starts_on", { type: "date" }), formField("Ends on", "ends_on", { type: "date" })].join("");
    showForm("Add academic year", fields, "Save academic year", async (form) => {
      const yearLabel = String(form.get("year_label")).trim();
      const startsOn = String(form.get("starts_on"));
      const endsOn = String(form.get("ends_on"));
      if (!/^\d{4}/.test(yearLabel) || !startsOn || !endsOn || endsOn < startsOn) throw new Error("Enter a year label beginning with four digits and a valid date range.");
      const { data, error } = await state.supabase.from("academic_years").insert({ year_label: yearLabel, starts_on: startsOn, ends_on: endsOn, is_current: false, status: "planned" }).select("id").single();
      if (error) throw error;
      if (startsOn <= localDateIso() && endsOn >= localDateIso() && window.confirm("This date range includes today. Make this the current academic year now?")) {
        const { error: currentError } = await state.supabase.rpc("set_current_academic_year", { p_academic_year_id: data.id });
        if (currentError) throw currentError;
      }
      await refresh();
    }, "ACADEMIC YEAR");
  }

  async function addConnectedClass() {
    const { data: years, error: yearError } = await state.supabase.from("academic_years").select("id,year_label,status,archived_at").order("year_label", { ascending: false });
    if (yearError) throw yearError;
    const openYears = (years || []).filter((year) => year.status !== "closed" && !year.archived_at);
    if (!openYears.length) { notify("Ask an administrator to create an open academic year first.", true); return; }
    const fields = [formField("Academic year", "academic_year_id", { choices: openYears.map((year) => [year.id, year.year_label]) }), formField("Form / grade", "grade_label", { maxLength: 60, placeholder: "Form 3" }), formField("Class / stream name", "stream_name", { maxLength: 60, placeholder: "Delta", hint: "Enter the school's actual class name, not a class number." }), formField("School section", "school_section", { choices: [["", "Not applicable / both"], ["G", "G"], ["B", "B"]] })].join("");
    showForm("Add bookstore class", fields, "Save class", async (form) => {
      const gradeLabel = String(form.get("grade_label")).trim();
      const streamName = String(form.get("stream_name")).trim();
      if (!gradeLabel || !streamName) throw new Error("Enter both the form / grade and the class name.");
      const { error } = await state.supabase.from("school_classes").insert({ academic_year_id: String(form.get("academic_year_id")), grade_label: gradeLabel, class_label: `${gradeLabel} ${streamName}`, school_section: String(form.get("school_section") || "") || null, active: true });
      if (error) throw error;
      await refresh();
    }, "CLASS DIRECTORY");
  }

  async function addConnectedSubject() {
    const fields = [formField("Subject code", "subject_code", { maxLength: 40 }), formField("Subject name", "subject_name", { maxLength: 100 })].join("");
    showForm("Add school subject", fields, "Save subject", async (form) => {
      const { error } = await state.supabase.from("school_subjects").insert({ subject_code: String(form.get("subject_code")).trim(), subject_name: String(form.get("subject_name")).trim(), active: true });
      if (error) throw error;
      await refresh();
    }, "SUBJECT DIRECTORY");
  }

  async function addConnectedTeacherAssignment() {
    const [staffResult, classResult, subjectResult] = await Promise.all([
      state.supabase.from("staff_profiles").select("user_id,display_name,username,active").eq("active", true).order("display_name"),
      state.supabase.from("school_classes").select("id,class_label,school_section,academic_year_id,active").eq("active", true).order("class_label"),
      state.supabase.from("school_subjects").select("id,subject_name,active").eq("active", true).order("subject_name"),
    ]);
    for (const result of [staffResult, classResult, subjectResult]) if (result.error) throw result.error;
    const staff = staffResult.data || [];
    const classes = classResult.data || [];
    const subjects = subjectResult.data || [];
    if (!staff.length || !classes.length) { notify("Add active staff profiles and classes before assigning teachers.", true); return; }
    const fields = [formField("Staff member", "staff_user_id", { choices: staff.map((person) => [person.user_id, `${person.display_name} · ${person.username || ""}`]) }), formField("Assignment type", "assignment_type", { choices: [["class_teacher", "Class teacher"], ["subject_teacher", "Subject teacher"], ["substitute", "Substitute"]] }), formField("Class", "class_id", { choices: classes.map((item) => [item.id, `${item.class_label}${item.school_section ? ` · ${item.school_section}` : ""}`]) }), formField("Subject (required for subject teacher)", "subject_id", { required: false, choices: [["", "Not applicable"], ...subjects.map((item) => [item.id, item.subject_name])] }), formField("Starts on", "starts_on", { type: "date", value: localDateIso() }), formField("Ends on (optional)", "ends_on", { type: "date", required: false })].join("");
    showForm("Assign teacher", fields, "Save assignment", async (form) => {
      const assignmentType = String(form.get("assignment_type"));
      const subjectId = String(form.get("subject_id") || "") || null;
      const startsOn = String(form.get("starts_on"));
      const endsOn = String(form.get("ends_on") || "") || null;
      if (assignmentType === "subject_teacher" && !subjectId) throw new Error("Choose a subject for a subject-teacher assignment.");
      if (assignmentType === "class_teacher" && subjectId) throw new Error("A class-teacher assignment should not select a subject.");
      if (endsOn && endsOn < startsOn) throw new Error("The end date cannot be earlier than the start date.");
      const { error } = await state.supabase.from("staff_assignments").insert({ staff_user_id: String(form.get("staff_user_id")), assignment_type: assignmentType, class_id: String(form.get("class_id")), subject_id: subjectId, starts_on: startsOn, ends_on: endsOn, assigned_by: state.session.user.id });
      if (error) throw error;
      await refresh();
    }, "TEACHER ASSIGNMENT");
  }

  async function endConnectedTeacherAssignment(id) {
    if (!canManageStudentDeparture()) return;
    if (!window.confirm("End this assignment today? Its history will be retained.")) return;
    const { data: assignment, error: readError } = await state.supabase.from("staff_assignments").select("starts_on,ends_on").eq("id", id).single();
    if (readError) throw readError;
    if (assignment.ends_on) return;
    const today = localDateIso();
    const endDate = today < assignment.starts_on ? assignment.starts_on : today;
    const { error } = await state.supabase.from("staff_assignments").update({ ends_on: endDate }).eq("id", id).is("ends_on", null);
    if (error) throw error;
    await refresh();
  }

  async function setConnectedAcademicYear(id) {
    if (!window.confirm("Make this academic year current? This changes the active year for textbook allocation checks.")) return;
    const { error } = await state.supabase.rpc("set_current_academic_year", { p_academic_year_id: id });
    if (error) throw error;
    notify("Current academic year updated.");
    await refresh();
  }

  async function createConnectedApprovalRequest() {
    const fields = [
      formField("Request type", "request_type", { choices: [["student_departure", "Student departure exception"], ["inventory_adjustment", "Inventory adjustment"], ["academic_year_change", "Academic-year change"], ["staff_access", "Staff access change"], ["other", "Other"]] }),
      formField("Related record type", "target_table", { value: "students", maxLength: 80 }),
      formField("Related record ID (optional)", "target_id", { required: false, maxLength: 36 }),
      formField("Reason and supporting details", "request_reason", { textarea: true, full: true, maxLength: 1000 }),
    ].join("");
    showForm("Submit approval request", fields, "Submit request", async (form) => {
      const targetId = String(form.get("target_id") || "").trim();
      if (targetId && !/^[0-9a-f-]{36}$/i.test(targetId)) throw new Error("Enter a valid record ID or leave it blank.");
      const { error } = await state.supabase.from("approval_requests").insert({
        request_type: String(form.get("request_type")), target_table: String(form.get("target_table")).trim(),
        target_id: targetId || null, requested_by: state.session.user.id,
        request_reason: String(form.get("request_reason")).trim(), payload: {},
      });
      if (error) throw error;
      notify("Approval request submitted.");
      await refresh();
    }, "SCHOOL APPROVAL");
  }

  async function provisionConnectedStaff() {
    if (!["admin", "super_admin"].includes(currentRole())) return;
    const roleChoices = ["library_admin", "librarian", "library_assistant", "bookstore_admin", "bookstore_assistant", "auditor", "principal", "deputy_principal", "teacher", "class_teacher", "subject_teacher", "read_only", "admin", ...(currentRole() === "super_admin" ? ["super_admin"] : [])];
    const fields = [
      formField("Full name", "display_name", { maxLength: 120 }),
      formField("Username", "username", { maxLength: 32, hint: "3–32 letters, numbers, dots, underscores or hyphens." }),
      formField("Staff number (optional)", "staff_number", { required: false, maxLength: 40 }),
      formField("Department (optional)", "department", { required: false, maxLength: 80 }),
      formField("Role", "role", { choices: roleChoices.map((item) => [item, item.replaceAll("_", " ")]) }),
    ].join("");
    showForm("Create staff account", fields, "Create account", async (form) => {
      const { data, error } = await state.supabase.functions.invoke("kbms-staff-admin", { body: {
        action: "provision", display_name: String(form.get("display_name")).trim(),
        username: String(form.get("username")).trim(), staff_number: String(form.get("staff_number") || "").trim(),
        department: String(form.get("department") || "").trim(), role: String(form.get("role")),
      } });
      if (error) throw error;
      window.alert(`NEW STAFF CREDENTIAL — show this once to the staff member\n\nUsername: ${data.username}\nTemporary password: ${data.temporary_password}\n\nDeliver privately. The staff member must change this password at first sign-in. Do not save it in a shared spreadsheet or group chat.`);
      await refresh();
    }, "STAFF ACCOUNT");
  }

  async function connectedStaffAction(action, userId) {
    if (!["reset_password", "activate", "deactivate", "change_role"].includes(action)) return;
    let role = "";
    if (action === "change_role") {
      role = String(window.prompt("Enter the new role code (e.g. librarian, subject_teacher, principal):", "librarian") || "").trim();
      if (!role) return;
      if (!window.confirm(`Change this account's role to ${role}?`)) return;
    } else {
      const confirmText = action === "reset_password" ? "Reset this staff member's password?" : `${action === "deactivate" ? "Deactivate" : "Activate"} this staff account?`;
      if (!window.confirm(confirmText)) return;
    }
    const { data, error } = await state.supabase.functions.invoke("kbms-staff-admin", { body: { action, user_id: userId, ...(role ? { role } : {}) } });
    if (error) throw error;
    if (action === "reset_password") window.alert(`TEMPORARY PASSWORD — deliver privately\n\nUsername: ${data.username}\nTemporary password: ${data.temporary_password}\n\nThe staff member must change it at next sign-in.`);
    else notify(`Staff account ${action === "activate" ? "activated" : "deactivated"}.`);
    await refresh();
  }

  async function decideConnectedApproval(id, decision) {
    if (!["approved", "rejected"].includes(decision)) return;
    const reason = window.prompt(`${decision === "approved" ? "Approval" : "Rejection"} reason (required):`, "Reviewed by the school approver");
    if (reason === null) return;
    if (reason.trim().length < 3) { notify("Enter a reason of at least 3 characters.", true); return; }
    const { error } = await state.supabase.rpc("decide_approval_request", {
      p_request_id: id, p_decision: decision, p_decision_note: reason.trim(),
    });
    if (error) throw error;
    notify(`Request ${decision}.`);
    await refresh();
  }

  async function addDemoAssignment() {
    if (state.syncConfig) return;
    const [staff, classes, subjects] = await Promise.all([getAll("staff_profiles"), getAll("school_classes"), getAll("school_subjects")]);
    const teachers = staff.filter((item) => ["teacher", "class_teacher", "subject_teacher"].includes(item.role));
    if (!teachers.length || !classes.length) { notify("Add demonstration staff and classes first.", true); return; }
    const fields = [
      formField("Teacher", "staff_id", { choices: teachers.map((item) => [item.id, `${item.display_name} · ${item.role_label}`]) }),
      formField("Assignment type", "assignment_type", { choices: [["class_teacher", "Class teacher"], ["subject_teacher", "Subject teacher"]] }),
      formField("Class", "class_id", { choices: classes.map((item) => [item.id, item.display_name]) }),
      formField("Subject (for subject teachers)", "subject_id", { required: false, choices: [["", "Not applicable"], ...subjects.map((item) => [item.id, item.name])] }),
      formField("Start date", "starts_on", { type: "date", value: localDateIso() }),
    ].join("");
    showForm("Add teacher assignment", fields, "Save assignment", async (form) => {
      const assignmentType = String(form.get("assignment_type"));
      const subjectId = String(form.get("subject_id") || "") || null;
      if (assignmentType === "subject_teacher" && !subjectId) throw new Error("Choose a subject for a subject-teacher assignment.");
      if (assignmentType === "class_teacher" && subjectId) throw new Error("A class-teacher assignment should not select a subject.");
      await writeRecord("staff_assignments", {
        id: crypto.randomUUID(), staff_id: String(form.get("staff_id")),
        class_id: String(form.get("class_id")), subject_id: subjectId,
        assignment_type: assignmentType, starts_on: String(form.get("starts_on")),
        ends_on: null, active: true, demo_record: true,
        created_at: new Date().toISOString(),
      });
      await refresh();
    }, "DEMO WORKFLOW");
  }

  async function endDemoAssignment(id) {
    if (state.syncConfig) return;
    const assignment = await getStoredRecord("staff_assignments", id);
    if (!assignment || assignment.active === false) return;
    await writeRecord("staff_assignments", { ...assignment, active: false, ends_on: localDateIso(), updated_at: new Date().toISOString() });
    await refresh();
  }

  async function createDemoApprovalRequest() {
    if (state.syncConfig) return;
    const fields = [
      formField("Request title", "title", { maxLength: 140 }),
      formField("Request type", "request_type", { choices: [["inventory_adjustment", "Inventory adjustment"], ["student_departure", "Student departure exception"], ["annual_rollover", "Academic-year rollover"], ["other", "Other"]] }),
      formField("Reason and supporting details", "description", { textarea: true, full: true, maxLength: 600 }),
    ].join("");
    showForm("Submit approval request", fields, "Submit request", async (form) => {
      const now = new Date().toISOString();
      await writeRecord("approval_requests", {
        id: crypto.randomUUID(), title: String(form.get("title")).trim(),
        request_type: String(form.get("request_type")), description: String(form.get("description")).trim(),
        status: "pending", requested_by: null, requested_by_label: "Demo department staff",
        requested_at: now, decided_by: null, decided_at: null, decision_note: "",
        demo_record: true, created_at: now, updated_at: now,
      });
      await refresh();
    }, "DEMO WORKFLOW");
  }

  async function decideDemoApproval(id, decision) {
    if (state.syncConfig || !["approved", "rejected"].includes(decision)) return;
    const request = await getStoredRecord("approval_requests", id);
    if (!request || request.status !== "pending") return;
    const note = window.prompt(`${decision === "approved" ? "Approval" : "Rejection"} reason (required):`, "Reviewed in the fictional demo");
    if (note === null) return;
    if (!note.trim()) { notify("Enter a reason for the decision.", true); return; }
    const now = new Date().toISOString();
    await writeRecord("approval_requests", { ...request, status: decision, decided_by: null, decided_by_label: "Demo Principal", decided_at: now, decision_note: note.trim(), updated_at: now });
    await writeRecord("audit_events", {
      id: crypto.randomUUID(), action: decision, table_name: "approval_requests", record_id: request.id,
      actor_user_id: null, actor_label: "Demo Principal", occurred_at: now,
      after_data: { status: decision, reason: note.trim() }, demo_record: true,
    });
    await refresh();
  }

  async function renderReports() {
    const [students, books, loans] = await Promise.all([getAll("students"), getAll("books"), getAll("loans")]);
    const records = buildFollowUpRecords(students, books, loans);
    const outstanding = loans.filter((loan) => !loan.returned_at);
    const overdue = loans.filter((loan) => !loan.returned_at && lateDays(loan) > 0);
    const [textbookCopies, textbookAllocations, clearanceRecords] = await Promise.all([getAll("textbook_copies"), getAll("textbook_allocations"), getAll("clearance_records")]);
    const activeTextbookAllocations = textbookAllocations.filter((item) => !item.returned_at);
    const estimatedFees = loans.reduce((sum, loan) => sum + lateFeeKes(loan), 0);
    const houseCount = Object.fromEntries(Object.keys(HOUSES).map((code) => [code, 0]));
    for (const record of records) {
      const code = record.houseCode;
      if (code in houseCount) houseCount[code] += 1;
    }
    content.innerHTML = `<div class="print-header"><img src="./mhsk-crest.png" alt="Moi High School - Kabarak crest"><div><strong>MOI HIGH SCHOOL - KABARAK</strong><span>KABARAK BOOK MANAGEMENT · HOUSE FOLLOW-UP AUDIT</span><span>${escapeHtml(localDateIso())}</span></div></div>${heading("STUDENT SERVICES", "Clearance & reports", "Search a student in the register to review current loans and record individual clearance.", `<button class="button button-primary" data-action="export-overdue">Export follow-up CSV</button>`)}
      <section class="stats-grid">${statCard("UNRETURNED COPIES", loans.filter((loan) => !loan.returned_at).length, "Includes all active loans")}
        ${statCard("STUDENTS TO REVIEW", new Set(outstanding.map((loan) => loan.student_id)).size, "Students with one or more books out")}
        ${statCard("MISSING COPIES", books.filter((book) => book.condition === "Lost").length, "Catalog copies marked lost")}
        ${statCard("DAMAGE REPORTS", books.filter((book) => book.condition === "Damaged").length, "Catalog copies marked damaged")}
        ${statCard("OVERDUE LOANS", overdue.length, "Calendar days after the recorded due date")}
        ${statCard("ESTIMATED LATE FEES", `KSh ${estimatedFees.toLocaleString()}`, "KSh 5 per calendar day · not a payment record")}
        ${statCard("TEXTBOOKS OUT", activeTextbookAllocations.length, "Individual bookstore copies still allocated")}
        ${statCard("LOST TEXTBOOKS", textbookCopies.filter((copy) => copy.condition === "Lost").length, "Bookstore copies marked lost")}
        ${statCard("PENDING CLEARANCES", students.filter((student) => student.active !== false).filter((student) => !["library", "bookstore"].every((dept) => byNewest(clearanceRecords.filter((item) => item.student_id === student.id && item.department === dept))[0]?.status === "cleared")).length, "Active students not cleared by both departments")}</section>
      <section class="panel"><div class="panel-header"><div><h2>Follow-up records by house</h2><p>Open loans and missing catalog copies, grouped by recorded student house.</p></div><div class="report-actions"><button class="button button-secondary" data-action="export-overdue">Download CSV</button><button class="button button-secondary" data-action="export-excel">Download Excel</button><button class="button button-secondary" data-action="print-report">Print / Save PDF</button></div></div><div class="panel-body"><div class="house-grid">${Object.entries(HOUSES).map(([code, label]) => `<div class="house-card"><strong>${code}</strong><span>${escapeHtml(label)}</span><span>${houseCount[code]} follow-up ${houseCount[code] === 1 ? "record" : "records"}</span></div>`).join("")}</div></div>
      <div class="table-wrap"><table><thead><tr><th>House</th><th>Student</th><th>Admission</th><th>Book code</th><th>Due date</th><th>Late days</th><th>Est. fee</th><th>Follow-up</th></tr></thead><tbody>${records.length ? records.map((record) => {
        const { loan, student, book, houseCode, type } = record;
        return `<tr><td>${escapeHtml(`${houseCode} · ${houseName(houseCode)}`)}</td><td><strong>${escapeHtml(loan?.student_name_snapshot || student?.full_name || "No student recorded")}</strong></td><td class="code-text">${escapeHtml(loan?.student_admission_snapshot || student?.admission_number || "Not recorded")}</td><td class="code-text">${escapeHtml(loan?.book_code_snapshot || book?.accession_code || "Book record unavailable")}</td><td>${escapeHtml(loan?.due_date || "Not set")}</td><td>${loan ? lateDays(loan) : "—"}</td><td>${loan ? `KSh ${lateFeeKes(loan).toLocaleString()}` : "—"}</td><td><span class="status-tag ${type === "Missing" ? "danger" : "warn"}">${escapeHtml(type)}</span></td></tr>`;
      }).join("") : `<tr><td class="table-empty" colspan="8">No unreturned or missing library books in the current records.</td></tr>`}</tbody></table></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Bookstore textbook follow-up</h2><p>Outstanding allocations and lost physical copies, kept separate from library circulation.</p></div></div><div class="table-wrap"><table><thead><tr><th>Copy code</th><th>Textbook</th><th>Student</th><th>Admission</th><th>Academic year</th><th>Return deadline</th><th>Status</th></tr></thead><tbody>${activeTextbookAllocations.length ? byNewest(activeTextbookAllocations).map((item) => `<tr><td class="code-text">${escapeHtml(item.copy_code_snapshot)}</td><td>${escapeHtml(item.title_snapshot)}</td><td>${escapeHtml(item.student_name_snapshot)}</td><td class="code-text">${escapeHtml(item.student_admission_snapshot)}</td><td>${escapeHtml(item.academic_year)}</td><td>${escapeHtml(item.due_date)}</td><td><span class="status-tag warn">Outstanding</span></td></tr>`).join("") : `<tr><td class="table-empty" colspan="7">No outstanding textbook allocations.</td></tr>`}</tbody></table></div></section>`;
  }

  async function addBook(existing = null) {
    const currentYear = new Date().getFullYear();
    const fields = [
      formField("Book code", "accession_code", { value: existing?.accession_code || "", placeholder: "Enter the code already used at school", maxLength: 80, full: true, hint: "Existing school codes are accepted. Letters, numbers, hyphens, slashes, dots and underscores are supported." }),
      formField("Book title", "title", { value: existing?.title || "", maxLength: 240, full: true }),
      formField("Description", "description", { value: existing?.description || "", maxLength: 500, required: false, textarea: true, full: true, placeholder: "Edition, course level, or a short identification note." }),
      formField("Purchase year", "purchase_year", { type: "number", min: 1900, max: currentYear, value: existing?.purchase_year || "", required: false, hint: "Optional; leave blank when it is not known." }),
      formField("Subject", "subject", { value: existing?.subject || "", maxLength: 100 }),
      formField("Publisher", "publisher", { value: existing?.publisher || "", required: false, maxLength: 120 }),
      formField("Condition", "condition", { value: existing?.condition || "Available", choices: [["Available", "Available"], ["Damaged", "Damaged"], ["Lost", "Lost"]] }),
      photoField(existing?.cover_image),
    ].join("");
    showForm(existing ? "Edit textbook copy" : "Catalog textbook copy", fields, existing ? "Save changes" : "Add to catalog", async (form) => {
      const accession = String(form.get("accession_code")).trim();
      if (!BOOK_CODE.test(accession)) throw new Error("Enter a book code containing letters, numbers, dots, underscores, slashes or hyphens (up to 80 characters).");
      const structuredCode = /^([A-Z]{2,6})-(\d{3,8})-(\d{4})$/i.exec(accession);
      const yearInput = String(form.get("purchase_year") || "").trim();
      const purchaseYear = yearInput ? Number(yearInput) : structuredCode ? Number(structuredCode[3]) : null;
      if (purchaseYear !== null && (!Number.isInteger(purchaseYear) || purchaseYear < 1900 || purchaseYear > currentYear)) {
        throw new Error(`Purchase year must be a whole year between 1900 and ${currentYear}, or left blank.`);
      }
      const books = await getAll("books");
      if (books.some((book) => book.accession_code.toLowerCase() === accession.toLowerCase() && book.id !== existing?.id)) throw new Error("That book code is already registered.");
      const selectedPhoto = await compressPhoto(form.get("cover_photo"));
      const book = {
        id: existing?.id || crypto.randomUUID(), accession_code: accession,
        prefix: structuredCode?.[1].toUpperCase() || null,
        accession_number: structuredCode?.[2] || null, purchase_year: purchaseYear,
        title: String(form.get("title")).trim(), description: String(form.get("description") || "").trim(), subject: String(form.get("subject")).trim(),
        publisher: String(form.get("publisher")).trim(), condition: String(form.get("condition")),
        cover_image: selectedPhoto || existing?.cover_image || null,
        created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (book.title.length < 1 || book.title.length > 240 || book.description.length > 500 || book.subject.length < 1 || book.subject.length > 100 || book.publisher.length > 120) throw new Error("Enter a title (up to 240 characters), description (up to 500 characters), subject (up to 100 characters) and publisher (up to 120 characters).");
      await writeRecord("books", book);
      notify(existing ? "Book details updated." : "Book copy added to inventory.");
      await refresh();
      if (state.session) flushOutbox();
    });
  }

  async function addStudent() {
    const currentYear = new Date().getFullYear();
    const fields = [
      formField("Admission number", "admission_number", { maxLength: 64, full: true }),
      formField("Student full name", "full_name", { maxLength: 160, full: true }),
      formField("House", "house_code", { choices: Object.entries(HOUSES).map(([code, name]) => [code, `${code} · ${name}`]) }),
      formField("Grade / form", "grade", { value: currentYear >= 2028 ? "Grade 10" : "Grade 9", maxLength: 40, full: true, hint: "Use the class label approved for the current academic year." }),
      formField("Class number", "class_number", { type: "number", min: 1, max: 999, value: 1 }),
    ].join("");
    showForm("Register student", fields, "Register student", async (form) => {
      const admission = String(form.get("admission_number")).trim();
      const name = String(form.get("full_name")).trim();
      const classNumber = Number(form.get("class_number"));
      const students = await getAll("students");
      if (students.some((student) => student.admission_number.toLowerCase() === admission.toLowerCase())) throw new Error("That admission number is already registered.");
      if (!admission || admission.length > 64 || name.length < 2 || name.length > 160 || !Number.isInteger(classNumber) || classNumber < 1 || classNumber > 999) throw new Error("Enter an admission number (up to 64 characters), full name (2 to 160 characters) and class number from 1 to 999.");
      await writeRecord("students", {
        id: crypto.randomUUID(), admission_number: admission, full_name: name,
        house_code: String(form.get("house_code")), house: String(form.get("house_code"))[0], school_section: String(form.get("house_code"))[1],
        grade: String(form.get("grade")), current_class: `${String(form.get("grade"))} · Class ${classNumber}`, active: true,
        class_number: classNumber,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      notify("Student registered.");
      await refresh();
      if (state.session) flushOutbox();
    });
  }

  async function issueOrReturn(studentInput, bookInput, mode, requestedDueDate = "") {
    try {
      const [students, books, loans] = await Promise.all([getAll("students"), getAll("books"), getAll("loans")]);
      const needle = studentInput.trim().toLowerCase();
      const student = students.find((item) => item.admission_number.toLowerCase() === needle)
        || students.find((item) => item.full_name.toLowerCase() === needle);
      if (!student) throw new Error("No student matches that exact admission number or full name.");
      const accession = bookInput.trim();
      if (!BOOK_CODE.test(accession)) throw new Error("Enter a valid code from the library catalog.");
      const book = books.find((item) => item.accession_code.toLowerCase() === accession.toLowerCase());
      if (!book) throw new Error("That book code is not in the catalog.");
      const activeLoan = currentLoanFor(book.id, loans);
      if (mode === "issue") {
        if (activeLoan) throw new Error("This copy is already issued. Record its return before issuing it again.");
        if (book.condition !== "Available") throw new Error(`This copy is marked ${book.condition.toLowerCase()} and cannot be issued.`);
        const issueDate = new Date();
        const dueDate = requestedDueDate.trim();
        if (!dueDate) throw new Error("Set the weekly return date before issuing this library book.");
        if (student.active === false) throw new Error("This student is not on the active register and cannot receive a new loan.");
        const parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
        if (dueDate && (
          !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
          || Number.isNaN(parsedDueDate.getTime())
          || parsedDueDate.toISOString().slice(0, 10) !== dueDate
          || dueDate <= localDateIso(issueDate)
        )) {
          throw new Error("The weekly return date must be a valid calendar date after the issue date.");
        }
        const loan = {
          id: crypto.randomUUID(), student_id: student.id, book_id: book.id,
          student_admission_snapshot: student.admission_number,
          student_name_snapshot: student.full_name,
          house_code_snapshot: student.house_code,
          grade_snapshot: student.grade,
          class_number_snapshot: student.class_number, class_snapshot: student.current_class || `${student.grade} · Class ${student.class_number}`,
          book_code_snapshot: book.accession_code,
          book_title_snapshot: book.title,
          purchase_year_snapshot: book.purchase_year,
          issued_at: localDateIso(issueDate), due_date: dueDate || null,
          returned_at: null, created_at: issueDate.toISOString(), updated_at: issueDate.toISOString(),
        };
        if (state.syncConfig) {
          if (!state.session || !navigator.onLine) throw new Error("A shared-school library issue must be confirmed online. Reconnect and sign in before issuing this copy.");
          const { data, error } = await state.supabase.rpc("issue_library_book", {
            p_student_id: student.id, p_book_id: book.id, p_due_date: dueDate,
          });
          if (error) throw new Error(`The school server did not confirm this issue: ${error.message}`);
          if (!data?.id) throw new Error("The server did not return the confirmed library loan record.");
          Object.assign(loan, data);
        }
        await writeRecord("loans", loan, Boolean(state.syncConfig));
        notify(`${book.accession_code} issued to ${student.full_name}.`);
      } else {
        if (!activeLoan) throw new Error("No open loan exists for this book copy.");
        if (activeLoan.student_id !== student.id) throw new Error("This copy is recorded against another student.");
        const returnedLoan = { ...activeLoan, returned_at: localDateIso(), updated_at: new Date().toISOString() };
        if (state.syncConfig) {
          if (!state.session || !navigator.onLine) throw new Error("A shared-school return must be confirmed online. Reconnect and sign in before closing this loan.");
          const { data, error } = await state.supabase.rpc("return_library_loan", { p_loan_id: activeLoan.id });
          if (error) throw new Error(`The school server did not confirm this return: ${error.message}`);
          returnedLoan.returned_at = data;
        }
        await writeRecord("loans", returnedLoan, Boolean(state.syncConfig));
        notify(`${book.accession_code} return recorded for ${student.full_name}.`);
      }
      await refresh();
      if (state.session) flushOutbox();
    } catch (error) { notify(error.message || "Circulation action failed.", true); }
  }

  async function issueFromScan(input, dueDate = "") {
    const books = await getAll("books");
    const normalized = input.trim();
    const codeToken = normalized.split(/[\s,;|]+/).find((token) => books.some((book) => book.accession_code.toLowerCase() === token.toLowerCase()));
    if (!codeToken) {
      notify("Enter a student admission or name and a book code that exists in the library catalog.", true);
      return;
    }
    const code = codeToken;
    const index = normalized.indexOf(codeToken);
    const student = `${normalized.slice(0, index)} ${normalized.slice(index + codeToken.length)}`
      .replace(/[\t,;|]+/g, " ").trim();
    if (!student) {
      notify("Enter a student admission or name together with the book code.", true);
      return;
    }
    issueOrReturn(student, code, "issue", dueDate);
  }

  async function markReturned(loanId) {
    const loan = (await getAll("loans")).find((item) => item.id === loanId);
    if (!loan || loan.returned_at) return;
    const updated = { ...loan, returned_at: localDateIso(), updated_at: new Date().toISOString() };
    if (state.syncConfig) {
      if (!state.session || !navigator.onLine) { notify("A shared-school return must be confirmed online. Reconnect before closing this loan.", true); return; }
      const { data, error } = await state.supabase.rpc("return_library_loan", { p_loan_id: loan.id });
      if (error) { notify(`The school server did not confirm this return: ${error.message}`, true); return; }
      updated.returned_at = data;
    }
    await writeRecord("loans", updated, Boolean(state.syncConfig));
    notify("Library return recorded.");
    await refresh();
    if (state.session) flushOutbox();
  }

  async function toggleClearance(id, department) {
    if (!["library", "bookstore"].includes(department) || !canManageClearanceDepartment(department)) return;
    const student = (await getAll("students")).find((item) => item.id === id);
    if (!student) return;
    if (student.active === false) {
      notify("This student is inactive. Reopen the student record through an authorized student-register workflow.", true);
      return;
    }
    const [loans, allocations, records] = await Promise.all([
      getAll("loans"), getAll("textbook_allocations"), getAll("clearance_records"),
    ]);
    const outstanding = department === "library"
      ? loans.some((item) => item.student_id === id && !item.returned_at)
      : allocations.some((item) => item.student_id === id && !item.returned_at);
    const latest = byNewest(records.filter((item) => item.student_id === id && item.department === department))[0];
    const nextStatus = latest?.status === "cleared" ? "reopened" : outstanding ? "blocked" : "cleared";
    if (nextStatus === "blocked") {
      notify(`Cannot clear ${department}: this student still has an outstanding ${department === "library" ? "library loan" : "textbook allocation"}.`, true);
      return;
    }
    if (state.syncConfig && (!state.session || !navigator.onLine)) {
      notify("A shared-school clearance must be confirmed online. Reconnect before recording it.", true);
      return;
    }
    const now = new Date().toISOString();
    let serverId = null;
    if (state.syncConfig && nextStatus === "cleared") {
      const { data, error } = await state.supabase.rpc("record_student_clearance", {
        p_student_id: id, p_department: department, p_notes: "",
      });
      if (error) { notify(`The school server did not confirm this clearance: ${error.message}`, true); return; }
      serverId = data;
    }
    const record = {
      id: serverId || crypto.randomUUID(), student_id: id, department, academic_year_id: null,
      status: nextStatus, checked_by: state.session?.user?.id || null,
      checked_at: now, notes: "", created_at: now, updated_at: now,
    };
    if (nextStatus === "reopened" && state.syncConfig) {
      // Reopening is a separate audited event; no historical clearance row is overwritten.
      record.status = "reopened";
      record.id = crypto.randomUUID();
      const { data, error } = await state.supabase.rpc("reopen_student_clearance", {
        p_student_id: id, p_department: department, p_notes: "Clearance reopened by authorized staff",
      });
      if (error) { notify(`The server did not confirm reopening: ${error.message}`, true); return; }
      record.id = data;
    }
    await writeRecord("clearance_records", record, Boolean(state.syncConfig));
    notify(`${department === "library" ? "Library" : "Bookstore"} clearance ${nextStatus === "cleared" ? "recorded" : "reopened"}.`);
    await refresh();
    if (state.session) flushOutbox();
  }

  async function recordStudentDeparture(studentId) {
    if (!canManageStudentDeparture()) return;
    const student = (await getAll("students")).find((item) => item.id === studentId);
    if (!student || student.active === false) return;
    const [loans, allocations, clearanceRecords] = await Promise.all([
      getAll("loans"), getAll("textbook_allocations"), getAll("clearance_records"),
    ]);
    const hasLibraryBooks = loans.some((item) => item.student_id === studentId && !item.returned_at);
    const hasTextbooks = allocations.some((item) => item.student_id === studentId && !item.returned_at);
    const latest = (department) => byNewest(clearanceRecords.filter((item) => item.student_id === studentId && item.department === department))[0]?.status;
    if (hasLibraryBooks || hasTextbooks || latest("library") !== "cleared" || latest("bookstore") !== "cleared") {
      notify("Departure is blocked until all books are returned and both departments have recorded clearance.", true);
      return;
    }
    showForm(`Record departure · ${student.full_name}`, formField("Reason / reference (optional)", "reason", { required: false, textarea: true, full: true, maxLength: 300 }), "Confirm departure", async (form) => {
      const reason = String(form.get("reason") || "").trim();
      if (state.syncConfig) {
        if (!state.session || !navigator.onLine) throw new Error("A shared-school departure must be confirmed online.");
        const { error } = await state.supabase.rpc("depart_student", { p_student_id: studentId, p_reason: reason });
        if (error) throw new Error(`The server did not confirm departure: ${error.message}`);
      }
      await writeRecord("students", { ...student, active: false, departed_at: new Date().toISOString(), departure_reason: reason,
        academic_status: "departed", updated_at: new Date().toISOString() });
      notify("Student marked inactive. Their historical records have been retained.");
      await refresh();
      if (state.session) flushOutbox();
    }, "STUDENT REGISTER");
  }

  async function showStudentProfile(studentId) {
    const [students, books, loans, textbookAllocations, clearanceRecords] = await Promise.all([
      getAll("students"), getAll("books"), getAll("loans"), getAll("textbook_allocations"), getAll("clearance_records"),
    ]);
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const bookMap = new Map(books.map((book) => [book.id, book]));
    const history = byNewest(loans.filter((loan) => loan.student_id === studentId));
    const outstanding = history.filter((loan) => !loan.returned_at);
    const textbookHistory = byNewest(textbookAllocations.filter((item) => item.student_id === studentId));
    const latestClearance = (department) => byNewest(clearanceRecords.filter((item) => item.student_id === studentId && item.department === department))[0]?.status || "pending";
    byId("legal-title").textContent = "Student lending record";
    byId("legal-content").innerHTML = `
      <p><strong>${escapeHtml(student.full_name)}</strong><br>Admission ${escapeHtml(student.admission_number)} · ${escapeHtml(student.house_code)} - ${escapeHtml(houseName(student.house_code))} · ${escapeHtml(student.current_class || student.grade)} · ${student.active === false ? "Inactive / departed" : "Active"}</p>
      <h3>Department clearance</h3><p>Library: <strong>${escapeHtml(latestClearance("library"))}</strong> · Bookstore: <strong>${escapeHtml(latestClearance("bookstore"))}</strong></p>
      <p>${outstanding.length ? `${outstanding.length} library book${outstanding.length === 1 ? "" : "s"} currently outstanding.` : "No library books currently outstanding."} ${textbookHistory.filter((item) => !item.returned_at).length} bookstore textbook${textbookHistory.filter((item) => !item.returned_at).length === 1 ? "" : "s"} outstanding.</p>
      <h3>Borrowing history</h3>
      ${history.length ? `<div class="table-wrap"><table><thead><tr><th>Book</th><th>Issued</th><th>Due</th><th>Returned</th><th>Late days</th><th>Est. fee</th></tr></thead><tbody>${history.map((loan) => {
        const book = bookMap.get(loan.book_id);
        return `<tr><td>${escapeHtml(loan.book_code_snapshot || book?.accession_code || "Book record unavailable")}<br>${escapeHtml(loan.book_title_snapshot || book?.title || "")}</td><td>${escapeHtml(loan.issued_at)}</td><td>${escapeHtml(loan.due_date || "Not set")}</td><td>${escapeHtml(loan.returned_at || "Outstanding")}</td><td>${lateDays(loan)}</td><td>KSh ${lateFeeKes(loan).toLocaleString()}</td></tr>`;
      }).join("")}</tbody></table></div>` : "<p>No library lending records have been recorded for this student.</p>"}
      <h3>Textbook allocation history</h3>${textbookHistory.length ? `<div class="table-wrap"><table><thead><tr><th>Copy</th><th>Textbook</th><th>Academic year</th><th>Allocated</th><th>Returned</th></tr></thead><tbody>${textbookHistory.map((item) => `<tr><td>${escapeHtml(item.copy_code_snapshot)}</td><td>${escapeHtml(item.title_snapshot)}</td><td>${escapeHtml(item.academic_year)}</td><td>${escapeHtml(item.allocated_at)}</td><td>${escapeHtml(item.returned_at || "Outstanding")}</td></tr>`).join("")}</tbody></table></div>` : "<p>No textbook allocation records.</p>"}`;
    byId("legal-dialog").showModal();
  }

  function downloadImportTemplate(kind) {
    const rows = kind === "students"
      ? [["admission_number", "full_name", "house", "school_section", "grade", "class_number"]]
      : kind === "textbooks"
        ? [["copy_code", "title", "subject", "publisher", "purchase_year", "condition"], ["INV-001-2020", "Mathematics Learner's Book", "Mathematics", "Publisher name", "2020", "Available"], ["INV-002-2020", "Mathematics Learner's Book", "Mathematics", "Publisher name", "2020", "Available"]]
        : [["accession_code", "title", "subject", "publisher", "purchase_year", "description"]];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = kind === "students" ? "kbms-student-import-template.csv" : kind === "textbooks" ? "kbms-textbook-copy-import-template.csv" : "kbms-library-import-template.csv";
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function downloadCsv(rows) {
    const csvRows = [
      ["MOI HIGH SCHOOL - KABARAK"],
      ["KABARAK BOOK MANAGEMENT", "AUDIT EXPORT"],
      ["INSTITUTIONAL CREST", "mhsk-crest.png"],
      ["GENERATED UTC", new Date().toISOString()],
      [],
      ...rows,
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kabarak-book-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function getOutstandingExportRows() {
    const [students, books, loans, textbookAllocations, textbookCopies] = await Promise.all([
      getAll("students"), getAll("books"), getAll("loans"), getAll("textbook_allocations"), getAll("textbook_copies"),
    ]);
    const records = buildFollowUpRecords(students, books, loans);
    const libraryRows = records.map(({ houseCode, student, book, loan, type }) => [
      "Library", houseCode, houseName(houseCode), type,
      loan?.student_admission_snapshot || student?.admission_number || "",
      loan?.student_name_snapshot || student?.full_name || "",
      loan?.book_code_snapshot || book?.accession_code || "",
      loan?.book_title_snapshot || book?.title || "",
      loan?.issued_at || "", loan?.due_date || "", loan ? lateDays(loan) : 0, loan ? lateFeeKes(loan) : 0,
    ]);
    const studentMap = new Map(students.map((student) => [student.id, student]));
    const textbookRows = textbookAllocations.filter((item) => !item.returned_at).map((item) => {
      const student = studentMap.get(item.student_id);
      return ["Bookstore", student?.house_code || "", houseName(student?.house_code || ""), "Textbook outstanding",
        item.student_admission_snapshot, item.student_name_snapshot, item.copy_code_snapshot, item.title_snapshot,
        item.allocated_at, item.due_date, "", ""];
    });
    const lostTextbooks = textbookCopies.filter((copy) => copy.condition === "Lost").map((copy) => [
      "Bookstore", "", "", "Textbook marked lost", "", "", copy.copy_code, copy.title, "", "", "", "",
    ]);
    return [
      ["Department", "House code", "House", "Follow-up type", "Admission number", "Student", "Book code", "Book title", "Issue/allocation date", "Due date", "Late days", "Estimated fee KES"],
      ...libraryRows, ...textbookRows, ...lostTextbooks,
    ];
  }

  async function exportOutstanding() {
    const rows = await getOutstandingExportRows();
    downloadCsv(rows);
    notify(`${Math.max(0, rows.length - 1)} library and bookstore follow-up records exported as CSV.`);
  }

  async function exportOutstandingExcel() {
    const [students, books, loans, textbookCopies, textbookAllocations, clearances] = await Promise.all([
      getAll("students"), getAll("books"), getAll("loans"), getAll("textbook_copies"),
      getAll("textbook_allocations"), getAll("clearance_records"),
    ]);
    const generated = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
    const preface = [["MOI HIGH SCHOOL - KABARAK"], ["KABARAK BOOK MANAGEMENT · AUDIT EXPORT"], ["Generated (Kenya time)", generated], []];
    const followUp = await getOutstandingExportRows();
    const studentRows = [preface[0], preface[2], [], ["Admission number", "Full name", "House", "School section", "Grade", "Class", "Active", "Departure date"],
      ...students.map((item) => [item.admission_number, item.full_name, item.house || item.house_code?.[0] || "", item.school_section || item.house_code?.[1] || "", item.grade, item.current_class || item.class_number || "", item.active !== false ? "Yes" : "No", item.departed_at || ""])];
    const libraryInventory = [preface[0], preface[2], [], ["Book code", "Title", "Subject", "Publisher", "Purchase year", "Condition", "Description"],
      ...books.map((item) => [item.accession_code, item.title, item.subject, item.publisher, item.purchase_year || "", item.condition, item.description || ""])];
    const libraryHistory = [preface[0], preface[2], [], ["Admission number", "Student", "Book code", "Book title", "Issued", "Due", "Returned", "Late days", "Estimated fee KES"],
      ...loans.map((item) => [item.student_admission_snapshot, item.student_name_snapshot, item.book_code_snapshot, item.book_title_snapshot, item.issued_at, item.due_date || "", item.returned_at || "Outstanding", lateDays(item), lateFeeKes(item)])];
    const textbookInventory = [preface[0], preface[2], [], ["Copy code", "Title", "Subject", "Publisher", "Condition", "Description"],
      ...textbookCopies.map((item) => [item.copy_code, item.title, item.subject, item.publisher || "", item.condition, item.description || ""])];
    const textbookHistory = [preface[0], preface[2], [], ["Copy code", "Title", "Student admission", "Student", "Class", "Academic year", "Allocated", "Due", "Returned"],
      ...textbookAllocations.map((item) => [item.copy_code_snapshot, item.title_snapshot, item.student_admission_snapshot, item.student_name_snapshot, item.class_snapshot || "", item.academic_year, item.allocated_at, item.due_date, item.returned_at || "Outstanding"])];
    const clearanceHistory = [preface[0], preface[2], [], ["Student ID", "Department", "Status", "Checked by", "Checked at", "Notes"],
      ...clearances.map((item) => [item.student_id, item.department, item.status, item.checked_by || "", item.checked_at || "", item.notes || ""])];
    const sheets = [
      { name: "Follow-up", rows: [...preface, ...followUp] },
      { name: "Students", rows: studentRows },
      { name: "Library inventory", rows: libraryInventory },
      { name: "Library history", rows: libraryHistory },
      { name: "Textbook inventory", rows: textbookInventory },
      { name: "Textbook history", rows: textbookHistory },
      { name: "Clearances", rows: clearanceHistory },
    ];
    window.KBMSXlsxExport.downloadXlsxWorkbook(sheets, `kabarak-book-audit-${localDateIso()}.xlsx`);
    notify(`Excel audit workbook exported with ${sheets.length} worksheets and ${students.length + books.length + loans.length + textbookCopies.length + textbookAllocations.length + clearances.length} records.`);
  }

  function showLegal(kind) {
    const privacy = kind === "privacy";
    byId("legal-title").textContent = privacy ? "Privacy policy" : "Terms & conditions";
    byId("legal-content").innerHTML = privacy ? `
      <p><strong>Effective 26 October 2026</strong></p>
      <p>Kabarak Book Management is intended for authorized Moi High School - Kabarak staff. It records student identifiers, library issues and returns, textbook allocations and returns, and individual clearance activity.</p>
      <h3>Information and purpose</h3><p>Student names, admission numbers, house and class details, library book records, textbook allocations and returns, and circulation history are used only for school book management and clearance.</p>
      <h3>Storage and synchronization</h3><p>Records are stored in this browser on this device. If the school configures its Supabase service and an authorized staff member signs in, records are synchronized to that service. Do not use a shared or public device for an authenticated session. Signing out clears synchronized student and book records from this browser. Resolve pending synchronization before signing out.</p>
      <h3>Safeguards and retention</h3><p>Restrict device access, lock library terminals when unattended and follow school retention and student-data policies. Historical lending records should be retained for audit purposes. This application does not transmit data to a server unless a school backend is configured and the user signs in.</p>
      <h3>Your responsibilities</h3><p>Only enter information necessary for library operations. Contact the school library administrator to correct records or request guidance on access and retention. This software notice does not replace the school’s approved student privacy policy.</p>
      <h3>Contact</h3><p>Direct questions to the Moi High School - Kabarak library administration.</p>` : `
      <p><strong>Effective 26 October 2026</strong></p>
      <p>This application supports authorized school staff with library cataloging and circulation, textbook inventory and lending, student register maintenance and book-return follow-up.</p>
      <h3>Authorized use</h3><p>Use school-approved accounts and devices. Enter accurate book codes and student records. Protect student information and do not share access credentials or export files with unauthorized recipients.</p>
      <h3>Record integrity</h3><p>Verify every issue, allocation and return at the time of the transaction. Do not mark a student cleared while library books remain outstanding. Purchase-year and aging indicators support review and do not determine disposal by themselves.</p>
      <h3>Offline records and synchronization</h3><p>Without a configured backend, records remain on the current browser and do not synchronize to other devices. With school Supabase configuration, signed-in changes sync when a connection is available. Review synchronization errors before relying on another device’s records. Keep required school backups and audit records.</p>
      <h3>Availability and responsibility</h3><p>The application is provided as an operational tool. Staff remain responsible for checking source records, safeguarding exports and following the school’s library procedures, data-protection requirements and retention schedule.</p>
      <h3>Support</h3><p>Report access, data-integrity and service issues to the school library administrator.</p>`;
    byId("legal-dialog").showModal();
  }

  async function connectSupabase() {
    const config = window.BOOKSTORE_CONFIG;
    state.syncConfig = config?.url && config?.anonKey ? config : null;
    if (!config || !config.url || !config.anonKey) {
      setSyncStatus("offline", "Local demo only");
      return;
    }
    state.syncConfig = config;
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(config.url)) {
      setSyncStatus("error", "Backend URL invalid");
      notify("Supabase URL must be an HTTPS origin.", true);
      return;
    }
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      state.supabase = createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data, error } = await state.supabase.auth.getSession();
      if (error) throw error;
      state.supabase.auth.onAuthStateChange((_event, session) => {
        state.sessionTask = startSessionSync(session);
        state.sessionTask?.catch(async (sessionError) => {
          reportSyncError(sessionError);
          const { error: signOutError } = await state.supabase.auth.signOut();
          if (signOutError) notify(`Could not end the unauthorized session: ${signOutError.message}`, true);
        });
      });
      if (data.session) {
        state.sessionTask = startSessionSync(data.session);
        await state.sessionTask;
      } else {
        await clearSyncedWorkspace();
        setSyncStatus("offline", "Sign in to access records");
        await refresh();
      }
    } catch (error) {
      if (state.session) {
        state.session = null;
        state.staffRole = null;
        await state.supabase?.auth.signOut();
      }
      setSyncStatus("error", "Sync unavailable");
      await refresh();
      notify(`Could not initialize the configured sync service: ${error.message}`, true);
    }
  }

  async function startSessionSync(session) {
    if (!session) {
      if (state.channel) state.supabase.removeChannel(state.channel);
      state.channel = null;
      state.session = null;
      state.staffRole = null;
      state.offlineAuthorization = null;
      state.sessionTask = null;
      setSyncStatus("pending", "Clearing signed-out device data");
      return (state.sessionTask = (async () => {
        const pending = await getAll("outbox");
        await clearSyncedWorkspace();
        if (pending.length) notify(`${pending.length} unsynchronized change(s) were cleared when the session ended. Contact the administrator to reconcile the server records.`, true);
        setSyncStatus("offline", "Sign in to access records");
        await refresh();
      })().catch((error) => reportSyncError(error)));
    }
    if (state.session?.user.id === session.user.id && state.sessionTask) return state.sessionTask;
    const identityChanged = Boolean(state.session?.user.id && state.session.user.id !== session.user.id);
    if (identityChanged) await clearSyncedWorkspace();
    state.session = session;
    state.staffRole = null;
    setSyncStatus("pending", "Checking access");
    return (state.sessionTask = (async () => {
      const { data, error } = await state.supabase.from("staff_memberships")
        .select("role,active").eq("user_id", session.user.id).maybeSingle();
      if (error) throw new Error(`Could not verify library access: ${error.message}`);
      if (!data?.active || !["admin", "librarian", "read_only", "super_admin", "library_admin", "library_assistant", "bookstore_admin", "bookstore_assistant", "auditor", "principal", "deputy_principal", "teacher", "class_teacher", "subject_teacher"].includes(data.role)) {
        throw new Error("This account is not authorized for the school library system.");
      }
      state.staffRole = data.role;
      state.offlineAuthorization = null;
      subscribeToChanges();
      await synchronizeFromServer();
      if (canManageRecords()) await flushOutbox();
      await refresh();
      if (session.user?.user_metadata?.must_change_password && !byId("change-password-dialog").open) {
        byId("change-password-dialog").showModal();
      }
      setSyncStatus("online", data.role === "read_only" ? "Read-only access" : "Synchronized");
    })());
  }

  async function synchronizeFromServer() {
    if (!state.supabase || !state.session) return;
    setSyncStatus("pending", "Synchronizing");
    const queued = await getAll("outbox");
    const queuedIds = new Set(queued.map((item) => item.id));
    const assignmentScopedTeacher = ["teacher", "subject_teacher", "class_teacher"].includes(currentRole());
    let discardedUnconfirmedTransactions = 0;
    for (const table of ["students", "books", "loans", "textbook_copies", "textbook_allocations", "clearance_records"]) {
      const data = await fetchRemoteTable(table);
      if (["loans", "textbook_allocations", "clearance_records"].includes(table)) {
        // Transaction history is server-authoritative. These actions require an online RPC;
        // never replay old/local queue entries as direct table writes.
        for (const item of queued.filter((entry) => entry.table === table)) {
          if (!data.some((record) => record.id === item.record.id)) discardedUnconfirmedTransactions += 1;
          await removeOutboxIfUnchanged(item);
        }
        await replaceAll(table, data);
        continue;
      }
      if (assignmentScopedTeacher) {
        await replaceAll(table, data);
        continue;
      }
      const local = await getAll(table);
      if (table === "students") for (let i = 0; i < local.length; i += 1) local[i] = normalizeStudentRecord(local[i]);
      const serverById = new Map(data.map((record) => [record.id, record]));
      const merged = new Map(data.map((record) => [record.id, record]));
      for (const record of local) {
        const key = `${table}:${record.id}`;
        const serverRecord = serverById.get(record.id);
        if (!serverRecord) merged.set(record.id, record);
        if (roleCanWriteTable(table) && (!serverRecord || queuedIds.has(key) || record.updated_at > (serverRecord.updated_at || ""))) {
          merged.set(record.id, record);
          await new Promise((resolve, reject) => {
            const request = store("outbox", "readwrite").put({ id: key, table, record });
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error || new Error("Could not queue a local record for synchronization."));
          });
        }
      }
      await replaceAll(table, [...merged.values()]);
    }
    if (discardedUnconfirmedTransactions) {
      notify(`${discardedUnconfirmedTransactions} unconfirmed local transaction record(s) were not uploaded. Shared transaction history is taken from the school server.`, true);
    }
    await refresh();
  }

  async function fetchRemoteTable(table) {
    const pageSize = 500;
    const records = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await state.supabase.from(table).select("*").range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Could not sync ${table}: ${error.message}`);
      records.push(...data);
      if (data.length < pageSize) return records;
    }
  }

  async function flushOutbox() {
    if (!state.supabase || !state.session || state.syncing || !navigator.onLine) return;
    state.syncing = true;
    try {
      const pending = await getAll("outbox");
      const protectedTables = new Set(["loans", "textbook_allocations", "clearance_records"]);
      const syncableTables = new Set(["students", "books", "textbook_copies"]);
      if (pending.some((item) => protectedTables.has(item.table))) {
        throw new Error("A legacy transaction is waiting in the local queue. It was not uploaded because transaction history now requires server confirmation. Refresh the shared records and contact an administrator if a genuine transaction is missing.");
      }
      if (pending.some((item) => !syncableTables.has(item.table))) {
        throw new Error("The local queue contains an unsupported record type. It has been retained for administrator review.");
      }
      if (pending.some((item) => !roleCanWriteTable(item.table))) {
        throw new Error("Your current staff role cannot synchronize one or more pending records. Ask an administrator to review the queue.");
      }
      while (true) {
        const queued = await getAll("outbox");
        if (!queued.length) break;
        for (const table of ["students", "books", "textbook_copies"]) {
          const tableItems = queued.filter((item) => item.table === table && roleCanWriteTable(table));
          for (let offset = 0; offset < tableItems.length; offset += 100) {
            const batch = tableItems.slice(offset, offset + 100);
            const { error } = await state.supabase.from(table).upsert(batch.map((item) => item.record));
            if (error) throw new Error(`Could not synchronize ${table} records: ${error.message}`);
            await Promise.all(batch.map((item) => removeOutboxIfUnchanged(item)));
          }
        }
      }
      setSyncStatus("online", "Synchronized");
    } catch (error) {
      setSyncStatus("error", "Sync needs attention");
      notify(error.message || "Synchronization failed. Local records are retained.", true);
    } finally {
      state.syncing = false;
      if (state.remoteRefreshPending) {
        state.remoteRefreshPending = false;
        window.setTimeout(() => {
          synchronizeFromServer().then(flushOutbox).catch(reportSyncError);
        }, 0);
      }
    }
  }

  function subscribeToChanges() {
    if (!state.supabase || !state.session) return;
    if (state.channel) state.supabase.removeChannel(state.channel);
    const channel = state.supabase.channel("mhsk-bookstore-live");
    for (const table of ["students", "books", "loans", "textbook_copies", "textbook_allocations", "clearance_records"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        window.clearTimeout(state.remoteRefreshTimer);
        state.remoteRefreshTimer = window.setTimeout(() => {
          if (state.syncing) {
            state.remoteRefreshPending = true;
            return;
          }
          synchronizeFromServer().then(flushOutbox).catch(reportSyncError);
        }, 300);
      });
    }
    state.channel = channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("online", "Live sync");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncStatus("error", "Live sync unavailable");
    });
  }

  function reportSyncError(error) {
    setSyncStatus("error", "Sync needs attention");
    notify(error.message || "Synchronization failed.", true);
  }

  function setAuthFieldError(input, invalid) {
    if (!input) return;
    input.classList.toggle("auth-input-invalid", invalid);
    if (invalid) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function rejectAuth(message, fields = []) {
    const form = byId("auth-form");
    const errorBox = byId("auth-error");
    errorBox.textContent = message;
    for (const input of form.querySelectorAll('input[name="username"], input[name="password"]')) {
      setAuthFieldError(input, fields.includes(input.name));
    }
    form.classList.remove("auth-form-reject");
    // Restart the short rejection animation on repeated failed attempts.
    void form.offsetWidth;
    form.classList.add("auth-form-reject");
  }

  async function authenticate(event) {
    const form = event.currentTarget;
    if (event.submitter?.value === "cancel") {
      event.preventDefault();
      const dialog = byId("auth-dialog");
      if (dialog?.open) dialog.close("cancel");
      form.reset();
      byId("auth-error").textContent = "";
      setAuthFieldError(form.elements.namedItem("username"), false);
      setAuthFieldError(form.elements.namedItem("password"), false);
      form.classList.remove("auth-form-reject");
      return;
    }
    event.preventDefault();
    const data = new FormData(form);
    const usernameInput = form.elements.namedItem("username");
    const passwordInput = form.elements.namedItem("password");
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    const button = byId("auth-submit");
    const errorBox = byId("auth-error");
    const missing = [];
    if (!username) missing.push("username");
    if (!password) missing.push("password");
    if (missing.length) {
      rejectAuth("Enter your username and password.", missing);
      (missing[0] === "username" ? usernameInput : passwordInput).focus();
      return;
    }
    errorBox.textContent = "";
    setAuthFieldError(usernameInput, false);
    setAuthFieldError(passwordInput, false);
    form.classList.remove("auth-form-reject");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      if (!state.supabase) throw new Error("This installation has no Supabase configuration. Ask the administrator to configure bookstore/config.js.");
      const { data: loginData, error } = await state.supabase.functions.invoke("kbms-username-login", {
        body: { username, password },
      });
      if (error) {
        const detail = String(error.message || "");
        if (/invalid login credentials|invalid username or password|invalid credentials|unauthorized|\b401\b|\b400\b/i.test(detail) || [400, 401, 403].includes(error.context?.status)) {
          const message = "Incorrect username or password. Please try again.";
          rejectAuth(message, ["username", "password"]);
          passwordInput.focus();
          return;
        }
        throw error;
      }
      if (!loginData?.access_token || !loginData?.refresh_token) throw new Error("The sign-in service returned an invalid session.");
      const { data: authData, error: sessionError } = await state.supabase.auth.setSession({
        access_token: loginData.access_token, refresh_token: loginData.refresh_token,
      });
      if (sessionError) throw sessionError;
      state.sessionTask = startSessionSync(authData.session);
      if (state.sessionTask) await state.sessionTask;
      byId("auth-dialog").close();
      form.reset();
      notify("Signed in. Synchronizing school records.");
    } catch (error) {
      rejectAuth(error.message || "We couldn't sign you in. Check your connection and try again.", ["username", "password"]);
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  }

  async function changeTemporaryPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("new_password") || "");
    const confirmation = String(data.get("confirm_password") || "");
    const errorBox = byId("change-password-error");
    const button = byId("change-password-submit");
    errorBox.textContent = "";
    if (password.length < 12) { errorBox.textContent = "Use at least 12 characters."; return; }
    if (password !== confirmation) { errorBox.textContent = "The passwords do not match."; return; }
    button.disabled = true;
    try {
      const { error } = await state.supabase.auth.updateUser({
        password,
        data: { ...(state.session?.user?.user_metadata || {}), must_change_password: false },
      });
      if (error) throw error;
      byId("change-password-dialog").close();
      form.reset();
      notify("Your password has been changed.");
    } catch (error) {
      errorBox.textContent = error.message || "Password could not be changed.";
    } finally { button.disabled = false; }
  }

  function showAuthDialog() {
    if (!state.supabase) {
      notify("To enable multi-device sync, configure bookstore/config.js and the Supabase schema.", true);
      return;
    }
    byId("auth-dialog").showModal();
  }

  function navigate(page) {
    if (!PAGE_NAMES[page]) return;
    state.page = page;
    byId("page-name").textContent = PAGE_NAMES[page];
    document.querySelectorAll(".nav-item[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    history.replaceState(null, "", `#${page}`);
    refresh();
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.page) navigate(target.dataset.page);
    if (target.dataset.pageLink) navigate(target.dataset.pageLink);
    if (target.dataset.legal) showLegal(target.dataset.legal);
    if (target.dataset.mode) {
      state.circulationMode = target.dataset.mode;
      await renderCirculation();
    }
    if (target.dataset.inventoryView) {
      state.inventoryView = target.dataset.inventoryView;
      await renderInventory();
    }
    if (target.dataset.action === "add-book" && canManageLibrary()) await addBook();
    if (target.dataset.action === "import-books" && canManageLibrary()) {
      byId("csv-import").dataset.kind = "books";
      byId("csv-import").click();
    }
    if (target.dataset.action === "student-template" && canManageStudents()) downloadImportTemplate("students");
    if (target.dataset.action === "add-staff-account" && state.syncConfig) await provisionConnectedStaff();
    if (target.dataset.action === "add-academic-year" && state.syncConfig) await addConnectedAcademicYear();
    if (target.dataset.action === "add-academic-year" && !state.syncConfig) await addDemoAcademicYear();
    if (target.dataset.action === "add-school-class" && state.syncConfig && canManageYearSetup()) await addConnectedClass();
    if (target.dataset.action === "add-school-class" && !state.syncConfig && canManageYearSetup()) await addDemoClass();
    if (target.dataset.archiveYear && state.syncConfig && canArchiveAcademicYears()) await archiveConnectedAcademicYear(target.dataset.archiveYear);
    if (target.dataset.archiveYear && !state.syncConfig && canArchiveAcademicYears()) await archiveDemoAcademicYear(target.dataset.archiveYear);
    if (target.dataset.action === "add-school-subject" && state.syncConfig) await addConnectedSubject();
    if (target.dataset.action === "add-teacher-assignment" && state.syncConfig) await addConnectedTeacherAssignment();
    if (target.dataset.setCurrentYear && state.syncConfig) await setConnectedAcademicYear(target.dataset.setCurrentYear);
    if (target.dataset.setCurrentYear && !state.syncConfig) await setDemoCurrentAcademicYear(target.dataset.setCurrentYear);
    if (target.dataset.endStaffAssignment && state.syncConfig) await endConnectedTeacherAssignment(target.dataset.endStaffAssignment);
    if (target.dataset.action === "request-approval" && state.syncConfig) await createConnectedApprovalRequest();
    if (target.dataset.staffAction && state.syncConfig) await connectedStaffAction(target.dataset.staffAction, target.dataset.userId);
    if (target.dataset.approvalId && state.syncConfig) await decideConnectedApproval(target.dataset.approvalId, target.dataset.decision);
    if (target.dataset.action === "demo-add-assignment" && !state.syncConfig) await addDemoAssignment();
    if (target.dataset.action === "demo-request-approval" && !state.syncConfig) await createDemoApprovalRequest();
    if (target.dataset.endDemoAssignment && !state.syncConfig) await endDemoAssignment(target.dataset.endDemoAssignment);
    if (target.dataset.decideDemoApproval && !state.syncConfig) await decideDemoApproval(target.dataset.decideDemoApproval, target.dataset.decision);
    if (target.dataset.action === "import-students" && canManageStudents()) {
      byId("csv-import").dataset.kind = "students";
      byId("csv-import").click();
    }
    if (target.dataset.action === "add-textbook-copy" && canManageTextbookInventory()) await addTextbookCopy();
    if (target.dataset.action === "textbook-template" && canManageTextbookInventory()) downloadImportTemplate("textbooks");
    if (target.dataset.action === "import-textbook-copies" && canManageTextbookInventory()) {
      byId("csv-import").dataset.kind = "textbooks";
      byId("csv-import").click();
    }
    if (target.dataset.action === "bulk-allocate-textbooks" && canManageTextbookAllocations()) await bulkAllocateTextbooks();
    if (target.dataset.action === "load-demo-data" && !state.syncConfig) {
      if (window.confirm("Load fictional demo students and books into this empty browser workspace? This will not use real school data.")) {
        try { await loadFictionalDemoData(); } catch (error) { notify(error.message || "Demo records could not be loaded.", true); }
      }
    }
    if (target.dataset.action === "add-student" && canManageStudents()) await addStudent();
    if (target.dataset.action === "export-overdue") await exportOutstanding();
    if (target.dataset.action === "export-excel") await exportOutstandingExcel();
    if (target.dataset.action === "print-report") window.print();
    if (target.dataset.action === "quick-issue" && canManageLibrary()) {
      navigate("circulation");
      state.circulationMode = "issue";
      await renderCirculation();
      byId("circulation-form")?.elements.student.focus();
    }
    if (target.dataset.editBook && canManageLibrary()) {
      const book = (await getAll("books")).find((item) => item.id === target.dataset.editBook);
      if (book) await addBook(book);
    }
    if (target.dataset.editTextbook && canManageTextbookInventory()) {
      const copy = await getStoredRecord("textbook_copies", target.dataset.editTextbook);
      if (copy) await addTextbookCopy(copy);
    }
    if (target.dataset.allocateCopy && canManageTextbookAllocations()) await allocateTextbookCopy(target.dataset.allocateCopy);
    if (target.dataset.returnTextbook && canReturnTextbookAllocations()) await returnTextbookCopy(target.dataset.returnTextbook);
    if (target.dataset.clearance && canManageRecords()) await toggleClearance(target.dataset.clearance, target.dataset.clearanceDept);
    if (target.dataset.studentProfile) await showStudentProfile(target.dataset.studentProfile);
    if (target.dataset.departStudent) await recordStudentDeparture(target.dataset.departStudent);
    if (target.dataset.returnLoan && canManageLibrary()) await markReturned(target.dataset.returnLoan);
    if (target.id === "auth-button") {
      if (state.session) {
        const queued = await getAll("outbox");
        if (queued.length) {
          notify(`Sign-out paused: ${queued.length} change(s) are still waiting to synchronize. Resolve the sync issue first.`, true);
          return;
        }
        const { error } = await state.supabase.auth.signOut();
        if (error) notify(`Could not sign out: ${error.message}`, true);
      } else showAuthDialog();
    }
    if (target.id === "legal-close") byId("legal-dialog").close();
  });

  window.addEventListener("online", () => {
    if (state.syncConfig && !state.supabase) {
      connectSupabase();
    } else if (state.session) {
      setSyncStatus("pending", "Synchronizing");
      flushOutbox();
    } else if (!state.syncConfig) setSyncStatus("offline", "Local demo only");
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "mhsk-bookstore-sync" && state.session) flushOutbox();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    byId("install-button").hidden = false;
  });
  byId("install-button").addEventListener("click", async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    byId("install-button").hidden = true;
  });
  byId("auth-form").addEventListener("submit", authenticate);
  byId("auth-form").querySelectorAll('input[name="username"], input[name="password"]').forEach((input) => {
    input.addEventListener("input", () => {
      setAuthFieldError(input, false);
      byId("auth-error").textContent = "";
      byId("auth-form").classList.remove("auth-form-reject");
    });
  });
  byId("change-password-form").addEventListener("submit", changeTemporaryPassword);
  byId("change-password-dialog").addEventListener("cancel", (event) => event.preventDefault());
  byId("csv-import").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const kind = input.dataset.kind;
    input.value = "";
    if (!file || !["books", "students", "textbooks"].includes(kind)) return;
    try {
      const rows = await readImportRows(file);
      const count = Math.max(0, rows.length - 1);
      if (!count) throw new Error("The selected spreadsheet contains no data rows.");
      if (kind === "textbooks") {
        await importTextbookCopies({ name: file.name, size: file.size, __parsedRows: rows });
      } else {
        const label = kind === "students" ? "student" : "library book";
        if (!window.confirm(`Import ${count.toLocaleString()} possible ${label} row${count === 1 ? "" : "s"} from ${file.name}?\n\nAll rows will be validated first. If any row has an error or duplicate, nothing will be imported.`)) return;
        await importCsv({ name: file.name, size: file.size, __parsedRows: rows }, kind);
      }
    } catch (error) {
      notify(error.message || "The CSV could not be imported.", true);
    }
  });
  byId("legal-close").addEventListener("click", () => byId("legal-dialog").close());
  byId("today-label").textContent = localDate();
  byId("dialog-form").addEventListener("click", (event) => {
    if (event.target === byId("dialog-form") && event.target.value === "cancel") byId("form-dialog").close();
  });

  async function init() {
    if (!("indexedDB" in window)) {
      content.innerHTML = `<section class="panel panel-empty"><strong>This browser does not support offline storage</strong><p>Use a current version of Chrome, Edge, Safari or Firefox on a secure connection.</p></section>`;
      return;
    }
    try {
      state.db = await openDatabase();
      if ("serviceWorker" in navigator && window.isSecureContext) {
        navigator.serviceWorker.register("./sw.js").catch((error) => notify(`Offline cache could not be enabled: ${error.message}`, true));
      }
      const initialPage = location.hash.slice(1);
      navigate(PAGE_NAMES[initialPage] ? initialPage : "dashboard");
      await connectSupabase();
    } catch (error) {
      content.innerHTML = `<section class="panel panel-empty"><strong>Could not start the KBMS workspace</strong><p>${escapeHtml(error.message || "Check this browser's storage settings.")}</p></section>`;
      setSyncStatus("error", "Workspace unavailable");
    }
  }

  init();
})();
