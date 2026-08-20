from datetime import datetime, timedelta
import pytest

from conjunction.detector import (
    refine_time_of_closest_approach,
    find_closest_sampled_approach,
    detect_conjunctions,
)


# --- The made-up scenario, solved by hand first ---
#
# Object A starts at (0, 0, 0) and flies in a straight line at 1 km/s
# along the x-axis.
# Object B starts at (10, 3, 0) and flies in a straight line at 1 km/s
# in the OPPOSITE x direction, staying 3 km away on the y-axis.
#
# Position of A at time t seconds:  (t, 0, 0)
# Position of B at time t seconds:  (10 - t, 3, 0)
#
# By hand: the gap between them is smallest when t = 5 seconds.
# At that exact moment:
#   A is at (5, 0, 0), B is at (5, 3, 0)
#   distance = 3 km (pure y-gap, nothing left in x)
#   A's velocity is (1, 0, 0), B's velocity is (-1, 0, 0)
#   relative velocity = 2 km/s (they're closing from opposite directions)
#
# So we already KNOW the correct answer: TCA at t=5s, 3 km apart, 2 km/s.
# The test just checks the code arrives at the same numbers.


class FakeStraightLinePropagator:
    """
    A stand-in for the real propagation module. Instead of doing real
    orbital physics, it just plugs numbers into the simple straight-line
    formulas above. This lets us test OUR code without needing the real
    propagator to exist yet.
    """

    def __init__(self, reference_time):
        self.reference_time = reference_time

    def position_at_exact_time(self, object_id, moment):
        elapsed_seconds = (moment - self.reference_time).total_seconds()

        if object_id == "OBJECT_A":
            return {
                "x": elapsed_seconds, "y": 0.0, "z": 0.0,
                "vx": 1.0, "vy": 0.0, "vz": 0.0,
            }
        elif object_id == "OBJECT_B":
            return {
                "x": 10.0 - elapsed_seconds, "y": 3.0, "z": 0.0,
                "vx": -1.0, "vy": 0.0, "vz": 0.0,
            }
        else:
            raise ValueError(f"Unknown object_id: {object_id}")


def test_refine_finds_known_closest_approach():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)
    fake_propagator = FakeStraightLinePropagator(reference_time)

    # We already know from phase one (the coarse scan) that the true
    # closest approach falls somewhere between t=0s and t=10s.
    # Here we just hand that window in directly, since we're testing
    # phase two (the zoom-in) on its own.
    window_start = reference_time
    window_end = reference_time + timedelta(seconds=10)

    result = refine_time_of_closest_approach(
        fake_propagator,
        "OBJECT_A",
        "OBJECT_B",
        window_start,
        window_end,
    )

    expected_tca = reference_time + timedelta(seconds=5)

    # pytest.approx allows tiny floating-point differences —
    # the zoom-in search gets very close but not bit-for-bit exact.
    time_difference = abs(result["time_of_closest_approach"] - expected_tca)
    assert time_difference <= timedelta(milliseconds=1), (
        f"TCA off by {time_difference}, expected within 1ms"
    )

    assert result["minimum_separation_km"] == pytest.approx(3.0, abs=0.01)
    assert result["relative_velocity_km_s"] == pytest.approx(2.0, abs=0.01)

















# ---------------------------------------------------------------------
# TEST 2: the coarse scan on its own
#
# We're testing find_closest_sampled_approach in isolation here — NOT
# the zoom-in step. This uses plain snapshot dicts (like your original
# code), not the fake propagator. If this test ever fails but the
# refinement test still passes, you'll know the problem is in the
# "rough guess" stage, not the "zoom in" stage.
# ---------------------------------------------------------------------

def test_coarse_scan_finds_correct_bracket_window():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)

    # Snapshots every 2 seconds, same straight-line objects as before.
    # By hand: closest point is at t=5s (between the t=4s and t=6s
    # snapshots), so the coarse scan should pick t=4s as its best
    # guess snapshot, and bracket it with t=2s and t=6s as neighbours... 
    # actually let's keep it simple: distance keeps shrinking until t=4,
    # is smallest around t=4 vs t=6, so best_guess snapshot is whichever
    # of those is closer. We just check the bracket CONTAINS t=5.
    states_a = []
    states_b = []
    for t in range(0, 11, 2):  # 0, 2, 4, 6, 8, 10
        timestamp = reference_time + timedelta(seconds=t)
        states_a.append({
            "timestamp": timestamp,
            "x": float(t), "y": 0.0, "z": 0.0,
            "vx": 1.0, "vy": 0.0, "vz": 0.0,
        })
        states_b.append({
            "timestamp": timestamp,
            "x": 10.0 - t, "y": 3.0, "z": 0.0,
            "vx": -1.0, "vy": 0.0, "vz": 0.0,
        })

    result = find_closest_sampled_approach(states_a, states_b)

    # The true closest moment (t=5s) must fall inside the bracket window
    # the coarse scan hands back — otherwise phase two would be zooming
    # into the wrong slice of time entirely.
    true_closest_time = reference_time + timedelta(seconds=5)
    assert result["bracket_start_time"] <= true_closest_time <= result["bracket_end_time"]


# ---------------------------------------------------------------------
# TEST 3: objects that never get close
#
# This confirms your code doesn't cry wolf. If two objects stay far
# apart the whole time, detect_conjunctions should report ZERO events
# for that pair — not a false alarm.
# ---------------------------------------------------------------------

class FakeFarApartPropagator:
    """
    Two objects moving in parallel, always 500 km apart, never
    converging. A safe scenario — nothing dangerous should be reported.
    """

    def __init__(self, reference_time):
        self.reference_time = reference_time

    def position_at_exact_time(self, object_id, moment):
        elapsed_seconds = (moment - self.reference_time).total_seconds()

        if object_id == "OBJECT_A":
            return {
                "x": elapsed_seconds, "y": 0.0, "z": 0.0,
                "vx": 1.0, "vy": 0.0, "vz": 0.0,
            }
        elif object_id == "OBJECT_B":
            return {
                "x": elapsed_seconds, "y": 500.0, "z": 0.0,
                "vx": 1.0, "vy": 0.0, "vz": 0.0,
            }
        else:
            raise ValueError(f"Unknown object_id: {object_id}")


def test_detect_conjunctions_reports_nothing_when_objects_stay_far_apart():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)
    fake_propagator = FakeFarApartPropagator(reference_time)

    propagated_states = {}
    for object_id in ("OBJECT_A", "OBJECT_B"):
        snapshots = []
        for t in range(0, 11, 2):
            timestamp = reference_time + timedelta(seconds=t)
            state = fake_propagator.position_at_exact_time(object_id, timestamp)
            state["timestamp"] = timestamp
            snapshots.append(state)
        propagated_states[object_id] = snapshots

    conjunctions = detect_conjunctions(
        propagated_states, fake_propagator, threshold_km=10
    )

    # They're 500 km apart the whole time and our threshold is 10 km,
    # so nothing should be flagged.
    assert conjunctions == []


# ---------------------------------------------------------------------
# TEST 4: bad input should fail LOUDLY, not silently give a wrong answer
#
# This matters a lot for a safety-relevant tool: if someone accidentally
# feeds in mismatched or malformed data, we want a clear crash pointing
# at the problem — never a quietly wrong "safe" or "dangerous" verdict.
# ---------------------------------------------------------------------

def test_mismatched_timestamps_raise_error():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)

    states_a = [{
        "timestamp": reference_time,
        "x": 0.0, "y": 0.0, "z": 0.0,
        "vx": 0.0, "vy": 0.0, "vz": 0.0,
    }]
    states_b = [{
        # Deliberately different timestamp from states_a
        "timestamp": reference_time + timedelta(seconds=1),
        "x": 0.0, "y": 0.0, "z": 0.0,
        "vx": 0.0, "vy": 0.0, "vz": 0.0,
    }]

    with pytest.raises(ValueError):
        find_closest_sampled_approach(states_a, states_b)


def test_empty_state_lists_raise_error():
    with pytest.raises(ValueError):
        find_closest_sampled_approach([], [])


def test_zero_or_negative_threshold_raises_error():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)
    fake_propagator = FakeFarApartPropagator(reference_time)

    with pytest.raises(ValueError):
        detect_conjunctions({}, fake_propagator, threshold_km=0)

    with pytest.raises(ValueError):
        detect_conjunctions({}, fake_propagator, threshold_km=-5)


# ---------------------------------------------------------------------
# TEST 5: the full pipeline, start to finish
#
# This ties everything together — coarse scan AND refinement AND
# threshold filtering, using the SAME dangerous scenario from your
# very first test. If this passes, it proves the pieces work
# correctly together, not just in isolation.
# ---------------------------------------------------------------------

def test_detect_conjunctions_full_pipeline_flags_known_dangerous_pair():
    reference_time = datetime(2025, 1, 1, 0, 0, 0)
    fake_propagator = FakeStraightLinePropagator(reference_time)

    propagated_states = {}
    for object_id in ("OBJECT_A", "OBJECT_B"):
        snapshots = []
        for t in range(0, 11, 2):
            timestamp = reference_time + timedelta(seconds=t)
            state = fake_propagator.position_at_exact_time(object_id, timestamp)
            state["timestamp"] = timestamp
            snapshots.append(state)
        propagated_states[object_id] = snapshots

    # We know by hand this pair gets to 3 km apart, so a 10 km threshold
    # should catch it.
    conjunctions = detect_conjunctions(
        propagated_states, fake_propagator, threshold_km=10
    )

    assert len(conjunctions) == 1
    event = conjunctions[0]
    assert event["minimum_separation_km"] == pytest.approx(3.0, abs=0.01)
    assert event["relative_velocity_km_s"] == pytest.approx(2.0, abs=0.01)