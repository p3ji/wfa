import os
import json
import re
from html.parser import HTMLParser
from bs4 import BeautifulSoup
import pypdf

# =====================================================================
# 1. Baseline NJC HTML Parser (Identical to parse_njc_policy.py)
# =====================================================================

class NJCParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main_content = False
        self.current_tag = None
        self.current_parent = None
        self.current_section = None
        self.current_subsection = None
        
        # Structure storage
        self.documents = []
        self.current_text = []
        self.parents = []
        self.children = []
        
        self.parent_counter = 0
        self.child_counter = 0

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        attrs_dict = dict(attrs)
        
        # Identify the start of the directive main text
        if tag == 'div' and ('directive-12' in attrs_dict.get('class', '') or 'page-content' in attrs_dict.get('class', '')):
            self.in_main_content = True
            
        if not self.in_main_content:
            return

        if tag == 'h2':
            # End of previous section, commit text to parent
            self.flush_current_element()
            self.current_parent = None
            self.current_section = ""
            
        elif tag == 'h3':
            self.flush_current_element()
            self.current_subsection = ""
            
        elif tag in ['p', 'li']:
            self.flush_current_element()

    def handle_endtag(self, tag):
        if not self.in_main_content:
            return
            
        if tag == 'h2':
            self.current_section = "".join(self.current_text).strip()
            self.current_text = []
            # Create a parent category
            self.parent_counter += 1
            self.current_parent = {
                "id": f"parent_{self.parent_counter:03d}",
                "section": self.current_section,
                "subsection": None,
                "paragraphs": [],
                "full_text": ""
            }
            self.parents.append(self.current_parent)
            
        elif tag == 'h3':
            self.current_subsection = "".join(self.current_text).strip()
            self.current_text = []
            
            # Update parent context if exists
            if self.current_parent:
                self.current_parent["subsection"] = self.current_subsection
            else:
                self.parent_counter += 1
                self.current_parent = {
                    "id": f"parent_{self.parent_counter:03d}",
                    "section": self.current_section or "General",
                    "subsection": self.current_subsection,
                    "paragraphs": [],
                    "full_text": ""
                }
                self.parents.append(self.current_parent)
                
        elif tag in ['p', 'li']:
            paragraph_text = "".join(self.current_text).strip()
            self.current_text = []
            
            # Simple text cleaning
            paragraph_text = re.sub(r'\s+', ' ', paragraph_text)
            
            if paragraph_text and self.current_parent:
                self.current_parent["paragraphs"].append(paragraph_text)
                
                # Create a child chunk linked to the parent
                self.child_counter += 1
                child_chunk = {
                    "id": f"child_{self.child_counter:04d}",
                    "parent_id": self.current_parent["id"],
                    "metadata": {
                        "section": self.current_parent["section"],
                        "subsection": self.current_parent["subsection"],
                        "document": "Work Force Adjustment Directive",
                        "url": "https://www.njc-cnm.gc.ca/directive/d12/v239/en"
                    },
                    "content": f"[{self.current_parent['section']} - {self.current_parent['subsection'] or ''}] {paragraph_text}"
                }
                self.children.append(child_chunk)
                
        # Stop processing if we reach the end of the content
        if tag == 'main':
            self.in_main_content = False

    def handle_data(self, data):
        if self.in_main_content and self.current_tag in ['h2', 'h3', 'p', 'li', 'strong', 'em', 'a']:
            self.current_text.append(data)

    def flush_current_element(self):
        pass

    def finalize(self):
        # Build full parent texts for DB storage
        for p in self.parents:
            header = f"# {p['section']}\n"
            if p['subsection']:
                header += f"## {p['subsection']}\n"
            p['full_text'] = header + "\n".join([f"- {para}" if len(para) < 200 else para for para in p['paragraphs']])
            # Clean up the parsing helpers
            del p['paragraphs']

# =====================================================================
# 2. Canada.ca HTML Document Parser using BeautifulSoup
# =====================================================================

def parse_html_bs4(file_path, doc_name, doc_url, start_parent_id, start_child_id):
    with open(file_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')
    
    main_content = soup.find('main')
    if not main_content:
        main_content = soup.find('body')
        
    parents = []
    children = []
    
    current_section = "General"
    current_subsection = None
    current_paragraphs = []
    
    # Track counters
    parent_id_num = start_parent_id
    child_id_num = start_child_id
    
    # We want to traverse elements in document order inside <main>
    elements = main_content.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'table'])
    
    def flush_block():
        nonlocal parent_id_num, child_id_num
        if not current_paragraphs:
            return
            
        parent_id_num += 1
        parent_id = f"parent_{parent_id_num:03d}"
        
        # Build markdown text for parent
        header = f"# {current_section}\n"
        if current_subsection:
            header += f"## {current_subsection}\n"
            
        full_text = header + "\n".join([f"- {p}" if len(p) < 200 else p for p in current_paragraphs])
        
        parent_chunk = {
            "id": parent_id,
            "section": f"{doc_name}: {current_section}",
            "subsection": current_subsection,
            "full_text": full_text
        }
        parents.append(parent_chunk)
        
        # Create child chunks
        for p in current_paragraphs:
            child_id_num += 1
            child_id = f"child_{child_id_num:04d}"
            child_chunk = {
                "id": child_id,
                "parent_id": parent_id,
                "metadata": {
                    "section": f"{doc_name}: {current_section}",
                    "subsection": current_subsection,
                    "document": doc_name,
                    "url": doc_url
                },
                "content": f"[{doc_name} - {current_section} - {current_subsection or ''}] {p}"
            }
            children.append(child_chunk)
            
        current_paragraphs.clear()

    for el in elements:
        tag = el.name
        text = el.get_text(strip=True)
        if not text:
            continue
            
        if tag in ['h1', 'h2']:
            if text.lower() in ['on this page', 'page details', 'related information', 'page details']:
                continue
            flush_block()
            current_section = text
            current_subsection = None
        elif tag in ['h3', 'h4']:
            flush_block()
            current_subsection = text
        elif tag in ['p', 'li']:
            # Skip list items that are navigation links or layout metadata
            if el.find('a') and len(text) < 50 and ('language selection' in text.lower() or 'skip to' in text.lower() or 'search' in text.lower()):
                continue
            text = ' '.join(text.split())
            if text:
                current_paragraphs.append(text)
        elif tag == 'table':
            rows = []
            for tr in el.find_all('tr'):
                cols = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                if any(cols):
                    rows.append(" | ".join(cols))
            table_text = "\n".join(rows)
            if table_text:
                current_paragraphs.append(table_text)
                
    flush_block()
    return parents, children, parent_id_num, child_id_num

# =====================================================================
# 3. PDF Guide Document Parser using pypdf
# =====================================================================

def clean_pdf_text(text):
    # Fix specific words
    text = text.replace("Ch\ufffdnard", "Chénard")
    
    # Fix contractions and possessives
    text = re.sub(r"(\w)\ufffds\b", r"\1's", text)  # CAPE's, employer's, etc.
    text = re.sub(r"(\w)\ufffdt\b", r"\1't", text)  # don't
    text = re.sub(r"(\w)\ufffdre\b", r"\1're", text) # you're
    text = re.sub(r"(\w)\ufffdve\b", r"\1've", text) # you've
    text = re.sub(r"(\w)\ufffdll\b", r"\1'll", text) # you'll
    text = re.sub(r"(\w)\ufffdd\b", r"\1'd", text)  # you'd
    text = re.sub(r"(\w)\ufffd(\w)", r"\1'\2", text) # general apostrophe inside word
    
    # Fix plural possessives
    text = re.sub(r"(\w)s\ufffd\b", r"\1s'", text)  # parties', years'
    
    # Fix quotes (e.g. \ufffdco-manage\ufffd -> "co-manage")
    text = re.sub(r"\ufffd(\w)", r'"\1', text)
    text = re.sub(r"(\w)\ufffd", r'\1"', text)
    
    # Fix bullet points
    text = text.replace(" \ufffd ", " - ")
    
    # Clean up any remaining \ufffd
    text = text.replace("\ufffd", "'")
    
    return text

def parse_pdf_pypdf(file_path, doc_name, doc_url, start_parent_id, start_child_id):
    reader = pypdf.PdfReader(file_path)
    
    parents = []
    children = []
    
    parent_id_num = start_parent_id
    child_id_num = start_child_id
    
    for i, page in enumerate(reader.pages):
        page_num = i + 1
        text = page.extract_text()
        if not text:
            continue
            
        text = clean_pdf_text(text)
        
        # Clean text lines
        text_lines = [line.strip() for line in text.split('\n') if line.strip()]
        if not text_lines:
            continue
            
        # Determine heading of the page as the first non-empty line
        heading = text_lines[0]
        # Clean heading if it's just a number
        if heading.isdigit() and len(text_lines) > 1:
            heading = text_lines[1]
            
        # Page paragraphs: split raw text into paragraphs based on short line heuristic
        paragraphs = []
        current_para = []
        for line in text_lines:
            is_heading_like = (
                len(line) < 55 and 
                line and (line[0].isupper() or line[0].isdigit()) and 
                not line.endswith(('.', ',', ';', ':', '?'))
            )
            if is_heading_like:
                if current_para:
                    paragraphs.append(" ".join(current_para))
                    current_para = []
                paragraphs.append(line)
            else:
                current_para.append(line)
        if current_para:
            paragraphs.append(" ".join(current_para))
            
        # Filter paragraphs to only include actual content
        cleaned_paras = []
        for p in paragraphs:
            p_strip = p.strip()
            # Filter out page number artifacts or empty chunks
            if not p_strip or (p_strip.isdigit() and int(p_strip) == page_num) or p_strip == str(page_num):
                continue
            cleaned_paras.append(p_strip)
            
        if not cleaned_paras:
            continue
            
        # Determine section name
        if page_num == 1 and len(cleaned_paras) < 3:
            section_name = "Cover Page"
        elif "table of contents" in heading.lower() or "contents" in heading.lower():
            section_name = "Table of Contents"
        else:
            section_name = f"Page {page_num}"
            
        parent_id_num += 1
        parent_id = f"parent_{parent_id_num:03d}"
        
        # Build markdown text for parent
        header = f"# {doc_name} - {section_name}\n"
        header += f"## {heading}\n"
        full_text = header + "\n".join([f"- {p}" if len(p) < 200 else p for p in cleaned_paras])
        
        parent_chunk = {
            "id": parent_id,
            "section": f"{doc_name}: {section_name}",
            "subsection": heading,
            "full_text": full_text
        }
        parents.append(parent_chunk)
        
        # Create child chunks
        for p in cleaned_paras:
            child_id_num += 1
            child_id = f"child_{child_id_num:04d}"
            child_chunk = {
                "id": child_id,
                "parent_id": parent_id,
                "metadata": {
                    "section": f"{doc_name}: {section_name}",
                    "subsection": heading,
                    "document": doc_name,
                    "url": doc_url
                },
                "content": f"[{doc_name} - {section_name} - {heading}] {p}"
            }
            children.append(child_chunk)
            
    return parents, children, parent_id_num, child_id_num

# =====================================================================
# Main execution flow
# =====================================================================

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    policies_dir = os.path.join(base_dir, "policies")
    
    # 1. Parse Baseline NJC Directive
    print("Parsing baseline NJC directive HTML...")
    baseline_html_path = os.path.join(base_dir, "wfa_directive_source.html")
    njc_parser = NJCParser()
    with open(baseline_html_path, 'r', encoding='utf-8') as f:
        njc_parser.feed(f.read())
    njc_parser.finalize()
    
    all_parents = list(njc_parser.parents)
    all_children = list(njc_parser.children)
    
    parent_counter = len(all_parents)
    child_counter = len(all_children)
    
    print(f"Parsed baseline NJC: {parent_counter} parents, {child_counter} children.")
    
    # Define document metadata
    docs = [
        {
            "type": "html",
            "file": "tsm_scale_details.html",
            "name": "WFA Directive Annex C - Transition Support Measure (TSM) Scale",
            "url": "https://www.njc-cnm.gc.ca/directive/d12/v239/en"
        },
        {
            "type": "html",
            "file": "workforce_adjustment.html",
            "name": "Treasury Board Workforce Adjustment Policy Info",
            "url": "https://www.canada.ca/en/government/publicservice/workforce/workforce-adjustment.html"
        },
        {
            "type": "html",
            "file": "selection_guide.html",
            "name": "PSC Guide for Selection for Retention or Layoff",
            "url": "https://www.canada.ca/en/public-service-commission/services/public-service-hiring-guides/selection-employees-retention-layoff-guide-managers-hr.html"
        },
        {
            "type": "pdf",
            "file": "cape_wfa_guide_2025.pdf",
            "name": "CAPE WFA Member Guide 2025",
            "url": "https://www.acep-cape.ca/sites/default/files/2025-12/WFA2025MemberGuideEN20250530.pdf"
        },
        {
            "type": "pdf",
            "file": "psac_wfa_guide_2025.pdf",
            "name": "PSAC WFA Member Guide 2025",
            "url": "https://psacunion.ca/sites/psac/files/2025-psac-wfa-members-guide.pdf"
        },
        {
            "type": "pdf",
            "file": "ec_collective_agreement.pdf",
            "name": "Economics and Social Science Services (EC) Collective Agreement",
            "url": "https://www.canada.ca/en/treasury-board-secretariat/topics/pay/collective-agreements/ec.html"
        }
    ]
    
    for doc in docs:
        file_path = os.path.join(policies_dir, doc["file"])
        if not os.path.exists(file_path):
            print(f"Warning: File {file_path} not found! Skipping...")
            continue
            
        print(f"Parsing {doc['name']} ({doc['file']})...")
        if doc["type"] == "html":
            parents, children, parent_counter, child_counter = parse_html_bs4(
                file_path, doc["name"], doc["url"], parent_counter, child_counter
            )
        elif doc["type"] == "pdf":
            parents, children, parent_counter, child_counter = parse_pdf_pypdf(
                file_path, doc["name"], doc["url"], parent_counter, child_counter
            )
            
        all_parents.extend(parents)
        all_children.extend(children)
        print(f"Finished parsing {doc['name']}. Current totals: {parent_counter} parents, {child_counter} children.")
        
    # Write back the results
    parents_file = os.path.join(base_dir, 'public', 'parents.json')
    with open(parents_file, 'w', encoding='utf-8') as f:
      json.dump(all_parents, f, indent=2, ensure_ascii=False)
        
    children_file = os.path.join(base_dir, 'public', 'children.json')
    with open(children_file, 'w', encoding='utf-8') as f:
      json.dump(all_children, f, indent=2, ensure_ascii=False)
        
    print(f"\nConsolidation completed successfully!")
    print(f"Saved total {len(all_parents)} parent chunks to: {parents_file}")
    print(f"Saved total {len(all_children)} child chunks to: {children_file}")

if __name__ == '__main__':
    main()
