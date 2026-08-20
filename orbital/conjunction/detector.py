"""
Conjunction detection for propagated space-object states.

This module works in two phases:

PHASE ONE (coarse scan):
    Look through a list of pre-computed snapshots (like the photos-every-
    60-seconds example) and find which snapshot shows two objects closest
    together. This tells us roughly WHEN to look more closely — it does
    NOT give us the real answer yet.

PHASE TWO (refinement):
    Zoom into the narrow window around that snapshot and repeatedly ask
    the propagator "where exactly is this object at this more precise
    moment in time?" until we've pinned down the true closest-approach
    time to a much finer precision than our original snapshot spacing.
"""

from datetime import datetime, timedelta
from math import sqrt
from typing import Callable, Protocol


# ---------------------------------------------------------------------
# PHASE ONE: the coarse scan (this is basically your original code,
# kept because it's still a necessary first step — it just isn't the
# final answer anymore)
# ---------------------------------------------------------------------

def calculate_separation(state_a, state_b):
    """
    Straight-line distance between two objects, in kilometres.
    """
    difference_x = state_a["x"] - state_b["x"]
    difference_y = state_a["y"] - state_b["y"]
    difference_z = state_a["z"] - state_b["z"]

    return sqrt(difference_x**2 + difference_y**2 + difference_z**2)


def calculate_relative_velocity(state_a, state_b):
    """
    How fast the two objects are moving relative to each other,
    in kilometres per second.
    """
    difference_velocity_x = state_a["vx"] - state_b["vx"]
    difference_velocity_y = state_a["vy"] - state_b["vy"]
    difference_velocity_z = state_a["vz"] - state_b["vz"]

    return sqrt(
        difference_velocity_x**2
        + difference_velocity_y**2
        + difference_velocity_z**2
    )


def find_closest_sampled_approach(states_a, states_b):
    """
    Look through the snapshot list and find the single snapshot where
    the two objects were nearest to each other.

    IMPORTANT: this is only a rough guess at the real closest-approach
    moment. Think of it as "the best photo we happened to take" — not
    the true answer. We use its neighbouring timestamps as a starting
    point for phase two.

    Returns the INDEX of the closest snapshot, plus the two
    neighbouring timestamps that bracket the true closest-approach
    moment (one snapshot before, one snapshot after).
    """
    if not states_a or not states_b:
        raise ValueError("Both state lists must contain at least one state.")

    if len(states_a) != len(states_b):
        raise ValueError("Both state lists must have the same length.")

    smallest_separation_so_far = float("inf")
    index_of_closest_snapshot = None

    for index in range(len(states_a)):
        state_a = states_a[index]
        state_b = states_b[index]

        if state_a["timestamp"] != state_b["timestamp"]:
            raise ValueError("Timestamps must match between object A and object B.")

        separation = calculate_separation(state_a, state_b)

        if separation < smallest_separation_so_far:
            smallest_separation_so_far = separation
            index_of_closest_snapshot = index

    # Bracket = "one snapshot before, one snapshot after" the best guess.
    # This narrow window is what we'll hand to phase two to search inside.
    bracket_start_index = max(0, index_of_closest_snapshot - 1)
    bracket_end_index = min(len(states_a) - 1, index_of_closest_snapshot + 1)

    return {
        "best_guess_index": index_of_closest_snapshot,
        "bracket_start_time": states_a[bracket_start_index]["timestamp"],
        "bracket_end_time": states_a[bracket_end_index]["timestamp"],
    }


# ---------------------------------------------------------------------
# PHASE TWO: refining the guess into the true closest-approach moment
# ---------------------------------------------------------------------

class ContinuousPositionSource(Protocol):
    """
    This describes what we NEED from the propagation teammate's code:
    a function we can call with ANY exact moment in time (not just our
    fixed snapshot times) and get back exactly where the object was at
    that moment.

    Think of it like a "video" instead of a stack of photos — you can
    pause it at any frame you want, not just the frames someone
    happened to save.
    """

    def position_at_exact_time(self, object_id: str, moment: datetime) -> dict:
        """
        Must return a dict shaped like:
        {"x": ..., "y": ..., "z": ..., "vx": ..., "vy": ..., "vz": ...}
        """
        ...


def _separation_at_moment(propagator, object_a_id, object_b_id, moment):
    """
    Small helper: ask the propagator where both objects are at this
    exact moment, and return how far apart they are.
    """
    state_a = propagator.position_at_exact_time(object_a_id, moment)
    state_b = propagator.position_at_exact_time(object_b_id, moment)
    return calculate_separation(state_a, state_b)


def refine_time_of_closest_approach(
    propagator,
    object_a_id,
    object_b_id,
    window_start,
    window_end,
    number_of_narrowing_steps=25,
):
    """
    This is the "hotter/colder" zoom-in step.

    We are given a narrow time window (window_start to window_end) that
    we already know CONTAINS the true closest-approach moment, thanks
    to phase one. Now we repeatedly shrink that window, each time
    checking two points inside it and throwing away whichever half is
    clearly farther from the true minimum.

    This is a standard technique called "golden-section search" — you
    don't need to know that name to understand it, just know it's a
    smart, fast way to zoom in on the lowest point of a dip-shaped
    curve (separation distance dips down, then rises back up, around
    the closest approach — like the bottom of a valley).

    After enough narrowing steps, window_start and window_end will
    have collapsed to (practically) the same instant — and THAT is our
    true, precise time of closest approach.
    """
    golden_ratio = (sqrt(5) - 1) / 2  # ~0.618, the "smart zoom" ratio

    for _ in range(number_of_narrowing_steps):
        window_length = window_end - window_start

        # Two candidate points inside the current window
        probe_point_1 = window_start + (1 - golden_ratio) * window_length
        probe_point_2 = window_start + golden_ratio * window_length

        separation_at_probe_1 = _separation_at_moment(
            propagator, object_a_id, object_b_id, probe_point_1
        )
        separation_at_probe_2 = _separation_at_moment(
            propagator, object_a_id, object_b_id, probe_point_2
        )

        # Whichever probe point is FARTHER apart tells us the true
        # minimum is NOT on that side — so we discard that side and
        # keep zooming into the other side.
        if separation_at_probe_1 < separation_at_probe_2:
            window_end = probe_point_2
        else:
            window_start = probe_point_1

    # Window has collapsed to a tiny sliver — take the middle as our
    # best estimate of the true closest-approach time.
    refined_time_of_closest_approach = window_start + (window_end - window_start) / 2

    refined_state_a = propagator.position_at_exact_time(object_a_id, refined_time_of_closest_approach)
    refined_state_b = propagator.position_at_exact_time(object_b_id, refined_time_of_closest_approach)

    return {
        "time_of_closest_approach": refined_time_of_closest_approach,
        "minimum_separation_km": calculate_separation(refined_state_a, refined_state_b),
        "relative_velocity_km_s": calculate_relative_velocity(refined_state_a, refined_state_b),
    }


# ---------------------------------------------------------------------
# Putting phase one and phase two together
# ---------------------------------------------------------------------

def detect_conjunctions(propagated_states, propagator, threshold_km):
    """
    Args:
        propagated_states: the same coarse snapshot dictionary as before,
            used only to find candidate close-approach windows.

        propagator: an object with position_at_exact_time(), used to
            zoom in and get the real, precise answer.

        threshold_km: how close is "too close" — anything nearer than
            this counts as a conjunction worth reporting.
    """
    if threshold_km <= 0:
        raise ValueError("threshold_km must be greater than zero.")

    object_ids = list(propagated_states.keys())
    conjunctions = []

    for i in range(len(object_ids)):
        object_a_id = object_ids[i]
        states_a = propagated_states[object_a_id]

        for j in range(i + 1, len(object_ids)):
            object_b_id = object_ids[j]
            states_b = propagated_states[object_b_id]

            # Phase one: rough guess + bracket window
            coarse_result = find_closest_sampled_approach(states_a, states_b)

            # Phase two: zoom in for the real answer
            refined_result = refine_time_of_closest_approach(
                propagator,
                object_a_id,
                object_b_id,
                coarse_result["bracket_start_time"],
                coarse_result["bracket_end_time"],
            )

            if refined_result["minimum_separation_km"] <= threshold_km:
                conjunctions.append({
                    "object_1": object_a_id,
                    "object_2": object_b_id,
                    **refined_result,
                })

    conjunctions.sort(key=lambda event: event["minimum_separation_km"])
    return conjunctions