#!/usr/bin/env python3
"""Measure the reference Chrome's own metrics for a font family.

`gen_font_tables.py` reads a face's tables, which covers a font whose kerning
lives in GPOS or the legacy `kern` table. A face that kerns through AAT
(`morx`) -- Zapfino, Skia -- has neither that describes its runs, and a face
whose family macOS resolves through something other than the file's own
advances cannot be read off the file at all. This is the fallback: ask the
browser the challenge compares against.

Chrome's canvas widths land on a 1/128-px grid (Skia answers 125.3359375,
which is 16043/128), so with an em of 2048 units one unit is exactly 1/128 px
at 16px and every measurement lands on an integer with no rounding at all.

Usage:
  uv run --with websockets measure_oracle_fonts.py Zapfino Skia > oracle_metrics.json
  CHROME_ENDPOINT=http://127.0.0.1:9222/json/version uv run ... measure_oracle_fonts.py ...

The endpoint defaults to the local Chrome the parity work is measured on. A
family name is quoted into the canvas font shorthand, so a name that needs
quoting is measured as the family it names; a name prefixed with `@` is a
generic keyword and goes in unquoted, because `system-ui` quoted is an unknown
family and `system-ui` bare is the system font.
"""
import asyncio, json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import websockets

SIZE = 16
UPEM = 2048  # one unit is exactly one 1/128-px step at SIZE
STEPS = UPEM // SIZE  # measurement steps per px
PROBE = 'Hamburgefonstiv'
ASCII = list(range(0x20, 0x7F))
LATIN1 = list(range(0xA0, 0x100))


def expression(families):
    """The measurement loop, as one expression per family."""
    parts = []
    for family in families:
        # A quoted name is a family; a bare `@`-prefixed one is the keyword
        # itself, which for `system-ui` is a font no family file carries.
        token = family[1:] if family.startswith('@') else f'"{family}"'
        font = json.dumps(f'{SIZE}px {token}')
        parts.append(f"""
        (() => {{
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.font = {font};
          const singles = {{}}, pairs = {{}}, pairsRaw = {{}};
          for (const code of {json.dumps(ASCII + LATIN1)}) {{
            singles[code] = ctx.measureText(String.fromCharCode(code)).width;
          }}
          for (const first of {json.dumps(ASCII)}) {{
            for (const second of {json.dumps(ASCII)}) {{
              const pair = String.fromCharCode(first) + String.fromCharCode(second);
              const width = ctx.measureText(pair).width;
              const base = singles[first] + singles[second];
              const delta = Math.round((width - base) * 128);
              if (delta !== 0) {{
                pairs[first + '|' + second] = delta;
                pairsRaw[first + '|' + second] = width - base;
              }}
            }}
          }}
          return {{singles, pairs, pairsRaw, probe: ctx.measureText({json.dumps(PROBE)}).width}};
        }})()
        """)
    return 'JSON.stringify([' + (',\n'.join(parts)) + '])'


async def measure(endpoint, families):
    with urllib.request.urlopen(endpoint, timeout=10) as handle:
        socket_url = json.load(handle)['webSocketDebuggerUrl']
    async with websockets.connect(socket_url, max_size=256 * 1024 * 1024) as ws:
        counter = 0

        async def call(method, params=None, session=None):
            nonlocal counter
            counter += 1
            message = {'id': counter, 'method': method, 'params': params or {}}
            if session:
                message['sessionId'] = session
            await ws.send(json.dumps(message))
            while True:
                reply = json.loads(await asyncio.wait_for(ws.recv(), timeout=600))
                if reply.get('id') == counter:
                    return reply

        target = (await call('Target.createTarget', {'url': 'about:blank'}))['result']['targetId']
        session = (await call('Target.attachToTarget',
                              {'targetId': target, 'flatten': True}))['result']['sessionId']
        await call('Runtime.enable', {}, session)
        result = await call('Runtime.evaluate',
                            {'expression': expression(families), 'returnByValue': True}, session)
        await call('Target.closeTarget', {'targetId': target})
        return json.loads(result['result']['result']['value'])


def main():
    families = sys.argv[1:]
    if not families:
        print(__doc__, file=sys.stderr)
        return 1
    endpoint = os.environ.get('CHROME_ENDPOINT', 'http://127.0.0.1:9222/json/version')
    measured = asyncio.run(measure(endpoint, families))
    out = {
        'source': f'the reference Chrome at {endpoint}, canvas measureText at {SIZE}px',
        'size': SIZE,
        'upem': UPEM,
        'text': PROBE,
        'families': {},
    }
    for family, data in zip(families, measured):
        out['families'][family.lstrip('@')] = {
            'advances': {str(code): round(width * STEPS) for code, width in data['singles'].items()},
            'advances_raw': {str(code): width for code, width in data['singles'].items()},
            'pairs': data['pairs'],
            'pairs_raw': data['pairsRaw'],
            'probe': data['probe'],
        }
    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
