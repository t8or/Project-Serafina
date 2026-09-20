"""Conservative native-text score projection. Every candidate retains source evidence."""
import re
from typing import Any, Iterable

NUMBER = r"(?:[+\-−]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?|\(\$?[\d,]+(?:\.\d+)?%?\)%?|—|–|-|N/A)"


def _number(value):
    value = value.strip().replace('−', '-').replace('$', '').replace('%', '').replace(',', '')
    if value.upper() in {'', '-', '—', '–', 'N/A'}:
        return None
    if value.startswith('(') and value.endswith(')'):
        value = '-' + value[1:-1]
    try:
        return float(value)
    except ValueError:
        return None


def _demographic_candidates(text, page):
    if 'DEMOGRAPHIC SUMMARY' not in text.upper():
        return []
    candidates = []
    radius_index = None
    radius_count = 0
    rows = []
    for line in text.splitlines():
        radii = re.findall(r'\b(\d+(?:\.\d+)?)\s*(?:-\s*)?Miles?\b', line, re.I)
        if radii:
            radius_count = len(radii)
            radius_index = radii.index('3') if radii.count('3') == 1 else None
            continue
        if radius_index is None:
            continue
        patterns = [
            ('population_3mile', r'(\d{4})\s+Population', False),
            ('population_growth_3mile', r'Pop(?:ulation)?\s+Growth\s+(\d{4}\s*[-–]\s*\d{4})', True),
            ('median_hh_income_3mile', r'Median\s+Household\s+Income', False),
            ('median_home_value_3mile', r'Median\s+Home\s+Value', False),
        ]
        for field, label, percentage in patterns:
            match = re.match(r'^\s*' + label + r'\s+(.+?)\s*$', line, re.I)
            if not match:
                continue
            tokens = re.findall(NUMBER, match.groups()[-1], re.I)
            # Reject leftovers and unexpected column count rather than shifting columns.
            if len(tokens) != radius_count or re.sub(NUMBER, '', match.groups()[-1], flags=re.I).strip():
                continue
            value = _number(tokens[radius_index])
            if value is None:
                continue
            period = match.group(1) if len(match.groups()) > 1 else None
            rows.append(dict(field=field, value=value / 100 if percentage else value,
                             period=period, scope='3 mile', page=page, quote=line.strip(),
                             raw_value=tokens[radius_index], method='native_text'))
    # Population forecasts are retained as evidence but are not the current baseline.
    dates = re.findall(r'\b\d{1,2}/\d{1,2}/(\d{4})\b', text)
    populations = [r for r in rows if r['field'] == 'population_3mile']
    years = [int(r['period']) for r in populations]
    historical = [y for y in years if dates and y <= int(dates[-1])]
    chosen_year = max(historical) if historical else min(years, default=None)
    for row in rows:
        row['selected'] = row['field'] != 'population_3mile' or int(row['period']) == chosen_year
        candidates.append(row)
    return candidates


def _submarket_candidates(text, page):
    if 'KEY INDICATORS' not in text.upper():
        return []
    # Require the actual aggregate label: Market and peer rows cannot supply Submarket facts.
    aggregate = re.search(r'(?mi)^[ \t]*Submarket[ \t]+(' + NUMBER + r'(?:[ \t]+' + NUMBER + r'){6})[ \t]*\r?$', text)
    if not aggregate:
        return []
    values = re.findall(NUMBER, aggregate.group(1), re.I)
    if len(values) != 7 or re.sub(NUMBER, '', aggregate.group(1), flags=re.I).strip():
        return []
    # This known layout has explicit headers; unsupported layouts abstain.
    if not re.search(r'Units\s+Vacancy Rate\s+Asking Rent\s+Effective Rent', text, re.I):
        return []
    inventory, vacancy, _, _, _, _, construction = map(_number, values)
    result = []
    def add(field, value, quote, period):
        if value is not None:
            result.append(dict(field=field, value=value, page=page, quote=quote.strip(),
                               period=period, scope='submarket', selected=True, method='native_text'))
    if vacancy is not None and '%' in values[1] and 0 <= vacancy <= 100:
        add('vacancy_rate', vacancy / 100, aggregate.group(0), 'current quarter')
    if inventory and inventory > 0:
        add('inventory_units', inventory, aggregate.group(0), 'current quarter')
        if construction is not None and construction >= 0:
            add('construction_pct_of_inventory', construction / inventory, aggregate.group(0), 'current quarter')
            add('construction_units', construction, aggregate.group(0), 'current quarter')
        lines = text.splitlines()
        header = '12 Mo Delivered Units 12 Mo Absorption Units Vacancy Rate 12 Mo Asking Rent Growth'
        for i, line in enumerate(lines):
            if line.strip().lower() == header.lower() and i:
                summary = re.findall(NUMBER, lines[i-1], re.I)
                if len(summary) == 4 and not re.sub(NUMBER, '', lines[i-1], flags=re.I).strip():
                    delivered = _number(summary[0])
                    if delivered is not None and delivered >= 0:
                        add('delivered_units', delivered, lines[i-1] + '\n' + line, 'trailing 12 months')
                        add('delivered_pct_of_inventory', delivered / inventory,
                            lines[i-1] + '\n' + line + '\n' + aggregate.group(0), 'trailing 12 months')
    return result


def extract_scoring_metrics(page_texts: Iterable[str]) -> dict[str, Any]:
    result = {'demographics': {}, 'submarket': {}, 'demographics_page': None,
              'submarket_page': None, 'evidence': {}, 'conflicts': {}, 'warnings': []}
    for page, text in enumerate(page_texts, 1):
        for category, extractor in [('demographics', _demographic_candidates), ('submarket', _submarket_candidates)]:
            try:
                candidates = extractor(text, page)
            except (ValueError, TypeError, IndexError) as error:
                result['warnings'].append({'page': page, 'category': category, 'error': str(error)})
                continue
            for candidate in candidates:
                result['evidence'].setdefault(category + '.' + candidate['field'], []).append(candidate)
    for key, candidates in result['evidence'].items():
        category, field = key.split('.')
        selected = [c for c in candidates if c['selected']]
        identities = {(c['value'], c['period'], c['scope']) for c in selected}
        if len(identities) == 1:
            result[category][field] = selected[0]['value']
            result[category + '_page'] = result[category + '_page'] or selected[0]['page']
        elif len(identities) > 1:
            result['conflicts'][key] = selected
    return result
