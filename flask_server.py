import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from anthropic_api import analyze_with_anthropic

site_structure = {}

app = Flask(__name__)
CORS(app)

def load_crawled_data(filename='links.json'):
    global site_structure
    try:
        with open(filename, 'r') as f:
            site_structure = json.load(f)
        print(f"Successfully loaded {len(site_structure)} URLs from {filename}")
    except FileNotFoundError:
        print(f"ERROR: {filename} not found. Make sure app.py has run and created it.")
        site_structure = {}
    except json.JSONDecodeError:
        print(f"ERROR: Could not decode JSON from {filename}. It might be corrupted.")
        site_structure = {}

@app.route('/api/analyze', methods=['POST'])
def analyze():
    data = request.json
    if not data or 'url' not in data:
        return jsonify({"error": "Missing 'url' in request body"}), 400

    requested_url = data['url'].rstrip("/")
    page_data = site_structure.get(requested_url) or site_structure.get(requested_url + "/")

    if not page_data:
        print(f"Debug: URL '{requested_url}' not found in site_structure.")
        print(f"Debug: Available keys: {list(site_structure.keys())[:5]}")
        return jsonify({"error": "No data found for this URL"}), 404

    try:
        analysis = analyze_with_anthropic(page_data)
        return jsonify({"analysis": analysis})
    except Exception as e:
        print(f"Error during analysis for {requested_url}: {e}")
        return jsonify({"error": f"An error occurred during analysis: {str(e)}"}), 500

@app.route('/api/urls')
def list_urls():
    return jsonify(list(site_structure.keys()))

if __name__ == "__main__":
    load_crawled_data()
    debug = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true", "yes")
    app.run(debug=debug)