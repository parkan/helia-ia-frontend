// XML Parser utility functions
import { XMLParser } from 'fast-xml-parser';

// Configure XML parser options
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTrueNumberOnly: false,
  arrayMode: false,
  parseTagValue: true,
  parseAttributeValue: true,
  ignoreNameSpace: false,
  removeNSPrefix: false,
  allowBooleanAttributes: true,
  parseNodeValue: true,
  ignoreDeclaration: false,
  ignorePiTags: false,
  transformTagName: false,
  transformAttributeName: false,
  processEntities: true,
  htmlEntities: false,
  ignoreRootElement: false,
  cdataTagName: '__cdata',
  cdataPositionChar: '\\c',
  preserveOrder: false,
  commentPropName: false,
  unpairedTags: [],
  stopNodes: [],
  alwaysCreateTextNode: false
};

const parser = new XMLParser(parserOptions);

/**
 * Parse XML content and return JavaScript object
 * @param {string} xmlContent - Raw XML content
 * @returns {Object} Parsed XML as JavaScript object
 */
export function parseXML(xmlContent) {
  try {
    const result = parser.parse(xmlContent);
    return result;
  } catch (error) {
    console.error('XML parsing error:', error);
    throw new Error(`Failed to parse XML: ${error.message}`);
  }
}

/**
 * Extract file information from Internet Archive _files.xml content
 * @param {Object} parsedXml - Parsed XML object
 * @returns {Array} Array of file information objects
 */
export function extractFilesInfo(parsedXml) {
  try {
    const files = [];
    
    // Handle Internet Archive files.xml structure
    if (parsedXml.files && parsedXml.files.file) {
      const fileNodes = Array.isArray(parsedXml.files.file) 
        ? parsedXml.files.file 
        : [parsedXml.files.file];
      
      fileNodes.forEach(file => {
        const fileInfo = {
          // Basic file attributes
          name: file['@_name'],
          source: file['@_source'], // 'original' or 'derivative'
          
          // File properties (from child elements)
          mtime: file.mtime ? parseInt(file.mtime) : null,
          size: file.size ? parseInt(file.size) : null,
          format: file.format || null,
          
          // Checksums
          md5: file.md5 || null,
          crc32: file.crc32 || null,
          sha1: file.sha1 || null,
          
          // Optional fields
          viruscheck: file.viruscheck ? parseInt(file.viruscheck) : null,
          original: file.original || null, // For derivative files
          
          // OCR fields (for text derivatives)
          ocr: file.ocr || null,
          ocr_parameters: file.ocr_parameters || null,
          ocr_module_version: file.ocr_module_version || null,
          ocr_autonomous: file.ocr_autonomous === 'true',
          ocr_detected_script: file.ocr_detected_script || null,
          ocr_detected_script_conf: file.ocr_detected_script_conf ? parseFloat(file.ocr_detected_script_conf) : null,
          ocr_detected_lang: file.ocr_detected_lang || null,
          ocr_detected_lang_conf: file.ocr_detected_lang_conf ? parseFloat(file.ocr_detected_lang_conf) : null
        };
        
        files.push(fileInfo);
      });
    }
    
    return files;
  } catch (error) {
    console.error('Error extracting files info:', error);
    throw new Error(`Failed to extract files info: ${error.message}`);
  }
}

/**
 * Extract metadata from Internet Archive _meta.xml content
 * @param {Object} parsedXml - Parsed XML object
 * @returns {Object} Metadata object
 */
export function extractMetadata(parsedXml) {
  try {
    const metadata = {};
    
    // Handle Internet Archive metadata.xml structure
    if (parsedXml.metadata) {
      const meta = parsedXml.metadata;
      
      // Basic identification fields
      metadata.identifier = meta.identifier || null;
      metadata.title = meta.title || null;
      metadata.mediatype = meta.mediatype || null;
      
      // Creator and content fields
      metadata.creator = meta.creator || null;
      metadata.description = meta.description || null;
      metadata.scanner = meta.scanner || null;
      metadata.uploader = meta.uploader || null;
      
      // Date fields
      metadata.publicdate = meta.publicdate || null;
      metadata.addeddate = meta.addeddate || null;
      metadata.updatedate = meta.updatedate || null;
      
      // Archive-specific fields
      metadata.curation = meta.curation || null;
      metadata.identifier_access = meta['identifier-access'] || null;
      metadata.identifier_ark = meta['identifier-ark'] || null;
      
      // Processing fields
      metadata.ppi = meta.ppi ? parseInt(meta.ppi) : null;
      
      // OCR processing fields
      metadata.ocr = meta.ocr || null;
      metadata.ocr_parameters = meta.ocr_parameters || null;
      metadata.ocr_module_version = meta.ocr_module_version || null;
      metadata.ocr_autonomous = meta.ocr_autonomous === 'true';
      
      // PDF processing fields  
      metadata.pdf_degraded = meta.pdf_degraded || null;
      metadata.pdf_module_version = meta.pdf_module_version || null;
      
      // Page processing fields
      metadata.page_number_confidence = meta.page_number_confidence ? parseFloat(meta.page_number_confidence) : null;
      metadata.page_number_module_version = meta.page_number_module_version || null;
      
      // Handle multi-value fields that can appear multiple times
      
      // Collections (can be multiple)
      if (meta.collection) {
        metadata.collections = Array.isArray(meta.collection) ? meta.collection : [meta.collection];
        metadata.collection = metadata.collections[0]; // Primary collection
      }
      
      // Subjects (can be multiple)
      if (meta.subject) {
        metadata.subjects = Array.isArray(meta.subject) ? meta.subject : [meta.subject];
        metadata.subject = metadata.subjects[0]; // Primary subject
      }
      
      // OCR detected scripts (can be multiple)
      if (meta.ocr_detected_script) {
        metadata.ocr_detected_scripts = Array.isArray(meta.ocr_detected_script) ? meta.ocr_detected_script : [meta.ocr_detected_script];
        metadata.ocr_detected_script = metadata.ocr_detected_scripts[0]; // Primary script
      }
      
      // OCR detected script confidences (can be multiple)
      if (meta.ocr_detected_script_conf) {
        const confidences = Array.isArray(meta.ocr_detected_script_conf) ? meta.ocr_detected_script_conf : [meta.ocr_detected_script_conf];
        metadata.ocr_detected_script_confidences = confidences.map(conf => parseFloat(conf));
        metadata.ocr_detected_script_conf = metadata.ocr_detected_script_confidences[0]; // Primary confidence
      }
      
      // OCR detected languages
      if (meta.ocr_detected_lang) {
        metadata.ocr_detected_langs = Array.isArray(meta.ocr_detected_lang) ? meta.ocr_detected_lang : [meta.ocr_detected_lang];
        metadata.ocr_detected_lang = metadata.ocr_detected_langs[0]; // Primary language
      }
      
      // OCR detected language confidences
      if (meta.ocr_detected_lang_conf) {
        const langConfidences = Array.isArray(meta.ocr_detected_lang_conf) ? meta.ocr_detected_lang_conf : [meta.ocr_detected_lang_conf];
        metadata.ocr_detected_lang_confidences = langConfidences.map(conf => parseFloat(conf));
        metadata.ocr_detected_lang_conf = metadata.ocr_detected_lang_confidences[0]; // Primary language confidence
      }
      
      // Collection added fields
      if (meta.collection_added) {
        metadata.collections_added = Array.isArray(meta.collection_added) ? meta.collection_added : [meta.collection_added];
        metadata.collection_added = metadata.collections_added[0]; // Primary collection added
      }
    }
    
    return metadata;
  } catch (error) {
    console.error('Error extracting metadata:', error);
    throw new Error(`Failed to extract metadata: ${error.message}`);
  }
}

/**
 * Process a complete XML file pair (files + meta)
 * @param {string} filesXmlContent - Content of _files.xml
 * @param {string} metaXmlContent - Content of _meta.xml
 * @returns {Object} Combined processed data
 */
export function processXmlPair(filesXmlContent, metaXmlContent) {
  try {
    const parsedFiles = parseXML(filesXmlContent);
    const parsedMeta = parseXML(metaXmlContent);
    
    const filesInfo = extractFilesInfo(parsedFiles);
    const metadata = extractMetadata(parsedMeta);
    
    return {
      metadata,
      files: filesInfo,
      rawParsedFiles: parsedFiles,
      rawParsedMeta: parsedMeta
    };
  } catch (error) {
    console.error('Error processing XML pair:', error);
    throw new Error(`Failed to process XML pair: ${error.message}`);
  }
}

/**
 * Validate XML content
 * @param {string} xmlContent - Raw XML content
 * @returns {boolean} True if valid XML
 */
export function validateXML(xmlContent) {
  try {
    parser.parse(xmlContent);
    return true;
  } catch (error) {
    console.error('XML validation failed:', error);
    return false;
  }
} 