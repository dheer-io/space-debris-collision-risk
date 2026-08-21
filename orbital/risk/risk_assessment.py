"""
Risk assessment engine for detected orbital conjunctions.

This module consumes conjunction events produced by
``orbital.conjunction.detector`` and converts them into a consistent
risk score, risk level, and operational priority.

IMPORTANT:
    This is a deterministic PoC risk model. It is NOT a true probability
    of collision (Pc) calculation. A production Pc model would require
    state covariance, combined hard-body radius, uncertainty propagation,
    and a validated collision-probability method.

Inputs used by this PoC:
    - minimum separation at closest approach
    - relative velocity at closest approach
    - time remaining until closest approach

Output risk_score is normalized to 0-100.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import exp
from typing import Any


# =====================================================================
# MODEL CONFIGURATION
# =====================================================================

# The weights sum to 1.0.
SEPARATION_WEIGHT = 0.60
VELOCITY_WEIGHT = 0.25
URGENCY_WEIGHT = 0.15

# Distance scale used by the exponential separation model.
SEPARATION_SCALE_KM = 5.0

# Relative velocity at which the velocity component reaches 100.
# This is a PoC normalization, not a physical collision limit.
MAX_RISK_VELOCITY_KM_S = 12.0

# Risk-level thresholds.
CRITICAL_THRESHOLD = 80.0
HIGH_THRESHOLD = 60.0
MEDIUM_THRESHOLD = 35.0


# =====================================================================
# VALIDATION / TIME HELPERS
# =====================================================================

def _validate_non_negative(
    value: float,
    field_name: str,
) -> float:
    """Validate and return a non-negative numeric value."""

    try:
        numeric_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{field_name} must be a numeric value."
        ) from exc

    if numeric_value < 0:
        raise ValueError(
            f"{field_name} must be greater than or equal to zero."
        )

    return numeric_value


def _parse_datetime(
    value: datetime | str,
) -> datetime:
    """Convert an ISO-8601 value into a timezone-aware datetime."""

    if isinstance(value, datetime):
        timestamp = value

    elif isinstance(value, str):
        try:
            timestamp = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            )
        except ValueError as exc:
            raise ValueError(
                "time_of_closest_approach must be "
                "a valid ISO-8601 timestamp."
            ) from exc

    else:
        raise ValueError(
            "time_of_closest_approach must be "
            "a datetime or ISO-8601 string."
        )

    if timestamp.tzinfo is None:
        raise ValueError(
            "time_of_closest_approach must contain "
            "timezone information."
        )

    return timestamp


def _normalise_now(
    now: datetime | str | None,
) -> datetime:
    """Return the reference time as a timezone-aware UTC datetime."""

    if now is None:
        timestamp = datetime.now(timezone.utc)

    else:
        timestamp = _parse_datetime(now)

    return timestamp.astimezone(timezone.utc)


# =====================================================================
# COMPONENT SCORES
# =====================================================================

def calculate_separation_score(
    separation_km: float,
) -> float:
    """
    Convert minimum separation into a 0-100 risk score.

    Smaller separation produces a higher score.
    """

    separation = _validate_non_negative(
        separation_km,
        "separation_km",
    )

    score = 100.0 * exp(
        -separation / SEPARATION_SCALE_KM
    )

    return round(
        max(0.0, min(100.0, score)),
        2,
    )


def calculate_velocity_score(
    relative_velocity_km_s: float,
) -> float:
    """
    Convert relative velocity into a 0-100 risk score.

    A relative velocity of MAX_RISK_VELOCITY_KM_S
    or greater receives the maximum score.

    This is a PoC normalization, not a physical
    statement that 12 km/s is inherently dangerous.
    """

    velocity = _validate_non_negative(
        relative_velocity_km_s,
        "relative_velocity_km_s",
    )

    score = (
        velocity / MAX_RISK_VELOCITY_KM_S
    ) * 100.0

    return round(
        max(0.0, min(100.0, score)),
        2,
    )


def calculate_time_urgency(
    time_of_closest_approach: datetime | str,
    now: datetime | str | None = None,
) -> float:
    """
    Convert time remaining until closest approach
    into a 0-100 urgency score.

    <= 1 hour
        100

    1-24 hours
        decreases from 100 to 20

    24-72 hours
        decreases from 20 to 0

    > 72 hours
        0

    A closest approach that has already occurred is
    treated as maximum urgency.
    """

    cpa = _parse_datetime(
        time_of_closest_approach
    )

    reference_time = _normalise_now(now)

    cpa = cpa.astimezone(timezone.utc)

    hours_remaining = (
        cpa - reference_time
    ).total_seconds() / 3600.0

    if hours_remaining <= 1.0:
        return 100.0

    if hours_remaining <= 24.0:
        score = 100.0 - (
            (hours_remaining - 1.0)
            / 23.0
            * 80.0
        )

        return round(score, 2)

    if hours_remaining <= 72.0:
        score = 20.0 - (
            (hours_remaining - 24.0)
            / 48.0
            * 20.0
        )

        return round(
            max(0.0, score),
            2,
        )

    return 0.0


# =====================================================================
# RISK CLASSIFICATION
# =====================================================================

def classify_risk_level(
    risk_score: float,
) -> str:
    """Map a 0-100 risk score to a risk level."""

    score = _validate_non_negative(
        risk_score,
        "risk_score",
    )

    if score > 100.0:
        raise ValueError(
            "risk_score must not exceed 100."
        )

    if score >= CRITICAL_THRESHOLD:
        return "CRITICAL"

    if score >= HIGH_THRESHOLD:
        return "HIGH"

    if score >= MEDIUM_THRESHOLD:
        return "MEDIUM"

    return "LOW"


def classify_priority(
    risk_score: float,
) -> str:
    """Map a risk score to an operational priority."""

    level = classify_risk_level(
        risk_score
    )

    return {
        "CRITICAL": "P1",
        "HIGH": "P2",
        "MEDIUM": "P3",
        "LOW": "P4",
    }[level]


# =====================================================================
# INPUT VALIDATION
# =====================================================================

def _validate_conjunction(
    conjunction: dict[str, Any],
) -> None:
    """Validate the fields required by the risk engine."""

    if not isinstance(conjunction, dict):
        raise ValueError(
            "conjunction must be a dictionary."
        )

    required_fields = (
        "object_1",
        "object_1_name",
        "object_2",
        "object_2_name",
        "frame",
        "time_of_closest_approach",
        "minimum_separation_km",
        "relative_velocity_km_s",
    )

    missing_fields = [
        field
        for field in required_fields
        if field not in conjunction
    ]

    if missing_fields:
        raise ValueError(
            "Conjunction is missing required fields: "
            f"{missing_fields}"
        )

    _validate_non_negative(
        conjunction[
            "minimum_separation_km"
        ],
        "minimum_separation_km",
    )

    _validate_non_negative(
        conjunction[
            "relative_velocity_km_s"
        ],
        "relative_velocity_km_s",
    )

    _parse_datetime(
        conjunction[
            "time_of_closest_approach"
        ]
    )


# =====================================================================
# MAIN RISK ENGINE
# =====================================================================

def assess_conjunction_risk(
    conjunction: dict[str, Any],
    now: datetime | str | None = None,
) -> dict[str, Any]:
    """
    Assess one conjunction event.

    Returns the original conjunction fields plus:

        separation_score
        velocity_score
        time_urgency
        risk_score
        risk_level
        priority
    """

    _validate_conjunction(
        conjunction
    )

    separation_score = (
        calculate_separation_score(
            conjunction[
                "minimum_separation_km"
            ]
        )
    )

    velocity_score = (
        calculate_velocity_score(
            conjunction[
                "relative_velocity_km_s"
            ]
        )
    )

    time_urgency = (
        calculate_time_urgency(
            conjunction[
                "time_of_closest_approach"
            ],
            now=now,
        )
    )

    risk_score = (
        separation_score
        * SEPARATION_WEIGHT
        + velocity_score
        * VELOCITY_WEIGHT
        + time_urgency
        * URGENCY_WEIGHT
    )

    risk_score = round(
        max(
            0.0,
            min(100.0, risk_score),
        ),
        2,
    )

    risk_level = classify_risk_level(
        risk_score
    )

    priority = classify_priority(
        risk_score
    )

    result = dict(conjunction)

    result.update(
        {
            "separation_score": (
                separation_score
            ),
            "velocity_score": (
                velocity_score
            ),
            "time_urgency": (
                time_urgency
            ),
            "risk_score": risk_score,
            "risk_level": risk_level,
            "priority": priority,
        }
    )

    return result


# =====================================================================
# BATCH ASSESSMENT
# =====================================================================

def assess_conjunctions(
    conjunctions: list[dict[str, Any]],
    now: datetime | str | None = None,
) -> list[dict[str, Any]]:
    """
    Assess multiple conjunctions and sort them
    from highest to lowest risk.
    """

    if not isinstance(
        conjunctions,
        list,
    ):
        raise ValueError(
            "conjunctions must be a list."
        )

    assessed = [
        assess_conjunction_risk(
            conjunction,
            now=now,
        )
        for conjunction in conjunctions
    ]

    assessed.sort(
        key=lambda event: event[
            "risk_score"
        ],
        reverse=True,
    )

    return assessed