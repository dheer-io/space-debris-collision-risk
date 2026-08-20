import json
from pathlib import Path

DATA_DIR = Path("data")
CATALOG_PATH = DATA_DIR / "catalog_30k.json"
BACKUP_PATH = DATA_DIR / "backup_19.json"  # Replace with your actual backup filename


def merge_catalogs():
    all_items = []

    # Load current catalog if it exists
    if CATALOG_PATH.exists():
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            current_data = json.load(f)
            all_items.extend(current_data)
            print(
                f"Loaded {len(current_data)} items from current catalog_30k.json"
            )

    # Load backup catalog
    if BACKUP_PATH.exists():
        with open(BACKUP_PATH, "r", encoding="utf-8") as f:
            backup_data = json.load(f)
            all_items.extend(backup_data)
            print(f"Loaded {len(backup_data)} items from backup file.")

    # Deduplicate strictly by NORAD_CAT_ID
    deduped = {
        obj["NORAD_CAT_ID"]: obj for obj in all_items if "NORAD_CAT_ID" in obj
    }
    final_list = list(deduped.values())

    # Save back to catalog_30k.json
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(final_list, f, indent=2)

    print(
        f"\n[SUCCESS] Merged and saved a total of {len(final_list)} unique objects to {CATALOG_PATH}"
    )


if __name__ == "__main__":
    merge_catalogs()