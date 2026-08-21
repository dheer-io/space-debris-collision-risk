import json
import math
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

def calculate_tle_checksum(line: str) -> int:
    checksum = 0
    for char in line[:68]:
        if char.isdigit():
            checksum += int(char)
        elif char == '-':
            checksum += 1
    return checksum % 10

def format_epoch(epoch_iso: str) -> str:
    dt = datetime.fromisoformat(epoch_iso)
    year_yy = dt.strftime("%y")
    start_of_year = datetime(dt.year, 1, 1)
    day_of_year = (dt - start_of_year).days + 1
    seconds_in_day = dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond / 1e6
    day_fraction = day_of_year + (seconds_in_day / 86400.0)
    return f"{year_yy}{day_fraction:012.8f}"

def format_decimal_exp(val: float) -> str:
    if val == 0 or abs(val) < 1e-12:
        return " 00000-0"
    sign = '-' if val < 0 else ' '
    abs_val = abs(val)
    exp = int(math.floor(math.log10(abs_val))) + 1
    mantissa = round((abs_val / (10 ** exp)) * 100000)
    if mantissa >= 100000:
        mantissa //= 10
        exp += 1
    exp_sign = '-' if exp < 0 else '+'
    return f"{sign}{mantissa:05d}{exp_sign}{abs(exp):1d}"

def format_mean_motion_dot(val: float) -> str:
    sign = '-' if val < 0 else ' '
    abs_val = abs(val)
    val_str = f"{abs_val:.8f}".lstrip('0')
    if val_str.startswith('.'):
        val_str = val_str[:9]
    return f"{sign}{val_str:>9}"

def determine_object_type(name: str) -> str:
    name_upper = name.upper()
    if "DEB" in name_upper or "DEBRIS" in name_upper:
        return "debris"
    elif "R/B" in name_upper or "ROCKET" in name_upper:
        return "rocket_body"
    return "payload"

def convert_gp_to_tle_schema(gp_obj: dict) -> dict:
    norad_id = int(gp_obj["NORAD_CAT_ID"])
    cat_id_str = f"{norad_id:05d}"
    classification = gp_obj.get("CLASSIFICATION_TYPE", "U")
    
    raw_obj_id = gp_obj.get("OBJECT_ID", "")
    if len(raw_obj_id) >= 8:
        obj_id_str = f"{raw_obj_id[2:4]}{raw_obj_id[5:8]}{raw_obj_id[8:]:<3}"
    else:
        obj_id_str = raw_obj_id.ljust(8)

    epoch_str = format_epoch(gp_obj["EPOCH"])
    mm_dot_str = format_mean_motion_dot(gp_obj.get("MEAN_MOTION_DOT", 0.0))
    mm_ddot_str = format_decimal_exp(gp_obj.get("MEAN_MOTION_DDOT", 0.0))
    bstar_str = format_decimal_exp(gp_obj.get("BSTAR", 0.0))
    ephem_type = int(gp_obj.get("EPHEMERIS_TYPE", 0))
    elem_set = int(gp_obj.get("ELEMENT_SET_NO", 0))

    line1_raw = (
        f"1 {cat_id_str}{classification} {obj_id_str} "
        f"{epoch_str} {mm_dot_str} {mm_ddot_str} "
        f"{bstar_str} {ephem_type} {elem_set:>4d}"
    )
    line1 = f"{line1_raw}{calculate_tle_checksum(line1_raw)}"

    inc_str = f"{gp_obj['INCLINATION']:8.4f}"
    raan_str = f"{gp_obj['RA_OF_ASC_NODE']:8.4f}"
    ecc_str = f"{round(gp_obj['ECCENTRICITY'] * 1e7):07d}"
    argp_str = f"{gp_obj['ARG_OF_PERICENTER']:8.4f}"
    ma_str = f"{gp_obj['MEAN_ANOMALY']:8.4f}"
    mm_str = f"{gp_obj['MEAN_MOTION']:11.8f}"
    rev_str = f"{int(gp_obj.get('REV_AT_EPOCH', 0)):05d}"

    line2_raw = (
        f"2 {cat_id_str} {inc_str} {raan_str} {ecc_str} "
        f"{argp_str} {ma_str} {mm_str}{rev_str}"
    )
    line2 = f"{line2_raw}{calculate_tle_checksum(line2_raw)}"

    # Returns the JSON structure you requested
    return {
        "name": gp_obj["OBJECT_NAME"],
        "norad_id": norad_id,
        "type": determine_object_type(gp_obj["OBJECT_NAME"]),
        "line1": line1,
        "line2": line2
    }

if __name__ == "__main__":
    # One-time script to convert your giant merged dataset
    input_path = DATA_DIR / "catalog_30k.json"
    output_path = DATA_DIR / "catalog_parsed.json"
    
    print(f"Reading {input_path}...")
    with open(input_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)
        
    print(f"Parsing {len(raw_data)} objects into TLE JSON schema...")
    parsed_data = [convert_gp_to_tle_schema(obj) for obj in raw_data]
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(parsed_data, f, indent=2)
        
    print(f"Success! {len(parsed_data)} objects saved to {output_path}")