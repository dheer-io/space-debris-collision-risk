import json
import os
from datetime import datetime, timedelta, timezone
from sgp4.api import Satrec, WGS72


def propagate_time_series(
    input_file="space_track_satellites.json",
    output_file="propagated_positions.json",
    hours=24,
    step_minutes=10,
):
    data_dir = os.path.join("..", "data")
    input_path = os.path.join(data_dir, input_file)
    output_path = os.path.join(data_dir, output_file)

    if not os.path.exists(input_path):
        print(f"Error: Could not find input file at {input_path}")
        return

    with open(input_path, "r", encoding="utf-8") as f:
        satellites = json.load(f)

    start_time = datetime.now(timezone.utc)
    # Generate time steps over the forecast window
    time_steps = [
        start_time + timedelta(minutes=m)
        for m in range(0, hours * 60, step_minutes)
    ]

    # Pre-initialize SGP4 satellite objects in memory
    sat_objects = []
    for sat in satellites:
        try:
            if "TLE_LINE1" in sat and "TLE_LINE2" in sat:
                satrec = Satrec.twoline2rv(
                    sat["TLE_LINE1"], sat["TLE_LINE2"], WGS72
                )
            else:
                satrec = Satrec()
                satrec.sgp4init(
                    WGS72,
                    "i",
                    sat["NORAD_CAT_ID"],
                    sat.get("EPOCH_DAYS", 0.0),
                    sat["BSTAR"],
                    sat["MEAN_MOTION_DOT"],
                    0.0,
                    sat["ECCENTRICITY"],
                    sat["ARG_OF_PERICENTER"] * 0.017453292519943295,
                    sat["INCLINATION"] * 0.017453292519943295,
                    sat["MEAN_ANOMALY"] * 0.017453292519943295,
                    sat["MEAN_MOTION"] * 0.004363323129985824,
                    sat["RA_OF_ASC_NODE"] * 0.017453292519943295,
                )
            sat_objects.append(
                {
                    "norad_id": sat.get("NORAD_CAT_ID"),
                    "name": sat.get("OBJECT_NAME", "UNKNOWN"),
                    "satrec": satrec,
                }
            )
        except Exception:
            continue

    print(
        f"Propagating {len(sat_objects)} satellites across {len(time_steps)} time steps..."
    )

    propagated_dataset = []

    for dt in time_steps:
        jd, fr = jday_from_datetime(dt)
        step_data = {"timestamp": dt.isoformat(), "states": []}

        for obj in sat_objects:
            e, r, v = obj["satrec"].sgp4(jd, fr)
            if e == 0:  # Success
                step_data["states"].append(
                    {
                        "norad_id": obj["norad_id"],
                        "name": obj["name"],
                        "position_eci": [
                            round(r[0], 3),
                            round(r[1], 3),
                            round(r[2], 3),
                        ],
                        "velocity_eci": [
                            round(v[0], 3),
                            round(v[1], 3),
                            round(v[2], 3),
                        ],
                    }
                )

        propagated_dataset.append(step_data)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(propagated_dataset, f, indent=2)

    print(f"Success! Propagation complete. File saved to '{output_path}'.")


def jday_from_datetime(dt):
    year, month, day = dt.year, dt.month, dt.day
    hour, minute, second = dt.hour, dt.minute, dt.second + dt.microsecond / 1e6
    if month <= 2:
        year -= 1
        month += 12
    A = year // 100
    B = 2 - A + (A // 4)
    jd = (
        int(365.25 * (year + 4716))
        + int(30.6001 * (month + 1))
        + day
        + B
        - 1524.5
    )
    fr = (hour + minute / 60.0 + second / 3600.0) / 24.0
    return jd, fr


if __name__ == "__main__":
    propagate_time_series()