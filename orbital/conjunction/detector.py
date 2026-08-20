"""
Conjunction detection for propagated space-object trajectories.

INPUT:
    JSON trajectory files produced by orbital propagation.

The propagation module produces data in this form:

{
    "name": "ISS (ZARYA)",
    "norad_id": 25544,
    "frame": "TEME",
    "position_unit": "km",
    "velocity_unit": "km/s",
    "start_time": "...",
    "duration_seconds": 5400,
    "step_seconds": 600,
    "trajectory": [
        {
            "timestamp": "...",
            "position_km": [x, y, z],
            "velocity_km_s": [vx, vy, vz],
            "frame": "TEME"
        }
    ]
}

OUTPUT:
    Conjunction events containing:

        object_1
        object_2
        time_of_closest_approach
        minimum_separation_km
        relative_velocity_km_s

This module does NOT perform orbital propagation.
It consumes the output produced by the propagation module.
"""

from __future__ import annotations

import argparse
import json

from datetime import datetime, timedelta
from math import sqrt
from pathlib import Path
from typing import Any


# =====================================================================
# INPUT
# =====================================================================


def parse_timestamp(value: str | datetime) -> datetime:
    """
    Convert an ISO-8601 timestamp into a timezone-aware datetime.
    """

    if isinstance(value, datetime):
        timestamp = value

    elif isinstance(value, str):
        timestamp = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )

    else:
        raise TypeError(
            "Timestamp must be a datetime or ISO-8601 string."
        )

    if timestamp.tzinfo is None:
        raise ValueError(
            "Timestamp must contain timezone information."
        )

    return timestamp


def normalize_state(point: dict[str, Any]) -> dict[str, Any]:
    """
    Convert one propagation trajectory point into the internal
    state representation used by the conjunction detector.

    Propagation output:

        position_km = [x, y, z]
        velocity_km_s = [vx, vy, vz]

    Internal representation:

        x, y, z
        vx, vy, vz
    """

    if "timestamp" not in point:
        raise ValueError(
            "Trajectory point is missing 'timestamp'."
        )

    if "position_km" not in point:
        raise ValueError(
            "Trajectory point is missing 'position_km'."
        )

    if "velocity_km_s" not in point:
        raise ValueError(
            "Trajectory point is missing 'velocity_km_s'."
        )

    position = point["position_km"]
    velocity = point["velocity_km_s"]

    if len(position) != 3:
        raise ValueError(
            "position_km must contain exactly 3 values."
        )

    if len(velocity) != 3:
        raise ValueError(
            "velocity_km_s must contain exactly 3 values."
        )

    return {
        "timestamp": parse_timestamp(
            point["timestamp"]
        ),
        "x": float(position[0]),
        "y": float(position[1]),
        "z": float(position[2]),
        "vx": float(velocity[0]),
        "vy": float(velocity[1]),
        "vz": float(velocity[2]),
    }


def load_trajectory(
    json_file: str | Path,
) -> dict[str, Any]:
    """
    Load one trajectory JSON file produced by the
    orbital propagation module.

    Returns:

        {
            "name": ...,
            "norad_id": ...,
            "frame": ...,
            "trajectory": [...]
        }
    """

    json_file = Path(json_file)

    if not json_file.exists():
        raise FileNotFoundError(
            f"Trajectory file not found: {json_file}"
        )

    with json_file.open(
        "r",
        encoding="utf-8",
    ) as file:

        data = json.load(file)

    required_fields = [
        "name",
        "norad_id",
        "frame",
        "position_unit",
        "velocity_unit",
        "trajectory",
    ]

    missing_fields = [
        field
        for field in required_fields
        if field not in data
    ]

    if missing_fields:
        raise ValueError(
            f"Trajectory file is missing fields: "
            f"{missing_fields}"
        )

    if data["position_unit"] != "km":
        raise ValueError(
            "Conjunction detection expects position "
            "units in kilometres."
        )

    if data["velocity_unit"] != "km/s":
        raise ValueError(
            "Conjunction detection expects velocity "
            "units in kilometres/second."
        )

    trajectory = [
        normalize_state(point)
        for point in data["trajectory"]
    ]

    if not trajectory:
        raise ValueError(
            "Trajectory contains no data points."
        )

    # Ensure timestamps are strictly increasing.
    for previous, current in zip(
        trajectory,
        trajectory[1:],
    ):

        if (
            current["timestamp"]
            <= previous["timestamp"]
        ):
            raise ValueError(
                "Trajectory timestamps must be "
                "strictly increasing."
            )

    return {
        "name": data["name"],
        "norad_id": str(data["norad_id"]),
        "frame": data["frame"],
        "trajectory": trajectory,
    }


# =====================================================================
# BASIC CALCULATIONS
# =====================================================================


def calculate_separation(
    state_a: dict[str, Any],
    state_b: dict[str, Any],
) -> float:
    """
    Calculate the straight-line distance between
    two objects.

    Returns:
        Separation in kilometres.
    """

    difference_x = (
        state_a["x"] - state_b["x"]
    )

    difference_y = (
        state_a["y"] - state_b["y"]
    )

    difference_z = (
        state_a["z"] - state_b["z"]
    )

    return sqrt(
        difference_x**2
        + difference_y**2
        + difference_z**2
    )


def calculate_relative_velocity(
    state_a: dict[str, Any],
    state_b: dict[str, Any],
) -> float:
    """
    Calculate relative speed between two objects.

    Returns:
        Relative velocity in km/s.
    """

    difference_vx = (
        state_a["vx"] - state_b["vx"]
    )

    difference_vy = (
        state_a["vy"] - state_b["vy"]
    )

    difference_vz = (
        state_a["vz"] - state_b["vz"]
    )

    return sqrt(
        difference_vx**2
        + difference_vy**2
        + difference_vz**2
    )


def relative_position(
    state_a: dict[str, Any],
    state_b: dict[str, Any],
) -> tuple[float, float, float]:
    """
    Return relative position vector:

        r = r_A - r_B
    """

    return (
        state_a["x"] - state_b["x"],
        state_a["y"] - state_b["y"],
        state_a["z"] - state_b["z"],
    )


def relative_velocity(
    state_a: dict[str, Any],
    state_b: dict[str, Any],
) -> tuple[float, float, float]:
    """
    Return relative velocity vector:

        v = v_A - v_B
    """

    return (
        state_a["vx"] - state_b["vx"],
        state_a["vy"] - state_b["vy"],
        state_a["vz"] - state_b["vz"],
    )


# =====================================================================
# TRAJECTORY VALIDATION
# =====================================================================


def validate_same_frame(
    object_a: dict[str, Any],
    object_b: dict[str, Any],
) -> None:
    """
    Make sure both objects use the same coordinate frame.
    """

    if object_a["frame"] != object_b["frame"]:

        raise ValueError(
            "Cannot compare objects in different "
            f"coordinate frames: "
            f"{object_a['frame']} vs "
            f"{object_b['frame']}"
        )


def match_states_by_timestamp(
    states_a: list[dict[str, Any]],
    states_b: list[dict[str, Any]],
) -> list[
    tuple[
        dict[str, Any],
        dict[str, Any],
    ]
]:
    """
    Match trajectory states that have identical timestamps.

    The propagation module should generate all objects
    using the same start time and step size.
    """

    states_b_by_time = {
        state["timestamp"]: state
        for state in states_b
    }

    matched_states = []

    for state_a in states_a:

        state_b = states_b_by_time.get(
            state_a["timestamp"]
        )

        if state_b is not None:
            matched_states.append(
                (state_a, state_b)
            )

    return matched_states


# =====================================================================
# CLOSEST APPROACH
# =====================================================================


def interpolate_state(
    state_start: dict[str, Any],
    state_end: dict[str, Any],
    fraction: float,
) -> dict[str, Any]:
    """
    Linearly interpolate between two trajectory states.

    fraction = 0
        -> beginning of interval

    fraction = 1
        -> end of interval
    """

    return {
        "timestamp": (
            state_start["timestamp"]
            + (
                state_end["timestamp"]
                - state_start["timestamp"]
            )
            * fraction
        ),

        "x": (
            state_start["x"]
            + fraction
            * (
                state_end["x"]
                - state_start["x"]
            )
        ),

        "y": (
            state_start["y"]
            + fraction
            * (
                state_end["y"]
                - state_start["y"]
            )
        ),

        "z": (
            state_start["z"]
            + fraction
            * (
                state_end["z"]
                - state_start["z"]
            )
        ),

        "vx": (
            state_start["vx"]
            + fraction
            * (
                state_end["vx"]
                - state_start["vx"]
            )
        ),

        "vy": (
            state_start["vy"]
            + fraction
            * (
                state_end["vy"]
                - state_start["vy"]
            )
        ),

        "vz": (
            state_start["vz"]
            + fraction
            * (
                state_end["vz"]
                - state_start["vz"]
            )
        ),
    }


def closest_point_in_interval(
    state_a_start: dict[str, Any],
    state_b_start: dict[str, Any],
    state_a_end: dict[str, Any],
    state_b_end: dict[str, Any],
) -> dict[str, Any]:
    """
    Estimate the closest approach inside one
    propagation interval.

    The relative motion is approximated as linear
    inside the interval.

    This allows us to estimate a closest approach
    between two sampled timestamps instead of
    assuming the closest approach occurred exactly
    at one of the samples.
    """

    start_time = (
        state_a_start["timestamp"]
    )

    end_time = (
        state_a_end["timestamp"]
    )

    interval_seconds = (
        end_time - start_time
    ).total_seconds()

    if interval_seconds <= 0:
        raise ValueError(
            "Trajectory timestamps must be "
            "strictly increasing."
        )

    r = relative_position(
        state_a_start,
        state_b_start,
    )

    v = relative_velocity(
        state_a_start,
        state_b_start,
    )

    velocity_squared = sum(
        component**2
        for component in v
    )

    # If relative velocity is zero, the separation
    # does not change under the linear approximation.
    if velocity_squared == 0:

        time_from_start = 0.0

    else:

        # Time at which:
        #
        # |r + vt|
        #
        # reaches its minimum.
        time_from_start = -sum(
            r[index] * v[index]
            for index in range(3)
        ) / velocity_squared

        # The mathematical minimum may lie outside
        # this interval, so clamp it.
        time_from_start = max(
            0.0,
            min(
                interval_seconds,
                time_from_start,
            ),
        )

    fraction = (
        time_from_start
        / interval_seconds
    )

    interpolated_a = interpolate_state(
        state_a_start,
        state_a_end,
        fraction,
    )

    interpolated_b = interpolate_state(
        state_b_start,
        state_b_end,
        fraction,
    )

    closest_time = (
        start_time
        + timedelta(
            seconds=time_from_start
        )
    )

    return {
        "time_of_closest_approach": closest_time,

        "minimum_separation_km": calculate_separation(
            interpolated_a,
            interpolated_b,
        ),

        "relative_velocity_km_s": calculate_relative_velocity(
            interpolated_a,
            interpolated_b,
        ),
    }


# =====================================================================
# FIND CLOSEST APPROACH BETWEEN TWO OBJECTS
# =====================================================================


def find_closest_approach(
    object_a: dict[str, Any],
    object_b: dict[str, Any],
) -> dict[str, Any]:
    """
    Find the estimated closest approach between
    two propagated objects.
    """

    validate_same_frame(
        object_a,
        object_b,
    )

    states_a = object_a["trajectory"]
    states_b = object_b["trajectory"]

    matched_states = match_states_by_timestamp(
        states_a,
        states_b,
    )

    if not matched_states:

        raise ValueError(
            "The two trajectories have no common "
            "timestamps. They must be propagated "
            "over the same time window using the "
            "same step size."
        )

    # Only one common timestamp.
    if len(matched_states) == 1:

        state_a, state_b = matched_states[0]

        return {
            "time_of_closest_approach": (
                state_a["timestamp"]
            ),

            "minimum_separation_km": (
                calculate_separation(
                    state_a,
                    state_b,
                )
            ),

            "relative_velocity_km_s": (
                calculate_relative_velocity(
                    state_a,
                    state_b,
                )
            ),
        }

    best_result = None

    # Examine every interval between two
    # consecutive propagation points.
    for index in range(
        len(matched_states) - 1
    ):

        state_a_start, state_b_start = (
            matched_states[index]
        )

        state_a_end, state_b_end = (
            matched_states[index + 1]
        )

        result = closest_point_in_interval(
            state_a_start,
            state_b_start,
            state_a_end,
            state_b_end,
        )

        if (
            best_result is None
            or result[
                "minimum_separation_km"
            ]
            < best_result[
                "minimum_separation_km"
            ]
        ):

            best_result = result

    return best_result


# =====================================================================
# CONJUNCTION DETECTION
# =====================================================================


def detect_conjunctions(
    trajectory_files: list[str | Path],
    threshold_km: float,
) -> list[dict[str, Any]]:
    """
    Detect conjunctions between every pair of
    propagated trajectory files.

    Args:
        trajectory_files:
            JSON files produced by Member 2.

        threshold_km:
            Maximum separation considered a
            conjunction.

    Returns:
        List of conjunction events sorted by
        minimum separation.
    """

    if threshold_km <= 0:

        raise ValueError(
            "threshold_km must be greater than zero."
        )

    if len(trajectory_files) < 2:

        raise ValueError(
            "At least two trajectory files "
            "are required."
        )

    objects = [
        load_trajectory(file)
        for file in trajectory_files
    ]

    conjunctions = []

    for index_a in range(
        len(objects)
    ):

        for index_b in range(
            index_a + 1,
            len(objects),
        ):

            object_a = objects[index_a]
            object_b = objects[index_b]

            result = find_closest_approach(
                object_a,
                object_b,
            )

            if (
                result[
                    "minimum_separation_km"
                ]
                <= threshold_km
            ):

                conjunctions.append(
                    {
                        "object_1": object_a[
                            "norad_id"
                        ],

                        "object_1_name": object_a[
                            "name"
                        ],

                        "object_2": object_b[
                            "norad_id"
                        ],

                        "object_2_name": object_b[
                            "name"
                        ],

                        "frame": object_a[
                            "frame"
                        ],

                        "time_of_closest_approach": (
                            result[
                                "time_of_closest_approach"
                            ]
                        ),

                        "minimum_separation_km": (
                            result[
                                "minimum_separation_km"
                            ]
                        ),

                        "relative_velocity_km_s": (
                            result[
                                "relative_velocity_km_s"
                            ]
                        ),
                    }
                )

    conjunctions.sort(
        key=lambda event:
        event["minimum_separation_km"]
    )

    return conjunctions


# =====================================================================
# COMMAND LINE INTERFACE
# =====================================================================


def main() -> None:
    """
    Run conjunction detection from the command line.

    Example:

        python -m orbital.conjunction.detector \
            object_a.json \
            object_b.json \
            --threshold-km 10
    """

    parser = argparse.ArgumentParser(
        description=(
            "Detect close approaches between "
            "propagated space objects."
        )
    )

    parser.add_argument(
        "trajectory_files",
        nargs="+",
        help=(
            "JSON trajectory files produced "
            "by orbital propagation."
        ),
    )

    parser.add_argument(
        "--threshold-km",
        type=float,
        default=10.0,
        help=(
            "Conjunction distance threshold "
            "in kilometres. Default: 10 km."
        ),
    )

    args = parser.parse_args()

    conjunctions = detect_conjunctions(
        args.trajectory_files,
        args.threshold_km,
    )

    if not conjunctions:

        print(
            "No conjunctions found within "
            "the threshold."
        )

        return

    print(
        f"Found {len(conjunctions)} "
        "conjunction(s):"
    )

    for event in conjunctions:

        print()

        print(
            f"Object 1: "
            f"{event['object_1_name']} "
            f"(NORAD {event['object_1']})"
        )

        print(
            f"Object 2: "
            f"{event['object_2_name']} "
            f"(NORAD {event['object_2']})"
        )

        print(
            f"Frame: "
            f"{event['frame']}"
        )

        print(
            "Time of closest approach: "
            f"{event['time_of_closest_approach'].isoformat()}"
        )

        print(
            "Minimum separation: "
            f"{event['minimum_separation_km']:.6f} km"
        )

        print(
            "Relative velocity: "
            f"{event['relative_velocity_km_s']:.6f} km/s"
        )


if __name__ == "__main__":
    main()