"""Generates the HTML shells for AbsenInn pages so <head>, script order
and body attributes stay consistent. Run: python3 tools/build_pages.py
Page logic lives in frontend/js/pages/<role>/<page>.js."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "frontend"
CHART_CDN = '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js" defer></script>'

# (page, title, extra script groups)
PAGES = {
    "owner": [
        ("dashboard", "Dashboard", ["charts"]), ("employees", "Employees", ["employees"]),
        ("employee-detail", "Employee Detail", ["charts", "employees", "payroll"]),
        ("attendance", "Attendance", []), ("leave", "Leave Management", []), ("tasks", "Task Management", []),
        ("payroll", "Payroll", ["charts", "payroll"]), ("analytics", "Performance Analytics", ["charts"]),
        ("reports", "Reports", []), ("notifications", "Notifications", []), ("settings", "Settings", ["geo"]),
    ],
    "employee": [
        ("dashboard", "My Dashboard", ["attend", "payroll"]), ("profile", "My Profile", []), ("attendance", "My Attendance", ["attend"]),
        ("leave", "My Leave", []), ("tasks", "My Tasks", []), ("payslip", "My Payslip", ["payroll"]),
        ("notifications", "Notifications", []), ("announcements", "Announcements", []),
    ],
}
GROUPS = {
    "charts": ["js/core/charts.js"],
    "employees": ["js/employees.js"],
    "payroll": ["js/payroll.js"],
    "geo": ["js/location.js"],
    "attend": ["js/camera.js", "js/location.js", "js/attendance.js"],
}

CORE = ["js/config.js", "js/core/icons.js", "js/core/format.js", "js/core/store.js", "js/core/ui.js",
        "js/auth.js", "js/api.js", "js/core/layout.js", "js/core/metrics.js"]

TEMPLATE = """<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cure">
  <meta name="theme-color" content="#6C55F2">
  <title>{title} · AbsenInn</title>
  <link rel="icon" type="image/svg+xml" href="../assets/icons/favicon.svg">
  <link rel="stylesheet" href="../css/style.css">
  <link rel="stylesheet" href="../css/components.css">
  <link rel="stylesheet" href="../css/dashboard.css">
  <link rel="stylesheet" href="../css/responsive.css">
  {cdn}
</head>
<body data-root="../" data-role="{role}" data-page="{page}">
  <main id="content" class="content" tabindex="-1"></main>
{scripts}
</body>
</html>
"""


def build():
    for role, pages in PAGES.items():
        for page, title, extra in pages:
            scripts = list(CORE)
            for g in extra:
                scripts += [x for x in GROUPS[g] if x not in scripts]
            scripts.append(f"js/pages/{role}/{page}.js")
            html = TEMPLATE.format(
                title=title, role=role, page=page,
                cdn=CHART_CDN if "charts" in extra else "",
                scripts="\n".join(f'  <script src="../{s}" defer></script>' for s in scripts),
            ).replace("viewport-fit=cure", "viewport-fit=cover").replace("\n  \n", "\n")
            (ROOT / role / f"{page}.html").write_text(html, encoding="utf-8")
            print("wrote", f"{role}/{page}.html")


if __name__ == "__main__":
    build()
