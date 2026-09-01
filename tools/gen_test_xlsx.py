# -*- coding: utf-8 -*-
"""生成测试用 .xlsx（手写 XML + zipfile），模拟微信「个人对账」导出结构"""
import os
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


def build_xlsx(rows, date_cells=(), sheet_name="sheet1"):
    """rows: list[list[value]]；value 为 str(共享字符串) / (float|int)(数字) / ('inline', str)
    date_cells: {(r,c)} 这些单元格按日期样式输出（值需为 Excel 日期序列）"""
    shared, sindex = [], {}

    def sidx(s):
        if s not in sindex:
            sindex[s] = len(shared)
            shared.append(s)
        return sindex[s]

    def render_cell(r, c, v):
        ref = col_letter(c) + str(r + 1)
        if (r, c) in date_cells:
            return f'<c r="{ref}" s="1"><v>{v}</v></c>'
        if isinstance(v, tuple) and v[0] == "inline":
            return f'<c r="{ref}" t="inlineStr"><is><t>{esc(v[1])}</t></is></c>'
        if isinstance(v, str):
            return f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>'
        return f'<c r="{ref}"><v>{v}</v></c>'

    sheet_rows = []
    for r, row in enumerate(rows):
        cells = "".join(render_cell(r, c, v) for c, v in enumerate(row))
        sheet_rows.append(f'<row r="{r + 1}">{cells}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
    )
    sst_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f"<si><t>{esc(s)}</t></si>" for s in shared)
        + "</sst>"
    )
    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        "</cellXfs>"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
        'Target="sharedStrings.xml"/></Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>"
    )
    return {
        "[Content_Types].xml": content_types,
        "_rels/.rels": rels,
        "xl/workbook.xml": workbook_xml,
        "xl/_rels/workbook.xml.rels": wb_rels,
        "xl/styles.xml": styles_xml,
        "xl/sharedStrings.xml": sst_xml,
        "xl/worksheets/sheet1.xml": sheet_xml,
    }


def write_xlsx(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)


# ---------- 用例 1：微信样式，共享字符串 + 文本日期 ----------
rows1 = [
    ["微信支付账单明细"],
    ["微信昵称：[演示账号]"],
    ["起始日期：[2026-08-01] 终止日期：[2026-08-31]"],
    ["导出类型：[全部]"],
    ["----------------------微信支付账单明细列表--------------------"],
    ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"],
    ["2026-08-01 10:23:45", "商户消费", "瑞幸咖啡", "生椰拿铁", "支出", 22.6, "零钱", "支付成功", "4200000000000000001", "/", ""],
    ["2026-08-02 18:05:00", "商户消费", "深圳地铁", "乘车码", "支出", 4.0, "零钱", "支付成功", "4200000000000000002", "/", ""],
    ["2026-08-03 09:00:00", "转账", "妈妈", "/生活费", "收入", 1500.0, "零钱", "已收钱", "4200000000000000003", "/", ""],
    ["2026-08-04 12:30:00", "商户消费", "测试退款店", "商品", "支出", 35.0, "零钱", "已全额退款", "4200000000000000004", "/", "测试无效交易"],
]
write_xlsx(os.path.join(OUT, "wechat_shared_text.xlsx"), build_xlsx(rows1))
print("wrote wechat_shared_text.xlsx")

# ---------- 用例 2：Excel 原生日期序列（含日期样式） ----------
# 2026-08-01 12:00:00 序列号：45292.5（1899-12-30 基准）
def serial(y, m, d, h=0, mi=0, s=0):
    import datetime
    base = datetime.date(1899, 12, 30)
    days = (datetime.date(y, m, d) - base).days
    return days + (h * 3600 + mi * 60 + s) / 86400.0


rows2 = [
    ["微信支付账单明细"],
    ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态"],
    [serial(2026, 8, 1, 12, 0), "商户消费", "美团外卖", "午餐订单", "支出", 25.5, "零钱", "支付成功"],
    [serial(2026, 8, 2, 8, 30, 15), "商户消费", "哈啰单车", "骑行", "支出", 2.5, "零钱", "支付成功"],
    [serial(2026, 8, 3, 20, 0), "转账", "导师", "助研津贴", "收入", 1200.0, "零钱", "已收钱"],
]
date_cells2 = {(2, 0), (3, 0), (4, 0)}  # 数据行的 A 列是日期
write_xlsx(os.path.join(OUT, "wechat_serial_dates.xlsx"), build_xlsx(rows2, date_cells2))
print("wrote wechat_serial_dates.xlsx")

# ---------- 用例 3：内联字符串（inlineStr） ----------
rows3 = [
    ["交易时间", "金额(元)", "交易对方", "商品", "收/支"],
    [("inline", "2026-08-05 14:00:00"), ("inline", 12.8), ("inline", "测试小店"), ("inline", "商品A"), ("inline", "支出")],
    [("inline", "2026-08-06 15:30:00"), ("inline", 8.8), ("inline", "测试小店2"), ("inline", "商品B"), ("inline", "支出")],
]
write_xlsx(os.path.join(OUT, "generic_inline.xlsx"), build_xlsx(rows3))
print("wrote generic_inline.xlsx")
