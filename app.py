import os
import sys
import requests
import subprocess
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
import json
import time
import textstat
from textblob import TextBlob
import nltk
from nltk.corpus import stopwords
from collections import Counter, defaultdict, deque
import re
import hashlib
from dotenv import load_dotenv

from requests.adapters import HTTPAdapter
try:
    from urllib3.util.retry import Retry
except Exception:
    class Retry:
        def __init__(self, total=2, backoff_factor=0.3, status_forcelist=(429, 500, 502, 503, 504)):
            self.total = total
            self.backoff_factor = backoff_factor
            self.status_forcelist = status_forcelist

load_dotenv()

nltk.download('punkt_tab', quiet=True)
nltk.download('stopwords', quiet=True)

WEBSITE_TO_CRAWL = os.getenv("WEBSITE_TO_CRAWL", "https://www.example.com/")

MAX_PAGES_TO_CRAWL = int(os.getenv("MAX_PAGES_TO_CRAWL", "50"))

CRAWL_DELAY_SECONDS = float(os.getenv("CRAWL_DELAY_SECONDS", "1.0"))

GENERIC_LINK_TEXT = {"click here", "learn more", "more", "here"}

def is_internal(url, base):
    return urlparse(url).netloc == urlparse(base).netloc

def check_heading_structure(soup):
    headings = [int(tag.name[1]) for tag in soup.find_all(re.compile('^h[1-6]$'))]
    skipped_levels = []
    prev_level = 0
    for level in headings:
        if prev_level and level > prev_level + 1:
            skipped_levels.append((prev_level, level))
        prev_level = level
    return skipped_levels

def check_semantic_elements(soup):
    semantic_tags = ['main', 'nav', 'article', 'section', 'header', 'footer', 'aside']
    used_semantics = {tag: bool(soup.find(tag)) for tag in semantic_tags}
    return used_semantics

def check_image_alts(soup):
    images = soup.find_all('img')
    images_without_alt = [img.get('src') or img.get('data-src') or '' for img in images if not img.get('alt') or img.get('alt').strip() == '']
    return [src for src in images_without_alt if src]

def check_form_labels(soup):
    inputs = soup.find_all(['input', 'textarea', 'select'])
    labeled_inputs = set()
    for label in soup.find_all('label'):
        if label.get('for'):
            labeled_inputs.add(label['for'])
    inputs_without_labels = []
    for field in inputs:
        ftype = (field.get('type') or '').lower()
        if field.get('id') and ftype not in ['hidden', 'submit', 'button', 'reset']:
            if field['id'] not in labeled_inputs:
                parent_label = field.find_parent('label')
                if not parent_label:
                    inputs_without_labels.append(field['id'])
    return inputs_without_labels

def extract_http_delivery(resp):
    h = {k.lower(): v for k, v in resp.headers.items()}
    set_cookie_header = resp.headers.get("set-cookie", "")
    cookies_simple = []
    if set_cookie_header:
        parts = [p.strip() for p in re.split(r',(?=[^ ;]+=)', set_cookie_header)]
        for c in parts:
            name = c.split(";", 1)[0].split("=", 1)[0].strip()
            if name:
                cookies_simple.append(name)

    chain = []
    for r in (resp.history or []):
        chain.append({
            "url": r.url,
            "status": r.status_code,
            "ttfb": round(getattr(r, "elapsed", None).total_seconds() if getattr(r, "elapsed", None) else 0, 3)
        })
    chain.append({
        "url": resp.url,
        "status": resp.status_code,
        "ttfb": round(resp.elapsed.total_seconds() if resp.elapsed else 0, 3)
    })

    return {
        "content_type": h.get("content-type", ""),
        "content_length": int(h.get("content-length") or 0),
        "content_encoding": h.get("content-encoding", ""),
        "cache_control": h.get("cache-control", ""),
        "etag": h.get("etag", ""),
        "last_modified": h.get("last-modified", ""),
        "server": h.get("server", ""),
        "x_powered_by": h.get("x-powered-by", ""),
        "set_cookies": cookies_simple,
        "redirect_chain": chain
    }

def extract_security_headers(resp):
    h = {k.lower(): v for k, v in resp.headers.items()}
    return {
        "content_security_policy": h.get("content-security-policy", ""),
        "strict_transport_security": h.get("strict-transport-security", ""),
        "x_frame_options": h.get("x-frame-options", ""),
        "x_content_type_options": h.get("x-content-type-options", ""),
        "referrer_policy": h.get("referrer-policy", ""),
        "permissions_policy": h.get("permissions-policy", "")
    }

def detect_mixed_content(page_url, soup):
    try:
        is_https = urlparse(page_url).scheme == "https"
    except Exception:
        is_https = False
    if not is_https:
        return []

    urls = []
    for tag, attr in [("img","src"), ("script","src"), ("link","href"), ("iframe","src"), ("video","src"), ("source","src")]:
        for el in soup.find_all(tag):
            u = el.get(attr)
            if not u:
                continue
            absu = urljoin(page_url, u)
            if absu.lower().startswith("http://"):
                urls.append(absu)
    return list(sorted(set(urls)))

def extract_structured_data(soup):
    jsonld = []
    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            if tag.string:
                jsonld.append(json.loads(tag.string))
        except Exception:
            pass
    og = {m.get('property'): m.get('content') for m in soup.select('meta[property^="og:"]') if m.get('property')}
    tw = {m.get('name'): m.get('content') for m in soup.select('meta[name^="twitter:"]') if m.get('name')}
    canonical = (soup.find('link', rel='canonical') or {}).get('href', '')
    hreflang = [(l.get('hreflang'), l.get('href')) for l in soup.select('link[rel="alternate"][hreflang]')]
    return {"jsonld": jsonld, "opengraph": og, "twitter": tw, "canonical": canonical, "hreflang": hreflang}

def extract_a11y_extras(soup):
    links = [(a.get_text(strip=True).lower(), a.get('href')) for a in soup.find_all('a', href=True)]
    generic = [url for (txt, url) in links if txt in GENERIC_LINK_TEXT]
    landmarks = {t: len(soup.find_all(t)) for t in ['main', 'nav', 'header', 'footer', 'aside', 'section', 'article']}
    aria_roles = Counter([el.get('role') for el in soup.find_all(attrs={"role": True})])
    return {"generic_link_texts": generic, "landmarks_count": landmarks, "aria_roles": dict(aria_roles)}

def text_fingerprint(text):
    norm = re.sub(r'\s+', ' ', (text or '').lower()).strip()
    return hashlib.md5(norm.encode()).hexdigest() if norm else ""

def estimate_language(text):
    if not text:
        return "unknown"
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words:
        return "unknown"
    sw = set(stopwords.words('english'))
    hits = sum(1 for w in words if w in sw)
    ratio = hits / max(1, len(words))
    return "en" if ratio >= 0.02 else "unknown"

def estimate_read_time_minutes(word_count, wpm=200):
    return round((word_count or 0) / float(wpm), 2)

def extract_preloads(soup):
    out = []
    for l in soup.find_all('link'):
        rel = l.get('rel')
        if not rel:
            continue
        rels = [r.lower() for r in (rel if isinstance(rel, list) else [rel])]
        if any(r in ('preload', 'prefetch', 'preconnect') for r in rels):
            out.append({
                "rel": " ".join(rels),
                "as": l.get('as', ''),
                "href": l.get('href', '')
            })
    return out

def extract_media_hints(soup):
    imgs = soup.find_all('img')
    lazy_count = 0
    largest = {"src": "", "area": 0, "width": 0, "height": 0}
    for img in imgs:
        if (img.get('loading') or '').lower() == 'lazy' or img.get('data-src') or img.get('data-lazy'):
            lazy_count += 1
        w = img.get('width')
        h = img.get('height')
        try:
            wv = int(re.sub(r'\D', '', str(w))) if w else 0
            hv = int(re.sub(r'\D', '', str(h))) if h else 0
        except Exception:
            wv, hv = 0, 0
        area = wv * hv
        if area > largest["area"]:
            largest = {
                "src": img.get('src') or img.get('data-src') or '',
                "area": area,
                "width": wv,
                "height": hv
            }
    return {"lazy_images_count": lazy_count, "largest_image": largest}

def fetch_robots_and_sitemaps(base_url, session):
    root = urlparse(base_url)
    robots_url = f"{root.scheme}://{root.netloc}/robots.txt"
    sitemaps = []
    robots_txt = ""
    try:
        r = session.get(robots_url, timeout=8, headers={'User-Agent': 'MyCrawler/1.0'})
        if r.status_code == 200 and 'text' in r.headers.get('content-type',''):
            robots_txt = r.text[:10000]
            for line in robots_txt.splitlines():
                if line.lower().startswith('sitemap:'):
                    sm = line.split(':', 1)[1].strip()
                    sitemaps.append(sm)
    except Exception:
        pass
    guess = f"{root.scheme}://{root.netloc}/sitemap.xml"
    if guess not in sitemaps:
        try:
            g = session.get(guess, timeout=8, headers={'User-Agent': 'MyCrawler/1.0'})
            if g.status_code == 200 and 'xml' in g.headers.get('content-type',''):
                sitemaps.append(guess)
        except Exception:
            pass
    return {"robots_txt": robots_txt, "sitemaps": list(sorted(set(sitemaps)))}

def build_session():
    s = requests.Session()
    try:
        retry = Retry(
            total=3, backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
        s.mount('http://', adapter)
        s.mount('https://', adapter)
    except Exception:
        pass
    s.headers.update({'User-Agent': 'MyCrawler/1.0'})
    return s

def crawl_site(start_url, max_links=MAX_PAGES_TO_CRAWL):
    session = build_session()

    start = start_url.rstrip('/')
    visited = set()
    site_structure = {}
    to_visit = deque([(start, 0)])
    queued = {start}
    in_edges = defaultdict(set)
    out_edges = defaultdict(set)

    site_meta = fetch_robots_and_sitemaps(start_url, session)

    while to_visit and len(visited) < max_links:
        url, depth = to_visit.popleft()

        normalized_url = url.rstrip('/')
        if normalized_url in visited:
            continue

        visited.add(normalized_url)
        print(f"Crawling: {normalized_url} (depth {depth}) ({len(visited)}/{max_links})")

        if CRAWL_DELAY_SECONDS > 0 and len(visited) > 1:
            time.sleep(CRAWL_DELAY_SECONDS)

        try:
            start_time = time.time()
            response = session.get(normalized_url, timeout=10)
            response_time = time.time() - start_time
            status_code = response.status_code

            if response.status_code != 200:
                print(f"Skipping {normalized_url} due to status code: {status_code}")
                site_structure[normalized_url] = {
                    "url": normalized_url,
                    "status_code": status_code,
                    "error": "Failed to fetch",
                    "depth": depth,
                    "ttfb": round(response.elapsed.total_seconds() if response.elapsed else 0, 3),
                    "http_delivery": extract_http_delivery(response),
                    "security": extract_security_headers(response),
                }
                continue

            content_type = response.headers.get('content-type', '').lower()
            if 'text/html' not in content_type:
                print(f"Skipping {normalized_url} as content type is not HTML: {content_type}")
                site_structure[normalized_url] = {
                    "url": normalized_url,
                    "status_code": status_code,
                    "error": "Not HTML content",
                    "depth": depth,
                    "ttfb": round(response.elapsed.total_seconds() if response.elapsed else 0, 3),
                    "http_delivery": extract_http_delivery(response),
                    "security": extract_security_headers(response),
                }
                continue

            soup = BeautifulSoup(response.text, 'html.parser')
            page_title = soup.title.get_text(strip=True) if soup.title else ''

            meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
            meta_description = meta_desc_tag['content'].strip() if meta_desc_tag and 'content' in meta_desc_tag.attrs else ''

            meta_keywords_tag = soup.find('meta', attrs={'name': 'keywords'})
            meta_keywords = meta_keywords_tag['content'].strip() if meta_keywords_tag and 'content' in meta_keywords_tag.attrs else ''

            h1_tags = [h1.get_text(strip=True) for h1 in soup.find_all('h1')]

            text_content_for_analysis = []
            for element in soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'article']):
                text_content_for_analysis.append(element.get_text(separator=' ', strip=True))
            text = " ".join(text_content_for_analysis)
            
            text_content = text.strip()

            word_count = len(text.split()) if text else 0
            readability_score = textstat.flesch_kincaid_grade(text) if text else 0
            sentiment = TextBlob(text).sentiment.polarity if text else 0

            keyword_density = {}
            if text:
                text_clean = re.sub(r'[^\w\s]', '', text.lower())
                tokens = nltk.word_tokenize(text_clean)
                stop_words = set(stopwords.words('english'))
                filtered_tokens = [word for word in tokens if word not in stop_words and word.isalpha() and len(word) > 1]
                if filtered_tokens:
                    word_freq = Counter(filtered_tokens)
                    total_filtered_words = sum(word_freq.values())
                    most_common = word_freq.most_common(10)
                    keyword_density = {word: round(count / total_filtered_words, 4) for word, count in most_common}

            image_count = len(soup.find_all('img'))
            script_count = len(soup.find_all('script'))
            stylesheet_count = len(soup.find_all('link', rel='stylesheet'))
            has_viewport_meta = bool(soup.find('meta', attrs={'name': 'viewport'}))
            heading_count = len(soup.find_all(['h2', 'h3', 'h4', 'h5', 'h6']))
            paragraph_count = len(soup.find_all('p'))

            semantic_elements = check_semantic_elements(soup)
            heading_issues = check_heading_structure(soup)
            unlabeled_inputs = check_form_labels(soup)
            images_without_alt = check_image_alts(soup)

            http_delivery = extract_http_delivery(response)
            security = extract_security_headers(response)
            structured = extract_structured_data(soup)
            a11y_extras = extract_a11y_extras(soup)

            mixed_content = detect_mixed_content(normalized_url, soup)

            fingerprint = text_fingerprint(text)
            read_time = estimate_read_time_minutes(word_count)
            lang_attr = (soup.find('html') or {}).get('lang', '') if soup.find('html') else ''
            detected_language = estimate_language(text)
            language_match = (lang_attr.lower().startswith(detected_language)) if lang_attr and detected_language != "unknown" else None

            link_rel = extract_preloads(soup)
            media_hints = extract_media_hints(soup)

            internal_links_found = []
            external_links_found = []

            for link_tag in soup.find_all('a', href=True):
                href = link_tag.get('href')
                if not href or href.startswith('#') or href.startswith('mailto:') or href.startswith('tel:'):
                    continue

                absolute_href = urljoin(normalized_url, href).split('#')[0].rstrip('/')

                if is_internal(absolute_href, start_url):
                    internal_links_found.append(absolute_href)
                    out_edges[normalized_url].add(absolute_href)
                    if absolute_href not in queued and len(queued) < max_links:
                        to_visit.append((absolute_href, depth + 1))
                        queued.add(absolute_href)
                else:
                    external_links_found.append(absolute_href)

            for t in set(internal_links_found):
                in_edges[t].add(normalized_url)

            site_structure[normalized_url] = {
                "url": normalized_url,
                "title": page_title,
                "meta_description": meta_description,
                "meta_keywords": meta_keywords,
                "h1_tags": h1_tags,
                "text_content": text_content,
                "word_count": word_count,
                "readability_score": readability_score,
                "sentiment": sentiment,
                "keyword_density": keyword_density,
                "image_count": image_count,
                "script_count": script_count,
                "stylesheet_count": stylesheet_count,
                "has_viewport_meta": has_viewport_meta,
                "heading_count": heading_count,
                "paragraph_count": paragraph_count,
                "status_code": status_code,
                "response_time": round(response_time, 2),
                "ttfb": round(response.elapsed.total_seconds() if response.elapsed else 0, 3),
                "internal_links": list(sorted(set(internal_links_found))),
                "external_links": list(sorted(set(external_links_found))),
                "semantic_elements": semantic_elements,
                "heading_issues": heading_issues,
                "unlabeled_inputs": unlabeled_inputs,
                "images_without_alt": images_without_alt,
                "depth": depth,
                "http_delivery": http_delivery,
                "security": security,
                "structured": structured,
                "a11y_extras": a11y_extras,
                "mixed_content": mixed_content,
                "text_hash": fingerprint,
                "read_time_minutes": read_time,
                "lang_attribute": lang_attr,
                "detected_language": detected_language,
                "language_match": language_match,
                "link_rel": link_rel,
                "media_hints": media_hints
            }

        except requests.exceptions.Timeout:
            print(f"Timeout crawling {normalized_url}")
            site_structure[normalized_url] = {
                "url": normalized_url,
                "status_code": "Timeout",
                "error": "Request timed out",
                "depth": depth
            }
        except requests.exceptions.RequestException as e:
            print(f"Failed to crawl {normalized_url}: {e}")
            site_structure[normalized_url] = {
                "url": normalized_url,
                "status_code": "Error",
                "error": str(e),
                "depth": depth
            }
        except Exception as e:
            print(f"An unexpected error occurred while processing {normalized_url}: {e}")
            site_structure[normalized_url] = {
                "url": normalized_url,
                "status_code": "Processing Error",
                "error": str(e),
                "depth": depth
            }

    for url, data in site_structure.items():
        if not isinstance(data, dict):
            continue
        in_deg = len(in_edges.get(url, set()))
        out_deg = len(set(data.get("internal_links") or []))
        data["in_degree"] = in_deg
        data["out_degree"] = out_deg

    root_norm = start_url.rstrip('/')
    for url, data in site_structure.items():
        if not isinstance(data, dict):
            continue
        data["is_orphan"] = (url != root_norm and (data.get("in_degree") or 0) == 0)

    try:
        if root_norm in site_structure and isinstance(site_structure[root_norm], dict):
            site_structure[root_norm]["site_wide"] = site_meta
    except Exception:
        pass

    return site_structure

def save_links_as_json(site_structure, filename='links.json'):
    with open(filename, 'w', encoding='utf-8') as file:
        json.dump(site_structure, file, indent=2, ensure_ascii=False)
    print(f"Site structure saved to {filename}")

if __name__ == "__main__":
    crawled_site_structure = crawl_site(WEBSITE_TO_CRAWL, MAX_PAGES_TO_CRAWL)
    save_links_as_json(crawled_site_structure)
    print("Crawling complete. Starting Flask server subprocess...")
    subprocess.run([sys.executable, "flask_server.py"])
    print("Flask server subprocess has been initiated.")
