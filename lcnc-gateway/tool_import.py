"""Tool source dispatch and isolated import worker; legacy Fusion parser is unchanged."""
import sys
import json
import math
from freecad_import import _json, decode_freecad_blob, parse_freecad_data, parse_bit, _deduplicate, MAX_TOOLS
from fusion_import import parse_fusion_library


def parse_mixed_library(data, unit):
    """A portable collection of source definitions, never executable CAD files.

    Each entry goes through its source adapter. Global deduplication also catches
    number collisions between CAD systems, so metadata refresh can refuse them.
    """
    if type(data.get('version')) is not int or data['version'] not in (1, 2) or unit not in ('mm', 'in'):
        raise ValueError('Unsupported LCNC tool library version or machine units')
    entries = data.get('tools')
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_TOOLS:
        raise ValueError('LCNC tool library must contain 1 to 2000 tools')
    example = data.get('is_example', False)
    if type(example) is not bool:
        raise ValueError('LCNC is_example must be a boolean')
    result = []
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict) or not isinstance(entry.get('data'), dict):
            raise ValueError(f'LCNC tool {index}: source and data object required')
        raw = entry['data']
        try:
            if entry.get('source') == 'fusion360':
                number = raw.get('post-process', {}).get('number')
                if type(number) is not int or not 1 <= number <= 99999:
                    raise ValueError('Fusion tool number must be an integer from 1 to 99999')
                parsed, _ = parse_fusion_library({'data': [raw]}, unit)
                tool = parsed[0]
            elif entry.get('source') == 'freecad':
                tool = parse_bit(raw.get('bit'), raw.get('nr'), raw.get('id', ''), unit, raw.get('geometry'))
            else:
                raise ValueError('Unknown source (expected fusion360 or freecad)')
            if not math.isfinite(tool['D']) or tool['D'] <= 0:
                raise ValueError('Tool diameter must be finite and positive')
            if 'example_z_mm' in entry:
                nominal = entry['example_z_mm']
                if not example or type(nominal) not in (int, float) or not math.isfinite(nominal) or nominal <= 0:
                    raise ValueError('example_z_mm requires an example library and a finite positive number')
                tool['example_z_offset'] = float(nominal) / (25.4 if unit == 'in' else 1.0)
            elif example:
                # Compatibility with earlier example files without setup values.
                tool['example_z_offset'] = max(tool.get('body_length') or 0, tool['oal'])
            # Reject overflow from unit conversions before it reaches the UI.
            json.dumps(tool, allow_nan=False)
        except (ValueError, TypeError, AttributeError, IndexError, KeyError, OverflowError) as e:
            raise ValueError(f'LCNC tool {index}: {e}') from e
        if example:
            tool['is_example'] = True
        result.append(tool)
    return _deduplicate(result)


def initial_z_offset(tool):
    """Replacement-table policy; metadata refresh never calls this helper."""
    if tool.get('is_example'):
        return tool['example_z_offset']
    if tool.get('source_format') == 'freecad':
        return 0.0
    return tool.get('body_length') or tool.get('oal') or 0.0


def decode_tool_blob(raw, unit):
    if raw.startswith(b'PK'):
        return decode_freecad_blob(raw, unit)
    data = _json(raw)
    if isinstance(data, dict) and data.get('format') == 'lcnc-tool-library':
        return parse_mixed_library(data, unit)
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
