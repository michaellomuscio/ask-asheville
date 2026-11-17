"""Tiny binary bundle format shared with the browser (src/data/bundle.js).

  'ASV1' | uint32 header length | header JSON (padded to 8 bytes) | arrays (each 8-byte aligned)

The header holds {"meta": {...}, "arrays": {name: {"dtype", "offset", "length"}}}, offsets
relative to the first array byte. Files are gzipped; the browser inflates them with
DecompressionStream.
"""
from __future__ import annotations

import gzip
import json
import struct

import numpy as np

DTYPES = {"float32": "f4", "float64": "f8", "int32": "i4", "uint32": "u4", "int16": "i2", "uint16": "u2", "int8": "i1", "uint8": "u1"}


def write_bundle(path, meta, arrays):
    blobs = []
    table = {}
    offset = 0
    for name, arr in arrays.items():
        arr = np.ascontiguousarray(arr)
        dt = DTYPES[str(arr.dtype)]
        b = arr.astype(arr.dtype.newbyteorder("<"), copy=False).tobytes()
        pad = (-offset) % 8
        if pad:
            blobs.append(b"\0" * pad)
            offset += pad
        table[name] = {"dtype": dt, "offset": offset, "length": int(arr.size)}
        blobs.append(b)
        offset += len(b)
    header = json.dumps({"meta": meta, "arrays": table}, separators=(",", ":")).encode()
    header += b" " * ((-len(header) - 8) % 8)
    raw = b"ASV1" + struct.pack("<I", len(header)) + header + b"".join(blobs)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    return len(raw)
