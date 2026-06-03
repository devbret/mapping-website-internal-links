import os
import json
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("ANTHROPIC_API_KEY")
if not api_key:
    raise ValueError("ANTHROPIC_API_KEY not found in environment variables. Please set it in your .env file.")

try:
    anthropic = Anthropic(api_key=api_key)
except Exception as e:
    raise ValueError(f"Failed to initialize Anthropic client: {e}")


RELEVANT_FIELDS = (
    "url",
    "title",
    "meta_description",
    "meta_keywords",
    "h1_tags",
    "word_count",
    "readability_score",
    "sentiment",
    "keyword_density",
    "image_count",
    "script_count",
    "stylesheet_count",
    "has_viewport_meta",
    "heading_count",
    "paragraph_count",
    "status_code",
    "response_time",
    "ttfb",
    "internal_links",
    "external_links",
    "semantic_elements",
    "heading_issues",
    "unlabeled_inputs",
    "images_without_alt",
    "depth",
    "security",
    "structured",
    "a11y_extras",
    "mixed_content",
    "read_time_minutes",
    "lang_attribute",
    "detected_language",
    "language_match",
    "link_rel",
    "media_hints",
    "in_degree",
    "out_degree",
    "is_orphan",
)


def _trim_page_data(page_data):
    return {k: page_data[k] for k in RELEVANT_FIELDS if k in page_data}


def analyze_with_anthropic(page_data):
    system_prompt = """You are an expert analyst. Your task is to review structured JSON data from a webpage.
Summarize the strengths and weaknesses of this page in terms of SEO, accessibility, and semantic HTML structure.
Provide specific, actionable suggestions for improvements.
Structure your response clearly, using Markdown for headings (e.g., ## Strengths, ## Weaknesses, ## Suggestions)."""

    trimmed_data = _trim_page_data(page_data)
    user_message_content = f"""
Here is a structured JSON of a webpage:

{json.dumps(trimmed_data, indent=2)}

Please analyze it based on the instructions provided.
"""

    try:
        response = anthropic.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            temperature=0.5,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": user_message_content
                }
            ]
        )
        if response.content:
            text_parts = [
                block.text for block in response.content
                if getattr(block, "type", None) == "text"
            ]
            if text_parts:
                return "".join(text_parts).strip()
        return "No content returned from API."

    except Exception as e:
        error_message = f"Anthropic API error: {e}"
        print(error_message)
        if hasattr(e, 'response') and hasattr(e.response, 'json'):
            try:
                error_details = e.response.json()
                error_message += f" | Details: {json.dumps(error_details)}"
            except json.JSONDecodeError:
                error_message += f" | Details: (Could not decode JSON error response from API)"


        raise Exception(error_message)