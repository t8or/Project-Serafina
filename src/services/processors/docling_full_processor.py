"""
Docling PDF Processor - Processes the bounded property-summary portion of a CoStar report.

This processor:
- Processes at most the first 10 pages (configurable down to 4)
- Detects CoStar section headers via OCR/text extraction
- Groups pages, tables, and content by detected section
- Outputs separate JSON files per section

Section detection is based on common CoStar report headers that appear at the top of pages.
"""

import json
import sys
import logging
import os
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
    from src.services.processors.costar_page_selector import select_property_summary_end
    from src.services.processors.costar_scoring_preflight import extract_scoring_metrics
else:
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
    
    Processes a bounded leading page range and groups content by detected sections.
    
    Features:
    - Hard page ceiling keeps long report appendices out of the ML pipeline
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
            max_pages: Maximum leading PDF pages to process (4-10)
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

    def _native_preflight(self, file_path: str) -> tuple[int, Dict[str, Any]]:
        """Select subject pages and collect score inputs without document ML."""
        try:
            pdf = pdfium.PdfDocument(file_path)
            try:
                page_count = len(pdf)
                page_texts = []
                for page_index in range(page_count):
                    page = pdf[page_index]
                    text_page = page.get_textpage()
                    try:
                        page_texts.append(text_page.get_text_bounded())
                    finally:
                        text_page.close()
                        page.close()
            finally:
                pdf.close()

            selected_page_limit = select_property_summary_end(
                page_texts[:self.max_pages],
                ceiling=self.max_pages,
            )
            scoring_metrics = extract_scoring_metrics(page_texts)
            if selected_page_limit < min(page_count, self.max_pages):
                logger.info(
                    "Detected complete CoStar subject-property coverage through "
                    f"page {selected_page_limit}"
                )
            if scoring_metrics.get("demographics") or scoring_metrics.get("submarket"):
                logger.info(
                    "Found native scoring inputs on pages "
                    f"{scoring_metrics.get('demographics_page')} and "
                    f"{scoring_metrics.get('submarket_page')}"
                )
            return selected_page_limit, scoring_metrics
        except Exception as error:
            logger.warning(f"PDF page preflight failed; using {self.max_pages}-page ceiling: {error}")
            return self.max_pages, {
                "demographics": {},
                "submarket": {},
                "demographics_page": None,
                "submarket_page": None,
            }

    def _select_page_limit(self, file_path: str) -> int:
        """Compatibility seam for page-selection tests and callers."""
        return self._native_preflight(file_path)[0]

    def _write_native_scoring_sections(
        self,
        output_path: Path,
        base_filename: str,
        source_file: str,
        scoring_metrics: Dict[str, Any],
    ) -> tuple[List[str], List[Dict[str, Any]]]:
        """Persist small, provenance-bearing scoring sections for the JS pipeline."""
        section_files = []
        section_summary = []
        section_specs = (
            ("demographics", "demographics_page"),
            ("submarket_report", "submarket_page"),
        )

        for section_slug, page_key in section_specs:
            metrics = scoring_metrics.get(
                "submarket" if section_slug == "submarket_report" else section_slug,
                {},
            )
            source_page = scoring_metrics.get(page_key)
            if not metrics or not source_page:
                continue

            section_output = {
                "section": section_slug,
                "section_name": SECTION_NAMES[section_slug],
                "page_range": {"start": source_page, "end": source_page},
                "pages": [],
                "tables": [],
                "raw_text": "",
                "scoring_metrics": metrics,
                "metadata": {
                    "source_file": Path(source_file).name,
                    "source_page": source_page,
                    "extraction_date": datetime.now().isoformat(),
                    "processor": "native_text_scoring_preflight",
                },
            }
            section_filename = f"e_{base_filename}_{section_slug}.json"
            section_filepath = output_path / section_filename
            with open(section_filepath, 'w', encoding='utf-8') as output_file:
                json.dump(section_output, output_file, indent=2, default=str)

            section_files.append(str(section_filepath))
            section_summary.append({
                "section": section_slug,
                "section_name": SECTION_NAMES[section_slug],
                "file_path": str(section_filepath),
                "page_count": 1,
                "table_count": 0,
                "page_range": {"start": source_page, "end": source_page},
                "processor": "native_text_scoring_preflight",
            })
            logger.info(
                f"Wrote native scoring section: {section_filename} "
                f"(source page {source_page})"
            )

        return section_files, section_summary
        
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
                if pattern.upper() in text_upper:
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
        """
        Process a PDF file and extract structured content grouped by section.
        
        Args:
            file_path: Path to the PDF file
            output_dir: Directory to write section JSON files
            
        Returns:
            Dictionary containing:
            - processing_status: "success" or "error"
            - metadata: File and processing metadata
            - sections: Summary of detected sections with file paths
            - section_files: List of generated section file paths
        """
        try:
            logger.info(f"Processing full PDF with Docling: {file_path}")
            
            # Ensure output directory exists
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            selected_page_limit, scoring_metrics = self._native_preflight(file_path)

            # CoStar property fields live in the leading summary pages. Later
            # comparison and market-report appendices are intentionally excluded
            # from the expensive layout/OCR/table pipeline.
            result = self.converter.convert(file_path, page_range=(1, selected_page_limit))
            
            # Check conversion status
            if result.status == ConversionStatus.FAILURE:
                return {
                    "processing_status": "error",
                    "error_message": "Document conversion failed",
                    "errors": [str(e) for e in result.errors] if result.errors else []
                }
            
            doc = result.document
            
            # Extract base metadata
            metadata = self._extract_metadata(result, file_path, selected_page_limit)
            
            # Extract pages with content
            pages = self._extract_pages(doc)
            
            # Extract all tables
            tables = self._extract_tables(doc)
            
            # Assign sections to pages
            page_sections = self._assign_page_sections(pages)
            
            # Group content by section
            sections_data = self._group_by_section(pages, tables, page_sections)
            
            # Generate base filename for outputs
            base_filename = Path(file_path).stem
            
            # Write section files and collect paths
            section_files = []
            section_summary = []
            
            for section_slug, section_content in sections_data.items():
                # Skip unknown sections with no content
                if section_slug == "unknown" and not section_content["pages"]:
                    continue
                
                # Create section output
                section_output = {
                    "section": section_slug,
                    "section_name": SECTION_NAMES.get(section_slug, section_slug),
                    "page_range": {
                        "start": section_content["start_page"],
                        "end": section_content["end_page"]
                    },
                    "pages": section_content["pages"],
                    "tables": section_content["tables"],
                    "raw_text": section_content["raw_text"],
                    "metadata": {
                        "source_file": Path(file_path).name,
                        "total_pages_in_section": len(section_content["pages"]),
                        "total_tables_in_section": len(section_content["tables"]),
                        "extraction_date": datetime.now().isoformat(),
                        "processor": "docling_full"
                    }
                }
                
                # Write section file
                section_filename = f"e_{base_filename}_{section_slug}.json"
                section_filepath = output_path / section_filename
                
                with open(section_filepath, 'w', encoding='utf-8') as f:
                    json.dump(section_output, f, indent=2, default=str)
                
                section_files.append(str(section_filepath))
                section_summary.append({
                    "section": section_slug,
                    "section_name": SECTION_NAMES.get(section_slug, section_slug),
                    "file_path": str(section_filepath),
                    "page_count": len(section_content["pages"]),
                    "table_count": len(section_content["tables"]),
                    "page_range": {
                        "start": section_content["start_page"],
                        "end": section_content["end_page"]
                    }
                })
                
                logger.info(f"Wrote section file: {section_filename} ({len(section_content['pages'])} pages)")

            scoring_files, scoring_summary = self._write_native_scoring_sections(
                output_path,
                base_filename,
                file_path,
                scoring_metrics,
            )
            section_files.extend(scoring_files)
            section_summary.extend(scoring_summary)
            
            # Build summary result
            output = {
                "processing_status": "success" if result.status == ConversionStatus.SUCCESS else "partial_success",
                "metadata": {
                    **metadata,
                    "processed_page_count": len(pages),
                    "total_sections": len(section_files),
                    "scoring_preflight_pages": {
                        "demographics": scoring_metrics.get("demographics_page"),
                        "submarket": scoring_metrics.get("submarket_page"),
                    },
                    "output_directory": str(output_path)
                },
                "sections": section_summary,
                "section_files": section_files
            }
            
            if result.status == ConversionStatus.PARTIAL_SUCCESS:
                output["warnings"] = [str(e) for e in result.errors] if result.errors else []
            
            logger.info(
                f"Successfully processed PDF: {len(pages)} of "
                f"{metadata.get('page_count', 'unknown')} pages, {len(section_files)} sections"
            )
            return output
            
        except Exception as e:
            logger.error(f"Error processing PDF: {str(e)}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {
                "processing_status": "error",
                "error_message": str(e)
            }
    
    def _extract_metadata(self, result, file_path: str, selected_page_limit: int) -> Dict[str, Any]:
        """Extract document metadata."""
        return {
            "file_name": Path(file_path).name,
            "file_path": str(file_path),
            "file_size": result.input.filesize if hasattr(result.input, 'filesize') else None,
            "page_count": result.input.page_count if hasattr(result.input, 'page_count') else None,
            "format": str(result.input.format) if hasattr(result.input, 'format') else "PDF",
            "processor": "docling_full",
            "ocr_enabled": self.do_ocr,
            "table_mode": "accurate" if self.table_mode == TableFormerMode.ACCURATE else "fast",
            "page_limit": selected_page_limit,
            "page_ceiling": self.max_pages,
        }
    
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
                        "level": level
                    })
                else:
                    pages[page_num]["text_items"].append({
                        "text": text,
                        "label": str(item.label) if hasattr(item, 'label') else "text",
                        "level": level
                    })
            elif isinstance(item, TableItem):
                # Tables are extracted separately but we track their page location
                pages[page_num]["tables"].append({
                    "table_ref": id(item),
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
                headers = list(df.columns)
                
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
