/* =========================================================
   xlsx.js —— 极简 .xlsx 解析（零依赖，浏览器本地完成）
   xlsx 本质是 zip：读取 sharedStrings / sheet / styles 等 XML，
   解压优先用浏览器 DecompressionStream，老浏览器退回纯 JS inflate。
   支持：共享字符串、内联字符串、数字、Excel 日期序列（含日期样式）、多 sheet。
   ========================================================= */

function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
function readU32(b, o) { return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0); }

/* ---------- 纯 JS DEFLATE 解压（RFC 1951），兼容老浏览器 ---------- */
function inflateRaw(data) {
  let pos = 0, bitbuf = 0, bitcnt = 0;
  const bits = (n) => {
    while (bitcnt < n) { bitbuf |= data[pos++] << bitcnt; bitcnt += 8; }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n; bitcnt -= n;
    return v;
  };
  const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEN_EXT =  [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DIST_EXT =  [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

  function huffmanDecoder(lengths) {
    const maxBits = Math.max.apply(null, lengths);
    const blCount = new Array(maxBits + 1).fill(0);
    lengths.forEach(l => { if (l) blCount[l]++; });
    let code = 0;
    const nextCode = new Array(maxBits + 1);
    for (let b = 1; b <= maxBits; b++) {
      code = (code + blCount[b - 1]) << 1;
      nextCode[b] = code;
    }
    const flat = [];
    lengths.forEach((l, s) => { if (l) flat.push([l, s]); });
    flat.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const firstIdx = new Array(maxBits + 1).fill(-1);
    let idx = 0;
    for (let b = 1; b <= maxBits; b++) {
      if (blCount[b]) { firstIdx[b] = idx; idx += blCount[b]; }
    }
    return function decode() {
      let c = 0;
      for (let len = 1; len <= maxBits; len++) {
        c = (c << 1) | bits(1);
        if (blCount[len] && c - nextCode[len] < blCount[len]) {
          return flat[firstIdx[len] + (c - nextCode[len])][1];
        }
      }
      throw new Error("DEFLATE: 无效的 Huffman 码");
    };
  }

  const fixedLens = new Array(288).fill(0);
  for (let i = 0; i < 144; i++) fixedLens[i] = 8;
  for (let i = 144; i < 256; i++) fixedLens[i] = 9;
  for (let i = 256; i < 280; i++) fixedLens[i] = 7;
  for (let i = 280; i < 288; i++) fixedLens[i] = 8;
  const fixedDist = new Array(30).fill(5);

  const out = [];
  let litDec = null, distDec = null, final = false;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0; // 跳到字节边界
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4; // len + nlen（忽略校验）
      if (pos + len > data.length) throw new Error("DEFLATE: 数据截断");
      for (let i = 0; i < len; i++) out.push(data[pos + i]);
      pos += len;
    } else {
      if (type === 1) {
        litDec = huffmanDecoder(fixedLens);
        distDec = huffmanDecoder(fixedDist);
      } else if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        const clLens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clLens[order[i]] = bits(3);
        const clDec = huffmanDecoder(clLens);
        const lens = [];
        while (lens.length < hlit + hdist) {
          const sym = clDec();
          if (sym < 16) lens.push(sym);
          else if (sym === 16) {
            const prev = lens.length ? lens[lens.length - 1] : 0;
            const rep = 3 + bits(2);
            for (let i = 0; i < rep; i++) lens.push(prev);
          } else if (sym === 17) {
            const rep = 3 + bits(3);
            for (let i = 0; i < rep; i++) lens.push(0);
          } else {
            const rep = 11 + bits(7);
            for (let i = 0; i < rep; i++) lens.push(0);
          }
        }
        litDec = huffmanDecoder(lens.slice(0, hlit));
        distDec = huffmanDecoder(lens.slice(hlit));
      } else {
        throw new Error("DEFLATE: 无效的块类型");
      }
      for (;;) {
        const sym = litDec();
        if (sym === 256) break;
        if (sym < 256) { out.push(sym); continue; }
        const li = sym - 257;
        const len = LEN_BASE[li] + (LEN_EXT[li] ? bits(LEN_EXT[li]) : 0);
        const di = distDec();
        const dist = DIST_BASE[di] + (DIST_EXT[di] ? bits(DIST_EXT[di]) : 0);
        if (dist > out.length) throw new Error("DEFLATE: 距离越界");
        for (let i = 0; i < len; i++) out.push(out[out.length - dist]);
      }
    }
  }
  return new Uint8Array(out);
}

/** 解压 DEFLATE：优先浏览器原生，失败退回纯 JS */
async function inflateRawAsync(raw) {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { /* 退回纯 JS */ }
  }
  return inflateRaw(raw);
}

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
  if (found.method === 8) return await inflateRawAsync(raw);
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

/** 从 workbook.xml + rels 解析出按顺序排列的工作表路径列表 */
function listWorksheetPaths(wbXml, wbRelsXml) {
  if (!wbXml) return [];
  const rels = new Map();
  if (wbRelsXml) {
    const relRe = /<Relationship\b[^>]*\/?>/g;
    let m;
    while ((m = relRe.exec(wbRelsXml))) {
      const id = m[0].match(/\sId="([^"]+)"/);
      const target = m[0].match(/\sTarget="([^"]+)"/);
      const type = m[0].match(/\sType="([^"]+)"/) || "";
      if (id && target && type && type[1].includes("/worksheet")) {
        rels.set(id[1], target[1]);
      }
    }
  }
  const sheets = [];
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let m;
  while ((m = sheetRe.exec(wbXml))) {
    const rid = m[0].match(/\sr:id="([^"]+)"/);
    if (rid && rels.has(rid[1])) sheets.push(rels.get(rid[1]));
  }
  return sheets;
}

/** 挑选「看起来像账单」的那个 sheet（含金额/时间关键词，行数较多者优先） */
function pickDataGrid(grids) {
  if (grids.length === 1) return grids[0];
  let best = grids[0] || [];
  let bestScore = -1;
  grids.forEach(g => {
    const text = g.slice(0, 30).map(r => r.join(",")).join(" ");
    const score = (/金额|amount/i.test(text) ? 4 : 0) +
                  (/时间|日期|date/i.test(text) ? 4 : 0) + g.length;
    if (score > bestScore) { bestScore = score; best = g; }
  });
  return best;
}

/** .xlsx 字节 → 二维字符串网格（支持多 sheet，自动挑账单所在的表） */
async function xlsxToGrid(bytes) {
  const [wbXml, wbRelsXml, sharedXml, stylesXml] = await Promise.all([
    unzipEntry(bytes, "xl/workbook.xml").then(b => new TextDecoder().decode(b)).catch(() => ""),
    unzipEntry(bytes, "xl/_rels/workbook.xml.rels").then(b => new TextDecoder().decode(b)).catch(() => ""),
    unzipEntry(bytes, "xl/sharedStrings.xml").then(b => new TextDecoder().decode(b)).catch(() => ""),
    unzipEntry(bytes, "xl/styles.xml").then(b => new TextDecoder().decode(b)).catch(() => ""),
  ]);
  const shared = sharedXml ? extractSharedStrings(sharedXml) : [];
  const dateStyles = stylesXml ? extractDateStyles(stylesXml) : new Map();

  let paths = listWorksheetPaths(wbXml, wbRelsXml).map(p => {
    // rels 里的 Target 相对 xl/ 目录
    return p.startsWith("/") ? p.slice(1) : "xl/" + p.replace(/^\//, "");
  });
  if (!paths.length) paths = ["xl/worksheets/sheet1.xml"];

  const grids = [];
  for (const p of paths.slice(0, 10)) {
    try {
      const xml = new TextDecoder().decode(await unzipEntry(bytes, p));
      grids.push(extractSheetGrid(xml, shared, dateStyles));
    } catch (e) { /* 跳过打不开的 sheet */ }
  }
  if (!grids.length) throw new Error("Excel 里没有可读取的工作表");
  return pickDataGrid(grids);
}
