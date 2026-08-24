"""
Parse Indian F&O contract symbols into (underlying, expiry, strike, option type).

Broker P&L exports identify a contract only by its symbol string. That string is
the sole surviving link between a trade row and market data — the exports carry no
trade date — so this parser is what makes any join possible at all.

Three formats occur, and the weekly one is the awkward case because the month is a
single character with O/N/D standing in for the two-digit months:

    NIFTY2641323800PE    weekly   -> 2026-04-13, 23800 PE
    NIFTY25N1125500PE    weekly   -> 2025-11-11, 25500 PE   (N = November)
    NIFTY26JUL23900PE    monthly  -> July 2026 expiry, 23900 PE
    CRUDEOIL25DECFUT     future   -> not an option, returns None

Monthly expiry is derived as the last Thursday of the month. That is the NSE
convention for the period covered here, but it is a CONVENTION, not a lookup:
holidays shift expiry earlier, and the exchange has moved the weekday more than
once. Where the exact date matters, verify against a session actually present in
market data rather than trusting this.
"""

import re
import datetime as dt

MONTHS = {'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
          'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12}

# Weekly contracts compress the month to one char: 1-9 then O, N, D.
MONTH_LETTERS = {'1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
                 '7': 7, '8': 8, '9': 9, 'O': 10, 'N': 11, 'D': 12}

_MONTHLY = re.compile(
    r'^(?P<under>[A-Z&\-]+?)(?P<yy>\d{2})'
    r'(?P<mon>JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)'
    r'(?P<strike>\d+(?:\.\d+)?)(?P<opt>CE|PE)$')

_WEEKLY = re.compile(
    r'^(?P<under>[A-Z&\-]+?)(?P<yy>\d{2})(?P<m>[1-9OND])(?P<dd>\d{2})'
    r'(?P<strike>\d+(?:\.\d+)?)(?P<opt>CE|PE)$')


def last_thursday(year: int, month: int) -> dt.date:
    """Last Thursday of the month — the monthly-expiry convention."""
    nxt = dt.date(year + (month == 12), month % 12 + 1, 1)
    d = nxt - dt.timedelta(days=1)
    while d.weekday() != 3:
        d -= dt.timedelta(days=1)
    return d


def parse_option_symbol(symbol: str):
    """
    Return a dict with underlying/expiry/strike/option_type/expiry_kind,
    or None when the symbol is not an option (futures, equity, malformed).

    Monthly is tried first: a monthly symbol like NIFTY26JUL... cannot match the
    weekly pattern, but ordering makes the intent explicit rather than incidental.
    """
    s = (symbol or '').strip().upper()

    m = _MONTHLY.match(s)
    if m:
        year = 2000 + int(m['yy'])
        month = MONTHS[m['mon']]
        return {'underlying': m['under'], 'expiry': last_thursday(year, month),
                'strike': float(m['strike']), 'option_type': m['opt'],
                'expiry_kind': 'monthly'}

    m = _WEEKLY.match(s)
    if m:
        year = 2000 + int(m['yy'])
        month = MONTH_LETTERS[m['m']]
        day = int(m['dd'])
        try:
            expiry = dt.date(year, month, day)
        except ValueError:          # e.g. a 31st in a 30-day month => misparse
            return None
        return {'underlying': m['under'], 'expiry': expiry,
                'strike': float(m['strike']), 'option_type': m['opt'],
                'expiry_kind': 'weekly'}

    return None
