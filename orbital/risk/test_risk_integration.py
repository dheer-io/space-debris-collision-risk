import json
from datetime import datetime, timezone

from orbital.propagation.propagator import propagate_and_save
from orbital.conjunction.detector import detect_conjunctions
from orbital.risk.risk_assessment import assess_conjunctions


TLE_FILE = "orbital/propagation/sample_data/iss.tle"


def test_propagation_to_conjunction_to_risk(tmp_path):
    """
    Integration test for the complete:

        Member 2 -> Member 3 -> Member 4

    pipeline.

    Member 2:
        TLE -> orbital propagation -> trajectory JSON

    Member 3:
        trajectory JSON -> conjunction detection

    Member 4:
        conjunction event -> risk assessment
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

    assert propagated_file.exists()

    # ---------------------------------------------------------------
    # STEP 2: Read Member 2 output
    # ---------------------------------------------------------------

    with propagated_file.open(
        "r",
        encoding="utf-8",
    ) as file:
        object_1 = json.load(file)

    assert object_1["name"] == "ISS (ZARYA)"
    assert object_1["norad_id"] == 25544
    assert object_1["frame"] == "TEME"
    assert object_1["position_unit"] == "km"
    assert object_1["velocity_unit"] == "km/s"

    assert "trajectory" in object_1
    assert len(object_1["trajectory"]) > 1

    # ---------------------------------------------------------------
    # STEP 3: Validate propagation output
    # ---------------------------------------------------------------

    for point in object_1["trajectory"]:

        assert "timestamp" in point
        assert "position_km" in point
        assert "velocity_km_s" in point
        assert "frame" in point

        assert len(point["position_km"]) == 3
        assert len(point["velocity_km_s"]) == 3

    # ---------------------------------------------------------------
    # STEP 4: Create second test object
    # ---------------------------------------------------------------
    #
    # We copy the real propagated object and shift its position
    # by 5 km.
    #
    # This guarantees a controlled close approach for testing.
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
    # STEP 5: Member 3
    #
    # Trajectory JSON
    #       ↓
    # Conjunction detection
    # ---------------------------------------------------------------

    conjunctions = detect_conjunctions(
        [
            propagated_file,
            second_file,
        ],
        threshold_km=10.0,
    )

    # We expect exactly one conjunction.
    assert len(conjunctions) == 1

    event = conjunctions[0]

    # ---------------------------------------------------------------
    # STEP 6: Validate Member 3 output
    # ---------------------------------------------------------------

    assert event["object_1"] == "25544"
    assert event["object_1_name"] == "ISS (ZARYA)"

    assert event["object_2"] == "99999"
    assert event["object_2_name"] == "TEST OBJECT"

    assert event["frame"] == "TEME"

    assert event["minimum_separation_km"] <= 10.0
    assert event["minimum_separation_km"] >= 0.0

    assert event["relative_velocity_km_s"] >= 0.0

    assert (
        event["time_of_closest_approach"]
        is not None
    )

    # ---------------------------------------------------------------
    # STEP 7: Member 4
    #
    # Conjunction event
    #       ↓
    # Risk assessment
    # ---------------------------------------------------------------

    assessed = assess_conjunctions(
        conjunctions,
        now=datetime(
            2026,
            8,
            20,
            13,
            0,
            0,
            tzinfo=timezone.utc,
        ),
    )

    # ---------------------------------------------------------------
    # STEP 8: Validate Member 4 output
    # ---------------------------------------------------------------

    assert len(assessed) == 1

    risk_event = assessed[0]

    # Original conjunction information must remain available.
    assert risk_event["object_1"] == "25544"
    assert risk_event["object_2"] == "99999"

    # Risk engine outputs.
    assert "separation_score" in risk_event
    assert "velocity_score" in risk_event
    assert "time_urgency" in risk_event

    assert "risk_score" in risk_event
    assert "risk_level" in risk_event
    assert "priority" in risk_event

    # Scores must be normalized to 0-100.
    assert 0.0 <= risk_event["separation_score"] <= 100.0
    assert 0.0 <= risk_event["velocity_score"] <= 100.0
    assert 0.0 <= risk_event["time_urgency"] <= 100.0

    assert 0.0 <= risk_event["risk_score"] <= 100.0

    # Risk level must be one of the supported levels.
    assert risk_event["risk_level"] in {
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
    }

    # Priority must be one of the supported operational priorities.
    assert risk_event["priority"] in {
        "P1",
        "P2",
        "P3",
        "P4",
    }