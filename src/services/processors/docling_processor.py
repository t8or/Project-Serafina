"""
Docling PDF Processor - Alternative OCR solution using Docling's ML-based document understanding.

This processor leverages Docling's TableFormer model for accurate table structure detection
and EasyOCR for text extraction from scanned documents.
"""

import json
import sys
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat, ConversionStatus
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    EasyOcrOptions,
    TableFormerMode,
)
from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling_core.types.doc import DocItemLabel, TextItem, TableItem

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('docling_processor')


class DoclingProcessor:
    """
    PDF processor using Docling for ML-based document understanding.
    
    Features:
    - EasyOCR integration for scanned document text extraction
    - TableFormer model for accurate table structure detection
    - Automatic table separation (each TableItem is distinct)
    - Page-level provenance tracking
    - Multiple export formats (JSON, Markdown, DataFrame)
    """
    
    def __init__(
        self,
        do_ocr: bool = True,
        table_mode: str = "accurate",
        max_pages: Optional[int] = None,
        max_file_size: Optional[int] = None,
        num_threads: int = 4,
        ocr_languages: List[str] = None,
        ocr_confidence_threshold: float = 0.5
    ):
        """
        Initialize the Docling processor with configurable options.
        
        Args:
            do_ocr: Enable OCR for scanned documents
            table_mode: "accurate" (slower, better) or "fast" (faster, less accurate)
            max_pages: Maximum number of pages to process (None for all)
            max_file_size: Maximum file size in bytes (None for no limit)
            num_threads: Number of threads for processing
            ocr_languages: List of language codes for OCR (default: ["en"])
            ocr_confidence_threshold: Minimum confidence for OCR results
        """
        self.do_ocr = do_ocr
        self.table_mode = TableFormerMode.ACCURATE if table_mode == "accurate" else TableFormerMode.FAST
        self.max_pages = max_pages
        self.max_file_size = max_file_size
        self.num_threads = num_threads
        self.ocr_languages = ocr_languages or ["en"]
        self.ocr_confidence_threshold = ocr_confidence_threshold
        
        # Initialize the converter with configured options
        self.converter = self._create_converter()
        
    def _create_converter(self) -> DocumentConverter:
        """Create and configure the DocumentConverter with pipeline options."""
        
        # Configure PDF pipeline options
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = self.do_ocr
        pipeline_options.do_table_structure = True
        
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
    
    def process(self, file_path: str) -> Dict[str, Any]:
        """
        Process a PDF file and extract structured content.
        
        Args:
            file_path: Path to the PDF file
            
        Returns:
            Dictionary containing:
            - processing_status: "success" or "error"
            - metadata: File and processing metadata
            - pages: List of page content with text and tables
            - tables: All extracted tables with headers and data
            - sections: Document sections with headers
            - raw_text: Full document text
        """
        try:
            logger.info(f"Processing PDF with Docling: {file_path}")
            
            # Convert the document
            convert_kwargs = {}
            # Use page_range instead of max_num_pages (max_num_pages causes "invalid document" error)
            if self.max_pages:
                convert_kwargs['page_range'] = (1, self.max_pages)
            if self.max_file_size:
                convert_kwargs['max_file_size'] = self.max_file_size
                
            result = self.converter.convert(file_path, **convert_kwargs)
            
            # Check conversion status
            if result.status == ConversionStatus.FAILURE:
                return {
                    "processing_status": "error",
                    "error_message": "Document conversion failed",
                    "errors": [str(e) for e in result.errors] if result.errors else []
                }
            
            doc = result.document
            
            # Extract metadata
            metadata = self._extract_metadata(result, file_path)
            
            # Extract pages with content
            pages = self._extract_pages(doc, result)
            
            # Extract all tables
            tables = self._extract_tables(doc, result)
            
            # Extract section headers
            sections = self._extract_sections(doc)
            
            # Get full document text
            raw_text = doc.export_to_markdown()
            
            # Build result
            output = {
                "processing_status": "success" if result.status == ConversionStatus.SUCCESS else "partial_success",
                "metadata": metadata,
                "pages": pages,
                "tables": tables,
                "sections": sections,
                "raw_text": raw_text,
                "docling_json": doc.export_to_dict()  # Full Docling output for reference
            }
            
            if result.status == ConversionStatus.PARTIAL_SUCCESS:
                output["warnings"] = [str(e) for e in result.errors] if result.errors else []
            
            logger.info(f"Successfully processed PDF: {len(pages)} pages, {len(tables)} tables")
            return output
            
        except Exception as e:
            logger.error(f"Error processing PDF: {str(e)}")
            return {
                "processing_status": "error",
                "error_message": str(e)
            }
    
    def _extract_metadata(self, result, file_path: str) -> Dict[str, Any]:
        """Extract document metadata."""
        return {
            "file_name": Path(file_path).name,
            "file_path": str(file_path),
            "file_size": result.input.filesize if hasattr(result.input, 'filesize') else None,
            "page_count": result.input.page_count if hasattr(result.input, 'page_count') else None,
            "format": str(result.input.format) if hasattr(result.input, 'format') else "PDF",
            "processor": "docling",
            "ocr_enabled": self.do_ocr,
            "table_mode": "accurate" if self.table_mode == TableFormerMode.ACCURATE else "fast"
        }
    
    def _extract_pages(self, doc, result) -> List[Dict[str, Any]]:
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
                    "headers": []
                }
            
            # Categorize the item
            if isinstance(item, TextItem):
                if hasattr(item, 'label') and item.label == DocItemLabel.SECTION_HEADER:
                    pages[page_num]["headers"].append({
                        "text": item.text,
                        "level": level
                    })
                else:
                    pages[page_num]["text_items"].append({
                        "text": item.text,
                        "label": str(item.label) if hasattr(item, 'label') else "text",
                        "level": level
                    })
            elif isinstance(item, TableItem):
                # Tables are extracted separately but we track their page location
                pages[page_num]["tables"].append({
                    "table_ref": id(item),  # Reference for matching with extracted tables
                    "level": level
                })
        
        # Convert to list sorted by page number
        return [pages[p] for p in sorted(pages.keys())]
    
    def _extract_tables(self, doc, result) -> List[Dict[str, Any]]:
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
            # Remove common formatting
            clean = value.replace(',', '').replace(' ', '').strip()
            if clean == '' or clean == '-' or clean.lower() == 'n/a':
                return True  # Allow empty/placeholder values
            float(clean)
            return True
        except ValueError:
            return False
    
    def _extract_sections(self, doc) -> List[Dict[str, Any]]:
        """Extract document sections with headers."""
        sections = []
        current_section = None
        
        for item, level in doc.iterate_items():
            if hasattr(item, 'label') and item.label == DocItemLabel.SECTION_HEADER:
                # Save previous section
                if current_section:
                    sections.append(current_section)
                
                # Start new section
                page_num = 1
                if hasattr(item, 'prov') and item.prov and len(item.prov) > 0:
                    page_num = item.prov[0].page_no if hasattr(item.prov[0], 'page_no') else 1
                
                current_section = {
                    "header": item.text,
                    "level": level,
                    "page_number": page_num,
                    "content": []
                }
            elif current_section and isinstance(item, TextItem):
                current_section["content"].append(item.text)
        
        # Add last section
        if current_section:
            sections.append(current_section)
        
        return sections


def main():
    """CLI entry point for processing PDFs."""
    if len(sys.argv) < 2:
        print(json.dumps({
            "processing_status": "error",
            "error_message": "Usage: python docling_processor.py <pdf_path> [max_pages]"
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else None
    
    # Check file exists
    if not Path(pdf_path).exists():
        print(json.dumps({
            "processing_status": "error",
            "error_message": f"File not found: {pdf_path}"
        }))
        sys.exit(1)
    
    # Process the PDF
    processor = DoclingProcessor(max_pages=max_pages)
    result = processor.process(pdf_path)
    
    # Output JSON to stdout
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()

