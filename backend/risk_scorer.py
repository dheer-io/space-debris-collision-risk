import json
import math
import os


def compute_collision_probability(
    miss_distance_km, hard_body_radius_m=10.0, position_unc_km=1.0
):
    """Calculates approximate 2D 1D-projected Probability of Collision (Pc).

    - miss_distance_km: Distance between objects at closest approach (km) -
    hard_body_radius_m: Combined physical radius of both objects (meters) -
    position_unc_km: Positional error/sigma for standard TLE accuracy (km)
    """
    r_miss = miss_distance_km
    r_c = hard_body_radius_m / 1000.0  # Convert meters to kilometers
    sigma = position_unc_km

    # Isotropic Gaussian integration approximation for conjunction assessment
    exponent = -(r_miss**2) / (2 * (sigma**2))
    scale_factor = (r_c**2) / (2 * (sigma**2))

    pc = scale_factor * math.exp(exponent)
    return min(pc, 1.0)


def classify_risk(pc, miss_distance_km):
    if pc >= 1e-4 or miss_distance_km < 1.0:
        return "CRITICAL"
    elif pc >= 1e-6 or miss_distance_km < 5.0:
        return "WARNING"
    else:
        return "LOW"


def evaluate_conjunction_risks(
    input_file="conjunctions.json",
    output_file="risk_analyzed_conjunctions.json",
):
    data_dir = os.path.join("..", "data")
    input_path = os.path.join(data_dir, input_file)
    output_path = os.path.join(data_dir, output_file)

    if not os.path.exists(input_path):
        print(f"Error: Could not find input file at {input_path}")
        return

    print("Loading detected conjunction events...")
    with open(input_path, "r", encoding="utf-8") as f:
        conjunctions = json.load(f)

    analyzed_events = []

    for event in conjunctions:
        d_miss = event["miss_distance_km"]
        v_rel = event["relative_velocity_kms"]

        # Calculate Probability of Collision
        pc = compute_collision_probability(d_miss)
        risk_level = classify_risk(pc, d_miss)

        analyzed_events.append({
            "timestamp": event["timestamp"],
            "primary_norad_id": event["primary_norad_id"],
            "primary_name": event["primary_name"],
            "secondary_norad_id": event["secondary_norad_id"],
            "secondary_name": event["secondary_name"],
            "miss_distance_km": d_miss,
            "relative_velocity_kms": v_rel,
            "collision_probability": round(pc, 8),
            "risk_level": risk_level,
        })

    # Sort events by highest risk / lowest miss distance
    analyzed_events.sort(key=lambda x: x["miss_distance_km"])

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analyzed_events, f, indent=4)

    print(
        f"Risk Scoring Complete! Processed {len(analyzed_events)} events into '{output_path}'."
    )


if __name__ == "__main__":
    evaluate_conjunction_risks()