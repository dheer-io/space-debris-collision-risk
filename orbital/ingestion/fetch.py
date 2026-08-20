import json
import time
import requests
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
CATALOG_PATH = DATA_DIR / "catalog_30k.json"
SAMPLE_PATH = DATA_DIR / "sample" / "sample_dev.json"

# Focused list: Starlink + Small Constellations/Debris (NO massive active/leo/meo groups)
FOCUSED_GROUPS = [
    "starlink",
    "oneweb",
    "iridium",
    "globalstar",
    "stations",
    "visual",
    "weather",
    "noaa",
    "goes",
    "resource",
    "sarsat",
    "disaster",
    "tracking",
    "gps-ops",
    "glo-ops",
    "galileo",
    "beidou",
    "geo",
    "molniya",
    "analyst",
    "last-30-days",
    "fengyun-1c-debris",
    "iridium-33-debris",
    "cosmos-2251-debris",
    "cosmos-1408-debris",
    "1999-025-debris"
]

BASE_URL = "https://celestrak.org/NORAD/elements/gp.php"

def fetch_satellites(offline: bool = True) -> list[dict]:
    if offline:
        if not CATALOG_PATH.exists():
            raise FileNotFoundError(f"[ERROR] Offline catalog not found at {CATALOG_PATH}.")
        print(f"[INFO] Loading local catalog from {CATALOG_PATH}...")
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"[SUCCESS] Loaded {len(data)} items from local disk.")
            return data
            
    all_objects = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Encoding": "gzip"
    }
    
    print("[INFO] Fetching focused satellite database (Starlink + Small Groups) from CelesTrak...")
    for group in FOCUSED_GROUPS:
        try:
            params = {"GROUP": group, "FORMAT": "json"}
            response = requests.get(BASE_URL, params=params, headers=headers, timeout=30)
            
            if response.status_code == 200:
                content_type = response.headers.get("Content-Type", "")
                if "application/json" in content_type or response.text.strip().startswith("["):
                    data = response.json()
                    if isinstance(data, list):
                        all_objects.extend(data)
                        print(f"  ✓ Fetched group '{group}': {len(data)} objects")
                    else:
                        print(f"  [WARNING] Group '{group}' returned a non-list JSON structure.")
                else:
                    print(f"  [ERROR] Group '{group}' returned HTML/Text instead of JSON (Rate limited).")
            else:
                print(f"  [ERROR] Group '{group}' returned status code {response.status_code}")
                
        except Exception as e:
            print(f"  [ERROR] Failed to fetch group '{group}': {e}")
            
        time.sleep(3.0) # 3-second delay to ensure Starlink (~11k) downloads smoothly

    if not all_objects:
        raise RuntimeError("[ERROR] Failed to retrieve records from CelesTrak.")

    deduped_dict = {obj["NORAD_CAT_ID"]: obj for obj in all_objects if "NORAD_CAT_ID" in obj}
    unique_objects = list(deduped_dict.values())
    
    print(f"\n[SUCCESS] Total raw pulled: {len(all_objects)} | Unique objects retained: {len(unique_objects)}")
    return unique_objects

def save_local_snapshots():
    DATA_DIR.mkdir(exist_ok=True)
    SAMPLE_PATH.parent.mkdir(exist_ok=True)
    
    data = fetch_satellites(offline=False)
    
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"[SAVED] Focused catalog ({len(data)} items) written to {CATALOG_PATH}")
    
    sample_data = data[:100]
    with open(SAMPLE_PATH, "w", encoding="utf-8") as f:
        json.dump(sample_data, f, indent=2)
    print(f"[SAVED] Dev sample ({len(sample_data)} items) written to {SAMPLE_PATH}")

if __name__ == "__main__":
    save_local_snapshots()