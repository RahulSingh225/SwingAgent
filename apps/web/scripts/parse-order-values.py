#!/usr/bin/env python3
"""
Pick the order value out of each announcement's PDF text.

The naive approach fails badly. A single filing may mention the order value, the
company's order book, last quarter's revenue and its paid-up capital — one sample
gave "98.15 crore" and "19,440 million" in the same document, twenty-fold apart.
Taking the first match, or the largest, silently poisons the ratio the whole
study depends on.

So every rupee figure is scored on the words immediately around it: phrases like
"order value" or "aggregating to" pull it up, "revenue", "order book" and
"paid-up capital" push it down. The best-scoring candidate wins, everything is
normalised to ₹ crore, and an evidence snippet is emitted alongside so a human
can audit a sample in seconds rather than minutes.

Output is JSONL: seq_id, value_cr, confidence, evidence, n_candidates.

Usage: python3 scripts/parse-order-values.py <pdf_text.jsonl> <out.jsonl>
"""

import sys, json, re

# ── unit normalisation, all to ₹ crore ───────────────────
UNIT_CR = {
    'crore': 1.0, 'crores': 1.0, 'cr': 1.0, 'crs': 1.0,
    'lakh': 0.01, 'lakhs': 0.01, 'lac': 0.01, 'lacs': 0.01,
    'million': 0.1, 'mn': 0.1, 'millions': 0.1,
    'billion': 100.0, 'bn': 100.0, 'billions': 100.0,
}
USD_INR = 83.0  # approximate; only used for explicitly USD-denominated figures

MONEY = re.compile(
    r'(?P<cur>(?:US\s*\$|U\.?S\.?D|\$|Rs\.?|INR|₹)\s*)?'
    r'(?P<num>\d[\d,]*(?:\.\d+)?)\s*'
    r'(?P<unit>crores?|crs?\b|lakhs?|lacs?|millions?|mn\b|billions?|bn\b)',
    re.I)

# "Total Value in crores 17.89" — some filings put the unit before the figure.
UNIT_FIRST = re.compile(
    r'(?:in|value in|amount in)\s+(?P<unit>crores?|lakhs?|lacs?|millions?|billions?)'
    r'[^0-9%]{0,40}?(?P<num>\d[\d,]*(?:\.\d+)?)', re.I)

# A dollar figure anywhere in the ±30 chars around a match means the amount is
# USD even when the symbol sits outside the matched span, e.g. "(US$ 1.90 mn)".
USD_NEAR = re.compile(r'(?:us\s*\$|u\.?s\.?d|\$)', re.I)

# Any currency marker at all. Without one the figure is very often a physical
# quantity that happens to share the unit: "2.3 million sq ft" of built-up area,
# "3.70 mn dwt" of shipping tonnage, "29 lakh people" benefitting from a scheme.
# These cluster at small values and would corrupt the small-order bucket.
CURRENCY_NEAR = re.compile(r'(?:rs\.?|inr|₹|rupees|us\s*\$|u\.?s\.?d|\$)', re.I)

# Units that follow the number and prove it is NOT money.
NON_MONETARY = re.compile(
    r'^\s*(?:sq\.?\s*(?:ft|m|mtr|meter)|square|ft\b|sft|acres?|hectare|dwt|'
    r'people|persons?|beneficiar|households?|customers?|subscribers?|users?|'
    r'mw\b|kw\b|gw\b|mwh|kwh|units?|nos\.?|numbers?|tonnes?|tons?|mt\b|'
    r'km\b|kms|kilometer|metres?|meters?|litres?|liters?|barrels?|'
    r'shares?|equity|share)', re.I)

# Phrases that indicate THIS order's value.
STRONG_POS = [
    'order value', 'value of the order', 'order worth', 'contract value',
    'value of the contract', 'aggregating to', 'aggregate value', 'amounting to',
    'total value', 'valued at', 'order of', 'work order', 'purchase order',
    'loa value', 'letter of award', 'contract price', 'order amounting',
    'bagged an order', 'received an order', 'secured an order', 'order for',
]
WEAK_POS = ['order', 'contract', 'project', 'award', 'worth', 'supply', 'tender']

# Phrases that mean the number is something else entirely.
NEGATIVE = [
    'order book', 'orderbook', 'outstanding order', 'unexecuted',
    'revenue', 'turnover', 'profit', 'pat ', 'ebitda', 'net worth', 'networth',
    'paid-up', 'paid up', 'share capital', 'authorised capital', 'authorized capital',
    'market cap', 'face value', 'dividend', 'earnings per share', 'eps ',
    'borrowing', 'debt', 'loan', 'investment of', 'capex', 'capital expenditure',
    'total income', 'gross', 'net sales', 'previous year', 'corresponding quarter',
    # Amounts that routinely appear inside order filings but are not the order:
    'penalty', 'penalties', 'fine of', 'liquidated damages', 'earnest money',
    'bank guarantee', 'security deposit', 'emd', 'performance guarantee',
    'stamp duty', 'gst', 'tax of', 'fee of', 'compensation of',
    # Corporate boilerplate describing the company's own size, not the order:
    'multinational', 'conglomerate', 'about the company', 'about us',
    'is a usd', 'is a us$', 'is an usd', 'group with', 'company with',
    'annual revenue', 'revenues of', 'turnover of', 'market leader',
    'employs', 'founded in', 'incorporated in', 'operates in',
]

# Anything outside this band is not a plausible single order for a listed Indian
# company; treated as a mis-parse rather than a real value.
MIN_CR, MAX_CR = 0.05, 100_000.0


def _norm(t):
    """Collapse hyphen and space noise so "net- worth" matches "net worth"."""
    return re.sub(r'[\s\-]+', ' ', t)


def score_candidate(text_lower, start, end):
    window = _norm(text_lower[max(0, start - 130):start] + ' ' + text_lower[end:end + 90])
    near = _norm(text_lower[max(0, start - 70):end + 50])
    score = 0

    for p in STRONG_POS:
        if p in near:
            score += 6
            break
    else:
        for p in STRONG_POS:
            if p in window:
                score += 3
                break

    if any(p in window for p in WEAK_POS):
        score += 1

    for p in NEGATIVE:
        if p in near:
            score -= 8
            break
    else:
        if any(p in window for p in NEGATIVE):
            score -= 4

    return score


def parse(text):
    """Return (value_cr, confidence, evidence, n_distinct_candidates)."""
    if not text:
        return None, 'none', None, 0
    low = text.lower()
    cands = []
    for m in MONEY.finditer(text):
        try:
            num = float(m.group('num').replace(',', ''))
        except ValueError:
            continue
        if num <= 0:
            continue
        unit = m.group('unit').lower().rstrip('.')
        mult = UNIT_CR.get(unit)
        if mult is None:
            mult = UNIT_CR.get(unit.rstrip('s'))
        if mult is None:
            continue
        # Reject physical quantities: "2.3 million sq ft", "3.70 mn dwt".
        if NON_MONETARY.match(text[m.end():m.end() + 22]):
            continue
        # Require some currency marker before the figure.
        cur = (m.group('cur') or '').strip().lower()
        lead = text[max(0, m.start() - 28):m.start()]
        if not cur and not CURRENCY_NEAR.search(lead):
            continue
        val = num * mult
        around = text[max(0, m.start() - 30):m.end() + 10]
        is_usd = bool(USD_NEAR.search(cur)) or bool(USD_NEAR.search(around))
        if is_usd:
            val *= USD_INR
        if not (MIN_CR <= val <= MAX_CR):
            continue
        sc = score_candidate(low, m.start(), m.end())
        snippet = ' '.join(text[max(0, m.start() - 70):m.end() + 50].split())
        cands.append({'val': round(val, 2), 'score': sc, 'ev': snippet, 'usd': is_usd})

    for m in UNIT_FIRST.finditer(text):
        try:
            num = float(m.group('num').replace(',', ''))
        except ValueError:
            continue
        mult = UNIT_CR.get(m.group('unit').lower().rstrip('s')) or \
               UNIT_CR.get(m.group('unit').lower())
        if not mult or num <= 0:
            continue
        if NON_MONETARY.match(text[m.end():m.end() + 22]):
            continue
        val = num * mult
        if not (MIN_CR <= val <= MAX_CR):
            continue
        sc = score_candidate(low, m.start(), m.end())
        snippet = ' '.join(text[max(0, m.start() - 70):m.end() + 50].split())
        cands.append({'val': round(val, 2), 'score': sc, 'ev': snippet, 'usd': False})

    if not cands:
        return None, 'none', None, 0

    # Collapse repeats of the same amount, keeping its best-scoring mention.
    by_val = {}
    for c in cands:
        k = round(c['val'], 2)
        if k not in by_val or c['score'] > by_val[k]['score']:
            by_val[k] = c
    distinct = sorted(by_val.values(), key=lambda c: -c['score'])
    best = distinct[0]

    if best['score'] <= 0:
        conf = 'low'
    elif len(distinct) == 1:
        conf = 'high'
    elif best['score'] >= distinct[1]['score'] + 4:
        conf = 'high'      # decisively better than the runner-up
    elif best['score'] >= distinct[1]['score'] + 2:
        conf = 'medium'
    else:
        conf = 'low'       # several plausible numbers, no clear winner

    return best['val'], conf, best['ev'], len(distinct)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    n_in = n_out = 0
    with open(sys.argv[2], 'w') as out:
        for line in open(sys.argv[1]):
            try:
                rec = json.loads(line)
            except Exception:
                continue
            n_in += 1
            val, conf, ev, ncand = parse(rec.get('text'))
            if val is not None:
                n_out += 1
            out.write(json.dumps({
                'seq_id': rec['seq_id'], 'symbol': rec.get('symbol'),
                'status': rec.get('status'), 'value_cr': val,
                'confidence': conf, 'n_candidates': ncand, 'evidence': ev,
            }, ensure_ascii=False) + '\n')
    print(f'[parse] {n_in} docs, {n_out} with a value ({100*n_out/max(n_in,1):.1f}%)')


if __name__ == '__main__':
    main()
