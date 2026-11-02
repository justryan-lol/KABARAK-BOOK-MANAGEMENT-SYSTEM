(function (root) {
  "use strict";

  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[n] = value >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(value) { return [value & 0xff, (value >>> 8) & 0xff]; }
  function u32(value) { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }
  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }
  function xmlEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  }
  function columnName(index) {
    let name = "";
    while (index > 0) { const remainder = (index - 1) % 26; name = String.fromCharCode(65 + remainder) + name; index = Math.floor((index - 1) / 26); }
    return name;
  }

  function zipStore(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const filename = encoder.encode(name);
      const data = encoder.encode(content);
      const checksum = crc32(data);
      const local = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]), new Uint8Array(u16(20)), new Uint8Array(u16(0x0800)),
        new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u32(checksum)),
        new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
        new Uint8Array(u16(filename.length)), new Uint8Array(u16(0)), filename, data,
      ]);
      localParts.push(local);
      const central = concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]), new Uint8Array(u16(20)), new Uint8Array(u16(20)),
        new Uint8Array(u16(0x0800)), new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u16(0)),
        new Uint8Array(u32(checksum)), new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
        new Uint8Array(u16(filename.length)), new Uint8Array(u16(0)), new Uint8Array(u16(0)),
        new Uint8Array(u16(0)), new Uint8Array(u16(0)), new Uint8Array(u32(0)), new Uint8Array(u32(offset)), filename,
      ]);
      centralParts.push(central);
      offset += local.length;
    }
    const centralDirectory = concat(centralParts);
    const localData = concat(localParts);
    const count = centralParts.length;
    const end = concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]), new Uint8Array(u16(0)), new Uint8Array(u16(0)),
      new Uint8Array(u16(count)), new Uint8Array(u16(count)), new Uint8Array(u32(centralDirectory.length)),
      new Uint8Array(u32(localData.length)), new Uint8Array(u16(0)),
    ]);
    return concat([localData, centralDirectory, end]);
  }

  function safeSheetName(value, index, used) {
    const base = String(value || `Sheet ${index + 1}`).replace(/[\\/*?:\[\]]/g, " ").trim().slice(0, 31) || `Sheet ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const ending = ` ${suffix++}`;
      name = `${base.slice(0, 31 - ending.length)}${ending}`;
    }
    used.add(name.toLowerCase());
    return name;
  }

  function worksheetXml(rows) {
    if (!Array.isArray(rows) || rows.length > 1048576) throw new Error("The Excel export has too many rows.");
    const sheetRows = rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length > 16384) throw new Error("The Excel export contains an invalid row.");
      const cells = row.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
        return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  }

  function buildXlsxWorkbook(sheets) {
    if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > 50) throw new Error("An Excel workbook needs between 1 and 50 worksheets.");
    const used = new Set();
    const normalized = sheets.map((sheet, index) => ({
      name: safeSheetName(sheet?.name, index, used),
      rows: sheet?.rows,
    }));
    const files = {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + normalized.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + '</Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${normalized.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${normalized.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`,
    };
    normalized.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(sheet.rows); });
    return zipStore(files);
  }

  function buildXlsx(rows, sheetName = "Follow-up") {
    return buildXlsxWorkbook([{ name: sheetName, rows }]);
  }

  function downloadXlsx(rows, filename = "kabarak-book-audit.xlsx", sheetName = "Follow-up") {
    const bytes = buildXlsx(rows, sheetName);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadXlsxWorkbook(sheets, filename = "kabarak-book-audit.xlsx") {
    const bytes = buildXlsxWorkbook(sheets);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const api = { buildXlsx, buildXlsxWorkbook, downloadXlsx, downloadXlsxWorkbook };
  root.KBMSXlsxExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
