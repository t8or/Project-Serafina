import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { OllamaService } from './ollama_service.js';
import { PDFProcessor } from './processors/pdf_processor.js';
import { ImageProcessor } from './processors/image_processor.js';
import { CSVProcessor } from './processors/csv_processor.js';
import { ExcelProcessor } from './processors/excel_processor.js';
import { DoclingProcessor } from './processors/docling_bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Available PDF processor types
const PDF_PROCESSOR_TYPES = {
  DEFAULT: 'default',    // Pattern-based + Ollama LLM (existing)
  DOCLING: 'docling'     // Docling ML-based (alternative)
};

class FileProcessor {
  constructor(outputDir = 'processed_files', options = {}) {
    this.outputDir = outputDir;
    this.ollamaService = new OllamaService();
    
    // Default PDF processor type (can be overridden per-request)
    this.defaultPdfProcessor = options.pdfProcessor || PDF_PROCESSOR_TYPES.DEFAULT;
    
    // Initialize specialized processors
    this.processors = {
      pdf: new PDFProcessor(this.ollamaService),
      pdf_docling: new DoclingProcessor(options.doclingOptions || {}),
      image: new ImageProcessor(this.ollamaService),
      csv: new CSVProcessor(this.ollamaService),
      excel: new ExcelProcessor(this.ollamaService)
    };
    
    // Ensure output directory exists
    this.initializeOutputDir();
  }

  async initializeOutputDir() {
    try {
      const fullOutputPath = path.join(process.cwd(), this.outputDir);
      await fs.mkdir(fullOutputPath, { recursive: true });
      console.log('Output directory initialized:', fullOutputPath);
    } catch (error) {
      console.error('Error initializing output directory:', error);
    }
  }

  async saveResults(result, originalFilePath) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const originalFileName = path.basename(originalFilePath, path.extname(originalFilePath));
      const outputFileName = `${originalFileName}_analysis_${timestamp}.json`;
      const outputPath = path.join(process.cwd(), this.outputDir, outputFileName);
      
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
      console.log('Results saved to:', outputPath);
      return outputPath;
    } catch (error) {
      console.error('Error saving results:', error);
      throw error;
    }
  }

  extractPropertyData(text) {
    return {
      property_name: this.extractPattern(text, /Property Name\/Address[^\n]*\n([^\n]+)/, 1) || 
                    this.extractPattern(text, /^([^,\n]+)(?=\s*Apartments|\s*Property|\s*Complex)/, 1),
      address: this.extractPattern(text, /(\d+[^,\n]+(?:St|Rd|Pky|Blvd|Ave|Dr|Ln|Way)[^,\n]*)/, 1),
      city: this.extractPattern(text, /(?:St|Rd|Pky|Blvd|Ave|Dr|Ln|Way)[^,\n]*,\s*([^,\n]+)/, 1),
      state: this.extractPattern(text, /,\s*([A-Z]{2})\s*\d{5}/, 1),
      zip: this.extractPattern(text, /\b(\d{5})\b/, 1),
      owner: this.extractPattern(text, /Owner:\s*([^\n]+)/, 1) ||
             this.extractPattern(text, /Owner\/Manager:\s*([^\n]+)/, 1),
      year_built: this.extractPattern(text, /Year Built:\s*(\d{4})/, 1) ||
                  this.extractPattern(text, /Built in\s*(\d{4})/, 1),
      number_of_units: this.extractPattern(text, /Property Size:\s*(\d+)\s*Units/, 1) ||
                      this.extractPattern(text, /(\d+)\s*(?:Units|Apartments)/, 1),
      number_of_floors: this.extractPattern(text, /(\d+)\s*(?:Floor|Story|Stories)/, 1),
      average_unit_size: this.extractPattern(text, /Avg\.\s*Unit\s*Size:\s*(\d+)\s*SF/, 1) ||
                        this.extractPattern(text, /Average\s*Size:\s*(\d+)/, 1),
      vacancy_rate: this.extractPattern(text, /Vacancy\s*(\d+\.?\d*%)/, 1),
      rent_per_sf: this.extractPattern(text, /Rent\/SF\s*\$(\d+\.?\d*)/, 1),
      unit_mix: {
        studio: this.extractPattern(text, /Studio[^\n]*?(\d+)\s*Units?/, 1),
        one_bed: this.extractPattern(text, /1\s*Beds?\s*[^\n]*?(\d+)\s*Units?/, 1),
        two_bed: this.extractPattern(text, /2\s*Beds?\s*[^\n]*?(\d+)\s*Units?/, 1),
        three_bed: this.extractPattern(text, /3\s*Beds?\s*[^\n]*?(\d+)\s*Units?/, 1)
      },
      amenities: (text.match(/Amenities:([^\n]+)/) || [])[1]?.split(',').map(a => a.trim()) ||
                (text.match(/SITE AMENITIES\n([^\n]+)/) || [])[1]?.split(',').map(a => a.trim())
    };
  }

  async processImage(filePath) {
    try {
      console.log('Processing image:', filePath);
      
      // Verify file exists
      await fs.access(filePath);
      console.log('Image file exists');
      
      const text = await tesseract.recognize(filePath, {
        lang: 'eng',
        oem: 1,
        psm: 3
      });
      
      console.log('Tesseract processing completed');
      
      // Use Ollama to analyze the OCR text
      const analysis = await this.ollamaService.analyzePropertyData(text, 'image');
      
      const result = {
        processing_status: 'success',
        metadata: {
          file_type: 'image',
          file_name: path.basename(filePath)
        },
        ...analysis
      };

      await this.saveResults(result, filePath);
      return result;
    } catch (error) {
      console.error('Error processing image:', error);
      const result = {
        processing_status: 'error',
        error_message: `Error processing image: ${error.message}`
      };
      await this.saveResults(result, filePath);
      return result;
    }
  }

  async processPDF(filePath) {
    try {
      console.log('Processing PDF:', filePath);
      
      await fs.access(filePath);
      console.log('PDF file exists');
      
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer);
      console.log('PDF parsing completed');

      // Break the text into logical sections and rows
      const sections = this.breakPDFIntoSections(data.text);
      const tables = this.extractTables(data.text);
      
      const processedData = {
        text: data.text,
        sections,
        tables,
        metadata: {
          file_type: 'pdf',
          file_name: path.basename(filePath),
          page_count: data.numpages,
          creation_date: new Date().toISOString()
        }
      };

      const analysis = await this.ollamaService.analyzePropertyData(processedData, 'pdf');
      console.log('AI analysis completed');
      
      const result = {
        processing_status: 'success',
        metadata: processedData.metadata,
        analysis,
        sections: processedData.sections,  // Include structured sections
        tables: processedData.tables,      // Include structured tables
        raw_text: data.text               // Include original text for reference
      };

      await this.saveResults(result, filePath);
      return result;
    } catch (error) {
      console.error('Error processing PDF:', error);
      const result = {
        processing_status: 'error',
        error_message: `Error processing PDF: ${error.message}`
      };
      await this.saveResults(result, filePath);
      return result;
    }
  }

  extractTables(text) {
    const tables = [];
    const lines = text.split('\n');
    
    // CoStar-specific table detection patterns
    const tablePatterns = {
      unit_breakdown: /^(?:UNIT BREAKDOWN|Unit Mix|Bed\s+Bath\s+Avg SF)/i,
      metrics: /^(?:ASKING RENTS PER UNIT\/SF|VACANCY|12 MONTH ABSORPTION)/i,
      property: /^(?:PROPERTY|PROPERTY MANAGER|OWNER)/i
    };
    
    let currentTable = null;
    let tableType = null;

    const parseUnitBreakdownRow = (line) => {
      // Match patterns for unit breakdown rows
      const matches = line.match(/^(\d+)\s+(\d+)\s+(\d+(?:,\d+)?)\s+(\d+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+)%\s+\$?([\d,]+)\s+\$?([\d.]+)\s+\$?([\d,]+)\s+\$?([\d.]+)\s+([\d.]+)%/);
      if (matches) {
        const [_, beds, baths, avgSF, units, mixPercent, available, availablePercent, askingRent, askingRentSF, effectiveRent, effectiveRentSF, concessions] = matches;
        return {
          beds: parseInt(beds),
          baths: parseInt(baths),
          avg_sf: parseFloat(avgSF.replace(',', '')),
          units: parseInt(units),
          mix_percent: parseFloat(mixPercent),
          available: parseInt(available),
          available_percent: parseFloat(availablePercent),
          asking_rent: parseFloat(askingRent.replace(',', '')),
          asking_rent_sf: parseFloat(askingRentSF),
          effective_rent: parseFloat(effectiveRent.replace(',', '')),
          effective_rent_sf: parseFloat(effectiveRentSF),
          concessions: parseFloat(concessions)
        };
      }
      return null;
    };

    const parseMetricsRow = (line) => {
      // Match patterns for metrics rows (rents, vacancy, absorption)
      const parts = line.split(/\s{2,}/).filter(Boolean);
      if (parts.length >= 2) {
        const values = {};
        parts.forEach((part, index) => {
          const valueParts = part.split(/[\s$]+/);
          if (valueParts.length >= 2) {
            values[`value_${index + 1}`] = this.normalizeValue(valueParts[1]);
            if (valueParts[2]) {
              values[`value_${index + 1}_unit`] = valueParts[2];
            }
          } else {
            values[`value_${index + 1}`] = this.normalizeValue(part);
          }
        });
        return values;
      }
      return null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect table headers
      if (tablePatterns.unit_breakdown.test(line)) {
        if (currentTable) {
          tables.push(currentTable);
        }
        currentTable = {
          type: 'unit_breakdown',
          start_line: i,
          headers: [
            'Beds', 'Baths', 'Avg SF', 'Units', 'Mix %', 
            'Available', 'Available %', 'Asking Rent', 'Asking Rent/SF',
            'Effective Rent', 'Effective Rent/SF', 'Concessions'
          ],
          rows: [],
          summary: {
            total_units: 0,
            avg_unit_size: 0,
            total_available: 0,
            avg_asking_rent: 0
          }
        };
        tableType = 'unit_breakdown';
        continue;
      }

      if (tablePatterns.metrics.test(line)) {
        if (currentTable) {
          tables.push(currentTable);
        }
        currentTable = {
          type: 'metrics',
          start_line: i,
          headers: line.split(/\s{2,}/).filter(Boolean),
          rows: [],
          sections: {}
        };
        tableType = 'metrics';
        continue;
      }

      // Process table rows
      if (currentTable) {
        if (tableType === 'unit_breakdown') {
          const row = parseUnitBreakdownRow(line);
          if (row) {
            currentTable.rows.push(row);
            // Update summary
            currentTable.summary.total_units += row.units;
            currentTable.summary.total_available += row.available;
            currentTable.summary.avg_unit_size = (currentTable.summary.avg_unit_size * (currentTable.rows.length - 1) + row.avg_sf) / currentTable.rows.length;
            currentTable.summary.avg_asking_rent = (currentTable.summary.avg_asking_rent * (currentTable.rows.length - 1) + row.asking_rent) / currentTable.rows.length;
          }
        } else if (tableType === 'metrics') {
          const row = parseMetricsRow(line);
          if (row) {
            currentTable.rows.push(row);
          }
        }

        // Detect table end
        if (i === lines.length - 1 || 
            lines[i + 1]?.trim().match(/^(?:PROPERTY|ASKING RENTS|VACANCY|12 MONTH|={3,}|Updated|©)/)) {
          currentTable.end_line = i;
          tables.push(currentTable);
          currentTable = null;
          tableType = null;
        }
      }
    }

    // Add any remaining table
    if (currentTable) {
      currentTable.end_line = lines.length - 1;
      tables.push(currentTable);
    }

    return tables.map(table => ({
      ...table,
      summary: {
        ...table.summary,
        total_rows: table.rows.length,
        total_sections: Object.keys(table.sections || {}).length
      }
    }));
  }

  breakPDFIntoSections(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const sections = [];
    let currentSection = null;

    // Enhanced section patterns with subsection support
    const sectionPatterns = {
      property_summary: {
        main: /^(?:SUBJECT\s+PROPERTY|PROPERTY\s+SUMMARY|PROPERTY\s+PROFILE)/i,
        sub: [
          /^(?:PROPERTY\s+DESCRIPTION|PHYSICAL\s+DESCRIPTION)/i,
          /^(?:LOCATION\s+DESCRIPTION|SITE\s+DESCRIPTION)/i,
          /^(?:IMPROVEMENT\s+DESCRIPTION|BUILDING\s+DESCRIPTION)/i
        ]
      },
      location_market: {
        main: /^(?:LOCATION|MARKET\s+OVERVIEW|DEMOGRAPHICS)/i,
        sub: [
          /^(?:MARKET\s+CONDITIONS|MARKET\s+ANALYSIS)/i,
          /^(?:DEMOGRAPHIC\s+PROFILE|POPULATION)/i,
          /^(?:EMPLOYMENT|ECONOMIC\s+INDICATORS)/i
        ]
      },
      sales_data: {
        main: /^(?:SALE\s+COMPARABLES|SALES\s+HISTORY|TRANSACTION)/i,
        sub: [
          /^(?:COMPARABLE\s+SALES|RECENT\s+TRANSACTIONS)/i,
          /^(?:SALE\s+HISTORY|OWNERSHIP\s+HISTORY)/i,
          /^(?:MARKETING|LISTING\s+HISTORY)/i
        ]
      },
      property_features: {
        main: /^(?:UNIT\s+MIX|AMENITIES|FEATURES)/i,
        sub: [
          /^(?:UNIT\s+FEATURES|INTERIOR\s+FEATURES)/i,
          /^(?:COMMUNITY\s+AMENITIES|EXTERIOR\s+FEATURES)/i,
          /^(?:PARKING|UTILITIES|SYSTEMS)/i
        ]
      },
      financial: {
        main: /^(?:FINANCIAL|OPERATING\s+STATEMENTS|INCOME)/i,
        sub: [
          /^(?:INCOME|REVENUE|RENT\s+ROLL)/i,
          /^(?:EXPENSES|OPERATING\s+COSTS)/i,
          /^(?:CAPITAL|IMPROVEMENTS|REPAIRS)/i
        ]
      }
    };

    const identifyPattern = (line) => {
      for (const [type, patterns] of Object.entries(sectionPatterns)) {
        if (patterns.main.test(line)) {
          return { type, isMain: true };
        }
        for (const subPattern of patterns.sub) {
          if (subPattern.test(line)) {
            return { type, isMain: false };
          }
        }
      }
      return null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const patternMatch = identifyPattern(line);
      
      if (patternMatch) {
        if (currentSection) {
          // Process any tables in the current section before closing it
          const sectionText = currentSection.content.join('\n');
          currentSection.tables = this.extractTables(sectionText);
          sections.push(currentSection);
        }

        currentSection = {
          type: patternMatch.type,
          is_main_section: patternMatch.isMain,
          header: line,
          content: [],
          key_value_pairs: {},
          tables: [],
          start_line: i,
          subsections: []
        };
      } else if (currentSection) {
        // Add line to current section
        currentSection.content.push(line);
        
        // Try to extract key-value pairs
        const kvMatch = line.match(/^([^:]+):\s*(.+)$/);
        if (kvMatch) {
          const [_, key, value] = kvMatch;
          currentSection.key_value_pairs[key.trim()] = this.normalizeValue(value.trim());
        }

        // Look for list items
        if (/^[•\-\*]\s+/.test(line)) {
          if (!currentSection.list_items) currentSection.list_items = [];
          currentSection.list_items.push(line.replace(/^[•\-\*]\s+/, '').trim());
        }
      }
    }

    // Process the last section
    if (currentSection) {
      const sectionText = currentSection.content.join('\n');
      currentSection.tables = this.extractTables(sectionText);
      sections.push(currentSection);
    }

    return this.postProcessSections(sections);
  }

  postProcessSections(sections) {
    // Group subsections under their main sections
    const processedSections = [];
    let currentMainSection = null;

    for (const section of sections) {
      if (section.is_main_section) {
        if (currentMainSection) {
          processedSections.push(currentMainSection);
        }
        currentMainSection = section;
      } else if (currentMainSection) {
        currentMainSection.subsections.push(section);
      } else {
        processedSections.push(section);
      }
    }

    if (currentMainSection) {
      processedSections.push(currentMainSection);
    }

    // Add summary information to each section
    return processedSections.map(section => ({
      ...section,
      summary: {
        total_lines: section.content.length,
        key_value_pairs_count: Object.keys(section.key_value_pairs).length,
        tables_count: section.tables.length,
        list_items_count: section.list_items?.length || 0,
        subsections_count: section.subsections.length
      }
    }));
  }

  normalizeValue(value) {
    if (!value || typeof value !== 'string') return null;
    
    value = value.trim();
    
    // Handle special cases in CoStar reports
    if (value === '-' || value.toLowerCase() === 'n/a') return null;
    
    // Extract numbers from strings like "183 Units" or "863 SF"
    const numberMatch = value.match(/^(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:Units?|SF|Spaces?)?$/i);
    if (numberMatch) {
      return parseFloat(numberMatch[1].replace(/,/g, ''));
    }
    
    // Handle currency with per unit values like "$27,450,000 ($150,000/Unit)"
    const currencyMatch = value.match(/\$([0-9,]+(?:\.\d+)?)/);
    if (currencyMatch) {
      return parseFloat(currencyMatch[1].replace(/,/g, ''));
    }
    
    // Handle percentages
    if (value.endsWith('%')) {
      return parseFloat(value) / 100;
    }
    
    // Handle dates
    if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i.test(value)) {
      return new Date(value).toISOString().split('T')[0];
    }
    
    return value;
  }

  async processCSV(filePath) {
    try {
      console.log('Processing CSV:', filePath);
      
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      
      return new Promise((resolve, reject) => {
        parse(content, {
          columns: true,
          skip_empty_lines: true,
          cast: true,
          trim: true
        }, async (err, records) => {
          if (err) {
            reject({
              processing_status: 'error',
              error_message: `Error parsing CSV: ${err.message}`
            });
            return;
          }
          
          try {
            // Group records by their logical categories
            const structuredData = this.structureCSVData(records);
            
            // Use Ollama to analyze the structured data
            const analysis = await this.ollamaService.analyzePropertyData({
              raw_records: records,
              structured_data: structuredData,
              metadata: {
                file_type: 'csv',
                file_name: path.basename(filePath),
                total_records: records.length
              }
            }, 'csv');
            
            resolve({
              processing_status: 'success',
              metadata: {
                file_type: 'csv',
                file_name: path.basename(filePath),
                record_count: records.length,
                columns: Object.keys(records[0] || {}),
                categories: Object.keys(structuredData)
              },
              structured_data: structuredData,
              analysis
            });
          } catch (error) {
            reject({
              processing_status: 'error',
              error_message: `Error analyzing CSV data: ${error.message}`
            });
          }
        });
      });
    } catch (error) {
      console.error('Error processing CSV:', error);
      return {
        processing_status: 'error',
        error_message: `Error processing CSV: ${error.message}`
      };
    }
  }

  structureCSVData(records) {
    // Initialize categories
    const structured = {
      property_info: [],
      financial_data: [],
      unit_mix: [],
      amenities: [],
      location_data: [],
      other: []
    };

    // Helper function to categorize columns
    const categorizeColumn = (column) => {
      column = column.toLowerCase();
      if (/property|name|address|year|built|size|units?/.test(column)) return 'property_info';
      if (/price|income|expense|rent|rate|cost|value/.test(column)) return 'financial_data';
      if (/bed|bath|sqft|mix|floor\s*plan/.test(column)) return 'unit_mix';
      if (/amenity|feature|facility/.test(column)) return 'amenities';
      if (/location|market|area|region|city|state|zip/.test(column)) return 'location_data';
      return 'other';
    };

    // Process each record
    records.forEach(record => {
      const categorizedData = {
        property_info: {},
        financial_data: {},
        unit_mix: {},
        amenities: {},
        location_data: {},
        other: {}
      };

      // Categorize each field
      Object.entries(record).forEach(([key, value]) => {
        const category = categorizeColumn(key);
        categorizedData[category][key] = this.normalizeValue(value?.toString() || '');
      });

      // Add non-empty categories to structured data
      Object.entries(categorizedData).forEach(([category, data]) => {
        if (Object.keys(data).length > 0) {
          structured[category].push(data);
        }
      });
    });

    return structured;
  }

  async processExcel(filePath) {
    try {
      console.log('\n=== Excel Processing Start ===');
      console.log('Processing Excel file:', filePath);
      
      // Verify file exists
      await fs.access(filePath);
      console.log('Excel file exists and is accessible');
      
      const buffer = await fs.readFile(filePath);
      console.log('File read complete. Buffer size:', buffer.length);
      
      const workbook = XLSX.read(buffer);
      console.log('Workbook parsed successfully');
      
      // Process all sheets
      const sheets = [];
      
      for (const sheetName of workbook.SheetNames) {
        console.log(`Processing sheet: ${sheetName}`);
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        sheets.push({ sheetName, data });
      }

      // Use Ollama to analyze the Excel data
      const analysis = await this.ollamaService.analyzePropertyData(sheets, 'excel');
      
      return {
        processing_status: 'success',
        metadata: {
          file_type: 'excel',
          file_name: path.basename(filePath),
          sheets: sheets.map(sheet => ({
            name: sheet.sheetName,
            row_count: sheet.data.length,
            columns: sheet.data[0] ? Object.keys(sheet.data[0]) : []
          }))
        },
        ...analysis
      };
    } catch (error) {
      console.error('\n=== Excel Processing Error ===');
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      return {
        processing_status: 'error',
        error_message: `Error processing Excel file: ${error.message}`
      };
    }
  }

  /**
   * Get the appropriate processor for a file.
   * 
   * @param {string} filePath - Path to the file
   * @param {Object} options - Processing options
   * @param {string} options.pdfProcessor - PDF processor type: 'default' or 'docling'
   * @returns {Object} The processor instance
   */
  getProcessorForFile(filePath, options = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const pdfProcessorType = options.pdfProcessor || this.defaultPdfProcessor;
    
    switch (ext) {
      case '.pdf':
        // Select PDF processor based on option
        if (pdfProcessorType === PDF_PROCESSOR_TYPES.DOCLING) {
          console.log('[FileProcessor] Using Docling PDF processor');
          return this.processors.pdf_docling;
        }
        console.log('[FileProcessor] Using default PDF processor');
        return this.processors.pdf;
      case '.png':
      case '.jpg':
      case '.jpeg':
        return this.processors.image;
      case '.csv':
        return this.processors.csv;
      case '.xlsx':
      case '.xls':
        return this.processors.excel;
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }
  
  /**
   * Check if Docling processor is available.
   * 
   * @returns {Promise<Object>} Availability status
   */
  async checkDoclingAvailability() {
    try {
      return await this.processors.pdf_docling.bridge.checkAvailability();
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Process a file with the appropriate processor.
   * 
   * @param {string} filePath - Path to the file
   * @param {string|null} originalFilename - Original filename (optional)
   * @param {Object} options - Processing options
   * @param {string} options.pdfProcessor - PDF processor type: 'default' or 'docling'
   * @returns {Promise<Object>} Processing result
   */
  async process_file(filePath, originalFilename = null, options = {}) {
    try {
      console.log('Processing file:', filePath);
      console.log('Original filename:', originalFilename);
      console.log('Processing options:', options);
      
      // Verify file exists
      await fs.access(filePath);
      console.log('File exists and is accessible');
      
      // Get appropriate processor (pass options for PDF processor selection)
      const processor = this.getProcessorForFile(filePath, options);
      
      console.log('Selected processor:', processor.constructor.name);
      console.log('Starting file processing...');

      const result = await processor.process(filePath);
      console.log('File processing result:', result);

      if (result.processing_status === 'success') {
        console.log('Processing successful, preparing to save results...');

        try {
          // Ensure output directory exists
          const fullOutputDir = path.join(process.cwd(), this.outputDir);
          await fs.mkdir(fullOutputDir, { recursive: true });
          console.log('Output directory ensured:', fullOutputDir);

          // Use original filename if provided, otherwise use the temp filename
          const baseFilename = originalFilename 
            ? path.basename(originalFilename, path.extname(originalFilename))
            : path.basename(filePath, path.extname(filePath));

          // Create output path using original name
          const outputPath = path.join(
            fullOutputDir,
            `e_${baseFilename}.json`
          );

          console.log('Saving results to:', outputPath);

          // Include original filename in metadata and ensure it's preserved
          // Also track which processor was used
          const pdfProcessorType = options.pdfProcessor || this.defaultPdfProcessor;
          const resultWithMetadata = {
            ...result,
            metadata: {
              ...result.metadata,
              original_filename: originalFilename,
              base_filename: baseFilename,
              output_filename: `e_${baseFilename}.json`,
              processor_used: processor.constructor.name,
              pdf_processor_type: path.extname(filePath).toLowerCase() === '.pdf' ? pdfProcessorType : undefined
            }
          };

          await fs.writeFile(outputPath, JSON.stringify(resultWithMetadata, null, 2));
          console.log('Results successfully saved.');

          return {
            ...resultWithMetadata,
            output_path: outputPath,
            original_filename: originalFilename
          };
        } catch (saveError) {
          console.error('Error saving results:', saveError);
          return {
            processing_status: 'error',
            error_message: `Error saving results: ${saveError.message}`
          };
        }
      } else {
        console.log('Processing failed or returned an unexpected result.');
      }

    } catch (error) {
      console.error('Error processing file:', error);
      console.error('Error stack:', error.stack);
      return {
        processing_status: 'error',
        error_message: `Error processing file: ${error.message}`
      };
    }
  }
}

export { FileProcessor, PDF_PROCESSOR_TYPES }; 