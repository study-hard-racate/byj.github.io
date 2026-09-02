# -*- coding: utf-8 -*-
"""生成额外测试数据：多 sheet xlsx / deflate 各块类型 / 假 .xls"""
import os
import random
import zlib
import zipfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "testdata")
os.makedirs(OUT, exist_ok=True)


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def col_letter(n):
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def make_xlsx(sheets_rows, sheet_names=None):
    """sheets_rows: list of row-lists（每张表）。共享字符串跨表合并。"""
    shared, sindex = [], {}

    def sidx(s):
        if s not in sindex:
            sindex[s] = len(shared)
            shared.append(s)
        return sindex[s]

    def render_cell(r, c, v):
        ref = col_letter(c) + str(r + 1)
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>'

    sheet_files = {}
    for si, rows in enumerate(sheets_rows, start=1):
        srows = []
        for r, row in enumerate(rows):
            cells = "".join(render_cell(r, c, v) for c, v in enumerate(row))
            srows.append(f'<row r="{r + 1}">{cells}</row>')
        sheet_files[f"xl/worksheets/sheet{si}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{''.join(srows)}</sheetData></worksheet>"
        )

    names = sheet_names or [f"Sheet{i}" for i in range(1, len(sheets_rows) + 1)]
    wb_sheets = "".join(
        f'<sheet name="{esc(names[i])}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
        for i in range(len(sheets_rows)))
    wb_rels = "".join(
        f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
        for i in range(len(sheets_rows)))
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(len(sheets_rows)))

    sst_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f"<si><t>{esc(s)}</t></si>" for s in shared) + "</sst>"
    )
    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<numFmts count="0"/>'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + overrides
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f"<sheets>{wb_sheets}</sheets></workbook>"
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + wb_rels
            + '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            + '<Relationship Id="rId98" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
            + "</Relationships>"
        ),
        "xl/styles.xml": styles_xml,
        "xl/sharedStrings.xml": sst_xml,
        **sheet_files,
    }
    return files


def write_xlsx(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)


# ---------- 多 sheet：数据在第 2 张表 ----------
sheet1 = [["封面页"], ["这是说明页"]]
sheet2 = [
    ["微信支付账单明细"],
    ["交易时间", "交易对方", "商品", "收/支", "金额(元)", "当前状态"],
    ["2026-08-10 09:30:00", "测试多表商户", "商品X", "支出", 66.6, "支付成功"],
    ["2026-08-11 10:00:00", "测试多表收入", "劳务", "收入", 300.0, "已收钱"],
]
write_xlsx(os.path.join(OUT, "multisheet.xlsx"), make_xlsx([sheet1, sheet2], ["封面", "微信账单"]))
print("wrote multisheet.xlsx")

# ---------- deflate 原始流（wbits=-15），覆盖 stored/fixed/dynamic ----------
def raw_deflate(data, level=6):
    co = zlib.compressobj(level=level, wbits=-15)
    return co.compress(data) + co.flush()

random.seed(7)
cases = {
    "dynamic_text": ("交易时间,交易对方,金额(元),收/支\n" * 60).encode("utf-8"),
    "fixed_repeat": b"A" * 8000,
    "stored_random": bytes(random.randrange(256) for _ in range(3000)),
    "small": b"abc",
}
for name, data in cases.items():
    with open(os.path.join(OUT, f"deflate_{name}.orig"), "wb") as f:
        f.write(data)
    with open(os.path.join(OUT, f"deflate_{name}.bin"), "wb") as f:
        f.write(raw_deflate(data))
    print(f"wrote deflate_{name} (orig={len(data)}, deflated={len(raw_deflate(data))})")

# ---------- 假 .xls（OLE2 文件头） ----------
with open(os.path.join(OUT, "fake_old.xls"), "wb") as f:
    f.write(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b"\x00" * 64)
print("wrote fake_old.xls")
