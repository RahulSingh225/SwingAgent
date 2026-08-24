#!/usr/bin/env python3
"""
Fetch announcement PDFs and extract their text to JSONL.

Deliberately split from parsing. Fetching 7k PDFs is a ~30 minute network job;
picking the right rupee figure out of them is a judgement problem that will take
several attempts to get right. Storing the text once means every later attempt is
free and offline.

Resumable: seq_ids already present in the output file are skipped, so an
interrupted run continues rather than restarting.

Usage:
  python3 scripts/fetch-pdfs.py <input.tsv> <output.jsonl> [workers]

Input TSV is `seq_id<TAB>symbol<TAB>url` (psql -A -F'\t' output).
"""

import sys, json, os, re, urllib.request, concurrent.futures as cf
from threading import Lock

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF required:  pip3 install pymupdf")

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
HEADERS = {'User-Agent': UA, 'Referer': 'https://www.nseindia.com/'}

# Below this, the PDF is a scan with no embedded text layer. Worth recording as a
# distinct status: those need OCR, they are not "no value stated".
MIN_TEXT_CHARS = 80

write_lock = Lock()
done_count = 0


def extract(row):
    seq_id, symbol, url = row
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        raw = urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:
        return {'seq_id': seq_id, 'symbol': symbol, 'url': url,
                'status': 'fetch_fail', 'n_chars': 0, 'text': None,
                'note': str(e)[:200]}
    try:
        doc = fitz.open(stream=raw, filetype='pdf')
        text = "\n".join(p.get_text() for p in doc)
        pages = doc.page_count
        doc.close()
    except Exception as e:
        return {'seq_id': seq_id, 'symbol': symbol, 'url': url,
                'status': 'parse_fail', 'n_chars': 0, 'text': None,
                'note': str(e)[:200]}

    text = re.sub(r'[ \t\xa0]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    status = 'ok' if len(text) >= MIN_TEXT_CHARS else 'scanned_no_text'
    return {'seq_id': seq_id, 'symbol': symbol, 'url': url, 'status': status,
            'n_chars': len(text), 'pages': pages,
            'text': text if status == 'ok' else None, 'note': None}


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    in_path, out_path = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 6

    rows = []
    for line in open(in_path):
        parts = line.rstrip('\n').split('\t')
        if len(parts) >= 3 and parts[2].startswith('http'):
            rows.append((parts[0], parts[1], parts[2]))

    seen = set()
    if os.path.exists(out_path):
        for line in open(out_path):
            try:
                seen.add(json.loads(line)['seq_id'])
            except Exception:
                pass
    todo = [r for r in rows if r[0] not in seen]
    print(f"[pdfs] {len(rows)} total, {len(seen)} already done, {len(todo)} to fetch",
          flush=True)

    global done_count
    out = open(out_path, 'a')
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for rec in ex.map(extract, todo):
            with write_lock:
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                done_count += 1
                if done_count % 250 == 0:
                    out.flush()
                    print(f"  {done_count}/{len(todo)}", flush=True)
    out.close()
    print(f"[pdfs] done — {done_count} fetched", flush=True)


if __name__ == '__main__':
    main()
