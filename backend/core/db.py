"""Expose the acting user to database triggers.

Some triggers (e.g. app.log_task_change → task_history) record ``auth.uid()``.
Django connects with a trusted role, so we set the same setting Supabase
PostgREST uses (``request.jwt.claim.sub``) — transaction-local — for the
duration of the block, then clear it again."""
from contextlib import contextmanager

from django.db import connection


@contextmanager
def db_actor(user):
    with connection.cursor() as c:
        c.execute("select set_config('request.jwt.claim.sub', %s, true)", [str(user.profile.id)])
    try:
        yield
    finally:
        with connection.cursor() as c:
            c.execute("select set_config('request.jwt.claim.sub', '', true)")
