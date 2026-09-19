"""
Docling PDF Processor - Processes the bounded property-summary portion of a CoStar report.

This processor:
- Processes every page in resumable batches of 4 to 10 pages
- Detects CoStar section headers via OCR/text extraction
- Groups pages, tables, and content by detected section
- Outputs separate JSON files per section

Section detection is based on common CoStar report headers that appear at the top of pages.
"""

import json
import sys
import logging
import os
import uuid
import re
import inspect
import hashlib
from importlib.metadata import version
import pypdfium2 as pdfium
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat, ConversionStatus
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    EasyOcrOptions,
    TableFormerMode,
)
from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling_core.types.doc import DocItemLabel, TextItem, TableItem

if __package__:
    from src.services.processors.report_evidence import ReportEvidence, atomic_json
    from src.services.processors.costar_page_selector import select_property_summary_end
    from src.services.processors.costar_scoring_preflight import extract_scoring_metrics
else:
    from report_evidence import ReportEvidence, atomic_json
    from costar_page_selector import select_property_summary_end
    from costar_scoring_preflight import extract_scoring_metrics

# Configure logging to stderr so stdout is clean for JSON output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger('docling_full_processor')


# CoStar section patterns - keys are section slugs, values are lists of possible header variations
# Order matters: first match wins, so more specific patterns should come first
COSTAR_SECTIONS = {
    "subject_property": [
        "Subject Property",
        "Property Summary", 
        "Property Overview",
        "Property Details"
    ],
    "rent_comps": [
        "Rent Comps",
        "Rent Comparables",
        "Rental Comparables",
        "Comparable Rentals",
        "Lease Comps"
    ],
    "construction": [
        "Construction",
        "Under Construction",
        "Pipeline",
        "Development Pipeline",
        "New Construction"
    ],
    "sale_comps": [
        "Sale Comps",
        "Sale Comparables",
        "Sales Comparables",
        "Comparable Sales",
        "Recent Sales"
    ],
    "demographics": [
        "Demographics",
        "Population",
        "Demographic Analysis",
        "Area Demographics"
    ],
    "submarket_report": [
        "Submarket Report",
        "Submarket Analysis",
        "Submarket Overview",
        "Multi-Family Submarket"
    ],
    "market_report": [
        "Market Report",
        "Market Analysis",
        "Market Overview",
        "Multi-Family Market"
    ]
}

# Human-readable section names
SECTION_NAMES = {
    "subject_property": "Subject Property",
    "rent_comps": "Rent Comparables",
    "construction": "Construction",
    "sale_comps": "Sale Comparables",
    "demographics": "Demographics",
    "submarket_report": "Submarket Report",
    "market_report": "Market Report",
    "unknown": "Unknown Section"
}


class DoclingFullProcessor:
    """
    Full PDF processor using Docling for ML-based document understanding.
    
    Processes every page in bounded batches and groups content by detected sections.
    
    Features:
    - Batch checkpoints retain completed work after interruptions
    - Section detection via OCR text analysis
    - Per-section JSON output files
    - Page-level provenance tracking
    - Table extraction with section assignment
    """
    
    def __init__(
        self,
        do_ocr: bool = True,
        table_mode: str = "accurate",
        num_threads: int = 4,
        ocr_languages: List[str] = None,
        ocr_confidence_threshold: float = 0.5,
        max_pages: int = 10,
    ):
        """
        Initialize the Docling full processor with configurable options.
        
        Args:
            do_ocr: Enable OCR for scanned documents
            table_mode: "accurate" (slower, better) or "fast" (faster, less accurate)
            num_threads: Number of threads for processing
            ocr_languages: List of language codes for OCR (default: ["en"])
            ocr_confidence_threshold: Minimum confidence for OCR results
            max_pages: Maximum pages per batch (4-10)
        """
        if not isinstance(max_pages, int) or not 4 <= max_pages <= 10:
            raise ValueError(f"max_pages must be an integer from 4 to 10; received {max_pages}")

        self.do_ocr = do_ocr
        self.table_mode = TableFormerMode.ACCURATE if table_mode == "accurate" else TableFormerMode.FAST
        self.num_threads = num_threads
        self.ocr_languages = ocr_languages or ["en"]
        self.ocr_confidence_threshold = ocr_confidence_threshold
        self.max_pages = max_pages
        
        # Initialize the converter with configured options
        self.converter = self._create_converter()

    def _create_converter(self) -> DocumentConverter:
        """Create and configure the DocumentConverter with pipeline options."""
        
        # Configure PDF pipeline options
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = self.do_ocr
        pipeline_options.do_table_structure = True

        # TODO(local-runtime): The destination-machine provisioner must populate
        # this directory before the app starts. Keeping artifacts explicit stops
        # Docling from reaching the network during document processing.
        artifacts_path = os.environ.get("DOCLING_ARTIFACTS_PATH")
        if artifacts_path:
            pipeline_options.artifacts_path = Path(artifacts_path)
        
        # Configure OCR with EasyOCR
        if self.do_ocr:
            pipeline_options.ocr_options = EasyOcrOptions(
                lang=self.ocr_languages,
                confidence_threshold=self.ocr_confidence_threshold
            )
        
        # Configure table extraction with TableFormer
        pipeline_options.table_structure_options.mode = self.table_mode
        pipeline_options.table_structure_options.do_cell_matching = True
        
        # Configure hardware acceleration
        pipeline_options.accelerator_options = AcceleratorOptions(
            num_threads=self.num_threads,
            device=AcceleratorDevice.AUTO  # Auto-detect GPU/CPU (uses MPS on Mac)
        )
        
        # Create converter with PDF format options
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
        
        return converter
    
    def _detect_section_from_text(self, text: str) -> Optional[str]:
        """
        Detect which CoStar section a piece of text belongs to.
        
        Args:
            text: Text content to analyze
            
        Returns:
            Section slug if detected, None otherwise
        """
        if not text:
            return None
            
        text_upper = text.upper()
        
        # Check each section's patterns
        for section_slug, patterns in COSTAR_SECTIONS.items():
            for pattern in patterns:
                if text_upper.strip() == pattern.upper() or text_upper.strip().startswith(pattern.upper() + " "):
                    return section_slug
        
        return None
    
    def _get_page_section(self, page_text_items: List[Dict], page_headers: List[Dict]) -> str:
        """
        Determine which section a page belongs to based on its content.
        
        Prioritizes headers at the top of the page, then scans text items.
        
        Args:
            page_text_items: List of text items on the page
            page_headers: List of headers on the page
            
        Returns:
            Section slug
        """
        # First check headers (most reliable)
        for header in page_headers:
            section = self._detect_section_from_text(header.get("text", ""))
            if section:
                return section
        
        # Check first few text items (section indicators are usually at top)
        for item in page_text_items[:5]:
            section = self._detect_section_from_text(item.get("text", ""))
            if section:
                return section
        
        # If no section detected, return unknown
        return "unknown"
    
    def process(self, file_path: str, output_dir: str) -> Dict[str, Any]:
        """Capture the entire Report; batch size is a compute limit, never a page ceiling."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        evidence = ReportEvidence(file_path, output_dir, {
            "batch_pages": self.max_pages, "ocr": self.do_ocr, "table_mode": str(self.table_mode),
            "docling_version": version('docling'), "docling_core_version": version('docling-core'),
            "capture_code": hashlib.sha256(''.join(inspect.getsource(method) for method in
                [self._create_converter, self._extract_pages, self._extract_tables, self._detect_column_types]).encode()).hexdigest(),
            "artifact_manifest": hashlib.sha256((Path(os.environ['DOCLING_ARTIFACTS_PATH']) / 'serafina-artifacts.manifest.json').read_bytes()).hexdigest(),
        })
        report = evidence.inventory()
        base_filename = Path(file_path).stem + '_' + uuid.uuid4().hex[:12]
        evidence_path = output_path / f'e_{base_filename}_report.json'
        atomic_json(evidence_path, report)
        native_texts = [page['native_text'] for page in report['pages']]
        scoring_metrics = extract_scoring_metrics(native_texts)
        summary_end = select_property_summary_end(native_texts[:self.max_pages], ceiling=self.max_pages)
        all_pages, all_tables = {}, []
        total = len(report['pages'])
        for start in range(1, total + 1, self.max_pages):
            end = min(total, start + self.max_pages - 1)
            logger.info(f'Report batch {start}-{end} of {total}')
            batch = evidence.load_batch(start, end)
            if batch is not None:
                logger.info(f'Reusing verified checkpoint {start}-{end}')
            if batch is None:
                try:
                    result = self.converter.convert(file_path, page_range=(start, end))
                    if result.status != ConversionStatus.SUCCESS:
                        raise ValueError(f'Incomplete Docling batch: {result.status}; {result.errors}')
                    doc = result.document
                    pages = self._extract_pages(doc)
                    tables = self._extract_tables(doc)
                    batch = {'start': start, 'end': end, 'status': 'success',
                             'pages': pages, 'tables': tables, 'document': doc.export_to_dict()}
                    evidence.save_batch(batch)
                except Exception as error:
                    report['warnings'].append({'start': start, 'end': end, 'error': str(error)})
                    for page in report['pages'][start-1:end]:
                        page['layout_status'] = 'failed'
                    atomic_json(evidence_path, report)
                    continue
            pages = {int(key): value for key, value in batch['pages'].items()}
            # Docling provenance uses original 1-based page numbers, even for a range.
            if any(number < start or number > end for number in pages):
                raise ValueError('Docling returned page provenance outside the requested range')
            all_pages.update(pages)
            for table in batch['tables']:
                table['table_id'] = f"p{table['page_number']}-b{start}-t{table['table_index']}"
                all_tables.append(table)
            for page in report['pages'][start-1:end]:
                extracted = pages.get(page['page_number'], {})
                page['layout_status'] = 'complete'
                page['text_items'] = extracted.get('text_items', [])
                page['headers'] = extracted.get('headers', [])
                page['layout_text'] = '\n'.join(extracted.get('raw_text_parts', []))
                page['document_batch'] = str(evidence.cache / f'{start}-{end}.json')
                if any(t.get('error') and t['page_number'] == page['page_number'] for t in batch['tables']):
                    page['reading_status'] = 'requires_visual_review'
                if not page['native_text'].strip() and not page['layout_text'].strip():
                    page['reading_status'] = 'requires_visual_review'
            report['coverage'] = self._coverage(report)
            atomic_json(evidence_path, report)
        # Include native evidence on pages where layout failed, without certifying structure.
        for page in report['pages']:
            all_pages.setdefault(page['page_number'], {'page_number': page['page_number'],
                'text_items': [], 'headers': [], 'tables': [], 'raw_text_parts': [page['native_text']]})
        page_sections = self._assign_report_sections(report['pages'], all_pages)
        for page in report['pages']:
            number = page['page_number']
            if number <= summary_end and page_sections[number] == 'unknown':
                page_sections[number] = 'subject_property'
            page['section'] = page_sections[number]
        sections_data = self._group_by_section(all_pages, all_tables, page_sections)
        for slug in ('demographics', 'submarket_report'):
            sections_data.setdefault(slug, {'pages': [], 'tables': [], 'raw_text': '', 'start_page': None, 'end_page': None})
        section_files, summaries = [], []
        for slug, content in sections_data.items():
            category = 'submarket' if slug == 'submarket_report' else slug
            metrics = scoring_metrics.get(category, {}) if category in ('demographics', 'submarket') else {}
            if not content['pages'] and not metrics:
                continue
            section = {'section': slug, 'section_name': SECTION_NAMES.get(slug, slug),
                       'page_range': {'start': content['start_page'], 'end': content['end_page']},
                       'pages': content['pages'], 'tables': content['tables'], 'raw_text': content['raw_text'],
                       'scoring_metrics': metrics,
                       'scoring_evidence': {k.split('.', 1)[1]: v for k, v in scoring_metrics['evidence'].items() if k.startswith(category + '.')},
                       'scoring_conflicts': {k.split('.', 1)[1]: v for k, v in scoring_metrics['conflicts'].items() if k.startswith(category + '.')},
                       'metadata': {'source_file': Path(file_path).name, 'source_sha256': evidence.source_hash,
                                    'processor': 'docling_full', 'evidence_file': evidence_path.name, 'coverage': self._coverage(report)}}
            section_path = output_path / f'e_{base_filename}_{slug}.json'
            atomic_json(section_path, section)
            section_files.append(str(section_path))
            summaries.append({'section': slug, 'file_path': str(section_path), 'page_count': len(content['pages']),
                              'table_count': len(content['tables']), 'page_range': section['page_range']})
        report['tables'] = all_tables
        report['scoring'] = scoring_metrics
        report['coverage'] = self._coverage(report)
        report['section_files'] = section_files
        atomic_json(evidence_path, report)
        return {'processing_status': 'success' if report['coverage']['status'] == 'complete' else 'partial_success',
                'metadata': {'page_count': total, 'processed_page_count': report['coverage']['layout_pages'],
                             'source_sha256': evidence.source_hash, 'pipeline_fingerprint': evidence.fingerprint},
                'evidence_file': str(evidence_path), 'coverage': report['coverage'],
                'section_files': section_files, 'sections': summaries, 'warnings': report['warnings']}

    def _assign_report_sections(self, report_pages, extracted_pages):
        """Classify section starts, never table-of-contents references or prose mentions."""
        assignments, current = {}, 'unknown'
        for page in report_pages:
            number = page['page_number']
            text = page['native_text'] or page.get('layout_text', '')
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            if any('TABLE OF CONTENTS' in line.upper() for line in lines[:8]):
                assignments[number] = 'unknown'
                continue
            candidates = lines[:3]
            if any(line.upper() == 'PREPARED BY' for line in lines[:10]):
                candidates = lines[:10]
            cover = next((line for line in candidates if line.lower() in
                ['multi-family submarket report', 'multi-family market report']), None)
            if cover:
                current = 'submarket_report' if 'submarket' in cover.lower() else 'market_report'
            elif current not in ('submarket_report', 'market_report'):
                for line in candidates:
                    if re.fullmatch(r'Demographic(?:s| Overview)', line, re.I):
                        current = 'demographics'
                        break
                    detected = self._detect_section_from_text(line)
                    # Report scopes require cover evidence; a TOC-like label cannot start one.
                    if detected in ('submarket_report', 'market_report'):
                        continue
                    if detected and not (detected == 'subject_property' and current not in ('unknown', 'subject_property')):
                        current = detected
                        break
            assignments[number] = current
        return assignments

    def _coverage(self, report):
        pages = report['pages']
        completed = [p['page_number'] for p in pages if p['layout_status'] == 'complete']
        unresolved = [p['page_number'] for p in pages if p['layout_status'] != 'complete' or p.get('reading_status') == 'requires_visual_review']
        return {'status': 'complete' if not unresolved else 'partial', 'total_pages': len(pages),
                'native_text_pages': sum(bool(p['native_text'].strip()) for p in pages),
                'layout_pages': len(completed), 'unresolved_pages': unresolved,
                'semantic_validation': 'not_certified',
                'next_action': 'Review image-only pages or retry failed batches' if unresolved else None}

    def _extract_pages(self, doc) -> Dict[int, Dict[str, Any]]:
        """Extract content organized by page."""
        pages = {}
        
        # Iterate through all items and organize by page
        for item, level in doc.iterate_items():
            page_num = 1  # Default to page 1
            
            # Get page number from provenance
            if hasattr(item, 'prov') and item.prov and len(item.prov) > 0:
                page_num = item.prov[0].page_no if hasattr(item.prov[0], 'page_no') else 1
            
            if page_num not in pages:
                pages[page_num] = {
                    "page_number": page_num,
                    "text_items": [],
                    "tables": [],
                    "headers": [],
                    "raw_text_parts": []
                }
            
            # Categorize the item
            if isinstance(item, TextItem):
                text = item.text if hasattr(item, 'text') else ""
                pages[page_num]["raw_text_parts"].append(text)
                
                if hasattr(item, 'label') and item.label == DocItemLabel.SECTION_HEADER:
                    pages[page_num]["headers"].append({
                        "text": text,
                        "level": level,
                        "provenance": [p.model_dump(mode="json") for p in item.prov]
                    })
                else:
                    pages[page_num]["text_items"].append({
                        "text": text,
                        "label": str(item.label) if hasattr(item, 'label') else "text",
                        "level": level,
                        "provenance": [p.model_dump(mode="json") for p in item.prov]
                    })
            elif isinstance(item, TableItem):
                # Tables are extracted separately but we track their page location
                pages[page_num]["tables"].append({
                    "table_ref": item.self_ref,
                    "level": level
                })
        
        return pages
    
    def _extract_tables(self, doc) -> List[Dict[str, Any]]:
        """
        Extract all tables with headers, columns, and data.
        
        Each table is automatically separated by Docling (each TableItem is distinct).
        """
        tables = []
        
        for table_idx, table in enumerate(doc.tables):
            try:
                # Export to DataFrame for easy manipulation
                df = table.export_to_dataframe(doc=doc)
                
                # Get headers (column names)
                original_headers = [str(h) for h in df.columns]
                headers = []
                for index, header in enumerate(original_headers):
                    headers.append(header if original_headers.count(header) == 1 and header else f"{header or 'column'} [{index + 1}]")
                cells = df.fillna('').values.tolist()
                df.columns = headers
                
                # Convert rows to list of dicts
                rows = df.to_dict(orient="records")
                
                # Detect column types
                column_types = self._detect_column_types(df)
                
                # Get page number from provenance
                page_num = 1
                if hasattr(table, 'prov') and table.prov and len(table.prov) > 0:
                    page_num = table.prov[0].page_no if hasattr(table.prov[0], 'page_no') else 1
                
                table_data = {
                    "table_index": table_idx,
                    "page_number": page_num,
                    "headers": headers,
                    "original_headers": original_headers,
                    "cells": cells,
                    "provenance": [p.model_dump(mode="json") for p in table.prov],
                    "structure": table.data.model_dump(mode="json"),
                    "column_types": column_types,
                    "rows": rows,
                    "row_count": len(df),
                    "column_count": len(df.columns),
                    "markdown": df.to_markdown() if len(df) > 0 else "",
                    "html": table.export_to_html(doc=doc) if hasattr(table, 'export_to_html') else None
                }
                
                tables.append(table_data)
                
            except Exception as e:
                logger.warning(f"Error extracting table {table_idx}: {str(e)}")
                tables.append({
                    "table_index": table_idx,
                    "page_number": 1,
                    "error": str(e)
                })
        
        return tables
    
    def _detect_column_types(self, df) -> Dict[str, str]:
        """
        Detect the type of data in each column.
        
        Types: numeric, currency, percentage, text, empty
        """
        column_types = {}
        
        for col in df.columns:
            values = df[col].dropna().astype(str).tolist()
            
            if not values:
                column_types[col] = "empty"
                continue
            
            # Check for currency ($ prefix)
            if all(v.strip().startswith('$') or v.strip() == '' for v in values):
                column_types[col] = "currency"
            # Check for percentage (% suffix)
            elif all(v.strip().endswith('%') or v.strip() == '' for v in values):
                column_types[col] = "percentage"
            # Check for numeric
            elif all(self._is_numeric(v) for v in values):
                column_types[col] = "numeric"
            else:
                column_types[col] = "text"
        
        return column_types
    
    def _is_numeric(self, value: str) -> bool:
        """Check if a string value is numeric."""
        try:
            clean = value.replace(',', '').replace(' ', '').strip()
            if clean == '' or clean == '-' or clean.lower() == 'n/a':
                return True
            float(clean)
            return True
        except ValueError:
            return False
    
    def _assign_page_sections(self, pages: Dict[int, Dict]) -> Dict[int, str]:
        """
        Assign each page to a section based on its content.
        
        Uses a "sticky" approach where section assignment persists until
        a new section is detected.
        
        Args:
            pages: Dictionary of page data keyed by page number
            
        Returns:
            Dictionary mapping page number to section slug
        """
        page_sections = {}
        current_section = "unknown"
        
        for page_num in sorted(pages.keys()):
            page_data = pages[page_num]
            
            # Try to detect section from this page's content
            detected_section = self._get_page_section(
                page_data.get("text_items", []),
                page_data.get("headers", [])
            )
            
            # Update current section if a new one is detected
            if detected_section != "unknown":
                current_section = detected_section
            
            page_sections[page_num] = current_section
            logger.debug(f"Page {page_num} assigned to section: {current_section}")
        
        return page_sections
    
    def _group_by_section(
        self,
        pages: Dict[int, Dict],
        tables: List[Dict],
        page_sections: Dict[int, str]
    ) -> Dict[str, Dict]:
        """
        Group pages and tables by their assigned section.
        
        Args:
            pages: Dictionary of page data
            tables: List of table data
            page_sections: Mapping of page numbers to sections
            
        Returns:
            Dictionary of section data keyed by section slug
        """
        sections_data = {}
        
        # Initialize all possible sections
        for section_slug in list(COSTAR_SECTIONS.keys()) + ["unknown"]:
            sections_data[section_slug] = {
                "pages": [],
                "tables": [],
                "raw_text": "",
                "start_page": None,
                "end_page": None
            }
        
        # Group pages by section
        for page_num in sorted(pages.keys()):
            section = page_sections.get(page_num, "unknown")
            page_data = pages[page_num]
            
            # Clean page data for output (remove internal fields)
            clean_page = {
                "page_number": page_data["page_number"],
                "text_items": page_data["text_items"],
                "headers": page_data["headers"],
                "table_count": len(page_data["tables"])
            }
            
            sections_data[section]["pages"].append(clean_page)
            
            # Accumulate raw text
            raw_text_parts = page_data.get("raw_text_parts", [])
            sections_data[section]["raw_text"] += "\n".join(raw_text_parts) + "\n\n"
            
            # Track page range
            if sections_data[section]["start_page"] is None:
                sections_data[section]["start_page"] = page_num
            sections_data[section]["end_page"] = page_num
        
        # Group tables by section (based on their page number)
        for table in tables:
            page_num = table.get("page_number", 1)
            section = page_sections.get(page_num, "unknown")
            sections_data[section]["tables"].append(table)
        
        # Remove empty sections
        sections_data = {
            slug: data for slug, data in sections_data.items()
            if data["pages"] or data["tables"]
        }
        
        return sections_data


def main():
    """CLI entry point for processing PDFs."""
    if len(sys.argv) < 3:
        print(json.dumps({
            "processing_status": "error",
            "error_message": "Usage: python docling_full_processor.py <pdf_path> <output_dir> [max_pages]"
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Check file exists
    if not Path(pdf_path).exists():
        print(json.dumps({
            "processing_status": "error",
            "error_message": f"File not found: {pdf_path}"
        }))
        sys.exit(1)
    
    # Process the bounded leading page range.
    max_pages = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    processor = DoclingFullProcessor(max_pages=max_pages)
    result = processor.process(pdf_path, output_dir)
    
    # Output JSON to stdout
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
