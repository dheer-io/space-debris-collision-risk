import json
from datetime import datetime, timezone

from orbital.propagation.propagator import propagate_and_save
from orbital.conjunction.detector import detect_conjunctions


TLE_FILE = "orbital/propagation/sample_data/iss.tle"


def test_propagation_to_conjunction_detection(tmp_path):
    """
    Integration test for the Member 2 -> Member 3 pipeline.

    Member 2:
        TLE -> orbital propagation -> trajectory JSON

    Member 3:
        trajectory JSON -> conjunction detection
    """

    # ---------------------------------------------------------------
    # STEP 1: Run orbital propagation
    # ---------------------------------------------------------------

    propagated_file = (
        tmp_path / "object_1_trajectory.json"
    )

    start_time = datetime(
        2026,
        8,
        20,
        13,
        0,
        0,
        tzinfo=timezone.utc,
    )

    propagate_and_save(
        TLE_FILE,
        start_time,
        5400,
        600,
        propagated_file,
    )

    # Make sure Member 2 actually produced a file.
    assert propagated_file.exists()

    # ---------------------------------------------------------------
    # STEP 2: Read the output produced by Member 2
    # ---------------------------------------------------------------

    with propagated_file.open(
        "r",
        encoding="utf-8",
    ) as file:
        object_1 = json.load(file)

    # Verify the propagation output contract.
    assert object_1["name"] == "ISS (ZARYA)"
    assert object_1["norad_id"] == 25544
    assert object_1["frame"] == "TEME"
    assert object_1["position_unit"] == "km"
    assert object_1["velocity_unit"] == "km/s"

    assert "trajectory" in object_1
    assert len(object_1["trajectory"]) > 1

    # Every trajectory point must contain the fields
    # expected by detector.py.
    for point in object_1["trajectory"]:
        assert "timestamp" in point
        assert "position_km" in point
        assert "velocity_km_s" in point
        assert "frame" in point

        assert len(point["position_km"]) == 3
        assert len(point["velocity_km_s"]) == 3

    # ---------------------------------------------------------------
    # STEP 3: Create a second propagated-style trajectory
    # ---------------------------------------------------------------
    #
    # For this integration test we do not need a second TLE.
    #
    # We take the real output produced by Member 2 and create
    # another object with a controlled 5 km position offset.
    #
    # This gives the detector two objects that are guaranteed
    # to have a close approach.
    # ---------------------------------------------------------------

    object_2 = json.loads(
        json.dumps(object_1)
    )

    object_2["name"] = "TEST OBJECT"
    object_2["norad_id"] = 99999

    for point in object_2["trajectory"]:
        point["position_km"][0] += 5.0

    second_file = (
        tmp_path / "object_2_trajectory.json"
    )

    with second_file.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            object_2,
            file,
            indent=2,
        )

    # ---------------------------------------------------------------
    # STEP 4: Pass Member 2's output into Member 3
    # ---------------------------------------------------------------

    conjunctions = detect_conjunctions(
        [
            propagated_file,
            second_file,
        ],
        threshold_km=10.0,
    )

    # ---------------------------------------------------------------
    # STEP 5: Verify that Member 3 detected the conjunction
    # ---------------------------------------------------------------

    assert len(conjunctions) == 1

    event = conjunctions[0]

    assert event["object_1"] == "25544"
    assert event["object_1_name"] == "ISS (ZARYA)"

    assert event["object_2"] == "99999"
    assert event["object_2_name"] == "TEST OBJECT"

    assert event["frame"] == "TEME"

    assert event["minimum_separation_km"] <= 10.0

    assert event["minimum_separation_km"] >= 0.0

    assert event["relative_velocity_km_s"] >= 0.0

    assert event[
        "time_of_closest_approach"
    ] is not None