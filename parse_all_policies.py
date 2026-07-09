import os
import json
import re
from html.parser import HTMLParser
from bs4 import BeautifulSoup
import pypdf

# =====================================================================
# Sliding-window chunking config
# =====================================================================
CHUNK_WORDS    = 400   # target words per chunk
OVERLAP_WORDS  = 80    # word overlap between consecutive chunks

def words(text):
    return text.split()

def sliding_window_chunks(sentences, doc_name, doc_url, section, subsection,
                           start_child_id):
    """
    Given a flat list of sentence/paragraph strings for a section, merge them
    into overlapping word-window chunks and return child dicts.
    """
    # Flatten all sentences into a single word list, tracking sentence boundaries
    all_words = []
    for s in sentences:
        all_words.extend(words(s))

    if not all_words:
        return [], start_child_id

    children = []
    child_id_num = start_child_id
    prefix = f"[{doc_name} | {section}" + (f" | {subsection}" if subsection else "") + "] "

    pos = 0
    while pos < len(all_words):
        window = all_words[pos: pos + CHUNK_WORDS]
        chunk_text = prefix + " ".join(window)

        child_id_num += 1
        children.append({
            "id": f"child_{child_id_num:04d}",
            "metadata": {
                "section":    section,
                "subsection": subsection,
                "document":   doc_name,
                "url":        doc_url,
            },
            "content": chunk_text,
        })

        if pos + CHUNK_WORDS >= len(all_words):
            break
        pos += CHUNK_WORDS - OVERLAP_WORDS   # step forward with overlap

    return children, child_id_num

# =====================================================================
# 1. Baseline NJC HTML Parser
# =====================================================================

class NJCParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main_content = False
        self.current_tag = None
        self.current_section = None
        self.current_subsection = None
        self.current_text = []
        self.sections = []   # list of {section, subsection, sentences:[]}

    def _current_bucket(self):
        if not self.sections:
            self.sections.append({"section": "General", "subsection": None, "sentences": []})
        return self.sections[-1]

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        attrs_dict = dict(attrs)
        if tag == 'div' and ('directive-12' in attrs_dict.get('class', '') or
                             'page-content' in attrs_dict.get('class', '')):
            self.in_main_content = True
        if not self.in_main_content:
            return
        if tag in ('h2', 'h3', 'p', 'li'):
            self.current_text = []

    def handle_endtag(self, tag):
        if not self.in_main_content:
            return
        text = " ".join(self.current_text).strip()
        text = re.sub(r'\s+', ' ', text)

        if tag == 'h2' and text:
            self.sections.append({"section": text, "subsection": None, "sentences": []})
        elif tag == 'h3' and text:
            # create a new bucket under the same section with a new subsection
            sec = self.sections[-1]["section"] if self.sections else "General"
            self.sections.append({"section": sec, "subsection": text, "sentences": []})
        elif tag in ('p', 'li') and text:
            self._current_bucket()["sentences"].append(text)

        if tag == 'main':
            self.in_main_content = False

    def handle_data(self, data):
        if self.in_main_content and self.current_tag in ('h2', 'h3', 'p', 'li', 'strong', 'em', 'a'):
            self.current_text.append(data)

    def build_chunks(self, doc_name, doc_url):
        children = []
        child_id = 0
        for bucket in self.sections:
            if not bucket["sentences"]:
                continue
            new_children, child_id = sliding_window_chunks(
                bucket["sentences"], doc_name, doc_url,
                bucket["section"], bucket["subsection"], child_id
            )
            children.extend(new_children)
        return children

# =====================================================================
# 2. Canada.ca HTML Document Parser using BeautifulSoup
# =====================================================================

def parse_html_bs4(file_path, doc_name, doc_url, start_child_id):
    with open(file_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    main_content = soup.find('main') or soup.find('body')
    elements = main_content.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'table'])

    # Collect sections
    sections = []
    current_section    = "General"
    current_subsection = None
    current_sentences  = []

    SKIP_HEADINGS = {'on this page', 'page details', 'related information'}

    def flush():
        if current_sentences:
            sections.append({
                "section":    current_section,
                "subsection": current_subsection,
                "sentences":  list(current_sentences),
            })
            current_sentences.clear()

    for el in elements:
        tag  = el.name
        text = el.get_text(separator=' ', strip=True)
        text = ' '.join(text.split())
        if not text:
            continue

        if tag in ('h1', 'h2'):
            if text.lower() in SKIP_HEADINGS:
                continue
            flush()
            current_section    = text
            current_subsection = None
        elif tag in ('h3', 'h4'):
            flush()
            current_subsection = text
        elif tag in ('p', 'li'):
            # Skip short navigation / boilerplate lines
            if el.find('a') and len(text) < 50 and any(
                kw in text.lower() for kw in ('language selection', 'skip to', 'search')
            ):
                continue
            current_sentences.append(text)
        elif tag == 'table':
            rows = []
            for tr in el.find_all('tr'):
                cols = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                if any(cols):
                    rows.append(" | ".join(cols))
            if rows:
                current_sentences.append("\n".join(rows))

    flush()

    all_children = []
    child_id = start_child_id
    for bucket in sections:
        new_children, child_id = sliding_window_chunks(
            bucket["sentences"], doc_name, doc_url,
            bucket["section"], bucket["subsection"], child_id
        )
        all_children.extend(new_children)

    return all_children, child_id

# =====================================================================
# 3. PDF Guide Document Parser using pypdf
# =====================================================================

def clean_pdf_text(text):
    text = text.replace("Ch\ufffdnard", "ChÃ©nard")
    text = re.sub(r"(\w)\ufffds\b", r"\1's", text)
    text = re.sub(r"(\w)\ufffdt\b", r"\1't", text)
    text = re.sub(r"(\w)\ufffdre\b", r"\1're", text)
    text = re.sub(r"(\w)\ufffdve\b", r"\1've", text)
    text = re.sub(r"(\w)\ufffdll\b", r"\1'll", text)
    text = re.sub(r"(\w)\ufffdd\b", r"\1'd", text)
    text = re.sub(r"(\w)\ufffd(\w)", r"\1'\2", text)
    text = re.sub(r"(\w)s\ufffd\b", r"\1s'", text)
    text = re.sub(r"\ufffd(\w)", r'"\1', text)
    text = re.sub(r"(\w)\ufffd", r'\1"', text)
    text = text.replace(" \ufffd ", " - ")
    text = text.replace("\ufffd", "'")
    return text

# Patterns that indicate a line is a heading inside the PDF
_HEADING_RE = re.compile(r'^(\d+\.[\d\.]*\s+|PART\s+|Article\s+|Section\s+|Appendix\s+)', re.I)

def _is_heading_like(line):
    if len(line) > 90:
        return False
    if line.endswith(('.', ',', ';', ':', '?')):
        return False
    if _HEADING_RE.match(line):
        return True
    # Short ALL-CAPS or Title-Case line starting with uppercase
    if len(line) < 60 and line and (line[0].isupper() or line[0].isdigit()):
        return True
    return False

def parse_pdf_pypdf(file_path, doc_name, doc_url, start_child_id):
    reader = pypdf.PdfReader(file_path)

    # Collect all sentences grouped by detected section/subsection
    sections = []
    current_section    = f"{doc_name}: General"
    current_subsection = None
    current_sentences  = []

    def flush():
        if current_sentences:
            sections.append({
                "section":    current_section,
                "subsection": current_subsection,
                "sentences":  list(current_sentences),
            })
            current_sentences.clear()

    for i, page in enumerate(reader.pages):
        page_num = i + 1
        raw = page.extract_text()
        if not raw:
            continue

        raw = clean_pdf_text(raw)
        lines = [l.strip() for l in raw.split('\n') if l.strip()]

        # Remove pure page-number lines
        lines = [l for l in lines if not (l.isdigit() and int(l) == page_num)]

        current_para = []
        for line in lines:
            if _is_heading_like(line):
                # Flush current paragraph into sentences
                if current_para:
                    current_sentences.append(" ".join(current_para))
                    current_para = []
                # Decide: is this a major section heading or subsection?
                if _HEADING_RE.match(line) or line.isupper():
                    flush()
                    current_section    = f"{doc_name}: {line}"
                    current_subsection = None
                else:
                    current_subsection = line
            else:
                current_para.append(line)

        if current_para:
            current_sentences.append(" ".join(current_para))

    flush()

    all_children = []
    child_id = start_child_id
    for bucket in sections:
        new_children, child_id = sliding_window_chunks(
            bucket["sentences"], doc_name, doc_url,
            bucket["section"], bucket["subsection"], child_id
        )
        all_children.extend(new_children)

    return all_children, child_id

# =====================================================================
# Main execution flow
# =====================================================================

def main():
    base_dir    = os.path.dirname(os.path.abspath(__file__))
    policies_dir = os.path.join(base_dir, "policies")

    # 1. Parse Baseline NJC Directive HTML
    print("Parsing baseline NJC directive HTML...")
    baseline_html_path = os.path.join(base_dir, "wfa_directive_source.html")
    njc_parser = NJCParser()
    with open(baseline_html_path, 'r', encoding='utf-8') as f:
        njc_parser.feed(f.read())

    all_children = njc_parser.build_chunks(
        "Work Force Adjustment Directive",
        "https://www.njc-cnm.gc.ca/directive/d12/v239/en"
    )
    child_counter = len(all_children)
    print(f"Parsed baseline NJC: {child_counter} chunks.")

    # Define remaining documents
    docs = [
        {
            "type": "html",
            "file": "tsm_scale_details.html",
            "name": "WFA Directive Annex C - Transition Support Measure (TSM) Scale",
            "url":  "https://www.njc-cnm.gc.ca/directive/d12/v239/en"
        },
        {
            "type": "html",
            "file": "workforce_adjustment.html",
            "name": "Treasury Board Workforce Adjustment Policy Info",
            "url":  "https://www.canada.ca/en/government/publicservice/workforce/workforce-adjustment.html"
        },
        {
            "type": "html",
            "file": "selection_guide.html",
            "name": "PSC Guide for Selection for Retention or Layoff",
            "url":  "https://www.canada.ca/en/public-service-commission/services/public-service-hiring-guides/selection-employees-retention-layoff-guide-managers-hr.html"
        },
        {
            "type": "pdf",
            "file": "cape_wfa_guide_2025.pdf",
            "name": "CAPE WFA Member Guide 2025",
            "url":  "https://www.acep-cape.ca/sites/default/files/2025-12/WFA2025MemberGuideEN20250530.pdf"
        },
        {
            "type": "pdf",
            "file": "psac_wfa_guide_2025.pdf",
            "name": "PSAC WFA Member Guide 2025",
            "url":  "https://psacunion.ca/sites/psac/files/2025-psac-wfa-members-guide.pdf"
        },
        {
            "type": "pdf",
            "file": "ec_collective_agreement.pdf",
            "name": "Economics and Social Science Services (EC) Collective Agreement",
            "url":  "https://www.canada.ca/en/treasury-board-secretariat/topics/pay/collective-agreements/ec.html"
        },
        {
            "type": "html",
            "file": "directive_on_leave.html",
            "name": "Directive on Leave and Special Working Arrangements",
            "url":  "https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=15774"
        },
        {
            "type": "pdf",
            "file": "NJC Relocation Directive.pdf",
            "name": "NJC Relocation Directive",
            "url":  "https://www.njc-cnm.gc.ca/directive/nrd-drc/index-eng.php"
        }
    ]


    for doc in docs:
        file_path = os.path.join(policies_dir, doc["file"])
        if not os.path.exists(file_path):
            print(f"Warning: {file_path} not found â€” skipping.")
            continue

        print(f"Parsing {doc['name']} ({doc['file']})...")
        if doc["type"] == "html":
            children, child_counter = parse_html_bs4(
                file_path, doc["name"], doc["url"], child_counter
            )
        else:
            children, child_counter = parse_pdf_pypdf(
                file_path, doc["name"], doc["url"], child_counter
            )

        all_children.extend(children)
        print(f"  â†’ {len(children)} chunks (total so far: {child_counter})")

    # Re-number child IDs sequentially
    for idx, child in enumerate(all_children, 1):
        child["id"] = f"child_{idx:04d}"

    # Write outputs (children.json only â€” parents.json no longer used)
    children_file = os.path.join(base_dir, 'public', 'children.json')
    with open(children_file, 'w', encoding='utf-8') as f:
        json.dump(all_children, f, indent=2, ensure_ascii=False)

    print(f"\nDone! Saved {len(all_children)} sliding-window chunks â†’ {children_file}")

if __name__ == '__main__':
    main()


# =====================================================================
