/* =========================================================
   xlsx.js —— 极简 .xlsx 解析（零依赖，浏览器本地完成）
   xlsx 本质是 zip：读取 sharedStrings / sheet / styles 三个 XML，
   DEFLATE 解压用浏览器内置 DecompressionStream。
   支持：共享字符串、内联字符串、数字、Excel 日期序列（含日期样式）。
   ========================================================= */

function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
function readU32(b, o) { return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0); }

/** 从 zip 字节中解出指定路径的条目内容 */
async function unzipEntry(bytes, entryPath) {
  // 定位 EOCD（从文件尾往前找）
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 Excel(.xlsx) 文件");

  const totalEntries = readU16(bytes, eocd + 10);
  const cdOffset = readU32(bytes, eocd + 16);

  let p = cdOffset;
  let found = null;
  for (let n = 0; n < totalEntries; n++) {
    if (readU32(bytes, p) !== 0x02014b50) break;
    const method = readU16(bytes, p + 10);
    const compSize = readU32(bytes, p + 20);
    const nameLen = readU16(bytes, p + 28);
    const extraLen = readU16(bytes, p + 30);
    const commentLen = readU16(bytes, p + 32);
    const localOff = readU32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === entryPath || name.endsWith("/" + entryPath)) {
      found = { method, compSize, localOff };
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!found) throw new Error("Excel 文件里缺少 " + entryPath);

  const nameLen2 = readU16(bytes, found.localOff + 26);
  const extraLen2 = readU16(bytes, found.localOff + 28);
  const dataStart = found.localOff + 30 + nameLen2 + extraLen2;
  const raw = bytes.subarray(dataStart, dataStart + found.compSize);

  if (found.method === 0) return raw; // 未压缩
  if (found.method === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解析 Excel，请升级 Chrome/Edge/Safari，或把 Excel 另存为 CSV");
    }
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("Excel 使用了不支持的压缩方式 (" + found.method + ")");
}

function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function extractSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[1]))) text += xmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}

/** 样式 → 是否日期：内建日期 numFmtId + 自定义含 y/m/d/h/s 的格式 */
function extractDateStyles(stylesXml) {
  const dateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51]);
  const fmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m;
  while ((m = fmtRe.exec(stylesXml))) {
    const code = m[2];
    if (/[ymdhs]/.test(code)) dateIds.add(Number(m[1]));
  }
  const isDate = new Map();
  // 只在 cellXfs 段内按顺序计数（cellStyleXfs 里的 xf 不占 cellXfs 索引）
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return isDate;
  const xfRe = /<xf\b[^>]*numFmtId="(\d+)"[^>]*\/?>/g;
  let i = 0;
  while ((m = xfRe.exec(cellXfs[1]))) {
    isDate.set(i, dateIds.has(Number(m[1])));
    i++;
  }
  return isDate;
}

/** Excel 日期序列（墙上时间）→ "YYYY-MM-DD HH:MM:SS"（用 UTC 分量读取） */
function excelSerialToStr(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  if (isNaN(d)) return String(serial);
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function colIndex(colStr) {
  let n = 0;
  for (let i = 0; i < colStr.length; i++) n = n * 26 + (colStr.charCodeAt(i) - 64);
  return n - 1;
}

/** 把 sheet XML 变成二维字符串网格 */
function extractSheetGrid(sheetXml, shared, dateStyles) {
  const cells = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm, fallbackRow = 0;
  while ((rm = rowRe.exec(sheetXml))) {
    const rowAttr = rm[0].match(/<row\b[^>]*r="(\d+)"/);
    const rowIdx = rowAttr ? Number(rowAttr[1]) - 1 : fallbackRow;
    fallbackRow = rowIdx + 1;

    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm, fallbackCol = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || "";
      const body = cm[2] || "";
      const rMatch = attrs.match(/r="([A-Z]+)(\d+)"/);
      const tMatch = attrs.match(/t="([^"]+)"/);
      const sMatch = attrs.match(/s="(\d+)"/);
      const t = tMatch ? tMatch[1] : null;
      const style = sMatch ? Number(sMatch[1]) : null;

      let value = "";
      const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      if (t === "s" && vMatch) {
        value = shared[Number(vMatch[1])] || "";
      } else if (t === "inlineStr") {
        const is = body.match(/<is>([\s\S]*?)<\/is>/);
        if (is) {
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          let tm;
          while ((tm = tRe.exec(is[1]))) value += xmlUnescape(tm[1]);
        }
      } else if (t === "str" && vMatch) {
        value = xmlUnescape(vMatch[1]);
      } else if (vMatch) {
        const num = Number(vMatch[1]);
        if (!isNaN(num) && vMatch[1].trim() !== "") {
          if (style !== null && dateStyles.get(style)) value = excelSerialToStr(num);
          else value = vMatch[1];
        } else {
          value = xmlUnescape(vMatch[1]);
        }
      }
      // 空单元格也保留列位（Excel 通常带 r 属性）
      const col = rMatch ? colIndex(rMatch[1]) : fallbackCol;
      fallbackCol = col + 1;
      cells.push({ row: rowIdx, col, value });
    }
  }

  let maxRow = 0, maxCol = 0;
  cells.forEach(c => {
    maxRow = Math.max(maxRow, c.row);
    maxCol = Math.max(maxCol, c.col);
  });
  const grid = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(""));
  cells.forEach(c => { grid[c.row][c.col] = c.value; });
  return grid;
}

/** .xlsx 字节 → 二维字符串网格 */
async function xlsxToGrid(bytes) {
  const [sheetXml, sharedXml, stylesXml] = await Promise.all([
    unzipEntry(bytes, "xl/worksheets/sheet1.xml").then(b => new TextDecoder().decode(b)),
    unzipEntry(bytes, "xl/sharedStrings.xml").then(b => new TextDecoder().decode(b)).catch(() => ""),
    unzipEntry(bytes, "xl/styles.xml").then(b => new TextDecoder().decode(b)).catch(() => ""),
  ]);
  const shared = sharedXml ? extractSharedStrings(sharedXml) : [];
  const dateStyles = stylesXml ? extractDateStyles(stylesXml) : new Map();
  return extractSheetGrid(sheetXml, shared, dateStyles);
}
