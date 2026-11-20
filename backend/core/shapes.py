"""Small shared output shapes (the frontend expects the same field names the
Phase 1 demo layer produced)."""


def pick_emp(e):
    if e is None:
        return None
    return {"id": e.id, "full_name": e.full_name, "position": e.position, "employee_code": e.employee_code,
            "avatar_color": e.avatar_color, "photo_url": None, "employment_status": e.employment_status}


def num(v):
    """Decimal/None → float-or-int for arithmetic in Python code paths."""
    if v is None:
        return 0
    f = float(v)
    return int(f) if f.is_integer() else f
