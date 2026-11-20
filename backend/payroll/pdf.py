"""Server-side payslip PDF (ReportLab, A5 portrait)."""
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .engine import fmt_d, fmt_rp

INDIGO = colors.HexColor("#6C55F2")
NAVY = colors.HexColor("#17153B")
MUTED = colors.HexColor("#5B6182")
LINE = colors.HexColor("#E4E6F1")


def _p(text, size=8.5, color=NAVY, bold=False, align=0):
    return Paragraph(text, ParagraphStyle("x", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size, leading=size * 1.35,
                                          textColor=color, alignment=align))


def _esc(s):
    return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_payslip(item, company, period_label):
    """``item`` is the dict from services.item_out (+ payment)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A5, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                            title=f"Slip Gaji {period_label} - {item['employee']['full_name']}", author=company.name)
    emp = item["employee"]
    story = [
        Table([[_p(f"<b>{_esc(company.name)}</b>", 12), _p("SLIP GAJI", 12, INDIGO, True, 2)],
               [_p(_esc(company.address or ""), 7.5, MUTED), _p(_esc(period_label), 9, NAVY, True, 2)]],
              colWidths=["62%", "38%"], style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]),
        Spacer(1, 4 * mm),
        Table([[_p("Nama", 8, MUTED), _p(f"<b>{_esc(emp['full_name'])}</b>"), _p("Periode kerja", 8, MUTED), _p(f"{fmt_d(item['cycle_start'])} – {fmt_d(item['cycle_end'])}")],
               [_p("Kode", 8, MUTED), _p(f"{_esc(emp['employee_code'])} · {_esc(emp['position'])}"), _p("Tanggal bayar", 8, MUTED), _p(fmt_d(item["payment_date"]))]],
              colWidths=["16%", "36%", "20%", "28%"],
              style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F6FE")), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                     ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]),
        Spacer(1, 4 * mm),
    ]
    rows = [[_p("<b>Pendapatan</b>", 9, INDIGO), ""], [_p("Gaji pokok"), _p(fmt_rp(item["basic_salary"]), align=2)]]
    rows += [[_p(_esc(a["name"])), _p(fmt_rp(a["amount"]), align=2)] for a in item["allowances"]]
    if item["bonus"]:
        rows.append([_p("Bonus"), _p(fmt_rp(item["bonus"]), align=2)])
    if item["incentives"]:
        rows.append([_p("Insentif"), _p(fmt_rp(item["incentives"]), align=2)])
    rows.append([_p(f"Lembur ({item['overtime_hours']} jam)"), _p(fmt_rp(item["overtime_amount"]), align=2)])
    rows += [[_p(f"Tambahan: {_esc(a['name'])}"), _p(fmt_rp(a["amount"]), align=2)] for a in item["adjustments"] if a["type"] == "addition"]
    ded = [d for d in item["deductions"] if d["amount"]] + [{"name": f"Potongan: {a['name']}", "amount": a["amount"]} for a in item["adjustments"] if a["type"] == "deduction"]
    if ded:
        rows.append([_p("<b>Potongan</b>", 9, colors.HexColor("#D93D5C")), ""])
        rows += [[_p(_esc(d["name"])), _p(("−" if d["amount"] > 0 else "+") + fmt_rp(abs(d["amount"])), color=colors.HexColor("#D93D5C"), align=2)] for d in ded]
    t = Table(rows, colWidths=["68%", "32%"])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [t, Spacer(1, 3 * mm),
              Table([[_p("<b>Gaji bersih</b>", 10, colors.white), _p(f"<b>{fmt_rp(item['net_salary'])}</b>", 12, colors.white, align=2)]],
                    colWidths=["50%", "50%"], style=[("BACKGROUND", (0, 0), (-1, -1), INDIGO), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]),
              Spacer(1, 3 * mm)]
    pay = item.get("payment")
    status = (f"Status: <b>DIBAYAR</b> — {fmt_d(pay['paid_at'].date() if hasattr(pay['paid_at'], 'date') else pay['paid_at'])} via {_esc(pay['method'])}"
              + (f" (ref. {_esc(pay['reference'])})" if pay.get("reference") else "")) if pay else "Status: <b>belum dibayar</b> — menunggu konfirmasi transfer dari owner."
    story += [_p(status, 8, MUTED)]
    if item.get("calc_note"):
        story += [Spacer(1, 1.5 * mm), _p(_esc(item["calc_note"]), 7, MUTED)]
    story += [Spacer(1, 5 * mm), _p("Dokumen ini bersifat rahasia dan hanya untuk karyawan yang bersangkutan. Dibuat otomatis oleh AbsenInn.", 6.5, MUTED)]
    doc.build(story)
    return buf.getvalue()
