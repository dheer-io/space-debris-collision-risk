import json
from datetime import datetime, timezone

import pytest

from orbital.conjunction.detector import (
    calculate_relative_velocity,
    calculate_separation,
    detect_conjunctions,
    find_closest_approach,
    load_trajectory,
)


# ---------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------

def create_trajectory_file(
    tmp_path,
    filename,
    name,
    norad_id,
    positions,
    velocities,
):
    """
    Create a temporary trajectory JSON file using the exact
    output format produced by Member 2's propagator.py.
    """

    trajectory = []

    for index, (position, velocity) in enumerate(
        zip(positions, velocities)
    ):
        timestamp = (
            datetime(
                2025,
                1,
                1,
                tzinfo=timezone.utc
            )
        )

        timestamp = timestamp.replace(
            second=index * 2
        )

        trajectory.append(
            {
                "timestamp": timestamp.isoformat(),
                "position_km": list(position),
                "velocity_km_s": list(velocity),
                "frame": "TEME",
            }
        )

    data = {
        "name": name,
        "norad_id": norad_id,
        "frame": "TEME",
        "position_unit": "km",
        "velocity_unit": "km/s",
        "start_time": trajectory[0]["timestamp"],
        "duration_seconds": (
            (len(trajectory) - 1) * 2
        ),
        "step_seconds": 2,
        "trajectory": trajectory,
    }

    file_path = tmp_path / filename

    with file_path.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            data,
            file,
            indent=2,
        )

    return file_path


# ---------------------------------------------------------------------
# TEST 1
# ---------------------------------------------------------------------
# Verify that detector.py correctly reads the exact JSON format
# produced by Member 2.
# ---------------------------------------------------------------------

def test_load_trajectory(tmp_path):

    trajectory_file = create_trajectory_file(
        tmp_path=tmp_path,
        filename="object_a.json",
        name="OBJECT A",
        norad_id=10001,
        positions=[
            (0, 0, 0),
            (2, 0, 0),
            (4, 0, 0),
        ],
        velocities=[
            (1, 0, 0),
            (1, 0, 0),
            (1, 0, 0),
        ],
    )

    result = load_trajectory(
        trajectory_file
    )

    assert result["name"] == "OBJECT A"
    assert result["norad_id"] == "10001"
    assert result["frame"] == "TEME"

    assert len(
        result["trajectory"]
    ) == 3

    first_state = result["trajectory"][0]

    assert first_state["x"] == 0
    assert first_state["y"] == 0
    assert first_state["z"] == 0

    assert first_state["vx"] == 1
    assert first_state["vy"] == 0
    assert first_state["vz"] == 0


# ---------------------------------------------------------------------
# TEST 2
# ---------------------------------------------------------------------
# Verify the basic distance calculation.
# ---------------------------------------------------------------------

def test_calculate_separation():

    state_a = {
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "vx": 0.0,
        "vy": 0.0,
        "vz": 0.0,
    }

    state_b = {
        "x": 3.0,
        "y": 4.0,
        "z": 0.0,
        "vx": 0.0,
        "vy": 0.0,
        "vz": 0.0,
    }

    distance = calculate_separation(
        state_a,
        state_b,
    )

    assert distance == pytest.approx(
        5.0
    )


# ---------------------------------------------------------------------
# TEST 3
# ---------------------------------------------------------------------
# Verify relative velocity calculation.
# ---------------------------------------------------------------------

def test_calculate_relative_velocity():

    state_a = {
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "vx": 1.0,
        "vy": 0.0,
        "vz": 0.0,
    }

    state_b = {
        "x": 0.0,
        "y": 0.0,
        "z": 0.0,
        "vx": -1.0,
        "vy": 0.0,
        "vz": 0.0,
    }

    relative_velocity = (
        calculate_relative_velocity(
            state_a,
            state_b,
        )
    )

    assert relative_velocity == pytest.approx(
        2.0
    )


# ---------------------------------------------------------------------
# TEST 4
# ---------------------------------------------------------------------
# Known closest-approach scenario.
#
# Object A:
#
#     position = (t, 0, 0)
#
# Object B:
#
#     position = (10 - t, 3, 0)
#
# At t = 5:
#
#     A = (5, 0, 0)
#     B = (5, 3, 0)
#
# Therefore:
#
#     minimum distance = 3 km
#     relative velocity = 2 km/s
# ---------------------------------------------------------------------

def test_find_closest_approach(tmp_path):

    positions_a = [
        (0, 0, 0),
        (2, 0, 0),
        (4, 0, 0),
        (6, 0, 0),
        (8, 0, 0),
        (10, 0, 0),
    ]

    positions_b = [
        (10, 3, 0),
        (8, 3, 0),
        (6, 3, 0),
        (4, 3, 0),
        (2, 3, 0),
        (0, 3, 0),
    ]

    velocities_a = [
        (1, 0, 0)
        for _ in positions_a
    ]

    velocities_b = [
        (-1, 0, 0)
        for _ in positions_b
    ]

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        positions_a,
        velocities_a,
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        positions_b,
        velocities_b,
    )

    object_a = load_trajectory(
        file_a
    )

    object_b = load_trajectory(
        file_b
    )

    result = find_closest_approach(
        object_a,
        object_b,
    )

    assert result[
        "minimum_separation_km"
    ] == pytest.approx(
        3.0,
        abs=0.01,
    )

    assert result[
        "relative_velocity_km_s"
    ] == pytest.approx(
        2.0,
        abs=0.01,
    )

    expected_tca = datetime(
        2025,
        1,
        1,
        0,
        0,
        5,
        tzinfo=timezone.utc,
    )

    time_difference = abs(
        result[
            "time_of_closest_approach"
        ]
        - expected_tca
    )

    assert time_difference.total_seconds() <= 0.01


# ---------------------------------------------------------------------
# TEST 5
# ---------------------------------------------------------------------
# Verify that detect_conjunctions() identifies a dangerous pair.
# ---------------------------------------------------------------------

def test_detect_conjunctions_finds_dangerous_pair(
    tmp_path
):

    positions_a = [
        (0, 0, 0),
        (2, 0, 0),
        (4, 0, 0),
        (6, 0, 0),
        (8, 0, 0),
        (10, 0, 0),
    ]

    positions_b = [
        (10, 3, 0),
        (8, 3, 0),
        (6, 3, 0),
        (4, 3, 0),
        (2, 3, 0),
        (0, 3, 0),
    ]

    velocities_a = [
        (1, 0, 0)
        for _ in positions_a
    ]

    velocities_b = [
        (-1, 0, 0)
        for _ in positions_b
    ]

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        positions_a,
        velocities_a,
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        positions_b,
        velocities_b,
    )

    conjunctions = detect_conjunctions(
        [
            file_a,
            file_b,
        ],
        threshold_km=10,
    )

    assert len(
        conjunctions
    ) == 1

    event = conjunctions[0]

    assert event["object_1"] == "10001"
    assert event["object_2"] == "10002"

    assert event[
        "minimum_separation_km"
    ] == pytest.approx(
        3.0,
        abs=0.01,
    )

    assert event[
        "relative_velocity_km_s"
    ] == pytest.approx(
        2.0,
        abs=0.01,
    )


# ---------------------------------------------------------------------
# TEST 6
# ---------------------------------------------------------------------
# Verify that objects that remain far apart are NOT reported.
# ---------------------------------------------------------------------

def test_no_conjunction_for_far_apart_objects(
    tmp_path
):

    positions_a = [
        (0, 0, 0),
        (2, 0, 0),
        (4, 0, 0),
        (6, 0, 0),
        (8, 0, 0),
        (10, 0, 0),
    ]

    positions_b = [
        (0, 500, 0),
        (2, 500, 0),
        (4, 500, 0),
        (6, 500, 0),
        (8, 500, 0),
        (10, 500, 0),
    ]

    velocities_a = [
        (1, 0, 0)
        for _ in positions_a
    ]

    velocities_b = [
        (1, 0, 0)
        for _ in positions_b
    ]

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        positions_a,
        velocities_a,
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        positions_b,
        velocities_b,
    )

    conjunctions = detect_conjunctions(
        [
            file_a,
            file_b,
        ],
        threshold_km=10,
    )

    assert conjunctions == []


# ---------------------------------------------------------------------
# TEST 7
# ---------------------------------------------------------------------
# Verify that mismatched coordinate frames are rejected.
# ---------------------------------------------------------------------

def test_mismatched_frames_raise_error(
    tmp_path
):

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        [(0, 0, 0)],
        [(0, 0, 0)],
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        [(1, 0, 0)],
        [(0, 0, 0)],
    )

    # Modify object B to use a different frame.
    with file_b.open(
        "r",
        encoding="utf-8",
    ) as file:
        data = json.load(file)

    data["frame"] = "ECEF"

    with file_b.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            data,
            file,
            indent=2,
        )

    with pytest.raises(ValueError):
        detect_conjunctions(
            [
                file_a,
                file_b,
            ],
            threshold_km=10,
        )


# ---------------------------------------------------------------------
# TEST 8
# ---------------------------------------------------------------------
# Verify invalid threshold handling.
# ---------------------------------------------------------------------

def test_invalid_threshold_raises_error(
    tmp_path
):

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        [(0, 0, 0)],
        [(0, 0, 0)],
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        [(1, 0, 0)],
        [(0, 0, 0)],
    )

    with pytest.raises(ValueError):
        detect_conjunctions(
            [
                file_a,
                file_b,
            ],
            threshold_km=0,
        )

    with pytest.raises(ValueError):
        detect_conjunctions(
            [
                file_a,
                file_b,
            ],
            threshold_km=-5,
        )


# ---------------------------------------------------------------------
# TEST 9
# ---------------------------------------------------------------------
# Verify that trajectories with no common timestamps are rejected.
# ---------------------------------------------------------------------

def test_mismatched_timestamps_raise_error(
    tmp_path
):

    file_a = create_trajectory_file(
        tmp_path,
        "object_a.json",
        "OBJECT A",
        10001,
        [
            (0, 0, 0),
            (1, 0, 0),
        ],
        [
            (1, 0, 0),
            (1, 0, 0),
        ],
    )

    file_b = create_trajectory_file(
        tmp_path,
        "object_b.json",
        "OBJECT B",
        10002,
        [
            (10, 0, 0),
            (9, 0, 0),
        ],
        [
            (-1, 0, 0),
            (-1, 0, 0),
        ],
    )

    # Change B's first timestamp so the trajectories
    # have no common timestamps.
    with file_b.open(
        "r",
        encoding="utf-8",
    ) as file:
        data = json.load(file)

    for point in data["trajectory"]:
        timestamp = datetime.fromisoformat(
            point["timestamp"]
        )

        timestamp = timestamp.replace(
            minute=1
        )

        point["timestamp"] = (
            timestamp.isoformat()
        )

    with file_b.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            data,
            file,
            indent=2,
        )

    with pytest.raises(ValueError):
        detect_conjunctions(
            [
                file_a,
                file_b,
            ],
            threshold_km=10,
        )