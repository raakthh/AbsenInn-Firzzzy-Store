"""Concatenate database/migrations/*.sql into database/schema.sql (one-paste setup for Supabase SQL Editor).
Run: python3 tools/build_schema.py"""
from pathlib import Path
db = Path(__file__).resolve().parent.parent / "database"
parts = sorted((db / "migrations").glob("*.sql"))
header = "-- AbsenInn · schema.sql — GENERATED from database/migrations/*.sql (do not edit by hand)\n-- Run once in Supabase → SQL Editor. Safe to re-run.\n\nset client_min_messages = warning;\n\n"
(db / "schema.sql").write_text(header + "\n\n".join(f"-- >>> {p.name}\n" + p.read_text() for p in parts), encoding="utf-8")
print("schema.sql built from", [p.name for p in parts])
