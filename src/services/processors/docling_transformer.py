"""
Docling Output Transformer - Converts Docling output to match existing JSON schema.

This transformer ensures Docling output is compatible with the existing
CoStar/property report processing pipeline and expected output format.
"""

import re
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('docling_transformer')


class DoclingTransformer:
    """
    Transforms Docling output to match the existing JSON schema used by the
    CoStar property report processing system.
    
    Expected output format:
    {
        "structured_data": [{
            "property": { ... },
            "owner": { ... },
            "unitBreakdown": [{ headers, rows... }],
            "siteAmenities": [...],
            ...
        }],
        "metadata": {
            "section": "...",
            "page_number": 1,
            "type": "pdf"
        }
    }
    """
    
    # CoStar-specific section patterns for categorization
    SECTION_PATTERNS = {
        'property': [
            r'SUBJECT\s+PROPERTY',
            r'PROPERTY\s+SUMMARY',
            r'PROPERTY\s+PROFILE',
            r'PROPERTY\s+DESCRIPTION',
        ],
        'owner': [
            r'OWNER',
            r'OWNERSHIP',
            r'PROPERTY\s+MANAGER',
        ],
        'unit_breakdown': [
            r'UNIT\s+BREAKDOWN',
            r'UNIT\s+MIX',
            r'BED\s+BATH\s+AVG\s*SF',
        ],
        'asking_rents': [
            r'ASKING\s+RENTS',
            r'RENT\s+ROLL',
            r'RENTAL\s+RATES',
        ],
        'vacancy': [
            r'VACANCY',
            r'OCCUPANCY',
        ],
        'absorption': [
            r'ABSORPTION',
            r'12\s*MONTH\s+ABSORPTION',
        ],
        'amenities': [
            r'AMENITIES',
            r'SITE\s+AMENITIES',
            r'FEATURES',
        ],
        'financial': [
            r'FINANCIAL',
            r'OPERATING\s+STATEMENTS',
            r'INCOME',
            r'EXPENSES',
        ],
        'location': [
            r'LOCATION',
            r'MARKET\s+OVERVIEW',
            r'DEMOGRAPHICS',
        ],
        'sales': [
            r'SALE\s+COMPARABLES',
            r'SALES\s+HISTORY',
            r'TRANSACTION',
        ],
    }
    
    # Table header patterns for classification
    TABLE_PATTERNS = {
        'unit_breakdown': [
            r'beds?\s*bath',
            r'avg\s*sf',
            r'units?\s*mix',
            r'asking\s*rent',
            r'effective\s*rent',
        ],
        'rent_roll': [
            r'unit\s*#',
            r'tenant',
            r'lease\s*start',
            r'rent\s*amount',
        ],
        'expenses': [
            r'expense',
            r'category',
            r'amount',
            r'per\s*unit',
        ],
    }
    
    def __init__(self):
        """Initialize the transformer."""
        pass
    
    def transform(self, docling_output: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform Docling output to the expected JSON schema.
        
        Args:
            docling_output: Raw output from DoclingProcessor.process()
            
        Returns:
            Transformed output matching existing schema
        """
        if docling_output.get("processing_status") == "error":
            return docling_output
        
        try:
            # Extract components
            metadata = docling_output.get("metadata", {})
            tables = docling_output.get("tables", [])
            sections = docling_output.get("sections", [])
            pages = docling_output.get("pages", [])
            raw_text = docling_output.get("raw_text", "")
            
            # Build structured data
            structured_data = self._build_structured_data(
                tables=tables,
                sections=sections,
                raw_text=raw_text
            )
            
            # Build transformed metadata
            transformed_metadata = {
                "section": "full_document",
                "page_number": metadata.get("page_count", 1),
                "type": "pdf",
                "processor": "docling",
                "file_name": metadata.get("file_name"),
                "file_size": metadata.get("file_size"),
                "total_pages": metadata.get("page_count"),
                "total_tables": len(tables),
                "ocr_enabled": metadata.get("ocr_enabled", True),
                "table_mode": metadata.get("table_mode", "accurate"),
                "creation_date": datetime.now().isoformat()
            }
            
            return {
                "processing_status": docling_output.get("processing_status", "success"),
                "structured_data": [structured_data],
                "metadata": transformed_metadata,
                "tables_raw": tables,  # Preserve original table data
                "sections_raw": sections,  # Preserve original sections
                "pages": pages,
                "raw_text": raw_text
            }
            
        except Exception as e:
            logger.error(f"Error transforming Docling output: {str(e)}")
            return {
                "processing_status": "error",
                "error_message": f"Transformation error: {str(e)}",
                "original_output": docling_output
            }
    
    def _build_structured_data(
        self,
        tables: List[Dict],
        sections: List[Dict],
        raw_text: str
    ) -> Dict[str, Any]:
        """
        Build the structured_data object from Docling components.
        
        Output order matches document structure:
        1. property
        2. property_manager
        3. owner
        4. asking_rents
        5. vacancy
        6. absorption_rate
        7. unitBreakdown
        8. siteAmenities
        9. unitAmenities
        10. oneTimeExpenses
        11. petPolicy
        12. otherTables (if any)
        """
        
        # Process tables and categorize them
        classified_tables = self._classify_tables(tables)
        
        # Initialize in document order
        property_data = {}
        property_manager_data = {}
        owner_data = {}
        
        # First, extract property address info from first section header (e.g., "1609 W Glendale Ave")
        address_info = self._extract_address_from_sections(sections)
        if address_info:
            property_data.update(address_info)
        
        # Extract from property info tables (key-value tables like PROPERTY/OWNER)
        if classified_tables.get("property_info"):
            for prop_table in classified_tables["property_info"]:
                parsed = self._parse_property_info_table(prop_table)
                property_data.update(parsed.get("property", {}))
                property_manager_data.update(parsed.get("property_manager", {}))
                owner_data.update(parsed.get("owner", {}))
        
        # Fall back to section/text extraction if property info tables didn't provide data
        if not property_data:
            property_data = self._extract_property_info(sections, raw_text)
        if not owner_data:
            owner_data = self._extract_owner_info(sections, raw_text)
        
        # Extract ASKING RENTS, VACANCY, and ABSORPTION from raw_text
        metrics = self._extract_metrics_from_raw_text(raw_text)
        if metrics:
            asking_rents = metrics.get("asking_rents", {})
            vacancy = metrics.get("vacancy", {})
            absorption_rate = metrics.get("absorption", {})
        else:
            asking_rents = {}
            vacancy = self._extract_rate_info(sections, raw_text, "vacancy")
            absorption_rate = self._extract_rate_info(sections, raw_text, "absorption")
        
        # Extract unit breakdown
        unit_breakdown = []
        if classified_tables.get("unit_breakdown"):
            unit_breakdown = self._format_unit_breakdown(classified_tables["unit_breakdown"])
        
        # Extract amenities (site and unit separately)
        amenities = self._extract_all_amenities(sections, raw_text, tables)
        site_amenities = amenities.get("site", [])
        unit_amenities = amenities.get("unit", [])
        
        # Extract recurring expenses (utilities included)
        recurring_expenses = self._extract_recurring_expenses(sections, raw_text)
        
        # Extract one time expenses
        one_time_expenses = self._extract_one_time_expenses(sections, raw_text)
        
        # Extract pet policy
        pet_policy = self._extract_pet_policy(sections, raw_text)
        
        # Build structured output in document order
        structured = {
            "property": property_data,
            "property_manager": property_manager_data,
            "owner": owner_data,
            "asking_rents": asking_rents,
            "vacancy": vacancy,
            "absorption_rate": absorption_rate,
            "unitBreakdown": unit_breakdown,
            "siteAmenities": site_amenities,
            "unitAmenities": unit_amenities,
            "recurringExpenses": recurring_expenses,
            "oneTimeExpenses": one_time_expenses,
            "petPolicy": pet_policy
        }
        
        # Add any other tables as generic data (at the end)
        other_tables = classified_tables.get("other", [])
        if other_tables:
            structured["otherTables"] = other_tables
        
        # Add expenses if present
        if classified_tables.get("expenses"):
            structured["expenses"] = self._format_expenses(classified_tables["expenses"])
        
        return structured
    
    def _extract_address_from_sections(self, sections: List[Dict]) -> Dict[str, Any]:
        """
        Extract property address info from the first section header.
        
        CoStar reports typically have:
        - Section header: "1609 W Glendale Ave" (street address)
        - Content[0]: "Urban 148 148 Unit Apartment Building" (property name)
        - Content[1]: "Phoenix, Arizona - North Phoenix Neighborhood" (city, state)
        
        Returns:
            Dict with name, address, city, state keys
        """
        result = {}
        
        if not sections or len(sections) == 0:
            return result
        
        first_section = sections[0]
        header = first_section.get("header", "")
        content = first_section.get("content", [])
        
        # Street address from header (e.g., "1609 W Glendale Ave")
        if header and not header.upper().startswith(("PREPARED", "SUBJECT", "PROPERTY")):
            result["address"] = header.strip()
        
        # Property name from first content line (e.g., "Urban 148 148 Unit Apartment Building")
        if len(content) > 0:
            name_line = content[0]
            # Extract property name before "Unit" or numbers
            name_match = re.match(r'^(.+?)\s+\d+\s+Unit', name_line)
            if name_match:
                result["name"] = name_match.group(1).strip()
            else:
                # Fallback: take first part before numbers
                name_match = re.match(r'^([A-Za-z\s]+)', name_line)
                if name_match:
                    result["name"] = name_match.group(1).strip()
        
        # City and state from second content line (e.g., "Phoenix, Arizona - North Phoenix Neighborhood")
        if len(content) > 1:
            location_line = content[1]
            # Parse "City, State - Neighborhood" format
            location_match = re.match(r'^([^,]+),\s*([A-Za-z\s]+?)(?:\s*-|$)', location_line)
            if location_match:
                result["city"] = location_match.group(1).strip()
                state_name = location_match.group(2).strip()
                result["state"] = self._state_to_abbrev(state_name)
        
        return result
    
    def _state_to_abbrev(self, state_name: str) -> str:
        """Convert state name to abbreviation."""
        state_abbrevs = {
            'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
            'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
            'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
            'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
            'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
            'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
            'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
            'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
            'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
            'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
            'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
            'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
            'wisconsin': 'WI', 'wyoming': 'WY'
        }
        return state_abbrevs.get(state_name.lower(), state_name)
    
    def _classify_tables(self, tables: List[Dict]) -> Dict[str, List[Dict]]:
        """Classify tables by type based on headers."""
        classified = {
            "unit_breakdown": [],
            "rent_roll": [],
            "expenses": [],
            "property_info": [],  # Key-value property info tables
            "other": []
        }
        
        for table in tables:
            if "error" in table:
                continue
                
            headers = table.get("headers", [])
            header_text = " ".join(str(h).lower() for h in headers)
            
            # Check if this is a property info key-value table
            # Pattern: Has "PROPERTY" and "PROPERTY MANAGER" or "OWNER" in headers
            if self._is_property_info_table(table):
                classified["property_info"].append(table)
                continue
            
            matched = False
            for table_type, patterns in self.TABLE_PATTERNS.items():
                for pattern in patterns:
                    if re.search(pattern, header_text, re.IGNORECASE):
                        classified[table_type].append(table)
                        matched = True
                        break
                if matched:
                    break
            
            if not matched:
                classified["other"].append(table)
        
        return classified
    
    def _is_property_info_table(self, table: Dict) -> bool:
        """
        Detect if a table is a property info key-value table.
        
        These tables typically have:
        - Headers like "PROPERTY", "", "PROPERTY MANAGER"
        - Rows with key-value patterns like "No. of Units:", "144"
        """
        headers = table.get("headers", [])
        rows = table.get("rows", [])
        
        if not headers or not rows:
            return False
        
        # Check for characteristic headers
        header_text = " ".join(str(h).lower() for h in headers)
        has_property_header = "property" in header_text
        
        # Check for key-value pattern in rows (first column ends with ":")
        key_value_pattern_count = 0
        for row in rows[:5]:  # Check first 5 rows
            first_col = str(list(row.values())[0]) if row else ""
            if first_col.endswith(":"):
                key_value_pattern_count += 1
        
        return has_property_header and key_value_pattern_count >= 3
    
    def _parse_property_info_table(self, table: Dict) -> Dict[str, Dict[str, Any]]:
        """
        Parse a property info key-value table into structured data.
        
        Converts tables like:
        | PROPERTY | (value) | PROPERTY MANAGER |
        | No. of Units: | 144 | Valor - Hawks Landing... |
        | Stories: | 3 | (828) 855-3300 |
        | ... | ... | OWNER |
        | Year Built: | Nov 2018 | Valor Residential Group |
        | Parking: | - | Purchased Jun 2022 |
        | ... | ... | $29,300,000 |
        
        Into:
        {
            "property": {"no_of_units": 144, "stories": 3, ...},
            "property_manager": {"name": "...", "phone": "..."},
            "owner": {"name": "...", "purchase_date": "...", "purchase_price": "..."}
        }
        """
        headers = table.get("headers", [])
        rows = table.get("rows", [])
        
        result = {
            "property": {},
            "property_manager": {},
            "owner": {}
        }
        
        # Find which column has the property keys (usually first column, ends with ":")
        # Find which column has the property values (usually second column)
        # Find which column has property manager/owner info (usually third column)
        
        current_right_section = "property_manager"  # Start with property manager
        
        for row in rows:
            values = list(row.values())
            if len(values) < 2:
                continue
            
            # Parse left side (PROPERTY key-value pairs)
            key_col = str(values[0]).strip()
            value_col = str(values[1]).strip() if len(values) > 1 else ""
            right_col = str(values[2]).strip() if len(values) > 2 else ""
            
            # Extract property key-value
            if key_col.endswith(":"):
                key_name = self._normalize_property_key(key_col.rstrip(":"))
                if key_name and value_col and value_col != "-":
                    result["property"][key_name] = self._normalize_value(value_col)
            
            # Parse right side (PROPERTY MANAGER / OWNER)
            if right_col:
                # Check if this row marks the start of OWNER section
                if right_col.upper() == "OWNER":
                    current_right_section = "owner"
                    continue
                
                # Parse based on current section
                if current_right_section == "property_manager":
                    self._parse_property_manager_value(right_col, result["property_manager"])
                else:  # owner section
                    self._parse_owner_value(right_col, result["owner"])
        
        return result
    
    def _normalize_property_key(self, key: str) -> str:
        """Convert property key to snake_case."""
        key = key.lower().strip()
        # Map common keys
        key_map = {
            "no. of units": "no_of_units",
            "stories": "stories",
            "avg. unit size": "avg_unit_size",
            "type": "property_type",
            "rent type": "rent_type",
            "year built": "year_built",
            "parking": "parking",
            "distance to transit": "distance_to_transit",
        }
        return key_map.get(key, key.replace(" ", "_").replace(".", ""))
    
    def _parse_property_manager_value(self, value: str, target: Dict) -> None:
        """Parse a value from the property manager column."""
        # Check if it's a phone number
        phone_match = re.match(r'\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}', value)
        if phone_match:
            target["phone"] = value
            return
        
        # Otherwise, it's likely the name
        if "name" not in target and value:
            target["name"] = value
    
    def _parse_owner_value(self, value: str, target: Dict) -> None:
        """Parse a value from the owner column."""
        # Check if it's a purchase price (starts with $)
        if value.startswith("$"):
            # Extract price and per-unit if present
            price_match = re.match(r'\$([\d,]+)(?:\s*\(([^)]+)\))?', value)
            if price_match:
                target["purchase_price"] = value
                target["purchase_price_raw"] = price_match.group(1).replace(",", "")
                if price_match.group(2):
                    target["price_per_unit"] = price_match.group(2)
            return
        
        # Check if it's a purchase date (contains month/year or "Purchased")
        date_match = re.search(r'(?:Purchased\s+)?([A-Za-z]+\s+\d{4}|\d{1,2}/\d{1,2}/\d{4})', value)
        if date_match:
            target["purchase_date"] = date_match.group(1) if "Purchased" not in value else value
            return
        
        # Otherwise, it's likely the owner name
        if "name" not in target and value:
            target["name"] = value
    
    def _extract_metrics_from_raw_text(self, raw_text: str) -> Optional[Dict[str, Any]]:
        """
        Extract ASKING RENTS, VACANCY, and ABSORPTION metrics from raw markdown text.
        
        These tables are often extracted as a single merged 8-column markdown table:
        | Current:      | $1,456   | $1.50 /SF   | Current:      | 9.7%   | 14 Units   | Current:          | (10) Units   |
        | Last Quarter: | $1,456   | $1.50 /SF   | Last Quarter: | 6.3%   | 9 Units    | Competitor Total: | (27) Units   |
        ...
        
        We need to split this into 3 separate metric objects.
        """
        # Find the metrics table in raw_text - look for patterns like "Current:" followed by values
        # The table appears after ASKING RENTS section headers
        metrics_pattern = r'\|\s*Current:\s*\|\s*\$[\d,]+\s*\|[^|]+\|\s*Current:\s*\|[^|]+\|[^|]+\|\s*Current:\s*\|[^|]+\|'
        
        if not re.search(metrics_pattern, raw_text):
            return None
        
        result = {
            "asking_rents": {
                "current": {"per_unit": None, "per_sf": None},
                "last_quarter": {"per_unit": None, "per_sf": None},
                "year_ago": {"per_unit": None, "per_sf": None},
                "competitors": {"per_unit": None, "per_sf": None},
                "submarket": {"per_unit": None, "per_sf": None}
            },
            "vacancy": {
                "current": {"rate": None, "units": None},
                "last_quarter": {"rate": None, "units": None},
                "year_ago": {"rate": None, "units": None},
                "competitors": {"rate": None, "units": None},
                "submarket": {"rate": None, "units": None}
            },
            "absorption": {
                "current": None,
                "competitor_total": None,
                "competitor_avg": None,
                "submarket_total": None,
                "submarket_avg": None
            }
        }
        
        # Parse each row of the metrics table
        # Pattern: | Label: | Value | Value | Label: | Value | Value | Label: | Value |
        row_pattern = r'\|\s*([^|]+):\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+):\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+):\s*\|\s*([^|]+)\|'
        
        for match in re.finditer(row_pattern, raw_text):
            # ASKING RENTS (columns 1-3)
            rent_label = match.group(1).strip().lower()
            rent_per_unit = self._parse_currency(match.group(2).strip())
            rent_per_sf = self._parse_currency(match.group(3).strip())
            
            # VACANCY (columns 4-6)
            vacancy_label = match.group(4).strip().lower()
            vacancy_rate = self._parse_percentage(match.group(5).strip())
            vacancy_units = self._parse_units(match.group(6).strip())
            
            # ABSORPTION (columns 7-8)
            absorption_label = match.group(7).strip().lower()
            absorption_value = self._parse_units(match.group(8).strip())
            
            # Map to result structure
            rent_key = self._map_metric_label(rent_label)
            if rent_key and rent_key in result["asking_rents"]:
                result["asking_rents"][rent_key] = {
                    "per_unit": rent_per_unit,
                    "per_sf": rent_per_sf
                }
            
            vacancy_key = self._map_metric_label(vacancy_label)
            if vacancy_key and vacancy_key in result["vacancy"]:
                result["vacancy"][vacancy_key] = {
                    "rate": vacancy_rate,
                    "units": vacancy_units
                }
            
            absorption_key = self._map_absorption_label(absorption_label)
            if absorption_key:
                result["absorption"][absorption_key] = absorption_value
        
        return result
    
    def _map_metric_label(self, label: str) -> Optional[str]:
        """Map metric labels to standard keys."""
        label = label.lower().strip()
        mapping = {
            "current": "current",
            "last quarter": "last_quarter",
            "year ago": "year_ago",
            "competitors": "competitors",
            "submarket": "submarket"
        }
        return mapping.get(label)
    
    def _map_absorption_label(self, label: str) -> Optional[str]:
        """Map absorption labels to standard keys."""
        label = label.lower().strip()
        mapping = {
            "current": "current",
            "competitor total": "competitor_total",
            "competitor avg": "competitor_avg",
            "submarket total": "submarket_total",
            "submarket avg": "submarket_avg"
        }
        return mapping.get(label)
    
    def _parse_currency(self, value: str) -> Optional[float]:
        """Parse currency value like $1,456 or $1.50 /SF."""
        match = re.search(r'\$?([\d,]+(?:\.\d+)?)', value)
        if match:
            try:
                return float(match.group(1).replace(',', ''))
            except ValueError:
                pass
        return None
    
    def _parse_percentage(self, value: str) -> Optional[float]:
        """Parse percentage value like 9.7%."""
        match = re.search(r'([\d.]+)%?', value)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                pass
        return None
    
    def _parse_units(self, value: str) -> Optional[int]:
        """Parse units value like '14 Units' or '(10) Units'."""
        # Handle negative values in parentheses like (10) Units
        match = re.search(r'\(?([\d.]+)\)?\s*Units?', value, re.IGNORECASE)
        if match:
            try:
                num = float(match.group(1))
                # If it was in parentheses, it's negative
                if '(' in value:
                    num = -num
                return num
            except ValueError:
                pass
        return None
    
    def _format_unit_breakdown(self, tables: List[Dict]) -> List[Dict]:
        """Format unit breakdown tables to match expected schema."""
        formatted = []
        
        for table in tables:
            headers = table.get("headers", [])
            rows = table.get("rows", [])
            
            table_data = {
                "headers": headers,
                "column_types": table.get("column_types", {}),
                "rows": [],
                "summary": {
                    "total_units": 0,
                    "total_rows": len(rows)
                }
            }
            
            for row in rows:
                formatted_row = {}
                for header, value in row.items():
                    # Normalize header names
                    normalized_key = self._normalize_header(header)
                    formatted_row[normalized_key] = self._normalize_value(value)
                    
                    # Track totals
                    if "unit" in normalized_key.lower() and isinstance(value, (int, float)):
                        table_data["summary"]["total_units"] += int(value)
                
                table_data["rows"].append(formatted_row)
            
            formatted.append(table_data)
        
        return formatted
    
    def _format_expenses(self, tables: List[Dict]) -> List[Dict]:
        """Format expense tables."""
        formatted = []
        
        for table in tables:
            table_data = {
                "headers": table.get("headers", []),
                "rows": table.get("rows", []),
                "column_types": table.get("column_types", {})
            }
            formatted.append(table_data)
        
        return formatted
    
    def _extract_property_info(self, sections: List[Dict], raw_text: str) -> Dict[str, Any]:
        """Extract property information from sections and raw text."""
        property_info = {
            "no_of_units": None,
            "stories": None,
            "avg_unit_size": None,
            "year_built": None,
            "parking": None,
            "type": None,
            "rent_type": None,
        }
        
        # Search in sections
        property_sections = self._find_sections_by_type(sections, 'property')
        for section in property_sections:
            content = " ".join(section.get("content", []))
            self._extract_key_values(content, property_info)
        
        # Search in raw text as backup
        self._extract_key_values(raw_text, property_info)
        
        return property_info
    
    def _extract_owner_info(self, sections: List[Dict], raw_text: str) -> Dict[str, Any]:
        """Extract owner information."""
        owner_info = {
            "name": None,
            "purchase_date": None,
            "purchase_price": None,
        }
        
        owner_sections = self._find_sections_by_type(sections, 'owner')
        for section in owner_sections:
            content = " ".join(section.get("content", []))
            self._extract_key_values(content, owner_info)
        
        self._extract_key_values(raw_text, owner_info)
        
        return owner_info
    
    def _extract_rate_info(
        self,
        sections: List[Dict],
        raw_text: str,
        rate_type: str
    ) -> Dict[str, Any]:
        """Extract vacancy or absorption rate information."""
        rate_info = {
            "current": None,
            "last_quarter": None,
            "year_ago": None,
            "competitor_total": None,
            "submarket_total": None,
            "submarket_avg": None,
        }
        
        rate_sections = self._find_sections_by_type(sections, rate_type)
        for section in rate_sections:
            content = " ".join(section.get("content", []))
            self._extract_key_values(content, rate_info)
        
        return rate_info
    
    def _extract_amenities(self, sections: List[Dict], raw_text: str) -> List[str]:
        """Extract site amenities list."""
        amenities = []
        
        amenity_sections = self._find_sections_by_type(sections, 'amenities')
        for section in amenity_sections:
            for content in section.get("content", []):
                # Split by common delimiters
                items = re.split(r'[,\n•\-]', content)
                for item in items:
                    cleaned = item.strip()
                    if cleaned and len(cleaned) > 2:
                        amenities.append(cleaned)
        
        # Also search raw text for amenities pattern
        amenity_match = re.search(
            r'(?:SITE\s+)?AMENITIES[:\s]*(.+?)(?=\n\n|\Z)',
            raw_text,
            re.IGNORECASE | re.DOTALL
        )
        if amenity_match:
            items = re.split(r'[,\n•\-]', amenity_match.group(1))
            for item in items:
                cleaned = item.strip()
                if cleaned and len(cleaned) > 2 and cleaned not in amenities:
                    amenities.append(cleaned)
        
        return amenities
    
    def _extract_all_amenities(self, sections: List[Dict], raw_text: str, tables: List[Dict]) -> Dict[str, List[str]]:
        """
        Extract both site and unit amenities, handling markdown table format.
        
        Site Amenities often appear as markdown tables like:
        | 24 Hour Access | Business Center | Clubhouse |
        
        Unit Amenities typically appear as plain lists.
        """
        result = {
            "site": [],
            "unit": []
        }
        
        # Extract Site Amenities from raw_text markdown tables
        site_amenities_match = re.search(
            r'## SITE AMENITIES\s*\n([\s\S]*?)(?=\n## |\n<!-- image -->|$)',
            raw_text
        )
        if site_amenities_match:
            site_text = site_amenities_match.group(1)
            result["site"] = self._parse_amenities_from_text(site_text)
        
        # Also check tables for site amenities (table index 5 in the example)
        for table in tables:
            headers = table.get("headers", [])
            # Site amenities table often has numeric or empty headers
            if all(isinstance(h, int) or h == "" for h in headers):
                for row in table.get("rows", []):
                    for value in row.values():
                        if value and isinstance(value, str) and len(value) > 2:
                            if value not in result["site"]:
                                result["site"].append(value)
        
        # Extract Unit Amenities from sections
        unit_sections = [s for s in sections if "UNIT AMENITIES" in s.get("header", "").upper()]
        for section in unit_sections:
            for content in section.get("content", []):
                cleaned = content.strip()
                if cleaned and len(cleaned) > 2 and cleaned not in result["unit"]:
                    result["unit"].append(cleaned)
        
        # Also parse from raw_text
        unit_amenities_match = re.search(
            r'## UNIT AMENITIES\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)',
            raw_text
        )
        if unit_amenities_match:
            unit_text = unit_amenities_match.group(1)
            for line in unit_text.split('\n'):
                cleaned = line.strip()
                if cleaned and len(cleaned) > 2 and not cleaned.startswith('#') and cleaned not in result["unit"]:
                    result["unit"].append(cleaned)
        
        return result
    
    def _parse_amenities_from_text(self, text: str) -> List[str]:
        """Parse amenities from text that may contain markdown tables."""
        amenities = []
        
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            # Check if it's a markdown table row
            if '|' in line:
                # Parse markdown table cells
                cells = line.split('|')
                for cell in cells:
                    cleaned = cell.strip()
                    # Skip empty cells, separators, and headers
                    if cleaned and len(cleaned) > 2 and not cleaned.startswith('-'):
                        if cleaned not in amenities:
                            amenities.append(cleaned)
            else:
                # Plain text line
                if len(line) > 2 and not line.startswith('#'):
                    if line not in amenities:
                        amenities.append(line)
        
        return amenities
    
    def _extract_recurring_expenses(self, sections: List[Dict], raw_text: str) -> Dict[str, Any]:
        """
        Extract recurring expenses (utilities included in rent).
        
        Format in PDF: "Free Gas, Water, Electricity, Heat, Trash…"
        """
        expenses = {
            "utilities_included": [],
            "description": None
        }
        
        # Search in sections
        recurring_sections = [s for s in sections if "RECURRING EXPENSES" in s.get("header", "").upper()]
        for section in recurring_sections:
            for content in section.get("content", []):
                self._parse_recurring_expense(content, expenses)
        
        # Search in raw_text
        recurring_match = re.search(
            r'## RECURRING EXPENSES\s*\n([\s\S]*?)(?=\n## |$)',
            raw_text
        )
        if recurring_match:
            expense_text = recurring_match.group(1).strip()
            self._parse_recurring_expense(expense_text, expenses)
        
        return expenses
    
    def _parse_recurring_expense(self, text: str, expenses: Dict) -> None:
        """Parse recurring expense text like 'Free Gas, Water, Electricity, Heat, Trash…'."""
        text = text.strip()
        if not text:
            return
        
        # Store the full description
        if not expenses["description"]:
            expenses["description"] = text
        
        # Common utilities to look for
        utilities = [
            "gas", "water", "electricity", "electric", "heat", "heating",
            "trash", "garbage", "sewer", "cable", "internet", "wifi"
        ]
        
        text_lower = text.lower()
        for utility in utilities:
            if utility in text_lower and utility not in [u.lower() for u in expenses["utilities_included"]]:
                # Capitalize for display
                expenses["utilities_included"].append(utility.capitalize())
    
    def _extract_one_time_expenses(self, sections: List[Dict], raw_text: str) -> Dict[str, Any]:
        """
        Extract one time expenses like Admin Fee, Application Fee.
        
        Format in PDF: "Admin Fee $200", "Application Fee $50"
        """
        expenses = {}
        
        # Search in sections
        expense_sections = [s for s in sections if "ONE TIME EXPENSES" in s.get("header", "").upper()]
        for section in expense_sections:
            for content in section.get("content", []):
                self._parse_expense_item(content, expenses)
        
        # Search in raw_text
        expense_match = re.search(
            r'## ONE TIME EXPENSES\s*\n([\s\S]*?)(?=\n## |\nPET POLICY|$)',
            raw_text
        )
        if expense_match:
            expense_text = expense_match.group(1)
            for line in expense_text.split('\n'):
                self._parse_expense_item(line, expenses)
        
        return expenses
    
    def _parse_expense_item(self, text: str, expenses: Dict) -> None:
        """Parse a single expense item like 'Admin Fee $200'."""
        text = text.strip()
        if not text:
            return
        
        # Pattern: "Admin Fee $200" or "Application Fee $50"
        admin_match = re.search(r'Admin\s*Fee\s*\$?([\d,]+)', text, re.IGNORECASE)
        if admin_match:
            expenses["admin_fee"] = float(admin_match.group(1).replace(',', ''))
        
        app_match = re.search(r'Application\s*Fee\s*\$?([\d,]+)', text, re.IGNORECASE)
        if app_match:
            expenses["application_fee"] = float(app_match.group(1).replace(',', ''))
        
        deposit_match = re.search(r'Deposit\s*\$?([\d,]+)', text, re.IGNORECASE)
        if deposit_match:
            expenses["deposit"] = float(deposit_match.group(1).replace(',', ''))
    
    def _extract_pet_policy(self, sections: List[Dict], raw_text: str) -> Dict[str, Any]:
        """
        Extract pet policy information.
        
        Format: "Dog Allowed", "Cat Allowed"
        """
        policy = {
            "dogs_allowed": False,
            "cats_allowed": False,
            "restrictions": []
        }
        
        # Search in raw_text
        pet_match = re.search(
            r'PET POLICY\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)',
            raw_text
        )
        if pet_match:
            pet_text = pet_match.group(1).lower()
            
            if 'dog allowed' in pet_text or 'dogs allowed' in pet_text:
                policy["dogs_allowed"] = True
            if 'cat allowed' in pet_text or 'cats allowed' in pet_text:
                policy["cats_allowed"] = True
            if 'no pets' in pet_text:
                policy["dogs_allowed"] = False
                policy["cats_allowed"] = False
            
            # Look for restrictions
            restriction_patterns = [
                r'breed restrictions?',
                r'weight limit',
                r'max (\d+) pets?',
                r'pet deposit',
                r'pet rent'
            ]
            for pattern in restriction_patterns:
                match = re.search(pattern, pet_text, re.IGNORECASE)
                if match:
                    policy["restrictions"].append(match.group(0))
        
        return policy
    
    def _find_sections_by_type(
        self,
        sections: List[Dict],
        section_type: str
    ) -> List[Dict]:
        """Find sections matching a type based on header patterns."""
        matching = []
        patterns = self.SECTION_PATTERNS.get(section_type, [])
        
        for section in sections:
            header = section.get("header", "")
            for pattern in patterns:
                if re.search(pattern, header, re.IGNORECASE):
                    matching.append(section)
                    break
        
        return matching
    
    def _extract_key_values(self, text: str, target: Dict[str, Any]) -> None:
        """Extract key-value pairs from text into target dict."""
        
        # Common extraction patterns
        patterns = {
            "no_of_units": [
                r'(\d+)\s*(?:Units?|Apartments?)',
                r'Property\s+Size[:\s]*(\d+)',
            ],
            "stories": [
                r'(\d+)\s*(?:Stor(?:y|ies)|Floor)',
            ],
            "avg_unit_size": [
                r'Avg\.?\s*Unit\s*Size[:\s]*(\d+(?:,\d+)?)\s*SF',
                r'Average\s*(?:Unit\s*)?Size[:\s]*(\d+)',
            ],
            "year_built": [
                r'Year\s*Built[:\s]*(\d{4})',
                r'Built\s*(?:in\s*)?(\d{4})',
            ],
            "parking": [
                r'Parking[:\s]*(.+?)(?:\n|$)',
            ],
            "name": [
                r'Owner[:\s]*(.+?)(?:\n|$)',
                r'Property\s*Manager[:\s]*(.+?)(?:\n|$)',
            ],
            "purchase_date": [
                r'Purchase\s*Date[:\s]*(.+?)(?:\n|$)',
                r'Acquired[:\s]*(.+?)(?:\n|$)',
            ],
            "purchase_price": [
                r'Purchase\s*Price[:\s]*(\$[\d,]+(?:\s*\([^)]+\))?)',
                r'Sale\s*Price[:\s]*(\$[\d,]+)',
            ],
            "current": [
                r'Current[:\s]*([\d.]+%?\s*(?:Units?)?)',
            ],
            "submarket_total": [
                r'Submarket(?:\s*Total)?[:\s]*([\d,]+\s*(?:Units?)?)',
            ],
            "submarket_avg": [
                r'Submarket\s*Avg[:\s]*([\d.]+\s*(?:Units?)?)',
            ],
        }
        
        for key, key_patterns in patterns.items():
            if key in target and target[key] is None:
                for pattern in key_patterns:
                    match = re.search(pattern, text, re.IGNORECASE)
                    if match:
                        target[key] = match.group(1).strip()
                        break
    
    def _normalize_header(self, header: str) -> str:
        """Normalize table header to consistent format."""
        # Convert to camelCase
        words = re.split(r'[\s_\-]+', str(header).strip())
        if not words:
            return header
        
        result = words[0].lower()
        for word in words[1:]:
            result += word.capitalize()
        
        return result
    
    def _normalize_value(self, value: Any) -> Any:
        """Normalize a value (handle currency, percentages, etc.)."""
        if value is None:
            return None
        
        if isinstance(value, (int, float)):
            return value
        
        value_str = str(value).strip()
        
        # Handle special cases
        if value_str == '-' or value_str.lower() == 'n/a':
            return None
        
        # Try to extract numeric value
        # Currency: $1,234.56
        currency_match = re.match(r'\$?([\d,]+(?:\.\d+)?)', value_str.replace(',', ''))
        if currency_match:
            try:
                return float(currency_match.group(1))
            except ValueError:
                pass
        
        # Percentage: 10.5%
        percent_match = re.match(r'([\d.]+)%', value_str)
        if percent_match:
            try:
                return float(percent_match.group(1))
            except ValueError:
                pass
        
        return value_str


def transform_docling_output(docling_output: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to transform Docling output.
    
    Args:
        docling_output: Raw output from DoclingProcessor.process()
        
    Returns:
        Transformed output matching existing schema
    """
    transformer = DoclingTransformer()
    return transformer.transform(docling_output)


if __name__ == "__main__":
    # Test with sample data
    import json
    import sys
    
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            docling_output = json.load(f)
        
        result = transform_docling_output(docling_output)
        print(json.dumps(result, indent=2, default=str))

