"""Tool source dispatch and isolated import worker; legacy Fusion parser is unchanged."""
import sys
from freecad_import import _json, decode_freecad_blob, parse_freecad_data
from fusion_import import parse_fusion_library


def decode_tool_blob(raw, unit):
    if raw.startswith(b'PK'):
        return decode_freecad_blob(raw, unit)
    data = _json(raw)
    if isinstance(data, dict) and isinstance(data.get('data'), list):
        return parse_fusion_library(data, unit)
    return parse_freecad_data(data, unit)


def main():
    import msgspec
    try:
        ctx = msgspec.msgpack.decode(sys.stdin.buffer.read())
        parsed, skipped = decode_tool_blob(ctx['raw'], ctx['unit'])
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(4)
    except Exception as e:
        print(f'{type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(3)
    sys.stdout.buffer.write(msgspec.msgpack.encode({'parsed': parsed, 'skipped': skipped}))


if __name__ == '__main__':
    main()
