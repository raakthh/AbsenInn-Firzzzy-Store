"""JSON renderer: money/decimals are emitted as JSON numbers (the frontend
sums them with ``+``), dates as ISO strings, times as ``HH:MM``."""
import datetime as dt
import decimal
import json
import uuid

from rest_framework.renderers import JSONRenderer


def to_jsonable(o):
    if isinstance(o, decimal.Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, dt.datetime):
        return o.isoformat()
    if isinstance(o, dt.date):
        return o.isoformat()
    if isinstance(o, dt.time):
        return o.strftime("%H:%M")
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, (set, tuple)):
        return list(o)
    raise TypeError(f"Not JSON serializable: {type(o)!r}")


class AppJSONRenderer(JSONRenderer):
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return b""
        return json.dumps(data, default=to_jsonable, ensure_ascii=False).encode("utf-8")
