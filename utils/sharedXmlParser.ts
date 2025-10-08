// Shared XML parser configuration and utilities
import { XMLParser } from 'fast-xml-parser';

/**
 * Shared XML parser configuration options
 */
export const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTrueNumberOnly: false,
  arrayMode: false,
  parseTagValue: true,
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
  commentPropName: '__comment',
  unpairedTags: [],
  stopNodes: [],
  alwaysCreateTextNode: false
};

/**
 * Create a configured XML parser instance
 */
export function createXMLParser() {
  return new XMLParser(XML_PARSER_OPTIONS);
}

/**
 * Parse XML content using shared configuration
 */
export function parseXML(xmlContent: string) {
  const parser = createXMLParser();
  return parser.parse(xmlContent);
}



