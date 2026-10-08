#!/usr/bin/env python3
"""extract-fo-payloads.py <trace.jsonl> <out-prefix> [--keys k1,k2,...]
从 tracelog JSONL 提取 k=payloadJSON 记录（按时序），每条 parse 后按原始键序（不重排）dump 到
<out-prefix>-fo<N>.json（N 从 1 起）。--keys 另外输出指定 k 的计数与样本。
"""
import json, sys, collections

def parse_stream(path):
    data = open(path, 'rb').read().decode('utf-8', errors='replace')
    dec = json.JSONDecoder(); i = 0; recs = []
    while i < len(data):
        while i < len(data) and data[i] in ' \n\r\t':
            i += 1
        if i >= len(data):
            break
        try:
            obj, i = dec.raw_decode(data, i)
            recs.append(obj)
        except Exception as e:
            print(f'[extract] parse stop at {i}: {e}', file=sys.stderr)
            break
    return recs

def main():
    trace = sys.argv[1]
    prefix = sys.argv[2]
    extra_keys = []
    if '--keys' in sys.argv:
        extra_keys = sys.argv[sys.argv.index('--keys') + 1].split(',')
    recs = parse_stream(trace)
    kc = collections.Counter(r.get('k') for r in recs)
    print(f'[extract] {trace}: records={len(recs)}')
    print('[extract] k counts:', dict(kc))
    fo = [r for r in recs if r.get('k') == 'payloadJSON']
    print(f'[extract] payloadJSON: {len(fo)} 条')
    for n, r in enumerate(fo, 1):
        v = r.get('v')
        try:
            obj = json.loads(v) if isinstance(v, str) else v
        except Exception as e:
            print(f'[extract] fo{n} parse fail: {e}', file=sys.stderr)
            continue
        out = f'{prefix}-fo{n}.json'
        with open(out, 'w') as f:
            json.dump(obj, f, indent=1, ensure_ascii=False)  # 键序=trace 原始顺序，不重排
        top = list(obj.keys())[:4] if isinstance(obj, dict) else type(obj).__name__
        print(f'[extract] fo{n} -> {out}  top={top}  bytes(orig)={len(v) if isinstance(v,str) else "?"}')
    for key in extra_keys:
        n = kc.get(key, 0)
        print(f'[extract] key {key}: {n}')

if __name__ == '__main__':
    main()
