from datetime import datetime, timezone

import pytest

from orbital.risk.risk_assessment import (
    assess_conjunction_risk,
    assess_conjunctions,
    calculate_separation_score,
    calculate_velocity_score,
)


def make_conjunction(
    separation=2.0,
    velocity=10.0,
):
    return {
        "object_1": "25544",
        "object_1_name": "ISS (ZARYA)",
        "object_2": "99999",
        "object_2_name": "TEST DEBRIS",
        "frame": "TEME",
        "time_of_closest_approach": (
            datetime(
                2026,
                8,
                22,
                12,
                0,
                tzinfo=timezone.utc,
            )
        ),
        "minimum_separation_km": separation,
        "relative_velocity_km_s": velocity,
    }


def test_zero_separation_has_maximum_score():
    assert (
        calculate_separation_score(0)
        == 100.0
    )


def test_larger_separation_has_lower_score():
    assert (
        calculate_separation_score(2)
        > calculate_separation_score(20)
    )


def test_high_relative_velocity_has_high_score():
    assert (
        calculate_velocity_score(12)
        == 100.0
    )


def test_negative_separation_rejected():
    with pytest.raises(ValueError):
        calculate_separation_score(-1)


def test_negative_velocity_rejected():
    with pytest.raises(ValueError):
        calculate_velocity_score(-1)


def test_risk_assessment_contains_required_fields():
    conjunction = make_conjunction()

    result = assess_conjunction_risk(
        conjunction,
        now=datetime(
            2026,
            8,
            22,
            0,
            0,
            tzinfo=timezone.utc,
        ),
    )

    assert "risk_score" in result
    assert "risk_level" in result
    assert "priority" in result
    assert "separation_score" in result
    assert "velocity_score" in result
    assert "time_urgency" in result


def test_risk_score_is_between_zero_and_hundred():
    result = assess_conjunction_risk(
        make_conjunction(),
        now=datetime(
            2026,
            8,
            22,
            0,
            0,
            tzinfo=timezone.utc,
        ),
    )

    assert 0 <= result["risk_score"] <= 100


def test_conjunctions_sorted_by_risk():
    low = make_conjunction(
        separation=20,
        velocity=2,
    )

    high = make_conjunction(
        separation=0.5,
        velocity=12,
    )

    results = assess_conjunctions(
        [low, high],
        now=datetime(
            2026,
            8,
            22,
            0,
            0,
            tzinfo=timezone.utc,
        ),
    )

    assert (
        results[0]["risk_score"]
        >= results[1]["risk_score"]
    )


def test_missing_field_rejected():
    conjunction = make_conjunction()

    del conjunction[
        "minimum_separation_km"
    ]

    with pytest.raises(ValueError):
        assess_conjunction_risk(conjunction)