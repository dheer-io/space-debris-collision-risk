from datetime import datetime, timezone

from orbital.propagation.propagator import (
    load_tle,
    load_satellite,
    create_satellite,
    propagate,
    propagate_tle,
)


TLE_FILE = "orbital/propagation/sample_data/iss.tle"


def test_load_tle():
    name, line1, line2 = load_tle(TLE_FILE)

    assert name == "ISS (ZARYA)"
    assert line1.startswith("1 ")
    assert line2.startswith("2 ")


def test_create_satellite():
    _, line1, line2 = load_tle(TLE_FILE)

    satellite = create_satellite(line1, line2)

    assert satellite.satnum == 25544


def test_propagate():
    _, satellite = load_satellite(TLE_FILE)

    timestamp = datetime.now(timezone.utc)

    position, velocity = propagate(
        satellite,
        timestamp,
    )

    assert len(position) == 3
    assert len(velocity) == 3


def test_propagate_tle():
    result = propagate_tle(
        TLE_FILE,
        datetime.now(timezone.utc),
        1800,
        600,
    )

    assert result["name"] == "ISS (ZARYA)"
    assert result["norad_id"] == 25544
    assert result["frame"] == "TEME"

    assert len(result["trajectory"]) == 4

    for point in result["trajectory"]:
        assert len(point["position_km"]) == 3
        assert len(point["velocity_km_s"]) == 3
        assert point["frame"] == "TEME"