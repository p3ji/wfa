import os
import urllib.request
import sys

def download_file(url, output_path):
    print(f"Downloading {url} to {output_path}...", flush=True)
    try:
        # No custom headers to avoid anti-bot detection mismatch (JA3/TLS fingerprinting)
        with urllib.request.urlopen(url, timeout=30) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        print(f"Downloaded successfully!", flush=True)
        return True
    except Exception as e:
        print(f"Error downloading {url}: {e}", flush=True)
        return False

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    policies_dir = os.path.join(base_dir, "policies")
    os.makedirs(policies_dir, exist_ok=True)
    
    urls = {
        "workforce_adjustment.html": "https://www.canada.ca/en/government/publicservice/workforce/workforce-adjustment.html",
        "selection_guide.html": "https://www.canada.ca/en/public-service-commission/services/public-service-hiring-guides/selection-employees-retention-layoff-guide-managers-hr.html",
        "cape_wfa_guide_2025.pdf": "https://www.acep-cape.ca/sites/default/files/2025-12/WFA2025MemberGuideEN20250530.pdf",
        "psac_wfa_guide_2025.pdf": "https://psacunion.ca/sites/psac/files/2025-psac-wfa-members-guide.pdf"
    }
    
    success = True
    for filename, url in urls.items():
        output_path = os.path.join(policies_dir, filename)
        if filename.endswith(".pdf") and os.path.exists(output_path) and os.path.getsize(output_path) > 100000:
            print(f"{filename} already exists and is valid. Skipping download.", flush=True)
            continue
        if not download_file(url, output_path):
            success = False
            
    if success:
        print("All downloads finished successfully!", flush=True)
        sys.exit(0)
    else:
        print("Some downloads failed.", flush=True)
        sys.exit(1)
