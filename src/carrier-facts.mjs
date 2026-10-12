import { posix } from "node:path";
import { readMarkdownFrontmatter } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter";
import { readMarkdownSource } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-structure";
import { projectMarkdownFeatures } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-features";
import { recognizeTermMarkdown } from "@red-cup-engineering/term-engineering-services-section/term-carrier";
import { glossaryAudienceAdmits } from "@red-cup-engineering/term-engineering-services-section/glossary-skos";
import { CITEKEY, recognizeBibliographyMarkdown } from "@red-cup-engineering/bibliography-engineering-services-section/carrier";
import { admitCarrierFrontmatter, CARRIER_KINDS } from "@red-cup-engineering/carrier-kind-engineering-services-section";
import { carrierKindOf } from "@red-cup-engineering/carrier-kind-engineering-services-section/carrier-path";

/**
 * What the corpus census reads from one carrier's bytes alone, kept apart from what it resolves
 * against the whole corpus, so a store of facts is keyed by this module's code and survives any
 * change to resolution.
 */

const GLOSSARY_TERM = /(^|\/)content\/text\/glossary\/terms\/[^/]+\.md$/u;
export const BIBLIOGRAPHY_CARRIER = /(^|\/)bibliographies\/[^/]+\.md$/u;
const BIBTEX_KEY = /@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,/gu;

function scalar(value) { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function stringList(value) { return (Array.isArray(value) ? value : [value]).filter((entry) => typeof entry === "string" && entry.trim() !== ""); }

function readFrontmatter(text) {
  try {
    const { format, frontmatter } = readMarkdownFrontmatter(text);
    return { format: format ?? "none", frontmatter: frontmatter ?? {} };
  } catch {
    return { format: "malformed", frontmatter: {} };
  }
}

function readOrgHeader(text) {
  const metadata = {};
  for (const line of text.split("\n")) {
    const directive = /^#\+([A-Za-z_-]+):\s*(.*)$/u.exec(line);
    if (directive) { metadata[directive[1].toLowerCase()] = directive[2].trim(); continue; }
    if (line.trim() !== "") break;
  }
  return metadata;
}

/** Schemas whose recognizer reads the carrier's file name as well as its bytes. */
const FILENAME_SCHEMAS = new Set(["term", "bibliography"]);

/**
 * The schema that claims a carrier: a glossary term's or a bibliography carrier's by its path,
 * else the carrier-kind schema its artifact-role directory's kind names, else none.
 * @param {string} path
 */
function schemaOf(path) {
  if (!path.endsWith(".md")) return "none";
  if (GLOSSARY_TERM.test(path)) return "term";
  if (BIBLIOGRAPHY_CARRIER.test(path)) return "bibliography";
  const kind = carrierKindOf(path);
  return CARRIER_KINDS.includes(kind) ? kind : "none";
}

function recognize(schema, path, text, format, frontmatter) {
  if (schema === "term") return recognizeTermMarkdown({ text, filename: posix.basename(path) });
  if (schema === "bibliography") return recognizeBibliographyMarkdown({ text, filename: posix.basename(path) });
  if (schema === "none") return undefined;
  const admission = admitCarrierFrontmatter(schema, frontmatter);
  return format === "malformed" ? { admitted: false, findings: [{ rule: "frontmatter-malformed" }, ...admission.findings] } : admission;
}

/**
 * The key a carrier's facts are kept under: its blob, plus what of its path the facts read (the
 * extension, the schema that claims it, and the filename when that schema's recognizer reads one). The same bytes at
 * another path of the same standing share one reading.
 * @param {string} path
 * @param {string} object
 */
export function carrierFactsKey(path, object) {
  const schema = schemaOf(path);
  return [object, posix.extname(path), schema, FILENAME_SCHEMAS.has(schema) ? posix.basename(path) : ""].join("\u0000");
}

/**
 * Everything the census reads from one carrier's bytes, before any of it is resolved against the
 * rest of the corpus: frontmatter format and the fields the census keeps, the owning schema's
 * verdict, and the link destinations, wikilink targets and citekeys the carrier writes. Depends
 * only on the text and on what `carrierFactsKey` keeps of the path, so facts kept by that key are
 * the facts read again.
 * @param {{path: string, text: string}} carrier
 */
export function readCarrierFacts({ path, text }) {
  const medium = path.endsWith(".org") ? "org" : "md";
  const { format, frontmatter } = medium === "org" ? { format: "org-header", frontmatter: readOrgHeader(text) } : readFrontmatter(text);
  const schema = schemaOf(path);
  const recognition = recognize(schema, path, text, format, frontmatter);
  const references = frontmatter.references && typeof frontmatter.references === "object" && !Array.isArray(frontmatter.references) ? Object.keys(frontmatter.references) : [];
  const links = [];
  const wikilinks = [];
  const citekeys = [];
  if (medium === "md") {
    for (const feature of projectMarkdownFeatures(readMarkdownSource(text))) {
      if (feature.type === "markdown-link") links.push(feature.target);
      else if (feature.type === "wikilink" || feature.type === "transclusion") wikilinks.push(feature.targetRaw);
      else if (feature.type === "citation-group") for (const key of [...feature.keys, ...feature.suppressedKeys]) if (CITEKEY.test(key)) citekeys.push(key);
    }
  }
  return Object.freeze({
    medium, format,
    visibility: typeof frontmatter.visibility === "string" ? frontmatter.visibility : "",
    type: scalar(frontmatter.type),
    public: glossaryAudienceAdmits(frontmatter, "public"),
    aliases: stringList(frontmatter.aliases),
    references,
    schema,
    admitted: recognition === undefined ? "" : String(recognition.admitted),
    rules: recognition === undefined ? [] : [...new Set(recognition.findings.map(({ rule }) => rule))].sort(),
    links, wikilinks, citekeys,
  });
}

/** The entry keys a BibTeX file declares. @param {string} text */
export function readBibtexKeys(text) {
  return [...text.matchAll(BIBTEX_KEY)].map((match) => match[1]);
}
