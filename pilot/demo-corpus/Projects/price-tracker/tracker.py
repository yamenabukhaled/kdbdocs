import csv, json, sys, datetime
import requests
from bs4 import BeautifulSoup

def fetch_price(url, selector):
    html = requests.get(url, timeout=10).text
    tag = BeautifulSoup(html, "html.parser").select_one(selector)
    return float(tag.text.strip().lstrip("$")) if tag else None

def main(config_path):
    products = json.load(open(config_path))
    with open("prices.csv", "a", newline="") as f:
        writer = csv.writer(f)
        for p in products:
            writer.writerow([datetime.date.today(), p["name"], fetch_price(p["url"], p["selector"])])

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "products.json")
