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

MONTHLY EXPIRY IS NOT COMPUTED, AND MUST NOT BE
An earlier version derived it as the last Thursday of the month. Measured against
real listed expiries that was wrong for **416 of 416** monthly contracts: NSE moved
monthly expiry from Thursday to Tuesday in September 2025 (last Thursday expiry
2025-08-28), and holidays push it to Monday -- 2026-03-30, for instance. Weekly
contracts were 434/434 correct over the same set, because their date is spelled out
in the symbol.

So monthly parses return `expiry=None` plus `expiry_year` / `expiry_month`, and the
caller must resolve the real date with `resolve_expiry()` against expiries actually
listed in market data. Returning a plausible-looking wrong date silently poisoned
every downstream join; returning None makes the caller confront it.
"""

from __future__ import annotations   # dt.date | None on Python 3.9

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


def resolve_expiry(parsed: dict, listed_expiries) -> dt.date | None:
    """
    Turn a parse into a real date using expiries that actually traded.

    `listed_expiries` is any iterable of dates for the SAME underlying (e.g.
    `SELECT DISTINCT expiry FROM fo_bhavcopy WHERE ticker = %s`).

    Weekly parses already carry an exact date and are returned unchanged. Monthly
    parses resolve to the last listed expiry falling inside their month, which is
    correct regardless of which weekday the exchange currently uses or how holidays
    shift it. Returns None when that month has no listed expiry — the caller then
    knows the contract is outside its data, rather than inventing a date.
    """
    if parsed.get('expiry') is not None:
        return parsed['expiry']
    y, m = parsed.get('expiry_year'), parsed.get('expiry_month')
    if not y or not m:
        return None
    same_month = [e for e in listed_expiries if e.year == y and e.month == m]
    return max(same_month) if same_month else None


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
        return {'underlying': m['under'], 'expiry': None,
                'expiry_year': 2000 + int(m['yy']), 'expiry_month': MONTHS[m['mon']],
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
                'expiry_year': year, 'expiry_month': month,
                'strike': float(m['strike']), 'option_type': m['opt'],
                'expiry_kind': 'weekly'}

    return None
