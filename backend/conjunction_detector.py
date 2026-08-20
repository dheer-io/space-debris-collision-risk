import json
import os
import numpy as np


def detect_conjunctions(
    input_file="propagated_positions.json",
    output_file="conjunctions.json",
    distance_threshold_km=10.0,
):
    data_dir = os.path.join("..", "data")
    input_path = os.path.join(data_dir, input_file)
    output_path = os.path.join(data_dir, output_file)

    if not os.path.exists(input_path):
        print(f"Error: Could not find input file at {input_path}")
        return

    print("Loading propagated time-series data...")
    with open(input_path, "r", encoding="utf-8") as f:
        time_series = json.load(f)

    conjunctions = []

    print(
        f"Scanning for close approaches (< {distance_threshold_km} km threshold)..."
    )

    for step in time_series:
        timestamp = step["timestamp"]
        states = step["states"]
        num_sats = len(states)

        if num_sats < 2:
            continue

        # Extract positions into a NumPy matrix (N, 3)
        positions = np.array([s["position_eci"] for s in states])
        velocities = np.array([s["velocity_eci"] for s in states])

        # Compute pairwise distance matrix across all satellites in RAM
        # diffs shape: (N, N, 3)
        diffs = positions[:, np.newaxis, :] - positions[np.newaxis, :, :]
        # distances shape: (N, N)
        distances = np.linalg.norm(diffs, axis=2)

        # Find pairs closer than the threshold (ignore diagonal where dist == 0)
        i_indices, j_indices = np.where(
            (distances < distance_threshold_km) & (distances > 0)
        )

        # Iterate through detected close approaches (avoiding duplicates via i < j)
        for i, j in zip(i_indices, j_indices):
            if i < j:
                sat_a = states[i]
                sat_b = states[j]
                miss_distance = float(distances[i, j])

                # Calculate relative velocity vector and magnitude
                v_rel_vec = velocities[i] - velocities[j]
                v_rel_mag = float(np.linalg.norm(v_rel_vec))

                conjunctions.append(
                    {
                        "timestamp": timestamp,
                        "primary_norad_id": sat_a["norad_id"],
                        "primary_name": sat_a["name"],
                        "secondary_norad_id": sat_b["norad_id"],
                        "secondary_name": sat_b["name"],
                        "miss_distance_km": round(miss_distance, 3),
                        "relative_velocity_kms": round(v_rel_mag, 3),
                    }
                )

    # Save flagged events to disk
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(conjunctions, f, indent=4)

    print(
        f"Detection complete! Found {len(conjunctions)} potential conjunction events."
    )
    print(f"Results saved to '{output_path}'.")


if __name__ == "__main__":
    detect_conjunctions()