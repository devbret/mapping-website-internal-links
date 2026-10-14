# Mapping A Website's Internal Links

![Preview Of Resulting Visualization](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/add032be-02bf-45ce-9ebb-f93ae35eace6.png)

Crawl a website’s internal pages to extract SEO, accessibility, performance and link-structure data, then visualize the results as a D3 network graph with page scorecards and analysis from Claude.

## Application Overview

The Python crawler in `app.py` begins with a chosen website, visits up to a user-defined number of internal pages and extracts details about accessibility, performance, security, links and more. It then saves the generated site map and audit data to `links.json` before launching a `Flask` server that hosts the frontend and the analysis API.

On the frontend, `main.js` loads `links.json` and renders the crawled website as a D3 network graph, with pages represented as nodes and internal links shown as connections. The `Flask` backend in `flask_server.py` provides an API for analyzing selected pages, while `anthropic_api.py` sends each page’s structured crawl data to `Claude` for a review of SEO, accessibility and suggested improvements.

## Basic Setup Instructions

Below are the required software programs and instructions for using this application on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Setup Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/mapping-website-internal-links.git`

4. Navigate to the repo's directory: `cd mapping-website-internal-links`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate your virtual environment: `source venv/bin/activate`

7. Install the needed dependencies: `pip install -r requirements.txt`

8. Change the local `.env.template` file into a `.env` file: `cp .env.template .env`

9. Set the environment variable for your Anthropic API key in the new `.env` file

10. In the new `.env` file, set the `WEBSITE_TO_CRAWL` variable to your chosen website

11. In the new `.env` file, set the `MAX_PAGES_TO_CRAWL` variable to the maximum number of pages to crawl

12. Run the primary script: `python3 app.py`

13. Once crawling completes, open the local app in your browser: `http://localhost:5000`

14. When finished exploring, stop the `Flask` server: `CTRL + C`

15. Exit the virtual environment: `deactivate`

## Other Considerations

Below you will find additional context about the project beyond setup and usage. It highlights the technical abilities this repo is demonstrates, provides license information and offers troubleshooting tips for common issues.

### Abilities Demonstrated

This project repo is intended to demonstrate an ability to do the following:

- Crawl a website’s internal pages and turn the structure into a JSON dataset

- Extract SEO, accessibility, performance, security and other measurements from each page crawled

- Visualize the website as a D3 network graph, making internal links easier to explore

- Enable users to request analysis by `Claude` for improvement suggestions

### License Information

This project is released under the [MIT License](LICENSE). You are free to use, copy, modify, merge, publish, distribute, sublicense and/or sell copies of this software, provided the original copyright notice and permission notice are included in all copies or substantial portions of the software. The software is provided "as is", without a warranty of any kind.

### Troubleshooting

If working with GitHub codespaces, you may have to:

- `python -m nltk.downloader punkt_tab`

If all else fails, please contact the maintainer here on GitHub or via [LinkedIn](https://www.linkedin.com/in/bernhoftbret/).

Cheers!
